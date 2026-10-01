-- ==========================================
-- Migration 0009 : Tables des modules du cahier des charges
-- Besoins/PPM, modèles de documents, circuit de validation, avis DCMP, Q&R, commission,
-- ouverture des plis, garanties, exécution, réception, paiements, évaluation prestataire,
-- archivage, notifications.
-- ==========================================

-- ------------------------------------------
-- Fonctions d'aide aux politiques RLS (SECURITY DEFINER : évitent la récursion de politiques)
-- ------------------------------------------
CREATE OR REPLACE FUNCTION tender_phase_of(p_tender UUID)
RETURNS tender_phase LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp SET row_security = off AS $$
  SELECT current_phase FROM tenders WHERE id = p_tender
$$;

CREATE OR REPLACE FUNCTION tender_institution_of(p_tender UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp SET row_security = off AS $$
  SELECT institution_id FROM tenders WHERE id = p_tender
$$;

-- Personnel de l'autorité contractante (hors régulateurs et soumissionnaires)
CREATE OR REPLACE FUNCTION is_inst_staff(p_inst UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT p_inst IS NOT NULL AND p_inst = current_institution_id()
     AND current_user_role() IN ('SERVICE_DEMANDEUR', 'CPM', 'PRM', 'EVALUATEUR', 'TRESOR', 'ADMIN')
$$;

CREATE OR REPLACE FUNCTION is_commission_member(p_tender UUID, p_roles TEXT[] DEFAULT NULL)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp SET row_security = off AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM commission_members cm
    WHERE cm.tender_id = p_tender AND cm.user_id = auth.uid()
      AND (p_roles IS NULL OR cm.role_commission = ANY (p_roles))
  );
END $$;

CREATE OR REPLACE FUNCTION block_update_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_RECORD: % interdit sur %', TG_OP, TG_TABLE_NAME;
END $$;

-- ------------------------------------------
-- Colonnes complémentaires sur les marchés (workflow, chiffrement, contrôle a priori)
-- ------------------------------------------
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS bid_public_key TEXT;            -- clé publique RSA-OAEP (SPKI base64) ; la clé privée n'est JAMAIS stockée
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS bid_key_fingerprint TEXT;
-- Partage de la clé privée d'ouverture (Shamir k parmi n) ; NULL = clé unique remise au président
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS bid_key_shares INTEGER;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS bid_key_threshold INTEGER;
ALTER TABLE tenders ADD CONSTRAINT tenders_key_sharing_check CHECK (
  (bid_key_shares IS NULL AND bid_key_threshold IS NULL) OR (bid_key_threshold >= 2 AND bid_key_shares >= bid_key_threshold AND bid_key_shares <= 10));
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS transmis_dcmp_at TIMESTAMPTZ;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS is_cofinance BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS mode_suggere mode_passation;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS justification_mode TEXT;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS criteres_evaluation JSONB NOT NULL DEFAULT '[]';  -- [{critere, ponderation}] Σ = 100
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS besoin_id UUID;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS date_fin_recours TIMESTAMPTZ;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS attributaire_bid_id UUID REFERENCES bids(id);
ALTER TABLE tenders DROP CONSTRAINT IF EXISTS tenders_arcop_decision_check;
ALTER TABLE tenders ADD CONSTRAINT tenders_arcop_decision_check CHECK (
  arcop_decision IS NULL OR arcop_decision IN ('REJETE','IRRECEVABLE','FAVORABLE','PARTIELLEMENT_FAVORABLE','EN_COURS'));

-- Renommage : colonne accentuée → ASCII (compatibilité outils / types générés)
ALTER TABLE pme_quotas_tracking RENAME COLUMN "montant_pme_féminine" TO montant_pme_feminine;

-- Un seul dépôt par soumissionnaire, y compris quand le marché n'est pas alloti (lot_id NULL)
ALTER TABLE bids DROP CONSTRAINT IF EXISTS bids_tender_id_soumissionnaire_id_lot_id_key;
CREATE UNIQUE INDEX uq_bids_one_per_bidder ON bids (tender_id, soumissionnaire_id, COALESCE(lot_id, '00000000-0000-0000-0000-000000000000'));

-- ------------------------------------------
-- 1. BESOINS (fiche de besoin → PPM)
-- ------------------------------------------
CREATE TABLE besoins (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  institution_id UUID NOT NULL REFERENCES institutions(id),
  service_demandeur_id UUID NOT NULL REFERENCES users(id),
  intitule TEXT NOT NULL CHECK (char_length(intitule) >= 10),
  description TEXT,
  nature_marche nature_marche NOT NULL,
  corps_metier_id UUID REFERENCES corps_metiers(id),
  montant_estime BIGINT NOT NULL CHECK (montant_estime > 0),
  ligne_budgetaire TEXT NOT NULL,
  programme_budget TEXT,
  annee_budget INTEGER NOT NULL CHECK (annee_budget BETWEEN 2024 AND 2050),
  trimestre_souhaite INTEGER CHECK (trimestre_souhaite BETWEEN 1 AND 4),
  justification TEXT,
  statut TEXT NOT NULL DEFAULT 'BROUILLON' CHECK (statut IN ('BROUILLON','SOUMIS','VALIDE','REJETE','PROGRAMME')),
  motif_rejet TEXT,
  valide_par UUID REFERENCES users(id),
  valide_le TIMESTAMPTZ,
  tender_id UUID REFERENCES tenders(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_besoins_inst ON besoins(institution_id, annee_budget);
ALTER TABLE tenders ADD CONSTRAINT tenders_besoin_fk FOREIGN KEY (besoin_id) REFERENCES besoins(id);
ALTER TABLE besoins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "besoins_select" ON besoins FOR SELECT USING (
  is_inst_staff(institution_id) OR is_regulateur());
CREATE POLICY "besoins_insert" ON besoins FOR INSERT WITH CHECK (
  institution_id = current_institution_id() AND service_demandeur_id = auth.uid()
  AND current_user_role() IN ('SERVICE_DEMANDEUR','CPM','PRM') AND statut IN ('BROUILLON','SOUMIS'));
CREATE POLICY "besoins_update_owner" ON besoins FOR UPDATE USING (
  service_demandeur_id = auth.uid() AND statut IN ('BROUILLON','REJETE'))
  WITH CHECK (service_demandeur_id = auth.uid() AND statut IN ('BROUILLON','SOUMIS'));
CREATE POLICY "besoins_update_prm" ON besoins FOR UPDATE USING (
  institution_id = current_institution_id() AND current_user_role() IN ('PRM','CPM'))
  WITH CHECK (institution_id = current_institution_id());

-- Les décisions (VALIDE/REJETE/PROGRAMME) passent par programmer_besoin() (migration 0010).
CREATE OR REPLACE FUNCTION besoins_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('authenticated','anon') AND TG_OP = 'UPDATE' THEN
    IF NEW.statut IN ('VALIDE','REJETE','PROGRAMME') AND NEW.statut IS DISTINCT FROM OLD.statut
       OR NEW.valide_par IS DISTINCT FROM OLD.valide_par OR NEW.valide_le IS DISTINCT FROM OLD.valide_le
       OR NEW.tender_id IS DISTINCT FROM OLD.tender_id OR NEW.institution_id IS DISTINCT FROM OLD.institution_id THEN
      RAISE EXCEPTION 'FORBIDDEN_COLUMN: utilisez programmer_besoin() pour valider ou rejeter un besoin';
    END IF;
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END $$;
CREATE TRIGGER trig_besoins_guard BEFORE UPDATE ON besoins FOR EACH ROW EXECUTE FUNCTION besoins_guard();

-- ------------------------------------------
-- 2. MODÈLES (TDR/DAO), CLAUSES TYPES, GRILLES D'ÉVALUATION TYPES
-- ------------------------------------------
CREATE TABLE document_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT UNIQUE NOT NULL,
  type document_type NOT NULL CHECK (type IN ('TDR','DAO')),
  titre TEXT NOT NULL,
  nature_marche nature_marche,              -- NULL = toutes natures
  corps_metier_id UUID REFERENCES corps_metiers(id),
  mode_passation mode_passation,
  version INTEGER NOT NULL DEFAULT 1,
  sections JSONB NOT NULL DEFAULT '[]',     -- [{id, titre, contenu, obligatoire}]
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE clause_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT UNIQUE NOT NULL,
  categorie TEXT NOT NULL CHECK (categorie IN ('GARANTIE','PENALITES','RECEPTION','PROPRIETE_INTELLECTUELLE',
                                               'PME','ENVIRONNEMENT','SOCIAL','ALLOTISSEMENT','SOUS_TRAITANCE','AVENANT','PAIEMENT','AUTRE')),
  titre TEXT NOT NULL,
  contenu TEXT NOT NULL,
  obligatoire BOOLEAN NOT NULL DEFAULT false,
  natures nature_marche[],                  -- NULL = toutes natures
  is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE OR REPLACE FUNCTION criteres_total(p_criteres JSONB)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(SUM((c->>'ponderation')::numeric), 0) FROM jsonb_array_elements(p_criteres) c
$$;

CREATE TABLE evaluation_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT UNIQUE NOT NULL,
  corps_metier_id UUID REFERENCES corps_metiers(id),
  nature_marche nature_marche,
  criteres JSONB NOT NULL,                  -- [{critere, ponderation}] Σ = 100
  seuil_technique NUMERIC(5,2) NOT NULL DEFAULT 70,
  CONSTRAINT criteres_somme_100 CHECK (criteres_total(criteres) = 100)
);

ALTER TABLE document_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE clause_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluation_templates ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['document_templates','clause_templates','evaluation_templates'] LOOP
    EXECUTE format('CREATE POLICY "%1$s_read" ON %1$I FOR SELECT USING (auth.role() = ''authenticated'' AND current_user_role() <> ''SOUMISSIONNAIRE'')', t);
    EXECUTE format('CREATE POLICY "%1$s_admin" ON %1$I FOR ALL USING (current_user_role() = ''ADMIN'') WITH CHECK (current_user_role() = ''ADMIN'')', t);
  END LOOP;
END $$;

-- ------------------------------------------
-- 3. DOCUMENTS : circuit de validation + versions immuables + commentaires
-- ------------------------------------------
ALTER TABLE tender_documents ADD COLUMN IF NOT EXISTS contenu JSONB NOT NULL DEFAULT '{"sections": []}';
ALTER TABLE tender_documents ADD COLUMN IF NOT EXISTS circuit_statut TEXT NOT NULL DEFAULT 'REDACTION'
  CHECK (circuit_statut IN ('REDACTION','RELECTURE_CPM','VALIDE_PRM','TRANSMIS_DCMP','PUBLIE'));
ALTER TABLE tender_documents ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES document_templates(id);

CREATE TABLE document_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id UUID NOT NULL REFERENCES tender_documents(id) ON DELETE CASCADE,
  tender_id UUID NOT NULL REFERENCES tenders(id),
  institution_id UUID NOT NULL REFERENCES institutions(id),
  version INTEGER NOT NULL,
  contenu JSONB NOT NULL,
  content_hash TEXT NOT NULL,
  circuit_statut TEXT NOT NULL,
  author_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (document_id, version)
);
CREATE TRIGGER trig_document_versions_immutable BEFORE UPDATE OR DELETE ON document_versions
  FOR EACH ROW EXECUTE FUNCTION block_update_delete();

CREATE TABLE document_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id UUID NOT NULL REFERENCES tender_documents(id) ON DELETE CASCADE,
  tender_id UUID NOT NULL REFERENCES tenders(id),
  institution_id UUID NOT NULL REFERENCES institutions(id),
  version INTEGER,
  section_id TEXT,
  author_id UUID NOT NULL REFERENCES users(id) DEFAULT auth.uid(),
  contenu TEXT NOT NULL CHECK (char_length(contenu) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trig_document_comments_immutable BEFORE UPDATE OR DELETE ON document_comments
  FOR EACH ROW EXECUTE FUNCTION block_update_delete();

ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "docversions_select" ON document_versions FOR SELECT USING (is_inst_staff(institution_id) OR is_regulateur());
CREATE POLICY "doccomments_select" ON document_comments FOR SELECT USING (is_inst_staff(institution_id) OR is_regulateur());
CREATE POLICY "doccomments_insert" ON document_comments FOR INSERT WITH CHECK (
  author_id = auth.uid() AND is_inst_staff(institution_id) AND institution_id = tender_institution_of(tender_id));

-- ------------------------------------------
-- 4. AVIS DCMP / BAILLEUR / DÉROGATIONS / APPROBATIONS
-- ------------------------------------------
CREATE TABLE dcmp_reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tender_id UUID NOT NULL REFERENCES tenders(id),
  institution_id UUID NOT NULL REFERENCES institutions(id),
  type TEXT NOT NULL CHECK (type IN ('AVIS_NON_OBJECTION','NON_OBJECTION_BAILLEUR','DEROGATION','APPROBATION_ATTRIBUTION')),
  decision TEXT NOT NULL CHECK (decision IN ('FAVORABLE','DEFAVORABLE','COMPLEMENTAIRE')),
  motivation TEXT,
  reviewer_id UUID NOT NULL REFERENCES users(id),
  reviewer_role TEXT NOT NULL,
  document_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_dcmp_reviews_tender ON dcmp_reviews(tender_id, type, created_at DESC);
CREATE TRIGGER trig_dcmp_reviews_immutable BEFORE UPDATE OR DELETE ON dcmp_reviews
  FOR EACH ROW EXECUTE FUNCTION block_update_delete();
ALTER TABLE dcmp_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dcmp_reviews_select" ON dcmp_reviews FOR SELECT USING (
  is_inst_staff(institution_id) OR is_regulateur() OR current_user_role() = 'BAILLEUR');
-- Écriture : uniquement via record_review() (0010)

-- ------------------------------------------
-- 5. CLARIFICATIONS (Q&R) ET RETRAITS DU DOSSIER
-- ------------------------------------------
CREATE TABLE clarifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tender_id UUID NOT NULL REFERENCES tenders(id),
  institution_id UUID NOT NULL REFERENCES institutions(id),
  auteur_id UUID NOT NULL REFERENCES users(id) DEFAULT auth.uid(),
  question TEXT NOT NULL CHECK (char_length(question) >= 10),
  reponse TEXT,
  repondu_par UUID REFERENCES users(id),
  repondu_le TIMESTAMPTZ,
  publie BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_clarifications_tender ON clarifications(tender_id, created_at);

CREATE TABLE dossier_retraits (
  tender_id UUID NOT NULL REFERENCES tenders(id),
  soumissionnaire_id UUID NOT NULL REFERENCES users(id) DEFAULT auth.uid(),
  institution_id UUID NOT NULL REFERENCES institutions(id),
  retire_le TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tender_id, soumissionnaire_id)
);

