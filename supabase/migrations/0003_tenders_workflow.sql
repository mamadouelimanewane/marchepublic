-- ==========================================
-- PLATEFORME MARCHÉS PUBLICS SÉNÉGAL
-- Migration 0003 : Marchés et Workflow 15 Phases
-- Conforme Décret n°2022-2295
-- ==========================================

-- ==========================================
-- ENUM : 15 PHASES DU CYCLE DE VIE
-- Machine à états stricte (State Machine)
-- ==========================================
CREATE TYPE tender_phase AS ENUM (
  'PHASE_1_PROGRAMMATION',         -- Inscription besoin / PPM
  'PHASE_2_REDACTION',             -- Élaboration TDR/DAO
  'PHASE_3_VALIDATION_PRIORI',     -- Validation interne + DCMP
  'PHASE_4_PUBLICATION',           -- Publication AO
  'PHASE_5_CLARIFICATIONS',        -- Retrait, Q&R, additifs
  'PHASE_6_DEPOT_OFFRES',          -- Dépôt offres (coffre-fort)
  'PHASE_7_OUVERTURE_PLIS',        -- Ouverture officielle
  'PHASE_8_EVALUATION',            -- Analyse technique/financière
  'PHASE_9_ATTRIBUTION_PROVISOIRE', -- Décision provisoire
  'PHASE_10_RECOURS',              -- Recours ARCOP (bloque Phase 11)
  'PHASE_11_ATTRIBUTION_DEFINITIVE', -- Attribution définitive
  'PHASE_12_SIGNATURE_CONTRAT',    -- Signature + garanties
  'PHASE_13_EXECUTION',            -- Exécution (OS, avenants)
  'PHASE_14_RECEPTION_PAIEMENT',   -- Réception + paiements
  'PHASE_15_CLOTURE_ARCHIVAGE'     -- Clôture et archivage
);

CREATE TYPE mode_passation AS ENUM (
  'AOO',          -- Appel d'Offres Ouvert
  'AOR',          -- Appel d'Offres Restreint
  'AOO_2ETAPES',  -- Appel d'Offres en 2 étapes
  'CONCOURS',     -- Concours
  'DRP',          -- Demande de Renseignements et de Prix
  'ENTENTE_DIRECTE', -- Entente directe / gré à gré
  'ACCORD_CADRE'  -- Accords-cadres et marchés à commandes
);

CREATE TYPE nature_marche AS ENUM (
  'TRAVAUX',
  'FOURNITURES',
  'SERVICES_COURANTS',
  'PRESTATIONS_INTELLECTUELLES',
  'DSP',          -- Délégation de Service Public
  'PPP'           -- Partenariat Public-Privé
);

-- ==========================================
-- TABLE : MARCHÉS (TENDERS)
-- Table centrale du système
-- ==========================================
CREATE TABLE tenders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- MULTI-TENANT : Clé d'isolation
  institution_id UUID NOT NULL REFERENCES institutions(id),

  -- Identification
  reference TEXT NOT NULL,            -- Ex: "AO-MEFP-2026-001"
  title TEXT NOT NULL,
  description TEXT,

  -- Classification
  corps_metier_id UUID REFERENCES corps_metiers(id),
  nature_marche nature_marche NOT NULL,
  mode_passation mode_passation,      -- Calculé automatiquement selon seuils

  -- Budget
  montant_estime BIGINT,              -- FCFA (montant estimatif)
  montant_initial BIGINT,             -- FCFA (après attribution)
  devise TEXT DEFAULT 'FCFA',
  ligne_budgetaire TEXT,
  programme_budget TEXT,

  -- MACHINE À ÉTATS : Phase courante
  current_phase tender_phase NOT NULL DEFAULT 'PHASE_1_PROGRAMMATION',
  phase_history JSONB DEFAULT '[]',   -- [{phase, enteredAt, enteredBy, note}]

  -- PPM
  ppm_annee INTEGER,
  ppm_trimestre INTEGER CHECK (ppm_trimestre BETWEEN 1 AND 4),
  date_prevue_lancement DATE,
  date_prevue_attribution DATE,

  -- Calendrier procédure
  date_publication TIMESTAMPTZ,
  date_limite_depot TIMESTAMPTZ,      -- Heure limite dépôt offres
  date_ouverture_plis TIMESTAMPTZ,
  date_attribution_provisoire TIMESTAMPTZ,
  date_attribution_definitive TIMESTAMPTZ,
  date_signature_contrat TIMESTAMPTZ,

  -- Quotas PME
  is_reserve_pme BOOLEAN DEFAULT false,
  is_reserve_pme_feminine BOOLEAN DEFAULT false,

  -- Recours (Phase 10 - HARD LOCK)
  has_appeal_pending BOOLEAN DEFAULT false,  -- BLOQUE Phase 11 si true
  arcop_decision TEXT CHECK (arcop_decision IN ('REJETE', 'IRRECEVABLE', 'FAVORABLE', 'EN_COURS', NULL)),

  -- Allotissement
  is_alloti BOOLEAN DEFAULT false,
  nombre_lots INTEGER DEFAULT 1,

  -- Chiffrement offres (Phase 6 → 7)
  encryption_key_id TEXT,             -- Référence clé AES (stockée séparément)
  plis_dechiffres BOOLEAN DEFAULT false,  -- Déclenché à Phase 7

  -- Attribution
  attributaire_id UUID REFERENCES users(id),  -- Soumissionnaire retenu
  montant_attribue BIGINT,

  -- Suivi exécution (Phase 13)
  taux_avancement INTEGER DEFAULT 0 CHECK (taux_avancement BETWEEN 0 AND 100),
  montant_avenants_cumule BIGINT DEFAULT 0,  -- Contrôle 30%
  montant_soustrait_cumule BIGINT DEFAULT 0, -- Contrôle 40%

  -- Acteurs impliqués
  prm_id UUID REFERENCES users(id),
  cpm_id UUID REFERENCES users(id),
  created_by UUID REFERENCES users(id),

  -- Métadonnées
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ,

  -- Contrainte : référence unique par institution
  UNIQUE(institution_id, reference)
);

