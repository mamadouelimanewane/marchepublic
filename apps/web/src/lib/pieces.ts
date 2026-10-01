// Types de pièces du dossier permanent du fournisseur (hors fichier « use server » : seules des fonctions y sont exportables).
export const PIECE_TYPES = ['QUITUS_FISCAL', 'RCCM', 'NINEA', 'ATTESTATION_CNSS', 'ATTESTATION_BANCAIRE', 'REFERENCE_MARCHE', 'AUTRE'] as const
export type PieceType = (typeof PIECE_TYPES)[number]

export const PIECE_LABELS: Record<string, string> = {
  QUITUS_FISCAL: 'Quitus fiscal', RCCM: 'Registre du commerce (RCCM)', NINEA: 'NINEA', ATTESTATION_CNSS: 'Attestation CNSS / IPRES',
  ATTESTATION_BANCAIRE: 'Attestation bancaire', REFERENCE_MARCHE: 'Référence de marché similaire', AUTRE: 'Autre pièce',
}

export const SITUATION_TONE: Record<string, 'green' | 'amber' | 'red' | 'gray'> = { VALIDE: 'green', NON_VERIFIE: 'amber', EXPIRE: 'red', REFUSE: 'red', ABSENT: 'gray' }
export const SITUATION_LABEL: Record<string, string> = { VALIDE: 'Valide', NON_VERIFIE: 'En attente de vérification', EXPIRE: 'Expirée', REFUSE: 'Refusée', ABSENT: 'Absente' }
