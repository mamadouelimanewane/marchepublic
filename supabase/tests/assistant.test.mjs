// Assistant IA : droits, verrouillage, quota quotidien appliqué en base, journal sans contenu.
import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createDb, asUser } from './harness.mjs'

let db, INST, DOC_TDR, DOC_LOCKED
const U = {}
const q = (sql, params) => db.query(sql, params).then(r => r.rows)
const as = (key, sql, params) => asUser(db, U[key], () => q(sql, params))
const rejects = (p, re) => assert.rejects(p, e => re.test(e.message), `attendu : ${re}`)

async function mkUser(key, role, inst) {
  const id = randomUUID()
  await q('insert into auth.users (id, email) values ($1, $2)', [id, `${key}@ia.sn`])
  await q('update users set role=$2, institution_id=$3, full_name=$4 where id=$1', [id, role, inst, key] )
  U[key] = id
}

before(async () => {
  db = await createDb()
  INST = (await q(`insert into institutions (code, name, type) values ('IAA', 'Autorité IA', 'ETAT') returning id`))[0].id
  const INST2 = (await q(`insert into institutions (code, name, type) values ('IAB', 'Autre autorité', 'ETAT') returning id`))[0].id
  await mkUser('cpm', 'CPM', INST); await mkUser('autre', 'CPM', INST2); await mkUser('dcmp', 'DCMP', null); await mkUser('bidder', 'SOUMISSIONNAIRE', null)
  const t = (await q(`insert into tenders (institution_id, title, nature_marche, montant_estime, ligne_budgetaire, ppm_annee, mode_passation, current_phase)
    values ($1,'Marché pour essai assistant','FOURNITURES',5000000,'1.2.3',2026,'DRP','PHASE_2_REDACTION') returning id`, [INST]))[0].id
  DOC_TDR = (await q(`insert into tender_documents (tender_id, institution_id, type, titre) values ($1,$2,'TDR','TDR essai') returning id`, [t, INST]))[0].id
  DOC_LOCKED = (await q(`insert into tender_documents (tender_id, institution_id, type, titre, is_locked, circuit_statut) values ($1,$2,'TDR','TDR verrouillé', true, 'TRANSMIS_DCMP') returning id`, [t, INST]))[0].id
})

test('droits : rôle, institution, verrouillage', async () => {
  const claim = (who, doc) => as(who, `select claim_ai_request($1, 'REDIGER_SECTION', 'modele-test', 1200) as id`, [doc])
  await rejects(claim('bidder', DOC_TDR), /FORBIDDEN/)
  await rejects(claim('dcmp', DOC_TDR), /FORBIDDEN/)
  await rejects(claim('autre', DOC_TDR), /FORBIDDEN/)            // autre institution
  await rejects(claim('cpm', DOC_LOCKED), /INVALID_STATE/)       // document transmis
  const [r] = await claim('cpm', DOC_TDR)
  assert.ok(r.id)
})

test('journal : volumes et statut, jamais le contenu des échanges', async () => {
  const [row] = await q(`select * from ai_requests order by created_at desc limit 1`)
  assert.equal(row.statut, 'EN_COURS'); assert.equal(row.input_chars, 1200)
  assert.deepEqual(Object.keys(row).filter(k => /prompt|content|texte|reponse/i.test(k)), [])
  await as('cpm', `select finish_ai_request($1, true, 800)`, [row.id])
  assert.equal((await q(`select statut, output_chars from ai_requests where id=$1`, [row.id]))[0].statut, 'OK')
  await as('cpm', `select finish_ai_request($1, false, null)`, [row.id])                       // déjà clôturée : sans effet
  assert.equal((await q(`select statut from ai_requests where id=$1`, [row.id]))[0].statut, 'OK')
  await as('autre', `select finish_ai_request($1, false, null)`, [row.id])                     // requête d'autrui : sans effet
  assert.equal((await q(`select statut from ai_requests where id=$1`, [row.id]))[0].statut, 'OK')
  assert.equal((await q(`select count(*)::int n from audit_logs where entity_type='ai_requests'`))[0].n >= 1, true)
})

test('quota quotidien appliqué en base ; les erreurs techniques ne le consomment pas', async () => {
  await q(`update config_seuils set valeur='3' where cle='AI_QUOTA_JOUR'`)
  const claim = () => as('cpm', `select claim_ai_request($1, 'RELIRE_DOCUMENT', 'modele-test', 500) as id`, [DOC_TDR])
  assert.equal((await as('cpm', `select ai_quota_remaining() as n`))[0].n, 2)                  // 1 requête déjà OK
  const a = (await claim())[0].id
  await claim()
  assert.equal((await as('cpm', `select ai_quota_remaining() as n`))[0].n, 0)
  await rejects(claim(), /QUOTA_EXCEEDED/)
  await as('cpm', `select finish_ai_request($1, false, null)`, [a])                            // échec du fournisseur : quota restitué
  assert.equal((await as('cpm', `select ai_quota_remaining() as n`))[0].n, 1)
  await claim()
  await rejects(claim(), /QUOTA_EXCEEDED/)
  // le quota est individuel
  assert.equal((await as('autre', `select ai_quota_remaining() as n`))[0].n, 3)
})

test('lecture : chacun ne voit que ses requêtes', async () => {
  assert.ok((await as('cpm', `select * from ai_requests`)).length >= 3)
  assert.equal((await as('autre', `select * from ai_requests`)).length, 0)
  assert.equal((await as('bidder', `select * from ai_requests`)).length, 0)
  await rejects(as('cpm', `update ai_requests set statut='OK'`), /permission|denied/i)
})

test('journal : le type « TDR complet » est accepté, tout autre type est refusé', async () => {
  await q(`update config_seuils set valeur='30' where cle='AI_QUOTA_JOUR'`)
  const [{ id }] = await as('cpm', `select claim_ai_request($1, 'REDIGER_TDR_COMPLET', 'modele-test', 4000) as id`, [DOC_TDR])
  assert.equal((await q(`select kind from ai_requests where id=$1`, [id]))[0].kind, 'REDIGER_TDR_COMPLET')
  await rejects(as('cpm', `select claim_ai_request($1, 'AUTRE_TYPE', 'modele-test', 10)`, [DOC_TDR]), /check|kind/i)
})
