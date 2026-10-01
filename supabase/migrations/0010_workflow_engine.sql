-- ==========================================
-- Migration 0010 : Moteur de workflow appliqué en base (source de vérité)
--  • table des transitions légales entre les 15 phases (miroir de packages/workflow)
--  • garde-fous BEFORE UPDATE sur tenders (verrous durs) applicables à TOUS les rôles
--  • RPC advance_phase / record_review / programmer_besoin
--  • documents : circuit de validation, versions, verrouillage
-- Les verrous (recours, dates limites, plafonds) ne dépendent donc plus du code applicatif.
-- ==========================================

-- ------------------------------------------
-- Utilitaires
-- ------------------------------------------
CREATE OR REPLACE FUNCTION changed_keys(p_old JSONB, p_new JSONB)
RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(array_agg(k ORDER BY k), ARRAY[]::text[])
  FROM (SELECT key AS k FROM jsonb_each(p_new) n
        WHERE p_old -> n.key IS DISTINCT FROM n.value
        UNION
        SELECT key FROM jsonb_each(p_old) o WHERE NOT p_new ? o.key) d
$$;

CREATE OR REPLACE FUNCTION changed_keys_except(p_old JSONB, p_new JSONB, p_ignore TEXT[])
RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(array_agg(k), ARRAY[]::text[]) FROM unnest(changed_keys(p_old, p_new)) k WHERE NOT (k = ANY (p_ignore))
$$;

CREATE OR REPLACE FUNCTION config_num(p_cle TEXT, p_default NUMERIC DEFAULT NULL)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
  SELECT COALESCE((SELECT valeur::numeric FROM config_seuils WHERE cle = p_cle), p_default)
$$;

