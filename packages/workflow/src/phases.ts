// ==========================================
// Les 15 phases du cycle de vie d'un marché (CDC §5) et leurs transitions légales.
//
// Source de vérité côté base : table `phase_transitions` (supabase/migrations/0010).
// Ce fichier en est le miroir TypeScript (navigation, libellés, actions proposées à l'utilisateur) ;
// le test `sql-parity.test.ts` échoue si les deux divergent. La base reste l'autorité : même si l'interface
// est contournée, les verrous (recours, dates limites, plafonds) sont appliqués par des triggers.
// ==========================================
import type { Role } from './roles'

export const PHASES = [
  'PHASE_1_PROGRAMMATION',
  'PHASE_2_REDACTION',
  'PHASE_3_VALIDATION_PRIORI',
  'PHASE_4_PUBLICATION',
  'PHASE_5_CLARIFICATIONS',
  'PHASE_6_DEPOT_OFFRES',
  'PHASE_7_OUVERTURE_PLIS',
  'PHASE_8_EVALUATION',
  'PHASE_9_ATTRIBUTION_PROVISOIRE',
  'PHASE_10_RECOURS',
  'PHASE_11_ATTRIBUTION_DEFINITIVE',
  'PHASE_12_SIGNATURE_CONTRAT',
  'PHASE_13_EXECUTION',
  'PHASE_14_RECEPTION_PAIEMENT',
  'PHASE_15_CLOTURE_ARCHIVAGE',
] as const

export type TenderPhase = (typeof PHASES)[number]

export function phaseNumber(phase: TenderPhase): number {
  return PHASES.indexOf(phase) + 1
}

export const PHASE_LABELS: Record<TenderPhase, string> = {
  PHASE_1_PROGRAMMATION: '1. Programmation & PPM',
  PHASE_2_REDACTION: '2. Rédaction TDR/DAO',
  PHASE_3_VALIDATION_PRIORI: '3. Contrôle a priori DCMP',
  PHASE_4_PUBLICATION: '4. Publication AO',
  PHASE_5_CLARIFICATIONS: '5. Clarifications & Q&R',
  PHASE_6_DEPOT_OFFRES: '6. Dépôt des offres',
  PHASE_7_OUVERTURE_PLIS: '7. Ouverture des plis',
  PHASE_8_EVALUATION: '8. Évaluation',
  PHASE_9_ATTRIBUTION_PROVISOIRE: '9. Attribution provisoire',
  PHASE_10_RECOURS: '10. Recours ARCOP',
  PHASE_11_ATTRIBUTION_DEFINITIVE: '11. Attribution définitive',
  PHASE_12_SIGNATURE_CONTRAT: '12. Signature contrat',
  PHASE_13_EXECUTION: '13. Exécution',
  PHASE_14_RECEPTION_PAIEMENT: '14. Réception & paiement',
  PHASE_15_CLOTURE_ARCHIVAGE: '15. Clôture & archivage',
}

export function getPhaseLabel(phase: TenderPhase): string {
  return PHASE_LABELS[phase] ?? phase
}

export interface PhaseMeta {
  label: string
  description: string
  actors: string[]
  /** Phase où la base refuse toute avancée tant qu'une condition dure n'est pas levée. */
  hardLock?: boolean
}