-- Index essentiels
CREATE INDEX idx_tenders_institution ON tenders(institution_id);
CREATE INDEX idx_tenders_phase ON tenders(current_phase);
CREATE INDEX idx_tenders_mode ON tenders(mode_passation);
CREATE INDEX idx_tenders_nature ON tenders(nature_marche);
CREATE INDEX idx_tenders_ppm ON tenders(ppm_annee, ppm_trimestre);
CREATE INDEX idx_tenders_date_limite ON tenders(date_limite_depot);
CREATE INDEX idx_tenders_attributaire ON tenders(attributaire_id);

-- ==========================================
-- TABLE : LOTS (Allotissement)
-- ==========================================
CREATE TABLE tender_lots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tender_id UUID NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  institution_id UUID NOT NULL REFERENCES institutions(id),
  numero_lot INTEGER NOT NULL,
  libelle TEXT NOT NULL,
  description TEXT,
  montant_estime BIGINT,
  corps_metier_id UUID REFERENCES corps_metiers(id),
  attributaire_id UUID REFERENCES users(id),
  montant_attribue BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tender_id, numero_lot)
);

-- ==========================================
-- TABLE : DOCUMENTS (TDR, DAO, PV, Contrats...)
-- ==========================================
CREATE TYPE document_type AS ENUM (
  'TDR',                  -- Termes de Référence
  'DAO',                  -- Dossier d'Appel d'Offres
  'ADDITIF',              -- Additif au DAO
  'QR',                   -- Questions-Réponses
  'PV_OUVERTURE',         -- PV ouverture des plis
  'RAPPORT_EVALUATION',   -- Rapport d'évaluation
  'DECISION_ATTRIBUTION', -- Décision d'attribution
  'CONTRAT',              -- Contrat signé
  'AVENANT',              -- Avenant au contrat
  'ORDRE_SERVICE',        -- Ordre de Service
  'PV_RECEPTION',         -- PV de réception
  'DECOMPTE',             -- Décompte / Facture
  'GARANTIE',             -- Garantie bancaire
  'RECOURS',              -- Document de recours
  'AUTRE'
);

CREATE TABLE tender_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tender_id UUID NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  institution_id UUID NOT NULL REFERENCES institutions(id),
  lot_id UUID REFERENCES tender_lots(id),
  type document_type NOT NULL,
  titre TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  -- Stockage Supabase Storage
  storage_bucket TEXT DEFAULT 'documents',
  storage_path TEXT,
  file_size BIGINT,
  file_hash TEXT,           -- SHA-256 pour intégrité
  mime_type TEXT,
  -- Verrouillage (après transmission DCMP ou publication)
  is_locked BOOLEAN DEFAULT false,
  locked_at TIMESTAMPTZ,
  locked_by UUID REFERENCES users(id),
  -- Signature électronique
  is_signed BOOLEAN DEFAULT false,
  signature_at TIMESTAMPTZ,
  signed_by UUID REFERENCES users(id),
  -- Horodatage qualifié (ADIE)
  timestamp_token TEXT,
  -- Métadonnées
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_documents_tender ON tender_documents(tender_id);
CREATE INDEX idx_documents_type ON tender_documents(type);
CREATE INDEX idx_documents_locked ON tender_documents(is_locked);

COMMENT ON TABLE tenders IS 'Table centrale - Marchés publics avec machine à états 15 phases';
COMMENT ON COLUMN tenders.has_appeal_pending IS 'HARD LOCK: true = impossible de passer à Phase 11';
COMMENT ON COLUMN tenders.montant_avenants_cumule IS 'Contrôle: ne doit pas dépasser 30% de montant_initial';
COMMENT ON COLUMN tenders.montant_soustrait_cumule IS 'Contrôle: ne doit pas dépasser 40% de montant_initial';
