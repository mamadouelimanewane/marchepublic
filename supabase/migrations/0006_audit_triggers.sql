-- ==========================================
-- PLATEFORME MARCHÉS PUBLICS SÉNÉGAL
-- Migration 0006 : Audit Trail WORM + Triggers métier
-- Immuable : Aucun UPDATE ni DELETE autorisé
-- ==========================================

-- ==========================================
-- TABLE : JOURNAL D'AUDIT (WORM - Append Only)
-- ==========================================
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Multi-tenant
  institution_id UUID REFERENCES institutions(id),
  -- Qui
  user_id UUID REFERENCES users(id),
  user_role TEXT,
  user_name TEXT,
  -- Quoi
  action TEXT NOT NULL,               -- ex: 'TENDER_CREATED', 'BID_SUBMITTED', 'PHASE_TRANSITION'
  entity_type TEXT NOT NULL,          -- ex: 'tender', 'bid', 'appeal'
  entity_id UUID NOT NULL,
  -- Changement
  old_value JSONB,                    -- Valeur avant
  new_value JSONB,                    -- Valeur après
  metadata JSONB,                     -- Données contextuelles supplémentaires
  -- Traçabilité technique
  ip_address INET,
  user_agent TEXT,
  request_id TEXT,
  -- Quand (immuable)
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- PAS de updated_at : ce champ n'existe pas intentionnellement
);

-- Index pour consultation rapide
CREATE INDEX idx_audit_institution ON audit_logs(institution_id, occurred_at DESC);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id, occurred_at DESC);
CREATE INDEX idx_audit_user ON audit_logs(user_id, occurred_at DESC);
CREATE INDEX idx_audit_action ON audit_logs(action, occurred_at DESC);

-- RLS : Lecture DCMP/ARCOP/Cour des Comptes/Admin uniquement
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_select_regulateurs" ON audit_logs FOR SELECT
  USING (
    current_user_role() IN ('DCMP', 'ARCOP', 'COUR_COMPTES', 'ADMIN')
    OR (
      -- Institution voit ses propres logs
      institution_id = current_institution_id()
      AND current_user_role() IN ('PRM', 'CPM')
    )
  );

-- APPEND-ONLY : Interdiction UPDATE et DELETE
CREATE POLICY "audit_no_update" ON audit_logs FOR UPDATE USING (false);
CREATE POLICY "audit_no_delete" ON audit_logs FOR DELETE USING (false);
-- INSERT uniquement via triggers ou service role
CREATE POLICY "audit_insert_system" ON audit_logs FOR INSERT
  WITH CHECK (true);  -- Restreint via service_role uniquement côté app

