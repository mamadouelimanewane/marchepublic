import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { contentHash, renderPdf, sanitize, type PdfModel } from './pdf'
import { contratModel, decisionAttributionModel, documentModel, pvOuvertureModel, pvReceptionModel, rapportEvaluationModel } from './pdf-models'

const tender = { reference: 'MP-MEFP-2026-0001', title: "Fourniture de matériel informatique à l'État", institution: "Ministère de l'Économie", nature_marche: 'FOURNITURES', mode_passation: 'AOO', montant_estime: 80_000_000, montant_attribue: 50_000_000 }
const pageCount = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getPageCount()

describe('génération de PDF', () => {
  it('produit un PDF valide avec accents, guillemets typographiques et caractères hors WinAnsi', async () => {
    const model: PdfModel = { title: 'Éléments à vérifier', reference: 'T-1', blocks: [{ t: 'p', text: 'L’autorité « contractante » ≤ 30 % → Σ pondérations ≥ 100 ✓ œuvre €' }, { t: 'p', text: '日本語 ne plante pas' }] }
    const bytes = await renderPdf(model)
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
    expect(await pageCount(bytes)).toBe(1)
  })

  it('pagine un long document et coupe les mots plus longs qu’une ligne', async () => {
    const long = 'x'.repeat(400)
    const blocks: PdfModel['blocks'] = Array.from({ length: 120 }, (_, i) => ({ t: 'p' as const, text: `Paragraphe ${i} ${long}` }))
    expect(await pageCount(await renderPdf({ title: 'Long', reference: 'T-2', blocks }))).toBeGreaterThan(3)
  })

  it('pagine un grand tableau sans perdre de lignes ni déborder', async () => {
    const rows = Array.from({ length: 200 }, (_, i) => [`Candidat ${i}`, '123456', '1', '01/01/2026', '10 000 FCFA', 'CONFORME'])
    const bytes = await renderPdf({ title: 'Tableau', reference: 'T-3', blocks: [{ t: 'table', head: ['A', 'B', 'C', 'D', 'E', 'F'], rows }] })
    expect(await pageCount(bytes)).toBeGreaterThan(4)
  })

  it('l’empreinte dépend du contenu', () => {
    const a: PdfModel = { title: 'x', reference: 'r', blocks: [{ t: 'p', text: 'un' }] }
    expect(contentHash(a)).toBe(contentHash({ ...a }))
    expect(contentHash(a)).not.toBe(contentHash({ ...a, blocks: [{ t: 'p', text: 'deux' }] }))
    expect(sanitize('a → b')).toBe('a -> b')
  })

  it('tous les modèles officiels se rendent', async () => {
    const models = [
      documentModel(tender, { titre: 'DAO fournitures', type: 'DAO', circuit_statut: 'PUBLIE', sections: [{ titre: 'Avis', contenu: 'Objet…' }] }, [{ version: 3, circuit_statut: 'PUBLIE', content_hash: 'a'.repeat(64), created_at: '2026-01-01T10:00:00Z' }]),
      pvOuvertureModel({ ...tender, date_limite_depot: '2026-02-01T12:00:00Z' }, { opened_at: '2026-02-01T13:00:00Z', nb_plis: 2, key_fingerprint: 'b'.repeat(64), observations: null }, [{ nom: 'A. Diop', fonction: 'PRESIDENT' }], [{ candidat: 'SENTECH', ninea: '123', lot: null, recu: '2026-01-30T10:00:00Z', montant: 50_000_000, statut: 'CONFORME', motif: null }]),
      rapportEvaluationModel({ ...tender, evaluation_round: 1 }, [{ critere: 'Expérience', ponderation: 100 }], [{ lot: null, rang: 1, candidat: 'SENTECH', technique: 85, financier: 100, global: 89.5, montant: 50_000_000, qualifie: true }], 70),
      decisionAttributionModel({ ...tender, date_fin_recours: '2026-03-01T00:00:00Z', date_attribution_provisoire: '2026-02-20T00:00:00Z' }, [{ lot: 'Lot 1', candidat: 'SENTECH', montant: 50_000_000 }], ['Lot 3']),
      pvReceptionModel(tender, { montant_actuel: 55_000_000, montant_initial: 50_000_000, lot: null }, 'SENTECH', { type: 'PROVISOIRE', date_reception: '2026-06-01', statut: 'ACCEPTEE_AVEC_RESERVES', reserves: 'Finitions' }, [{ nom: 'M. Fall' }]),
      contratModel(tender, { montant_initial: 50_000_000, date_debut_execution: '2026-04-01', delai_execution: 90, signed_by_ac: true, signed_by_titulaire: false, visa_controleur: false, lot: null }, { nom: 'SENTECH', ninea: '123' }, [{ titre: 'Avenants', contenu: 'Le cumul ne peut excéder 30 %.' }], [{ type: 'BONNE_EXECUTION', montant: 2_500_000, emetteur: 'Banque X', reference: 'G1', date_expiration: '2027-01-01' }]),
    ]
    for (const m of models) expect(await pageCount(await renderPdf(m))).toBeGreaterThanOrEqual(1)
  })
})
