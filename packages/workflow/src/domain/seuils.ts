// Seuils de passation (CDC §2.3). Toujours paramétrables : les valeurs par défaut ci-dessous ne servent qu'au
// démarrage et aux tests ; en production elles proviennent de la table `config_seuils` (administrateur).

export type NatureMarche = 'TRAVAUX' | 'FOURNITURES' | 'SERVICES_COURANTS' | 'PRESTATIONS_INTELLECTUELLES' | 'DSP' | 'PPP'
export type TypeInstitution = 'ETAT' | 'COLLECTIVITE' | 'ETABLISSEMENT_PUBLIC' | 'SOCIETE_PUBLIQUE' | 'AGENCE'
export type ModePassation = 'AOO' | 'AOR' | 'AOO_2ETAPES' | 'CONCOURS' | 'DRP' | 'ENTENTE_DIRECTE' | 'ACCORD_CADRE'

export interface SeuilsConfig {
  ETAT: { travaux: number; autres: number }
  AGENCE: { travaux: number; autres: number }
}

export const SEUILS_PAR_DEFAUT: SeuilsConfig = {
  ETAT: { travaux: 70_000_000, autres: 50_000_000 },
  AGENCE: { travaux: 100_000_000, autres: 60_000_000 },
}

/** Construit la configuration depuis les lignes `config_seuils` (clé → valeur texte). */
export function seuilsFromConfig(rows: { cle: string; valeur: string }[]): SeuilsConfig {
  const get = (cle: string, fallback: number) => {
    const found = rows.find(r => r.cle === cle)
    const n = found ? Number(found.valeur) : NaN
    return Number.isFinite(n) ? n : fallback
  }
  return {
    ETAT: {
      travaux: get('SEUIL_ETAT_TRAVAUX', SEUILS_PAR_DEFAUT.ETAT.travaux),
      autres: get('SEUIL_ETAT_FOURNITURES', SEUILS_PAR_DEFAUT.ETAT.autres),
    },
    AGENCE: {
      travaux: get('SEUIL_AGENCE_TRAVAUX', SEUILS_PAR_DEFAUT.AGENCE.travaux),
      autres: get('SEUIL_AGENCE_FOURNITURES', SEUILS_PAR_DEFAUT.AGENCE.autres),
    },
  }
}

export function portee(type: TypeInstitution): 'ETAT' | 'AGENCE' {
  return type === 'SOCIETE_PUBLIQUE' || type === 'AGENCE' ? 'AGENCE' : 'ETAT'
}

export interface SeuilOverride { travaux?: number | null; fournitures?: number | null }

export function seuilAoo(
  type: TypeInstitution,
  nature: NatureMarche,
  config: SeuilsConfig = SEUILS_PAR_DEFAUT,
  override?: SeuilOverride,
): number {
  if (nature === 'TRAVAUX') return override?.travaux ?? config[portee(type)].travaux
  return override?.fournitures ?? config[portee(type)].autres
}

/**
 * Mode de passation SUGGÉRÉ : appel d'offres ouvert à partir du seuil, DRP en deçà ; DSP/PPP toujours en appel d'offres.
 * (L'ancienne version inventait une bande « AOR à 50 % du seuil » : l'AOR est un choix justifié, jamais automatique.)
 */
export function calculerModePassation(
  montant: number,
  nature: NatureMarche,
  type: TypeInstitution,
  config: SeuilsConfig = SEUILS_PAR_DEFAUT,
  override?: SeuilOverride,
): ModePassation {
  if (nature === 'DSP' || nature === 'PPP') return 'AOO'
  return montant >= seuilAoo(type, nature, config, override) ? 'AOO' : 'DRP'
}

export interface ValidationMode { ok: boolean; erreurs: string[] }

/** Mêmes règles que le trigger `tenders_guard` (DRP interdite au-delà du seuil, justification d'un écart). */
export function validerModePassation(
  mode: ModePassation,
  montant: number,
  nature: NatureMarche,
  type: TypeInstitution,
  justification: string | null | undefined,
  config: SeuilsConfig = SEUILS_PAR_DEFAUT,
  override?: SeuilOverride,
): ValidationMode {
  const erreurs: string[] = []
  const suggere = calculerModePassation(montant, nature, type, config, override)
  if (mode === 'DRP' && nature !== 'DSP' && nature !== 'PPP' && montant >= seuilAoo(type, nature, config, override)) {
    erreurs.push(`La DRP n'est pas admise au-delà du seuil de ${seuilAoo(type, nature, config, override).toLocaleString('fr-FR')} FCFA.`)
  }
  if ((mode !== suggere || mode === 'ENTENTE_DIRECTE') && (justification ?? '').trim().length < 20) {
    erreurs.push(`Un mode de passation (${mode}) différent du mode réglementaire (${suggere}) doit être justifié (20 caractères minimum).`)
  }
  return { ok: erreurs.length === 0, erreurs }
}