ALTER TABLE clarifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE dossier_retraits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clarifications_select" ON clarifications FOR SELECT USING (
  is_inst_staff(institution_id) OR is_regulateur() OR auteur_id = auth.uid());
-- Les candidats lisent les réponses publiées via v_clarifications_publiques (sans l'identité de l'auteur de la question).
CREATE POLICY "clarifications_ask" ON clarifications FOR INSERT WITH CHECK (
  current_user_role() = 'SOUMISSIONNAIRE' AND auteur_id = auth.uid()
  AND reponse IS NULL AND publie = false
  AND tender_phase_of(tender_id) IN ('PHASE_5_CLARIFICATIONS','PHASE_6_DEPOT_OFFRES')
  AND institution_id = tender_institution_of(tender_id));
CREATE POLICY "clarifications_answer" ON clarifications FOR UPDATE USING (
  institution_id = current_institution_id() AND current_user_role() IN ('CPM','PRM'))
  WITH CHECK (institution_id = current_institution_id());

CREATE OR REPLACE FUNCTION clarifications_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.question IS DISTINCT FROM OLD.question OR NEW.auteur_id IS DISTINCT FROM OLD.auteur_id
     OR NEW.tender_id IS DISTINCT FROM OLD.tender_id THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: la question ne peut plus être modifiée';
  END IF;
  IF NEW.reponse IS NOT NULL AND NEW.reponse IS DISTINCT FROM OLD.reponse THEN
    NEW.repondu_par := auth.uid(); NEW.repondu_le := NOW(); NEW.publie := true;   -- diffusée à tous les candidats
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trig_clarifications_guard BEFORE UPDATE ON clarifications FOR EACH ROW EXECUTE FUNCTION clarifications_guard();

