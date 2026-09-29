-- ==========================================
-- PLATEFORME MARCHÉS PUBLICS SÉNÉGAL
-- Migration 0001 : Institutions (Multi-Tenant)
-- Conforme Décret n°2022-2295
-- ==========================================

-- Extension UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==========================================
-- TABLE : INSTITUTIONS (TENANTS)
-- Chaque autorité contractante = un tenant isolé
-- ==========================================
CREATE TABLE institutions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT UNIQUE NOT NULL,          -- ex: "MEFP", "AGEROUTE", "DAKAR_COMMUNE"
  name TEXT NOT NULL,                 -- ex: "Ministère de l'Économie"
  type TEXT NOT NULL CHECK (type IN (
    'ETAT',                           -- Ministères et services de l'État
    'COLLECTIVITE',                   -- Collectivités territoriales
    'ETABLISSEMENT_PUBLIC',           -- Établissements publics
    'SOCIETE_PUBLIQUE',               -- Sociétés à participation publique
    'AGENCE'                          -- Agences et organismes
  )),
  -- Seuils spécifiques (FCFA) - paramétrables sans redéploiement
  seuil_travaux BIGINT NOT NULL DEFAULT 70000000,
  seuil_fournitures BIGINT NOT NULL DEFAULT 50000000,
  -- Informations légales
  adresse TEXT,
  telephone TEXT,
  email_officiel TEXT,
  responsable_nom TEXT,               -- PRM (Personne Responsable des Marchés)
  -- Statut
  is_active BOOLEAN DEFAULT true,
  onboarded_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index
CREATE INDEX idx_institutions_type ON institutions(type);
CREATE INDEX idx_institutions_active ON institutions(is_active);

-- Commentaires
COMMENT ON TABLE institutions IS 'Tenant principal - Autorités contractantes du Sénégal';
COMMENT ON COLUMN institutions.seuil_travaux IS 'Seuil AOO travaux en FCFA - Décret 2022-2295 Art. X';
COMMENT ON COLUMN institutions.seuil_fournitures IS 'Seuil AOO fournitures/services en FCFA - Décret 2022-2295 Art. X';

-- ==========================================
-- TABLE : SEUILS RÉGLEMENTAIRES GLOBAUX
-- Paramétrables par l'Admin sans redéploiement
-- ==========================================
CREATE TABLE config_seuils (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cle TEXT UNIQUE NOT NULL,           -- ex: "PME_QUOTA_GLOBAL", "AVENANT_PLAFOND"
  valeur TEXT NOT NULL,               -- Valeur stockée (number, boolean, etc.)
  description TEXT,
  modifie_par UUID,                   -- user_id de l'admin
  modifie_le TIMESTAMPTZ DEFAULT NOW()
);

-- Seuils initiaux conformes aux arrêtés du 23/03/2023
INSERT INTO config_seuils (cle, valeur, description) VALUES
  ('SEUIL_ETAT_TRAVAUX', '70000000', 'Seuil AOO Travaux - État/Collectivités/EP (FCFA)'),
  ('SEUIL_ETAT_FOURNITURES', '50000000', 'Seuil AOO Fournitures/Services - État/EP (FCFA)'),
  ('SEUIL_AGENCE_TRAVAUX', '100000000', 'Seuil AOO Travaux - Agences/Sociétés publiques (FCFA)'),
  ('SEUIL_AGENCE_FOURNITURES', '60000000', 'Seuil AOO Fournitures - Agences/Sociétés publiques (FCFA)'),
  ('PME_QUOTA_GLOBAL', '0.05', 'Quota PME/ESS - 5% valeur annuelle marchés'),
  ('PME_QUOTA_FEMININ', '0.02', 'Quota PME direction féminine - 2% valeur annuelle'),
  ('AVENANT_PLAFOND', '0.30', 'Plafond avenants - 30% montant initial'),
  ('SOUSTRAITANCE_PLAFOND', '0.40', 'Plafond sous-traitance - 40% montant marché'),
  ('DELAI_RECOURS_JOURS', '10', 'Délai de recours avant attribution (jours)'),
  ('DELAI_DEPOT_OFFRES_MIN_AOO', '30', 'Délai minimal dépôt offres AOO (jours)'),
  ('DELAI_DEPOT_OFFRES_MIN_AOR', '21', 'Délai minimal dépôt offres AOR (jours)'),
  ('DELAI_DEPOT_OFFRES_MIN_DRP', '10', 'Délai minimal dépôt offres DRP (jours)');

COMMENT ON TABLE config_seuils IS 'Paramètres réglementaires modifiables par admin sans redéploiement';
