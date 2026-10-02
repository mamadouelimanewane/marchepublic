import { TRAVAUX } from './metiers-travaux.mjs'
import { FOURNITURES } from './metiers-fournitures.mjs'
import { SERVICES } from './metiers-services.mjs'
import { PI, GENERIQUES } from './metiers-pi.mjs'

/** Fiches par corps de métier (une par modèle sectoriel) puis modèles génériques par famille de marché. */
export const METIERS = [...TRAVAUX, ...FOURNITURES, ...SERVICES, ...PI]
export const ALL = [...METIERS, ...GENERIQUES]
