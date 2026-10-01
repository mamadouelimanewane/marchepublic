// Inclusion des PME : dossier permanent du fournisseur et alertes d'appels d'offres.
import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createDb, asUser, asService, asAnon } from './harness.mjs'

let db, INST
const U = {}
const q = (sql, params) => db.query(sql, params).then(r => r.rows)
const rpc = (key, sql, params) => asUser(db, U[key], () => q(sql, params))
const anon = (sql, params) => asAnon(db, () => q(sql, params))
const hex = c => c.repeat(64)

async function mkUser(key, role, inst, flags = {}) {
  const id = randomUUID()
  await q('insert into auth.users (id, email) values ($1, $2)', [id, `${key}@inc.sn`])
  await q('update users set role=$2, institution_id=$3, full_name=$4, is_pme=$5, is_pme_feminine=$6 where id=$1', [id, role, inst, key, !!flags.pme, !!flags.fem])
  U[key] = id
}
const doc = (key, type, extra = {}) => rpc(key, `insert into supplier_documents (type, titre, date_emission, date_expiration, storage_path, file_hash, statut)
    values ($1,$2,$3,$4,$5,$6,$7) returning id, statut`,
  [type, extra.titre ?? `Pièce ${type}`, extra.emission ?? '2026-01-01', extra.expiration ?? null, `${U[key]}/${randomUUID()}.pdf`, hex('a'), extra.statut ?? 'DEPOSE']).then(r => r[0])

before(async () => {
  db = await createDb()
  INST = (await q(`insert into institutions (code, name, type) values ('INC', 'Institution inclusion', 'ETAT') returning id`))[0].id
  await mkUser('cpm', 'CPM', INST); await mkUser('admin', 'ADMIN', INST); await mkUser('dcmp', 'DCMP', null)
  await mkUser('pme', 'SOUMISSIONNAIRE', null, { pme: true }); await mkUser('grande', 'SOUMISSIONNAIRE', null); await mkUser('autre', 'SOUMISSIONNAIRE', null)
})

test('dossier fournisseur : le dépôt part toujours de DEPOSE ; chemin imposé ; pas de mise à jour par le titulaire', async () => {
  const d = await doc('pme', 'QUITUS_FISCAL', { statut: 'VERIFIE' })          // tentative d'auto-vérification
  assert.equal(d.statut, 'DEPOSE')
  await assert.rejects(rpc('pme', `insert into supplier_documents (type, titre, storage_path, file_hash) values ('RCCM','RCCM d''un autre',$1,$2)`, [`${U.autre}/x.pdf`, hex('b')]), /INVALID_PATH/)
  await assert.rejects(rpc('pme', `update supplier_documents set statut='VERIFIE' where id=$1`, [d.id]), /permission denied/)
  assert.equal((await rpc('autre', 'select * from supplier_documents')).length, 0, 'un autre fournisseur ne voit pas la pièce')
  assert.equal((await rpc('cpm', 'select * from supplier_documents')).length, 0, 'le personnel ne voit pas le dossier avant tout dépôt d’offre')
  await assert.rejects(rpc('cpm', `insert into supplier_documents (user_id, type, titre, storage_path, file_hash) values ($1,'RCCM','x y z',$2,$3)`, [U.pme, `${U.pme}/y.pdf`, hex('c')]), /INVALID_PATH|row-level security/)
})

