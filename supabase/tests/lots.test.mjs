// Marché alloti : dépôt par lot, classement par lot, attribution lot par lot, contrats par lot.
import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createDb, asUser } from './harness.mjs'

let db, INST, T, L1, L2
const U = {}
const q = (sql, params) => db.query(sql, params).then(r => r.rows)
const rpc = (key, sql, params) => asUser(db, U[key], () => q(sql, params))
const hex = c => c.repeat(64)
const adv = (key, event, payload = {}) => rpc(key, 'select advance_phase($1,$2,$3::jsonb) as p', [T, event, JSON.stringify(payload)]).then(r => r[0].p)
const grille = n => JSON.stringify([{ critere: 'Technique', ponderation: 60, note: n * 0.6 }, { critere: 'Moyens', ponderation: 40, note: n * 0.4 }])

async function mkUser(key, role, institution, pme = false) {
  const id = randomUUID()
  await q('insert into auth.users (id, email) values ($1, $2)', [id, `${key}@lots.sn`])
  await q('update users set role=$2, institution_id=$3, full_name=$4, is_pme=$5 where id=$1', [id, role, institution, key, pme])
  U[key] = id
}

before(async () => {
  db = await createDb()
  INST = (await q(`insert into institutions (code, name, type) values ('LOTS', 'Institution lots', 'ETAT') returning id`))[0].id
  for (const [k, r] of [['prm', 'PRM'], ['cpm', 'CPM'], ['tresor', 'TRESOR'], ['ev1', 'EVALUATEUR'], ['ev2', 'EVALUATEUR']]) await mkUser(k, r, INST)
  await mkUser('dcmp', 'DCMP', null)
  await mkUser('arcop', 'ARCOP', null)
  await mkUser('b1', 'SOUMISSIONNAIRE', null, true)
  await mkUser('b2', 'SOUMISSIONNAIRE', null)
})

test('dépôt : le lot est obligatoire sur un marché alloti et interdit sinon', async () => {
  const t = (await q(`insert into tenders (institution_id, title, nature_marche, montant_estime, ligne_budgetaire, ppm_annee, mode_passation, current_phase, is_alloti, date_limite_depot, date_publication, bid_public_key)
                      values ($1,'Marché alloti de test','FOURNITURES',120000000,'1',2026,'AOO','PHASE_6_DEPOT_OFFRES', true, now() + interval '5 days', now() - interval '30 days', 'k') returning id`, [INST]))[0].id
  const lot = (await q(`insert into tender_lots (tender_id, institution_id, numero_lot, libelle, montant_estime) values ($1,$2,1,'Lot 1',60000000) returning id`, [t, INST]))[0].id
  const call = l => rpc('b2', 'select submit_bid($1,$2,$3,$4,$5,$6) as r', [t, `${t}/${U.b2}/t.json`, hex('a'), `${t}/${U.b2}/f.json`, hex('b'), l]).then(r => r[0].r)
  await assert.rejects(call(null), /LOT_REQUIRED/)
  await assert.rejects(call(randomUUID()), /LOT_REQUIRED/)
  assert.equal((await call(lot)).ok, true)
  const plain = (await q(`insert into tenders (institution_id, title, nature_marche, montant_estime, ligne_budgetaire, ppm_annee, mode_passation, current_phase, date_limite_depot, bid_public_key)
                          values ($1,'Marché non alloti de test','FOURNITURES',1000000,'1',2026,'DRP','PHASE_6_DEPOT_OFFRES', now() + interval '5 days', 'k') returning id`, [INST]))[0].id
  await assert.rejects(rpc('b2', 'select submit_bid($1,$2,$3,$4,$5,$6)', [plain, `${plain}/${U.b2}/t`, hex('a'), `${plain}/${U.b2}/f`, hex('b'), lot]), /LOT_INVALID/)
})

