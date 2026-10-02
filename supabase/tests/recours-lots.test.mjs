// Recours par lot : périmètre du recours, reprise limitée au lot contesté, total attribué recalculé, lot rouvert infructueux,
// décision favorable refusée pendant une réévaluation, recours sur le marché entier inchangé.
import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createDb, asUser, asAnon } from './harness.mjs'

let db, INST, T, L1, L2, L3
const U = {}, BID = {}
const q = (sql, params) => db.query(sql, params).then(r => r.rows)
const rpc = (key, sql, params) => asUser(db, U[key], () => q(sql, params))
const adv = (key, event, payload = {}) => rpc(key, 'select advance_phase($1,$2,$3::jsonb) as p', [T, event, JSON.stringify(payload)]).then(r => r[0].p)
const grille = n => JSON.stringify([{ critere: 'Technique', ponderation: 60, note: n * 0.6 }, { critere: 'Moyens', ponderation: 40, note: n * 0.4 }])
const rejects = (p, re) => assert.rejects(p, e => re.test(e.message), `attendu : ${re}`)
const appeal = (key, tender, lot, motif = 'Notation du lot contestée par le candidat') => rpc(key, 'select submit_appeal($1,$2,$3,$4,$5) as id', [tender, motif, null, null, lot]).then(r => r[0].id)
const decide = (id, d) => rpc('arcop', 'select decide_appeal($1,$2,$3)', [id, d, 'Décision motivée de l\'ARCOP après instruction du dossier.'])
const lots = tender => q(`select numero_lot, statut, attributaire_id, montant_attribue from tender_lots where tender_id=$1 order by numero_lot`, [tender])
const tenderRow = tender => q(`select current_phase, evaluation_round, montant_attribue, has_appeal_pending from tenders where id=$1`, [tender]).then(r => ({ ...r[0], montant_attribue: r[0].montant_attribue === null ? null : Number(r[0].montant_attribue) }))
const score = async (bid, n, evs = ['ev1', 'ev2']) => { for (const e of evs) await rpc(e, `insert into bid_evaluations (tender_id, institution_id, bid_id, evaluateur_id, grille_technique) values ($1,$2,$3,$4,$5::jsonb)`, [T, INST, bid, U[e], grille(n)]) }   // séquentiel : une seule connexion, les identités ne doivent pas se mêler

async function mkUser(key, role, institution) {
  const id = randomUUID()
  await q('insert into auth.users (id, email) values ($1, $2)', [id, `${key}@rl.sn`])
  await q('update users set role=$2, institution_id=$3, full_name=$4 where id=$1', [id, role, institution, key.toUpperCase() + ' SARL'])
  U[key] = id
}

before(async () => {
  db = await createDb()
  INST = (await q(`insert into institutions (code, name, type) values ('RLT', 'Institution recours par lot', 'ETAT') returning id`))[0].id
  for (const [k, r] of [['prm', 'PRM'], ['cpm', 'CPM'], ['ev1', 'EVALUATEUR'], ['ev2', 'EVALUATEUR']]) await mkUser(k, r, INST)
  await mkUser('dcmp', 'DCMP', null); await mkUser('arcop', 'ARCOP', null)
  for (const k of ['b1', 'b2', 'b3']) await mkUser(k, 'SOUMISSIONNAIRE', null)

  T = (await q(`insert into tenders (institution_id, title, nature_marche, montant_estime, ligne_budgetaire, ppm_annee, mode_passation, current_phase, is_alloti, date_limite_depot, date_publication)
                values ($1,'Marché alloti à trois lots pour recours','FOURNITURES',180000000,'1',2026,'AOO','PHASE_8_EVALUATION', true, now() - interval '3 days', now() - interval '40 days') returning id`, [INST]))[0].id
  const rows = await q(`insert into tender_lots (tender_id, institution_id, numero_lot, libelle, montant_estime) values ($1,$2,1,'Lot 1',60000000),($1,$2,2,'Lot 2',60000000),($1,$2,3,'Lot 3',60000000) returning id, numero_lot`, [T, INST])
  L1 = rows.find(l => l.numero_lot === 1).id; L2 = rows.find(l => l.numero_lot === 2).id; L3 = rows.find(l => l.numero_lot === 3).id
  await q('alter table commission_members disable trigger trig_commission_guard')
  await q(`insert into commission_members (tender_id, institution_id, user_id, role_commission) values ($1,$2,$3,'PRESIDENT'),($1,$2,$4,'MEMBRE')`, [T, INST, U.ev1, U.ev2])
  await q('alter table commission_members enable trigger trig_commission_guard')
  const mk = async (name, u, lot, montant, note) => { BID[name] = (await q(`insert into bids (tender_id, institution_id, soumissionnaire_id, lot_id, status, montant_offre, submitted_at) values ($1,$2,$3,$4,'CONFORME',$5, now()) returning id`, [T, INST, U[u], lot, montant]))[0].id; return [BID[name], note] }
  const notes = [await mk('b1l1', 'b1', L1, 50000000, 80), await mk('b2l1', 'b2', L1, 60000000, 90), await mk('b1l2', 'b1', L2, 40000000, 85), await mk('b3l2', 'b3', L2, 45000000, 75),
                 await mk('b2l3', 'b2', L3, 30000000, 90), await mk('b3l3', 'b3', L3, 35000000, 80)]
  for (const [bid, n] of notes) await score(bid, n)
})

