-- ==========================================
-- Migration 0013 : Portail public, bailleurs, additifs au DAO
-- ==========================================

-- Statistiques publiques de la page d'accueil (aucune donnée sensible : simples compteurs).
CREATE OR REPLACE VIEW v_stats_publiques WITH (security_invoker = false) AS
SELECT
  (SELECT COUNT(*)::int FROM tenders t WHERE t.current_phase BETWEEN 'PHASE_5_CLARIFICATIONS' AND 'PHASE_6_DEPOT_OFFRES' AND t.date_publication IS NOT NULL) AS avis_ouverts,
  (SELECT COUNT(*)::int FROM institutions i WHERE i.is_active) AS institutions,
  (SELECT COUNT(*)::int FROM tenders t WHERE t.current_phase >= 'PHASE_10_RECOURS') AS marches_attribues;
GRANT SELECT ON v_stats_publiques TO anon, authenticated;

-- Le bailleur de fonds consulte le dossier des marchés qu'il cofinance.
CREATE POLICY "documents_select_bailleur" ON tender_documents FOR SELECT USING (
  current_user_role() = 'BAILLEUR' AND type IN ('TDR', 'DAO', 'ADDITIF')
  AND EXISTS (SELECT 1 FROM tenders t WHERE t.id = tender_id AND t.is_cofinance));

-- Corps de métier et institutions : lecture publique de la nomenclature (filtres du portail).
DROP POLICY IF EXISTS "corps_metiers_read" ON corps_metiers;
CREATE POLICY "corps_metiers_read" ON corps_metiers FOR SELECT USING (true);

-- Additif au DAO : publié immédiatement (verrouillé), horodaté, notifié à tous les candidats ayant retiré le dossier.
CREATE OR REPLACE FUNCTION publish_addendum(p_tender UUID, p_titre TEXT, p_contenu TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_t tenders%ROWTYPE; v_id UUID; r RECORD;
BEGIN
  SELECT * INTO v_t FROM tenders WHERE id = p_tender FOR UPDATE;
  IF NOT FOUND OR v_t.institution_id IS DISTINCT FROM current_institution_id() OR current_user_role() NOT IN ('CPM', 'PRM') THEN
    RAISE EXCEPTION 'FORBIDDEN: réservé à la cellule de passation de l''autorité contractante';
  END IF;
  IF v_t.current_phase NOT IN ('PHASE_5_CLARIFICATIONS', 'PHASE_6_DEPOT_OFFRES') THEN
    RAISE EXCEPTION 'INVALID_PHASE: un additif se publie pendant les phases 5 et 6';
  END IF;
  IF char_length(COALESCE(p_titre, '')) < 5 OR char_length(COALESCE(p_contenu, '')) < 10 THEN
    RAISE EXCEPTION 'INVALID_INPUT: titre et contenu de l''additif requis';
  END IF;

  INSERT INTO tender_documents (tender_id, institution_id, type, titre, contenu, circuit_statut, is_locked, locked_at, locked_by, created_by)
  VALUES (p_tender, v_t.institution_id, 'ADDITIF', p_titre,
          jsonb_build_object('sections', jsonb_build_array(jsonb_build_object('id', 'additif', 'titre', p_titre, 'contenu', p_contenu))),
          'PUBLIE', true, NOW(), auth.uid(), auth.uid())
  RETURNING id INTO v_id;

  FOR r IN SELECT soumissionnaire_id FROM dossier_retraits WHERE tender_id = p_tender LOOP
    PERFORM notify_user(r.soumissionnaire_id, p_tender, 'ADDITIF', 'Additif au dossier d''appel d''offres', p_titre);
  END LOOP;
  PERFORM write_audit('ADDENDUM_PUBLISHED', 'tender', p_tender, v_t.institution_id, NULL, jsonb_build_object('document_id', v_id, 'titre', p_titre));
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION publish_addendum(UUID, TEXT, TEXT) TO authenticated;

-- Questions-réponses diffusées à tous les candidats d'un marché, SANS auteur (confidentialité des candidats).
CREATE OR REPLACE VIEW v_clarifications_publiques WITH (security_invoker = false) AS
SELECT c.id, c.tender_id, c.question, c.reponse, c.repondu_le, c.created_at
FROM clarifications c
WHERE c.publie AND bidder_can_see_tender(c.tender_id);
GRANT SELECT ON v_clarifications_publiques TO authenticated;
REVOKE ALL ON v_clarifications_publiques FROM anon;
