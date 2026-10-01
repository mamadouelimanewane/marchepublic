-- ==========================================
-- Migration 0015 : Transparence et intégrité de référence mondiale
--   1. Publication OCDS 1.1 (Open Contracting Data Standard) — fonction + paquets de releases
--   2. Portail public : vues à publicité graduée (rien avant l'attribution provisoire)
--   3. Moteur d'alertes de risque (red flags) + suivi des examens
--   4. Signalements citoyens (anonymes, avec code de suivi)
--   5. Ancrage du journal d'audit : empreintes de tête publiées, vérifiables hors plateforme
-- ==========================================

INSERT INTO config_seuils (cle, valeur, description) VALUES
  ('OCDS_PREFIX', 'ocds-sn', 'Préfixe des identifiants OCDS (ocid) — à remplacer par le préfixe officiel obtenu auprès de l''Open Contracting Partnership'),
  ('RF_DELAI_COURT_JOURS', '14', 'Alerte « délai de dépôt court » sous ce nombre de jours (hors DRP et entente directe)'),
  ('RF_ECART_PRIX_PCT', '10', 'Alerte « prix attribué supérieur à l''estimation » au-delà de ce pourcentage'),
  ('RF_GAGNANT_RECURRENT', '3', 'Alerte « gagnant récurrent » : nombre d''attributions par institution sur 12 mois'),
  ('RF_NOUVEAU_FOURNISSEUR_JOURS', '90', 'Alerte « nouveau fournisseur » : compte créé moins de N jours avant la date limite de dépôt')
ON CONFLICT (cle) DO NOTHING;

-- ------------------------------------------
-- 1. OCDS
-- ------------------------------------------
CREATE OR REPLACE FUNCTION ocds_ts(p TIMESTAMPTZ) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT to_char(p AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
$$;
-- Date de release avec microsecondes : sert aussi de curseur de pagination exact (sans doublon ni trou).
CREATE OR REPLACE FUNCTION ocds_ts_us(p TIMESTAMPTZ) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT to_char(p AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
$$;
CREATE OR REPLACE FUNCTION ocds_money(p NUMERIC) RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('amount', p, 'currency', 'XOF')
$$;
CREATE OR REPLACE FUNCTION ocds_party_id(p_ninea TEXT, p_id UUID) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_ninea IS NOT NULL AND p_ninea <> '' THEN 'SN-NINEA-' || p_ninea ELSE 'SN-USR-' || left(p_id::text, 8) END
$$;

-- Publicité graduée (cohérente avec le principe « chacun voit tout » une fois la procédure jugée) :
--   phase ≥ 5 : avis, calendrier, lots ; phase ≥ 10 : candidats, montants, attributaires ; phase ≥ 12 : contrat, avenants, paiements.
CREATE OR REPLACE FUNCTION ocds_release(p_tender UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp SET row_security = off AS $$
DECLARE
  v_t tenders%ROWTYPE; v_i institutions%ROWTYPE; v_ocid TEXT; v_pub BOOLEAN; v_status TEXT;
  v_parties JSONB := '[]'; v_tenderers JSONB := '[]'; v_awards JSONB := '[]'; v_contracts JSONB := '[]'; v_lots JSONB := '[]';
  v_tags JSONB := '["tender"]'; v_buyer JSONB; r RECORD; c RECORD; v_tx JSONB; v_am JSONB; v_award_id TEXT;
BEGIN
  SELECT * INTO v_t FROM tenders WHERE id = p_tender;
  IF NOT FOUND OR v_t.date_publication IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_i FROM institutions WHERE id = v_t.institution_id;
  v_ocid := COALESCE((SELECT valeur FROM config_seuils WHERE cle = 'OCDS_PREFIX'), 'ocds-sn') || '-' || v_t.reference;
  v_pub := v_t.current_phase >= 'PHASE_10_RECOURS';
  v_buyer := jsonb_build_object('id', 'SN-INST-' || v_i.code, 'name', v_i.name);
  v_parties := jsonb_build_array(v_buyer || jsonb_build_object('roles', jsonb_build_array('buyer')));

  IF v_pub THEN
    FOR r IN SELECT DISTINCT u.id, u.full_name, u.ninea FROM bids b JOIN users u ON u.id = b.soumissionnaire_id
             WHERE b.tender_id = p_tender AND b.status NOT IN ('RETARDEE', 'RETIREE', 'BROUILLON') ORDER BY u.full_name LOOP
      v_tenderers := v_tenderers || jsonb_build_array(jsonb_build_object('id', ocds_party_id(r.ninea, r.id), 'name', r.full_name));
      v_parties := v_parties || jsonb_build_array(jsonb_build_object('id', ocds_party_id(r.ninea, r.id), 'name', r.full_name,
        'roles', CASE WHEN EXISTS (SELECT 1 FROM tender_lots l WHERE l.tender_id = p_tender AND l.attributaire_id = r.id AND l.statut = 'ATTRIBUE')
                        OR v_t.attributaire_id = r.id THEN jsonb_build_array('tenderer', 'supplier') ELSE jsonb_build_array('tenderer') END));
    END LOOP;
  END IF;

  IF v_t.is_alloti THEN
    FOR r IN SELECT * FROM tender_lots WHERE tender_id = p_tender ORDER BY numero_lot LOOP
      v_lots := v_lots || jsonb_build_array(jsonb_build_object('id', r.id, 'title', r.libelle, 'description', r.description,
        'value', CASE WHEN r.montant_estime IS NOT NULL THEN ocds_money(r.montant_estime) END,
        'status', CASE WHEN r.statut = 'INFRUCTUEUX' THEN 'unsuccessful' WHEN v_pub THEN 'complete' ELSE 'active' END));
    END LOOP;
  END IF;

  -- Attributions
  IF v_pub AND v_t.issue IS DISTINCT FROM 'INFRUCTUEUX' THEN
    IF v_t.is_alloti THEN
      FOR r IN SELECT l.id, l.libelle, l.montant_attribue, u.id AS uid, u.full_name, u.ninea FROM tender_lots l JOIN users u ON u.id = l.attributaire_id
               WHERE l.tender_id = p_tender AND l.statut = 'ATTRIBUE' ORDER BY l.numero_lot LOOP
        v_awards := v_awards || jsonb_build_array(jsonb_build_object('id', 'award-' || r.id, 'title', r.libelle,
          'status', CASE WHEN v_t.current_phase >= 'PHASE_11_ATTRIBUTION_DEFINITIVE' THEN 'active' ELSE 'pending' END,
          'date', ocds_ts(v_t.date_attribution_provisoire), 'value', ocds_money(r.montant_attribue), 'relatedLots', jsonb_build_array(r.id::text),
          'suppliers', jsonb_build_array(jsonb_build_object('id', ocds_party_id(r.ninea, r.uid), 'name', r.full_name))));
      END LOOP;
    ELSIF v_t.attributaire_id IS NOT NULL THEN
      SELECT * INTO r FROM users WHERE id = v_t.attributaire_id;
      v_awards := jsonb_build_array(jsonb_build_object('id', 'award-' || v_t.id, 'title', v_t.title,
        'status', CASE WHEN v_t.current_phase >= 'PHASE_11_ATTRIBUTION_DEFINITIVE' THEN 'active' ELSE 'pending' END,
        'date', ocds_ts(v_t.date_attribution_provisoire), 'value', ocds_money(v_t.montant_attribue),
        'suppliers', jsonb_build_array(jsonb_build_object('id', ocds_party_id(r.ninea, r.id), 'name', r.full_name))));
    END IF;
    IF jsonb_array_length(v_awards) > 0 THEN v_tags := v_tags || '["award"]'::jsonb; END IF;
  END IF;

  -- Contrats, avenants, paiements (phase ≥ 12)
  IF v_t.current_phase >= 'PHASE_12_SIGNATURE_CONTRAT' THEN
    FOR c IN SELECT * FROM contracts WHERE tender_id = p_tender ORDER BY created_at LOOP
      v_award_id := CASE WHEN c.lot_id IS NOT NULL THEN 'award-' || c.lot_id ELSE 'award-' || v_t.id END;
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id', a.id::text, 'date', ocds_ts(COALESCE(a.valide_le, a.created_at)), 'rationale', a.motif,
               'description', 'Avenant n°' || a.numero_avenant || ' : ' || a.montant_avenant || ' XOF') ORDER BY a.numero_avenant), '[]')
        INTO v_am FROM contract_amendments a WHERE a.contract_id = c.id;
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id', p.id::text, 'date', ocds_ts(p.date_paiement), 'value', ocds_money(p.montant)) ORDER BY p.numero), '[]')
        INTO v_tx FROM payment_statements p WHERE p.contract_id = c.id AND p.statut = 'PAYE';
      v_contracts := v_contracts || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'id', 'contract-' || c.id, 'awardID', v_award_id, 'title', v_t.title,
        'status', CASE c.status WHEN 'RESILIE' THEN 'cancelled' WHEN 'CLOS' THEN 'terminated' WHEN 'SUSPENDU' THEN 'active'
                                ELSE CASE WHEN v_t.current_phase >= 'PHASE_13_EXECUTION' THEN 'active' ELSE 'pending' END END,
        'period', CASE WHEN c.date_debut_execution IS NOT NULL THEN jsonb_build_object('startDate', ocds_ts(c.date_debut_execution::timestamptz), 'durationInDays', c.delai_execution) END,
        'value', ocds_money(COALESCE(c.montant_actuel, c.montant_initial)),
        'dateSigned', CASE WHEN c.signed_by_ac AND c.signed_by_titulaire THEN ocds_ts(GREATEST(c.signature_ac_at, c.signature_titulaire_at)) END,
        'amendments', CASE WHEN jsonb_array_length(v_am) > 0 THEN v_am END,
        'implementation', CASE WHEN jsonb_array_length(v_tx) > 0 THEN jsonb_build_object('transactions', v_tx) END)));
      IF jsonb_array_length(v_tx) > 0 AND NOT v_tags ? 'implementation' THEN v_tags := v_tags || '["implementation"]'::jsonb; END IF;
    END LOOP;
    IF jsonb_array_length(v_contracts) > 0 THEN v_tags := v_tags || '["contract"]'::jsonb; END IF;
  END IF;

  v_status := CASE WHEN v_t.issue = 'INFRUCTUEUX' THEN 'unsuccessful' WHEN v_pub THEN 'complete' ELSE 'active' END;
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'ocid', v_ocid,
    'id', v_ocid || '-' || to_char(v_t.updated_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSUS'),
    'date', ocds_ts_us(v_t.updated_at), 'tag', v_tags, 'initiationType', 'tender', 'language', 'fr',
    'buyer', v_buyer, 'parties', v_parties,
    'planning', CASE WHEN v_t.ligne_budgetaire IS NOT NULL THEN jsonb_build_object('budget',
        jsonb_build_object('description', 'Ligne budgétaire ' || v_t.ligne_budgetaire, 'amount', ocds_money(v_t.montant_estime))) END,
    'tender', jsonb_build_object(
      'id', v_t.reference, 'title', v_t.title, 'description', v_t.description, 'status', v_status,
      'procurementMethod', CASE v_t.mode_passation WHEN 'AOR' THEN 'selective' WHEN 'DRP' THEN 'limited' WHEN 'ENTENTE_DIRECTE' THEN 'direct' ELSE 'open' END,
      'procurementMethodDetails', v_t.mode_passation,
      'mainProcurementCategory', CASE v_t.nature_marche WHEN 'TRAVAUX' THEN 'works' WHEN 'FOURNITURES' THEN 'goods'
                                   WHEN 'PRESTATIONS_INTELLECTUELLES' THEN 'consultingServices' ELSE 'services' END,
      'value', CASE WHEN v_t.montant_estime IS NOT NULL THEN ocds_money(v_t.montant_estime) END,
      'tenderPeriod', jsonb_build_object('startDate', ocds_ts(v_t.date_publication), 'endDate', ocds_ts(v_t.date_limite_depot)),
      'numberOfTenderers', CASE WHEN v_pub THEN jsonb_array_length(v_tenderers) END,
      'tenderers', CASE WHEN v_pub AND jsonb_array_length(v_tenderers) > 0 THEN v_tenderers END,
      'procuringEntity', v_buyer,
      'lots', CASE WHEN jsonb_array_length(v_lots) > 0 THEN v_lots END),
    'awards', CASE WHEN jsonb_array_length(v_awards) > 0 THEN v_awards END,
    'contracts', CASE WHEN jsonb_array_length(v_contracts) > 0 THEN v_contracts END));