CREATE POLICY "retraits_select" ON dossier_retraits FOR SELECT USING (
  soumissionnaire_id = auth.uid() OR is_inst_staff(institution_id) OR is_regulateur());
CREATE POLICY "retraits_insert" ON dossier_retraits FOR INSERT WITH CHECK (
  soumissionnaire_id = auth.uid() AND current_user_role() = 'SOUMISSIONNAIRE'
  AND tender_phase_of(tender_id) IN ('PHASE_5_CLARIFICATIONS','PHASE_6_DEPOT_OFFRES')
  AND institution_id = tender_institution_of(tender_id));

-- ------------------------------------------
-- 6. COMMISSION DES MARCHÉS ET OUVERTURE DES PLIS
-- ------------------------------------------
CREATE TABLE commission_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tender_id UUID NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  institution_id UUID NOT NULL REFERENCES institutions(id),
  user_id UUID NOT NULL REFERENCES users(id),
  role_commission TEXT NOT NULL CHECK (role_commission IN ('PRESIDENT','MEMBRE','SECRETAIRE','OBSERVATEUR')),
  nomme_par UUID REFERENCES users(id) DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tender_id, user_id)
);
CREATE UNIQUE INDEX uq_commission_one_president ON commission_members(tender_id) WHERE role_commission = 'PRESIDENT';
ALTER TABLE commission_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION commission_members_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_inst UUID; v_role TEXT; v_user_inst UUID;
BEGIN
  SELECT institution_id INTO v_inst FROM tenders WHERE id = NEW.tender_id;
  SELECT role, institution_id INTO v_role, v_user_inst FROM users WHERE id = NEW.user_id;
  IF v_inst IS DISTINCT FROM NEW.institution_id OR v_user_inst IS DISTINCT FROM v_inst THEN
    RAISE EXCEPTION 'COMMISSION_INVALID: le membre doit appartenir à l''autorité contractante du marché';
  END IF;
  IF v_role NOT IN ('CPM','PRM','EVALUATEUR','SERVICE_DEMANDEUR','TRESOR') THEN
    RAISE EXCEPTION 'COMMISSION_INVALID: le rôle % ne peut pas siéger en commission', v_role;
  END IF;
  IF tender_phase_of(NEW.tender_id) >= 'PHASE_8_EVALUATION' THEN
    RAISE EXCEPTION 'COMMISSION_LOCKED: la composition de la commission est figée après l''ouverture des plis';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trig_commission_guard BEFORE INSERT ON commission_members FOR EACH ROW EXECUTE FUNCTION commission_members_guard();