-- ==========================================
-- TRIGGER : Log automatique des transitions de phases
-- ==========================================
CREATE OR REPLACE FUNCTION log_phase_transition()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.current_phase IS DISTINCT FROM NEW.current_phase THEN
    INSERT INTO audit_logs (
      institution_id, user_id, user_role, action,
      entity_type, entity_id, old_value, new_value, occurred_at
    ) VALUES (
      NEW.institution_id,
      current_setting('app.current_user_id', true)::uuid,
      current_setting('app.current_user_role', true),
      'PHASE_TRANSITION',
      'tender',
      NEW.id,
      jsonb_build_object('phase', OLD.current_phase),
      jsonb_build_object('phase', NEW.current_phase),
      NOW()
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trig_log_phase_transition
  AFTER UPDATE ON tenders
  FOR EACH ROW EXECUTE FUNCTION log_phase_transition();

-- ==========================================
-- TRIGGER : Contrôle HARD LOCK Avenants (30%)
-- ==========================================
CREATE OR REPLACE FUNCTION check_amendment_limit()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  montant_initial BIGINT;
  cumul_actuel BIGINT;
  plafond NUMERIC;
BEGIN
  -- Récupérer montant initial du contrat
  SELECT c.montant_initial INTO montant_initial
  FROM contracts c WHERE c.id = NEW.contract_id;

  -- Récupérer le plafond depuis config_seuils
  SELECT valeur::numeric INTO plafond
  FROM config_seuils WHERE cle = 'AVENANT_PLAFOND';

  -- Calculer le cumul avant cet avenant
  SELECT COALESCE(SUM(montant_avenant), 0) INTO cumul_actuel
  FROM contract_amendments
  WHERE contract_id = NEW.contract_id;

  NEW.cumul_avant := cumul_actuel;
  NEW.cumul_apres := cumul_actuel + NEW.montant_avenant;
  NEW.pourcentage := ROUND((NEW.cumul_apres::numeric / montant_initial * 100), 2);

  IF NEW.cumul_apres > (montant_initial * plafond) THEN
    NEW.depasse_seuil := true;
    -- Log alerte
    INSERT INTO audit_logs (action, entity_type, entity_id, new_value, occurred_at)
    VALUES (
      'AMENDMENT_SEUIL_DEPASSE',
      'contract_amendment',
      NEW.id,
      jsonb_build_object(
        'contract_id', NEW.contract_id,
        'cumul', NEW.cumul_apres,
        'montant_initial', montant_initial,
        'pourcentage', NEW.pourcentage
      ),
      NOW()
    );
    -- HARD LOCK : Lever une exception si dépassement
    RAISE EXCEPTION 'AVENANT_LIMIT_EXCEEDED: Le cumul des avenants (%) dépasse le plafond légal de 30%% du montant initial (%). Montant initial: % FCFA, Cumul actuel: % FCFA',
      NEW.pourcentage, plafond * 100, montant_initial, NEW.cumul_apres;
  END IF;

  -- Mettre à jour le cumul sur le tender
  UPDATE tenders SET montant_avenants_cumule = NEW.cumul_apres
  WHERE id = (SELECT tender_id FROM contracts WHERE id = NEW.contract_id);

  RETURN NEW;
END;
$$;

CREATE TRIGGER trig_check_amendment_limit
  BEFORE INSERT ON contract_amendments
  FOR EACH ROW EXECUTE FUNCTION check_amendment_limit();

-- ==========================================
-- TRIGGER : Contrôle HARD LOCK Sous-traitance (40%)
-- ==========================================
CREATE OR REPLACE FUNCTION check_subcontractor_limit()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  montant_marche BIGINT;
  total_soustrait BIGINT;
  plafond NUMERIC;
  pourcentage NUMERIC;
BEGIN
  SELECT c.montant_initial INTO montant_marche
  FROM contracts c WHERE c.id = NEW.contract_id;

  SELECT valeur::numeric INTO plafond
  FROM config_seuils WHERE cle = 'SOUSTRAITANCE_PLAFOND';

  SELECT COALESCE(SUM(montant), 0) INTO total_soustrait
  FROM subcontractors WHERE contract_id = NEW.contract_id;

  total_soustrait := total_soustrait + NEW.montant;
  pourcentage := ROUND((total_soustrait::numeric / montant_marche * 100), 2);
  NEW.pourcentage := pourcentage;

  IF total_soustrait > (montant_marche * plafond) THEN
    NEW.depasse_seuil := true;
    RAISE EXCEPTION 'SUBCONTRACTOR_LIMIT_EXCEEDED: La sous-traitance (%) dépasse le plafond légal de 40%% du montant du marché.',
      pourcentage;
  END IF;

  -- Mettre à jour sur le tender
  UPDATE tenders SET montant_soustrait_cumule = total_soustrait
  WHERE id = (SELECT tender_id FROM contracts WHERE id = NEW.contract_id);

  RETURN NEW;
END;
$$;

CREATE TRIGGER trig_check_subcontractor_limit
  BEFORE INSERT ON subcontractors
  FOR EACH ROW EXECUTE FUNCTION check_subcontractor_limit();

-- ==========================================
-- TRIGGER : Mise à jour quotas PME après attribution
-- ==========================================
CREATE OR REPLACE FUNCTION update_pme_quotas()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  is_pme_rec BOOLEAN;
  is_pme_fem BOOLEAN;
  montant BIGINT;
BEGIN
  IF NEW.current_phase = 'PHASE_11_ATTRIBUTION_DEFINITIVE'
     AND OLD.current_phase != 'PHASE_11_ATTRIBUTION_DEFINITIVE'
     AND NEW.attributaire_id IS NOT NULL THEN

    -- Vérifier si l'attributaire est PME
    SELECT u.is_pme, u.is_pme_feminine INTO is_pme_rec, is_pme_fem
    FROM users u WHERE u.id = NEW.attributaire_id;

    montant := COALESCE(NEW.montant_attribue, NEW.montant_estime, 0);

    -- Mettre à jour les quotas PME pour l'année fiscale courante
    INSERT INTO pme_quotas_tracking (institution_id, annee_fiscale, montant_total_marches, montant_pme, montant_pme_féminine)
    VALUES (NEW.institution_id, EXTRACT(YEAR FROM NOW())::integer, montant, 0, 0)
    ON CONFLICT (institution_id, annee_fiscale) DO UPDATE
    SET montant_total_marches = pme_quotas_tracking.montant_total_marches + montant;

    IF is_pme_rec THEN
      UPDATE pme_quotas_tracking
      SET montant_pme = montant_pme + montant,
          taux_pme = ROUND((montant_pme + montant)::numeric / (montant_total_marches) * 100, 2)
      WHERE institution_id = NEW.institution_id AND annee_fiscale = EXTRACT(YEAR FROM NOW())::integer;
    END IF;

    IF is_pme_fem THEN
      UPDATE pme_quotas_tracking
      SET montant_pme_féminine = montant_pme_féminine + montant,
          taux_pme_feminine = ROUND((montant_pme_féminine + montant)::numeric / (montant_total_marches) * 100, 2)
      WHERE institution_id = NEW.institution_id AND annee_fiscale = EXTRACT(YEAR FROM NOW())::integer;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trig_update_pme_quotas
  AFTER UPDATE ON tenders
  FOR EACH ROW EXECUTE FUNCTION update_pme_quotas();

-- ==========================================
-- TRIGGER : Sync has_appeal_pending sur tenders
-- HARD LOCK : Mis à jour automatiquement depuis appeals
-- ==========================================
CREATE OR REPLACE FUNCTION sync_appeal_status()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Mettre à jour has_appeal_pending sur le tender
  UPDATE tenders SET
    has_appeal_pending = EXISTS (
      SELECT 1 FROM appeals a
      WHERE a.tender_id = COALESCE(NEW.tender_id, OLD.tender_id)
      AND a.status IN ('DEPOSE', 'EN_INSTRUCTION')
    ),
    arcop_decision = NEW.status::text
  WHERE id = COALESCE(NEW.tender_id, OLD.tender_id);

  RETURN NEW;
END;
$$;

CREATE TRIGGER trig_sync_appeal_status
  AFTER INSERT OR UPDATE ON appeals
  FOR EACH ROW EXECUTE FUNCTION sync_appeal_status();
