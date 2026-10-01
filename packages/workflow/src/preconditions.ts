// Pré-conditions de chaque transition, exprimées en français pour l'interface.
// Elles reprennent les garde-fous du trigger SQL `tenders_guard` afin d'expliquer POURQUOI une action est bloquée
// avant même de tenter l'appel. La base applique de toute façon ces règles, quoi que l'interface affiche.
import type { TenderEventType, TenderPhase } from './phases'
import { delaiMinimalDepot } from './domain/delais'
import type { ModePassation } from './domain/seuils'

export interface TenderFacts {
  phase: TenderPhase
  modePassation?: ModePassation | null
  montantEstime?: number | null
  ligneBudgetaire?: string | null
  ppmAnnee?: number | null
  /** Somme des pondérations des critères d'évaluation du dossier. */
  criteresTotal?: number
  documentValide?: boolean
  avisDcmpFavorable?: boolean
  isCofinance?: boolean
  bailleurFavorable?: boolean
  derogationFavorable?: boolean
  datePublication?: string | Date | null
  dateLimiteDepot?: string | Date | null
  bidPublicKey?: string | null
  ouvertureSignee?: boolean
  offresNonControlees?: number
  offresConformes?: number
  offresEvalueesParDeuxEvaluateurs?: boolean
  classementFinalise?: boolean
  attributaireDefini?: boolean
  hasAppealPending?: boolean
  dateFinRecours?: string | Date | null
  approbationDcmp?: boolean
  contratSigneEtVise?: boolean
  garantieBonneExecution?: boolean
  garantieRequise?: boolean
  receptionProvisoire?: boolean
  receptionDefinitive?: boolean
}

const d = (v: string | Date | null | undefined) => (v ? new Date(v) : null)
const fmt = (date: Date) => date.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })

export function missingPreconditions(event: TenderEventType, f: TenderFacts, now: Date = new Date()): string[] {
  const m: string[] = []
  switch (event) {
    case 'VALIDER_PPM':
      if (!f.montantEstime || f.montantEstime <= 0) m.push('Renseigner le montant estimé.')
      if (!f.ligneBudgetaire) m.push('Renseigner la ligne budgétaire.')
      if (!f.ppmAnnee) m.push('Renseigner l\'année du PPM.')
      if (!f.modePassation) m.push('Déterminer le mode de passation.')
      break
    case 'FINALISER_DAO':
      if (!f.documentValide) m.push('Faire valider le TDR/DAO par le PRM (circuit : rédaction → relecture CPM → validation PRM).')
      if (f.modePassation !== 'ENTENTE_DIRECTE' && f.criteresTotal !== 100) m.push(`Définir les critères d'évaluation (somme des pondérations = 100, actuel : ${f.criteresTotal ?? 0}).`)
      break
    case 'PUBLIER_AO':
      if (!f.avisDcmpFavorable) m.push('Avis de non-objection favorable de la DCMP requis.')
      if (f.isCofinance && !f.bailleurFavorable) m.push('Non-objection du bailleur requise (marché cofinancé).')
      if (f.modePassation === 'ENTENTE_DIRECTE' && !f.derogationFavorable) m.push('Dérogation favorable de la DCMP requise pour l\'entente directe.')
      break
    case 'OUVRIR_DEPOT': {
      const limite = d(f.dateLimiteDepot)
      const pub = d(f.datePublication)
      if (!limite) m.push('Fixer la date limite de dépôt.')
      if (!f.bidPublicKey) m.push('Générer la clé de chiffrement des offres du marché.')
      if (limite && limite <= now) m.push('La date limite de dépôt est déjà passée.')
      if (limite && pub && f.modePassation) {
        const minimum = new Date(pub.getTime() + delaiMinimalDepot(f.modePassation) * 86_400_000)
        if (limite < minimum) m.push(`Délai minimal non respecté : date limite au plus tôt le ${fmt(minimum)}.`)
      }
      break
    }
    case 'FERMER_DEPOT': {
      const limite = d(f.dateLimiteDepot)
      if (!limite || now < limite) m.push(`La date limite de dépôt${limite ? ` (${fmt(limite)})` : ''} n'est pas atteinte.`)
      break
    }
    case 'DECLENCHER_OUVERTURE':
      if (!f.ouvertureSignee) m.push('Double signature requise : CPM et président de la commission.')
      break
    case 'FINALISER_EVALUATION':
      if ((f.offresNonControlees ?? 0) > 0) m.push('Contrôler la conformité administrative de toutes les offres.')
      if (!f.offresConformes) m.push('Aucune offre conforme : procédure infructueuse.')
      if (!f.offresEvalueesParDeuxEvaluateurs) m.push('Chaque offre conforme doit être notée par au moins deux évaluateurs.')
      break
    case 'PRONONCER_ATTRIBUTION_PROVISOIRE':
      if (!f.classementFinalise) m.push('Finaliser l\'évaluation (classement des offres).')
      break
    case 'CLORE_PERIODE_RECOURS': {
      const fin = d(f.dateFinRecours)
      if (f.hasAppealPending) m.push('🔒 Un recours est pendant devant l\'ARCOP : l\'attribution définitive est bloquée.')
      if (fin && now < fin) m.push(`Le délai de recours court jusqu'au ${fmt(fin)}.`)
      break
    }
    case 'CONFIRMER_ATTRIBUTION_DEFINITIVE':
      if (f.hasAppealPending) m.push('🔒 Un recours est pendant devant l\'ARCOP.')
      if (!f.approbationDcmp) m.push('Approbation de l\'attribution par la DCMP requise.')
      break
    case 'SIGNER_CONTRAT':
      if (f.hasAppealPending) m.push('🔒 Signature impossible : un recours est pendant.')
      if (!f.contratSigneEtVise) m.push('Contrat signé par l\'autorité contractante et le titulaire, et visé par le contrôle financier.')
      if (f.garantieRequise && !f.garantieBonneExecution) m.push('Garantie de bonne exécution valide requise.')
      break
    case 'CONSTATER_RECEPTION_PROVISOIRE':
      if (!f.receptionProvisoire) m.push('Enregistrer un PV de réception provisoire accepté.')
      break
    case 'CONSTATER_RECEPTION_DEFINITIVE':
      if (!f.receptionDefinitive) m.push('Enregistrer un PV de réception définitive accepté.')
      break
    default:
      break
  }
  return m
}
