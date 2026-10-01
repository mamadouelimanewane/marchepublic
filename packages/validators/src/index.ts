// Schémas de validation (Zod) partagés par les formulaires, les server actions et les routes API.
// Ils doublent les contraintes de la base (CHECK, triggers) pour donner de bons messages en français ;
// la base reste l'autorité.
import { z } from 'zod'

const fcfa = (label: string) =>
  z.coerce.number({ invalid_type_error: `${label} : nombre attendu` }).int(`${label} : entier attendu`).positive(`${label} doit être strictement positif`)

const uuid = (label = 'Identifiant') => z.string().uuid(`${label} invalide`)
const texte = (label: string, min = 1, max = 5000) =>
  z.string().trim().min(min, `${label} : ${min} caractères minimum`).max(max, `${label} : ${max} caractères maximum`)
const optionalText = (max = 5000) => z.string().trim().max(max).optional().transform(v => (v ? v : undefined))

export const NATURES_MARCHE = ['TRAVAUX', 'FOURNITURES', 'SERVICES_COURANTS', 'PRESTATIONS_INTELLECTUELLES', 'DSP', 'PPP'] as const
export const MODES_PASSATION = ['AOO', 'AOR', 'AOO_2ETAPES', 'CONCOURS', 'DRP', 'ENTENTE_DIRECTE', 'ACCORD_CADRE'] as const

// ------------------------------------------
// Authentification
// ------------------------------------------
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Adresse e-mail invalide'),
  password: z.string().min(1, 'Mot de passe requis'),
})

export const registerSchema = z.object({
  full_name: texte('Nom complet', 3, 120),
  email: z.string().trim().toLowerCase().email('Adresse e-mail invalide'),
  password: z.string().min(10, 'Mot de passe : 10 caractères minimum').max(128)
    .regex(/[A-Za-z]/, 'Le mot de passe doit contenir une lettre')
    .regex(/[0-9]/, 'Le mot de passe doit contenir un chiffre'),
})

/** NINEA sénégalais : 7 chiffres + 3 caractères de contrôle (9 à 12 caractères alphanumériques au total selon les cas). */
export const nineaSchema = z.string().trim().toUpperCase().regex(/^[0-9]{7}[0-9A-Z]{0,5}$/, 'NINEA invalide')

export const profileSchema = z.object({
  full_name: texte('Nom complet', 3, 120),
  telephone: z.string().trim().regex(/^(\+221)?[0-9 ]{9,12}$/, 'Téléphone invalide').optional().or(z.literal('')),
  ninea: nineaSchema.optional().or(z.literal('')),
  rccm: z.string().trim().max(40).optional().or(z.literal('')),
})

export const adminUserSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  full_name: texte('Nom complet', 3, 120),
  role: z.enum(['SERVICE_DEMANDEUR', 'CPM', 'PRM', 'EVALUATEUR', 'DCMP', 'ARCOP', 'TRESOR', 'COUR_COMPTES', 'BAILLEUR', 'ADMIN']),
  institution_id: uuid('Institution').nullable().optional(),
}).refine(
  u => ['DCMP', 'ARCOP', 'COUR_COMPTES', 'BAILLEUR'].includes(u.role) || !!u.institution_id,
  { message: 'Une institution est requise pour ce rôle', path: ['institution_id'] },
)

// ------------------------------------------
// Programmation (besoins, marchés)
// ------------------------------------------
export const besoinSchema = z.object({
  intitule: texte('Intitulé', 10, 300),
  description: optionalText(),
  nature_marche: z.enum(NATURES_MARCHE),
  corps_metier_id: uuid('Corps de métier').optional().or(z.literal('').transform(() => undefined)),
  montant_estime: fcfa('Montant estimé'),
  ligne_budgetaire: texte('Ligne budgétaire', 1, 60),
  programme_budget: optionalText(120),
  annee_budget: z.coerce.number().int().min(2024).max(2050),
  trimestre_souhaite: z.coerce.number().int().min(1).max(4).optional(),
  justification: optionalText(),
})
export type BesoinInput = z.infer<typeof besoinSchema>

export const tenderSchema = z.object({
  title: texte('Titre', 10, 300),
  description: optionalText(),
  nature_marche: z.enum(NATURES_MARCHE),
  montant_estime: z.coerce.number().int().min(0, 'Le montant estimé doit être positif'),
  corps_metier_id: uuid('Corps de métier'),
  ligne_budgetaire: optionalText(60),
  is_reserve_pme: z.boolean().default(false),
  is_reserve_pme_feminine: z.boolean().default(false),
  is_cofinance: z.boolean().default(false),
  is_alloti: z.boolean().default(false),
  ppm_annee: z.number().int().min(2024).max(2050),
  ppm_trimestre: z.number().int().min(1).max(4),
  mode_passation: z.enum(MODES_PASSATION).optional(),
  justification_mode: optionalText(),
})
export type TenderInput = z.infer<typeof tenderSchema>