END $$;

CREATE OR REPLACE FUNCTION ocds_release_package(p_uri TEXT, p_limit INTEGER DEFAULT 100, p_after TIMESTAMPTZ DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp SET row_security = off AS $$
DECLARE v_releases JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(ocds_release(x.id) ORDER BY x.updated_at), '[]') INTO v_releases
  FROM (SELECT id, updated_at FROM tenders WHERE date_publication IS NOT NULL AND (p_after IS NULL OR updated_at > p_after)
        ORDER BY updated_at LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500)) x;
  RETURN jsonb_build_object(
    'uri', p_uri, 'version', '1.1', 'publishedDate', ocds_ts(NOW()),
    'publisher', jsonb_build_object('name', 'Plateforme intégrée des marchés publics du Sénégal'),
    'license', 'https://creativecommons.org/licenses/by/4.0/', 'releases', v_releases);
END $$;
GRANT EXECUTE ON FUNCTION ocds_release(UUID), ocds_release_package(TEXT, INTEGER, TIMESTAMPTZ) TO anon, authenticated;

-- ------------------------------------------
-- 2. Portail public : vues à publicité graduée (définisseur : lisibles par anon, colonnes et lignes choisies)
-- ------------------------------------------
CREATE OR REPLACE VIEW v_public_marches WITH (security_invoker = false) AS
SELECT t.id, t.reference, t.title, i.name AS institution, t.nature_marche, t.mode_passation, t.current_phase,
       t.date_publication, t.date_limite_depot, t.montant_estime, t.is_alloti, t.issue,
       CASE WHEN t.current_phase >= 'PHASE_10_RECOURS' THEN t.montant_attribue END AS montant_attribue,
       CASE WHEN t.current_phase >= 'PHASE_10_RECOURS' THEN
         (SELECT COUNT(*)::int FROM bids b WHERE b.tender_id = t.id AND b.status NOT IN ('RETARDEE', 'RETIREE', 'BROUILLON')) END AS nb_offres
