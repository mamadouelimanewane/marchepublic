-- ==========================================
-- Migration 0022 : Recours par lot (marchés allotis)
--   • un recours vise un lot précis (appeals.lot_id) ou, sans lot, le marché entier (comportement antérieur)
--   • un candidat peut contester plusieurs lots, un recours par lot et par candidat à la fois
--   • une décision favorable sur un lot ne rouvre QUE ce lot : les autres lots gardent leur attribution
--   • le marché reste en phase 10 tant qu'un recours est pendant (une seule phase par marché) ; le verrou dur est inchangé
--   • une décision favorable n'est admise qu'en phase 10 (jamais perdue en silence pendant une réévaluation)
-- ==========================================

ALTER TABLE appeals ADD COLUMN IF NOT EXISTS lot_id UUID REFERENCES tender_lots(id);
CREATE INDEX IF NOT EXISTS idx_appeals_lot ON appeals (lot_id) WHERE lot_id IS NOT NULL;

DROP INDEX IF EXISTS uq_appeal_one_pending;
CREATE UNIQUE INDEX uq_appeal_one_pending ON appeals (tender_id, requerant_id, COALESCE(lot_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status IN ('DEPOSE', 'EN_INSTRUCTION');

-- ------------------------------------------
-- 1. Dépôt
-- ------------------------------------------
DROP FUNCTION IF EXISTS submit_appeal(UUID, TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION submit_appeal(p_tender UUID, p_motif TEXT, p_description TEXT DEFAULT NULL, p_document_path TEXT DEFAULT NULL, p_lot UUID DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE v_t tenders%ROWTYPE; v_l tender_lots%ROWTYPE; v_id UUID; r RECORD; v_ok BOOLEAN; v_scope TEXT;
BEGIN
  IF current_user_role() <> 'SOUMISSIONNAIRE' THEN RAISE EXCEPTION 'FORBIDDEN: réservé aux candidats'; END IF;
  SELECT * INTO v_t FROM tenders WHERE id = p_tender FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TENDER_NOT_FOUND'; END IF;
  IF v_t.current_phase <> 'PHASE_10_RECOURS' THEN RAISE EXCEPTION 'INVALID_PHASE: aucun délai de recours ouvert'; END IF;
  IF NOW() > v_t.date_fin_recours THEN RAISE EXCEPTION 'APPEAL_TOO_LATE: le délai de recours a expiré le %', v_t.date_fin_recours; END IF;
  IF char_length(COALESCE(p_motif, '')) < 10 THEN RAISE EXCEPTION 'MOTIVATION_REQUIRED: motif du recours obligatoire'; END IF;

  IF p_lot IS NOT NULL THEN
    IF NOT v_t.is_alloti THEN RAISE EXCEPTION 'LOT_INVALID: ce marché n''est pas alloti'; END IF;
    SELECT * INTO v_l FROM tender_lots WHERE id = p_lot AND tender_id = p_tender;
    IF NOT FOUND THEN RAISE EXCEPTION 'LOT_INVALID: ce lot n''appartient pas à ce marché'; END IF;
    IF v_l.statut <> 'ATTRIBUE' THEN RAISE EXCEPTION 'LOT_INVALID: seul un lot attribué peut faire l''objet d''un recours (lot % : %)', v_l.numero_lot, v_l.statut; END IF;
    -- Le candidat doit avoir déposé une offre recevable SUR CE LOT, et ne pas en être l'attributaire.
    SELECT EXISTS (SELECT 1 FROM bids WHERE tender_id = p_tender AND lot_id = p_lot AND soumissionnaire_id = auth.uid()
                     AND status NOT IN ('RETARDEE', 'RETIREE', 'BROUILLON', 'PROVISOIREMENT_RETENUE')) INTO v_ok;
    IF NOT v_ok THEN
      IF EXISTS (SELECT 1 FROM bids WHERE tender_id = p_tender AND lot_id = p_lot AND soumissionnaire_id = auth.uid() AND status = 'PROVISOIREMENT_RETENUE') THEN
        RAISE EXCEPTION 'FORBIDDEN: l''attributaire provisoire du lot ne peut pas contester sa propre attribution';
      END IF;
      RAISE EXCEPTION 'FORBIDDEN: seul un candidat ayant déposé une offre recevable sur le lot % peut former un recours sur ce lot', v_l.numero_lot;
    END IF;
    v_scope := 'lot ' || v_l.numero_lot;
  ELSE
    -- Marché entier (ou marché non alloti) : il suffit d'une offre recevable non retenue.
    SELECT EXISTS (SELECT 1 FROM bids WHERE tender_id = p_tender AND soumissionnaire_id = auth.uid()
                     AND status NOT IN ('RETARDEE', 'RETIREE', 'BROUILLON', 'PROVISOIREMENT_RETENUE')) INTO v_ok;
    IF NOT v_ok THEN
      IF EXISTS (SELECT 1 FROM bids WHERE tender_id = p_tender AND soumissionnaire_id = auth.uid() AND status = 'PROVISOIREMENT_RETENUE') THEN
        RAISE EXCEPTION 'FORBIDDEN: l''attributaire provisoire ne peut pas contester sa propre attribution';
      END IF;
      RAISE EXCEPTION 'FORBIDDEN: seul un candidat ayant déposé une offre recevable peut former un recours';
    END IF;
    v_scope := 'marché entier';
  END IF;

  IF EXISTS (SELECT 1 FROM appeals WHERE tender_id = p_tender AND requerant_id = auth.uid() AND lot_id IS NOT DISTINCT FROM p_lot AND status IN ('DEPOSE', 'EN_INSTRUCTION')) THEN
    RAISE EXCEPTION 'ALREADY_PENDING: vous avez déjà un recours en cours sur ce périmètre (%)', v_scope;
  END IF;

  INSERT INTO appeals (tender_id, institution_id, requerant_id, motif, description, document_path, date_limite_instruction, lot_id)
  VALUES (p_tender, v_t.institution_id, auth.uid(), p_motif, p_description, p_document_path,
          NOW() + make_interval(days => config_num('DELAI_INSTRUCTION_RECOURS_JOURS', 7)::int), p_lot)
  RETURNING id INTO v_id;
  FOR r IN SELECT id FROM users WHERE role = 'ARCOP' AND is_active LOOP
    PERFORM notify_user(r.id, p_tender, 'RECOURS_DEPOSE', 'Nouveau recours', 'Recours déposé sur ' || v_t.reference || ' (' || v_scope || ')');
  END LOOP;
  FOR r IN SELECT id FROM users WHERE institution_id = v_t.institution_id AND role IN ('PRM', 'CPM') AND is_active LOOP
    PERFORM notify_user(r.id, p_tender, 'RECOURS_DEPOSE', 'Recours déposé', 'La procédure ' || v_t.reference || ' est suspendue (' || v_scope || ').');
  END LOOP;
  UPDATE appeals SET notifie_ac = true WHERE id = v_id;
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION submit_appeal(UUID, TEXT, TEXT, TEXT, UUID) TO authenticated;

-- ------------------------------------------
-- 2. Décision : la reprise est limitée au lot contesté
-- ------------------------------------------
CREATE OR REPLACE FUNCTION decide_appeal(p_appeal UUID, p_decision TEXT, p_motivation TEXT DEFAULT NULL)
RETURNS appeal_status LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE v_a appeals%ROWTYPE; v_t tenders%ROWTYPE; v_l tender_lots%ROWTYPE; r RECORD; v_scope TEXT := 'marché entier';
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

  SELECT * INTO v_t FROM tenders WHERE id = v_a.tender_id FOR UPDATE;
  IF v_a.lot_id IS NOT NULL THEN
    SELECT * INTO v_l FROM tender_lots WHERE id = v_a.lot_id;
    v_scope := 'lot ' || v_l.numero_lot;
  END IF;
  -- Une décision favorable rouvre l'évaluation : elle n'est possible que lorsque le marché est en phase de recours,
  -- sinon elle serait enregistrée sans effet pendant qu'une autre réévaluation est en cours.
  IF p_decision IN ('FAVORABLE', 'PARTIELLEMENT_FAVORABLE') AND v_t.current_phase <> 'PHASE_10_RECOURS' THEN
    RAISE EXCEPTION 'INVALID_STATE: décision favorable impossible tant que la procédure est en réévaluation (phase %) — tranchez ce recours au retour en phase 10', v_t.current_phase;
  END IF;

  UPDATE appeals SET status = p_decision::appeal_status, arcop_instructeur_id = auth.uid(), updated_at = NOW(),
         decision_arcop = CASE WHEN p_decision = 'EN_INSTRUCTION' THEN decision_arcop ELSE p_motivation END,
         date_decision = CASE WHEN p_decision = 'EN_INSTRUCTION' THEN NULL ELSE NOW() END,
         notifie_requerant = p_decision <> 'EN_INSTRUCTION'
   WHERE id = p_appeal;

  IF p_decision <> 'EN_INSTRUCTION' THEN
    PERFORM notify_user(v_a.requerant_id, v_a.tender_id, 'DECISION_ARCOP', 'Décision de l''ARCOP', p_decision || ' (' || v_scope || ')');
    FOR r IN SELECT id FROM users WHERE institution_id = v_t.institution_id AND role IN ('PRM', 'CPM') AND is_active LOOP
      PERFORM notify_user(r.id, v_a.tender_id, 'DECISION_ARCOP', 'Décision de l''ARCOP', v_t.reference || ' (' || v_scope || ') : ' || p_decision);
    END LOOP;
    IF p_decision IN ('FAVORABLE', 'PARTIELLEMENT_FAVORABLE') THEN
      IF v_a.lot_id IS NOT NULL THEN
        -- Reprise limitée au lot contesté : ses offres sont réévaluées dans une nouvelle ronde ; les autres lots gardent leur attribution.
        UPDATE bids SET status = 'CONFORME' WHERE tender_id = v_a.tender_id AND lot_id = v_a.lot_id AND status IN ('EVALUEE', 'REJETEE', 'PROVISOIREMENT_RETENUE');
        UPDATE tender_lots SET attributaire_id = NULL, attributaire_bid_id = NULL, montant_attribue = NULL, statut = 'OUVERT' WHERE id = v_a.lot_id;
        UPDATE tenders SET montant_attribue = (SELECT SUM(montant_attribue) FROM tender_lots WHERE tender_id = v_a.tender_id AND statut = 'ATTRIBUE'),
               date_fin_recours = NULL, date_attribution_provisoire = NULL, evaluation_round = evaluation_round + 1
         WHERE id = v_a.tender_id;
      ELSE
        -- Marché entier : nouvelle ronde d'évaluation pour tous les lots
        UPDATE bids SET status = 'CONFORME' WHERE tender_id = v_a.tender_id AND status IN ('EVALUEE', 'REJETEE', 'PROVISOIREMENT_RETENUE');
        UPDATE tender_lots SET attributaire_id = NULL, attributaire_bid_id = NULL, montant_attribue = NULL, statut = 'OUVERT' WHERE tender_id = v_a.tender_id;
        UPDATE tenders SET attributaire_id = NULL, attributaire_bid_id = NULL, montant_attribue = NULL, montant_initial = NULL,
               date_fin_recours = NULL, date_attribution_provisoire = NULL, evaluation_round = evaluation_round + 1
         WHERE id = v_a.tender_id;
      END IF;
      PERFORM _apply_transition(v_a.tender_id, 'PHASE_8_EVALUATION', 'DECISION_ARCOP', jsonb_build_object('appeal', p_appeal, 'decision', p_decision, 'lot', v_a.lot_id));
    END IF;
  END IF;
  RETURN p_decision::appeal_status;
END $$;
GRANT EXECUTE ON FUNCTION decide_appeal(UUID, TEXT, TEXT) TO authenticated;

-- ------------------------------------------
-- 3. Attribution provisoire : le total du marché est celui de TOUS les lots attribués (et non des seuls lots rouverts)
-- ------------------------------------------
CREATE OR REPLACE FUNCTION _set_provisional_award(p_tender UUID, p_payload JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
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
    PERFORM _award_one(p_tender, l.id, (a->>'bid_id')::uuid, a->>'justification', v_t.evaluation_round);
  END LOOP;
  SELECT COALESCE(SUM(montant_attribue), 0) INTO v_total FROM tender_lots WHERE tender_id = p_tender AND statut = 'ATTRIBUE';
  IF v_total = 0 THEN RAISE EXCEPTION 'AWARD_INVALID: aucun lot attribuable'; END IF;
  UPDATE tenders SET montant_attribue = v_total WHERE id = p_tender;
END $$;
REVOKE ALL ON FUNCTION _set_provisional_award(UUID, JSONB) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------
-- 4. Publication : le classement affiché est, pour chaque lot, celui de sa dernière ronde
-- ------------------------------------------
CREATE OR REPLACE VIEW v_public_offres WITH (security_invoker = false) AS
SELECT k.tender_id, l.numero_lot, u.full_name AS candidat, k.montant_offre, k.score_technique, k.score_financier, k.score_global, k.rang, k.qualifie,
       (b.status IN ('PROVISOIREMENT_RETENUE', 'RETENUE_DEFINITIVE')) AS retenue
FROM bid_rankings k
JOIN tenders t ON t.id = k.tender_id
  AND k.round = (SELECT MAX(k2.round) FROM bid_rankings k2 WHERE k2.tender_id = k.tender_id AND k2.lot_id IS NOT DISTINCT FROM k.lot_id)
JOIN bids b ON b.id = k.bid_id JOIN users u ON u.id = b.soumissionnaire_id
LEFT JOIN tender_lots l ON l.id = k.lot_id
WHERE t.current_phase >= 'PHASE_10_RECOURS' AND t.date_publication IS NOT NULL;

-- ------------------------------------------
-- 5. Garde des marchés : passage 8 → 9 après réévaluation partielle (voir la règle modifiée ci-dessous)
--    Si le lot rouvert devient infructueux alors que d'autres lots restent attribués, le marché peut poursuivre.
-- ------------------------------------------
CREATE OR REPLACE FUNCTION tenders_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_changed TEXT[];
  v_allowed TEXT[];
  v_bad TEXT[];
  v_suggested mode_passation;
  v_seuil BIGINT;
  v_delai NUMERIC;
  v_app BOOLEAN := current_user IN ('authenticated', 'anon');
BEGIN
  -- ===== INSERT : toujours en Phase 1, champs protégés remis à zéro pour le rôle applicatif =====
  IF TG_OP = 'INSERT' THEN
    IF v_app THEN
      NEW.current_phase := 'PHASE_1_PROGRAMMATION';
      NEW.phase_history := '[]'; NEW.has_appeal_pending := false; NEW.arcop_decision := NULL;
      NEW.attributaire_id := NULL; NEW.attributaire_bid_id := NULL; NEW.montant_attribue := NULL;
      NEW.montant_initial := NULL; NEW.plis_dechiffres := false; NEW.montant_avenants_cumule := 0;
      NEW.montant_soustrait_cumule := 0; NEW.taux_avancement := 0; NEW.evaluation_round := 1;
      NEW.date_publication := NULL; NEW.date_attribution_provisoire := NULL; NEW.date_attribution_definitive := NULL;
      NEW.date_signature_contrat := NULL; NEW.date_fin_recours := NULL; NEW.transmis_dcmp_at := NULL; NEW.closed_at := NULL;
      NEW.issue := NULL; NEW.motif_infructueux := NULL; NEW.relance_de := NULL;
      NEW.created_by := auth.uid();
    END IF;
  ELSE
    -- ===== UPDATE =====
    IF OLD.closed_at IS NOT NULL THEN
      RAISE EXCEPTION 'CLOSED_TENDER: le marché est clos et archivé, aucune modification possible';
    END IF;
    v_changed := changed_keys_except(to_jsonb(OLD), to_jsonb(NEW), ARRAY['updated_at', 'phase_history']);

    IF v_app THEN
      IF NEW.current_phase IS DISTINCT FROM OLD.current_phase THEN
        RAISE EXCEPTION 'USE_ADVANCE_PHASE: changez de phase via advance_phase(), pas par UPDATE direct';
      END IF;
      v_allowed := CASE
        WHEN OLD.current_phase IN ('PHASE_1_PROGRAMMATION', 'PHASE_2_REDACTION') THEN ARRAY[
          'title','description','corps_metier_id','nature_marche','montant_estime','mode_passation','justification_mode',
          'ligne_budgetaire','programme_budget','ppm_annee','ppm_trimestre','date_prevue_lancement','date_prevue_attribution',
          'is_reserve_pme','is_reserve_pme_feminine','is_alloti','nombre_lots','is_cofinance','criteres_evaluation',
          'prm_id','cpm_id','mode_suggere','date_limite_depot','date_ouverture_plis','bid_public_key','bid_key_fingerprint','bid_key_shares','bid_key_threshold']
        WHEN OLD.current_phase IN ('PHASE_3_VALIDATION_PRIORI', 'PHASE_4_PUBLICATION', 'PHASE_5_CLARIFICATIONS') THEN ARRAY[
          'date_prevue_lancement','date_prevue_attribution','date_limite_depot','date_ouverture_plis','bid_public_key','bid_key_fingerprint','bid_key_shares','bid_key_threshold']
        ELSE ARRAY[]::text[] END;
      v_bad := ARRAY(SELECT unnest(v_changed) EXCEPT SELECT unnest(v_allowed));
      IF array_length(v_bad, 1) > 0 THEN
        RAISE EXCEPTION 'LOCKED_COLUMNS: colonnes non modifiables en % : %', OLD.current_phase, array_to_string(v_bad, ', ');
      END IF;
    END IF;
  END IF;

  -- ===== Mode de passation : calcul, cohérence, justification =====
  IF TG_OP = 'INSERT' OR NEW.montant_estime IS DISTINCT FROM OLD.montant_estime
     OR NEW.nature_marche IS DISTINCT FROM OLD.nature_marche OR NEW.mode_passation IS DISTINCT FROM OLD.mode_passation THEN
    IF NEW.montant_estime IS NOT NULL THEN
      v_suggested := calculer_mode_passation(NEW.institution_id, NEW.nature_marche, NEW.montant_estime);
      NEW.mode_suggere := v_suggested;
      IF NEW.mode_passation IS NULL THEN NEW.mode_passation := v_suggested; END IF;
      IF NEW.mode_passation = 'DRP' AND NEW.nature_marche NOT IN ('DSP', 'PPP')
         AND NEW.montant_estime >= seuil_aoo(NEW.institution_id, NEW.nature_marche) THEN
        RAISE EXCEPTION 'MODE_ILLEGAL: la DRP n''est pas admise au-delà du seuil de % FCFA',
          seuil_aoo(NEW.institution_id, NEW.nature_marche);
      END IF;
      IF (NEW.mode_passation IS DISTINCT FROM v_suggested OR NEW.mode_passation = 'ENTENTE_DIRECTE')
         AND char_length(COALESCE(NEW.justification_mode, '')) < 20 THEN
        RAISE EXCEPTION 'JUSTIFICATION_REQUIRED: un mode de passation (%) différent du mode réglementaire (%) doit être justifié (20 caractères min.)',
          NEW.mode_passation, v_suggested;
      END IF;
    END IF;
  END IF;

  -- ===== Pondération des critères d'évaluation : Σ = 100 dès que renseignés =====
  IF jsonb_array_length(NEW.criteres_evaluation) > 0 AND criteres_total(NEW.criteres_evaluation) <> 100 THEN
    RAISE EXCEPTION 'CRITERIA_INVALID: la somme des pondérations des critères doit être égale à 100 (actuel : %)',
      criteres_total(NEW.criteres_evaluation);
  END IF;

  -- ===== HARD LOCK recours : aucune entrée en phase ≥ 11 tant qu'un recours est pendant =====
  IF TG_OP = 'UPDATE' AND NEW.current_phase IS DISTINCT FROM OLD.current_phase THEN
    IF NOT EXISTS (SELECT 1 FROM phase_transitions WHERE from_phase = OLD.current_phase AND to_phase = NEW.current_phase) THEN
      RAISE EXCEPTION 'INVALID_TRANSITION: % → % n''est pas une transition légale', OLD.current_phase, NEW.current_phase;
    END IF;

    IF NEW.current_phase >= 'PHASE_11_ATTRIBUTION_DEFINITIVE' AND NEW.current_phase <> 'PHASE_8_EVALUATION'
       AND EXISTS (SELECT 1 FROM appeals a WHERE a.tender_id = NEW.id AND a.status IN ('DEPOSE', 'EN_INSTRUCTION')) THEN
      RAISE EXCEPTION 'HARD_LOCK_APPEAL: un recours est pendant devant l''ARCOP, la phase % est bloquée', NEW.current_phase;
    END IF;

    CASE NEW.current_phase
      WHEN 'PHASE_2_REDACTION' THEN
        IF OLD.current_phase = 'PHASE_1_PROGRAMMATION' THEN
          IF COALESCE(NEW.montant_estime, 0) <= 0 OR NEW.ligne_budgetaire IS NULL OR NEW.ppm_annee IS NULL OR NEW.mode_passation IS NULL THEN
            RAISE EXCEPTION 'GUARD_PHASE_1: montant, ligne budgétaire, année PPM et mode de passation sont requis';
          END IF;
        END IF;

      WHEN 'PHASE_3_VALIDATION_PRIORI' THEN
        IF NOT EXISTS (SELECT 1 FROM tender_documents d WHERE d.tender_id = NEW.id AND d.type IN ('TDR', 'DAO') AND d.circuit_statut = 'VALIDE_PRM') THEN
          RAISE EXCEPTION 'GUARD_PHASE_2: un TDR/DAO validé par le PRM est requis avant transmission à la DCMP';
        END IF;
        IF NEW.mode_passation <> 'ENTENTE_DIRECTE' AND criteres_total(NEW.criteres_evaluation) <> 100 THEN
          RAISE EXCEPTION 'GUARD_PHASE_2: les critères d''évaluation (Σ = 100) doivent être définis avant transmission';
        END IF;
        IF NEW.is_alloti AND (SELECT COUNT(*) FROM tender_lots l WHERE l.tender_id = NEW.id) < 2 THEN
          RAISE EXCEPTION 'GUARD_PHASE_2: un marché alloti doit comporter au moins deux lots';
        END IF;
        NEW.transmis_dcmp_at := NOW();

      WHEN 'PHASE_4_PUBLICATION' THEN
        IF NOT EXISTS (SELECT 1 FROM dcmp_reviews r WHERE r.tender_id = NEW.id AND r.type = 'AVIS_NON_OBJECTION' AND r.decision = 'FAVORABLE'
                       AND r.created_at >= COALESCE(NEW.transmis_dcmp_at, '-infinity')) THEN
          RAISE EXCEPTION 'GUARD_PHASE_3: avis de non-objection favorable de la DCMP requis';
        END IF;
        IF NEW.is_cofinance AND NOT EXISTS (SELECT 1 FROM dcmp_reviews r WHERE r.tender_id = NEW.id AND r.type = 'NON_OBJECTION_BAILLEUR'
                       AND r.decision = 'FAVORABLE' AND r.created_at >= COALESCE(NEW.transmis_dcmp_at, '-infinity')) THEN
          RAISE EXCEPTION 'GUARD_PHASE_3: non-objection du bailleur requise (marché cofinancé)';
        END IF;
        IF NEW.mode_passation = 'ENTENTE_DIRECTE' AND NOT EXISTS (
             SELECT 1 FROM dcmp_reviews r WHERE r.tender_id = NEW.id AND r.type = 'DEROGATION' AND r.decision = 'FAVORABLE') THEN
          RAISE EXCEPTION 'GUARD_PHASE_3: une dérogation favorable de la DCMP est requise pour l''entente directe';
        END IF;

      WHEN 'PHASE_5_CLARIFICATIONS' THEN
        IF NEW.date_publication IS NULL THEN RAISE EXCEPTION 'GUARD_PHASE_4: date de publication manquante'; END IF;

      WHEN 'PHASE_6_DEPOT_OFFRES' THEN
        IF NEW.date_limite_depot IS NULL OR NEW.bid_public_key IS NULL THEN
          RAISE EXCEPTION 'GUARD_PHASE_5: date limite de dépôt et clé publique de chiffrement requises';
        END IF;
        IF NEW.date_limite_depot <= NOW() THEN RAISE EXCEPTION 'GUARD_PHASE_5: la date limite de dépôt est déjà passée'; END IF;
        v_delai := config_num('DELAI_DEPOT_OFFRES_MIN_' || NEW.mode_passation::text, 0);
        IF NEW.date_limite_depot < NEW.date_publication + make_interval(days => v_delai::int) THEN
          RAISE EXCEPTION 'GUARD_PHASE_5: délai minimal de % jours entre publication et dépôt non respecté (mode %)', v_delai, NEW.mode_passation;
        END IF;

      WHEN 'PHASE_7_OUVERTURE_PLIS' THEN
        IF NOW() < NEW.date_limite_depot THEN
          RAISE EXCEPTION 'GUARD_PHASE_6: la date limite de dépôt (%) n''est pas atteinte', NEW.date_limite_depot;
        END IF;

      WHEN 'PHASE_8_EVALUATION' THEN
        IF OLD.current_phase = 'PHASE_7_OUVERTURE_PLIS' AND NOT EXISTS (SELECT 1 FROM bid_openings o WHERE o.tender_id = NEW.id) THEN
          RAISE EXCEPTION 'GUARD_PHASE_7: ouverture officielle (double signature) non enregistrée';
        END IF;

      WHEN 'PHASE_9_ATTRIBUTION_PROVISOIRE' THEN
        -- Réévaluation partielle après un recours sur un lot : le lot rouvert peut être devenu infructueux (aucun classé) alors que
        -- d'autres lots restent attribués ; le marché poursuit avec ces lots.
        IF NOT EXISTS (SELECT 1 FROM bid_rankings r WHERE r.tender_id = NEW.id AND r.round = NEW.evaluation_round AND r.rang = 1)
           AND NOT (NEW.is_alloti AND NEW.evaluation_round > 1
                    AND EXISTS (SELECT 1 FROM tender_lots l WHERE l.tender_id = NEW.id AND l.statut = 'ATTRIBUE')
                    AND NOT EXISTS (SELECT 1 FROM tender_lots l WHERE l.tender_id = NEW.id AND l.statut = 'OUVERT')) THEN
          RAISE EXCEPTION 'GUARD_PHASE_8: l''évaluation doit être finalisée (classement des offres) avant l''attribution';
        END IF;

      WHEN 'PHASE_10_RECOURS' THEN
        IF NEW.is_alloti THEN
          IF NEW.montant_attribue IS NULL OR NOT EXISTS (SELECT 1 FROM tender_lots l WHERE l.tender_id = NEW.id AND l.statut = 'ATTRIBUE') THEN
            RAISE EXCEPTION 'GUARD_PHASE_9: au moins un lot doit être attribué';
          END IF;
        ELSIF NEW.attributaire_id IS NULL OR NEW.attributaire_bid_id IS NULL OR NEW.montant_attribue IS NULL THEN
          RAISE EXCEPTION 'GUARD_PHASE_9: attributaire et montant attribué requis';
        END IF;
        NEW.date_attribution_provisoire := NOW();
        NEW.date_fin_recours := NOW() + make_interval(days => config_num('DELAI_RECOURS_JOURS', 10)::int);
        NEW.montant_initial := NEW.montant_attribue;

      WHEN 'PHASE_11_ATTRIBUTION_DEFINITIVE' THEN
        IF NOW() < NEW.date_fin_recours THEN
          RAISE EXCEPTION 'GUARD_PHASE_10: le délai de recours court jusqu''au %', NEW.date_fin_recours;
        END IF;
        NEW.date_attribution_definitive := NOW();

      WHEN 'PHASE_12_SIGNATURE_CONTRAT' THEN
        IF NOT EXISTS (SELECT 1 FROM dcmp_reviews r WHERE r.tender_id = NEW.id AND r.type = 'APPROBATION_ATTRIBUTION' AND r.decision = 'FAVORABLE') THEN
          RAISE EXCEPTION 'GUARD_PHASE_11: approbation de l''attribution par l''autorité compétente (DCMP) requise';
        END IF;

      WHEN 'PHASE_13_EXECUTION' THEN
        IF NOT EXISTS (SELECT 1 FROM contracts c WHERE c.tender_id = NEW.id)
           OR EXISTS (SELECT 1 FROM contracts c WHERE c.tender_id = NEW.id AND NOT (c.signed_by_ac AND c.signed_by_titulaire AND c.visa_controleur))
           OR (NEW.is_alloti AND (SELECT COUNT(*) FROM tender_lots l WHERE l.tender_id = NEW.id AND l.statut = 'ATTRIBUE')
                               > (SELECT COUNT(*) FROM contracts c WHERE c.tender_id = NEW.id)) THEN
          RAISE EXCEPTION 'GUARD_PHASE_12: contrat signé par les deux parties et visé par le contrôle financier requis';
        END IF;
        IF NEW.nature_marche <> 'PRESTATIONS_INTELLECTUELLES' AND EXISTS (
             SELECT 1 FROM contracts c WHERE c.tender_id = NEW.id AND NOT EXISTS (
               SELECT 1 FROM guarantees g WHERE g.contract_id = c.id AND g.type = 'BONNE_EXECUTION' AND g.statut = 'VALIDE')) THEN
          RAISE EXCEPTION 'GUARD_PHASE_12: garantie de bonne exécution valide requise';
        END IF;
        NEW.date_signature_contrat := NOW();

      WHEN 'PHASE_14_RECEPTION_PAIEMENT' THEN
        IF EXISTS (SELECT 1 FROM contracts c WHERE c.tender_id = NEW.id AND NOT EXISTS (
             SELECT 1 FROM receptions r WHERE r.contract_id = c.id AND r.type = 'PROVISOIRE' AND r.statut IN ('ACCEPTEE', 'ACCEPTEE_AVEC_RESERVES'))) THEN
          RAISE EXCEPTION 'GUARD_PHASE_13: PV de réception provisoire accepté requis';
        END IF;

      WHEN 'PHASE_15_CLOTURE_ARCHIVAGE' THEN
        IF OLD.current_phase = 'PHASE_8_EVALUATION' THEN
          -- Procédure infructueuse : motif obligatoire, et aucune offre qualifiée classée
          IF NEW.issue IS DISTINCT FROM 'INFRUCTUEUX' OR char_length(COALESCE(NEW.motif_infructueux, '')) < 20 THEN
            RAISE EXCEPTION 'GUARD_INFRUCTUEUX: motif détaillé (20 caractères min.) requis pour déclarer la procédure infructueuse';
          END IF;
          IF EXISTS (SELECT 1 FROM bid_rankings r WHERE r.tender_id = NEW.id AND r.round = NEW.evaluation_round AND r.rang = 1) THEN
            RAISE EXCEPTION 'GUARD_INFRUCTUEUX: une offre qualifiée est classée, la procédure ne peut pas être déclarée infructueuse';
          END IF;
        ELSIF EXISTS (SELECT 1 FROM contracts c WHERE c.tender_id = NEW.id AND NOT EXISTS (
             SELECT 1 FROM receptions r WHERE r.contract_id = c.id AND r.type = 'DEFINITIVE' AND r.statut IN ('ACCEPTEE', 'ACCEPTEE_AVEC_RESERVES'))) THEN
          RAISE EXCEPTION 'GUARD_PHASE_14: PV de réception définitive accepté requis';
        END IF;
        NEW.closed_at := NOW();
      ELSE NULL;
    END CASE;

    NEW.phase_history := COALESCE(OLD.phase_history, '[]'::jsonb) || jsonb_build_object(
      'from', OLD.current_phase, 'phase', NEW.current_phase, 'enteredAt', NOW(), 'enteredBy', auth.uid());
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END $$;