export const PHASE_META: Record<TenderPhase, PhaseMeta> = {
  PHASE_1_PROGRAMMATION: { label: 'Programmation budgétaire', actors: ['SERVICE_DEMANDEUR', 'PRM'], description: 'Inscription du besoin au budget-programme et au Plan de Passation des Marchés.' },
  PHASE_2_REDACTION: { label: 'Élaboration TDR / DAO', actors: ['SERVICE_DEMANDEUR', 'CPM', 'PRM'], description: 'Rédaction assistée, relecture CPM, validation PRM. Critères d\'évaluation (Σ = 100).' },
  PHASE_3_VALIDATION_PRIORI: { label: 'Contrôle a priori', actors: ['PRM', 'DCMP', 'BAILLEUR'], description: 'Dossier verrouillé. Avis de non-objection de la DCMP (et du bailleur si cofinancement).' },
  PHASE_4_PUBLICATION: { label: 'Publication et lancement', actors: ['CPM'], description: 'Publication de l\'avis sur le portail national et la plateforme.' },
  PHASE_5_CLARIFICATIONS: { label: 'Retrait et clarifications', actors: ['CPM', 'SOUMISSIONNAIRE'], description: 'Retrait du dossier, questions-réponses diffusées à tous les candidats, additifs.' },
  PHASE_6_DEPOT_OFFRES: { label: 'Dépôt des offres', actors: ['SOUMISSIONNAIRE'], description: 'Dépôt chiffré dans le navigateur, horodaté par le serveur, avant la date limite.', hardLock: true },
  PHASE_7_OUVERTURE_PLIS: { label: 'Ouverture des plis', actors: ['CPM', 'COMMISSION'], description: 'Double signature (CPM + président de commission). Déchiffrement dans le navigateur de la commission.', hardLock: true },
  PHASE_8_EVALUATION: { label: 'Évaluation des offres', actors: ['COMMISSION'], description: 'Notation technique par au moins deux évaluateurs, classement calculé par le serveur.' },
  PHASE_9_ATTRIBUTION_PROVISOIRE: { label: 'Attribution provisoire', actors: ['PRM', 'CPM'], description: 'Décision provisoire, notification de tous les candidats.' },
  PHASE_10_RECOURS: { label: 'Recours avant attribution', actors: ['SOUMISSIONNAIRE', 'ARCOP'], description: 'Délai légal de recours. Tout recours pendant bloque l\'attribution définitive.', hardLock: true },
  PHASE_11_ATTRIBUTION_DEFINITIVE: { label: 'Attribution définitive', actors: ['PRM', 'DCMP'], description: 'Confirmation après purge des recours, approbation par l\'autorité compétente.' },
  PHASE_12_SIGNATURE_CONTRAT: { label: 'Signature du contrat', actors: ['PRM', 'ATTRIBUTAIRE', 'TRESOR'], description: 'Contrat, garanties, signatures, visa du contrôle financier.' },
  PHASE_13_EXECUTION: { label: 'Exécution du marché', actors: ['PRM', 'ATTRIBUTAIRE', 'CPM'], description: 'Ordres de service, avancement, avenants (≤ 30 %) et sous-traitance (≤ 40 %).', hardLock: true },
  PHASE_14_RECEPTION_PAIEMENT: { label: 'Réception et paiement', actors: ['COMMISSION_RECEPTION', 'TRESOR'], description: 'Réception provisoire puis définitive, décomptes et paiements.' },
  PHASE_15_CLOTURE_ARCHIVAGE: { label: 'Clôture et archivage', actors: ['CPM', 'ADMIN'], description: 'Clôture administrative, évaluation du prestataire, archivage non modifiable.' },
}

export type TenderEventType =
  | 'VALIDER_PPM'
  | 'FINALISER_DAO'
  | 'RECEVOIR_AVIS_DCMP'
  | 'PUBLIER_AO'
  | 'OUVRIR_DEPOT'
  | 'FERMER_DEPOT'
  | 'DECLENCHER_OUVERTURE'
  | 'FINALISER_EVALUATION'
  | 'PRONONCER_ATTRIBUTION_PROVISOIRE'
  | 'CLORE_PERIODE_RECOURS'
  | 'DECISION_ARCOP'
  | 'CONFIRMER_ATTRIBUTION_DEFINITIVE'
  | 'SIGNER_CONTRAT'
  | 'CONSTATER_RECEPTION_PROVISOIRE'
  | 'CONSTATER_RECEPTION_DEFINITIVE'
  | 'DECLARER_INFRUCTUEUX'

export interface Transition {
  from: TenderPhase
  to: TenderPhase
  event: TenderEventType
  roles: readonly Role[]
  /** true : exécutable via la RPC `advance_phase` ; false : passe par une RPC dédiée (avis, ouverture, recours). */
  direct: boolean
}

