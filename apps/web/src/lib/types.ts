// Types de lignes utilisés par les pages (sous-ensemble des colonnes réellement sélectionnées).
// `npm run db:types` génère les types complets dans packages/db ; ces interfaces restent volontairement légères.
import type { ModePassation, NatureMarche, TenderPhase } from '@marchepublic/workflow'

export interface TenderRow {
  id: string
  institution_id: string
  reference: string | null
  title: string
  description: string | null
  nature_marche: NatureMarche
  mode_passation: ModePassation | null
  mode_suggere: ModePassation | null
  justification_mode: string | null
  current_phase: TenderPhase
  montant_estime: number | null
  montant_attribue: number | null
  ligne_budgetaire: string | null
  ppm_annee: number | null
  ppm_trimestre: number | null
  corps_metier_id: string | null
  is_reserve_pme: boolean
  is_reserve_pme_feminine: boolean
  is_cofinance: boolean
  is_alloti: boolean
  date_publication: string | null
  date_limite_depot: string | null
  date_ouverture_plis: string | null
  date_fin_recours: string | null
  transmis_dcmp_at: string | null
  has_appeal_pending: boolean
  arcop_decision: string | null
  criteres_evaluation: { critere: string; ponderation: number }[]
  bid_public_key: string | null
  bid_key_fingerprint: string | null
  bid_key_shares: number | null
  bid_key_threshold: number | null
  attributaire_id: string | null
  attributaire_bid_id: string | null
  evaluation_round: number
  taux_avancement: number
  montant_avenants_cumule: number
  montant_soustrait_cumule: number
  closed_at: string | null
  issue: string | null
  motif_infructueux: string | null
  created_at: string
  institutions?: { name: string; type: string } | null
  corps_metiers?: { libelle: string } | null
}

export const TENDER_COLUMNS = `id, institution_id, reference, title, description, nature_marche, mode_passation, mode_suggere, justification_mode,
  current_phase, montant_estime, montant_attribue, ligne_budgetaire, ppm_annee, ppm_trimestre, corps_metier_id, is_reserve_pme,
  is_reserve_pme_feminine, is_cofinance, is_alloti, date_publication, date_limite_depot, date_ouverture_plis, date_fin_recours, transmis_dcmp_at,
  has_appeal_pending, arcop_decision, criteres_evaluation, bid_public_key, bid_key_fingerprint, bid_key_shares, bid_key_threshold, attributaire_id, attributaire_bid_id,
  evaluation_round, taux_avancement, montant_avenants_cumule, montant_soustrait_cumule, closed_at, issue, motif_infructueux, created_at,
  institutions(name, type), corps_metiers(libelle)`

export interface BidRow {
  id: string
  tender_id: string
  soumissionnaire_id: string
  status: string
  montant_offre: number | null
  conformite_admin: boolean | null
  motif_non_conformite: string | null
  fichier_technique_path: string | null
  fichier_financier_path: string | null
  fichier_technique_hash: string | null
  fichier_financier_hash: string | null
  submitted_at: string | null
  timestamp_token: string | null
  users?: { full_name: string; ninea: string | null; is_pme: boolean } | null
}

export interface ContractRow {
  id: string
  tender_id: string
  attributaire_id: string
  montant_initial: number
  montant_actuel: number | null
  date_debut_execution: string | null
  delai_execution: number | null
  signed_by_ac: boolean
  signed_by_titulaire: boolean
  visa_controleur: boolean
  status: string
}
