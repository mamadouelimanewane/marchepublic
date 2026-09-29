import { z } from 'zod'

export const tenderSchema = z.object({
  title: z.string().min(10, 'Le titre doit faire au moins 10 caractères'),
  description: z.string().optional(),
  nature_marche: z.enum(['TRAVAUX', 'FOURNITURES', 'SERVICES_COURANTS', 'PRESTATIONS_INTELLECTUELLES', 'DSP', 'PPP']),
  montant_estime: z.number().min(0, 'Le montant estimé doit être positif'),
  corps_metier_id: z.string().uuid('Corps de métier invalide'),
  is_reserve_pme: z.boolean().default(false),
  is_reserve_pme_feminine: z.boolean().default(false),
  ppm_annee: z.number().int().min(2024).max(2050),
  ppm_trimestre: z.number().int().min(1).max(4),
})

export type TenderInput = z.infer<typeof tenderSchema>
