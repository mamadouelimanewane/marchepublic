-- ==========================================
-- PLATEFORME MARCHÉS PUBLICS SÉNÉGAL
-- Migration 0004 : Offres, Évaluation, Recours, Contrats
-- ==========================================

-- ==========================================
-- TABLE : OFFRES SOUMISSIONNAIRES (BIDS)
-- Chiffrées Phase 6 → Déchiffrées Phase 7
-- ==========================================
CREATE TYPE bid_status AS ENUM (
  'BROUILLON',        -- En cours de préparation
  'SOUMISE',          -- Déposée (chiffrée)
  'RETARDEE',         -- Arrivée après date limite (rejetée)
  'RETIREE',          -- Retirée par le soumissionnaire
  'CONFORME',         -- Vérifiée conforme après ouverture
  'NON_CONFORME',     -- Non conforme administrativement
  'RETENUE',          -- Sélectionnée pour évaluation technique
  'EVALUEE',          -- Évaluée techniquement et financièrement
  'PROVISOIREMENT_RETENUE', -- Attribution provisoire
  'RETENUE_DEFINITIVE',     -- Attribution définitive
  'REJETEE'           -- Éliminée
);

CREATE TABLE bids (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tender_id UUID NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  institution_id UUID NOT NULL REFERENCES institutions(id),
  lot_id UUID REFERENCES tender_lots(id),
  soumissionnaire_id UUID NOT NULL REFERENCES users(id),

  -- Statut de l'offre
  status bid_status NOT NULL DEFAULT 'BROUILLON',

  -- Montant de l'offre financière
  montant_offre BIGINT,               -- FCFA (visible seulement Phase 7+)
  montant_technique NUMERIC(5,2),     -- Score technique

  -- Fichiers (chiffrés jusqu'à Phase 7)
  -- Technique : dossier administratif + offre technique
  fichier_technique_path TEXT,
  fichier_technique_hash TEXT,        -- SHA-256 original (pour intégrité)
  fichier_technique_encrypted BOOLEAN DEFAULT true,
  -- Financière : offre prix (chiffrée séparément)
  fichier_financier_path TEXT,
  fichier_financier_hash TEXT,
  fichier_financier_encrypted BOOLEAN DEFAULT true,

  -- Horodatage dépôt (CRITIQUE : prouve le dépôt avant date limite)
  submitted_at TIMESTAMPTZ,
  timestamp_token TEXT,               -- Token horodatage qualifié (ADIE)
  accuse_reception_path TEXT,         -- PDF accusé de réception généré

  -- Conformité administrative (Phase 7)
  conformite_admin BOOLEAN,           -- null=non vérifié, true=conforme, false=non conforme
  motif_non_conformite TEXT,
  verifie_par UUID REFERENCES users(id),
  verifie_le TIMESTAMPTZ,

  -- Déchiffrement (Phase 7)
  dechiffre_par UUID REFERENCES users(id),
  dechiffre_le TIMESTAMPTZ,

  -- Sous-traitance déclarée
  has_soustraitance BOOLEAN DEFAULT false,
  montant_soustrait BIGINT DEFAULT 0,

  -- Métadonnées
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Contrainte : Un seul dépôt par soumissionnaire par marché (et par lot)
  UNIQUE(tender_id, soumissionnaire_id, lot_id)
);

-- Index
CREATE INDEX idx_bids_tender ON bids(tender_id);
CREATE INDEX idx_bids_soumissionnaire ON bids(soumissionnaire_id);
CREATE INDEX idx_bids_status ON bids(status);
CREATE INDEX idx_bids_submitted ON bids(submitted_at);

-- ==========================================
-- TABLE : ÉVALUATIONS (Grilles de notation)
-- Configurable par corps de métier (JSONB)
-- ==========================================
CREATE TABLE bid_evaluations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tender_id UUID NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  institution_id UUID NOT NULL REFERENCES institutions(id),
  bid_id UUID NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
  evaluateur_id UUID NOT NULL REFERENCES users(id),

  -- Grille technique (JSONB configurable)
  -- Structure: [{critere: "Expérience", ponderation: 30, note: 25, commentaire: "..."}]
  grille_technique JSONB DEFAULT '[]',
  score_technique NUMERIC(5,2),       -- Score pondéré total /100
  seuil_technique_requis NUMERIC(5,2) DEFAULT 70.00, -- Seuil minimum pour qualification

  -- Évaluation financière (après validation technique)
  score_financier NUMERIC(5,2),       -- Basé sur montant offre
  score_global NUMERIC(5,2),          -- Score combiné (pondéré tech+fin)

  -- Rang final
  rang INTEGER,                       -- Classement parmi les soumissionnaires

  -- Statut
  phase_evaluation TEXT CHECK (phase_evaluation IN ('TECHNIQUE', 'FINANCIERE', 'GLOBALE', 'FINALISEE')),
  finalise_le TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- TABLE : RECOURS ARCOP (Phase 10 - HARD LOCK)
-- ==========================================
CREATE TYPE appeal_status AS ENUM (
  'DEPOSE',           -- Recours déposé par candidat
  'EN_INSTRUCTION',   -- ARCOP en cours d'instruction
  'IRRECEVABLE',      -- Recours irrecevable (Phase 11 débloquée)
  'REJETE',           -- Recours rejeté (Phase 11 débloquée)
  'FAVORABLE',        -- Recours favorable au requérant (reprise procédure)
  'PARTIELLEMENT_FAVORABLE'
);

CREATE TABLE appeals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tender_id UUID NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  institution_id UUID NOT NULL REFERENCES institutions(id),
  requerant_id UUID NOT NULL REFERENCES users(id),  -- Soumissionnaire

  -- Contenu du recours
  motif TEXT NOT NULL,
  description TEXT,
  document_path TEXT,                 -- Pièces jointes du recours

  -- Délais légaux
  date_depot TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  date_limite_instruction TIMESTAMPTZ, -- Calculé automatiquement
  date_decision TIMESTAMPTZ,

  -- Décision ARCOP
  status appeal_status NOT NULL DEFAULT 'DEPOSE',
  decision_arcop TEXT,
  arcop_instructeur_id UUID REFERENCES users(id),

  -- Notification parties
  notifie_ac BOOLEAN DEFAULT false,   -- Notifié à l'Autorité Contractante
  notifie_requerant BOOLEAN DEFAULT false,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index
CREATE INDEX idx_appeals_tender ON appeals(tender_id);
CREATE INDEX idx_appeals_status ON appeals(status);
CREATE INDEX idx_appeals_requerant ON appeals(requerant_id);

-- ==========================================
-- TABLE : CONTRATS
-- ==========================================
CREATE TABLE contracts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tender_id UUID NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  institution_id UUID NOT NULL REFERENCES institutions(id),
  bid_id UUID NOT NULL REFERENCES bids(id),
  attributaire_id UUID NOT NULL REFERENCES users(id),

  -- Montants
  montant_initial BIGINT NOT NULL,    -- FCFA
  montant_actuel BIGINT,              -- Après avenants

  -- Dates contractuelles
  date_signature DATE,
  date_debut_execution DATE,
  date_fin_execution DATE,
  delai_execution INTEGER,            -- Jours

  -- Garanties
  garantie_soumission BIGINT,
  garantie_bonne_execution BIGINT,
  garantie_avance_demarrage BIGINT,
  date_expiry_garantie DATE,

  -- Signature électronique (ADIE)
  signed_by_ac BOOLEAN DEFAULT false,     -- Signé par Autorité Contractante
  signed_by_titulaire BOOLEAN DEFAULT false,
  signature_ac_at TIMESTAMPTZ,
  signature_titulaire_at TIMESTAMPTZ,

  -- Visa budgétaire
  visa_controleur BOOLEAN DEFAULT false,
  visa_at TIMESTAMPTZ,
  visa_par UUID REFERENCES users(id),

  -- Statut
  status TEXT DEFAULT 'ACTIF' CHECK (status IN ('ACTIF', 'SUSPENDU', 'RESILIE', 'CLOS')),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- TABLE : AVENANTS (Contrôle 30%)
-- ==========================================
CREATE TABLE contract_amendments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  tender_id UUID NOT NULL REFERENCES tenders(id),
  institution_id UUID NOT NULL REFERENCES institutions(id),
  numero_avenant INTEGER NOT NULL,
  motif TEXT NOT NULL,
  montant_avenant BIGINT NOT NULL,    -- Peut être négatif (déduction)
  pourcentage NUMERIC(5,2),           -- % du montant initial
  -- Contrôle 30% : calculé par trigger
  cumul_avant BIGINT,                 -- Cumul avant cet avenant
  cumul_apres BIGINT,                 -- Cumul après (déclenche alerte si > 30%)
  depasse_seuil BOOLEAN DEFAULT false,
  -- Validation
  valide_par UUID REFERENCES users(id),
  valide_le TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(contract_id, numero_avenant)
);