export const TRANSITIONS: readonly Transition[] = [
  { from: 'PHASE_1_PROGRAMMATION', to: 'PHASE_2_REDACTION', event: 'VALIDER_PPM', roles: ['PRM', 'CPM'], direct: true },
  { from: 'PHASE_2_REDACTION', to: 'PHASE_3_VALIDATION_PRIORI', event: 'FINALISER_DAO', roles: ['PRM', 'CPM'], direct: true },
  { from: 'PHASE_3_VALIDATION_PRIORI', to: 'PHASE_4_PUBLICATION', event: 'RECEVOIR_AVIS_DCMP', roles: ['DCMP', 'BAILLEUR'], direct: false },
  { from: 'PHASE_3_VALIDATION_PRIORI', to: 'PHASE_2_REDACTION', event: 'RECEVOIR_AVIS_DCMP', roles: ['DCMP', 'BAILLEUR'], direct: false },
  { from: 'PHASE_4_PUBLICATION', to: 'PHASE_5_CLARIFICATIONS', event: 'PUBLIER_AO', roles: ['CPM', 'PRM'], direct: true },
  { from: 'PHASE_5_CLARIFICATIONS', to: 'PHASE_6_DEPOT_OFFRES', event: 'OUVRIR_DEPOT', roles: ['CPM', 'PRM'], direct: true },
  { from: 'PHASE_6_DEPOT_OFFRES', to: 'PHASE_7_OUVERTURE_PLIS', event: 'FERMER_DEPOT', roles: ['CPM', 'PRM'], direct: true },
  { from: 'PHASE_7_OUVERTURE_PLIS', to: 'PHASE_8_EVALUATION', event: 'DECLENCHER_OUVERTURE', roles: ['CPM', 'EVALUATEUR', 'PRM'], direct: false },
  { from: 'PHASE_8_EVALUATION', to: 'PHASE_9_ATTRIBUTION_PROVISOIRE', event: 'FINALISER_EVALUATION', roles: ['PRM', 'CPM'], direct: true },
  { from: 'PHASE_9_ATTRIBUTION_PROVISOIRE', to: 'PHASE_10_RECOURS', event: 'PRONONCER_ATTRIBUTION_PROVISOIRE', roles: ['PRM'], direct: true },
  { from: 'PHASE_10_RECOURS', to: 'PHASE_11_ATTRIBUTION_DEFINITIVE', event: 'CLORE_PERIODE_RECOURS', roles: ['PRM', 'CPM'], direct: true },
  { from: 'PHASE_10_RECOURS', to: 'PHASE_8_EVALUATION', event: 'DECISION_ARCOP', roles: ['ARCOP'], direct: false },
  { from: 'PHASE_11_ATTRIBUTION_DEFINITIVE', to: 'PHASE_12_SIGNATURE_CONTRAT', event: 'CONFIRMER_ATTRIBUTION_DEFINITIVE', roles: ['PRM'], direct: true },
  { from: 'PHASE_12_SIGNATURE_CONTRAT', to: 'PHASE_13_EXECUTION', event: 'SIGNER_CONTRAT', roles: ['PRM'], direct: true },
  { from: 'PHASE_13_EXECUTION', to: 'PHASE_14_RECEPTION_PAIEMENT', event: 'CONSTATER_RECEPTION_PROVISOIRE', roles: ['PRM', 'CPM'], direct: true },
  { from: 'PHASE_14_RECEPTION_PAIEMENT', to: 'PHASE_15_CLOTURE_ARCHIVAGE', event: 'CONSTATER_RECEPTION_DEFINITIVE', roles: ['PRM', 'CPM'], direct: true },
  { from: 'PHASE_8_EVALUATION', to: 'PHASE_15_CLOTURE_ARCHIVAGE', event: 'DECLARER_INFRUCTUEUX', roles: ['PRM'], direct: true },
]

export function transitionsFrom(phase: TenderPhase): Transition[] {
  return TRANSITIONS.filter(t => t.from === phase)
}

/** Événements que `role` peut déclencher via advance_phase depuis `phase`. */
export function availableEvents(phase: TenderPhase, role: Role): Transition[] {
  return transitionsFrom(phase).filter(t => t.direct && t.roles.includes(role))
}

export function isLegalTransition(from: TenderPhase, to: TenderPhase): boolean {
  return TRANSITIONS.some(t => t.from === from && t.to === to)
}

/** Libellés des boutons d'action (forme verbale, français administratif). */
export const EVENT_LABELS: Record<TenderEventType, string> = {
  VALIDER_PPM: 'Valider l\'inscription au PPM',
  FINALISER_DAO: 'Transmettre à la DCMP',
  RECEVOIR_AVIS_DCMP: 'Avis DCMP',
  PUBLIER_AO: 'Publier l\'avis d\'appel d\'offres',
  OUVRIR_DEPOT: 'Ouvrir le dépôt des offres',
  FERMER_DEPOT: 'Clôturer le dépôt',
  DECLENCHER_OUVERTURE: 'Signer l\'ouverture des plis',
  FINALISER_EVALUATION: 'Finaliser l\'évaluation et classer',
  PRONONCER_ATTRIBUTION_PROVISOIRE: 'Prononcer l\'attribution provisoire',
  CLORE_PERIODE_RECOURS: 'Clore la période de recours',
  DECISION_ARCOP: 'Décision ARCOP',
  CONFIRMER_ATTRIBUTION_DEFINITIVE: 'Confirmer l\'attribution définitive',
  SIGNER_CONTRAT: 'Lancer l\'exécution (contrat signé)',
  CONSTATER_RECEPTION_PROVISOIRE: 'Passer en réception / paiement',
  CONSTATER_RECEPTION_DEFINITIVE: 'Clôturer le marché',
  DECLARER_INFRUCTUEUX: 'Déclarer la procédure infructueuse',
}