export const criteresSchema = z.array(z.object({
  critere: texte('Critère', 3, 200),
  ponderation: z.coerce.number().positive().max(100),
})).min(1, 'Au moins un critère')
  .refine(c => c.reduce((s, x) => s + x.ponderation, 0) === 100, { message: 'La somme des pondérations doit être égale à 100' })

export const calendrierSchema = z.object({
  date_limite_depot: z.string().min(1, 'Date limite requise').refine(v => !Number.isNaN(Date.parse(v)), 'Date invalide'),
  date_ouverture_plis: z.string().optional(),
})

// ------------------------------------------
// Documents, avis, Q/R
// ------------------------------------------
export const documentSchema = z.object({
  tender_id: uuid('Marché'),
  type: z.enum(['TDR', 'DAO']),
  titre: texte('Titre', 5, 200),
  template_id: uuid('Modèle').optional(),
})

export const sectionsSchema = z.array(z.object({
  id: z.string().min(1),
  titre: texte('Titre de section', 1, 200),
  contenu: z.string().max(100_000),
  obligatoire: z.boolean().optional(),
  consigne: z.string().max(5_000).optional(),
}))

export const reviewSchema = z.object({
  tender_id: uuid('Marché'),
  type: z.enum(['AVIS_NON_OBJECTION', 'NON_OBJECTION_BAILLEUR', 'DEROGATION', 'APPROBATION_ATTRIBUTION']),
  decision: z.enum(['FAVORABLE', 'DEFAVORABLE', 'COMPLEMENTAIRE']),
  motivation: optionalText(),
}).refine(r => r.decision === 'FAVORABLE' || (r.motivation ?? '').length >= 10, {
  message: 'Toute décision non favorable doit être motivée (10 caractères minimum)', path: ['motivation'],
})

export const questionSchema = z.object({ tender_id: uuid('Marché'), question: texte('Question', 10, 2000) })
export const reponseSchema = z.object({ id: uuid('Question'), reponse: texte('Réponse', 3, 4000) })

// ------------------------------------------
// Offres, ouverture, évaluation
// ------------------------------------------
export const SHA256 = /^[0-9a-f]{64}$/
export const bidSubmissionSchema = z.object({
  tender_id: uuid('Marché'),
  lot_id: uuid('Lot').optional(),
  technique_path: z.string().min(10), technique_hash: z.string().regex(SHA256, 'Empreinte SHA-256 invalide'),
  financier_path: z.string().min(10), financier_hash: z.string().regex(SHA256, 'Empreinte SHA-256 invalide'),
})

export const conformiteSchema = z.object({
  bid_id: uuid('Offre'),
  conformite_admin: z.boolean(),
  motif_non_conformite: optionalText(1000),
  montant_offre: fcfa('Montant de l\'offre').optional(),
}).refine(c => c.conformite_admin || (c.motif_non_conformite ?? '').length >= 5, { message: 'Motif de non-conformité obligatoire', path: ['motif_non_conformite'] })

export const grilleSchema = z.array(z.object({
  critere: z.string().min(1),
  ponderation: z.number().positive(),
  note: z.number().min(0),
  commentaire: z.string().max(1000).optional(),
})).refine(g => g.reduce((s, c) => s + c.ponderation, 0) === 100, 'La somme des pondérations doit être 100')
  .refine(g => g.every(c => c.note <= c.ponderation), 'Une note dépasse sa pondération')

export const attributionSchema = z.object({
  tender_id: uuid('Marché'),
  bid_id: uuid('Offre').optional(),
  justification: optionalText(),
})

export const lotSchema = z.object({
  numero_lot: z.coerce.number().int().positive(),
  libelle: texte('Libellé du lot', 3, 200),
  description: optionalText(),
  montant_estime: fcfa('Montant estimé'),
})

