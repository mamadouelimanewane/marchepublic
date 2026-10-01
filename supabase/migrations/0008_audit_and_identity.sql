-- ==========================================
-- Migration 0008 : Audit WORM chaîné, identité, verrouillage des tables de paramétrage
-- Corrige : journal d'audit falsifiable, tables de paramétrage modifiables par tout utilisateur,
--           absence de création de profil à l'inscription, auto-promotion de rôle.
-- ==========================================

-- ------------------------------------------
-- 1. PARAMÉTRAGE : lecture pour tous, écriture ADMIN uniquement (CDC §6, §8)
-- ------------------------------------------
ALTER TABLE config_seuils ENABLE ROW LEVEL SECURITY;
ALTER TABLE corps_metiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "config_seuils_read" ON config_seuils FOR SELECT USING (true);
CREATE POLICY "config_seuils_admin_write" ON config_seuils FOR ALL
  USING (current_user_role() = 'ADMIN') WITH CHECK (current_user_role() = 'ADMIN');
CREATE POLICY "corps_metiers_read" ON corps_metiers FOR SELECT USING (true);
CREATE POLICY "corps_metiers_admin_write" ON corps_metiers FOR ALL
  USING (current_user_role() = 'ADMIN') WITH CHECK (current_user_role() = 'ADMIN');

-- Paramètres complémentaires (CDC §2.3, §6) — réglables par l'administrateur sans redéploiement
INSERT INTO config_seuils (cle, valeur, description) VALUES
  ('DELAI_INSTRUCTION_RECOURS_JOURS', '7', 'Délai imparti à l''ARCOP pour statuer sur un recours (jours) — à confirmer avec le texte en vigueur'),
  ('EVAL_SEUIL_TECHNIQUE', '70', 'Note technique minimale (/100) pour être admis à l''évaluation financière'),
  ('EVAL_POIDS_TECHNIQUE', '0.70', 'Pondération de la note technique dans la note globale (fournitures/travaux)'),
  ('EVAL_POIDS_TECHNIQUE_PI', '0.80', 'Pondération de la note technique pour les prestations intellectuelles'),
  ('DELAI_DEPOT_OFFRES_MIN_AOO_2ETAPES', '30', 'Délai minimal de dépôt — appel d''offres en deux étapes (jours)'),
  ('DELAI_DEPOT_OFFRES_MIN_CONCOURS', '30', 'Délai minimal de dépôt — concours (jours)'),
  ('DELAI_DEPOT_OFFRES_MIN_ACCORD_CADRE', '30', 'Délai minimal de dépôt — accord-cadre (jours)'),
  ('DELAI_DEPOT_OFFRES_MIN_ENTENTE_DIRECTE', '0', 'Entente directe : aucun délai de publicité'),
  ('ALERTE_GARANTIE_JOURS', '30', 'Alerte avant expiration d''une garantie (jours)')
ON CONFLICT (cle) DO NOTHING;

-- ------------------------------------------
-- 2. UTILISATEURS
-- ------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_ess BOOLEAN NOT NULL DEFAULT false;      -- économie sociale et solidaire
ALTER TABLE users ADD COLUMN IF NOT EXISTS ninea_verified_at TIMESTAMPTZ;
UPDATE users SET is_pme = false WHERE is_pme IS NULL;
UPDATE users SET is_pme_feminine = false WHERE is_pme_feminine IS NULL;
ALTER TABLE users ALTER COLUMN is_pme SET NOT NULL;
ALTER TABLE users ALTER COLUMN is_pme_feminine SET NOT NULL;

-- Création automatique du profil : TOUJOURS soumissionnaire. Les comptes institutionnels sont
-- créés par l'administrateur (service_role), jamais depuis des métadonnées fournies par le client.
CREATE OR REPLACE FUNCTION handle_new_auth_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
BEGIN
  INSERT INTO public.users (id, role, full_name, email)
  VALUES (NEW.id, 'SOUMISSIONNAIRE',
          COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), split_part(NEW.email, '@', 1)),
          NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $$;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_auth_user();

-- Un utilisateur connecté ne peut modifier que son profil non sensible.
CREATE POLICY "users_update_self" ON users FOR UPDATE
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "users_admin_all" ON users FOR ALL
  USING (current_user_role() = 'ADMIN') WITH CHECK (current_user_role() = 'ADMIN');