CREATE OR REPLACE FUNCTION commission_members_no_change_after_opening()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF tender_phase_of(OLD.tender_id) >= 'PHASE_8_EVALUATION' THEN
    RAISE EXCEPTION 'COMMISSION_LOCKED: la composition de la commission est figée après l''ouverture des plis';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER trig_commission_lock BEFORE UPDATE OR DELETE ON commission_members
  FOR EACH ROW EXECUTE FUNCTION commission_members_no_change_after_opening();

CREATE POLICY "commission_select" ON commission_members FOR SELECT USING (
  is_inst_staff(institution_id) OR is_regulateur() OR user_id = auth.uid());
CREATE POLICY "commission_manage" ON commission_members FOR ALL USING (
  institution_id = current_institution_id() AND current_user_role() IN ('CPM','PRM'))
  WITH CHECK (institution_id = current_institution_id() AND current_user_role() IN ('CPM','PRM'));

CREATE TABLE bid_openings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tender_id UUID NOT NULL UNIQUE REFERENCES tenders(id),
  institution_id UUID NOT NULL REFERENCES institutions(id),
  opened_by UUID NOT NULL REFERENCES users(id),
  president_id UUID NOT NULL REFERENCES users(id),
  key_fingerprint TEXT,
  nb_plis INTEGER NOT NULL DEFAULT 0,
  observations TEXT,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT opening_two_persons CHECK (opened_by <> president_id)      -- règle des deux personnes (CDC §5 phase 7)
);
CREATE TRIGGER trig_bid_openings_immutable BEFORE UPDATE OR DELETE ON bid_openings
  FOR EACH ROW EXECUTE FUNCTION block_update_delete();