// ------------------------------------------
// Recours
// ------------------------------------------
export const appealSchema = z.object({
  tender_id: uuid('Marché'),
  motif: texte('Motif du recours', 10, 300),
  description: optionalText(10_000),
})
export const appealDecisionSchema = z.object({
  appeal_id: uuid('Recours'),
  decision: z.enum(['EN_INSTRUCTION', 'IRRECEVABLE', 'REJETE', 'FAVORABLE', 'PARTIELLEMENT_FAVORABLE']),
  motivation: optionalText(10_000),
}).refine(d => d.decision === 'EN_INSTRUCTION' || (d.motivation ?? '').length >= 20, {
  message: 'Décision motivée obligatoire (20 caractères minimum)', path: ['motivation'],
})

// ------------------------------------------
// Contrats et exécution
// ------------------------------------------
export const amendmentSchema = z.object({
  contract_id: uuid('Contrat'),
  numero_avenant: z.coerce.number().int().positive(),
  motif: texte('Motif', 10, 2000),
  montant_avenant: z.coerce.number().int().refine(n => n !== 0, 'Le montant ne peut pas être nul'),
})
export const subcontractorSchema = z.object({
  contract_id: uuid('Contrat'),
  nom_sous_traitant: texte('Sous-traitant', 2, 200),
  ninea: optionalText(20),
  objet: texte('Objet', 5, 500),
  montant: fcfa('Montant'),
})
export const guaranteeSchema = z.object({
  tender_id: uuid('Marché'),
  contract_id: uuid('Contrat').optional(),
  type: z.enum(['SOUMISSION', 'BONNE_EXECUTION', 'AVANCE_DEMARRAGE', 'RETENUE_GARANTIE']),
  montant: fcfa('Montant'),
  emetteur: texte('Émetteur', 2, 200),
  reference: texte('Référence', 2, 100),
  date_emission: z.string().min(1),
  date_expiration: z.string().min(1),
}).refine(g => g.date_expiration > g.date_emission, { message: 'La date d\'expiration doit suivre la date d\'émission', path: ['date_expiration'] })

export const serviceOrderSchema = z.object({
  contract_id: uuid('Contrat'),
  numero: z.coerce.number().int().positive(),
  type: z.enum(['DEMARRAGE', 'ARRET', 'REPRISE', 'MODIFICATION', 'AUTRE']),
  objet: texte('Objet', 5, 1000),
  date_effet: z.string().min(1),
})
export const incidentSchema = z.object({
  contract_id: uuid('Contrat'),
  gravite: z.enum(['MINEURE', 'MAJEURE', 'CRITIQUE']),
  description: texte('Description', 10, 4000),
  penalites_montant: z.coerce.number().int().min(0).default(0),
})
export const progressSchema = z.object({
  contract_id: uuid('Contrat'),
  taux_avancement: z.coerce.number().int().min(0).max(100),
  commentaire: optionalText(2000),
})
export const receptionSchema = z.object({
  contract_id: uuid('Contrat'),
  type: z.enum(['PROVISOIRE', 'DEFINITIVE']),
  statut: z.enum(['ACCEPTEE', 'ACCEPTEE_AVEC_RESERVES', 'REFUSEE']),
  reserves: optionalText(4000),
}).refine(r => r.statut !== 'ACCEPTEE_AVEC_RESERVES' || (r.reserves ?? '').length >= 5, { message: 'Précisez les réserves', path: ['reserves'] })
export const paymentSchema = z.object({
  contract_id: uuid('Contrat'),
  numero: z.coerce.number().int().positive(),
  type: z.enum(['AVANCE', 'ACOMPTE', 'SOLDE', 'LIBERATION_RETENUE']),
  montant: fcfa('Montant'),
})
export const providerEvaluationSchema = z.object({
  contract_id: uuid('Contrat'),
  note_qualite: z.coerce.number().min(0).max(10),
  note_delai: z.coerce.number().min(0).max(10),
  note_cout: z.coerce.number().min(0).max(10),
  commentaire: optionalText(2000),
})

// ------------------------------------------
// Administration
// ------------------------------------------
export const configValueSchema = z.object({
  cle: z.string().min(2),
  valeur: z.string().trim().min(1).refine(v => Number.isFinite(Number(v)), 'Valeur numérique attendue'),
})

/** Aplatit une erreur Zod en une phrase lisible pour un toast. */
export function formatZodError(error: z.ZodError): string {
  return error.issues.map(i => (i.path.length ? `${i.path.join('.')} : ` : '') + i.message).join(' — ')
}

/** Convertit un FormData en objet simple (les champs vides deviennent `undefined`). */
export function formDataToObject(fd: FormData): Record<string, FormDataEntryValue | undefined> {
  const out: Record<string, FormDataEntryValue | undefined> = {}
  for (const [k, v] of fd.entries()) out[k] = typeof v === 'string' && v.trim() === '' ? undefined : v
  return out
}
