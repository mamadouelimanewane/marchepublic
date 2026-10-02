// Séance d'ouverture publique ou restreinte : règles par mode, type de séance figé à l'ouverture, registre de présence,
// lecture des offres réservée aux candidats ayant déposé (séance publique), rien en séance restreinte.
import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createDb, asUser, asAnon } from './harness.mjs'

let db, INST, INST2
const U = {}, T = {}
const q = (sql, params) => db.query(sql, params).then(r => r.rows)
const as = (key, sql, params) => asUser(db, U[key], () => q(sql, params))
const rejects = (p, re) => assert.rejects(p, e => re.test(e.message), `attendu : ${re}`)

async function mkUser(key, role, institution) {
  const id = randomUUID()
  await q('insert into auth.users (id, email) values ($1, $2)', [id, `${key}@ouv.sn`])
  await q('update users set role=$2, institution_id=$3, full_name=$4, ninea=$5 where id=$1', [id, role, institution, key.toUpperCase() + ' SARL', role === 'SOUMISSIONNAIRE' ? '7' + key.length + '000' : null])
  U[key] = id
}
// Marché en phase 7, date limite dépassée, avec commission (président + membre) et trois offres.
async function mkTender(key, mode, extra = '') {
  const t = (await q(`insert into tenders (institution_id, title, nature_marche, montant_estime, ligne_budgetaire, ppm_annee, mode_passation, justification_mode, current_phase, date_limite_depot, date_publication ${extra ? ',' + extra.split('=')[0] : ''})
                      values ($1,$2,'FOURNITURES',80000000,'1',2026,$3,'Mode retenu pour les besoins de l''essai d''ouverture',$4, now() - interval '1 hour', now() - interval '40 days' ${extra ? ',' + extra.split('=')[1] : ''}) returning id`,
                     [INST, `Marché ${key} pour essai d'ouverture`, mode, 'PHASE_7_OUVERTURE_PLIS']))[0].id
  T[key] = t
  await q('alter table commission_members disable trigger trig_commission_guard')
  await q(`insert into commission_members (tender_id, institution_id, user_id, role_commission) values ($1,$2,$3,'PRESIDENT'),($1,$2,$4,'MEMBRE')`, [t, INST, U.pres, U.ev])
  await q('alter table commission_members enable trigger trig_commission_guard')
  const bid = (u, status, montant) => q(`insert into bids (tender_id, institution_id, soumissionnaire_id, status, montant_offre, submitted_at) values ($1,$2,$3,$4,$5, now() - interval '3 hours')`, [t, INST, U[u], status, montant])
  await bid('b1', 'SOUMISE', 70000000); await bid('b2', 'SOUMISE', 65000000); await bid('late', 'RETARDEE', 10000000)
  return t
}
const sign = async key => { await as('cpm', 'select sign_opening($1)', [T[key]]); return (await as('pres', 'select sign_opening($1) as r', [T[key]]))[0].r }

before(async () => {
  db = await createDb()
  INST = (await q(`insert into institutions (code, name, type) values ('OUV', 'Autorité d''ouverture', 'ETAT') returning id`))[0].id
  INST2 = (await q(`insert into institutions (code, name, type) values ('OU2', 'Autre autorité', 'ETAT') returning id`))[0].id
  await mkUser('cpm', 'CPM', INST); await mkUser('prm', 'PRM', INST); await mkUser('pres', 'EVALUATEUR', INST); await mkUser('ev', 'EVALUATEUR', INST)
  await mkUser('cpm2', 'CPM', INST2); await mkUser('admin', 'ADMIN', null); await mkUser('dcmp', 'DCMP', null)
  for (const k of ['b1', 'b2', 'b3', 'late']) await mkUser(k, 'SOUMISSIONNAIRE', null)
})

test('règles : AOO publique, AOR et DRP restreintes ; seul l\'administrateur les modifie', async () => {
  const r = Object.fromEntries((await as('cpm', `select mode::text, publique from regles_ouverture`)).map(x => [x.mode, x.publique]))
  assert.equal(r.AOO, true); assert.equal(r.AOR, false); assert.equal(r.DRP, false); assert.equal(r.CONCOURS, true)
  assert.equal((await as('cpm', `update regles_ouverture set publique = true where mode = 'DRP' returning mode`)).length, 0)       // RLS : aucune ligne modifiable
  assert.equal((await as('b1', `update regles_ouverture set publique = true where mode = 'DRP' returning mode`)).length, 0)
  assert.equal((await as('admin', `update regles_ouverture set publique = true where mode = 'DRP' returning mode`)).length, 1)
  assert.equal((await q(`select ouverture_publique('DRP') as p`))[0].p, true)
  await as('admin', `update regles_ouverture set publique = false where mode = 'DRP'`)
  assert.equal((await q(`select ouverture_publique('DRP') as p`))[0].p, false)
  assert.ok((await q(`select count(*)::int n from audit_logs where entity_type = 'regles_ouverture'`))[0].n >= 2, 'modifications tracées')
})

