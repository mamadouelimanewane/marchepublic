import { describe, expect, it } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { DOMParser } from '@xmldom/xmldom'
import { PDFDocument } from 'pdf-lib'
import { buildXlsx, columnName, sheetName, xmlEscape } from './xlsx'
import { renderPdf } from './pdf'
import { ppmModel, type PpmRow } from './pdf-models'

const parts = (bytes: Uint8Array) => Object.fromEntries(Object.entries(unzipSync(bytes)).map(([k, v]) => [k, strFromU8(v)]))
const parse = (xml: string) => {
  const errors: string[] = []
  const doc = new DOMParser({ onError: (_l, m) => errors.push(m) }).parseFromString(xml, 'text/xml')
  return { doc, errors }
}

describe('classeur Excel', () => {
  const header = ['Référence', 'Objet', 'Montant (FCFA)']
  const rows = [['MP-MEFP-2026-0001', 'Fourniture <lot 1> & "accessoires"', 65000000], ['MP-MEFP-2026-0002', '=HYPERLINK("http://exemple")', null], ['MP-3', "L'entrée\u0001cachée", 12]]
  const files = parts(buildXlsx({ sheet: 'PPM 2026', header, rows, moneyColumns: [2] }))

  it('contient les six parties d\'un classeur valide', () => {
    expect(Object.keys(files).sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml'])
  })
  it('chaque partie est un XML bien formé', () => {
    for (const [name, xml] of Object.entries(files)) {
      const { errors } = parse(xml)
      expect(errors, name).toEqual([])
      expect(xml.startsWith('<?xml version="1.0"')).toBe(true)
    }
  })
  it('l\'en-tête est en ligne 1, figé et filtré ; les montants sont numériques', () => {
    const { doc } = parse(files['xl/worksheets/sheet1.xml'])
    const cells = Array.from(doc.getElementsByTagName('c'))
    const ref = (r: string) => cells.find(c => c.getAttribute('r') === r)!
    expect(ref('A1').getElementsByTagName('t')[0].textContent).toBe('Référence')
    expect(ref('C2').getAttribute('t')).toBeNull()                       // numérique
    expect(ref('C2').getElementsByTagName('v')[0].textContent).toBe('65000000')
    expect(ref('C2').getAttribute('s')).toBe('3')                         // format montant
    expect(doc.getElementsByTagName('pane')[0].getAttribute('state')).toBe('frozen')
    expect(doc.getElementsByTagName('autoFilter')[0].getAttribute('ref')).toBe('A1:C4')
  })
  it('échappe le XML, retire les caractères interdits et ne crée jamais de formule', () => {
    const xml = files['xl/worksheets/sheet1.xml']
    const { doc } = parse(xml)
    const texts = Array.from(doc.getElementsByTagName('t')).map(t => t.textContent)
    expect(texts).toContain('Fourniture <lot 1> & "accessoires"')
    expect(texts).toContain('=HYPERLINK("http://exemple")')               // reste du texte
    expect(texts).toContain('L\'entréecachée')
    expect(xml).not.toContain('<f>')
    expect(xml).not.toMatch(/\u0001/)
  })
  it('une cellule vide n\'est pas écrite', () => {
    const { doc } = parse(files['xl/worksheets/sheet1.xml'])
    expect(Array.from(doc.getElementsByTagName('c')).some(c => c.getAttribute('r') === 'C3')).toBe(false)
  })
  it('noms de colonnes et d\'onglet', () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnName)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA'])
    expect(sheetName('PPM [2026]: a/b?*')).not.toMatch(/[\[\]:*?/]/)
    expect(sheetName('x'.repeat(50)).length).toBe(31)
    expect(sheetName('   ')).toBe('Feuille1')
    expect(xmlEscape('<a href="x">&\'')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&apos;')
  })
  it('gère un grand nombre de lignes', () => {
    const big = Array.from({ length: 5000 }, (_, i) => [`R${i}`, `Objet ${i}`, i * 1000])
    const f = parts(buildXlsx({ sheet: 'Gros', header, rows: big }))
    expect(parse(f['xl/worksheets/sheet1.xml']).errors).toEqual([])
    expect(f['xl/worksheets/sheet1.xml']).toContain('r="C5001"')
  })
})

describe('PDF du plan de passation', () => {
  const r = (over: Partial<PpmRow>): PpmRow => ({ reference: 'MP-MEFP-2026-0001', title: 'Fourniture de matériel', nature_marche: 'FOURNITURES', mode_passation: 'AOO', montant_estime: 80_000_000, ppm_trimestre: 2, current_phase: 'PHASE_1_PROGRAMMATION', ...over })
  it('totalise par trimestre et signale les marchés non planifiés', () => {
    const m = ppmModel(2026, 'Ministère', [r({}), r({ reference: 'B', ppm_trimestre: 2, montant_estime: 20_000_000 }), r({ reference: 'C', ppm_trimestre: null, montant_estime: 5 })])
    expect(m.reference).toBe('PPM-2026')
    const t = m.blocks.find(b => b.t === 'table') as { rows: string[][] }
    expect(t.rows.find(x => x[0] === 'T2')![1]).toBe('2')
    expect(t.rows.find(x => x[0] === 'Non planifié')![1]).toBe('1')
    const kv = m.blocks.find(b => b.t === 'kv') as { rows: [string, string][] }
    expect(kv.rows.find(x => x[0] === 'Nombre de marchés')![1]).toBe('3')
  })
  it('affiche l\'autorité quand plusieurs sont concernées', () => {
    const m = ppmModel(2026, null, [r({ institution: 'A' }), r({ reference: 'B', institution: 'B' })])
    const tables = m.blocks.filter(b => b.t === 'table') as { head: string[] }[]
    expect(tables[1].head).toContain('Autorité')
  })
  it('produit un PDF valide, y compris sans aucun marché', async () => {
    const full = await renderPdf(ppmModel(2026, 'Ministère', Array.from({ length: 150 }, (_, i) => r({ reference: `MP-${i}`, ppm_trimestre: (i % 4) + 1 }))))
    expect((await PDFDocument.load(full)).getPageCount()).toBeGreaterThan(2)
    expect((await PDFDocument.load(await renderPdf(ppmModel(2026, null, [])))).getPageCount()).toBe(1)
  })
})