test('classement par lot ; lot sans offre qualifiée infructueux ; attribution lot par lot', async () => {
  T = (await q(`insert into tenders (institution_id, title, nature_marche, montant_estime, ligne_budgetaire, ppm_annee, mode_passation, current_phase, is_alloti, date_limite_depot)
                values ($1,'Marché alloti trois lots','FOURNITURES',180000000,'1',2026,'AOO','PHASE_8_EVALUATION', true, now() - interval '3 days') returning id`, [INST]))[0].id
  const lots = await q(`insert into tender_lots (tender_id, institution_id, numero_lot, libelle, montant_estime) values ($1,$2,1,'Lot 1',60000000),($1,$2,2,'Lot 2',60000000),($1,$2,3,'Lot 3',60000000) returning id, numero_lot`, [T, INST])
  L1 = lots.find(l => l.numero_lot === 1).id; L2 = lots.find(l => l.numero_lot === 2).id
  const L3 = lots.find(l => l.numero_lot === 3).id
  await q('alter table commission_members disable trigger trig_commission_guard')
  await q(`insert into commission_members (tender_id, institution_id, user_id, role_commission) values ($1,$2,$3,'PRESIDENT'),($1,$2,$4,'MEMBRE')`, [T, INST, U.ev1, U.ev2])
  await q('alter table commission_members enable trigger trig_commission_guard')
  const mk = (u, lot, montant) => q(`insert into bids (tender_id, institution_id, soumissionnaire_id, lot_id, status, montant_offre, submitted_at) values ($1,$2,$3,$4,'CONFORME',$5, now()) returning id`, [T, INST, u, lot, montant]).then(r => r[0].id)
  const b1l1 = await mk(U.b1, L1, 50000000), b2l1 = await mk(U.b2, L1, 60000000), b1l2 = await mk(U.b1, L2, 40000000), b2l3 = await mk(U.b2, L3, 30000000)
  const notes = { [b1l1]: 80, [b2l1]: 90, [b1l2]: 85, [b2l3]: 50 }      // lot 3 : sous le seuil technique (70)
  for (const [bid, n] of Object.entries(notes)) {
    for (const e of ['ev1', 'ev2']) {
      await rpc(e, `insert into bid_evaluations (tender_id, institution_id, bid_id, evaluateur_id, grille_technique) values ($1,$2,$3,$4,$5::jsonb)`, [T, INST, bid, U[e], grille(n)])
    }
  }

  assert.equal(await adv('prm', 'FINALISER_EVALUATION'), 'PHASE_9_ATTRIBUTION_PROVISOIRE')
  const rk = await q('select lot_id, bid_id, rang, qualifie, score_global from bid_rankings where tender_id=$1', [T])
  const r = id => rk.find(x => x.bid_id === id)
  // lot 1 : b1 = 0,7×80 + 0,3×100 = 86 ; b2 = 0,7×90 + 0,3×(50/60×100) = 88 → b2 est premier
  assert.equal(r(b2l1).rang, 1); assert.equal(r(b1l1).rang, 2)
  assert.equal(r(b1l2).rang, 1)                                          // seul candidat du lot 2, classé indépendamment
  assert.equal(r(b2l3).qualifie, false)
  assert.equal((await q('select statut from tender_lots where id=$1', [L3]))[0].statut, 'INFRUCTUEUX')

  await assert.rejects(adv('prm', 'PRONONCER_ATTRIBUTION_PROVISOIRE', { awards: [{ lot_id: L1, bid_id: b1l1 }] }), /JUSTIFICATION_REQUIRED/)
  assert.equal(await adv('prm', 'PRONONCER_ATTRIBUTION_PROVISOIRE', { awards: [] }), 'PHASE_10_RECOURS')
  const after = await q('select numero_lot, statut, montant_attribue, attributaire_id from tender_lots where tender_id=$1 order by numero_lot', [T])
  assert.deepEqual(after.map(l => l.statut), ['ATTRIBUE', 'ATTRIBUE', 'INFRUCTUEUX'])
  assert.equal(after[0].attributaire_id, U.b2); assert.equal(after[1].attributaire_id, U.b1)
  assert.equal(Number((await q('select montant_attribue from tenders where id=$1', [T]))[0].montant_attribue), 60000000 + 40000000)

  // b1 gagne le lot 2 mais a perdu le lot 1 : il peut contester le lot 1. b2 perdant du lot 2 (pas candidat) gagne le lot 1.
  const appeal = (await rpc('b1', 'select submit_appeal($1,$2) as id', [T, 'Notation du lot 1 contestée'])).at(0).id
  assert.equal((await q('select has_appeal_pending from tenders where id=$1', [T]))[0].has_appeal_pending, true)
  await rpc('arcop', 'select decide_appeal($1,$2,$3)', [appeal, 'REJETE', 'Les critères ont été appliqués conformément au DAO.'])
})