ALTER TABLE bid_openings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "openings_select" ON bid_openings FOR SELECT USING (is_inst_staff(institution_id) OR is_regulateur());

-- ------------------------------------------
-- 7. GARANTIES, ORDRES DE SERVICE, INCIDENTS, AVANCEMENT
-- ------------------------------------------
CREATE TABLE guarantees (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tender_id UUID NOT NULL REFERENCES tenders(id),
  institution_id UUID NOT NULL REFERENCES institutions(id),
  contract_id UUID REFERENCES contracts(id),
  bid_id UUID REFERENCES bids(id),
  type TEXT NOT NULL CHECK (type IN ('SOUMISSION','BONNE_EXECUTION','AVANCE_DEMARRAGE','RETENUE_GARANTIE')),
  montant BIGINT NOT NULL CHECK (montant > 0),
  emetteur TEXT NOT NULL,
  reference TEXT NOT NULL,
  date_emission DATE NOT NULL,
  date_expiration DATE NOT NULL,
  statut TEXT NOT NULL DEFAULT 'VALIDE' CHECK (statut IN ('VALIDE','EXPIREE','LIBEREE','APPELEE')),
  document_path TEXT,
  created_by UUID REFERENCES users(id) DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (date_expiration > date_emission)
);
CREATE INDEX idx_guarantees_exp ON guarantees(date_expiration) WHERE statut = 'VALIDE';

CREATE TABLE service_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_id UUID NOT NULL REFERENCES contracts(id),
  tender_id UUID NOT NULL REFERENCES tenders(id),
  institution_id UUID NOT NULL REFERENCES institutions(id),
  numero INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('DEMARRAGE','ARRET','REPRISE','MODIFICATION','AUTRE')),
  objet TEXT NOT NULL,
  date_effet DATE NOT NULL,
  emis_par UUID REFERENCES users(id) DEFAULT auth.uid(),
  notifie_le TIMESTAMPTZ,
  document_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (contract_id, numero)
);

