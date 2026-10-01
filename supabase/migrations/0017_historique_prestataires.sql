-- ==========================================
-- Migration 0017 : Historique de performance des prestataires
--   • droit de réponse du fournisseur évalué (principe du contradictoire)
--   • historique consultable par l'autorité qui évalue des candidats (critère de performance passée) et par les régulateurs
--   • publication publique en AGRÉGAT uniquement, à partir de 3 évaluations (jamais de commentaire individuel)
-- ==========================================

ALTER TABLE provider_evaluations ADD COLUMN IF NOT EXISTS reponse_fournisseur TEXT;
ALTER TABLE provider_evaluations ADD COLUMN IF NOT EXISTS reponse_le TIMESTAMPTZ;

-- Le prestataire évalué lit sa propre évaluation (politique 0009) et peut y répondre une seule fois.
CREATE OR REPLACE FUNCTION respond_to_evaluation(p_eval UUID, p_reponse TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE v_e provider_evaluations%ROWTYPE;
BEGIN
  SELECT * INTO v_e FROM provider_evaluations WHERE id = p_eval FOR UPDATE;
  IF NOT FOUND OR v_e.prestataire_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'FORBIDDEN: seul le prestataire évalué peut répondre'; END IF;
  IF v_e.reponse_fournisseur IS NOT NULL THEN RAISE EXCEPTION 'INVALID_STATE: une réponse a déjà été enregistrée'; END IF;
  IF char_length(COALESCE(p_reponse, '')) NOT BETWEEN 20 AND 2000 THEN RAISE EXCEPTION 'INVALID_INPUT: réponse de 20 à 2000 caractères'; END IF;
  UPDATE provider_evaluations SET reponse_fournisseur = trim(p_reponse), reponse_le = NOW() WHERE id = p_eval;
  PERFORM write_audit('PROVIDER_EVALUATION_RESPONSE', 'provider_evaluation', p_eval, v_e.institution_id);
END $$;
GRANT EXECUTE ON FUNCTION respond_to_evaluation(UUID, TEXT) TO authenticated;

-- Interdit de modifier une évaluation après coup (seule la réponse du prestataire s'ajoute, par la fonction ci-dessus).
CREATE OR REPLACE FUNCTION provider_evaluations_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'IMMUTABLE_RECORD: une évaluation ne se supprime pas'; END IF;
  -- note_globale est une colonne générée : calculée après le déclencheur BEFORE, elle est exclue de la comparaison.
  IF to_jsonb(NEW) - 'reponse_fournisseur' - 'reponse_le' - 'note_globale' IS DISTINCT FROM to_jsonb(OLD) - 'reponse_fournisseur' - 'reponse_le' - 'note_globale' THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: une évaluation ne se modifie pas';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trig_provider_evaluations_immutable BEFORE UPDATE OR DELETE ON provider_evaluations FOR EACH ROW EXECUTE FUNCTION provider_evaluations_immutable();
REVOKE UPDATE, DELETE ON provider_evaluations FROM anon, authenticated;

-- Historique d'un fournisseur : volume, notes, rigueur contractuelle (avenants), paiements.
-- Accessible au titulaire, au personnel qui peut voir ce candidat (après ouverture des plis), aux régulateurs.
CREATE OR REPLACE FUNCTION supplier_track_record(p_user UUID)
RETURNS TABLE (nb_contrats INTEGER, nb_evaluations INTEGER, note_qualite NUMERIC, note_delai NUMERIC, note_cout NUMERIC, note_globale NUMERIC,
               montant_total BIGINT, taux_avenants_moyen NUMERIC, nb_incidents_critiques INTEGER)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp SET row_security = off AS $$
BEGIN
  IF NOT (p_user = auth.uid() OR bidder_visible_to_staff(p_user) OR is_regulateur() OR current_user_role() IN ('COUR_COMPTES', 'ADMIN')) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  RETURN QUERY
  SELECT (SELECT COUNT(*)::int FROM contracts c WHERE c.attributaire_id = p_user),
         (SELECT COUNT(*)::int FROM provider_evaluations e WHERE e.prestataire_id = p_user),
         (SELECT ROUND(AVG(e.note_qualite), 2) FROM provider_evaluations e WHERE e.prestataire_id = p_user),
         (SELECT ROUND(AVG(e.note_delai), 2) FROM provider_evaluations e WHERE e.prestataire_id = p_user),
         (SELECT ROUND(AVG(e.note_cout), 2) FROM provider_evaluations e WHERE e.prestataire_id = p_user),
         (SELECT ROUND(AVG(e.note_globale), 2) FROM provider_evaluations e WHERE e.prestataire_id = p_user),
         (SELECT COALESCE(SUM(COALESCE(c.montant_actuel, c.montant_initial)), 0)::bigint FROM contracts c WHERE c.attributaire_id = p_user),
         (SELECT ROUND(AVG(100.0 * COALESCE((SELECT SUM(GREATEST(a.montant_avenant, 0)) FROM contract_amendments a WHERE a.contract_id = c.id), 0) / c.montant_initial), 2)
            FROM contracts c WHERE c.attributaire_id = p_user),
         (SELECT COUNT(*)::int FROM execution_incidents i JOIN contracts c ON c.id = i.contract_id WHERE c.attributaire_id = p_user AND i.gravite = 'CRITIQUE');
END $$;
GRANT EXECUTE ON FUNCTION supplier_track_record(UUID) TO authenticated;

-- Publication en agrégat : au moins 3 évaluations, notes moyennes et volume. Aucune évaluation individuelle ni commentaire.
CREATE OR REPLACE VIEW v_public_prestataires WITH (security_invoker = false) AS
SELECT u.full_name AS prestataire, COUNT(*)::int AS nb_evaluations,
       ROUND(AVG(e.note_globale), 1) AS note_moyenne, ROUND(AVG(e.note_qualite), 1) AS note_qualite,
       ROUND(AVG(e.note_delai), 1) AS note_delai, ROUND(AVG(e.note_cout), 1) AS note_cout,
       (SELECT COALESCE(SUM(COALESCE(c.montant_actuel, c.montant_initial)), 0)::bigint FROM contracts c WHERE c.attributaire_id = u.id) AS montant_contrats
FROM provider_evaluations e JOIN users u ON u.id = e.prestataire_id
GROUP BY u.id, u.full_name HAVING COUNT(*) >= 3;
GRANT SELECT ON v_public_prestataires TO anon, authenticated;