FROM tenders t JOIN institutions i ON i.id = t.institution_id
WHERE t.date_publication IS NOT NULL;

CREATE OR REPLACE VIEW v_public_offres WITH (security_invoker = false) AS
SELECT k.tender_id, l.numero_lot, u.full_name AS candidat, k.montant_offre, k.score_technique, k.score_financier, k.score_global, k.rang, k.qualifie,
       (b.status IN ('PROVISOIREMENT_RETENUE', 'RETENUE_DEFINITIVE')) AS retenue
FROM bid_rankings k
JOIN tenders t ON t.id = k.tender_id AND k.round = t.evaluation_round
JOIN bids b ON b.id = k.bid_id JOIN users u ON u.id = b.soumissionnaire_id
LEFT JOIN tender_lots l ON l.id = k.lot_id
WHERE t.current_phase >= 'PHASE_10_RECOURS' AND t.date_publication IS NOT NULL;

CREATE OR REPLACE VIEW v_public_contrats WITH (security_invoker = false) AS
SELECT c.tender_id, l.numero_lot, u.full_name AS titulaire, c.montant_initial, COALESCE(c.montant_actuel, c.montant_initial) AS montant_actuel,
       COALESCE((SELECT SUM(GREATEST(a.montant_avenant, 0)) FROM contract_amendments a WHERE a.contract_id = c.id), 0)::bigint AS avenants_cumules,
       COALESCE((SELECT SUM(p.montant) FROM payment_statements p WHERE p.contract_id = c.id AND p.statut = 'PAYE'), 0)::bigint AS montant_paye,
       c.status, CASE WHEN c.signed_by_ac AND c.signed_by_titulaire THEN GREATEST(c.signature_ac_at, c.signature_titulaire_at) END AS date_signature
