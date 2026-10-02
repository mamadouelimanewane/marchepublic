-- ==========================================
-- Migration 0023 : Séance d'ouverture des plis publique ou restreinte (CDC §5 phase 7)
--   • regles_ouverture : le type de séance dépend du mode de passation (paramétrable par l'administrateur)
--   • le type de séance est enregistré, de façon immuable, avec l'ouverture (bid_openings.seance_publique)
--   • registre de présence de la séance (qui était présent, à quel titre), inscrit par le CPM/PRM avant l'ouverture
--   • séance PUBLIQUE : la lecture des offres (candidats, lots, montants lus, conformité) est communiquée aux candidats ayant déposé une
--     offre dans les délais, dès l'ouverture ; séance RESTREINTE : rien n'est communiqué avant l'attribution (publicité graduée inchangée)
-- Valeurs de départ (AOO, AOO en deux étapes, concours = publique) : à confirmer par la DCMP.
-- ==========================================

CREATE TABLE regles_ouverture (
  id UUID NOT NULL UNIQUE DEFAULT uuid_generate_v4(),    -- identifiant d'entité pour le journal d'audit
  mode mode_passation PRIMARY KEY,
  publique BOOLEAN NOT NULL,
  note TEXT
);
INSERT INTO regles_ouverture (mode, publique, note) VALUES
  ('AOO', true, 'Appel d''offres ouvert : séance publique (valeur de départ à confirmer)'),
  ('AOO_2ETAPES', true, 'Appel d''offres en deux étapes : séance publique (valeur de départ à confirmer)'),
  ('CONCOURS', true, 'Concours : séance publique (valeur de départ à confirmer)'),
  ('AOR', false, 'Appel d''offres restreint : séance restreinte'),
  ('DRP', false, 'Demande de renseignements et de prix : séance restreinte'),
  ('ENTENTE_DIRECTE', false, 'Entente directe : séance restreinte'),
  ('ACCORD_CADRE', false, 'Accord-cadre : séance restreinte (valeur de départ à confirmer)')
ON CONFLICT (mode) DO NOTHING;
ALTER TABLE regles_ouverture ENABLE ROW LEVEL SECURITY;
CREATE POLICY "regles_ouverture_read" ON regles_ouverture FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "regles_ouverture_admin" ON regles_ouverture FOR ALL USING (current_user_role() = 'ADMIN') WITH CHECK (current_user_role() = 'ADMIN');
CREATE TRIGGER trig_audit_regles_ouverture AFTER INSERT OR UPDATE ON regles_ouverture FOR EACH ROW EXECUTE FUNCTION audit_row_change();

ALTER TABLE bid_openings ADD COLUMN IF NOT EXISTS seance_publique BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION ouverture_publique(p_mode mode_passation)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp SET row_security = off AS $$
  SELECT COALESCE((SELECT publique FROM regles_ouverture WHERE mode = p_mode), false)
$$;
GRANT EXECUTE ON FUNCTION ouverture_publique(mode_passation) TO authenticated;

-- ------------------------------------------
-- Registre de présence
-- ------------------------------------------
CREATE TABLE opening_attendance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tender_id UUID NOT NULL REFERENCES tenders(id),
  institution_id UUID NOT NULL REFERENCES institutions(id),
  nom TEXT NOT NULL CHECK (char_length(btrim(nom)) BETWEEN 3 AND 120),
  qualite TEXT NOT NULL CHECK (qualite IN ('CANDIDAT', 'OBSERVATEUR', 'AUTORITE', 'AUTRE')),
  organisme TEXT CHECK (organisme IS NULL OR char_length(organisme) <= 160),
  created_by UUID NOT NULL REFERENCES users(id) DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_opening_attendance_tender ON opening_attendance (tender_id);
CREATE TRIGGER trig_opening_attendance_immutable BEFORE UPDATE OR DELETE ON opening_attendance FOR EACH ROW EXECUTE FUNCTION block_update_delete();
ALTER TABLE opening_attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "opening_attendance_select" ON opening_attendance FOR SELECT USING (is_inst_staff(institution_id) OR is_regulateur() OR current_user_role() = 'COUR_COMPTES');
REVOKE INSERT, UPDATE, DELETE ON opening_attendance FROM anon, authenticated;
CREATE TRIGGER trig_audit_opening_attendance AFTER INSERT ON opening_attendance FOR EACH ROW EXECUTE FUNCTION audit_row_change();

CREATE OR REPLACE FUNCTION record_attendance(p_tender UUID, p_nom TEXT, p_qualite TEXT, p_organisme TEXT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE v_t tenders%ROWTYPE; v_id UUID;
BEGIN
  SELECT * INTO v_t FROM tenders WHERE id = p_tender FOR UPDATE;
  IF NOT FOUND OR v_t.institution_id IS DISTINCT FROM current_institution_id() OR current_user_role() NOT IN ('CPM', 'PRM') THEN
    RAISE EXCEPTION 'FORBIDDEN: le registre de présence est tenu par le CPM ou le PRM de l''autorité';
  END IF;
  IF v_t.current_phase <> 'PHASE_7_OUVERTURE_PLIS' THEN RAISE EXCEPTION 'INVALID_PHASE: le registre se tient pendant la séance d''ouverture (phase 7)'; END IF;
  IF EXISTS (SELECT 1 FROM bid_openings WHERE tender_id = p_tender) THEN RAISE EXCEPTION 'IMMUTABLE_RECORD: l''ouverture est déjà signée, le registre est clos'; END IF;
  INSERT INTO opening_attendance (tender_id, institution_id, nom, qualite, organisme) VALUES (p_tender, v_t.institution_id, btrim(p_nom), p_qualite, NULLIF(btrim(COALESCE(p_organisme, '')), ''))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION record_attendance(UUID, TEXT, TEXT, TEXT) TO authenticated;

-- ------------------------------------------
-- Ouverture : le type de séance est figé avec l'enregistrement
-- ------------------------------------------
CREATE OR REPLACE FUNCTION sign_opening(p_tender UUID, p_observations TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  v_t tenders%ROWTYPE; v_role TEXT := current_user_role(); v_signer TEXT;
  v_cpm UUID; v_pres UUID; v_nb INTEGER; v_pub BOOLEAN;
BEGIN
  SELECT * INTO v_t FROM tenders WHERE id = p_tender FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TENDER_NOT_FOUND'; END IF;
  IF v_t.current_phase <> 'PHASE_7_OUVERTURE_PLIS' THEN RAISE EXCEPTION 'INVALID_PHASE: ouverture possible uniquement en phase 7'; END IF;
  IF NOW() < v_t.date_limite_depot THEN RAISE EXCEPTION 'TOO_EARLY: date limite de dépôt non atteinte'; END IF;

  IF is_commission_member(p_tender, ARRAY['PRESIDENT']) THEN v_signer := 'PRESIDENT';
  ELSIF v_role = 'CPM' AND v_t.institution_id = current_institution_id() THEN v_signer := 'CPM';
  ELSE RAISE EXCEPTION 'FORBIDDEN: seuls le CPM et le président de la commission signent l''ouverture'; END IF;

  INSERT INTO opening_signatures (tender_id, signer_role, user_id, institution_id)
  VALUES (p_tender, v_signer, auth.uid(), v_t.institution_id);

  SELECT user_id INTO v_cpm FROM opening_signatures WHERE tender_id = p_tender AND signer_role = 'CPM';
  SELECT user_id INTO v_pres FROM opening_signatures WHERE tender_id = p_tender AND signer_role = 'PRESIDENT';
  IF v_cpm IS NULL OR v_pres IS NULL THEN
    RETURN jsonb_build_object('opened', false, 'waiting_for', CASE WHEN v_cpm IS NULL THEN 'CPM' ELSE 'PRESIDENT' END);
  END IF;

  v_pub := ouverture_publique(v_t.mode_passation);
  SELECT COUNT(*) INTO v_nb FROM bids WHERE tender_id = p_tender AND status = 'SOUMISE';
  INSERT INTO bid_openings (tender_id, institution_id, opened_by, president_id, key_fingerprint, nb_plis, observations, seance_publique)
  VALUES (p_tender, v_t.institution_id, v_cpm, v_pres, v_t.bid_key_fingerprint, v_nb, p_observations, v_pub);
  PERFORM _apply_transition(p_tender, 'PHASE_8_EVALUATION', 'DECLENCHER_OUVERTURE',
                            jsonb_build_object('nb_plis', v_nb, 'cpm', v_cpm, 'president', v_pres, 'seance_publique', v_pub));
  RETURN jsonb_build_object('opened', true, 'nb_plis', v_nb, 'seance_publique', v_pub);
END $$;
GRANT EXECUTE ON FUNCTION sign_opening(UUID, TEXT) TO authenticated;

-- ------------------------------------------
-- Lecture des offres de la séance publique
-- ------------------------------------------
CREATE OR REPLACE VIEW v_lecture_ouverture WITH (security_invoker = false) AS
SELECT b.tender_id, t.reference, l.numero_lot, u.full_name AS candidat, b.montant_offre AS montant_lu, b.status::text AS statut,
       b.motif_non_conformite AS motif, b.submitted_at AS recu_le, o.opened_at
FROM bids b
JOIN bid_openings o ON o.tender_id = b.tender_id AND o.seance_publique
JOIN tenders t ON t.id = b.tender_id
JOIN users u ON u.id = b.soumissionnaire_id
LEFT JOIN tender_lots l ON l.id = b.lot_id
WHERE b.status NOT IN ('BROUILLON', 'RETIREE', 'RETARDEE')
  AND (is_inst_staff(b.institution_id) OR is_regulateur() OR current_user_role() = 'COUR_COMPTES'
       OR EXISTS (SELECT 1 FROM bids m WHERE m.tender_id = b.tender_id AND m.soumissionnaire_id = auth.uid() AND m.status NOT IN ('BROUILLON', 'RETIREE', 'RETARDEE')));
REVOKE ALL ON v_lecture_ouverture FROM PUBLIC, anon;
GRANT SELECT ON v_lecture_ouverture TO authenticated;