test('vérification par l’administration, état des pièces requises à une date donnée', async () => {
  const rccm = await doc('pme', 'RCCM', { expiration: '2030-01-01' })
  const cnss = await doc('pme', 'ATTESTATION_CNSS', { expiration: '2026-03-01' })
  const quitus = (await rpc('pme', `select id from supplier_documents where type='QUITUS_FISCAL'`))[0].id
  const state = async (at) => Object.fromEntries((await rpc('pme', 'select type, situation from supplier_pieces($1, $2::date)', [U.pme, at])).map(r => [r.type, r.situation]))
  assert.deepEqual(await state('2026-02-01'), { QUITUS_FISCAL: 'NON_VERIFIE', RCCM: 'NON_VERIFIE', ATTESTATION_CNSS: 'NON_VERIFIE' })

  await assert.rejects(rpc('pme', 'select review_supplier_document($1,$2)', [rccm.id, 'VERIFIE']), /FORBIDDEN/)
  await assert.rejects(rpc('admin', 'select review_supplier_document($1,$2)', [quitus, 'REFUSE']), /MOTIVATION_REQUIRED/)
  await rpc('admin', 'select review_supplier_document($1,$2)', [rccm.id, 'VERIFIE'])
  await rpc('admin', 'select review_supplier_document($1,$2)', [cnss.id, 'VERIFIE'])
  await rpc('dcmp', 'select review_supplier_document($1,$2,$3)', [quitus, 'REFUSE', 'Document illisible, merci de le rescanner.'])
  await assert.rejects(rpc('admin', 'select review_supplier_document($1,$2,$3)', [rccm.id, 'REFUSE', 'Tentative de revirement tardif sur une pièce traitée']), /INVALID_STATE/)

  assert.deepEqual(await state('2026-02-01'), { QUITUS_FISCAL: 'REFUSE', RCCM: 'VALIDE', ATTESTATION_CNSS: 'VALIDE' })
  assert.equal((await state('2026-06-01')).ATTESTATION_CNSS, 'EXPIRE', 'la validité se juge à la date limite de dépôt, pas à la date du jour')
  assert.equal((await rpc('pme', `select * from notifications where kind in ('PIECE_VERIFIE','PIECE_REFUSE')`)).length, 3)

  const absent = await rpc('autre', 'select type, situation from supplier_pieces($1)', [U.autre])
  assert.ok(absent.every(r => r.situation === 'ABSENT'))
  await assert.rejects(rpc('autre', 'select * from supplier_pieces($1)', [U.pme]), /FORBIDDEN/)
  await rpc('dcmp', 'select * from supplier_pieces($1)', [U.pme])
})

test('le personnel de l’autorité voit le dossier d’un candidat seulement après l’ouverture des plis', async () => {
  const t = (await q(`insert into tenders (institution_id, title, nature_marche, montant_estime, ligne_budgetaire, ppm_annee, mode_passation, current_phase, date_publication, date_limite_depot)
                      values ($1,'Marché de vérification des pièces','FOURNITURES',1000000,'1',2026,'DRP','PHASE_6_DEPOT_OFFRES', now() - interval '20 days', now() + interval '2 days') returning id`, [INST]))[0].id
  await q(`insert into bids (tender_id, institution_id, soumissionnaire_id, status) values ($1,$2,$3,'SOUMISE')`, [t, INST, U.pme])
  assert.equal((await rpc('cpm', 'select * from supplier_documents')).length, 0, 'avant ouverture : rien')
  await q(`update tenders set current_phase='PHASE_7_OUVERTURE_PLIS', date_limite_depot = now() - interval '1 hour' where id=$1`, [t])
  assert.ok((await rpc('cpm', 'select * from supplier_documents')).length >= 3, 'après ouverture : le dossier du candidat est consultable')
  assert.ok((await rpc('cpm', 'select * from supplier_pieces($1)', [U.pme])).length === 3)
  assert.equal((await rpc('cpm', 'select * from supplier_documents where user_id=$1', [U.autre])).length, 0, 'les non-candidats restent invisibles')
})

