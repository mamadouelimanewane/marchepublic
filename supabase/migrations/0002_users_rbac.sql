-- ==========================================
-- PLATEFORME MARCHÉS PUBLICS SÉNÉGAL
-- Migration 0002 : Utilisateurs et RBAC
-- ==========================================

-- ==========================================
-- TABLE : UTILISATEURS (RBAC)
-- Étend auth.users de Supabase
-- ==========================================
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  institution_id UUID REFERENCES institutions(id),
  -- Rôle unique (RBAC strict - Décret 2022-2295)
  role TEXT NOT NULL CHECK (role IN (
    'SERVICE_DEMANDEUR',    -- Service demandeur (Phase 1-2)
    'CPM',                  -- Cellule de Passation des Marchés
    'PRM',                  -- Personne Responsable des Marchés
    'EVALUATEUR',           -- Membre commission d'évaluation
    'DCMP',                 -- Direction Centrale des Marchés Publics
    'ARCOP',                -- Autorité de Régulation (ex-ARMP)
    'TRESOR',               -- Contrôleur Financier / Trésor Public
    'SOUMISSIONNAIRE',      -- Entreprises et PME candidates
    'COUR_COMPTES',         -- Cour des Comptes (lecture seule)
    'BAILLEUR',             -- Bailleur de fonds (cofinancement)
    'ADMIN'                 -- Administrateur plateforme
  )),
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  telephone TEXT,
  -- PME profil (pour soumissionnaires)
  ninea TEXT,               -- Numéro d'Identification Nationale des Entreprises
  rccm TEXT,                -- Registre du Commerce et du Crédit Mobilier
  is_pme BOOLEAN DEFAULT false,
  is_pme_feminine BOOLEAN DEFAULT false,  -- PME direction féminine (quota 2%)
  -- Statut
  is_active BOOLEAN DEFAULT true,
  dernier_connexion TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index
CREATE INDEX idx_users_institution ON users(institution_id);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_ninea ON users(ninea) WHERE ninea IS NOT NULL;

-- ==========================================
-- TABLE : CORPS DE MÉTIERS (Nomenclature)
-- ==========================================
CREATE TABLE corps_metiers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT UNIQUE NOT NULL,
  libelle TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Nomenclature initiale (extensible)
INSERT INTO corps_metiers (code, libelle) VALUES
  ('BTP', 'BTP / Génie civil / Bâtiment'),
  ('INFORMATIQUE', 'Informatique, numérique et télécommunications'),
  ('SANTE', 'Santé et produits pharmaceutiques'),
  ('TRANSPORT', 'Transport, logistique et parc automobile'),
  ('ENERGIE', 'Énergie et hydraulique'),
  ('AGRICULTURE', 'Agriculture, environnement et développement durable'),
  ('PRESTATIONS_INTELLECTUELLES', 'Études, conseil et assistance technique'),
  ('FOURNITURES_BUREAU', 'Fournitures de bureau, mobilier et équipements'),
  ('SECURITE', 'Sécurité, gardiennage et surveillance'),
  ('RESTAURATION', 'Restauration, hôtellerie et événementiel'),
  ('COMMUNICATION', 'Communication, imprimerie et audiovisuel'),
  ('FORMATION', 'Formation et renforcement de capacités');

COMMENT ON TABLE corps_metiers IS 'Nomenclature des corps de métiers - Paramétrable par admin';