CREATE TABLE execution_incidents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_id UUID NOT NULL REFERENCES contracts(id),
  tender_id UUID NOT NULL REFERENCES tenders(id),
  institution_id UUID NOT NULL REFERENCES institutions(id),
  date_incident DATE NOT NULL DEFAULT CURRENT_DATE,
  gravite TEXT NOT NULL CHECK (gravite IN ('MINEURE','MAJEURE','CRITIQUE')),
  description TEXT NOT NULL,
  penalites_montant BIGINT NOT NULL DEFAULT 0 CHECK (penalites_montant >= 0),
  statut TEXT NOT NULL DEFAULT 'OUVERT' CHECK (statut IN ('OUVERT','RESOLU','CONTESTE')),
  declare_par UUID REFERENCES users(id) DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE progress_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_id UUID NOT NULL REFERENCES contracts(id),
  tender_id UUID NOT NULL REFERENCES tenders(id),
  institution_id UUID NOT NULL REFERENCES institutions(id),
  date_rapport DATE NOT NULL DEFAULT CURRENT_DATE,
  taux_avancement INTEGER NOT NULL CHECK (taux_avancement BETWEEN 0 AND 100),
  commentaire TEXT,
  cree_par UUID REFERENCES users(id) DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------
-- 8. RÉCEPTIONS, DÉCOMPTES / PAIEMENTS
-- ------------------------------------------
CREATE TABLE receptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_id UUID NOT NULL REFERENCES contracts(id),
  tender_id UUID NOT NULL REFERENCES tenders(id),
  institution_id UUID NOT NULL REFERENCES institutions(id),
  type TEXT NOT NULL CHECK (type IN ('PROVISOIRE','DEFINITIVE')),
  date_reception DATE NOT NULL DEFAULT CURRENT_DATE,
  statut TEXT NOT NULL CHECK (statut IN ('ACCEPTEE','ACCEPTEE_AVEC_RESERVES','REFUSEE')),
  reserves TEXT,
  commission JSONB NOT NULL DEFAULT '[]',         -- [{user_id, nom, fonction}]
  pv_path TEXT,
  created_by UUID REFERENCES users(id) DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (contract_id, type)
);

CREATE TABLE payment_statements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_id UUID NOT NULL REFERENCES contracts(id),
  tender_id UUID NOT NULL REFERENCES tenders(id),
  institution_id UUID NOT NULL REFERENCES institutions(id),
  numero INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('AVANCE','ACOMPTE','SOLDE','LIBERATION_RETENUE')),
  montant BIGINT NOT NULL CHECK (montant > 0),
  statut TEXT NOT NULL DEFAULT 'SOUMIS' CHECK (statut IN ('SOUMIS','VALIDE_AC','VISA_CF','TRANSMIS_TRESOR','PAYE','REJETE')),
  motif_rejet TEXT,
  reference_sigfip TEXT,
  soumis_par UUID REFERENCES users(id) DEFAULT auth.uid(),
  date_soumission TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  date_validation TIMESTAMPTZ,
  date_paiement TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (contract_id, numero)
);

