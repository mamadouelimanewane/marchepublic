// Plafonds légaux (CDC §2.3) : avenants 30 %, sous-traitance 40 %, quotas PME 5 % / 2 %.
// Mêmes règles que les triggers `check_amendment_limit` / `check_subcontractor_limit`.

export const PLAFOND_AVENANTS = 0.3
export const PLAFOND_SOUS_TRAITANCE = 0.4
export const QUOTA_PME = 0.05
export const QUOTA_PME_FEMININE = 0.02

export interface VerificationPlafond {
  ok: boolean
  cumulApres: number
  pourcentage: number
  plafondMontant: number
  message?: string
}

/** Seules les augmentations consomment le plafond : un avenant en moins ne « recharge » pas la marge. */
export function verifierAvenant(montantInitial: number, avenantsExistants: number[], nouveau: number, plafond = PLAFOND_AVENANTS): VerificationPlafond {
  const cumulAvant = avenantsExistants.reduce((s, m) => s + Math.max(m, 0), 0)
  const cumulApres = cumulAvant + Math.max(nouveau, 0)
  const plafondMontant = montantInitial * plafond
  const pourcentage = Math.round((cumulApres * 10000) / montantInitial) / 100
  const ok = cumulApres <= plafondMontant
  return { ok, cumulApres, pourcentage, plafondMontant, message: ok ? undefined : `Le cumul des avenants (${pourcentage} %) dépasse le plafond légal de ${Math.round(plafond * 100)} %.` }
}

export function verifierSousTraitance(montantMarche: number, existants: number[], nouveau: number, plafond = PLAFOND_SOUS_TRAITANCE): VerificationPlafond {
  const cumulApres = existants.reduce((s, m) => s + m, 0) + nouveau
  const plafondMontant = montantMarche * plafond
  const pourcentage = Math.round((cumulApres * 10000) / montantMarche) / 100
  const ok = cumulApres <= plafondMontant
  return { ok, cumulApres, pourcentage, plafondMontant, message: ok ? undefined : `La sous-traitance (${pourcentage} %) dépasse le plafond légal de ${Math.round(plafond * 100)} %.` }
}

export function tauxQuota(montantQuota: number, montantTotal: number): number {
  return montantTotal > 0 ? Math.round((montantQuota * 10000) / montantTotal) / 100 : 0
}