test('alertes : abonnement validé, limité, ciblé par secteur / nature / montant / réservation PME', async () => {
  const corps = (await q(`select id, code from corps_metiers where code in ('INFORMATIQUE','BTP')`))
  const info = corps.find(c => c.code === 'INFORMATIQUE').id, btp = corps.find(c => c.code === 'BTP').id
  const sub = (key, canal, dest, corpsId = null, nature = null, min = null) => rpc(key, `insert into tender_alert_subscriptions (canal, destinataire, corps_metier_id, nature, montant_min) values ($1,$2,$3,$4,$5) returning id`, [canal, dest, corpsId, nature, min])
  await assert.rejects(sub('pme', 'EMAIL', 'pas-un-email'), /dest_format|check/)
  await assert.rejects(sub('pme', 'SMS', 'abc'), /dest_format|check/)
  await sub('pme', 'SMS', '+221771234567', info)                    // 1 : informatique
  await sub('pme', 'EMAIL', 'pme@exemple.sn', null, 'TRAVAUX')      // 2 : tous travaux
  await sub('grande', 'EMAIL', 'grande@exemple.sn', info, null, 50000000)   // 3 : informatique ≥ 50 M
  await sub('autre', 'WHATSAPP', '221770000000', btp)                // 4 : BTP
  assert.equal((await rpc('autre', 'select * from tender_alert_subscriptions')).length, 1, 'chacun ne voit que ses abonnements')
  await assert.rejects(rpc('cpm', `insert into tender_alert_subscriptions (user_id, canal, destinataire) values ($1,'EMAIL','x@y.sn')`, [U.cpm]), /row-level security/)
  for (let i = 0; i < 8; i++) await sub('pme', 'EMAIL', `a${i}@exemple.sn`, btp)
  await assert.rejects(sub('pme', 'EMAIL', 'trop@exemple.sn'), /LIMIT_REACHED/)
  await q(`delete from tender_alert_subscriptions where user_id=$1 and destinataire like 'a%@exemple.sn'`, [U.pme])

  const publish = async (extra) => {
    const t = (await q(`insert into tenders (institution_id, title, nature_marche, montant_estime, ligne_budgetaire, ppm_annee, mode_passation, justification_mode, corps_metier_id, is_reserve_pme, current_phase, date_limite_depot)
                        values ($1,$2,$3,$4,'1',2026,'AOO','Mode ouvert retenu pour élargir la concurrence',$5,$6,'PHASE_4_PUBLICATION', now() + interval '40 days') returning id`, [INST, extra.title, extra.nature ?? 'FOURNITURES', extra.montant, extra.corps, !!extra.reserve]))[0].id
    await q(`select _apply_transition($1,'PHASE_5_CLARIFICATIONS','PUBLIER_AO')`, [t])
    return t
  }
  const msgs = async t => (await q(`select canal, destinataire, corps from outbox_messages where tender_id=$1 order by destinataire`, [t]))

  const t1 = await publish({ title: 'Acquisition de serveurs informatiques', corps: info, montant: 80000000 })
  assert.deepEqual((await msgs(t1)).map(m => m.destinataire), ['+221771234567', 'grande@exemple.sn'])
  assert.match((await msgs(t1))[0].corps, /MP-INC-\d{4}-\d{4}.*Limite de dépôt.*\/avis\//)

  const t2 = await publish({ title: 'Petite commande informatique', corps: info, montant: 10000000 })
  assert.deepEqual((await msgs(t2)).map(m => m.destinataire), ['+221771234567'], 'sous le seuil de montant de la grande entreprise')

  const t3 = await publish({ title: 'Construction de salles de classe', corps: btp, nature: 'TRAVAUX', montant: 90000000 })
  assert.deepEqual((await msgs(t3)).map(m => m.destinataire).sort(), ['221770000000', 'pme@exemple.sn'])

  const t4 = await publish({ title: 'Marché réservé aux PME informatique', corps: info, montant: 80000000, reserve: true })
  assert.deepEqual((await msgs(t4)).map(m => m.destinataire), ['+221771234567'], 'une grande entreprise n’est pas alertée d’un marché réservé aux PME')
  assert.ok((await rpc('pme', `select * from notifications where tender_id=$1 and kind='ALERTE_AO'`, [t4])).length === 1)
  assert.equal((await rpc('grande', `select * from notifications where tender_id=$1 and kind='ALERTE_AO'`, [t4])).length, 0)
})

test('file d’envoi : réservée au service, tentatives plafonnées, pas de double traitement', async () => {
  await assert.rejects(rpc('pme', 'select * from outbox_messages'), /permission denied/)
  await assert.rejects(rpc('pme', 'select * from claim_outbox(array[\'SMS\'])'), /permission denied/)
  const claimed = await asService(db, () => q(`select id, canal, tentatives from claim_outbox(array['SMS'], 10)`))
  assert.ok(claimed.length >= 1 && claimed.every(m => m.canal === 'SMS' && m.tentatives === 1))
  const again = await asService(db, () => q(`select id from claim_outbox(array['SMS'], 10)`))
  assert.ok(again.every(m => claimed.some(c => c.id === m.id)), 'les messages non marqués sont réessayés, aucun autre canal n’est touché')
  const first = claimed[0].id
  await asService(db, () => q('select mark_outbox($1, true)', [first]))
  assert.equal((await q('select statut from outbox_messages where id=$1', [first]))[0].statut, 'SENT')
  // échecs répétés : PENDING puis FAILED au 3e essai
  await q(`update outbox_messages set statut='SENT' where canal='EMAIL' and statut='PENDING'`)
  const m = (await q(`insert into outbox_messages (canal, destinataire, sujet, corps) values ('EMAIL','x@y.sn','s','c') returning id`))[0].id
  for (let i = 0; i < 3; i++) {
    await asService(db, () => q(`select * from claim_outbox(array['EMAIL'], 1)`))
    await asService(db, () => q('select mark_outbox($1, false, $2)', [m, 'SMTP indisponible']))
  }
  assert.deepEqual({ ...(await q('select statut, tentatives from outbox_messages where id=$1', [m]))[0] }, { statut: 'FAILED', tentatives: 3 })
})

test('alerte d’expiration des pièces : une seule fois par pièce', async () => {
  const d = await doc('grande', 'RCCM', { expiration: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10) })
  await rpc('admin', 'select review_supplier_document($1,$2)', [d.id, 'VERIFIE'])
  assert.ok((await asService(db, () => q('select notify_expiring_documents() as n')))[0].n >= 1, 'inclut aussi les pièces déjà expirées non encore signalées')
  assert.equal((await asService(db, () => q('select notify_expiring_documents() as n')))[0].n, 0, 'idempotent')
  assert.equal((await rpc('grande', `select * from notifications where kind='PIECE_EXPIRE'`)).length, 1)
  assert.equal((await q(`select * from outbox_messages where user_id=$1 and sujet like 'Pièce%'`, [U.grande])).length, 1)
})