test('registre de présence : CPM/PRM de l\'autorité, phase 7, avant la signature, immuable', async () => {
  await mkTender('pub', 'AOO')
  const add = (who, nom = 'Awa Diallo', qualite = 'CANDIDAT', t = T.pub) => as(who, `select record_attendance($1,$2,$3,'SENEGAL TECH') as id`, [t, nom, qualite])
  await rejects(add('b1'), /FORBIDDEN/)
  await rejects(add('cpm2'), /FORBIDDEN/)                                         // autre autorité
  await rejects(add('ev'), /FORBIDDEN/)
  await rejects(add('cpm', 'Al'), /check|nom/i)                                   // nom trop court
  await rejects(add('cpm', 'Awa Diallo', 'VISITEUR'), /check|qualite/i)
  const [{ id }] = await add('cpm'); await add('prm', 'Moussa Fall', 'OBSERVATEUR')
  assert.equal((await as('cpm', `select count(*)::int n from opening_attendance where tender_id=$1`, [T.pub]))[0].n, 2)
  assert.equal((await as('b1', `select count(*)::int n from opening_attendance`))[0].n, 0, 'le registre n\'est pas lisible par les candidats')
  await rejects(q(`update opening_attendance set nom = 'X Y Z' where id = $1`, [id]), /IMMUTABLE/)
  await rejects(q(`delete from opening_attendance where id = $1`, [id]), /IMMUTABLE/)
  await rejects(as('cpm', `update opening_attendance set nom = 'Autre nom' where id = $1`, [id]), /permission|denied/i)
})

test('avant l\'ouverture, personne ne lit les offres, même un candidat ayant déposé', async () => {
  assert.equal((await as('b1', `select count(*)::int n from v_lecture_ouverture`))[0].n, 0)
  assert.equal((await as('cpm', `select count(*)::int n from v_lecture_ouverture`))[0].n, 0)
})

test('ouverture d\'une séance publique : type figé dans l\'enregistrement, registre clos', async () => {
  const r = await sign('pub')
  assert.equal(r.opened, true); assert.equal(r.seance_publique, true)
  const [o] = await q(`select seance_publique from bid_openings where tender_id=$1`, [T.pub])
  assert.equal(o.seance_publique, true)
  await rejects(as('cpm', `select record_attendance($1,'Retardataire Sow','AUTRE',null)`, [T.pub]), /INVALID_PHASE|IMMUTABLE/)
  // Changer la règle après coup ne modifie pas l'ouverture déjà enregistrée.
  await as('admin', `update regles_ouverture set publique = false where mode = 'AOO'`)
  assert.equal((await q(`select seance_publique from bid_openings where tender_id=$1`, [T.pub]))[0].seance_publique, true)
  await as('admin', `update regles_ouverture set publique = true where mode = 'AOO'`)
})

test('séance publique : les candidats ayant déposé lisent les offres reçues ; les autres ne voient rien', async () => {
  const rows = await as('b1', `select candidat, montant_lu, statut from v_lecture_ouverture where tender_id=$1 order by candidat`, [T.pub])
  assert.deepEqual(rows.map(x => x.candidat), ['B1 SARL', 'B2 SARL'], 'l\'offre tardive est exclue')
  assert.deepEqual(rows.map(x => Number(x.montant_lu)), [70000000, 65000000])
  assert.equal((await as('b2', `select count(*)::int n from v_lecture_ouverture`))[0].n, 2)
  assert.equal((await as('b3', `select count(*)::int n from v_lecture_ouverture`))[0].n, 0, 'candidat n\'ayant rien déposé')
  assert.equal((await as('late', `select count(*)::int n from v_lecture_ouverture`))[0].n, 0, 'offre tardive : pas de lecture')
  assert.equal((await asAnon(db, () => q(`select count(*)::int n from v_lecture_ouverture`).catch(() => [{ n: 0 }])))[0].n, 0)
  await rejects(asAnon(db, () => q(`select * from v_lecture_ouverture`)), /permission|denied/i)
  assert.equal((await as('cpm', `select count(*)::int n from v_lecture_ouverture`))[0].n, 2, 'personnel de l\'autorité')
  assert.equal((await as('cpm2', `select count(*)::int n from v_lecture_ouverture`))[0].n, 0, 'personnel d\'une autre autorité')
  assert.equal((await as('dcmp', `select count(*)::int n from v_lecture_ouverture`))[0].n, 2, 'régulateur')
})

test('séance restreinte : le type est enregistré et aucune lecture n\'est communiquée aux candidats', async () => {
  await mkTender('res', 'AOR')
  const r = await sign('res')
  assert.equal(r.seance_publique, false)
  assert.equal((await q(`select seance_publique from bid_openings where tender_id=$1`, [T.res]))[0].seance_publique, false)
  assert.equal((await as('b1', `select count(*)::int n from v_lecture_ouverture where tender_id=$1`, [T.res]))[0].n, 0)
  assert.equal((await as('cpm', `select count(*)::int n from v_lecture_ouverture where tender_id=$1`, [T.res]))[0].n, 0, 'le personnel a ses écrans internes ; cette vue ne sert que la séance publique')
  // les montants restent inaccessibles aux candidats par toutes les autres voies (publicité graduée inchangée)
  assert.equal((await as('b1', `select count(*)::int n from bids where tender_id=$1 and soumissionnaire_id <> $2`, [T.res, U.b1]))[0].n, 0)
  assert.equal((await asAnon(db, () => q(`select count(*)::int n from v_public_offres where tender_id=$1`, [T.res])))[0].n, 0)
})

test('les montants lus d\'une séance publique ne fuient pas par la table des offres', async () => {
  assert.equal((await as('b1', `select count(*)::int n from bids where tender_id=$1 and soumissionnaire_id <> $2`, [T.pub, U.b1]))[0].n, 0)
})