test('un contrat par lot attribué ; phase 13 exige tous les contrats signés, visés et garantis ; quotas par lot', async () => {
  await q(`update tenders set date_fin_recours = now() - interval '1 day' where id=$1`, [T])
  assert.equal(await adv('prm', 'CLORE_PERIODE_RECOURS'), 'PHASE_11_ATTRIBUTION_DEFINITIVE')
  assert.equal((await q('select count(*)::int n from pme_quota_entries where tender_id=$1', [T]))[0].n, 2)
  await rpc('dcmp', 'select record_review($1,$2,$3)', [T, 'APPROBATION_ATTRIBUTION', 'FAVORABLE'])
  assert.equal(await adv('prm', 'CONFIRMER_ATTRIBUTION_DEFINITIVE'), 'PHASE_12_SIGNATURE_CONTRAT')

  await assert.rejects(rpc('prm', 'select prepare_contract($1)', [T]), /LOT_REQUIRED/)
  const c1 = (await rpc('prm', 'select prepare_contract($1,null,null,$2) as id', [T, L1]))[0].id
  await assert.rejects(rpc('prm', 'select prepare_contract($1,null,null,$2)', [T, L1]), /CONTRACT_EXISTS/)
  const holder = async c => { const id = (await q('select attributaire_id from contracts where id=$1', [c]))[0].attributaire_id; return Object.keys(U).find(k => U[k] === id) }
  const sign = async c => { await rpc(await holder(c), 'select sign_contract($1)', [c]); await rpc('prm', 'select sign_contract($1)', [c]); await rpc('tresor', 'select visa_contract($1)', [c]) }
  const guar = c => rpc('prm', `insert into guarantees (tender_id, institution_id, contract_id, type, montant, emetteur, reference, date_emission, date_expiration) values ($1,$2,$3,'BONNE_EXECUTION',1000000,'Banque','G-'||gen_random_uuid()::text, current_date, current_date+365)`, [T, INST, c])
  await sign(c1); await guar(c1)
  await assert.rejects(adv('prm', 'SIGNER_CONTRAT'), /GUARD_PHASE_12/)             // le contrat du lot 2 manque
  const c2 = (await rpc('prm', 'select prepare_contract($1,null,null,$2) as id', [T, L2]))[0].id
  await sign(c2)
  await assert.rejects(adv('prm', 'SIGNER_CONTRAT'), /garantie de bonne exécution/)  // garantie du lot 2 manquante
  await guar(c2)
  assert.equal(await adv('prm', 'SIGNER_CONTRAT'), 'PHASE_13_EXECUTION')
  // le plafond d'avenants se mesure contrat par contrat
  await assert.rejects(rpc('prm', `insert into contract_amendments (contract_id, tender_id, institution_id, numero_avenant, motif, montant_avenant) values ($1,$2,$3,1,'Hors plafond du lot',$4)`, [c1, T, INST, 99999999]), /AVENANT_LIMIT_EXCEEDED/)
})