-- Colonnes sensibles : jamais modifiables par le rôle applicatif (authenticated/anon).
CREATE OR REPLACE FUNCTION users_guard_sensitive()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') AND current_user_role() <> 'ADMIN' THEN
    IF NEW.role IS DISTINCT FROM OLD.role
       OR NEW.institution_id IS DISTINCT FROM OLD.institution_id
       OR NEW.is_active IS DISTINCT FROM OLD.is_active
       OR NEW.is_pme IS DISTINCT FROM OLD.is_pme
       OR NEW.is_pme_feminine IS DISTINCT FROM OLD.is_pme_feminine
       OR NEW.is_ess IS DISTINCT FROM OLD.is_ess
       OR NEW.ninea_verified_at IS DISTINCT FROM OLD.ninea_verified_at
       OR NEW.email IS DISTINCT FROM OLD.email
       OR NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'FORBIDDEN_COLUMN: modification interdite de colonnes protégées du profil';
    END IF;
    IF OLD.ninea_verified_at IS NOT NULL
       AND (NEW.ninea IS DISTINCT FROM OLD.ninea OR NEW.rccm IS DISTINCT FROM OLD.rccm) THEN
      RAISE EXCEPTION 'FORBIDDEN_COLUMN: NINEA/RCCM vérifiés, contactez l''administrateur';
    END IF;
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END $$;

CREATE TRIGGER trig_users_guard BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION users_guard_sensitive();

-- ------------------------------------------
-- 3. JOURNAL D'AUDIT : WORM + chaînage cryptographique (CDC §9)
-- ------------------------------------------
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS prev_hash TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS row_hash TEXT;
-- Ordre total de la chaîne : l'horloge peut produire des égalités, pas une séquence.
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS seq BIGINT GENERATED ALWAYS AS IDENTITY;
CREATE INDEX IF NOT EXISTS idx_audit_chain ON audit_logs (institution_id, seq DESC);
ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_user_id_fkey;   -- l'historique survit à la suppression d'un compte

DROP POLICY IF EXISTS "audit_insert_system" ON audit_logs;
DROP POLICY IF EXISTS "audit_no_update" ON audit_logs;
DROP POLICY IF EXISTS "audit_no_delete" ON audit_logs;
DROP POLICY IF EXISTS "audit_select_regulateurs" ON audit_logs;

-- Plus aucune écriture directe : uniquement write_audit() (SECURITY DEFINER).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON audit_logs FROM PUBLIC, anon, authenticated, service_role;

CREATE POLICY "audit_select" ON audit_logs FOR SELECT USING (
  current_user_role() IN ('DCMP', 'ARCOP', 'COUR_COMPTES', 'ADMIN')
  OR (institution_id = current_institution_id() AND current_user_role() IN ('PRM', 'CPM'))
);

CREATE OR REPLACE FUNCTION audit_block_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT_IMMUTABLE: le journal d''audit est en écriture seule (% interdit)', TG_OP;
END $$;

CREATE TRIGGER trig_audit_no_update_delete BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_block_mutation();
CREATE TRIGGER trig_audit_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_block_mutation();

CREATE OR REPLACE FUNCTION audit_compute_hash(p_prev TEXT, p_id UUID, p_inst UUID, p_action TEXT,
  p_entity TEXT, p_entity_id UUID, p_old JSONB, p_new JSONB, p_at TIMESTAMPTZ)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(digest(
    coalesce(p_prev, '') || '|' || p_id::text || '|' || coalesce(p_inst::text, '') || '|' || p_action || '|' ||
    p_entity || '|' || p_entity_id::text || '|' || coalesce(p_old::text, '') || '|' || coalesce(p_new::text, '') || '|' ||
    extract(epoch FROM p_at)::text, 'sha256'), 'hex')
$$;

