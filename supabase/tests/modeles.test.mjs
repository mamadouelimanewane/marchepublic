// Modèles de TDR sectoriels : fiches, migration générée, et invariants en base (un modèle par corps de métier, sections communes,
// grilles d'évaluation, aucun modèle validable tel quel).
import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { createDb } from './harness.mjs'
import { ALL, METIERS } from '../modeles-tdr/index.mjs'
import { render } from '../modeles-tdr/build.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const COMMUNS = ['contexte', 'objectifs', 'consistance', 'livrables', 'profil', 'duree', 'suivi']
const VARIABLES = ['reference', 'intitule', 'autorite', 'nature', 'mode', 'montant_estime', 'ligne_budgetaire', 'annee', 'besoin', 'justification']
let db
const q = (sql, params) => db.query(sql, params).then(r => r.rows)

before(async () => { db = await createDb() })

test('fiches : codes uniques, champs complets, grilles qui totalisent 100', () => {
  const codes = ALL.map(s => s.code + (s.generic ? '/gen' : ''))
  assert.equal(new Set(codes).size, codes.length, 'codes en double')
  assert.ok(METIERS.length >= 40, `trop peu de métiers : ${METIERS.length}`)
  for (const s of ALL) {
    const where = `${s.code}`
    for (const k of ['libelle', 'description', 'contexte']) assert.ok(typeof s[k] === 'string' && s[k].length > 8, `${where}.${k}`)
    for (const k of ['objectifs', 'prestations', 'livrables', 'profil', 'vigilance', 'reception', 'questions']) assert.ok(Array.isArray(s[k]) && s[k].length >= 3, `${where}.${k} (≥ 3 éléments)`)
    assert.ok(s.questions.length >= 4, `${where} : au moins 4 questions de cadrage`)
    assert.ok(s.references.length >= (s.generic ? 1 : 2), `${where} : références insuffisantes`)
    assert.ok(['SERVICES', 'TRAVAUX', 'FOURNITURES'].includes(s.famille), `${where}.famille`)
    if (!s.generic) {
      const total = s.criteres.reduce((n, [, p]) => n + p, 0)
      assert.equal(total, 100, `${where} : grille = ${total}`)
      assert.ok(s.criteres.length >= 3, `${where} : au moins 3 critères`)
    }
    // Aucune valeur n'est présentée comme « normative » sans réserve : toute référence est à confirmer ou générique.
    for (const r of s.references) assert.ok(r.length > 12, `${where} : référence trop courte`)
  }
})

test('la migration committée est à jour par rapport aux fiches', () => {
  const current = readFileSync(join(here, '..', 'migrations', '0021_modeles_tdr_sectoriels.sql'), 'utf8').replace(/\r\n/g, '\n')
  assert.equal(current, render(ALL), 'relancer : node supabase/modeles-tdr/generate.mjs')
})

test('en base : un modèle de TDR et une grille par corps de métier, plus les modèles génériques', async () => {
  const sans = await q(`select cm.code from corps_metiers cm where cm.is_active and not exists (select 1 from document_templates t where t.type='TDR' and t.corps_metier_id = cm.id)`)
  assert.deepEqual(sans, [], 'corps de métier sans modèle de TDR')
  const sansGrille = await q(`select cm.code from corps_metiers cm where cm.is_active and not exists (select 1 from evaluation_templates e where e.corps_metier_id = cm.id)`)
  assert.deepEqual(sansGrille, [], 'corps de métier sans grille d\'évaluation')
  assert.ok((await q(`select count(*)::int n from corps_metiers`))[0].n >= 40)
  assert.equal((await q(`select count(*)::int n from document_templates where code like 'TDR-GEN-%'`))[0].n, 4)
  assert.equal((await q(`select count(*)::int n from document_templates where meta->>'famille' is not null`))[0].n, ALL.length)
})

test('chaque modèle : sections communes, ordre, identifiants uniques, consignes, guides, variables connues', async () => {
  for (const t of await q(`select code, sections, meta from document_templates where meta->>'famille' is not null`)) {
    const ids = t.sections.map(s => s.id)
    assert.equal(new Set(ids).size, ids.length, `${t.code} : identifiants en double`)
    for (const id of COMMUNS) assert.ok(ids.includes(id), `${t.code} : section « ${id} » absente`)
    assert.deepEqual(ids.filter(i => COMMUNS.includes(i)), COMMUNS, `${t.code} : ordre des sections communes`)
    for (const s of t.sections) {
      assert.ok(s.titre && s.consigne && s.consigne.length > 10, `${t.code}/${s.id} : titre ou consigne`)
      assert.ok(s.guide && Array.isArray(s.guide.points) && s.guide.points.length > 0 && s.guide.exemple && s.guide.erreurs.length > 0, `${t.code}/${s.id} : guide incomplet`)
      for (const m of (s.contenu + s.guide.exemple).matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)) assert.ok(VARIABLES.includes(m[1]), `${t.code}/${s.id} : variable inconnue ${m[1]}`)
    }
    assert.ok(t.meta.questions.length >= 4 && t.meta.references.length >= 1, `${t.code} : métadonnées`)
  }
})

test('aucun modèle ne peut être validé tel quel : des [●] subsistent dans les sections obligatoires', async () => {
  for (const t of await q(`select code, sections from document_templates where meta->>'famille' is not null`)) {
    const obligatoires = t.sections.filter(s => s.obligatoire)
    const vides = obligatoires.filter(s => !/\[●\]|\{\{/.test(s.contenu))
    assert.deepEqual(vides.map(s => s.id), [], `${t.code} : sections obligatoires sans valeur à compléter`)
    // et les sections obligatoires font plus de 40 caractères : un [●] seul ne suffit pas à tromper la règle de longueur
    for (const s of obligatoires) assert.ok(s.contenu.trim().length >= 40, `${t.code}/${s.id} : amorce trop courte`)
  }
})

test('conséquence en base : la validation PRM d\'un TDR issu d\'un modèle non complété est refusée', async () => {
  const [t] = await q(`select id, sections from document_templates where code='TDR-BTP'`)
  const [{ id: inst }] = await q(`insert into institutions (code, name, type) values ('MDL','Institution modèles','ETAT') returning id`)
  const [{ id: tender }] = await q(`insert into tenders (institution_id, title, nature_marche, montant_estime, ligne_budgetaire, ppm_annee, mode_passation, current_phase)
    values ($1,'Construction de salles de classe pour essai','TRAVAUX',90000000,'1.2.3',2026,'AOO','PHASE_2_REDACTION') returning id`, [inst])
  const [{ i }] = await q(`select unnest(document_blocking_issues($1, 'TDR', $2::jsonb)) as i limit 1`, [tender, JSON.stringify({ sections: t.sections })])
  assert.match(i, /PLACEHOLDER/)
})
