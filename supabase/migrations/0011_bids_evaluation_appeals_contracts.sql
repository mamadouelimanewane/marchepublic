-- ==========================================
-- Migration 0011 : Offres (coffre-fort), ouverture à double signature, évaluation,
--                  recours ARCOP, contrats, avenants, sous-traitance, quotas PME, archivage.
-- ==========================================

-- ------------------------------------------
-- 1. OFFRES : dépôt via RPC uniquement (horodatage serveur), confidentialité avant ouverture
-- ------------------------------------------
DROP POLICY IF EXISTS "bids_confidentiality" ON bids;
DROP POLICY IF EXISTS "bids_insert_soumissionnaire" ON bids;
DROP POLICY IF EXISTS "bids_update_after_opening" ON bids;

CREATE POLICY "bids_select" ON bids FOR SELECT USING (
  (current_user_role() = 'SOUMISSIONNAIRE' AND soumissionnaire_id = auth.uid())
  OR (tender_phase_of(tender_id) >= 'PHASE_7_OUVERTURE_PLIS' AND (
        (institution_id = current_institution_id() AND current_user_role() IN ('CPM', 'PRM'))
        OR is_commission_member(tender_id)
        OR current_user_role() IN ('DCMP', 'ARCOP', 'COUR_COMPTES')))
);
-- Même l'ADMIN ne voit aucune offre avant l'ouverture (CDC §8).

CREATE POLICY "bids_update" ON bids FOR UPDATE USING (
  (current_user_role() = 'SOUMISSIONNAIRE' AND soumissionnaire_id = auth.uid())
  OR (institution_id = current_institution_id() AND current_user_role() IN ('CPM', 'PRM')
      AND tender_phase_of(tender_id) IN ('PHASE_7_OUVERTURE_PLIS', 'PHASE_8_EVALUATION'))
) WITH CHECK (institution_id = tender_institution_of(tender_id));

REVOKE INSERT, DELETE ON bids FROM anon, authenticated;

CREATE OR REPLACE FUNCTION bids_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_changed TEXT[]; v_bad TEXT[]; v_role TEXT := current_user_role(); v_t tenders%ROWTYPE;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
  v_changed := changed_keys_except(to_jsonb(OLD), to_jsonb(NEW), ARRAY['updated_at']);
  SELECT * INTO v_t FROM tenders WHERE id = OLD.tender_id;

  IF v_role = 'SOUMISSIONNAIRE' THEN
    -- Seul retrait possible, avant la date limite
    IF v_changed <> ARRAY['status'] OR NEW.status <> 'RETIREE' OR OLD.status <> 'SOUMISE'
       OR v_t.current_phase <> 'PHASE_6_DEPOT_OFFRES' OR NOW() >= v_t.date_limite_depot THEN
      RAISE EXCEPTION 'BID_LOCKED: seul le retrait d''une offre soumise est possible, avant la date limite';
    END IF;
    RETURN NEW;
  END IF;

  v_bad := ARRAY(SELECT unnest(v_changed) EXCEPT SELECT unnest(ARRAY[
    'status', 'montant_offre', 'montant_technique', 'conformite_admin', 'motif_non_conformite',
    'verifie_par', 'verifie_le', 'dechiffre_par', 'dechiffre_le', 'has_soustraitance', 'montant_soustrait']));
  IF array_length(v_bad, 1) > 0 THEN
    RAISE EXCEPTION 'FORBIDDEN_COLUMN: colonnes d''offre non modifiables : %', array_to_string(v_bad, ', ');
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status NOT IN ('CONFORME', 'NON_CONFORME') THEN
    RAISE EXCEPTION 'BID_STATUS: statut % non positionnable manuellement (évaluation et attribution sont automatiques)', NEW.status;
  END IF;
  IF OLD.status NOT IN ('SOUMISE', 'CONFORME', 'NON_CONFORME') THEN
    RAISE EXCEPTION 'BID_LOCKED: offre % non modifiable', OLD.status;
  END IF;
  IF NEW.conformite_admin IS DISTINCT FROM OLD.conformite_admin THEN
    NEW.verifie_par := auth.uid(); NEW.verifie_le := NOW();
    NEW.status := (CASE WHEN NEW.conformite_admin THEN 'CONFORME' ELSE 'NON_CONFORME' END)::bid_status;
    IF NEW.conformite_admin = false AND char_length(COALESCE(NEW.motif_non_conformite, '')) < 5 THEN
      RAISE EXCEPTION 'MOTIVATION_REQUIRED: motif de non-conformité obligatoire';
    END IF;
  END IF;
  IF NEW.montant_offre IS DISTINCT FROM OLD.montant_offre THEN
    IF NEW.montant_offre IS NULL OR NEW.montant_offre <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
    NEW.dechiffre_par := auth.uid(); NEW.dechiffre_le := NOW();
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END $$;
CREATE TRIGGER trig_bids_guard BEFORE UPDATE ON bids FOR EACH ROW EXECUTE FUNCTION bids_guard();

-- Les soumissionnaires peuvent voir les profils dont ils ont besoin ; le personnel voit les candidats
-- d'un marché de son institution après l'ouverture des plis.
CREATE OR REPLACE FUNCTION bidder_visible_to_staff(p_user UUID)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp SET row_security = off AS $$
BEGIN
  -- Les évaluateurs notent des offres anonymisées : l'identité des candidats est réservée au CPM/PRM (et aux régulateurs).
  RETURN current_user_role() IN ('CPM', 'PRM') AND EXISTS (
    SELECT 1 FROM bids b JOIN tenders t ON t.id = b.tender_id
    WHERE b.soumissionnaire_id = p_user AND t.institution_id = current_institution_id()
      AND t.current_phase >= 'PHASE_7_OUVERTURE_PLIS');
END $$;
CREATE POLICY "users_bidders_after_opening" ON users FOR SELECT USING (role = 'SOUMISSIONNAIRE' AND bidder_visible_to_staff(id));