CREATE OR REPLACE FUNCTION notify_user(p_user UUID, p_tender UUID, p_kind TEXT, p_titre TEXT, p_message TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
  INSERT INTO notifications (user_id, tender_id, kind, titre, message) VALUES (p_user, p_tender, p_kind, p_titre, p_message)
$$;
REVOKE ALL ON FUNCTION notify_user(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------
-- Seuils et mode de passation (CDC §2.3) — paramétrables, jamais codés en dur
-- ------------------------------------------
ALTER TABLE institutions ALTER COLUMN seuil_travaux DROP NOT NULL;
ALTER TABLE institutions ALTER COLUMN seuil_travaux DROP DEFAULT;
ALTER TABLE institutions ALTER COLUMN seuil_fournitures DROP NOT NULL;
ALTER TABLE institutions ALTER COLUMN seuil_fournitures DROP DEFAULT;
UPDATE institutions SET seuil_travaux = NULL, seuil_fournitures = NULL;   -- NULL = seuil réglementaire global (config_seuils)
COMMENT ON COLUMN institutions.seuil_travaux IS 'Dérogation de seuil AOO travaux (FCFA) ; NULL = seuil réglementaire de config_seuils';
COMMENT ON COLUMN institutions.seuil_fournitures IS 'Dérogation de seuil AOO fournitures/services (FCFA) ; NULL = seuil réglementaire de config_seuils';

CREATE OR REPLACE FUNCTION seuil_aoo(p_institution UUID, p_nature nature_marche)
RETURNS BIGINT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE v_inst institutions%ROWTYPE; v_scope TEXT; v_seuil BIGINT;
BEGIN
  SELECT * INTO v_inst FROM institutions WHERE id = p_institution;
  IF NOT FOUND THEN RAISE EXCEPTION 'INSTITUTION_NOT_FOUND'; END IF;
  v_scope := CASE WHEN v_inst.type IN ('SOCIETE_PUBLIQUE', 'AGENCE') THEN 'AGENCE' ELSE 'ETAT' END;
  IF p_nature = 'TRAVAUX' THEN
    v_seuil := COALESCE(v_inst.seuil_travaux, config_num('SEUIL_' || v_scope || '_TRAVAUX')::bigint);
  ELSE
    v_seuil := COALESCE(v_inst.seuil_fournitures, config_num('SEUIL_' || v_scope || '_FOURNITURES')::bigint);
  END IF;
  RETURN v_seuil;
END $$;

-- Mode SUGGÉRÉ : AOO à partir du seuil, DRP en deçà ; DSP/PPP toujours en appel d'offres.
CREATE OR REPLACE FUNCTION calculer_mode_passation(p_institution UUID, p_nature nature_marche, p_montant BIGINT)
RETURNS mode_passation LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF p_nature IN ('DSP', 'PPP') THEN RETURN 'AOO'; END IF;
  IF p_montant >= seuil_aoo(p_institution, p_nature) THEN RETURN 'AOO'; END IF;
  RETURN 'DRP';
END $$;
GRANT EXECUTE ON FUNCTION calculer_mode_passation(UUID, nature_marche, BIGINT) TO authenticated;

-- ------------------------------------------
-- Transitions légales (source de vérité, comparée au TypeScript par les tests)
-- ------------------------------------------
CREATE TABLE phase_transitions (
  from_phase tender_phase NOT NULL,
  to_phase tender_phase NOT NULL,
  event TEXT NOT NULL,
  allowed_roles TEXT[] NOT NULL,
  direct BOOLEAN NOT NULL DEFAULT true,     -- false : déclenchée par une RPC dédiée (avis DCMP, ouverture, recours)
  PRIMARY KEY (from_phase, to_phase, event)
);
ALTER TABLE phase_transitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "phase_transitions_read" ON phase_transitions FOR SELECT USING (true);

INSERT INTO phase_transitions (from_phase, to_phase, event, allowed_roles, direct) VALUES
  ('PHASE_1_PROGRAMMATION', 'PHASE_2_REDACTION', 'VALIDER_PPM', ARRAY['PRM','CPM'], true),
  ('PHASE_2_REDACTION', 'PHASE_3_VALIDATION_PRIORI', 'FINALISER_DAO', ARRAY['PRM','CPM'], true),
  ('PHASE_3_VALIDATION_PRIORI', 'PHASE_4_PUBLICATION', 'RECEVOIR_AVIS_DCMP', ARRAY['DCMP','BAILLEUR'], false),
  ('PHASE_3_VALIDATION_PRIORI', 'PHASE_2_REDACTION', 'RECEVOIR_AVIS_DCMP', ARRAY['DCMP','BAILLEUR'], false),
  ('PHASE_4_PUBLICATION', 'PHASE_5_CLARIFICATIONS', 'PUBLIER_AO', ARRAY['CPM','PRM'], true),
  ('PHASE_5_CLARIFICATIONS', 'PHASE_6_DEPOT_OFFRES', 'OUVRIR_DEPOT', ARRAY['CPM','PRM'], true),
  ('PHASE_6_DEPOT_OFFRES', 'PHASE_7_OUVERTURE_PLIS', 'FERMER_DEPOT', ARRAY['CPM','PRM'], true),
  ('PHASE_7_OUVERTURE_PLIS', 'PHASE_8_EVALUATION', 'DECLENCHER_OUVERTURE', ARRAY['CPM','EVALUATEUR','PRM'], false),
  ('PHASE_8_EVALUATION', 'PHASE_9_ATTRIBUTION_PROVISOIRE', 'FINALISER_EVALUATION', ARRAY['PRM','CPM'], true),
  ('PHASE_9_ATTRIBUTION_PROVISOIRE', 'PHASE_10_RECOURS', 'PRONONCER_ATTRIBUTION_PROVISOIRE', ARRAY['PRM'], true),
  ('PHASE_10_RECOURS', 'PHASE_11_ATTRIBUTION_DEFINITIVE', 'CLORE_PERIODE_RECOURS', ARRAY['PRM','CPM'], true),
  ('PHASE_10_RECOURS', 'PHASE_8_EVALUATION', 'DECISION_ARCOP', ARRAY['ARCOP'], false),
  ('PHASE_11_ATTRIBUTION_DEFINITIVE', 'PHASE_12_SIGNATURE_CONTRAT', 'CONFIRMER_ATTRIBUTION_DEFINITIVE', ARRAY['PRM'], true),
  ('PHASE_12_SIGNATURE_CONTRAT', 'PHASE_13_EXECUTION', 'SIGNER_CONTRAT', ARRAY['PRM'], true),
  ('PHASE_13_EXECUTION', 'PHASE_14_RECEPTION_PAIEMENT', 'CONSTATER_RECEPTION_PROVISOIRE', ARRAY['PRM','CPM'], true),
  ('PHASE_14_RECEPTION_PAIEMENT', 'PHASE_15_CLOTURE_ARCHIVAGE', 'CONSTATER_RECEPTION_DEFINITIVE', ARRAY['PRM','CPM'], true),
  ('PHASE_8_EVALUATION', 'PHASE_15_CLOTURE_ARCHIVAGE', 'DECLARER_INFRUCTUEUX', ARRAY['PRM'], true);

-- ------------------------------------------
-- Colonnes de marché : ronde d'évaluation (reprise après recours favorable)
-- ------------------------------------------
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS evaluation_round INTEGER NOT NULL DEFAULT 1;
-- Issue particulière de la procédure (marché clos sans contrat) et chaînage des relances
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS issue TEXT CHECK (issue IN ('INFRUCTUEUX'));
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS motif_infructueux TEXT;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS relance_de UUID REFERENCES tenders(id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenders_relance_de ON tenders(relance_de) WHERE relance_de IS NOT NULL;

-- Allotissement : chaque lot est évalué, attribué et contractualisé séparément
ALTER TABLE tender_lots ADD COLUMN IF NOT EXISTS statut TEXT NOT NULL DEFAULT 'OUVERT' CHECK (statut IN ('OUVERT', 'ATTRIBUE', 'INFRUCTUEUX'));
ALTER TABLE tender_lots ADD COLUMN IF NOT EXISTS attributaire_bid_id UUID REFERENCES bids(id);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS lot_id UUID REFERENCES tender_lots(id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_contract_per_lot ON contracts (tender_id, COALESCE(lot_id, '00000000-0000-0000-0000-000000000000'));

-- ------------------------------------------
-- GARDE-FOUS SUR tenders
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
        IF NOT EXISTS (SELECT 1 FROM bid_rankings r WHERE r.tender_id = NEW.id AND r.round = NEW.evaluation_round AND r.rang = 1) THEN
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

CREATE TRIGGER trig_tenders_guard BEFORE INSERT OR UPDATE ON tenders
  FOR EACH ROW EXECUTE FUNCTION tenders_guard();

-- Plus de suppression de marché (traçabilité) ni d'écriture directe pour anon.
REVOKE DELETE, TRUNCATE ON tenders FROM anon, authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE ON tenders FROM anon;

-- ------------------------------------------
-- RLS tenders (remplace 0005)
-- ------------------------------------------
CREATE OR REPLACE FUNCTION has_bid_on(p_tender UUID)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp SET row_security = off AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM bids b WHERE b.tender_id = p_tender AND b.soumissionnaire_id = auth.uid());
END $$;

CREATE OR REPLACE FUNCTION bidder_can_see_tender(p_tender UUID)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp SET row_security = off AS $$
BEGIN
  RETURN current_user_role() = 'SOUMISSIONNAIRE' AND (
    EXISTS (SELECT 1 FROM tenders t WHERE t.id = p_tender
            AND t.current_phase BETWEEN 'PHASE_5_CLARIFICATIONS' AND 'PHASE_6_DEPOT_OFFRES')
    OR has_bid_on(p_tender)
    OR EXISTS (SELECT 1 FROM tenders t WHERE t.id = p_tender AND t.attributaire_id = auth.uid()));
END $$;

DROP POLICY IF EXISTS "tenders_select_institution" ON tenders;
DROP POLICY IF EXISTS "tenders_insert_institution" ON tenders;
DROP POLICY IF EXISTS "tenders_update_institution" ON tenders;

CREATE POLICY "tenders_select" ON tenders FOR SELECT USING (
  is_inst_staff(institution_id)
  OR is_regulateur() OR current_user_role() = 'COUR_COMPTES'
  OR (current_user_role() = 'BAILLEUR' AND is_cofinance)
  OR bidder_can_see_tender(id)
);
CREATE POLICY "tenders_insert" ON tenders FOR INSERT WITH CHECK (
  institution_id = current_institution_id() AND current_user_role() IN ('CPM', 'PRM'));
CREATE POLICY "tenders_update" ON tenders FOR UPDATE USING (
  institution_id = current_institution_id() AND current_user_role() IN ('CPM', 'PRM'))
  WITH CHECK (institution_id = current_institution_id());

-- Vue publique (portail soumissionnaires/anonymes) : colonnes non sensibles des avis publiés.
CREATE OR REPLACE VIEW v_avis_publics WITH (security_invoker = false) AS
SELECT t.id, t.reference, t.title, t.description, t.nature_marche, t.mode_passation, t.current_phase,
       t.date_publication, t.date_limite_depot, t.is_reserve_pme, t.is_reserve_pme_feminine, t.is_alloti, t.nombre_lots,
       i.name AS institution_name, i.type AS institution_type, cm.libelle AS corps_metier
FROM tenders t
JOIN institutions i ON i.id = t.institution_id
LEFT JOIN corps_metiers cm ON cm.id = t.corps_metier_id
WHERE t.current_phase BETWEEN 'PHASE_5_CLARIFICATIONS' AND 'PHASE_6_DEPOT_OFFRES'
  AND t.date_publication IS NOT NULL;
GRANT SELECT ON v_avis_publics TO anon, authenticated;

-- ------------------------------------------
-- Transition interne (effets de bord) — jamais exposée au client
-- ------------------------------------------
CREATE OR REPLACE FUNCTION _apply_transition(p_tender UUID, p_to tender_phase, p_event TEXT, p_payload JSONB DEFAULT '{}')
RETURNS tender_phase LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  v_t tenders%ROWTYPE;
  r RECORD;
BEGIN
  SELECT * INTO v_t FROM tenders WHERE id = p_tender FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TENDER_NOT_FOUND'; END IF;

  -- Horodatage serveur de la publication : posé AVANT la transition car le garde-fou l'exige
  IF p_to = 'PHASE_5_CLARIFICATIONS' THEN
    UPDATE tenders SET date_publication = NOW() WHERE id = p_tender;
  END IF;

  UPDATE tenders SET current_phase = p_to WHERE id = p_tender;

  -- Effets sur les documents : APRÈS la validation par le garde-fou (sinon il ne verrait plus l'état « validé »)
  IF p_to = 'PHASE_5_CLARIFICATIONS' THEN
    UPDATE tender_documents SET circuit_statut = 'PUBLIE', is_locked = true, locked_at = NOW()
      WHERE tender_id = p_tender AND type IN ('TDR', 'DAO') AND circuit_statut = 'TRANSMIS_DCMP';
  ELSIF p_to = 'PHASE_3_VALIDATION_PRIORI' THEN
    UPDATE tender_documents SET circuit_statut = 'TRANSMIS_DCMP', is_locked = true, locked_at = NOW(), locked_by = auth.uid()
      WHERE tender_id = p_tender AND type IN ('TDR', 'DAO') AND circuit_statut = 'VALIDE_PRM';
  ELSIF p_to = 'PHASE_2_REDACTION' AND v_t.current_phase = 'PHASE_3_VALIDATION_PRIORI' THEN
    UPDATE tender_documents SET circuit_statut = 'REDACTION', is_locked = false, locked_at = NULL
      WHERE tender_id = p_tender AND type IN ('TDR', 'DAO') AND circuit_statut = 'TRANSMIS_DCMP';
  END IF;

  -- Effets postérieurs
  IF p_to = 'PHASE_8_EVALUATION' AND v_t.current_phase = 'PHASE_7_OUVERTURE_PLIS' THEN
    UPDATE tenders SET plis_dechiffres = true WHERE id = p_tender;
  END IF;

  IF p_to = 'PHASE_10_RECOURS' THEN
    FOR r IN SELECT DISTINCT soumissionnaire_id FROM bids
             WHERE tender_id = p_tender AND status NOT IN ('RETARDEE', 'RETIREE', 'BROUILLON') LOOP
      PERFORM notify_user(r.soumissionnaire_id, p_tender, 'ATTRIBUTION_PROVISOIRE',
        'Attribution provisoire prononcée',
        'Délai de recours ouvert jusqu''au ' || to_char((SELECT date_fin_recours FROM tenders WHERE id = p_tender), 'DD/MM/YYYY HH24:MI'));
    END LOOP;
  END IF;

  IF p_to = 'PHASE_5_CLARIFICATIONS' THEN
    PERFORM enqueue_tender_alerts(p_tender);       -- alertes PME (file d'envoi + notifications) ; défini en 0016
  END IF;

  IF p_to = 'PHASE_4_PUBLICATION' THEN
    FOR r IN SELECT id FROM users WHERE institution_id = v_t.institution_id AND role IN ('PRM', 'CPM') AND is_active LOOP
      PERFORM notify_user(r.id, p_tender, 'AVIS_DCMP', 'Avis DCMP favorable', 'Le marché ' || v_t.reference || ' peut être publié.');
    END LOOP;
  ELSIF p_to = 'PHASE_2_REDACTION' AND v_t.current_phase = 'PHASE_3_VALIDATION_PRIORI' THEN
    FOR r IN SELECT id FROM users WHERE institution_id = v_t.institution_id AND role IN ('PRM', 'CPM') AND is_active LOOP
      PERFORM notify_user(r.id, p_tender, 'AVIS_DCMP', 'Avis DCMP à traiter', 'Le dossier ' || v_t.reference || ' est renvoyé en rédaction.');
    END LOOP;
  END IF;

  PERFORM write_audit('PHASE_TRANSITION', 'tender', p_tender, v_t.institution_id,
    jsonb_build_object('phase', v_t.current_phase),
    jsonb_build_object('phase', p_to, 'event', p_event),
    p_payload);
  RETURN p_to;
END $$;
REVOKE ALL ON FUNCTION _apply_transition(UUID, tender_phase, TEXT, JSONB) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------
-- RPC advance_phase : transitions pilotées par l'autorité contractante
-- ------------------------------------------
CREATE OR REPLACE FUNCTION advance_phase(p_tender UUID, p_event TEXT, p_payload JSONB DEFAULT '{}')
RETURNS tender_phase LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  v_t tenders%ROWTYPE;
  v_role TEXT := current_user_role();
  v_tr phase_transitions%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR v_role = '' THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
  SELECT * INTO v_t FROM tenders WHERE id = p_tender FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TENDER_NOT_FOUND'; END IF;
  IF v_t.institution_id IS DISTINCT FROM current_institution_id() THEN RAISE EXCEPTION 'FORBIDDEN: marché d''une autre institution'; END IF;

  SELECT * INTO v_tr FROM phase_transitions WHERE from_phase = v_t.current_phase AND event = p_event AND direct;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: événement % impossible en %', p_event, v_t.current_phase;
  END IF;
  IF NOT (v_role = ANY (v_tr.allowed_roles)) THEN
    RAISE EXCEPTION 'FORBIDDEN: le rôle % ne peut pas déclencher %', v_role, p_event;
  END IF;

  IF p_event = 'FINALISER_EVALUATION' THEN PERFORM _finalize_evaluation(p_tender); END IF;
  IF p_event = 'PRONONCER_ATTRIBUTION_PROVISOIRE' THEN PERFORM _set_provisional_award(p_tender, p_payload); END IF;
  IF p_event = 'DECLARER_INFRUCTUEUX' THEN PERFORM _declare_infructueux(p_tender, p_payload); END IF;

  RETURN _apply_transition(p_tender, v_tr.to_phase, p_event, p_payload);
END $$;
GRANT EXECUTE ON FUNCTION advance_phase(UUID, TEXT, JSONB) TO authenticated;

-- ------------------------------------------
-- RPC record_review : avis DCMP / non-objection bailleur / dérogation / approbation
-- ------------------------------------------
CREATE OR REPLACE FUNCTION record_review(p_tender UUID, p_type TEXT, p_decision TEXT,
                                         p_motivation TEXT DEFAULT NULL, p_document_path TEXT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  v_t tenders%ROWTYPE; v_role TEXT := current_user_role(); v_id UUID;
  v_dcmp_ok BOOLEAN; v_bailleur_ok BOOLEAN;
BEGIN
  SELECT * INTO v_t FROM tenders WHERE id = p_tender FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TENDER_NOT_FOUND'; END IF;
  IF p_type = 'NON_OBJECTION_BAILLEUR' THEN
    IF v_role <> 'BAILLEUR' THEN RAISE EXCEPTION 'FORBIDDEN: réservé au bailleur de fonds'; END IF;
    IF NOT v_t.is_cofinance THEN RAISE EXCEPTION 'NOT_COFINANCED: ce marché n''est pas cofinancé'; END IF;
  ELSE
    IF v_role <> 'DCMP' THEN RAISE EXCEPTION 'FORBIDDEN: réservé à la DCMP'; END IF;
  END IF;
  IF p_type IN ('AVIS_NON_OBJECTION', 'NON_OBJECTION_BAILLEUR') AND v_t.current_phase <> 'PHASE_3_VALIDATION_PRIORI' THEN
    RAISE EXCEPTION 'INVALID_PHASE: avis possible uniquement en phase 3';
  ELSIF p_type = 'DEROGATION' AND v_t.current_phase NOT IN ('PHASE_2_REDACTION', 'PHASE_3_VALIDATION_PRIORI') THEN
    RAISE EXCEPTION 'INVALID_PHASE: dérogation possible uniquement en phases 2-3';
  ELSIF p_type = 'APPROBATION_ATTRIBUTION' AND v_t.current_phase <> 'PHASE_11_ATTRIBUTION_DEFINITIVE' THEN
    RAISE EXCEPTION 'INVALID_PHASE: approbation possible uniquement en phase 11';
  END IF;
  IF p_decision <> 'FAVORABLE' AND char_length(COALESCE(p_motivation, '')) < 10 THEN
    RAISE EXCEPTION 'MOTIVATION_REQUIRED: toute décision non favorable doit être motivée';
  END IF;

  INSERT INTO dcmp_reviews (tender_id, institution_id, type, decision, motivation, reviewer_id, reviewer_role, document_path)
  VALUES (p_tender, v_t.institution_id, p_type, p_decision, p_motivation, auth.uid(), v_role, p_document_path)
  RETURNING id INTO v_id;

  IF v_t.current_phase = 'PHASE_3_VALIDATION_PRIORI' AND p_type IN ('AVIS_NON_OBJECTION', 'NON_OBJECTION_BAILLEUR') THEN
    IF p_decision <> 'FAVORABLE' THEN
      PERFORM _apply_transition(p_tender, 'PHASE_2_REDACTION', 'RECEVOIR_AVIS_DCMP', jsonb_build_object('type', p_type, 'decision', p_decision));
    ELSE
      SELECT EXISTS (SELECT 1 FROM dcmp_reviews r WHERE r.tender_id = p_tender AND r.type = 'AVIS_NON_OBJECTION'
                     AND r.decision = 'FAVORABLE' AND r.created_at >= v_t.transmis_dcmp_at) INTO v_dcmp_ok;
      SELECT (NOT v_t.is_cofinance) OR EXISTS (SELECT 1 FROM dcmp_reviews r WHERE r.tender_id = p_tender AND r.type = 'NON_OBJECTION_BAILLEUR'
                     AND r.decision = 'FAVORABLE' AND r.created_at >= v_t.transmis_dcmp_at) INTO v_bailleur_ok;
      IF v_dcmp_ok AND v_bailleur_ok AND (v_t.mode_passation <> 'ENTENTE_DIRECTE' OR EXISTS (
            SELECT 1 FROM dcmp_reviews r WHERE r.tender_id = p_tender AND r.type = 'DEROGATION' AND r.decision = 'FAVORABLE')) THEN
        PERFORM _apply_transition(p_tender, 'PHASE_4_PUBLICATION', 'RECEVOIR_AVIS_DCMP', jsonb_build_object('type', p_type, 'decision', p_decision));
      END IF;
    END IF;
  END IF;
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION record_review(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ------------------------------------------
-- RPC programmer_besoin : le PRM valide un besoin → création du marché en Phase 1 (PPM)
-- ------------------------------------------
CREATE OR REPLACE FUNCTION programmer_besoin(p_besoin UUID, p_decision TEXT, p_motif TEXT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE v_b besoins%ROWTYPE; v_tender UUID;
BEGIN
  SELECT * INTO v_b FROM besoins WHERE id = p_besoin FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BESOIN_NOT_FOUND'; END IF;
  IF v_b.institution_id IS DISTINCT FROM current_institution_id() OR current_user_role() <> 'PRM' THEN
    RAISE EXCEPTION 'FORBIDDEN: seul le PRM de l''institution valide un besoin';
  END IF;
  IF v_b.statut <> 'SOUMIS' THEN RAISE EXCEPTION 'INVALID_STATE: le besoin doit être soumis (statut actuel : %)', v_b.statut; END IF;

  IF p_decision = 'REJETER' THEN
    IF char_length(COALESCE(p_motif, '')) < 10 THEN RAISE EXCEPTION 'MOTIVATION_REQUIRED'; END IF;
    UPDATE besoins SET statut = 'REJETE', motif_rejet = p_motif, valide_par = auth.uid(), valide_le = NOW() WHERE id = p_besoin;
    RETURN NULL;
  ELSIF p_decision <> 'VALIDER' THEN RAISE EXCEPTION 'INVALID_DECISION'; END IF;

  INSERT INTO tenders (institution_id, title, description, nature_marche, montant_estime, corps_metier_id,
                       ligne_budgetaire, programme_budget, ppm_annee, ppm_trimestre, besoin_id, prm_id, created_by)
  VALUES (v_b.institution_id, v_b.intitule, v_b.description, v_b.nature_marche, v_b.montant_estime, v_b.corps_metier_id,
          v_b.ligne_budgetaire, v_b.programme_budget, v_b.annee_budget, v_b.trimestre_souhaite, v_b.id, auth.uid(), auth.uid())
  RETURNING id INTO v_tender;
  UPDATE besoins SET statut = 'PROGRAMME', tender_id = v_tender, valide_par = auth.uid(), valide_le = NOW() WHERE id = p_besoin;
  RETURN v_tender;
END $$;
GRANT EXECUTE ON FUNCTION programmer_besoin(UUID, TEXT, TEXT) TO authenticated;

-- ------------------------------------------
-- LOTS
-- ------------------------------------------
CREATE POLICY "lots_select" ON tender_lots FOR SELECT USING (
  is_inst_staff(institution_id) OR is_regulateur() OR bidder_can_see_tender(tender_id));
CREATE POLICY "lots_write" ON tender_lots FOR ALL USING (
  institution_id = current_institution_id() AND current_user_role() IN ('CPM', 'PRM')
  AND tender_phase_of(tender_id) IN ('PHASE_1_PROGRAMMATION', 'PHASE_2_REDACTION'))
  WITH CHECK (institution_id = current_institution_id() AND institution_id = tender_institution_of(tender_id)
  AND current_user_role() IN ('CPM', 'PRM') AND tender_phase_of(tender_id) IN ('PHASE_1_PROGRAMMATION', 'PHASE_2_REDACTION'));

-- ------------------------------------------
-- DOCUMENTS : circuit Rédaction → Relecture CPM → Validation PRM → (DCMP) → Publié
-- ------------------------------------------
CREATE POLICY "documents_select" ON tender_documents FOR SELECT USING (
  is_inst_staff(institution_id) OR is_regulateur() OR current_user_role() = 'COUR_COMPTES'
  OR (current_user_role() = 'SOUMISSIONNAIRE' AND is_locked AND bidder_can_see_tender(tender_id)
      AND (type IN ('TDR', 'DAO', 'ADDITIF', 'QR')
           OR (type = 'PV_OUVERTURE' AND tender_phase_of(tender_id) >= 'PHASE_7_OUVERTURE_PLIS')
           OR (type = 'DECISION_ATTRIBUTION' AND tender_phase_of(tender_id) >= 'PHASE_10_RECOURS'))));
CREATE POLICY "documents_insert" ON tender_documents FOR INSERT WITH CHECK (
  institution_id = current_institution_id() AND institution_id = tender_institution_of(tender_id)
  AND ((type IN ('TDR', 'DAO') AND current_user_role() IN ('SERVICE_DEMANDEUR', 'CPM', 'PRM')
        AND tender_phase_of(tender_id) IN ('PHASE_1_PROGRAMMATION', 'PHASE_2_REDACTION'))
    OR (type NOT IN ('TDR', 'DAO') AND current_user_role() IN ('CPM', 'PRM', 'TRESOR'))));
CREATE POLICY "documents_update" ON tender_documents FOR UPDATE USING (
  institution_id = current_institution_id() AND current_user_role() IN ('SERVICE_DEMANDEUR', 'CPM', 'PRM') AND NOT is_locked)
  WITH CHECK (institution_id = current_institution_id());

CREATE OR REPLACE FUNCTION tender_documents_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_app BOOLEAN := current_user IN ('authenticated', 'anon'); v_role TEXT := current_user_role();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_app THEN
      NEW.circuit_statut := 'REDACTION'; NEW.is_locked := false; NEW.locked_at := NULL; NEW.locked_by := NULL;
      NEW.is_signed := false; NEW.version := 1; NEW.created_by := auth.uid();
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: les documents ne sont jamais supprimés (traçabilité, CDC §9)';
  END IF;

  IF OLD.is_locked AND v_app THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: document verrouillé (transmis à la DCMP ou publié)';
  END IF;
  IF v_app THEN
    IF NEW.is_locked IS DISTINCT FROM OLD.is_locked OR NEW.is_signed IS DISTINCT FROM OLD.is_signed
       OR NEW.locked_at IS DISTINCT FROM OLD.locked_at OR NEW.tender_id IS DISTINCT FROM OLD.tender_id
       OR NEW.institution_id IS DISTINCT FROM OLD.institution_id OR NEW.type IS DISTINCT FROM OLD.type THEN
      RAISE EXCEPTION 'FORBIDDEN_COLUMN: colonnes de verrouillage/version non modifiables';
    END IF;
    IF NEW.circuit_statut IS DISTINCT FROM OLD.circuit_statut THEN
      IF NOT (
        (OLD.circuit_statut = 'REDACTION' AND NEW.circuit_statut = 'RELECTURE_CPM' AND v_role IN ('SERVICE_DEMANDEUR', 'CPM', 'PRM'))
        OR (OLD.circuit_statut = 'RELECTURE_CPM' AND NEW.circuit_statut = 'VALIDE_PRM' AND v_role = 'PRM')
        OR (OLD.circuit_statut = 'RELECTURE_CPM' AND NEW.circuit_statut = 'REDACTION' AND v_role IN ('CPM', 'PRM'))
        OR (OLD.circuit_statut = 'VALIDE_PRM' AND NEW.circuit_statut = 'REDACTION' AND v_role = 'PRM')) THEN
        RAISE EXCEPTION 'CIRCUIT_INVALID: passage % → % non autorisé pour le rôle %', OLD.circuit_statut, NEW.circuit_statut, v_role;
      END IF;
    END IF;
    IF NEW.contenu IS DISTINCT FROM OLD.contenu AND OLD.circuit_statut NOT IN ('REDACTION', 'RELECTURE_CPM') THEN
      RAISE EXCEPTION 'CIRCUIT_INVALID: le contenu n''est modifiable qu''en rédaction ou relecture';
    END IF;
  END IF;
  IF OLD.file_hash IS NOT NULL AND NEW.file_hash IS DISTINCT FROM OLD.file_hash THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: l''empreinte du fichier ne peut plus changer';
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END $$;
CREATE TRIGGER trig_tender_documents_guard BEFORE INSERT OR UPDATE OR DELETE ON tender_documents
  FOR EACH ROW EXECUTE FUNCTION tender_documents_guard();

-- Chaque modification de contenu ou de statut de circuit crée une version immuable.
CREATE OR REPLACE FUNCTION tender_documents_version()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.contenu IS DISTINCT FROM OLD.contenu OR NEW.circuit_statut IS DISTINCT FROM OLD.circuit_statut THEN
    INSERT INTO document_versions (document_id, tender_id, institution_id, version, contenu, content_hash, circuit_statut, author_id)
    VALUES (NEW.id, NEW.tender_id, NEW.institution_id,
            COALESCE((SELECT MAX(version) FROM document_versions WHERE document_id = NEW.id), 0) + 1,
            NEW.contenu, encode(digest(NEW.contenu::text, 'sha256'), 'hex'), NEW.circuit_statut, auth.uid());
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trig_tender_documents_version AFTER INSERT OR UPDATE ON tender_documents
  FOR EACH ROW EXECUTE FUNCTION tender_documents_version();