test('évaluation et attribution initiales : b2 gagne les lots 1 et 3, b1 le lot 2', async () => {
  assert.equal(await adv('prm', 'FINALISER_EVALUATION'), 'PHASE_9_ATTRIBUTION_PROVISOIRE')
  assert.equal(await adv('prm', 'PRONONCER_ATTRIBUTION_PROVISOIRE', { awards: [] }), 'PHASE_10_RECOURS')
  const l = await lots(T)
  assert.deepEqual(l.map(x => x.statut), ['ATTRIBUE', 'ATTRIBUE', 'ATTRIBUE'])
  assert.deepEqual(l.map(x => x.attributaire_id), [U.b2, U.b1, U.b2])
  assert.equal((await tenderRow(T)).montant_attribue, 130000000)
})

test('périmètre du recours : offre recevable sur CE lot, pas l\'attributaire, un recours par lot et par candidat', async () => {
  await rejects(appeal('b3', T, L1), /FORBIDDEN.*lot 1/)                          // b3 n'a pas déposé sur le lot 1
  await rejects(appeal('b2', T, L1), /attributaire provisoire du lot/)            // b2 a gagné le lot 1
  await rejects(appeal('b1', T, randomUUID()), /LOT_INVALID/)                     // lot d'un autre marché
  const other = (await q(`insert into tenders (institution_id, title, nature_marche, montant_estime, ligne_budgetaire, ppm_annee, mode_passation, current_phase, is_alloti)
                          values ($1,'Autre marché alloti','FOURNITURES',1000000,'1',2026,'DRP','PHASE_2_REDACTION', true) returning id`, [INST]))[0].id
  const foreign = (await q(`insert into tender_lots (tender_id, institution_id, numero_lot, libelle, montant_estime) values ($1,$2,1,'Lot étranger',500000) returning id`, [other, INST]))[0].id
  await rejects(appeal('b1', T, foreign), /LOT_INVALID.*n'appartient pas/)
  BID.a1 = await appeal('b1', T, L1)                                              // b1 a perdu le lot 1
  BID.a3 = await appeal('b3', T, L3)                                              // b3 a perdu le lot 3
  await rejects(appeal('b1', T, L1), /ALREADY_PENDING/)
  assert.equal((await q('select lot_id from appeals where id=$1', [BID.a1]))[0].lot_id, L1)
  // b1 peut aussi contester un autre lot où il est candidat ? Non : il a gagné le lot 2 → refusé.
  await rejects(appeal('b1', T, L2), /attributaire provisoire du lot/)
})

test('verrou dur inchangé : aucun passage en phase 11 tant qu\'un recours, de lot ou non, est pendant', async () => {
  await q(`update tenders set date_fin_recours = now() - interval '1 day' where id=$1`, [T])
  await rejects(adv('prm', 'CLORE_PERIODE_RECOURS'), /HARD_LOCK_APPEAL/)
  await q(`update tenders set date_fin_recours = now() + interval '8 days' where id=$1`, [T])
})

test('décision favorable sur le lot 1 : seul ce lot est rouvert, les autres gardent attribution, offres et montant', async () => {
  await decide(BID.a1, 'FAVORABLE')
  const t = await tenderRow(T)
  assert.equal(t.current_phase, 'PHASE_8_EVALUATION'); assert.equal(t.evaluation_round, 2)
  assert.equal(t.montant_attribue, 40000000 + 30000000, 'le total ne compte plus que les lots restés attribués')
  assert.equal(t.has_appeal_pending, true, 'le recours du lot 3 reste pendant')
  const l = await lots(T)
  assert.deepEqual(l.map(x => x.statut), ['OUVERT', 'ATTRIBUE', 'ATTRIBUE'])
  assert.equal(l[0].attributaire_id, null); assert.equal(l[1].attributaire_id, U.b1); assert.equal(l[2].attributaire_id, U.b2)
  const st = id => q('select status from bids where id=$1', [id]).then(r => r[0].status)
  assert.equal(await st(BID.b1l1), 'CONFORME'); assert.equal(await st(BID.b2l1), 'CONFORME')          // lot 1 : réévalué
  assert.equal(await st(BID.b1l2), 'PROVISOIREMENT_RETENUE'); assert.equal(await st(BID.b3l2), 'EVALUEE')  // lot 2 : intact
  assert.equal(await st(BID.b2l3), 'PROVISOIREMENT_RETENUE'); assert.equal(await st(BID.b3l3), 'EVALUEE')  // lot 3 : intact
})

test('une décision favorable est refusée pendant la réévaluation ; un rejet reste possible', async () => {
  await rejects(decide(BID.a3, 'FAVORABLE'), /INVALID_STATE.*réévaluation/)
  assert.equal((await q('select status from appeals where id=$1', [BID.a3]))[0].status, 'DEPOSE')   // rien n'a été enregistré
})

test('réévaluation du lot 1 seul : nouvelle ronde, classement du lot 1 seulement, total = tous les lots attribués', async () => {
  await score(BID.b1l1, 95); await score(BID.b2l1, 60)                            // b2 passe sous le seuil technique
  assert.equal(await adv('prm', 'FINALISER_EVALUATION'), 'PHASE_9_ATTRIBUTION_PROVISOIRE')
  const r2 = await q('select lot_id, bid_id, rang, qualifie from bid_rankings where tender_id=$1 and round=2', [T])
  assert.equal(r2.length, 2); assert.ok(r2.every(x => x.lot_id === L1))
  assert.equal(r2.find(x => x.bid_id === BID.b1l1).rang, 1); assert.equal(r2.find(x => x.bid_id === BID.b2l1).qualifie, false)
  assert.equal((await q('select count(*)::int n from bid_rankings where tender_id=$1 and round=1', [T]))[0].n, 6, 'les classements de la ronde 1 sont conservés')
  assert.equal(await adv('prm', 'PRONONCER_ATTRIBUTION_PROVISOIRE', { awards: [] }), 'PHASE_10_RECOURS')
  const l = await lots(T)
  assert.deepEqual(l.map(x => x.attributaire_id), [U.b1, U.b1, U.b2])             // lot 1 → b1 ; lots 2 et 3 inchangés
  assert.equal((await tenderRow(T)).montant_attribue, 50000000 + 40000000 + 30000000, 'régression : le total ne doit pas se limiter au lot rouvert')
})

test('publication : chaque lot est affiché avec le classement de sa dernière ronde', async () => {
  const pub = await asAnon(db, () => q(`select numero_lot, candidat, rang, retenue from v_public_offres where rang = 1 order by numero_lot`))
  assert.deepEqual(pub.map(x => [x.numero_lot, x.candidat, x.retenue]), [[1, 'B1 SARL', true], [2, 'B1 SARL', true], [3, 'B2 SARL', true]])
  assert.equal((await asAnon(db, () => q(`select count(*)::int n from v_public_offres`)))[0].n, 6)   // 2 offres du lot 1 (ronde 2) + 2 + 2
})

test('lot rouvert devenu infructueux : le marché poursuit avec les autres lots', async () => {
  const a = await appeal('b2', T, L1)                                              // b2 a perdu le lot 1 à la ronde 2
  await decide(a, 'FAVORABLE')
  assert.equal((await tenderRow(T)).evaluation_round, 3)
  await score(BID.b1l1, 50); await score(BID.b2l1, 50)                            // plus aucune offre qualifiée sur le lot 1
  assert.equal(await adv('prm', 'FINALISER_EVALUATION'), 'PHASE_9_ATTRIBUTION_PROVISOIRE')
  assert.equal(await adv('prm', 'PRONONCER_ATTRIBUTION_PROVISOIRE', { awards: [] }), 'PHASE_10_RECOURS')
  const l = await lots(T)
  assert.deepEqual(l.map(x => x.statut), ['INFRUCTUEUX', 'ATTRIBUE', 'ATTRIBUE'])
  assert.equal((await tenderRow(T)).montant_attribue, 40000000 + 30000000)
})

test('clôture des recours : le rejet du dernier recours libère la phase 11 ; lots infructueux ignorés', async () => {
  await decide(BID.a3, 'REJETE')
  assert.equal((await tenderRow(T)).has_appeal_pending, false)
  await q(`update tenders set date_fin_recours = now() - interval '1 day' where id=$1`, [T])
  assert.equal(await adv('prm', 'CLORE_PERIODE_RECOURS'), 'PHASE_11_ATTRIBUTION_DEFINITIVE')
})

test('recours sur le marché entier (sans lot) : comportement antérieur, tous les lots rouverts', async () => {
  const t2 = (await q(`insert into tenders (institution_id, title, nature_marche, montant_estime, ligne_budgetaire, ppm_annee, mode_passation, current_phase, is_alloti, date_fin_recours, date_attribution_provisoire, montant_attribue)
                       values ($1,'Marché alloti recours global','FOURNITURES',100000000,'1',2026,'AOO','PHASE_10_RECOURS', true, now() + interval '8 days', now() - interval '2 days', 90000000) returning id`, [INST]))[0].id
  const a = (await q(`insert into tender_lots (tender_id, institution_id, numero_lot, libelle, montant_estime) values ($1,$2,1,'L1',50000000),($1,$2,2,'L2',50000000) returning id, numero_lot`, [t2, INST]))
  const mk = (u, lot, status) => q(`insert into bids (tender_id, institution_id, soumissionnaire_id, lot_id, status, montant_offre, submitted_at) values ($1,$2,$3,$4,$5,45000000, now() - interval '5 days') returning id`, [t2, INST, U[u], lot, status])
  const [w1] = await mk('b1', a[0].id, 'PROVISOIREMENT_RETENUE'); await mk('b2', a[0].id, 'EVALUEE')
  const [w2] = await mk('b2', a[1].id, 'PROVISOIREMENT_RETENUE'); await mk('b1', a[1].id, 'EVALUEE')
  await q(`update tender_lots set statut='ATTRIBUE', attributaire_id=$2, attributaire_bid_id=$3, montant_attribue=45000000 where id=$1`, [a[0].id, U.b1, w1.id])
  await q(`update tender_lots set statut='ATTRIBUE', attributaire_id=$2, attributaire_bid_id=$3, montant_attribue=45000000 where id=$1`, [a[1].id, U.b2, w2.id])
  await rejects(appeal('b3', t2, null), /FORBIDDEN/)                              // b3 n'a pas déposé
  const ap = await appeal('b1', t2, null)                                         // b1 a un lot perdu (L2) : recours global recevable
  await decide(ap, 'FAVORABLE')
  const t = await tenderRow(t2)
  assert.equal(t.current_phase, 'PHASE_8_EVALUATION'); assert.equal(t.evaluation_round, 2); assert.equal(t.montant_attribue, null)
  assert.deepEqual((await lots(t2)).map(x => x.statut), ['OUVERT', 'OUVERT'])
  assert.equal((await q(`select count(*)::int n from bids where tender_id=$1 and status='CONFORME'`, [t2]))[0].n, 4)
})

test('un marché non alloti refuse un recours visant un lot', async () => {
  const plain = (await q(`insert into tenders (institution_id, title, nature_marche, montant_estime, ligne_budgetaire, ppm_annee, mode_passation, current_phase, date_fin_recours)
                          values ($1,'Marché simple','FOURNITURES',1000000,'1',2026,'DRP','PHASE_10_RECOURS', now() + interval '5 days') returning id`, [INST]))[0].id
  await rejects(appeal('b1', plain, randomUUID()), /LOT_INVALID.*pas alloti/)
})
