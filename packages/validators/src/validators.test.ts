import { describe, expect, it } from 'vitest'
import {
  amendmentSchema, appealDecisionSchema, appealSchema, bidSubmissionSchema, criteresSchema, formatZodError, registerSchema, sectionsSchema, reviewSchema, tenderSchema,
} from './index'

const uuid = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

describe('schémas', () => {
  it('les critères doivent sommer à 100', () => {
    expect(criteresSchema.safeParse([{ critere: 'Expérience', ponderation: 60 }, { critere: 'Prix', ponderation: 40 }]).success).toBe(true)
    const r = criteresSchema.safeParse([{ critere: 'Expérience', ponderation: 60 }])
    expect(r.success).toBe(false)
    if (!r.success) expect(formatZodError(r.error)).toMatch(/égale à 100/)
  })

  it('un avis non favorable doit être motivé', () => {
    expect(reviewSchema.safeParse({ tender_id: uuid, type: 'AVIS_NON_OBJECTION', decision: 'DEFAVORABLE' }).success).toBe(false)
    expect(reviewSchema.safeParse({ tender_id: uuid, type: 'AVIS_NON_OBJECTION', decision: 'DEFAVORABLE', motivation: 'Critères imprécis' }).success).toBe(true)
    expect(reviewSchema.safeParse({ tender_id: uuid, type: 'AVIS_NON_OBJECTION', decision: 'FAVORABLE' }).success).toBe(true)
  })

  it('décision ARCOP motivée, sauf la mise en instruction', () => {
    expect(appealDecisionSchema.safeParse({ appeal_id: uuid, decision: 'EN_INSTRUCTION' }).success).toBe(true)
    expect(appealDecisionSchema.safeParse({ appeal_id: uuid, decision: 'REJETE', motivation: 'court' }).success).toBe(false)
  })

  it('les champs de formulaire (chaînes) sont convertis en nombres', () => {
    const r = amendmentSchema.parse({ contract_id: uuid, numero_avenant: '2', motif: 'Travaux supplémentaires', montant_avenant: '5000000' })
    expect(r.montant_avenant).toBe(5_000_000)
    expect(amendmentSchema.safeParse({ contract_id: uuid, numero_avenant: 1, motif: 'Travaux supplémentaires', montant_avenant: 0 }).success).toBe(false)
  })

  it('dépôt : empreintes SHA-256 obligatoires', () => {
    const ok = { tender_id: uuid, technique_path: 'a/b/tech.json', technique_hash: 'a'.repeat(64), financier_path: 'a/b/fin.json', financier_hash: 'b'.repeat(64) }
    expect(bidSubmissionSchema.safeParse(ok).success).toBe(true)
    expect(bidSubmissionSchema.safeParse({ ...ok, financier_hash: 'xyz' }).success).toBe(false)
  })

  it('inscription : mot de passe robuste', () => {
    expect(registerSchema.safeParse({ full_name: 'Awa Diop', email: 'AWA@EXEMPLE.SN', password: 'motdepasse1' }).success).toBe(true)
    expect(registerSchema.safeParse({ full_name: 'Awa Diop', email: 'awa@exemple.sn', password: 'court1' }).success).toBe(false)
    expect(registerSchema.safeParse({ full_name: 'Awa Diop', email: 'awa@exemple.sn', password: 'sansaucunchiffre' }).success).toBe(false)
  })

  it('marché : titre ≥ 10 caractères, trimestre 1-4', () => {
    const base = { title: 'Fourniture de matériel', nature_marche: 'FOURNITURES', montant_estime: 1000, corps_metier_id: uuid, ppm_annee: 2026, ppm_trimestre: 2 }
    expect(tenderSchema.safeParse(base).success).toBe(true)
    expect(tenderSchema.safeParse({ ...base, title: 'Court' }).success).toBe(false)
    expect(tenderSchema.safeParse({ ...base, ppm_trimestre: 5 }).success).toBe(false)
  })
})

describe('sectionsSchema : sections de modèle sectoriel', () => {
  const guide = { objectif: 'Objectif', points: ['Point'], exemple: 'Exemple', erreurs: ['Erreur'] }
  it('accepte consigne et guide propres au métier', () => {
    expect(sectionsSchema.safeParse([{ id: 'consistance', titre: '3. Consistance', contenu: '', obligatoire: true, consigne: 'Décrire', guide }]).success).toBe(true)
  })
  it('refuse un guide incomplet ou démesuré', () => {
    expect(sectionsSchema.safeParse([{ id: 'a', titre: 'T', contenu: '', guide: { objectif: 'x' } }]).success).toBe(false)
    expect(sectionsSchema.safeParse([{ id: 'a', titre: 'T', contenu: '', guide: { ...guide, points: Array.from({ length: 31 }, () => 'p') } }]).success).toBe(false)
  })
})

describe('appealSchema : périmètre du recours', () => {
  const base = { tender_id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', motif: 'Notation contestée par le candidat' }
  it('sans lot, ou « ALL », ou vide : marché entier', () => {
    for (const lot of [undefined, '', 'ALL']) expect(appealSchema.parse({ ...base, lot_id: lot }).lot_id).toBeUndefined()
  })
  it('un lot précis est conservé ; une valeur quelconque est refusée', () => {
    const lot = '4f2504e0-4f89-41d3-9a0c-0305e82c3302'
    expect(appealSchema.parse({ ...base, lot_id: lot }).lot_id).toBe(lot)
    expect(appealSchema.safeParse({ ...base, lot_id: 'lot 2' }).success).toBe(false)
  })
})