-- ==========================================
-- TABLE : SOUS-TRAITANTS (Contrôle 40%)
-- ==========================================
CREATE TABLE subcontractors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  tender_id UUID NOT NULL REFERENCES tenders(id),
  institution_id UUID NOT NULL REFERENCES institutions(id),
  soumissionnaire_id UUID REFERENCES users(id),  -- Sous-traitant si sur plateforme
  nom_sous_traitant TEXT NOT NULL,
  ninea TEXT,
  rccm TEXT,
  objet TEXT NOT NULL,
  montant BIGINT NOT NULL,
  pourcentage NUMERIC(5,2),           -- % du montant marché
  depasse_seuil BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- TABLE : SUIVI PME (Quotas légaux 5%/2%)
-- ==========================================
CREATE TABLE pme_quotas_tracking (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  institution_id UUID NOT NULL REFERENCES institutions(id),
  annee_fiscale INTEGER NOT NULL,     -- ex: 2026
  montant_total_marches BIGINT DEFAULT 0,
  montant_pme BIGINT DEFAULT 0,       -- Attribués aux PME/ESS
  montant_pme_féminine BIGINT DEFAULT 0, -- Attribués aux PME féminines
  taux_pme NUMERIC(5,2) DEFAULT 0,    -- % (objectif: 5%)
  taux_pme_feminine NUMERIC(5,2) DEFAULT 0, -- % (objectif: 2%)
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(institution_id, annee_fiscale)
);

COMMENT ON TABLE appeals IS 'HARD LOCK: status DEPOSE ou EN_INSTRUCTION bloque Phase 11';
COMMENT ON TABLE contract_amendments IS 'Contrôle: cumul_apres > 30% montant_initial → BLOCAGE';
COMMENT ON TABLE subcontractors IS 'Contrôle: somme montants > 40% montant_marché → BLOCAGE';
