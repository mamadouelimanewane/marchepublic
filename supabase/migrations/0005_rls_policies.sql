-- ==========================================
-- PLATEFORME MARCHÉS PUBLICS SÉNÉGAL
-- Migration 0005 : Row Level Security (RLS)
-- CRITIQUE : Isolation multi-tenant + Confidentialité offres
-- ==========================================

-- ==========================================
-- ACTIVATION RLS sur toutes les tables métier
-- ==========================================
ALTER TABLE institutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenders ENABLE ROW LEVEL SECURITY;
ALTER TABLE tender_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE tender_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE bid_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE appeals ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_amendments ENABLE ROW LEVEL SECURITY;
ALTER TABLE subcontractors ENABLE ROW LEVEL SECURITY;
ALTER TABLE pme_quotas_tracking ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- HELPER FUNCTIONS (Injectées par le middleware Next.js)
-- ==========================================

-- Récupère l'ID de l'institution courante (injecté par Edge Function)
CREATE OR REPLACE FUNCTION current_institution_id()
RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    current_setting('app.current_institution_id', true)::uuid,
    NULL
  )
$$;

-- Récupère le rôle de l'utilisateur courant
CREATE OR REPLACE FUNCTION current_user_role()
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('app.current_user_role', true), '')
$$;

-- Récupère le user_id courant
CREATE OR REPLACE FUNCTION current_user_id()
RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT auth.uid()
$$;

-- Vérifie si l'utilisateur a un rôle de régulateur (DCMP/ARCOP/Cour des Comptes)
CREATE OR REPLACE FUNCTION is_regulateur()
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT current_user_role() IN ('DCMP', 'ARCOP', 'COUR_COMPTES', 'ADMIN')
$$;

-- ==========================================
-- RLS : TABLE INSTITUTIONS
-- ==========================================
-- Admin voit tout / Utilisateurs voient leur institution
CREATE POLICY "institutions_select" ON institutions FOR SELECT
  USING (
    is_regulateur() OR
    id = current_institution_id()
  );

CREATE POLICY "institutions_admin_all" ON institutions FOR ALL
  USING (current_user_role() = 'ADMIN');

-- ==========================================
-- RLS : TABLE USERS
-- ==========================================
CREATE POLICY "users_own_institution" ON users FOR SELECT
  USING (
    is_regulateur() OR
    institution_id = current_institution_id() OR
    id = current_user_id()
  );

CREATE POLICY "users_soumissionnaire_select" ON users FOR SELECT
  USING (role = 'SOUMISSIONNAIRE');  -- Profils publics des soumissionnaires

-- ==========================================
-- RLS : TABLE TENDERS
-- Isolation stricte par institution
-- ==========================================
-- Lecture : institution propriétaire + régulateurs + soumissionnaires (phases publiées)
CREATE POLICY "tenders_select_institution" ON tenders FOR SELECT
  USING (
    -- L'institution propriétaire voit ses propres marchés
    institution_id = current_institution_id()
    -- Les régulateurs (DCMP, ARCOP) voient tout
    OR is_regulateur()
    -- Les soumissionnaires voient uniquement les marchés publiés (Phase 4+)
    OR (
      current_user_role() = 'SOUMISSIONNAIRE'
      AND current_phase >= 'PHASE_4_PUBLICATION'
    )
  );

-- Écriture : uniquement l'institution propriétaire (CPM, PRM, service demandeur)
CREATE POLICY "tenders_insert_institution" ON tenders FOR INSERT
  WITH CHECK (
    institution_id = current_institution_id()
    AND current_user_role() IN ('CPM', 'PRM', 'SERVICE_DEMANDEUR', 'ADMIN')
  );

CREATE POLICY "tenders_update_institution" ON tenders FOR UPDATE
  USING (
    institution_id = current_institution_id()
    AND current_user_role() IN ('CPM', 'PRM', 'ADMIN')
  );

-- ==========================================
-- RLS : TABLE BIDS (CRITIQUE - Confidentialité des offres)
-- ==========================================

-- SELECT : RÈGLE DE CONFIDENTIALITÉ FONDAMENTALE
CREATE POLICY "bids_confidentiality" ON bids FOR SELECT
  USING (
    -- ADMIN voit tout
    current_user_role() = 'ADMIN'
    -- SOUMISSIONNAIRE voit uniquement SES propres offres
    OR (
      current_user_role() = 'SOUMISSIONNAIRE'
      AND soumissionnaire_id = current_user_id()
    )
    -- CPM/PRM/EVALUATEUR/DCMP/ARCOP ne voient les offres QUE APRÈS Phase 7
    OR (
      current_user_role() IN ('CPM', 'PRM', 'EVALUATEUR', 'DCMP', 'ARCOP')
      AND institution_id = current_institution_id()
      AND EXISTS (
        SELECT 1 FROM tenders t
        WHERE t.id = tender_id
        AND t.current_phase >= 'PHASE_7_OUVERTURE_PLIS'
      )
    )
  );

-- INSERT : Soumissionnaires uniquement
CREATE POLICY "bids_insert_soumissionnaire" ON bids FOR INSERT
  WITH CHECK (
    current_user_role() = 'SOUMISSIONNAIRE'
    AND soumissionnaire_id = current_user_id()
    -- Vérification : marché en Phase 6 uniquement
    AND EXISTS (
      SELECT 1 FROM tenders t
      WHERE t.id = tender_id
      AND t.current_phase = 'PHASE_6_DEPOT_OFFRES'
      AND NOW() < t.date_limite_depot  -- Avant date limite !
    )
  );

-- UPDATE : CPM après ouverture, Évaluateurs pour noter
CREATE POLICY "bids_update_after_opening" ON bids FOR UPDATE
  USING (
    current_user_role() IN ('CPM', 'EVALUATEUR', 'ADMIN')
    AND institution_id = current_institution_id()
    AND EXISTS (
      SELECT 1 FROM tenders t
      WHERE t.id = tender_id
      AND t.current_phase >= 'PHASE_7_OUVERTURE_PLIS'
    )
  );

-- ==========================================
-- RLS : TABLE APPEALS (ARCOP)
-- ==========================================
CREATE POLICY "appeals_select" ON appeals FOR SELECT
  USING (
    -- Institution concernée
    institution_id = current_institution_id()
    -- ARCOP voit tous les recours
    OR current_user_role() IN ('ARCOP', 'DCMP', 'ADMIN')
    -- Requérant voit son propre recours
    OR (requerant_id = current_user_id())
  );

CREATE POLICY "appeals_insert_soumissionnaire" ON appeals FOR INSERT
  WITH CHECK (
    current_user_role() = 'SOUMISSIONNAIRE'
    AND requerant_id = current_user_id()
  );

CREATE POLICY "appeals_update_arcop" ON appeals FOR UPDATE
  USING (current_user_role() IN ('ARCOP', 'ADMIN'));

-- ==========================================
-- RLS : TABLE CONTRACTS
-- ==========================================
CREATE POLICY "contracts_select" ON contracts FOR SELECT
  USING (
    institution_id = current_institution_id()
    OR is_regulateur()
    OR (current_user_role() = 'SOUMISSIONNAIRE' AND attributaire_id = current_user_id())
  );

-- ==========================================
-- RLS : TABLE AUDIT_LOGS (définie dans migration 0006)
-- Lecture : DCMP, ARCOP, Cour des Comptes, Admin
-- Écriture : Uniquement via triggers (jamais depuis l'app)
-- ==========================================
