-- ==========================================
-- Migration 0014 : Procédure infructueuse et relance
-- Déclarée par le PRM en phase 8 lorsqu'aucune offre qualifiée n'est classée : le marché est clos sans contrat
-- (issue INFRUCTUEUX, dossier archivable), puis relancé sous forme d'un NOUVEAU marché (historique intact).
-- ==========================================

CREATE OR REPLACE FUNCTION _declare_infructueux(p_tender UUID, p_payload JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_t tenders%ROWTYPE; r RECORD;
BEGIN
  SELECT * INTO v_t FROM tenders WHERE id = p_tender FOR UPDATE;
  IF char_length(COALESCE(p_payload->>'motif', '')) < 20 THEN
    RAISE EXCEPTION 'MOTIVATION_REQUIRED: motif détaillé (20 caractères min.) requis';
  END IF;
  UPDATE tenders SET issue = 'INFRUCTUEUX', motif_infructueux = p_payload->>'motif' WHERE id = p_tender;
  FOR r IN SELECT DISTINCT soumissionnaire_id FROM bids WHERE tender_id = p_tender AND status NOT IN ('RETARDEE', 'RETIREE', 'BROUILLON') LOOP
    PERFORM notify_user(r.soumissionnaire_id, p_tender, 'INFRUCTUEUX', 'Procédure déclarée infructueuse', v_t.reference || ' : ' || (p_payload->>'motif'));
  END LOOP;
  FOR r IN SELECT id FROM users WHERE role = 'DCMP' AND is_active LOOP
    PERFORM notify_user(r.id, p_tender, 'INFRUCTUEUX', 'Procédure infructueuse', v_t.reference || ' : ' || (p_payload->>'motif'));
  END LOOP;
  PERFORM write_audit('PROCEDURE_INFRUCTUEUSE', 'tender', p_tender, v_t.institution_id, NULL, jsonb_build_object('motif', p_payload->>'motif'));
END $$;
REVOKE ALL ON FUNCTION _declare_infructueux(UUID, JSONB) FROM PUBLIC, anon, authenticated;

-- Relance : nouveau marché en phase 1 reprenant le besoin (un seul par marché infructueux).
CREATE OR REPLACE FUNCTION relancer_marche(p_tender UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_t tenders%ROWTYPE; v_id UUID;
BEGIN
  SELECT * INTO v_t FROM tenders WHERE id = p_tender FOR UPDATE;
  IF NOT FOUND OR v_t.institution_id IS DISTINCT FROM current_institution_id() OR current_user_role() <> 'PRM' THEN
    RAISE EXCEPTION 'FORBIDDEN: réservé au PRM de l''autorité contractante';
  END IF;
  IF v_t.issue IS DISTINCT FROM 'INFRUCTUEUX' THEN RAISE EXCEPTION 'INVALID_STATE: seul un marché déclaré infructueux peut être relancé'; END IF;
  IF EXISTS (SELECT 1 FROM tenders WHERE relance_de = p_tender) THEN RAISE EXCEPTION 'ALREADY_RELAUNCHED: ce marché a déjà été relancé'; END IF;

  INSERT INTO tenders (institution_id, title, description, nature_marche, corps_metier_id, montant_estime, ligne_budgetaire, programme_budget,
                       ppm_annee, ppm_trimestre, is_reserve_pme, is_reserve_pme_feminine, is_cofinance, is_alloti, nombre_lots,
                       criteres_evaluation, prm_id, cpm_id, created_by, relance_de)
  VALUES (v_t.institution_id, v_t.title, v_t.description, v_t.nature_marche, v_t.corps_metier_id, v_t.montant_estime, v_t.ligne_budgetaire, v_t.programme_budget,
          EXTRACT(YEAR FROM NOW())::int, v_t.ppm_trimestre, v_t.is_reserve_pme, v_t.is_reserve_pme_feminine, v_t.is_cofinance, v_t.is_alloti, v_t.nombre_lots,
          v_t.criteres_evaluation, auth.uid(), v_t.cpm_id, auth.uid(), p_tender)
  RETURNING id INTO v_id;
  PERFORM write_audit('TENDER_RELAUNCHED', 'tender', v_id, v_t.institution_id, NULL, jsonb_build_object('relance_de', p_tender));
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION relancer_marche(UUID) TO authenticated;