FROM contracts c JOIN tenders t ON t.id = c.tender_id JOIN users u ON u.id = c.attributaire_id LEFT JOIN tender_lots l ON l.id = c.lot_id
WHERE t.current_phase >= 'PHASE_12_SIGNATURE_CONTRAT' AND t.date_publication IS NOT NULL;
GRANT SELECT ON v_public_marches, v_public_offres, v_public_contrats TO anon, authenticated;

-- ------------------------------------------
-- 3. Alertes de risque (inspirées de Prozorro/DOZORRO et des « red flags » de l'Open Contracting Partnership)
-- ------------------------------------------
CREATE OR REPLACE VIEW v_red_flags WITH (security_invoker = true) AS
WITH valid_bids AS (
  SELECT tender_id, lot_id, COUNT(*)::int AS n FROM bids WHERE status NOT IN ('RETARDEE', 'RETIREE', 'BROUILLON') GROUP BY tender_id, lot_id
), winners AS (
  SELECT t.id AS tender_id, t.institution_id, t.attributaire_id AS winner, t.date_attribution_provisoire AS at FROM tenders t
   WHERE NOT t.is_alloti AND t.attributaire_id IS NOT NULL AND t.current_phase >= 'PHASE_10_RECOURS'
  UNION ALL
  SELECT l.tender_id, l.institution_id, l.attributaire_id, t.date_attribution_provisoire FROM tender_lots l JOIN tenders t ON t.id = l.tender_id
   WHERE l.statut = 'ATTRIBUE' AND l.attributaire_id IS NOT NULL AND t.current_phase >= 'PHASE_10_RECOURS'
), recurring AS (
  SELECT institution_id, winner FROM winners WHERE at > NOW() - INTERVAL '365 days'
   GROUP BY institution_id, winner HAVING COUNT(DISTINCT tender_id) >= config_num('RF_GAGNANT_RECURRENT', 3)
)
SELECT t.institution_id, t.id AS tender_id, t.reference, 'OFFRE_UNIQUE'::text AS flag, 2 AS severite,
       'Une seule offre recevable' || COALESCE(' (lot ' || l.numero_lot || ')', '') AS detail
  FROM tenders t JOIN valid_bids vb ON vb.tender_id = t.id AND vb.n = 1 LEFT JOIN tender_lots l ON l.id = vb.lot_id
 WHERE t.current_phase >= 'PHASE_8_EVALUATION' AND t.mode_passation IS DISTINCT FROM 'ENTENTE_DIRECTE'
UNION ALL
SELECT t.institution_id, t.id, t.reference, 'DELAI_COURT', 2,
       'Délai de dépôt de ' || ROUND(EXTRACT(EPOCH FROM (t.date_limite_depot - t.date_publication)) / 86400.0, 1) || ' jours'
  FROM tenders t WHERE t.date_publication IS NOT NULL AND t.date_limite_depot IS NOT NULL
   AND t.mode_passation NOT IN ('DRP', 'ENTENTE_DIRECTE')
   AND t.date_limite_depot - t.date_publication < make_interval(days => config_num('RF_DELAI_COURT_JOURS', 14)::int)
UNION ALL
SELECT t.institution_id, t.id, t.reference, 'ATTRIBUTION_HORS_CLASSEMENT', 3, 'Attribution à une offre autre que la mieux classée'
  FROM tenders t WHERE EXISTS (SELECT 1 FROM audit_logs a WHERE a.action = 'AWARD_OVERRIDE_RANKING' AND a.entity_id = t.id)
UNION ALL
SELECT t.institution_id, t.id, t.reference, 'PRIX_SUPERIEUR_ESTIMATION', 2,
       'Montant attribué ' || t.montant_attribue || ' XOF pour une estimation de ' || t.montant_estime || ' XOF'
  FROM tenders t WHERE t.current_phase >= 'PHASE_10_RECOURS' AND t.montant_attribue > t.montant_estime * (1 + config_num('RF_ECART_PRIX_PCT', 10) / 100.0)
UNION ALL
SELECT t.institution_id, t.id, t.reference, 'ENTENTE_DIRECTE', 1, 'Marché passé par entente directe (dérogation)'
  FROM tenders t WHERE t.mode_passation = 'ENTENTE_DIRECTE' AND t.current_phase >= 'PHASE_4_PUBLICATION'
UNION ALL
SELECT c.institution_id, c.tender_id, t.reference, 'AVENANTS_PROCHES_PLAFOND', 2,
       'Avenants cumulés : ' || ROUND(100.0 * SUM(GREATEST(a.montant_avenant, 0)) / c.montant_initial, 1) || ' % du montant initial'
  FROM contracts c JOIN tenders t ON t.id = c.tender_id JOIN contract_amendments a ON a.contract_id = c.id
 GROUP BY c.id, c.institution_id, c.tender_id, t.reference, c.montant_initial
HAVING SUM(GREATEST(a.montant_avenant, 0)) >= 0.8 * config_num('AVENANT_PLAFOND', 0.30) * c.montant_initial
UNION ALL
SELECT DISTINCT w.institution_id, w.tender_id, t.reference, 'GAGNANT_RECURRENT', 2, 'Le même attributaire cumule les attributions de cette autorité sur 12 mois'
  FROM winners w JOIN recurring rc ON rc.institution_id = w.institution_id AND rc.winner = w.winner JOIN tenders t ON t.id = w.tender_id
UNION ALL
SELECT DISTINCT w.institution_id, w.tender_id, t.reference, 'NOUVEAU_FOURNISSEUR', 1, 'Attributaire dont le compte a été créé peu avant la date limite de dépôt'
  FROM winners w JOIN tenders t ON t.id = w.tender_id JOIN users u ON u.id = w.winner
 WHERE t.date_limite_depot IS NOT NULL AND u.created_at > t.date_limite_depot - make_interval(days => config_num('RF_NOUVEAU_FOURNISSEUR_JOURS', 90)::int)
UNION ALL
SELECT DISTINCT a.institution_id, a.tender_id, t.reference, 'RECOURS_FAVORABLE', 2, 'Un recours a été jugé favorable au requérant'
  FROM appeals a JOIN tenders t ON t.id = a.tender_id WHERE a.status IN ('FAVORABLE', 'PARTIELLEMENT_FAVORABLE');

CREATE OR REPLACE VIEW v_risk_scores WITH (security_invoker = true) AS
SELECT institution_id, tender_id, reference, SUM(severite)::int AS score, COUNT(*)::int AS nb_alertes,
       array_agg(flag ORDER BY severite DESC, flag) AS alertes
FROM v_red_flags GROUP BY institution_id, tender_id, reference;
GRANT SELECT ON v_red_flags, v_risk_scores TO authenticated;
REVOKE ALL ON v_red_flags, v_risk_scores FROM anon;

-- Suivi des examens (boucle de rétroaction : sans elle, un indicateur n'apprend jamais s'il avait raison)
CREATE TABLE red_flag_reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tender_id UUID NOT NULL REFERENCES tenders(id),
  institution_id UUID NOT NULL REFERENCES institutions(id),
  flag TEXT NOT NULL,
  statut TEXT NOT NULL CHECK (statut IN ('A_EXAMINER', 'EXPLICATION', 'JUSTIFIE', 'CONFIRME')),
  note TEXT NOT NULL CHECK (char_length(note) >= 10),
  reviewer_id UUID NOT NULL REFERENCES users(id),
  reviewer_role TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_rf_reviews ON red_flag_reviews (tender_id, flag, created_at DESC);
CREATE TRIGGER trig_rf_reviews_immutable BEFORE UPDATE OR DELETE ON red_flag_reviews FOR EACH ROW EXECUTE FUNCTION block_update_delete();
ALTER TABLE red_flag_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rf_reviews_select" ON red_flag_reviews FOR SELECT USING (
  is_regulateur() OR current_user_role() = 'COUR_COMPTES' OR (institution_id = current_institution_id() AND current_user_role() IN ('PRM', 'CPM')));
