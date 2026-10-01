// Délais réglementaires (paramétrables dans `config_seuils` : DELAI_*).
import type { ModePassation } from './seuils'

export const DELAIS_DEPOT_MIN_JOURS: Record<ModePassation, number> = {
  AOO: 30, AOR: 21, AOO_2ETAPES: 30, CONCOURS: 30, DRP: 10, ENTENTE_DIRECTE: 0, ACCORD_CADRE: 30,
}

export function delaiMinimalDepot(mode: ModePassation, config: Partial<Record<ModePassation, number>> = {}): number {
  return config[mode] ?? DELAIS_DEPOT_MIN_JOURS[mode]
}

const JOUR_MS = 86_400_000

/** Date limite de dépôt la plus proche autorisée pour une publication donnée. */
export function dateLimiteMinimale(publication: Date, mode: ModePassation, config?: Partial<Record<ModePassation, number>>): Date {
  return new Date(publication.getTime() + delaiMinimalDepot(mode, config) * JOUR_MS)
}

export function dateFinRecours(attributionProvisoire: Date, delaiJours = 10): Date {
  return new Date(attributionProvisoire.getTime() + delaiJours * JOUR_MS)
}

export function joursRestants(cible: Date, maintenant: Date = new Date()): number {
  return Math.ceil((cible.getTime() - maintenant.getTime()) / JOUR_MS)
}

export function estTardif(depot: Date, dateLimite: Date): boolean {
  return depot.getTime() >= dateLimite.getTime()
}