-- Dépôt : horodatage et contrôles côté serveur ; accusé de réception ; offres tardives tracées.
CREATE OR REPLACE FUNCTION submit_bid(p_tender UUID, p_technique_path TEXT, p_technique_hash TEXT,
                                      p_financier_path TEXT, p_financier_hash TEXT, p_lot UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_t tenders%ROWTYPE; v_u users%ROWTYPE; v_now TIMESTAMPTZ := clock_timestamp();
  v_prefix TEXT; v_bid UUID; v_receipt TEXT; v_existing bids%ROWTYPE;
BEGIN
  SELECT * INTO v_u FROM users WHERE id = auth.uid() AND is_active;
  IF NOT FOUND OR v_u.role <> 'SOUMISSIONNAIRE' THEN RAISE EXCEPTION 'FORBIDDEN: réservé aux soumissionnaires actifs'; END IF;
  SELECT * INTO v_t FROM tenders WHERE id = p_tender;
  IF NOT FOUND THEN RAISE EXCEPTION 'TENDER_NOT_FOUND'; END IF;

  IF v_t.current_phase < 'PHASE_6_DEPOT_OFFRES' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_OPEN');
  END IF;

  -- Offre tardive : rejet automatique et tracé (CDC §6)
  IF v_t.current_phase > 'PHASE_6_DEPOT_OFFRES' OR v_now >= v_t.date_limite_depot THEN
    INSERT INTO bids (tender_id, institution_id, soumissionnaire_id, status, submitted_at, lot_id)
    VALUES (p_tender, v_t.institution_id, v_u.id, 'RETARDEE', v_now, p_lot) ON CONFLICT DO NOTHING;
    PERFORM write_audit('BID_REJECTED_LATE', 'tender', p_tender, v_t.institution_id, NULL,
      jsonb_build_object('soumissionnaire_id', v_u.id, 'tentative', v_now, 'date_limite', v_t.date_limite_depot));
    RETURN jsonb_build_object('ok', false, 'reason', 'LATE');
  END IF;

  IF v_t.is_alloti THEN
    IF p_lot IS NULL OR NOT EXISTS (SELECT 1 FROM tender_lots l WHERE l.id = p_lot AND l.tender_id = p_tender) THEN
      RAISE EXCEPTION 'LOT_REQUIRED: ce marché est alloti, une offre doit viser un lot existant';
    END IF;
  ELSIF p_lot IS NOT NULL THEN
    RAISE EXCEPTION 'LOT_INVALID: ce marché n''est pas alloti';
  END IF;

  v_prefix := p_tender::text || '/' || v_u.id::text || '/';
  IF p_financier_path IS NULL OR p_technique_path IS NULL
     OR left(p_financier_path, length(v_prefix)) <> v_prefix OR left(p_technique_path, length(v_prefix)) <> v_prefix THEN
    RAISE EXCEPTION 'INVALID_PATH: les fichiers doivent être sous %', v_prefix;
  END IF;
  IF p_financier_hash !~ '^[0-9a-f]{64}$' OR p_technique_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'INVALID_HASH: empreintes SHA-256 attendues';
  END IF;
  IF v_t.is_reserve_pme AND NOT (v_u.is_pme OR v_u.is_ess) THEN
    RAISE EXCEPTION 'RESERVED_PME: marché réservé aux PME / économie sociale et solidaire';
  END IF;
  IF v_t.is_reserve_pme_feminine AND NOT v_u.is_pme_feminine THEN
    RAISE EXCEPTION 'RESERVED_PME_FEMININE: marché réservé aux PME à direction féminine';
  END IF;

  SELECT * INTO v_existing FROM bids WHERE tender_id = p_tender AND soumissionnaire_id = v_u.id AND lot_id IS NOT DISTINCT FROM p_lot;
  v_receipt := encode(digest(p_tender::text || coalesce(p_lot::text, '') || v_u.id::text || p_technique_hash || p_financier_hash || extract(epoch FROM v_now)::text, 'sha256'), 'hex');
  IF FOUND THEN
    IF v_existing.status NOT IN ('SOUMISE', 'RETIREE') THEN RAISE EXCEPTION 'BID_LOCKED: offre non modifiable'; END IF;
    UPDATE bids SET status = 'SOUMISE', fichier_technique_path = p_technique_path, fichier_technique_hash = p_technique_hash,
           fichier_financier_path = p_financier_path, fichier_financier_hash = p_financier_hash,
           submitted_at = v_now, timestamp_token = v_receipt
     WHERE id = v_existing.id RETURNING id INTO v_bid;
  ELSE
    INSERT INTO bids (tender_id, institution_id, soumissionnaire_id, status, fichier_technique_path, fichier_technique_hash,
                      fichier_technique_encrypted, fichier_financier_path, fichier_financier_hash, fichier_financier_encrypted,
                      submitted_at, timestamp_token, lot_id)
    VALUES (p_tender, v_t.institution_id, v_u.id, 'SOUMISE', p_technique_path, p_technique_hash, true,
            p_financier_path, p_financier_hash, true, v_now, v_receipt, p_lot)
    RETURNING id INTO v_bid;
  END IF;
  PERFORM notify_user(v_u.id, p_tender, 'ACCUSE_RECEPTION', 'Accusé de réception de votre offre',
                      'Offre reçue le ' || to_char(v_now, 'DD/MM/YYYY HH24:MI:SS') || ' — empreinte ' || left(v_receipt, 16));
  RETURN jsonb_build_object('ok', true, 'bid_id', v_bid, 'submitted_at', v_now, 'receipt', v_receipt);
END $$;
GRANT EXECUTE ON FUNCTION submit_bid(UUID, TEXT, TEXT, TEXT, TEXT, UUID) TO authenticated;

-- Stockage : la commission lit les enveloppes chiffrées uniquement après l'ouverture (phase ≥ 7).
CREATE POLICY "bid_files_read_commission" ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'bids'
  AND tender_phase_of(((storage.foldername(name))[1])::uuid) >= 'PHASE_7_OUVERTURE_PLIS'
  AND (is_commission_member(((storage.foldername(name))[1])::uuid)
       OR (current_user_role() IN ('CPM', 'PRM') AND tender_institution_of(((storage.foldername(name))[1])::uuid) = current_institution_id())
       OR current_user_role() IN ('DCMP', 'ARCOP', 'COUR_COMPTES')));

-- Bucket documents (TDR/DAO/PV/contrats) : lecture conditionnée à la visibilité de la ligne tender_documents (RLS).
INSERT INTO storage.buckets (id, name, public) VALUES ('documents', 'documents', false) ON CONFLICT (id) DO UPDATE SET public = false;
CREATE POLICY "documents_files_read" ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'documents' AND EXISTS (SELECT 1 FROM tender_documents d WHERE d.storage_path = name));
CREATE POLICY "documents_files_write" ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'documents' AND (storage.foldername(name))[1] = current_institution_id()::text
  AND current_user_role() IN ('SERVICE_DEMANDEUR', 'CPM', 'PRM', 'TRESOR'));

-- ------------------------------------------
-- 2. OUVERTURE DES PLIS : double signature (CPM + Président de commission)
-- ------------------------------------------
CREATE TABLE opening_signatures (
  tender_id UUID NOT NULL REFERENCES tenders(id),
  signer_role TEXT NOT NULL CHECK (signer_role IN ('CPM', 'PRESIDENT')),
  user_id UUID NOT NULL REFERENCES users(id),
  institution_id UUID NOT NULL REFERENCES institutions(id),
  signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tender_id, signer_role),
  UNIQUE (tender_id, user_id)
);
CREATE TRIGGER trig_opening_signatures_immutable BEFORE UPDATE OR DELETE ON opening_signatures
  FOR EACH ROW EXECUTE FUNCTION block_update_delete();
ALTER TABLE opening_signatures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "opening_signatures_select" ON opening_signatures FOR SELECT USING (is_inst_staff(institution_id) OR is_regulateur());
CREATE TRIGGER trig_audit_opening_signatures AFTER INSERT ON opening_signatures FOR EACH ROW EXECUTE FUNCTION audit_row_change();

CREATE OR REPLACE FUNCTION sign_opening(p_tender UUID, p_observations TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_t tenders%ROWTYPE; v_role TEXT := current_user_role(); v_signer TEXT;
  v_cpm UUID; v_pres UUID; v_nb INTEGER;
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

  SELECT COUNT(*) INTO v_nb FROM bids WHERE tender_id = p_tender AND status = 'SOUMISE';
  INSERT INTO bid_openings (tender_id, institution_id, opened_by, president_id, key_fingerprint, nb_plis, observations)
  VALUES (p_tender, v_t.institution_id, v_cpm, v_pres, v_t.bid_key_fingerprint, v_nb, p_observations);
  PERFORM _apply_transition(p_tender, 'PHASE_8_EVALUATION', 'DECLENCHER_OUVERTURE',
                            jsonb_build_object('nb_plis', v_nb, 'cpm', v_cpm, 'president', v_pres));
  RETURN jsonb_build_object('opened', true, 'nb_plis', v_nb);
END $$;
GRANT EXECUTE ON FUNCTION sign_opening(UUID, TEXT) TO authenticated;

-- ------------------------------------------
-- 3. ÉVALUATION : notes par évaluateur, classement calculé par le serveur
-- ------------------------------------------
ALTER TABLE bid_evaluations ADD COLUMN IF NOT EXISTS round INTEGER NOT NULL DEFAULT 1;
ALTER TABLE bid_evaluations ADD CONSTRAINT uq_bid_eval_round UNIQUE (bid_id, evaluateur_id, round);

CREATE TABLE bid_rankings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tender_id UUID NOT NULL REFERENCES tenders(id),
  institution_id UUID NOT NULL REFERENCES institutions(id),
  round INTEGER NOT NULL,
  bid_id UUID NOT NULL REFERENCES bids(id),
  lot_id UUID REFERENCES tender_lots(id),
  montant_offre BIGINT NOT NULL,
  score_technique NUMERIC(5,2) NOT NULL,
  score_financier NUMERIC(5,2),
  score_global NUMERIC(5,2),
  qualifie BOOLEAN NOT NULL,
  rang INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tender_id, round, bid_id)
);
CREATE TRIGGER trig_bid_rankings_immutable BEFORE UPDATE OR DELETE ON bid_rankings
  FOR EACH ROW EXECUTE FUNCTION block_update_delete();