REVOKE INSERT ON red_flag_reviews FROM anon, authenticated;
CREATE TRIGGER trig_audit_red_flag_reviews AFTER INSERT ON red_flag_reviews FOR EACH ROW EXECUTE FUNCTION audit_row_change();

-- Les régulateurs qualifient ; l'autorité contractante (PRM) ne peut qu'apporter son explication.
CREATE OR REPLACE FUNCTION review_red_flag(p_tender UUID, p_flag TEXT, p_statut TEXT, p_note TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role TEXT := current_user_role(); v_inst UUID; v_id UUID;
BEGIN
  SELECT institution_id INTO v_inst FROM tenders WHERE id = p_tender;
  IF NOT FOUND THEN RAISE EXCEPTION 'TENDER_NOT_FOUND'; END IF;
  IF v_role IN ('DCMP', 'ARCOP', 'COUR_COMPTES') THEN
    NULL;
  ELSIF v_role = 'PRM' AND v_inst = current_institution_id() AND p_statut = 'EXPLICATION' THEN
    NULL;
  ELSE RAISE EXCEPTION 'FORBIDDEN: qualification réservée aux régulateurs ; l''autorité contractante peut seulement fournir une explication'; END IF;
  IF NOT EXISTS (SELECT 1 FROM v_red_flags f WHERE f.tender_id = p_tender AND f.flag = p_flag)
     AND NOT EXISTS (SELECT 1 FROM red_flag_reviews r WHERE r.tender_id = p_tender AND r.flag = p_flag) THEN
    RAISE EXCEPTION 'FLAG_UNKNOWN: aucune alerte % sur ce marché', p_flag;
  END IF;
  INSERT INTO red_flag_reviews (tender_id, institution_id, flag, statut, note, reviewer_id, reviewer_role)
  VALUES (p_tender, v_inst, p_flag, p_statut, p_note, auth.uid(), v_role) RETURNING id INTO v_id;
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION review_red_flag(UUID, TEXT, TEXT, TEXT) TO authenticated;

-- ------------------------------------------
-- 4. Signalements citoyens
-- ------------------------------------------
CREATE TABLE citizen_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code_suivi TEXT NOT NULL UNIQUE,
  tender_id UUID REFERENCES tenders(id),
  reference_texte TEXT,
  categorie TEXT NOT NULL CHECK (categorie IN ('CORRUPTION', 'FAVORITISME', 'CONFLIT_INTERETS', 'EXECUTION_NON_CONFORME', 'ACCES_ENTRAVE', 'AUTRE')),
  description TEXT NOT NULL CHECK (char_length(description) BETWEEN 30 AND 4000),
  contact TEXT CHECK (contact IS NULL OR char_length(contact) <= 200),
  statut TEXT NOT NULL DEFAULT 'RECU' CHECK (statut IN ('RECU', 'EN_EXAMEN', 'TRANSMIS', 'CLOS_SANS_SUITE')),
  note_interne TEXT,
  traite_par UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_citizen_reports_tender ON citizen_reports (tender_id, created_at DESC);
ALTER TABLE citizen_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "citizen_reports_regulators" ON citizen_reports FOR SELECT USING (is_regulateur() OR current_user_role() = 'COUR_COMPTES');
REVOKE INSERT, UPDATE, DELETE ON citizen_reports FROM anon, authenticated;
CREATE TRIGGER trig_audit_citizen_reports AFTER INSERT OR UPDATE ON citizen_reports FOR EACH ROW EXECUTE FUNCTION audit_row_change();

-- Dépôt anonyme possible ; débit limité par la base (par marché et global) pour éviter le noyage par du bruit.
CREATE OR REPLACE FUNCTION submit_citizen_report(p_tender UUID, p_reference TEXT, p_categorie TEXT, p_description TEXT, p_contact TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_code TEXT; v_tender UUID := p_tender;
BEGIN
  IF p_tender IS NULL AND COALESCE(p_reference, '') <> '' THEN
    SELECT id INTO v_tender FROM tenders WHERE reference = upper(trim(p_reference)) AND date_publication IS NOT NULL;
  ELSIF p_tender IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tenders WHERE id = p_tender AND date_publication IS NOT NULL) THEN
    v_tender := NULL;
  END IF;
  IF (SELECT COUNT(*) FROM citizen_reports WHERE created_at > NOW() - INTERVAL '1 hour') >= 300
     OR (v_tender IS NOT NULL AND (SELECT COUNT(*) FROM citizen_reports WHERE tender_id = v_tender AND created_at > NOW() - INTERVAL '1 hour') >= 20) THEN
    RAISE EXCEPTION 'RATE_LIMITED: trop de signalements, réessayez plus tard';
  END IF;
  v_code := upper(encode(gen_random_bytes(5), 'hex'));
  INSERT INTO citizen_reports (code_suivi, tender_id, reference_texte, categorie, description, contact)
  VALUES (v_code, v_tender, NULLIF(trim(p_reference), ''), p_categorie, trim(p_description), NULLIF(trim(p_contact), ''));
  RETURN jsonb_build_object('ok', true, 'code_suivi', v_code, 'marche_identifie', v_tender IS NOT NULL);
END $$;

-- Le déclarant suit l'état de son signalement avec son code (aucune autre donnée n'est restituée).
CREATE OR REPLACE FUNCTION citizen_report_status(p_code TEXT)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('statut', statut, 'recu_le', created_at, 'mis_a_jour_le', updated_at) FROM citizen_reports WHERE code_suivi = upper(trim(p_code))
$$;
GRANT EXECUTE ON FUNCTION submit_citizen_report(UUID, TEXT, TEXT, TEXT, TEXT), citizen_report_status(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION handle_citizen_report(p_report UUID, p_statut TEXT, p_note TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user_role() NOT IN ('DCMP', 'ARCOP', 'COUR_COMPTES') THEN RAISE EXCEPTION 'FORBIDDEN: réservé aux régulateurs'; END IF;
  IF p_statut NOT IN ('EN_EXAMEN', 'TRANSMIS', 'CLOS_SANS_SUITE') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  IF p_statut = 'CLOS_SANS_SUITE' AND char_length(COALESCE(p_note, '')) < 10 THEN RAISE EXCEPTION 'MOTIVATION_REQUIRED: motif de clôture obligatoire'; END IF;
  UPDATE citizen_reports SET statut = p_statut, note_interne = COALESCE(p_note, note_interne), traite_par = auth.uid(), updated_at = NOW() WHERE id = p_report;
  IF NOT FOUND THEN RAISE EXCEPTION 'REPORT_NOT_FOUND'; END IF;
END $$;
GRANT EXECUTE ON FUNCTION handle_citizen_report(UUID, TEXT, TEXT) TO authenticated;

-- ------------------------------------------
-- 5. Ancrage du journal d'audit
-- Pourquoi : verify_audit_chain détecte une altération isolée, mais un attaquant maître de la base qui recalcule TOUTE la
-- chaîne resterait cohérent. Les empreintes de tête, publiées chaque jour hors de la base, rendent cette réécriture détectable.
-- ------------------------------------------
CREATE TABLE audit_anchors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  institution_id UUID REFERENCES institutions(id),
  head_seq BIGINT NOT NULL,
  head_hash TEXT NOT NULL,
  nb_entries BIGINT NOT NULL,
  anchored_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_audit_anchor ON audit_anchors (COALESCE(institution_id, '00000000-0000-0000-0000-000000000000'), head_seq);
CREATE TRIGGER trig_audit_anchors_immutable BEFORE UPDATE OR DELETE ON audit_anchors FOR EACH ROW EXECUTE FUNCTION block_update_delete();
ALTER TABLE audit_anchors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_anchors_read" ON audit_anchors FOR SELECT USING (true);
REVOKE INSERT, UPDATE, DELETE ON audit_anchors FROM anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION anchor_audit_chain()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r RECORD; n INTEGER := 0;
BEGIN
  FOR r IN SELECT DISTINCT ON (institution_id) institution_id, seq, row_hash FROM audit_logs ORDER BY institution_id, seq DESC LOOP
    IF NOT EXISTS (SELECT 1 FROM audit_anchors a WHERE a.institution_id IS NOT DISTINCT FROM r.institution_id AND a.head_seq = r.seq) THEN
      INSERT INTO audit_anchors (institution_id, head_seq, head_hash, nb_entries)
      VALUES (r.institution_id, r.seq, r.row_hash, (SELECT COUNT(*) FROM audit_logs a WHERE a.institution_id IS NOT DISTINCT FROM r.institution_id AND a.seq <= r.seq));
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION anchor_audit_chain() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION anchor_audit_chain() TO service_role;

-- Vérifie que la chaîne actuelle est toujours compatible avec chaque empreinte déjà publiée.
CREATE OR REPLACE FUNCTION verify_audit_anchors()
RETURNS TABLE (anchor_id UUID, institution_id UUID, head_seq BIGINT, reason TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user_role() NOT IN ('DCMP', 'ARCOP', 'COUR_COMPTES', 'ADMIN') AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'FORBIDDEN: vérification réservée aux régulateurs';
  END IF;
  RETURN QUERY
  SELECT a.id, a.institution_id, a.head_seq,
         CASE WHEN l.row_hash IS NULL THEN 'ENTREE_DISPARUE'
              WHEN l.row_hash <> a.head_hash THEN 'EMPREINTE_DIFFERENTE'
              ELSE 'NOMBRE_ENTREES_DIFFERENT' END
  FROM audit_anchors a
  LEFT JOIN audit_logs l ON l.seq = a.head_seq AND l.institution_id IS NOT DISTINCT FROM a.institution_id
  WHERE l.row_hash IS DISTINCT FROM a.head_hash
     OR (SELECT COUNT(*) FROM audit_logs x WHERE x.institution_id IS NOT DISTINCT FROM a.institution_id AND x.seq <= a.head_seq) <> a.nb_entries;
END $$;
GRANT EXECUTE ON FUNCTION verify_audit_anchors() TO authenticated, service_role;

CREATE OR REPLACE VIEW v_audit_anchors WITH (security_invoker = false) AS
SELECT COALESCE(i.code, 'GLOBAL') AS institution, a.head_seq, a.head_hash, a.nb_entries, a.anchored_at
FROM audit_anchors a LEFT JOIN institutions i ON i.id = a.institution_id;
GRANT SELECT ON v_audit_anchors TO anon, authenticated;