-- ------------------------------------------
-- 9. ÉVALUATION PRESTATAIRE, ARCHIVAGE, NOTIFICATIONS
-- ------------------------------------------
CREATE TABLE provider_evaluations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_id UUID NOT NULL UNIQUE REFERENCES contracts(id),
  tender_id UUID NOT NULL REFERENCES tenders(id),
  institution_id UUID NOT NULL REFERENCES institutions(id),
  prestataire_id UUID NOT NULL REFERENCES users(id),
  note_qualite NUMERIC(4,2) NOT NULL CHECK (note_qualite BETWEEN 0 AND 10),
  note_delai NUMERIC(4,2) NOT NULL CHECK (note_delai BETWEEN 0 AND 10),
  note_cout NUMERIC(4,2) NOT NULL CHECK (note_cout BETWEEN 0 AND 10),
  note_globale NUMERIC(4,2) GENERATED ALWAYS AS (round((note_qualite + note_delai + note_cout) / 3, 2)) STORED,
  commentaire TEXT,
  evalue_par UUID REFERENCES users(id) DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE archives (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tender_id UUID NOT NULL UNIQUE REFERENCES tenders(id),
  institution_id UUID NOT NULL REFERENCES institutions(id),
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_by UUID REFERENCES users(id),
  manifest JSONB NOT NULL,                        -- inventaire des pièces + empreintes SHA-256
  manifest_hash TEXT NOT NULL,
  audit_head_hash TEXT,                           -- dernier maillon de la chaîne d'audit à la clôture
  retention_until DATE NOT NULL
);
CREATE TRIGGER trig_archives_immutable BEFORE UPDATE OR DELETE ON archives
  FOR EACH ROW EXECUTE FUNCTION block_update_delete();

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tender_id UUID REFERENCES tenders(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  titre TEXT NOT NULL,
  message TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_notifications_user ON notifications(user_id, created_at DESC);

-- ------------------------------------------
-- RLS des tables d'exécution / clôture
-- ------------------------------------------
ALTER TABLE guarantees ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE execution_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE progress_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE receptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE archives ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Lecture : personnel de l'AC, régulateurs, et titulaire du contrat concerné
CREATE OR REPLACE FUNCTION is_contract_holder(p_contract UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp SET row_security = off AS $$
  SELECT EXISTS (SELECT 1 FROM contracts c WHERE c.id = p_contract AND c.attributaire_id = auth.uid())
$$;

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['guarantees','service_orders','execution_incidents','progress_reports','receptions','payment_statements'] LOOP
    EXECUTE format('CREATE POLICY "%1$s_select" ON %1$I FOR SELECT USING (
      is_inst_staff(institution_id) OR is_regulateur() OR current_user_role() = ''COUR_COMPTES''
      OR (contract_id IS NOT NULL AND is_contract_holder(contract_id)))', t);
  END LOOP;
END $$;
-- guarantees n''a pas forcément de contrat (garantie de soumission) : le soumissionnaire voit les siennes
CREATE POLICY "guarantees_select_bidder" ON guarantees FOR SELECT USING (
  bid_id IS NOT NULL AND EXISTS (SELECT 1 FROM bids b WHERE b.id = bid_id AND b.soumissionnaire_id = auth.uid()));

-- Écriture par l'autorité contractante, en phase d'exécution uniquement
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['service_orders','execution_incidents','progress_reports'] LOOP
    EXECUTE format('CREATE POLICY "%1$s_write" ON %1$I FOR INSERT WITH CHECK (
      institution_id = current_institution_id() AND current_user_role() IN (''PRM'',''CPM'')
      AND institution_id = tender_institution_of(tender_id)
      AND tender_phase_of(tender_id) = ''PHASE_13_EXECUTION'')', t);
  END LOOP;
END $$;
CREATE POLICY "guarantees_write" ON guarantees FOR INSERT WITH CHECK (
  institution_id = current_institution_id() AND current_user_role() IN ('PRM','CPM','TRESOR')
  AND institution_id = tender_institution_of(tender_id)
  AND tender_phase_of(tender_id) IN ('PHASE_11_ATTRIBUTION_DEFINITIVE','PHASE_12_SIGNATURE_CONTRAT','PHASE_13_EXECUTION','PHASE_14_RECEPTION_PAIEMENT'));
CREATE POLICY "guarantees_update" ON guarantees FOR UPDATE USING (
  institution_id = current_institution_id() AND current_user_role() IN ('PRM','TRESOR'));
CREATE POLICY "incidents_update" ON execution_incidents FOR UPDATE USING (
  institution_id = current_institution_id() AND current_user_role() IN ('PRM','CPM'));

CREATE POLICY "receptions_write" ON receptions FOR INSERT WITH CHECK (
  institution_id = current_institution_id() AND current_user_role() IN ('PRM','CPM')
  AND institution_id = tender_institution_of(tender_id)
  AND tender_phase_of(tender_id) IN ('PHASE_13_EXECUTION','PHASE_14_RECEPTION_PAIEMENT'));

-- Décomptes : soumis par le titulaire, traités par l'AC puis le Trésor
CREATE POLICY "payments_submit" ON payment_statements FOR INSERT WITH CHECK (
  is_contract_holder(contract_id) AND soumis_par = auth.uid() AND statut = 'SOUMIS'
  AND institution_id = tender_institution_of(tender_id)
  AND tender_phase_of(tender_id) IN ('PHASE_13_EXECUTION','PHASE_14_RECEPTION_PAIEMENT'));
CREATE POLICY "payments_process" ON payment_statements FOR UPDATE USING (
  institution_id = current_institution_id() AND current_user_role() IN ('PRM','CPM','TRESOR'));

CREATE POLICY "provider_eval_select" ON provider_evaluations FOR SELECT USING (
  is_inst_staff(institution_id) OR is_regulateur() OR prestataire_id = auth.uid());
CREATE POLICY "provider_eval_insert" ON provider_evaluations FOR INSERT WITH CHECK (
  institution_id = current_institution_id() AND current_user_role() IN ('PRM','CPM')
  AND institution_id = tender_institution_of(tender_id)
  AND tender_phase_of(tender_id) IN ('PHASE_14_RECEPTION_PAIEMENT','PHASE_15_CLOTURE_ARCHIVAGE'));

CREATE POLICY "archives_select" ON archives FOR SELECT USING (
  is_inst_staff(institution_id) OR is_regulateur() OR current_user_role() = 'COUR_COMPTES');

CREATE POLICY "notifications_own" ON notifications FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "notifications_mark_read" ON notifications FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Les incidents ne se suppriment pas ; les lignes de décompte payées sont figées.
CREATE OR REPLACE FUNCTION payment_statements_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_actuel BIGINT; v_total BIGINT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.statut IN ('PAYE','REJETE') THEN
      RAISE EXCEPTION 'IMMUTABLE_RECORD: décompte % déjà clos', OLD.statut;
    END IF;
    IF NEW.montant IS DISTINCT FROM OLD.montant OR NEW.contract_id IS DISTINCT FROM OLD.contract_id
       OR NEW.numero IS DISTINCT FROM OLD.numero THEN
      RAISE EXCEPTION 'IMMUTABLE_RECORD: le montant d''un décompte soumis est immuable';
    END IF;
    IF current_user IN ('authenticated','anon') THEN
      IF NEW.statut = 'VALIDE_AC' AND current_user_role() NOT IN ('PRM','CPM') THEN RAISE EXCEPTION 'FORBIDDEN: validation réservée à l''autorité contractante'; END IF;
      IF NEW.statut IN ('VISA_CF','TRANSMIS_TRESOR','PAYE') AND current_user_role() <> 'TRESOR' THEN RAISE EXCEPTION 'FORBIDDEN: étape réservée au contrôleur financier / Trésor'; END IF;
    END IF;
    IF NEW.statut IS DISTINCT FROM OLD.statut THEN
      IF NEW.statut = 'VALIDE_AC' THEN NEW.date_validation := NOW(); END IF;
      IF NEW.statut = 'PAYE' THEN NEW.date_paiement := NOW(); END IF;
    END IF;
  END IF;
  -- Cumul des décomptes non rejetés ≤ montant actuel du contrat (après avenants)
  SELECT COALESCE(montant_actuel, montant_initial) INTO v_actuel FROM contracts WHERE id = NEW.contract_id;
  SELECT COALESCE(SUM(montant), 0) INTO v_total FROM payment_statements
   WHERE contract_id = NEW.contract_id AND statut <> 'REJETE' AND id IS DISTINCT FROM NEW.id;
  IF NEW.statut <> 'REJETE' AND v_total + NEW.montant > v_actuel THEN
    RAISE EXCEPTION 'PAYMENT_EXCEEDS_CONTRACT: le cumul des décomptes (%) dépasse le montant du contrat (%)', v_total + NEW.montant, v_actuel;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trig_payment_statements_guard BEFORE INSERT OR UPDATE ON payment_statements
  FOR EACH ROW EXECUTE FUNCTION payment_statements_guard();

-- Réception définitive seulement après une provisoire acceptée.
CREATE OR REPLACE FUNCTION receptions_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.type = 'DEFINITIVE' AND NOT EXISTS (
       SELECT 1 FROM receptions r WHERE r.contract_id = NEW.contract_id AND r.type = 'PROVISOIRE'
         AND r.statut IN ('ACCEPTEE','ACCEPTEE_AVEC_RESERVES')) THEN
    RAISE EXCEPTION 'RECEPTION_ORDER: une réception provisoire acceptée est requise avant la réception définitive';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trig_receptions_guard BEFORE INSERT ON receptions FOR EACH ROW EXECUTE FUNCTION receptions_guard();
CREATE TRIGGER trig_receptions_immutable BEFORE UPDATE OR DELETE ON receptions FOR EACH ROW EXECUTE FUNCTION block_update_delete();

-- Avancement : met à jour le taux du marché
CREATE OR REPLACE FUNCTION progress_reports_apply()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
BEGIN
  UPDATE tenders SET taux_avancement = GREATEST(taux_avancement, NEW.taux_avancement) WHERE id = NEW.tender_id;
  RETURN NEW;
END $$;
CREATE TRIGGER trig_progress_apply AFTER INSERT ON progress_reports FOR EACH ROW EXECUTE FUNCTION progress_reports_apply();

-- Audit des nouvelles tables sensibles
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['besoins','dcmp_reviews','commission_members','bid_openings','guarantees',
                           'service_orders','execution_incidents','receptions','payment_statements',
                           'provider_evaluations','archives','clarifications','document_versions']
  LOOP
    EXECUTE format('CREATE TRIGGER trig_audit_%1$s AFTER INSERT OR UPDATE OR DELETE ON %1$I
                    FOR EACH ROW EXECUTE FUNCTION audit_row_change()', t);
  END LOOP;
END $$;