ALTER TABLE bid_rankings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rankings_select" ON bid_rankings FOR SELECT USING (
  is_inst_staff(institution_id) OR is_regulateur() OR current_user_role() = 'COUR_COMPTES'
  OR (tender_phase_of(tender_id) >= 'PHASE_10_RECOURS'
      AND EXISTS (SELECT 1 FROM bids b WHERE b.id = bid_id AND b.soumissionnaire_id = auth.uid())));
CREATE TRIGGER trig_audit_bid_rankings AFTER INSERT ON bid_rankings FOR EACH ROW EXECUTE FUNCTION audit_row_change();

CREATE POLICY "evaluations_select" ON bid_evaluations FOR SELECT USING (
  is_commission_member(tender_id)
  OR (institution_id = current_institution_id() AND current_user_role() IN ('CPM', 'PRM'))
  OR is_regulateur() OR current_user_role() = 'COUR_COMPTES');
CREATE POLICY "evaluations_insert" ON bid_evaluations FOR INSERT WITH CHECK (
  evaluateur_id = auth.uid() AND is_commission_member(tender_id, ARRAY['PRESIDENT', 'MEMBRE', 'SECRETAIRE'])
  AND tender_phase_of(tender_id) = 'PHASE_8_EVALUATION');
CREATE POLICY "evaluations_update" ON bid_evaluations FOR UPDATE USING (
  evaluateur_id = auth.uid() AND tender_phase_of(tender_id) = 'PHASE_8_EVALUATION' AND finalise_le IS NULL);
REVOKE DELETE ON bid_evaluations FROM anon, authenticated;

CREATE OR REPLACE FUNCTION bid_evaluations_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_t tenders%ROWTYPE; v_b bids%ROWTYPE; v_item JSONB; v_score NUMERIC := 0; v_sum NUMERIC := 0;
BEGIN
  SELECT * INTO v_t FROM tenders WHERE id = NEW.tender_id;
  SELECT * INTO v_b FROM bids WHERE id = NEW.bid_id;
  IF v_b.tender_id IS DISTINCT FROM NEW.tender_id THEN RAISE EXCEPTION 'EVALUATION_INVALID: l''offre n''appartient pas à ce marché'; END IF;

  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'UPDATE' AND (NEW.bid_id <> OLD.bid_id OR NEW.tender_id <> OLD.tender_id OR NEW.evaluateur_id <> OLD.evaluateur_id) THEN
      RAISE EXCEPTION 'FORBIDDEN_COLUMN: clés de l''évaluation immuables';
    END IF;
    IF v_b.status <> 'CONFORME' THEN RAISE EXCEPTION 'EVALUATION_INVALID: seule une offre conforme peut être évaluée (statut %)', v_b.status; END IF;
    NEW.institution_id := v_t.institution_id;
    NEW.round := v_t.evaluation_round;
    NEW.phase_evaluation := 'TECHNIQUE';
    NEW.finalise_le := NULL; NEW.score_financier := NULL; NEW.score_global := NULL; NEW.rang := NULL;
  END IF;

  -- Le score technique est TOUJOURS recalculé côté serveur
  FOR v_item IN SELECT * FROM jsonb_array_elements(NEW.grille_technique) LOOP
    IF (v_item->>'note')::numeric < 0 OR (v_item->>'note')::numeric > (v_item->>'ponderation')::numeric THEN
      RAISE EXCEPTION 'EVALUATION_INVALID: la note de "%" doit être comprise entre 0 et sa pondération', v_item->>'critere';
    END IF;
    v_score := v_score + (v_item->>'note')::numeric;
    v_sum := v_sum + (v_item->>'ponderation')::numeric;
  END LOOP;
  IF v_sum <> 100 THEN RAISE EXCEPTION 'EVALUATION_INVALID: la somme des pondérations doit être 100 (actuel : %)', v_sum; END IF;
  IF jsonb_array_length(v_t.criteres_evaluation) > 0 AND (
       SELECT jsonb_agg(jsonb_build_object('c', x->>'critere', 'p', (x->>'ponderation')::numeric) ORDER BY x->>'critere')
       FROM jsonb_array_elements(NEW.grille_technique) x)
     IS DISTINCT FROM (
       SELECT jsonb_agg(jsonb_build_object('c', x->>'critere', 'p', (x->>'ponderation')::numeric) ORDER BY x->>'critere')
       FROM jsonb_array_elements(v_t.criteres_evaluation) x) THEN
    RAISE EXCEPTION 'EVALUATION_INVALID: la grille doit reprendre exactement les critères du dossier d''appel d''offres';
  END IF;
  NEW.score_technique := round(v_score, 2);
  NEW.updated_at := NOW();
  RETURN NEW;
END $$;
CREATE TRIGGER trig_bid_evaluations_guard BEFORE INSERT OR UPDATE ON bid_evaluations
  FOR EACH ROW EXECUTE FUNCTION bid_evaluations_guard();

