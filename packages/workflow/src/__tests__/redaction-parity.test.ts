// Parité TypeScript ↔ SQL : le linter de l'éditeur et `document_blocking_issues` (qui refuse la validation PRM) doivent
// s'accorder, document par document, sur ce qui est bloquant.
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { BLOCKING_CODES, lintDocument, type ClauseRef, type DocSection } from '../domain/redaction'

const harness = pathToFileURL(join(__dirname, '../../../../supabase/tests/harness.mjs')).href
let db: any
let tender: string
let clauses: ClauseRef[]

const long = 'Description détaillée, chiffrée et vérifiable des prestations attendues du titulaire.'
const sec = (id: string, contenu: string, o = false): DocSection => ({ id, titre: id, contenu, obligatoire: o })

beforeAll(async () => {
  const { createDb } = await import(/* @vite-ignore */ harness)
  db = await createDb()
  const inst = (await db.query(`insert into institutions (code, name, type) values ('PAR', 'Parité', 'ETAT') returning id`)).rows[0].id
  tender = (await db.query(`insert into tenders (institution_id, title, nature_marche, montant_estime, ligne_budgetaire, ppm_annee, mode_passation, current_phase)
    values ($1,'Marché de parité pour essai','FOURNITURES',1000000,'1.2.3',2026,'DRP','PHASE_2_REDACTION') returning id`, [inst])).rows[0].id
  clauses = (await db.query(`select code, titre, obligatoire, natures::text[] as natures from clause_templates where is_active`)).rows
}, 120_000)

async function sqlCodes(type: 'TDR' | 'DAO', sections: DocSection[]): Promise<string[]> {
  const r = await db.query(`select unnest(document_blocking_issues($1, $2, $3::jsonb)) as i`, [tender, type, JSON.stringify({ sections })])
  return r.rows.map((x: { i: string }) => x.i.split(':')[0])
}
const tsCodes = (type: 'TDR' | 'DAO', sections: DocSection[]) =>
  lintDocument(sections, { type, nature: 'FOURNITURES', clauses }).filter(i => BLOCKING_CODES.includes(i.code)).map(i => i.code)

const allClauses = (): DocSection[] => clauses.filter(c => c.obligatoire && (!c.natures?.length || c.natures.includes('FOURNITURES'))).map(c => sec(`clause-${c.code}`, long, true))

describe('parité des règles bloquantes', () => {
  const corpus: [string, 'TDR' | 'DAO', () => DocSection[]][] = [
    ['TDR complet', 'TDR', () => [sec('contexte', long, true), sec('objectifs', long, true)]],
    ['TDR vide', 'TDR', () => []],
    ['TDR à blanc', 'TDR', () => [sec('contexte', '   ', true)]],
    ['TDR avec [●]', 'TDR', () => [sec('contexte', `${long} délai de [●] jours`, true)]],
    ['TDR avec {{variable}}', 'TDR', () => [sec('contexte', `${long} {{besoin}}`, true)]],
    ['TDR avec [À COMPLÉTER]', 'TDR', () => [sec('contexte', `${long} [À COMPLÉTER]`, true)]],
    ['TDR section obligatoire courte', 'TDR', () => [sec('contexte', long, true), sec('objectifs', 'trop court', true)]],
    ['TDR section facultative courte', 'TDR', () => [sec('contexte', long, true), sec('budget', 'court', false)]],
    ['TDR 39 caractères', 'TDR', () => [sec('contexte', 'x'.repeat(39), true)]],
    ['TDR 40 caractères', 'TDR', () => [sec('contexte', 'x'.repeat(40), true)]],
    ['DAO sans clause', 'DAO', () => [sec('avis', long, true)]],
    ['DAO avec clauses obligatoires', 'DAO', () => [sec('avis', long, true), ...allClauses()]],
    ['DAO avec clauses mais [●] (paiement)', 'DAO', () => [sec('avis', long, true), ...allClauses().map((s, i) => (i === 0 ? { ...s, contenu: `${long} [●]` } : s))]],
    ['DAO une clause manquante', 'DAO', () => [sec('avis', long, true), ...allClauses().slice(1)]],
    ['DAO clause facultative seule', 'DAO', () => [sec('avis', long, true), sec('clause-INEXISTANTE', long)]],
  ]
  for (const [name, type, build] of corpus) {
    it(name, async () => {
      const sections = build()
      expect([...new Set(await sqlCodes(type, sections))].sort()).toEqual([...new Set(tsCodes(type, sections))].sort())
    })
  }
  it('le corpus couvre les quatre codes bloquants', async () => {
    const seen = new Set<string>()
    for (const [, type, build] of corpus) (await sqlCodes(type, build())).forEach(c => seen.add(c))
    expect([...seen].sort()).toEqual([...BLOCKING_CODES].sort())
  })
})
