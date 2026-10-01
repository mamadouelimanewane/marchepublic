// Évaluation des offres : mêmes formules que la fonction SQL `_finalize_evaluation` (le serveur fait foi).
// Utilisé pour l'aperçu en direct côté interface et vérifié contre des valeurs de référence dans les tests.

export interface CritereNote { critere: string; ponderation: number; note: number }

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export function validerGrille(grille: CritereNote[], criteresAttendus?: { critere: string; ponderation: number }[]): string[] {
  const erreurs: string[] = []
  const somme = grille.reduce((s, c) => s + c.ponderation, 0)
  if (somme !== 100) erreurs.push(`La somme des pondérations doit être 100 (actuel : ${somme}).`)
  for (const c of grille) {
    if (!Number.isFinite(c.note) || c.note < 0 || c.note > c.ponderation) {
      erreurs.push(`La note de « ${c.critere} » doit être comprise entre 0 et ${c.ponderation}.`)
    }
  }
  if (criteresAttendus?.length) {
    const cle = (x: { critere: string; ponderation: number }) => `${x.critere}|${x.ponderation}`
    const a = grille.map(cle).sort().join(';')
    const b = criteresAttendus.map(cle).sort().join(';')
    if (a !== b) erreurs.push('La grille doit reprendre exactement les critères du dossier d\'appel d\'offres.')
  }
  return erreurs
}

export function scoreTechnique(grille: CritereNote[]): number {
  return round2(grille.reduce((s, c) => s + c.note, 0))
}

export function poidsTechnique(nature: string, config = { standard: 0.7, pi: 0.8 }): number {
  return nature === 'PRESTATIONS_INTELLECTUELLES' ? config.pi : config.standard
}

export interface OffreEvaluee {
  id: string
  montant: number
  soumisLe: string | Date
  /** Notes techniques attribuées par chaque évaluateur (≥ 2 requis). */
  notesEvaluateurs: number[]
}

export interface Classement {
  id: string
  montant: number
  scoreTechnique: number
  scoreFinancier: number | null
  scoreGlobal: number | null
  qualifie: boolean
  rang: number | null
}

export class EvaluationError extends Error {
  constructor(public code: 'NO_ELIGIBLE_BID' | 'EVALUATION_INCOMPLETE' | 'NO_QUALIFIED_BID', message: string) {
    super(message)
  }
}

/**
 * Classement : note technique = moyenne des évaluateurs ; admis si ≥ seuil ; note financière = 100 × (moins-disant admis / montant) ;
 * note globale = w × technique + (1 − w) × financière ; départage : montant le plus bas, puis dépôt le plus ancien.
 */
export function classerOffres(
  offres: OffreEvaluee[],
  opts: { seuilTechnique?: number; poidsTechnique?: number; minEvaluateurs?: number } = {},
): Classement[] {
  const seuil = opts.seuilTechnique ?? 70
  const w = opts.poidsTechnique ?? 0.7
  const minEval = opts.minEvaluateurs ?? 2
  if (offres.length === 0) throw new EvaluationError('NO_ELIGIBLE_BID', 'Aucune offre conforme — procédure infructueuse.')
  for (const o of offres) {
    if (o.notesEvaluateurs.length < minEval) {
      throw new EvaluationError('EVALUATION_INCOMPLETE', `Chaque offre conforme doit être notée par au moins ${minEval} évaluateurs.`)
    }
  }
  const avec = offres.map(o => {
    const st = round2(o.notesEvaluateurs.reduce((a, b) => a + b, 0) / o.notesEvaluateurs.length)
    return { o, st, ok: st >= seuil }
  })
  const admis = avec.filter(x => x.ok)
  if (admis.length === 0) throw new EvaluationError('NO_QUALIFIED_BID', `Aucune offre n'atteint la note technique minimale (${seuil}).`)
  const min = Math.min(...admis.map(x => x.o.montant))

  const scored = avec.map(({ o, st, ok }) => {
    const sf = ok ? round2((100 * min) / o.montant) : null
    const sg = ok ? round2(w * st + (1 - w) * ((100 * min) / o.montant)) : null
    return { o, st, ok, sf, sg }
  })
  scored.sort((a, b) =>
    (b.sg ?? -1) - (a.sg ?? -1) ||
    a.o.montant - b.o.montant ||
    new Date(a.o.soumisLe).getTime() - new Date(b.o.soumisLe).getTime())

  let rang = 0
  return scored.map(s => ({
    id: s.o.id, montant: s.o.montant, scoreTechnique: s.st, scoreFinancier: s.sf, scoreGlobal: s.sg,
    qualifie: s.ok, rang: s.ok ? ++rang : null,
  }))
}