-- Chaîne par institution (verrou consultatif : évite une contention globale).
CREATE OR REPLACE FUNCTION write_audit(
  p_action TEXT, p_entity_type TEXT, p_entity_id UUID, p_institution UUID,
  p_old JSONB DEFAULT NULL, p_new JSONB DEFAULT NULL, p_metadata JSONB DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  v_id UUID := gen_random_uuid();
  v_prev TEXT;
  v_at TIMESTAMPTZ := clock_timestamp();
  v_user UUID := auth.uid();
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('audit:' || coalesce(p_institution::text, 'global')));
  SELECT row_hash INTO v_prev FROM audit_logs
   WHERE institution_id IS NOT DISTINCT FROM p_institution
   ORDER BY seq DESC LIMIT 1;
  INSERT INTO audit_logs (id, institution_id, user_id, user_role, user_name, action, entity_type, entity_id,
                          old_value, new_value, metadata, occurred_at, prev_hash, row_hash)
  VALUES (v_id, p_institution, v_user, NULLIF(current_user_role(), ''),
          (SELECT full_name FROM users WHERE id = v_user),
          p_action, p_entity_type, p_entity_id, p_old, p_new, p_metadata, v_at, v_prev,
          audit_compute_hash(v_prev, v_id, p_institution, p_action, p_entity_type, p_entity_id, p_old, p_new, v_at));
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION write_audit(TEXT, TEXT, UUID, UUID, JSONB, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION write_audit(TEXT, TEXT, UUID, UUID, JSONB, JSONB, JSONB) TO service_role;

-- Vérification d'intégrité de la chaîne (DCMP / ARCOP / Cour des Comptes).
CREATE OR REPLACE FUNCTION verify_audit_chain(p_institution UUID DEFAULT NULL)
RETURNS TABLE (broken_id UUID, occurred_at TIMESTAMPTZ, reason TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE r RECORD; v_prev TEXT := NULL;
BEGIN
  IF current_user_role() NOT IN ('DCMP', 'ARCOP', 'COUR_COMPTES', 'ADMIN') AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'FORBIDDEN: vérification réservée aux régulateurs';
  END IF;
  FOR r IN SELECT * FROM audit_logs a WHERE a.institution_id IS NOT DISTINCT FROM p_institution
           ORDER BY a.seq LOOP
    IF r.prev_hash IS DISTINCT FROM v_prev THEN
      broken_id := r.id; occurred_at := r.occurred_at; reason := 'CHAINE_ROMPUE'; RETURN NEXT;
    ELSIF r.row_hash IS DISTINCT FROM audit_compute_hash(r.prev_hash, r.id, r.institution_id, r.action,
          r.entity_type, r.entity_id, r.old_value, r.new_value, r.occurred_at) THEN
      broken_id := r.id; occurred_at := r.occurred_at; reason := 'CONTENU_ALTERE'; RETURN NEXT;
    END IF;
    v_prev := r.row_hash;
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION verify_audit_chain(UUID) TO authenticated, service_role;

-- Trigger générique d'audit des modifications de lignes.
CREATE OR REPLACE FUNCTION audit_row_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  v_row JSONB; v_old JSONB; v_new JSONB; v_inst UUID; v_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN v_row := to_jsonb(OLD); v_old := v_row; v_new := NULL;
  ELSIF TG_OP = 'INSERT' THEN v_row := to_jsonb(NEW); v_old := NULL; v_new := v_row;
  ELSE v_row := to_jsonb(NEW); v_old := to_jsonb(OLD); v_new := v_row; END IF;
  v_id := COALESCE((v_row->>'id')::uuid, (v_row->>'tender_id')::uuid);   -- tables à clé composite : le marché fait foi
  v_inst := CASE WHEN TG_TABLE_NAME = 'institutions' THEN v_id ELSE (v_row->>'institution_id')::uuid END;
  PERFORM write_audit(upper(TG_TABLE_NAME) || '_' || TG_OP, TG_TABLE_NAME, v_id, v_inst, v_old, v_new, NULL);
  RETURN COALESCE(NEW, OLD);
END $$;

-- Remplace l'ancien journal de phase (qui lisait des variables de session falsifiables).
DROP TRIGGER IF EXISTS trig_log_phase_transition ON tenders;
DROP FUNCTION IF EXISTS log_phase_transition();

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenders','bids','appeals','contracts','contract_amendments','subcontractors',
                           'tender_documents','tender_lots','bid_evaluations','config_seuils','users','institutions']
  LOOP
    EXECUTE format('CREATE TRIGGER trig_audit_%1$s AFTER INSERT OR UPDATE OR DELETE ON %1$I
                    FOR EACH ROW EXECUTE FUNCTION audit_row_change()', t);
  END LOOP;
END $$;

-- ------------------------------------------
-- 4. NUMÉROTATION DES MARCHÉS : séquentielle par institution et par année (remplace Math.random())
-- ------------------------------------------
CREATE TABLE tender_counters (
  institution_id UUID NOT NULL REFERENCES institutions(id),
  annee INTEGER NOT NULL,
  dernier INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (institution_id, annee)
);
ALTER TABLE tender_counters ENABLE ROW LEVEL SECURITY;   -- aucune policy : accès par fonction uniquement
REVOKE ALL ON tender_counters FROM anon, authenticated;

CREATE OR REPLACE FUNCTION next_tender_reference(p_institution UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE v_year INTEGER := EXTRACT(YEAR FROM NOW())::int; v_n INTEGER; v_code TEXT;
BEGIN
  INSERT INTO tender_counters (institution_id, annee, dernier) VALUES (p_institution, v_year, 1)
  ON CONFLICT (institution_id, annee) DO UPDATE SET dernier = tender_counters.dernier + 1
  RETURNING dernier INTO v_n;
  SELECT code INTO v_code FROM institutions WHERE id = p_institution;
  RETURN 'MP-' || v_code || '-' || v_year || '-' || lpad(v_n::text, 4, '0');
END $$;
REVOKE ALL ON FUNCTION next_tender_reference(UUID) FROM PUBLIC, anon, authenticated;

-- La référence est toujours attribuée par le serveur : toute valeur fournie par le client est écrasée.
CREATE OR REPLACE FUNCTION tenders_set_reference()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.reference := next_tender_reference(NEW.institution_id);
  ELSIF NEW.reference IS DISTINCT FROM OLD.reference THEN
    RAISE EXCEPTION 'FORBIDDEN_COLUMN: la référence d''un marché est immuable';
  END IF;
  RETURN NEW;
END $$;
ALTER TABLE tenders ALTER COLUMN reference DROP NOT NULL;
CREATE TRIGGER trig_tenders_reference BEFORE INSERT OR UPDATE OF reference ON tenders
  FOR EACH ROW EXECUTE FUNCTION tenders_set_reference();