test('historique des prestataires : droit de réponse, évaluations immuables, publication en agrégat à partir de 3', async () => {
  // Trois contrats évalués pour le même prestataire (fixtures posées par le propriétaire de la base)
  const evals = []
  for (let i = 0; i < 3; i++) {
    const t = (await q(`insert into tenders (institution_id, title, nature_marche, montant_estime, ligne_budgetaire, ppm_annee, mode_passation, current_phase)
                        values ($1,$2,'FOURNITURES',1000000,'1',2026,'DRP','PHASE_14_RECEPTION_PAIEMENT') returning id`, [INST, `Marché historique ${i} pour essai`]))[0].id
    const bid = (await q(`insert into bids (tender_id, institution_id, soumissionnaire_id, status) values ($1,$2,$3,'RETENUE_DEFINITIVE') returning id`, [t, INST, U.pme]))[0].id
    const c = (await q(`insert into contracts (tender_id, institution_id, bid_id, attributaire_id, montant_initial) values ($1,$2,$3,$4,1000000) returning id`, [t, INST, bid, U.pme]))[0].id
    evals.push((await q(`insert into provider_evaluations (contract_id, tender_id, institution_id, prestataire_id, note_qualite, note_delai, note_cout, commentaire)
                         values ($1,$2,$3,$4,8,6,7,'Commentaire interne confidentiel') returning id`, [c, t, INST, U.pme]))[0].id)
    if (i === 0) await q(`insert into execution_incidents (contract_id, tender_id, institution_id, gravite, description) values ($1,$2,$3,'CRITIQUE','Incident critique de test')`, [c, t, INST])
  }
  assert.equal((await anon('select * from v_public_prestataires')).length, 1)
  const [pub] = await anon('select * from v_public_prestataires')
  assert.equal(Number(pub.note_moyenne), 7); assert.equal(pub.nb_evaluations, 3)
  assert.ok(!('commentaire' in pub), 'aucun commentaire individuel publié')

  await assert.rejects(rpc('cpm', 'select respond_to_evaluation($1,$2)', [evals[0], 'Je réponds à la place du prestataire évalué']), /FORBIDDEN/)
  await assert.rejects(rpc('pme', 'select respond_to_evaluation($1,$2)', [evals[0], 'trop court']), /INVALID_INPUT/)
  await rpc('pme', 'select respond_to_evaluation($1,$2)', [evals[0], 'Le retard est imputable à une livraison tardive du maître d’ouvrage.'])
  await assert.rejects(rpc('pme', 'select respond_to_evaluation($1,$2)', [evals[0], 'Seconde réponse qui ne doit pas être acceptée']), /INVALID_STATE/)
  await assert.rejects(q(`update provider_evaluations set note_qualite = 10`), /IMMUTABLE_RECORD|permission/)
  await assert.rejects(rpc('cpm', `update provider_evaluations set note_qualite = 10`), /permission denied/)
  await assert.rejects(q(`delete from provider_evaluations`), /IMMUTABLE_RECORD/)

  const [rec] = await rpc('pme', 'select * from supplier_track_record($1)', [U.pme])
  assert.equal(rec.nb_contrats, 3); assert.equal(rec.nb_evaluations, 3); assert.equal(Number(rec.note_globale), 7); assert.equal(rec.nb_incidents_critiques, 1)
  assert.equal(Number(rec.montant_total), 3000000)
  await assert.rejects(rpc('autre', 'select * from supplier_track_record($1)', [U.pme]), /FORBIDDEN/)
  await rpc('dcmp', 'select * from supplier_track_record($1)', [U.pme])
  assert.equal((await rpc('autre', 'select * from provider_evaluations')).length, 0, 'les évaluations restent confidentielles')
})