CREATE OR REPLACE FUNCTION _finalize_evaluation(p_tender UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_t tenders%ROWTYPE; v_seuil NUMERIC; v_w NUMERIC; v_min BIGINT; r RECORD; g RECORD; v_rang INTEGER := 0; v_n INTEGER;
BEGIN
  SELECT * INTO v_t FROM tenders WHERE id = p_tender FOR UPDATE;
  v_seuil := config_num('EVAL_SEUIL_TECHNIQUE', 70);
  v_w := CASE WHEN v_t.nature_marche = 'PRESTATIONS_INTELLECTUELLES' THEN config_num('EVAL_POIDS_TECHNIQUE_PI', 0.8)
              ELSE config_num('EVAL_POIDS_TECHNIQUE', 0.7) END;

  IF EXISTS (SELECT 1 FROM bids WHERE tender_id = p_tender AND status = 'SOUMISE') THEN
    RAISE EXCEPTION 'UNCHECKED_BIDS: toutes les offres doivent avoir fait l''objet du contrôle de conformité administrative';
  END IF;
  SELECT COUNT(*) INTO v_n FROM bids WHERE tender_id = p_tender AND status = 'CONFORME';
  IF v_n = 0 THEN RAISE EXCEPTION 'NO_ELIGIBLE_BID: aucune offre conforme — procédure infructueuse'; END IF;
  IF EXISTS (SELECT 1 FROM bids WHERE tender_id = p_tender AND status = 'CONFORME' AND montant_offre IS NULL) THEN
    RAISE EXCEPTION 'EVALUATION_INCOMPLETE: le montant de chaque offre conforme doit être relevé à l''ouverture';
  END IF;
  IF EXISTS (
    SELECT 1 FROM bids b WHERE b.tender_id = p_tender AND b.status = 'CONFORME'
      AND (SELECT COUNT(DISTINCT e.evaluateur_id) FROM bid_evaluations e WHERE e.bid_id = b.id AND e.round = v_t.evaluation_round) < 2) THEN
    RAISE EXCEPTION 'EVALUATION_INCOMPLETE: chaque offre conforme doit être notée par au moins deux évaluateurs';
  END IF;

  CREATE TEMP TABLE _scores ON COMMIT DROP AS
  SELECT b.id AS bid_id, b.lot_id, b.montant_offre, b.submitted_at,
         round(AVG(e.score_technique), 2) AS st,
         round(AVG(e.score_technique), 2) >= v_seuil AS ok
  FROM bids b JOIN bid_evaluations e ON e.bid_id = b.id AND e.round = v_t.evaluation_round
  WHERE b.tender_id = p_tender AND b.status = 'CONFORME'
  GROUP BY b.id, b.lot_id, b.montant_offre, b.submitted_at;

  -- Chaque lot (ou le marché entier s'il n'est pas alloti) est classé indépendamment.
  FOR g IN SELECT DISTINCT lot_id FROM _scores LOOP
    SELECT MIN(montant_offre) INTO v_min FROM _scores WHERE lot_id IS NOT DISTINCT FROM g.lot_id AND ok;
    IF v_min IS NULL THEN
      IF g.lot_id IS NULL THEN
        RAISE EXCEPTION 'NO_QUALIFIED_BID: aucune offre n''atteint la note technique minimale (%) — procédure infructueuse', v_seuil;
      END IF;
      UPDATE tender_lots SET statut = 'INFRUCTUEUX' WHERE id = g.lot_id;   -- lot infructueux, les autres lots poursuivent
    END IF;
    v_rang := 0;
    FOR r IN SELECT s.*, CASE WHEN s.ok THEN round(100.0 * v_min / s.montant_offre, 2) END AS sf,
                    CASE WHEN s.ok THEN round(v_w * s.st + (1 - v_w) * (100.0 * v_min / s.montant_offre), 2) END AS sg
             FROM _scores s WHERE s.lot_id IS NOT DISTINCT FROM g.lot_id
             ORDER BY sg DESC NULLS LAST, s.montant_offre ASC, s.submitted_at ASC LOOP
      IF r.ok THEN v_rang := v_rang + 1; END IF;
      INSERT INTO bid_rankings (tender_id, institution_id, round, bid_id, lot_id, montant_offre, score_technique, score_financier, score_global, qualifie, rang)
      VALUES (p_tender, v_t.institution_id, v_t.evaluation_round, r.bid_id, r.lot_id, r.montant_offre, r.st, r.sf, r.sg, r.ok, CASE WHEN r.ok THEN v_rang END);
      UPDATE bids SET status = (CASE WHEN r.ok THEN 'EVALUEE' ELSE 'REJETEE' END)::bid_status WHERE id = r.bid_id;
    END LOOP;
  END LOOP;
  IF v_t.is_alloti THEN   -- lots sans aucune offre conforme
    UPDATE tender_lots SET statut = 'INFRUCTUEUX'
     WHERE tender_id = p_tender AND statut = 'OUVERT' AND NOT EXISTS (SELECT 1 FROM bid_rankings k WHERE k.lot_id = tender_lots.id AND k.round = v_t.evaluation_round AND k.rang = 1);
  END IF;
  UPDATE bid_evaluations SET phase_evaluation = 'FINALISEE', finalise_le = NOW()
   WHERE tender_id = p_tender AND round = v_t.evaluation_round;
  DROP TABLE _scores;
END $$;
REVOKE ALL ON FUNCTION _finalize_evaluation(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION _award_one(p_tender UUID, p_lot UUID, p_bid UUID, p_just TEXT, p_round INTEGER)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_t tenders%ROWTYPE; v_rank bid_rankings%ROWTYPE; v_first UUID; v_bid UUID; v_u users%ROWTYPE;
BEGIN
  SELECT * INTO v_t FROM tenders WHERE id = p_tender;
  SELECT bid_id INTO v_first FROM bid_rankings WHERE tender_id = p_tender AND round = p_round AND rang = 1 AND lot_id IS NOT DISTINCT FROM p_lot;
  v_bid := COALESCE(p_bid, v_first);
  SELECT * INTO v_rank FROM bid_rankings WHERE tender_id = p_tender AND round = p_round AND bid_id = v_bid AND qualifie AND lot_id IS NOT DISTINCT FROM p_lot;
  IF NOT FOUND THEN RAISE EXCEPTION 'AWARD_INVALID: l''offre retenue doit être une offre qualifiée de ce marché (ou de ce lot)'; END IF;
  IF v_bid IS DISTINCT FROM v_first AND char_length(COALESCE(p_just, '')) < 30 THEN
    RAISE EXCEPTION 'JUSTIFICATION_REQUIRED: attribuer à une offre autre que la mieux classée exige une justification (30 caractères min.)';
  END IF;
  SELECT u.* INTO v_u FROM bids b JOIN users u ON u.id = b.soumissionnaire_id WHERE b.id = v_bid;
  IF v_t.is_reserve_pme AND NOT (v_u.is_pme OR v_u.is_ess) THEN RAISE EXCEPTION 'RESERVED_PME: l''attributaire doit être une PME / ESS'; END IF;
  IF v_t.is_reserve_pme_feminine AND NOT v_u.is_pme_feminine THEN RAISE EXCEPTION 'RESERVED_PME_FEMININE: l''attributaire doit être une PME à direction féminine'; END IF;
  UPDATE bids SET status = 'PROVISOIREMENT_RETENUE' WHERE id = v_bid;
  IF p_lot IS NULL THEN
    UPDATE tenders SET attributaire_id = v_u.id, attributaire_bid_id = v_bid WHERE id = p_tender;
  ELSE
    UPDATE tender_lots SET attributaire_id = v_u.id, attributaire_bid_id = v_bid, montant_attribue = v_rank.montant_offre, statut = 'ATTRIBUE' WHERE id = p_lot;
  END IF;
  IF v_bid IS DISTINCT FROM v_first THEN
    PERFORM write_audit('AWARD_OVERRIDE_RANKING', 'tender', p_tender, v_t.institution_id, NULL,
      jsonb_build_object('lot', p_lot, 'rang1', v_first, 'retenue', v_bid), jsonb_build_object('justification', p_just));
  END IF;
  RETURN v_rank.montant_offre;
END $$;
REVOKE ALL ON FUNCTION _award_one(UUID, UUID, UUID, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;

-- Marché non alloti : payload {bid_id, justification}. Marché alloti : payload {awards:[{lot_id, bid_id?, justification?}]} ;
-- tout lot classé non mentionné est attribué à son rang 1.
CREATE OR REPLACE FUNCTION _set_provisional_award(p_tender UUID, p_payload JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_t tenders%ROWTYPE; v_total BIGINT := 0; l RECORD; a JSONB;
BEGIN
  SELECT * INTO v_t FROM tenders WHERE id = p_tender FOR UPDATE;
  IF NOT v_t.is_alloti THEN
    v_total := _award_one(p_tender, NULL, (p_payload->>'bid_id')::uuid, p_payload->>'justification', v_t.evaluation_round);
    UPDATE tenders SET montant_attribue = v_total WHERE id = p_tender;
    RETURN;
  END IF;
  FOR l IN SELECT id FROM tender_lots WHERE tender_id = p_tender AND statut = 'OUVERT' ORDER BY numero_lot LOOP
    SELECT x INTO a FROM jsonb_array_elements(COALESCE(p_payload->'awards', '[]'::jsonb)) x WHERE (x->>'lot_id')::uuid = l.id LIMIT 1;
    v_total := v_total + _award_one(p_tender, l.id, (a->>'bid_id')::uuid, a->>'justification', v_t.evaluation_round);
  END LOOP;
  IF v_total = 0 THEN RAISE EXCEPTION 'AWARD_INVALID: aucun lot attribuable'; END IF;
  UPDATE tenders SET montant_attribue = v_total WHERE id = p_tender;
END $$;
REVOKE ALL ON FUNCTION _set_provisional_award(UUID, JSONB) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------
-- 4. RECOURS (ARCOP) : dépôt et décision par RPC uniquement
-- ------------------------------------------
DROP POLICY IF EXISTS "appeals_insert_soumissionnaire" ON appeals;
DROP POLICY IF EXISTS "appeals_update_arcop" ON appeals;
REVOKE INSERT, UPDATE, DELETE ON appeals FROM anon, authenticated;
CREATE UNIQUE INDEX uq_appeal_one_pending ON appeals (tender_id, requerant_id) WHERE status IN ('DEPOSE', 'EN_INSTRUCTION');

CREATE OR REPLACE FUNCTION sync_appeal_status()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_pending BOOLEAN; v_last TEXT;
BEGIN
  SELECT EXISTS (SELECT 1 FROM appeals WHERE tender_id = NEW.tender_id AND status IN ('DEPOSE', 'EN_INSTRUCTION')) INTO v_pending;
  SELECT status::text INTO v_last FROM appeals
   WHERE tender_id = NEW.tender_id AND status NOT IN ('DEPOSE', 'EN_INSTRUCTION') ORDER BY date_decision DESC NULLS LAST, updated_at DESC LIMIT 1;
  UPDATE tenders SET has_appeal_pending = v_pending,
         arcop_decision = CASE WHEN v_pending THEN 'EN_COURS' ELSE v_last END
   WHERE id = NEW.tender_id;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION submit_appeal(p_tender UUID, p_motif TEXT, p_description TEXT DEFAULT NULL, p_document_path TEXT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_t tenders%ROWTYPE; v_bid bids%ROWTYPE; v_id UUID; r RECORD;
BEGIN
  IF current_user_role() <> 'SOUMISSIONNAIRE' THEN RAISE EXCEPTION 'FORBIDDEN: réservé aux candidats'; END IF;
  SELECT * INTO v_t FROM tenders WHERE id = p_tender FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TENDER_NOT_FOUND'; END IF;
  IF v_t.current_phase <> 'PHASE_10_RECOURS' THEN RAISE EXCEPTION 'INVALID_PHASE: aucun délai de recours ouvert'; END IF;
  IF NOW() > v_t.date_fin_recours THEN RAISE EXCEPTION 'APPEAL_TOO_LATE: le délai de recours a expiré le %', v_t.date_fin_recours; END IF;
  -- Marché alloti : un candidat peut gagner un lot et contester un autre ; il suffit d'une offre recevable non retenue.
  SELECT * INTO v_bid FROM bids WHERE tender_id = p_tender AND soumissionnaire_id = auth.uid()
     AND status NOT IN ('RETARDEE', 'RETIREE', 'BROUILLON', 'PROVISOIREMENT_RETENUE') ORDER BY submitted_at LIMIT 1;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM bids WHERE tender_id = p_tender AND soumissionnaire_id = auth.uid() AND status = 'PROVISOIREMENT_RETENUE') THEN
      RAISE EXCEPTION 'FORBIDDEN: l''attributaire provisoire ne peut pas contester sa propre attribution';
    END IF;
    RAISE EXCEPTION 'FORBIDDEN: seul un candidat ayant déposé une offre recevable peut former un recours';
  END IF;
  IF char_length(COALESCE(p_motif, '')) < 10 THEN RAISE EXCEPTION 'MOTIVATION_REQUIRED: motif du recours obligatoire'; END IF;

  INSERT INTO appeals (tender_id, institution_id, requerant_id, motif, description, document_path, date_limite_instruction)
  VALUES (p_tender, v_t.institution_id, auth.uid(), p_motif, p_description, p_document_path,
          NOW() + make_interval(days => config_num('DELAI_INSTRUCTION_RECOURS_JOURS', 7)::int))
  RETURNING id INTO v_id;
  FOR r IN SELECT id FROM users WHERE role = 'ARCOP' AND is_active LOOP
    PERFORM notify_user(r.id, p_tender, 'RECOURS_DEPOSE', 'Nouveau recours', 'Recours déposé sur ' || v_t.reference);
  END LOOP;
  FOR r IN SELECT id FROM users WHERE institution_id = v_t.institution_id AND role IN ('PRM', 'CPM') AND is_active LOOP
    PERFORM notify_user(r.id, p_tender, 'RECOURS_DEPOSE', 'Recours déposé', 'La procédure ' || v_t.reference || ' est suspendue.');
  END LOOP;
  UPDATE appeals SET notifie_ac = true WHERE id = v_id;
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION submit_appeal(UUID, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION decide_appeal(p_appeal UUID, p_decision TEXT, p_motivation TEXT DEFAULT NULL)
RETURNS appeal_status LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_a appeals%ROWTYPE; v_t tenders%ROWTYPE; r RECORD;
BEGIN
  IF current_user_role() <> 'ARCOP' THEN RAISE EXCEPTION 'FORBIDDEN: réservé à l''ARCOP'; END IF;
  SELECT * INTO v_a FROM appeals WHERE id = p_appeal FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'APPEAL_NOT_FOUND'; END IF;
  IF v_a.status NOT IN ('DEPOSE', 'EN_INSTRUCTION') THEN RAISE EXCEPTION 'INVALID_STATE: recours déjà tranché (%)', v_a.status; END IF;
  IF p_decision NOT IN ('EN_INSTRUCTION', 'IRRECEVABLE', 'REJETE', 'FAVORABLE', 'PARTIELLEMENT_FAVORABLE') THEN RAISE EXCEPTION 'INVALID_DECISION'; END IF;
  IF p_decision = 'EN_INSTRUCTION' AND v_a.status = 'EN_INSTRUCTION' THEN RAISE EXCEPTION 'INVALID_STATE: déjà en instruction'; END IF;
  IF p_decision <> 'EN_INSTRUCTION' AND char_length(COALESCE(p_motivation, '')) < 20 THEN
    RAISE EXCEPTION 'MOTIVATION_REQUIRED: décision motivée obligatoire (20 caractères min.)';
  END IF;

  UPDATE appeals SET status = p_decision::appeal_status, arcop_instructeur_id = auth.uid(), updated_at = NOW(),
         decision_arcop = CASE WHEN p_decision = 'EN_INSTRUCTION' THEN decision_arcop ELSE p_motivation END,
         date_decision = CASE WHEN p_decision = 'EN_INSTRUCTION' THEN NULL ELSE NOW() END,
         notifie_requerant = p_decision <> 'EN_INSTRUCTION'
   WHERE id = p_appeal;

  IF p_decision <> 'EN_INSTRUCTION' THEN
    SELECT * INTO v_t FROM tenders WHERE id = v_a.tender_id FOR UPDATE;
    PERFORM notify_user(v_a.requerant_id, v_a.tender_id, 'DECISION_ARCOP', 'Décision de l''ARCOP', p_decision);
    FOR r IN SELECT id FROM users WHERE institution_id = v_t.institution_id AND role IN ('PRM', 'CPM') AND is_active LOOP
      PERFORM notify_user(r.id, v_a.tender_id, 'DECISION_ARCOP', 'Décision de l''ARCOP', v_t.reference || ' : ' || p_decision);
    END LOOP;
    IF p_decision IN ('FAVORABLE', 'PARTIELLEMENT_FAVORABLE') AND v_t.current_phase = 'PHASE_10_RECOURS' THEN
      -- Reprise de la procédure : nouvelle ronde d'évaluation
      UPDATE bids SET status = 'CONFORME' WHERE tender_id = v_a.tender_id AND status IN ('EVALUEE', 'REJETEE', 'PROVISOIREMENT_RETENUE');
      UPDATE tender_lots SET attributaire_id = NULL, attributaire_bid_id = NULL, montant_attribue = NULL, statut = 'OUVERT' WHERE tender_id = v_a.tender_id;
      UPDATE tenders SET attributaire_id = NULL, attributaire_bid_id = NULL, montant_attribue = NULL, montant_initial = NULL,
             date_fin_recours = NULL, date_attribution_provisoire = NULL, evaluation_round = evaluation_round + 1
       WHERE id = v_a.tender_id;
      PERFORM _apply_transition(v_a.tender_id, 'PHASE_8_EVALUATION', 'DECISION_ARCOP', jsonb_build_object('appeal', p_appeal, 'decision', p_decision));
    END IF;
  END IF;
  RETURN p_decision::appeal_status;
END $$;
GRANT EXECUTE ON FUNCTION decide_appeal(UUID, TEXT, TEXT) TO authenticated;

-- ------------------------------------------
-- 5. CONTRATS
-- ------------------------------------------
ALTER TABLE contracts ADD CONSTRAINT contracts_montant_positive CHECK (montant_initial > 0) NOT VALID;
REVOKE INSERT, UPDATE, DELETE ON contracts FROM anon, authenticated;

CREATE OR REPLACE FUNCTION prepare_contract(p_tender UUID, p_date_debut DATE DEFAULT NULL, p_delai_jours INTEGER DEFAULT NULL, p_lot UUID DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_t tenders%ROWTYPE; v_l tender_lots%ROWTYPE; v_id UUID; v_bid UUID; v_holder UUID; v_montant BIGINT;
BEGIN
  SELECT * INTO v_t FROM tenders WHERE id = p_tender FOR UPDATE;
  IF NOT FOUND OR v_t.institution_id IS DISTINCT FROM current_institution_id() OR current_user_role() NOT IN ('PRM', 'CPM') THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF v_t.current_phase <> 'PHASE_12_SIGNATURE_CONTRAT' THEN RAISE EXCEPTION 'INVALID_PHASE: contrat préparé en phase 12 uniquement'; END IF;
  IF v_t.has_appeal_pending THEN RAISE EXCEPTION 'HARD_LOCK_APPEAL: recours pendant'; END IF;
  IF v_t.is_alloti THEN
    SELECT * INTO v_l FROM tender_lots WHERE id = p_lot AND tender_id = p_tender AND statut = 'ATTRIBUE';
    IF NOT FOUND THEN RAISE EXCEPTION 'LOT_REQUIRED: indiquez un lot attribué de ce marché'; END IF;
    v_bid := v_l.attributaire_bid_id; v_holder := v_l.attributaire_id; v_montant := v_l.montant_attribue;
  ELSE
    IF p_lot IS NOT NULL THEN RAISE EXCEPTION 'LOT_INVALID: ce marché n''est pas alloti'; END IF;
    v_bid := v_t.attributaire_bid_id; v_holder := v_t.attributaire_id; v_montant := v_t.montant_attribue;
  END IF;
  IF EXISTS (SELECT 1 FROM contracts WHERE tender_id = p_tender AND lot_id IS NOT DISTINCT FROM p_lot) THEN RAISE EXCEPTION 'CONTRACT_EXISTS'; END IF;
  INSERT INTO contracts (tender_id, institution_id, bid_id, attributaire_id, montant_initial, montant_actuel, date_debut_execution, delai_execution, lot_id)
  VALUES (p_tender, v_t.institution_id, v_bid, v_holder, v_montant, v_montant, p_date_debut, p_delai_jours, p_lot)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION prepare_contract(UUID, DATE, INTEGER, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION sign_contract(p_contract UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_c contracts%ROWTYPE; v_t tenders%ROWTYPE; v_party TEXT;
BEGIN
  SELECT * INTO v_c FROM contracts WHERE id = p_contract FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTRACT_NOT_FOUND'; END IF;
  SELECT * INTO v_t FROM tenders WHERE id = v_c.tender_id;
  -- Blocage de la signature tant qu'un recours est pendant (CDC §6 module Recours)
  IF EXISTS (SELECT 1 FROM appeals a WHERE a.tender_id = v_c.tender_id AND a.status IN ('DEPOSE', 'EN_INSTRUCTION')) THEN
    RAISE EXCEPTION 'HARD_LOCK_APPEAL: signature impossible, un recours est pendant devant l''ARCOP';
  END IF;
  IF v_t.current_phase <> 'PHASE_12_SIGNATURE_CONTRAT' THEN RAISE EXCEPTION 'INVALID_PHASE'; END IF;
  IF v_c.attributaire_id = auth.uid() THEN
    UPDATE contracts SET signed_by_titulaire = true, signature_titulaire_at = NOW(), updated_at = NOW() WHERE id = p_contract; v_party := 'TITULAIRE';
  ELSIF current_user_role() = 'PRM' AND v_c.institution_id = current_institution_id() THEN
    UPDATE contracts SET signed_by_ac = true, signature_ac_at = NOW(), updated_at = NOW() WHERE id = p_contract; v_party := 'AC';
  ELSE RAISE EXCEPTION 'FORBIDDEN: signataires autorisés : PRM de l''institution et titulaire'; END IF;
  PERFORM write_audit('CONTRACT_SIGNED', 'contract', p_contract, v_c.institution_id, NULL, jsonb_build_object('party', v_party));
  RETURN jsonb_build_object('party', v_party);
END $$;
GRANT EXECUTE ON FUNCTION sign_contract(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION visa_contract(p_contract UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_c contracts%ROWTYPE;
BEGIN
  SELECT * INTO v_c FROM contracts WHERE id = p_contract FOR UPDATE;
  IF NOT FOUND OR current_user_role() <> 'TRESOR' OR v_c.institution_id IS DISTINCT FROM current_institution_id() THEN RAISE EXCEPTION 'FORBIDDEN: visa réservé au contrôleur financier de l''institution'; END IF;
  IF NOT v_c.signed_by_ac THEN RAISE EXCEPTION 'INVALID_STATE: le contrat doit d''abord être signé par l''autorité contractante'; END IF;
  UPDATE contracts SET visa_controleur = true, visa_at = NOW(), visa_par = auth.uid(), updated_at = NOW() WHERE id = p_contract;
  PERFORM write_audit('CONTRACT_VISA', 'contract', p_contract, v_c.institution_id);
END $$;
GRANT EXECUTE ON FUNCTION visa_contract(UUID) TO authenticated;

-- Avenants (plafond 30 %) — le dépassement est BLOQUÉ par la base
CREATE OR REPLACE FUNCTION check_amendment_limit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_c contracts%ROWTYPE; v_plafond NUMERIC; v_cumul BIGINT; v_net BIGINT;
BEGIN
  SELECT * INTO v_c FROM contracts WHERE id = NEW.contract_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTRACT_NOT_FOUND'; END IF;
  IF v_c.status <> 'ACTIF' OR tender_phase_of(v_c.tender_id) <> 'PHASE_13_EXECUTION' THEN
    RAISE EXCEPTION 'AMENDMENT_INVALID: avenant possible uniquement sur un contrat actif en phase d''exécution';
  END IF;
  NEW.tender_id := v_c.tender_id; NEW.institution_id := v_c.institution_id;
  v_plafond := config_num('AVENANT_PLAFOND', 0.30);

  -- Cumul des augmentations (les avenants en moins ne « rechargent » pas le plafond)
  SELECT COALESCE(SUM(GREATEST(montant_avenant, 0)), 0) INTO v_cumul FROM contract_amendments WHERE contract_id = NEW.contract_id;
  NEW.cumul_avant := v_cumul;
  NEW.cumul_apres := v_cumul + GREATEST(NEW.montant_avenant, 0);
  NEW.pourcentage := ROUND(NEW.cumul_apres::numeric * 100 / v_c.montant_initial, 2);
  NEW.depasse_seuil := false;
  IF NEW.cumul_apres > v_c.montant_initial * v_plafond THEN
    RAISE EXCEPTION 'AVENANT_LIMIT_EXCEEDED: le cumul des avenants (% %%) dépasse le plafond légal de % %% du montant initial (% FCFA)',
      NEW.pourcentage, (v_plafond * 100)::int, v_c.montant_initial;
  END IF;

  NEW.valide_par := COALESCE(auth.uid(), NEW.valide_par); NEW.valide_le := NOW();
  SELECT COALESCE(SUM(montant_avenant), 0) + NEW.montant_avenant INTO v_net FROM contract_amendments WHERE contract_id = NEW.contract_id;
  UPDATE contracts SET montant_actuel = montant_initial + v_net, updated_at = NOW() WHERE id = NEW.contract_id;
  UPDATE tenders SET montant_avenants_cumule = COALESCE((SELECT SUM(GREATEST(a.montant_avenant, 0)) FROM contract_amendments a WHERE a.tender_id = v_c.tender_id), 0) + GREATEST(NEW.montant_avenant, 0)
   WHERE id = v_c.tender_id;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION check_subcontractor_limit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_c contracts%ROWTYPE; v_plafond NUMERIC; v_total BIGINT;
BEGIN
  SELECT * INTO v_c FROM contracts WHERE id = NEW.contract_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTRACT_NOT_FOUND'; END IF;
  IF v_c.status <> 'ACTIF' OR tender_phase_of(v_c.tender_id) <> 'PHASE_13_EXECUTION' THEN
    RAISE EXCEPTION 'SUBCONTRACT_INVALID: sous-traitance possible uniquement sur un contrat actif en phase d''exécution';
  END IF;
  NEW.tender_id := v_c.tender_id; NEW.institution_id := v_c.institution_id;
  v_plafond := config_num('SOUSTRAITANCE_PLAFOND', 0.40);
  SELECT COALESCE(SUM(montant), 0) + NEW.montant INTO v_total FROM subcontractors WHERE contract_id = NEW.contract_id;
  NEW.pourcentage := ROUND(v_total::numeric * 100 / v_c.montant_initial, 2);
  NEW.depasse_seuil := false;
  IF v_total > v_c.montant_initial * v_plafond THEN
    RAISE EXCEPTION 'SUBCONTRACTOR_LIMIT_EXCEEDED: la sous-traitance (% %%) dépasse le plafond légal de % %% du montant du marché',
      NEW.pourcentage, (v_plafond * 100)::int;
  END IF;
  UPDATE tenders SET montant_soustrait_cumule = COALESCE((SELECT SUM(sc.montant) FROM subcontractors sc WHERE sc.tender_id = v_c.tender_id), 0) + NEW.montant
   WHERE id = v_c.tender_id;
  RETURN NEW;
END $$;

-- Trace d'une tentative bloquée (la ligne d'audit ne peut pas être écrite dans la transaction annulée).
-- La base revérifie elle-même le dépassement avant d'écrire : impossible de polluer le journal à volonté.
CREATE OR REPLACE FUNCTION record_blocked_attempt(p_kind TEXT, p_contract UUID, p_montant BIGINT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_c contracts%ROWTYPE; v_cumul BIGINT; v_plafond NUMERIC;
BEGIN
  SELECT * INTO v_c FROM contracts WHERE id = p_contract;
  IF NOT FOUND OR v_c.institution_id IS DISTINCT FROM current_institution_id()
     OR current_user_role() NOT IN ('PRM', 'CPM') THEN RETURN false; END IF;
  IF p_kind = 'AVENANT' THEN
    v_plafond := config_num('AVENANT_PLAFOND', 0.30);
    SELECT COALESCE(SUM(GREATEST(montant_avenant, 0)), 0) + GREATEST(p_montant, 0) INTO v_cumul FROM contract_amendments WHERE contract_id = p_contract;
  ELSIF p_kind = 'SOUS_TRAITANCE' THEN
    v_plafond := config_num('SOUSTRAITANCE_PLAFOND', 0.40);
    SELECT COALESCE(SUM(montant), 0) + p_montant INTO v_cumul FROM subcontractors WHERE contract_id = p_contract;
  ELSE RETURN false; END IF;
  IF v_cumul <= v_c.montant_initial * v_plafond THEN RETURN false; END IF;
  PERFORM write_audit(p_kind || '_SEUIL_DEPASSE', 'contract', p_contract, v_c.institution_id, NULL,
    jsonb_build_object('montant_tente', p_montant, 'cumul_resultant', v_cumul, 'montant_initial', v_c.montant_initial, 'plafond', v_plafond));
  RETURN true;
END $$;
GRANT EXECUTE ON FUNCTION record_blocked_attempt(TEXT, UUID, BIGINT) TO authenticated;

CREATE POLICY "amendments_select" ON contract_amendments FOR SELECT USING (
  is_inst_staff(institution_id) OR is_regulateur() OR current_user_role() = 'COUR_COMPTES' OR is_contract_holder(contract_id));
CREATE POLICY "amendments_insert" ON contract_amendments FOR INSERT WITH CHECK (
  institution_id = current_institution_id() AND current_user_role() = 'PRM');
CREATE POLICY "subcontractors_select" ON subcontractors FOR SELECT USING (
  is_inst_staff(institution_id) OR is_regulateur() OR current_user_role() = 'COUR_COMPTES' OR is_contract_holder(contract_id));
CREATE POLICY "subcontractors_insert" ON subcontractors FOR INSERT WITH CHECK (
  institution_id = current_institution_id() AND current_user_role() IN ('PRM', 'CPM'));
REVOKE UPDATE, DELETE ON contract_amendments, subcontractors FROM anon, authenticated;

-- ------------------------------------------
-- 6. QUOTAS PME / ESS (5 % dont 2 % PME féminines) — idempotent et recalculé
-- ------------------------------------------
DROP TRIGGER IF EXISTS trig_update_pme_quotas ON tenders;
DROP FUNCTION IF EXISTS update_pme_quotas();

CREATE TABLE pme_quota_entries (
  tender_id UUID NOT NULL REFERENCES tenders(id),
  lot_key UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',   -- lot (ou marché entier)
  institution_id UUID NOT NULL REFERENCES institutions(id),
  annee_fiscale INTEGER NOT NULL,
  montant BIGINT NOT NULL,
  is_pme_ess BOOLEAN NOT NULL,
  is_pme_feminine BOOLEAN NOT NULL,
  PRIMARY KEY (tender_id, lot_key)
);
ALTER TABLE pme_quota_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pme_entries_select" ON pme_quota_entries FOR SELECT USING (is_inst_staff(institution_id) OR is_regulateur() OR current_user_role() = 'COUR_COMPTES');
CREATE POLICY "pme_quotas_select" ON pme_quotas_tracking FOR SELECT USING (is_inst_staff(institution_id) OR is_regulateur() OR current_user_role() = 'COUR_COMPTES');

CREATE OR REPLACE FUNCTION record_pme_quota()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_u users%ROWTYPE; v_year INTEGER; v_total BIGINT; v_pme BIGINT; v_fem BIGINT; l RECORD;
BEGIN
  IF NEW.current_phase = 'PHASE_11_ATTRIBUTION_DEFINITIVE' AND OLD.current_phase <> 'PHASE_11_ATTRIBUTION_DEFINITIVE'
     AND (NEW.attributaire_id IS NOT NULL OR NEW.is_alloti) THEN
    v_year := EXTRACT(YEAR FROM COALESCE(NEW.date_attribution_definitive, NOW()))::int;
    IF NEW.is_alloti THEN
      FOR l IN SELECT tl.id, tl.montant_attribue, u.is_pme, u.is_ess, u.is_pme_feminine FROM tender_lots tl JOIN users u ON u.id = tl.attributaire_id
               WHERE tl.tender_id = NEW.id AND tl.statut = 'ATTRIBUE' LOOP
        INSERT INTO pme_quota_entries (tender_id, lot_key, institution_id, annee_fiscale, montant, is_pme_ess, is_pme_feminine)
        VALUES (NEW.id, l.id, NEW.institution_id, v_year, COALESCE(l.montant_attribue, 0), l.is_pme OR l.is_ess, l.is_pme_feminine)
        ON CONFLICT (tender_id, lot_key) DO NOTHING;
      END LOOP;
    ELSE
      SELECT * INTO v_u FROM users WHERE id = NEW.attributaire_id;
      INSERT INTO pme_quota_entries (tender_id, institution_id, annee_fiscale, montant, is_pme_ess, is_pme_feminine)
      VALUES (NEW.id, NEW.institution_id, v_year, COALESCE(NEW.montant_attribue, 0), v_u.is_pme OR v_u.is_ess, v_u.is_pme_feminine)
      ON CONFLICT (tender_id, lot_key) DO NOTHING;
    END IF;

    SELECT COALESCE(SUM(montant), 0), COALESCE(SUM(montant) FILTER (WHERE is_pme_ess), 0), COALESCE(SUM(montant) FILTER (WHERE is_pme_feminine), 0)
      INTO v_total, v_pme, v_fem FROM pme_quota_entries WHERE institution_id = NEW.institution_id AND annee_fiscale = v_year;
    INSERT INTO pme_quotas_tracking (institution_id, annee_fiscale, montant_total_marches, montant_pme, montant_pme_feminine, taux_pme, taux_pme_feminine)
    VALUES (NEW.institution_id, v_year, v_total, v_pme, v_fem,
            CASE WHEN v_total > 0 THEN round(100.0 * v_pme / v_total, 2) ELSE 0 END,
            CASE WHEN v_total > 0 THEN round(100.0 * v_fem / v_total, 2) ELSE 0 END)
    ON CONFLICT (institution_id, annee_fiscale) DO UPDATE SET
      montant_total_marches = EXCLUDED.montant_total_marches, montant_pme = EXCLUDED.montant_pme,
      montant_pme_feminine = EXCLUDED.montant_pme_feminine, taux_pme = EXCLUDED.taux_pme,
      taux_pme_feminine = EXCLUDED.taux_pme_feminine, updated_at = NOW();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trig_record_pme_quota AFTER UPDATE OF current_phase ON tenders FOR EACH ROW EXECUTE FUNCTION record_pme_quota();

-- ------------------------------------------
-- 7. ARCHIVAGE (Phase 15) : inventaire signé par empreinte, marché figé
-- ------------------------------------------
INSERT INTO config_seuils (cle, valeur, description) VALUES
  ('ARCHIVAGE_DUREE_ANS', '10', 'Durée légale de conservation des dossiers clos (années) — à confirmer avec les textes d''archivage')
ON CONFLICT (cle) DO NOTHING;

CREATE OR REPLACE FUNCTION archive_tender(p_tender UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_t tenders%ROWTYPE; v_manifest JSONB; v_id UUID; v_head TEXT;
BEGIN
  SELECT * INTO v_t FROM tenders WHERE id = p_tender;
  IF NOT FOUND OR v_t.institution_id IS DISTINCT FROM current_institution_id() OR current_user_role() NOT IN ('CPM', 'PRM', 'ADMIN') THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF v_t.current_phase <> 'PHASE_15_CLOTURE_ARCHIVAGE' OR v_t.closed_at IS NULL THEN RAISE EXCEPTION 'INVALID_PHASE: le marché doit être clos (phase 15)'; END IF;
  IF EXISTS (SELECT 1 FROM archives WHERE tender_id = p_tender) THEN RAISE EXCEPTION 'ALREADY_ARCHIVED'; END IF;
  IF v_t.issue IS DISTINCT FROM 'INFRUCTUEUX' AND EXISTS (SELECT 1 FROM contracts c WHERE c.tender_id = p_tender AND NOT EXISTS (SELECT 1 FROM provider_evaluations pe WHERE pe.contract_id = c.id)) THEN
    RAISE EXCEPTION 'PROVIDER_EVALUATION_REQUIRED: l''évaluation du prestataire est requise avant archivage';
  END IF;

  v_manifest := jsonb_build_object(
    'reference', v_t.reference, 'closed_at', v_t.closed_at, 'phase_history', v_t.phase_history,
    'documents', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'type', d.type, 'titre', d.titre, 'file_hash', d.file_hash,
                   'content_hash', encode(digest(d.contenu::text, 'sha256'), 'hex')) ORDER BY d.created_at) FROM tender_documents d WHERE d.tender_id = p_tender), '[]'),
    'offres', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'status', b.status, 'technique_hash', b.fichier_technique_hash,
                   'financier_hash', b.fichier_financier_hash, 'submitted_at', b.submitted_at) ORDER BY b.submitted_at) FROM bids b WHERE b.tender_id = p_tender), '[]'),
    'avis', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'type', r.type, 'decision', r.decision, 'at', r.created_at) ORDER BY r.created_at) FROM dcmp_reviews r WHERE r.tender_id = p_tender), '[]'),
    'contrats', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'lot_id', c.lot_id, 'montant_initial', c.montant_initial, 'montant_actuel', c.montant_actuel)) FROM contracts c WHERE c.tender_id = p_tender), '[]'),
    'paiements', (SELECT jsonb_build_object('nb', COUNT(*), 'total_paye', COALESCE(SUM(montant) FILTER (WHERE statut = 'PAYE'), 0)) FROM payment_statements WHERE tender_id = p_tender));
  SELECT row_hash INTO v_head FROM audit_logs WHERE institution_id = v_t.institution_id ORDER BY seq DESC LIMIT 1;

  INSERT INTO archives (tender_id, institution_id, archived_by, manifest, manifest_hash, audit_head_hash, retention_until)
  VALUES (p_tender, v_t.institution_id, auth.uid(), v_manifest, encode(digest(v_manifest::text, 'sha256'), 'hex'), v_head,
          (CURRENT_DATE + make_interval(years => config_num('ARCHIVAGE_DUREE_ANS', 10)::int))::date)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION archive_tender(UUID) TO authenticated;

-- ------------------------------------------
-- 8. CONTRÔLE GLOBAL : toute table publique a la RLS activée
-- ------------------------------------------
DO $$
DECLARE t RECORD;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity LOOP
    RAISE EXCEPTION 'RLS_MISSING: la table public.% n''a pas de Row Level Security', t.relname;
  END LOOP;
END $$;
