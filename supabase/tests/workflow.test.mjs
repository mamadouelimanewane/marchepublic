// Test d'intégration du moteur de workflow en base (PostgreSQL WASM + migrations réelles).
// Exécution : node --test supabase/tests
import test, { before, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createDb, asUser } from './harness.mjs'

let db
const U = {}          // utilisateurs par clé
let INST, TENDER

const q = (sql, params) => db.query(sql, params).then(r => r.rows)
const as = (key, fn) => asUser(db, U[key], fn)
const rpc = (key, sql, params) => as(key, () => q(sql, params))
const advance = (key, event, payload = {}) =>
  rpc(key, 'select advance_phase($1,$2,$3::jsonb) as phase', [TENDER, event, JSON.stringify(payload)]).then(r => r[0].phase)
const phase = async () => (await q('select current_phase from tenders where id=$1', [TENDER]))[0].current_phase
const hex = c => c.repeat(64)

async function mkUser(key, role, institution, extra = {}) {
  const id = randomUUID()
  await q('insert into auth.users (id, email) values ($1, $2)', [id, `${key}@test.sn`])
  await q('update users set role=$2, institution_id=$3, full_name=$4, is_pme=$5, is_pme_feminine=$6 where id=$1',
    [id, role, institution, key, !!extra.pme, !!extra.fem])
  U[key] = id
}

before(async () => {
  db = await createDb()
  INST = (await q(`insert into institutions (code, name, type) values ('MEFP', 'Ministère test', 'ETAT') returning id`))[0].id
  await mkUser('sd', 'SERVICE_DEMANDEUR', INST)
  await mkUser('prm', 'PRM', INST)
  await mkUser('cpm', 'CPM', INST)
  await mkUser('tresor', 'TRESOR', INST)
  await mkUser('admin', 'ADMIN', INST)
  for (const e of ['ev1', 'ev2', 'ev3']) await mkUser(e, 'EVALUATEUR', INST)
  await mkUser('dcmp', 'DCMP', null)
  await mkUser('arcop', 'ARCOP', null)
  await mkUser('b1', 'SOUMISSIONNAIRE', null, { pme: true })
  await mkUser('b2', 'SOUMISSIONNAIRE', null)
  await mkUser('b3', 'SOUMISSIONNAIRE', null)
})

describe('Sécurité de base', () => {
  test('toutes les tables publiques ont la RLS', async () => {
    const rows = await q(`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
                          where n.nspname='public' and c.relkind='r' and not c.relrowsecurity`)
    assert.deepEqual(rows, [])
  })

  test("l'inscription crée toujours un soumissionnaire, même avec un rôle dans les métadonnées", async () => {
    const id = randomUUID()
    await q(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'evil@test.sn', '{"role":"ADMIN","full_name":"Evil"}')`, [id])
    const [u] = await q('select role, institution_id from users where id=$1', [id])
    assert.equal(u.role, 'SOUMISSIONNAIRE')
    assert.equal(u.institution_id, null)
  })

  test('un utilisateur ne peut pas s’auto-promouvoir ni modifier ses statuts PME', async () => {
    await assert.rejects(rpc('b2', `update users set role='ADMIN' where id=$1`, [U.b2]), /FORBIDDEN_COLUMN/)
    await assert.rejects(rpc('b2', `update users set is_pme=true where id=$1`, [U.b2]), /FORBIDDEN_COLUMN/)
    await rpc('b2', `update users set telephone='770000000' where id=$1`, [U.b2])
  })

  test('les seuils ne sont modifiables que par ADMIN', async () => {
    assert.equal((await rpc('prm', `update config_seuils set valeur='1' where cle='AVENANT_PLAFOND' returning cle`)).length, 0)
    const [{ valeur }] = await q(`select valeur from config_seuils where cle='AVENANT_PLAFOND'`)
    assert.equal(valeur, '0.30')
    await rpc('admin', `update config_seuils set valeur='0.30' where cle='AVENANT_PLAFOND'`)
  })

  test('le journal d’audit est inviolable (insert direct, update, delete, truncate)', async () => {
    await assert.rejects(rpc('prm', `insert into audit_logs (action, entity_type, entity_id) values ('FAKE','x',gen_random_uuid())`), /permission denied/)
    await assert.rejects(q(`update audit_logs set action='X'`), /AUDIT_IMMUTABLE/)
    await assert.rejects(q(`delete from audit_logs`), /AUDIT_IMMUTABLE/)
    await assert.rejects(q(`truncate audit_logs`), /AUDIT_IMMUTABLE/)
  })
})

describe('Cycle de vie complet — 15 phases', { concurrency: false }, () => {
  test('Phase 1 : besoin → marché programmé, référence séquentielle, mode calculé', async () => {
    const [b] = await as('sd', () => q(
      `insert into besoins (institution_id, service_demandeur_id, intitule, nature_marche, montant_estime, ligne_budgetaire, annee_budget, statut)
       values ($1, $2, 'Acquisition de 200 ordinateurs', 'FOURNITURES', 80000000, '2.4.1', 2026, 'SOUMIS') returning id`, [INST, U.sd]))
    await assert.rejects(rpc('cpm', 'select programmer_besoin($1,$2)', [b.id, 'VALIDER']), /FORBIDDEN/)
    const [{ programmer_besoin }] = await rpc('prm', 'select programmer_besoin($1,$2)', [b.id, 'VALIDER'])
    TENDER = programmer_besoin
    const [t] = await q('select reference, mode_passation, mode_suggere, current_phase from tenders where id=$1', [TENDER])
    assert.match(t.reference, /^MP-MEFP-\d{4}-0001$/)
    assert.equal(t.mode_passation, 'AOO')          // 80 M ≥ seuil État fournitures (50 M)
    assert.equal(t.current_phase, 'PHASE_1_PROGRAMMATION')
  })

  test('mode de passation : DRP interdite au-delà du seuil, dérogation à justifier, numérotation sans collision', async () => {
    const mk = (montant, mode, just) => rpc('prm',
      `insert into tenders (institution_id, title, nature_marche, montant_estime, mode_passation, justification_mode)
       values ($1, 'Marché de test de seuil', 'FOURNITURES', $2, $3, $4) returning reference, mode_passation`, [INST, montant, mode, just])
    await assert.rejects(mk(60000000, 'DRP', null), /MODE_ILLEGAL/)
    await assert.rejects(mk(60000000, 'AOR', null), /JUSTIFICATION_REQUIRED/)
    const [drp] = await mk(10000000, null, null)
    assert.equal(drp.mode_passation, 'DRP')
    const [aor] = await mk(60000000, 'AOR', 'Procédure restreinte justifiée par la spécificité technique')
    assert.notEqual(drp.reference, aor.reference)
  })

  test('aucune modification directe de phase ni de colonnes protégées', async () => {
    await assert.rejects(rpc('prm', `update tenders set current_phase='PHASE_4_PUBLICATION' where id=$1`, [TENDER]), /USE_ADVANCE_PHASE/)
    await assert.rejects(rpc('prm', `update tenders set has_appeal_pending=false, montant_attribue=1 where id=$1`, [TENDER]), /LOCKED_COLUMNS/)
    await assert.rejects(rpc('prm', `update tenders set reference='X' where id=$1`, [TENDER]), /LOCKED_COLUMNS|immuable/)
    // transition illégale, même pour le service_role / propriétaire
    await assert.rejects(q(`update tenders set current_phase='PHASE_9_ATTRIBUTION_PROVISOIRE' where id=$1`, [TENDER]), /INVALID_TRANSITION/)
  })

  test('Phase 1 → 2 : rôles contrôlés', async () => {
    await assert.rejects(advance('b1', 'VALIDER_PPM'), /UNAUTHENTICATED|FORBIDDEN/)
    await assert.rejects(advance('sd', 'VALIDER_PPM'), /FORBIDDEN/)
    assert.equal(await advance('prm', 'VALIDER_PPM'), 'PHASE_2_REDACTION')
  })

  test('Phase 2 : critères Σ=100 et circuit de validation du TDR/DAO', async () => {
    await assert.rejects(rpc('cpm', `update tenders set criteres_evaluation='[{"critere":"A","ponderation":90}]' where id=$1`, [TENDER]), /CRITERIA_INVALID/)
    await rpc('cpm', `update tenders set criteres_evaluation=$2::jsonb where id=$1`, [TENDER, JSON.stringify([
      { critere: 'Expérience', ponderation: 40 }, { critere: 'Méthodologie', ponderation: 35 }, { critere: 'Moyens', ponderation: 25 }])])
    // transmission impossible sans document validé
    await assert.rejects(advance('cpm', 'FINALISER_DAO'), /GUARD_PHASE_2/)
    const [d] = await as('sd', () => q(`insert into tender_documents (tender_id, institution_id, type, titre) values ($1,$2,'DAO','DAO fournitures informatiques') returning id`, [TENDER, INST]))
    U._doc = d.id
    await rpc('sd', `update tender_documents set contenu='{"sections":[{"id":"objet","titre":"Objet","contenu":"..."}]}' where id=$1`, [d.id])
    await rpc('sd', `update tender_documents set circuit_statut='RELECTURE_CPM' where id=$1`, [d.id])
    await assert.rejects(rpc('cpm', `update tender_documents set circuit_statut='VALIDE_PRM' where id=$1`, [d.id]), /CIRCUIT_INVALID/)
    // Aide à la rédaction : un DAO sans clause obligatoire ou avec un texte à compléter ne peut pas être validé par le PRM.
    await assert.rejects(rpc('prm', `update tender_documents set circuit_statut='VALIDE_PRM' where id=$1`, [d.id]), /DOCUMENT_INCOMPLETE.*MISSING_CLAUSE/)
    const clauses = await q(`select code, contenu from clause_templates where is_active and obligatoire and (natures is null or 'FOURNITURES' = any(natures))`)
    const texte = 'Objet du marché : fourniture, livraison et installation du matériel informatique décrit à la section 6.'
    const sections = (extra = '') => ({ sections: [
      { id: 'objet', titre: 'Objet', contenu: texte + extra, obligatoire: true },
      ...clauses.map(c => ({ id: `clause-${c.code}`, titre: c.code, contenu: c.contenu.replaceAll('[●]', '30'), obligatoire: true }))] })
    await rpc('cpm', `update tender_documents set contenu=$2::jsonb where id=$1`, [d.id, JSON.stringify(sections(' Délai : [●] jours.'))])
    await assert.rejects(rpc('prm', `update tender_documents set circuit_statut='VALIDE_PRM' where id=$1`, [d.id]), /DOCUMENT_INCOMPLETE.*PLACEHOLDER/)
    await rpc('cpm', `update tender_documents set contenu=$2::jsonb where id=$1`, [d.id, JSON.stringify(sections())])
    await rpc('prm', `update tender_documents set circuit_statut='VALIDE_PRM' where id=$1`, [d.id])
    const versions = await q('select version, circuit_statut from document_versions where document_id=$1 order by version', [d.id])
    assert.ok(versions.length >= 4, 'une version immuable par changement')
    await assert.rejects(q('update document_versions set contenu=$2::jsonb where document_id=$1', [d.id, '{}']), /IMMUTABLE_RECORD/)
  })

  test('Phase 3 : verrouillage du dossier, avis DCMP défavorable → retour rédaction', async () => {
    assert.equal(await advance('cpm', 'FINALISER_DAO'), 'PHASE_3_VALIDATION_PRIORI')
    assert.equal((await rpc('prm', `update tender_documents set contenu='{}' where id=$1 returning id`, [U._doc])).length, 0, 'document verrouillé : aucune ligne modifiable')
    await assert.rejects(rpc('prm', 'select record_review($1,$2,$3)', [TENDER, 'AVIS_NON_OBJECTION', 'FAVORABLE']), /FORBIDDEN/)
    await assert.rejects(rpc('dcmp', 'select record_review($1,$2,$3)', [TENDER, 'AVIS_NON_OBJECTION', 'DEFAVORABLE']), /MOTIVATION_REQUIRED/)
    await rpc('dcmp', 'select record_review($1,$2,$3,$4)', [TENDER, 'AVIS_NON_OBJECTION', 'DEFAVORABLE', 'Critères insuffisamment précis'])
    assert.equal(await phase(), 'PHASE_2_REDACTION')
    const [doc] = await q('select is_locked, circuit_statut from tender_documents where id=$1', [U._doc])
    assert.deepEqual({ ...doc }, { is_locked: false, circuit_statut: 'REDACTION' })
    // nouvelle boucle de validation puis avis favorable
    await rpc('sd', `update tender_documents set circuit_statut='RELECTURE_CPM' where id=$1`, [U._doc])
    await rpc('prm', `update tender_documents set circuit_statut='VALIDE_PRM' where id=$1`, [U._doc])
    await advance('cpm', 'FINALISER_DAO')
    await rpc('dcmp', 'select record_review($1,$2,$3)', [TENDER, 'AVIS_NON_OBJECTION', 'FAVORABLE'])
    assert.equal(await phase(), 'PHASE_4_PUBLICATION')
  })

  test('Phases 4-5 : publication horodatée, délai minimal AOO (30 j) imposé', async () => {
    assert.equal(await advance('cpm', 'PUBLIER_AO'), 'PHASE_5_CLARIFICATIONS')
    const [t] = await q('select date_publication from tenders where id=$1', [TENDER])
    assert.ok(t.date_publication)
    const [doc] = await q('select circuit_statut, is_locked from tender_documents where id=$1', [U._doc])
    assert.deepEqual({ ...doc }, { circuit_statut: 'PUBLIE', is_locked: true })
    await assert.rejects(advance('cpm', 'OUVRIR_DEPOT'), /GUARD_PHASE_5/)          // ni date limite ni clé
    await rpc('cpm', `update tenders set date_limite_depot = now() + interval '10 days', bid_public_key='AAAA', bid_key_fingerprint=$2 where id=$1`, [TENDER, hex('a')])
    await assert.rejects(advance('cpm', 'OUVRIR_DEPOT'), /délai minimal de 30 jours/)
    await rpc('cpm', `update tenders set date_limite_depot = now() + interval '31 days' where id=$1`, [TENDER])
    await assert.rejects(rpc('prm', `update tenders set title='Nouveau titre du marché' where id=$1`, [TENDER]), /LOCKED_COLUMNS/)
  })

  test('Phase 5 : questions-réponses diffusées à tous les candidats', async () => {
    await rpc('b1', `insert into clarifications (tender_id, institution_id, question) values ($1,$2,'Quelle est la garantie de soumission exigée ?')`, [TENDER, INST])
    const [c] = await q('select id from clarifications limit 1')
    assert.equal((await rpc('b2', 'select * from v_clarifications_publiques')).length, 0, 'question non publiée invisible des autres')
    await rpc('cpm', `update clarifications set reponse='Garantie de 1 %.' where id=$1`, [c.id])
    const pub = await rpc('b2', 'select * from v_clarifications_publiques')
    assert.equal(pub.length, 1, 'réponse diffusée')
    assert.ok(!('auteur_id' in pub[0]), "l'auteur de la question n'est pas divulgué")
    await assert.rejects(rpc('cpm', `update clarifications set question='Autre' where id=$1`, [c.id]), /IMMUTABLE_RECORD/)
  })

  test('Phase 6 : dépôt chiffré, accusé de réception, confidentialité avant ouverture', async () => {
    assert.equal(await advance('cpm', 'OUVRIR_DEPOT'), 'PHASE_6_DEPOT_OFFRES')
    const submit = (k, tech = 'a', fin = 'b', prefix) => rpc(k, 'select submit_bid($1,$2,$3,$4,$5) as r',
      [TENDER, `${prefix ?? `${TENDER}/${U[k]}`}/tech.json`, hex(tech), `${prefix ?? `${TENDER}/${U[k]}`}/fin.json`, hex(fin)]).then(r => r[0].r)
    await assert.rejects(submit('b1', 'a', 'b', `${TENDER}/${U.b2}`), /INVALID_PATH/)
    await assert.rejects(rpc('b1', 'select submit_bid($1,$2,$3,$4,$5)', [TENDER, `${TENDER}/${U.b1}/t`, 'zz', `${TENDER}/${U.b1}/f`, hex('b')]), /INVALID_HASH/)
    await assert.rejects(rpc('prm', 'select submit_bid($1,$2,$3,$4,$5)', [TENDER, 'x', hex('a'), 'y', hex('b')]), /FORBIDDEN/)
    const r1 = await submit('b1'); assert.equal(r1.ok, true); assert.match(r1.receipt, /^[0-9a-f]{64}$/)
    const r1b = await submit('b1', 'c', 'd'); assert.equal(r1b.ok, true, 'remplacement avant la date limite')
    assert.equal(r1b.bid_id, r1.bid_id)
    assert.equal((await submit('b2')).ok, true)
    // confidentialité : personne ne voit les offres avant l'ouverture
    for (const k of ['cpm', 'prm', 'admin', 'ev1', 'dcmp', 'arcop']) {
      assert.equal((await rpc(k, 'select id from bids')).length, 0, `${k} ne doit voir aucune offre`)
    }
    assert.equal((await rpc('b1', 'select id from bids')).length, 1, 'un candidat ne voit que la sienne')
    // interdiction d'insérer directement / de falsifier l'horodatage
    await assert.rejects(rpc('b3', `insert into bids (tender_id, institution_id, soumissionnaire_id, status, submitted_at) values ($1,$2,$3,'SOUMISE','2000-01-01')`, [TENDER, INST, U.b3]), /permission denied/)
    await assert.rejects(rpc('b1', `update bids set submitted_at='2000-01-01'`), /BID_LOCKED/)
  })

  test('Phase 7 : clôture du dépôt, offre tardive rejetée et tracée', async () => {
    await rpc('cpm', `insert into commission_members (tender_id, institution_id, user_id, role_commission) values ($1,$2,$3,'PRESIDENT'),($1,$2,$4,'MEMBRE'),($1,$2,$5,'MEMBRE')`, [TENDER, INST, U.ev1, U.ev2, U.ev3])
    await assert.rejects(advance('cpm', 'FERMER_DEPOT'), /GUARD_PHASE_6/)
    await q(`update tenders set date_limite_depot = now() - interval '1 hour' where id=$1`, [TENDER])   // simulation du temps
    assert.equal(await advance('cpm', 'FERMER_DEPOT'), 'PHASE_7_OUVERTURE_PLIS')
    const late = (await rpc('b3', 'select submit_bid($1,$2,$3,$4,$5) as r', [TENDER, `${TENDER}/${U.b3}/t`, hex('a'), `${TENDER}/${U.b3}/f`, hex('b')]))[0].r
    assert.deepEqual({ ok: late.ok, reason: late.reason }, { ok: false, reason: 'LATE' })
    assert.equal((await q(`select status from bids where soumissionnaire_id=$1`, [U.b3]))[0].status, 'RETARDEE')
    assert.equal((await q(`select count(*)::int n from audit_logs where action='BID_REJECTED_LATE'`))[0].n, 1)
  })

  test('Phase 7 : ouverture = double signature (CPM + président), jamais une seule personne', async () => {
    await assert.rejects(rpc('prm', 'select sign_opening($1)', [TENDER]), /FORBIDDEN/)
    await assert.rejects(rpc('ev2', 'select sign_opening($1)', [TENDER]), /FORBIDDEN/)
    const [a] = await rpc('cpm', 'select sign_opening($1) as r', [TENDER])
    assert.deepEqual(a.r, { opened: false, waiting_for: 'PRESIDENT' })
    await assert.rejects(rpc('cpm', 'select sign_opening($1)', [TENDER]), /./)           // pas de double signature du même rôle
    assert.equal(await phase(), 'PHASE_7_OUVERTURE_PLIS')
    const [b] = await rpc('ev1', 'select sign_opening($1) as r', [TENDER])
    assert.equal(b.r.opened, true); assert.equal(b.r.nb_plis, 2)
    assert.equal(await phase(), 'PHASE_8_EVALUATION')
  })

  test('Phase 8 : conformité, notes par évaluateur (recalculées), classement serveur', async () => {
    assert.equal((await rpc('cpm', 'select id from bids')).length, 3, 'le CPM voit les offres après ouverture')
    await assert.rejects(advance('prm', 'FINALISER_EVALUATION'), /UNCHECKED_BIDS/)
    const bids = await q(`select id, soumissionnaire_id from bids where status='SOUMISE'`)
    const amount = { [U.b1]: 50000000, [U.b2]: 60000000 }
    for (const b of bids) {
      await rpc('cpm', `update bids set conformite_admin=true, montant_offre=$2 where id=$1`, [b.id, amount[b.soumissionnaire_id]])
      U['bid_' + b.soumissionnaire_id] = b.id
    }
    await assert.rejects(rpc('b1', `update bids set montant_offre=1 where id=$1`, [U['bid_' + U.b1]]), /BID_LOCKED/)
    await assert.rejects(advance('prm', 'FINALISER_EVALUATION'), /EVALUATION_INCOMPLETE/)

    const grille = notes => JSON.stringify([
      { critere: 'Expérience', ponderation: 40, note: notes[0] }, { critere: 'Méthodologie', ponderation: 35, note: notes[1] }, { critere: 'Moyens', ponderation: 25, note: notes[2] }])
    const evaluate = (k, bid, notes) => rpc(k, `insert into bid_evaluations (tender_id, institution_id, bid_id, evaluateur_id, grille_technique, score_technique)
                                              values ($1,$2,$3,$4,$5::jsonb, 100)`, [TENDER, INST, bid, U[k], grille(notes)])
    await assert.rejects(evaluate('ev1', U['bid_' + U.b1], [41, 30, 20]), /entre 0 et sa pondération/)
    await assert.rejects(evaluate('cpm', U['bid_' + U.b1], [30, 30, 20]), /row-level security/)        // non membre de la commission
    await assert.rejects(rpc('ev1', `insert into bid_evaluations (tender_id, institution_id, bid_id, evaluateur_id, grille_technique) values ($1,$2,$3,$4,'[{"critere":"Autre","ponderation":100,"note":90}]'::jsonb)`,
      [TENDER, INST, U['bid_' + U.b1], U.ev1]), /exactement les critères/)
    for (const e of ['ev1', 'ev2', 'ev3']) { await evaluate(e, U['bid_' + U.b1], [34, 30, 21]); await evaluate(e, U['bid_' + U.b2], [36, 31, 23]) }
    const [ev] = await q('select score_technique from bid_evaluations limit 1')
    assert.ok([85, 90].includes(Number(ev.score_technique)), 'score recalculé côté serveur (pas les 100 injectés)')

    assert.equal(await advance('prm', 'FINALISER_EVALUATION'), 'PHASE_9_ATTRIBUTION_PROVISOIRE')
    const rk = await q('select bid_id, score_technique, score_financier, score_global, rang from bid_rankings order by rang')
    assert.equal(rk[0].bid_id, U['bid_' + U.b1])
    assert.equal(Number(rk[0].score_global), 89.5)       // 0,7×85 + 0,3×100
    assert.equal(Number(rk[1].score_financier), 83.33)   // 50/60
    assert.equal(Number(rk[1].score_global), 88)         // 0,7×90 + 0,3×83,33 = 88,0
    await assert.rejects(q(`update bid_rankings set rang=1`), /IMMUTABLE_RECORD/)
  })

  test('Phase 9 : attribution provisoire (mieux classé, sinon justification)', async () => {
    await assert.rejects(advance('cpm', 'PRONONCER_ATTRIBUTION_PROVISOIRE', { bid_id: U['bid_' + U.b1] }), /FORBIDDEN/)
    await assert.rejects(advance('prm', 'PRONONCER_ATTRIBUTION_PROVISOIRE', { bid_id: U['bid_' + U.b2] }), /JUSTIFICATION_REQUIRED/)
    assert.equal(await advance('prm', 'PRONONCER_ATTRIBUTION_PROVISOIRE', { bid_id: U['bid_' + U.b1] }), 'PHASE_10_RECOURS')
    const [t] = await q('select attributaire_id, montant_attribue, date_fin_recours from tenders where id=$1', [TENDER])
    assert.equal(t.attributaire_id, U.b1); assert.equal(Number(t.montant_attribue), 50000000); assert.ok(t.date_fin_recours)
    assert.equal((await rpc('b2', `select * from notifications where kind='ATTRIBUTION_PROVISOIRE'`)).length, 1, 'candidats notifiés')
    assert.equal((await rpc('b3', `select * from notifications where kind='ATTRIBUTION_PROVISOIRE'`)).length, 0, 'offre tardive non notifiée')
  })

  test('Phase 10 : HARD LOCK — un recours pendant bloque la phase 11, y compris hors application', async () => {
    await assert.rejects(rpc('b1', 'select submit_appeal($1,$2)', [TENDER, 'Je conteste mon propre marché']), /FORBIDDEN/)
    await assert.rejects(rpc('b3', 'select submit_appeal($1,$2)', [TENDER, 'Offre tardive contestée']), /FORBIDDEN/)
    const [{ submit_appeal: appeal }] = await rpc('b2', 'select submit_appeal($1,$2,$3)', [TENDER, 'Note technique sous-évaluée', 'Détail'])
    const [t] = await q('select has_appeal_pending, arcop_decision from tenders where id=$1', [TENDER])
    assert.deepEqual({ ...t }, { has_appeal_pending: true, arcop_decision: 'EN_COURS' })
    await q(`update tenders set date_fin_recours = now() - interval '1 day' where id=$1`, [TENDER])   // le délai est écoulé…
    await assert.rejects(advance('prm', 'CLORE_PERIODE_RECOURS'), /HARD_LOCK_APPEAL/)                 // …mais le recours bloque
    await assert.rejects(q(`update tenders set current_phase='PHASE_11_ATTRIBUTION_DEFINITIVE' where id=$1`, [TENDER]), /HARD_LOCK_APPEAL/)
    await assert.rejects(rpc('prm', 'select decide_appeal($1,$2,$3)', [appeal, 'REJETE', 'Rejet motivé de longueur suffisante']), /FORBIDDEN/)
    await assert.rejects(rpc('arcop', 'select decide_appeal($1,$2)', [appeal, 'REJETE']), /MOTIVATION_REQUIRED/)
    await rpc('arcop', 'select decide_appeal($1,$2)', [appeal, 'EN_INSTRUCTION'])
    await rpc('arcop', 'select decide_appeal($1,$2,$3)', [appeal, 'REJETE', 'Les critères ont été appliqués conformément au DAO.'])
    const [t2] = await q('select has_appeal_pending, arcop_decision from tenders where id=$1', [TENDER])
    assert.deepEqual({ ...t2 }, { has_appeal_pending: false, arcop_decision: 'REJETE' })
    await assert.rejects(rpc('arcop', 'select decide_appeal($1,$2,$3)', [appeal, 'FAVORABLE', 'Tentative de revirement sur décision close']), /INVALID_STATE/)
  })

  test('Phase 11 : clôture du délai de recours, quotas PME calculés, approbation DCMP requise', async () => {
    assert.equal(await advance('prm', 'CLORE_PERIODE_RECOURS'), 'PHASE_11_ATTRIBUTION_DEFINITIVE')
    const [qt] = await q('select montant_total_marches, montant_pme, taux_pme, taux_pme_feminine from pme_quotas_tracking')
    assert.equal(Number(qt.montant_total_marches), 50000000); assert.equal(Number(qt.taux_pme), 100); assert.equal(Number(qt.taux_pme_feminine), 0)
    await assert.rejects(advance('prm', 'CONFIRMER_ATTRIBUTION_DEFINITIVE'), /GUARD_PHASE_11/)
    await rpc('dcmp', 'select record_review($1,$2,$3)', [TENDER, 'APPROBATION_ATTRIBUTION', 'FAVORABLE'])
    assert.equal(await advance('prm', 'CONFIRMER_ATTRIBUTION_DEFINITIVE'), 'PHASE_12_SIGNATURE_CONTRAT')
  })

  test('Phase 12 : contrat, signatures, visa, garantie', async () => {
    await assert.rejects(rpc('prm', `insert into contracts (tender_id, institution_id, bid_id, attributaire_id, montant_initial) values ($1,$2,$3,$4,1)`, [TENDER, INST, U['bid_' + U.b1], U.b1]), /permission denied/)
    const [{ prepare_contract }] = await rpc('prm', 'select prepare_contract($1)', [TENDER])
    U._contract = prepare_contract
    await assert.rejects(advance('prm', 'SIGNER_CONTRAT'), /GUARD_PHASE_12/)
    await assert.rejects(rpc('tresor', 'select visa_contract($1)', [U._contract]), /INVALID_STATE/)
    await assert.rejects(rpc('b2', 'select sign_contract($1)', [U._contract]), /FORBIDDEN/)
    await rpc('b1', 'select sign_contract($1)', [U._contract])
    await rpc('prm', 'select sign_contract($1)', [U._contract])
    await rpc('tresor', 'select visa_contract($1)', [U._contract])
    await assert.rejects(advance('prm', 'SIGNER_CONTRAT'), /garantie de bonne exécution/)
    await rpc('prm', `insert into guarantees (tender_id, institution_id, contract_id, type, montant, emetteur, reference, date_emission, date_expiration)
                      values ($1,$2,$3,'BONNE_EXECUTION',2500000,'Banque X','GBE-001', current_date, current_date + 365)`, [TENDER, INST, U._contract])
    assert.equal(await advance('prm', 'SIGNER_CONTRAT'), 'PHASE_13_EXECUTION')
  })

  test('Phase 13 : plafonds avenants 30 % et sous-traitance 40 % bloqués par la base', async () => {
    const amend = (n, m) => rpc('prm', `insert into contract_amendments (contract_id, tender_id, institution_id, numero_avenant, motif, montant_avenant) values ($1,$2,$3,$4,'Travaux supplémentaires',$5)`, [U._contract, TENDER, INST, n, m])
    await amend(1, 10000000)                                                                         // 20 %
    await assert.rejects(amend(2, 6000000), /AVENANT_LIMIT_EXCEEDED/)                                // 32 %
    await amend(2, 5000000)                                                                          // 30 % pile : autorisé
    await assert.rejects(amend(3, 1), /AVENANT_LIMIT_EXCEEDED/)
    await amend(3, -8000000)                                                                         // avenant en moins : autorisé mais ne « recharge » pas le plafond
    await assert.rejects(amend(4, 1000000), /AVENANT_LIMIT_EXCEEDED/)
    const [c] = await q('select montant_actuel from contracts where id=$1', [U._contract])
    assert.equal(Number(c.montant_actuel), 50000000 + 10000000 + 5000000 - 8000000)
    assert.equal(await rpc('prm', `select record_blocked_attempt('AVENANT',$1,1000000) as r`, [U._contract]).then(r => r[0].r), true)
    assert.equal((await q(`select count(*)::int n from audit_logs where action='AVENANT_SEUIL_DEPASSE'`))[0].n, 1)
    assert.equal(await rpc('prm', `select record_blocked_attempt('AVENANT',$1,-5) as r`, [U._contract]).then(r => r[0].r), false, 'pas de faux positif dans le journal')

    const sub = m => rpc('prm', `insert into subcontractors (contract_id, tender_id, institution_id, nom_sous_traitant, objet, montant) values ($1,$2,$3,'Sous-traitant SA','Lot électricité',$4)`, [U._contract, TENDER, INST, m])
    await sub(15000000)
    await assert.rejects(sub(5000001), /SUBCONTRACTOR_LIMIT_EXCEEDED/)
    await sub(5000000)                                                                                // 40 % pile
  })

  test('Phase 13-14 : décomptes plafonnés, réception provisoire puis définitive', async () => {
    const pay = (n, m) => rpc('b1', `insert into payment_statements (contract_id, tender_id, institution_id, numero, type, montant, soumis_par) values ($1,$2,$3,$4,'ACOMPTE',$5,$6) returning id`, [U._contract, TENDER, INST, n, m, U.b1])
    const [p1] = await pay(1, 20000000)
    await assert.rejects(pay(2, 40000000), /PAYMENT_EXCEEDS_CONTRACT/)
    await assert.rejects(rpc('cpm', `update payment_statements set statut='PAYE' where id=$1`, [p1.id]), /FORBIDDEN/)
    await rpc('cpm', `update payment_statements set statut='VALIDE_AC' where id=$1`, [p1.id])
    await rpc('tresor', `update payment_statements set statut='VISA_CF' where id=$1`, [p1.id])
    await rpc('tresor', `update payment_statements set statut='PAYE' where id=$1`, [p1.id])
    await assert.rejects(rpc('tresor', `update payment_statements set montant=1 where id=$1`, [p1.id]), /IMMUTABLE_RECORD/)

    await assert.rejects(advance('prm', 'CONSTATER_RECEPTION_PROVISOIRE'), /GUARD_PHASE_13/)
    const rec = t => rpc('prm', `insert into receptions (contract_id, tender_id, institution_id, type, statut) values ($1,$2,$3,$4,'ACCEPTEE')`, [U._contract, TENDER, INST, t])
    await assert.rejects(rec('DEFINITIVE'), /RECEPTION_ORDER/)
    await rec('PROVISOIRE')
    assert.equal(await advance('prm', 'CONSTATER_RECEPTION_PROVISOIRE'), 'PHASE_14_RECEPTION_PAIEMENT')
    await rec('DEFINITIVE')
  })

  test('Phase 15 : clôture, archivage, marché figé', async () => {
    await assert.rejects(advance('prm', 'CONSTATER_RECEPTION_DEFINITIVE').then(() => rpc('prm', 'select archive_tender($1)', [TENDER])), /PROVIDER_EVALUATION_REQUIRED/)
    assert.equal(await phase(), 'PHASE_15_CLOTURE_ARCHIVAGE')
    await rpc('prm', `insert into provider_evaluations (contract_id, tender_id, institution_id, prestataire_id, note_qualite, note_delai, note_cout)
                      values ($1,$2,$3,$4,8,7,9)`, [U._contract, TENDER, INST, U.b1])
    const [{ archive_tender }] = await rpc('prm', 'select archive_tender($1)', [TENDER])
    const [a] = await q('select manifest_hash, retention_until, audit_head_hash from archives where id=$1', [archive_tender])
    assert.match(a.manifest_hash, /^[0-9a-f]{64}$/); assert.ok(a.audit_head_hash)
    await assert.rejects(q(`update tenders set title='Falsification a posteriori' where id=$1`, [TENDER]), /CLOSED_TENDER/)
    await assert.rejects(q('delete from archives'), /IMMUTABLE_RECORD/)
    await assert.rejects(rpc('prm', 'select archive_tender($1)', [TENDER]), /ALREADY_ARCHIVED/)
  })

  test('Audit : la chaîne est intègre, et toute altération est détectée', async () => {
    const ok = await rpc('dcmp', 'select * from verify_audit_chain($1)', [INST])
    assert.deepEqual(ok, [], 'chaîne intacte')
    const [{ n }] = await q('select count(*)::int n from audit_logs where institution_id=$1', [INST])
    assert.ok(n > 50, `journal riche (${n} lignes)`)
    assert.ok((await q(`select 1 from audit_logs where action='PHASE_TRANSITION' limit 1`)).length === 1)
    // Un administrateur de base de données qui désactiverait le trigger et modifierait une ligne serait détecté :
    await q('alter table audit_logs disable trigger trig_audit_no_update_delete')
    await q(`update audit_logs set new_value='{"falsifie":true}'::jsonb where id=(select id from audit_logs where institution_id=$1 order by seq offset 5 limit 1)`, [INST])
    await q('alter table audit_logs enable trigger trig_audit_no_update_delete')
    const broken = await rpc('dcmp', 'select * from verify_audit_chain($1)', [INST])
    assert.ok(broken.length >= 1 && broken[0].reason === 'CONTENU_ALTERE')
  })
})

describe('Recours favorable : reprise de la procédure', () => {
  test('une décision favorable renvoie le marché en évaluation (nouvelle ronde)', async () => {
    // Nouveau marché minimal amené jusqu'en phase 10 par le propriétaire de la base (simulation de scénario)
    const [t] = await q(`insert into tenders (institution_id, title, nature_marche, montant_estime, ligne_budgetaire, ppm_annee, mode_passation, current_phase, evaluation_round, date_limite_depot, date_fin_recours)
                         values ($1,'Marché pour test recours favorable','FOURNITURES',80000000,'1',2026,'AOO','PHASE_10_RECOURS',1, now() - interval '5 days', now() + interval '5 days') returning id`, [INST])
    const [bid] = await q(`insert into bids (tender_id, institution_id, soumissionnaire_id, status, montant_offre) values ($1,$2,$3,'EVALUEE',1000) returning id`, [t.id, INST, U.b2])
    const [bid1] = await q(`insert into bids (tender_id, institution_id, soumissionnaire_id, status, montant_offre) values ($1,$2,$3,'PROVISOIREMENT_RETENUE',900) returning id`, [t.id, INST, U.b1])
    await q(`update tenders set attributaire_id=$2, attributaire_bid_id=$3, montant_attribue=900 where id=$1`, [t.id, U.b1, bid1.id])
    const [{ submit_appeal: ap }] = await rpc('b2', 'select submit_appeal($1,$2)', [t.id, "Erreur manifeste d'appréciation"])
    await rpc('arcop', 'select decide_appeal($1,$2,$3)', [ap, 'FAVORABLE', "Erreur d'appréciation établie, reprise de l'évaluation."])
    const [after] = await q('select current_phase, evaluation_round, attributaire_id, has_appeal_pending from tenders where id=$1', [t.id])
    assert.deepEqual({ ...after }, { current_phase: 'PHASE_8_EVALUATION', evaluation_round: 2, attributaire_id: null, has_appeal_pending: false })
    assert.equal((await q(`select status from bids where id=$1`, [bid.id]))[0].status, 'CONFORME')
  })
})

describe('Données de référence et reporting', () => {
  test('modèles, clauses et grilles types chargés ; chaque grille somme à 100', async () => {
    const [{ tdr }] = await q(`select count(*)::int tdr from document_templates where type='TDR'`)
    const [{ dao }] = await q(`select count(*)::int dao from document_templates where type='DAO'`)
    const [{ ev }] = await q(`select count(*)::int ev from evaluation_templates`)
    assert.equal(tdr, 12); assert.equal(dao, 6); assert.equal(ev, 12)
    const [{ cl }] = await q(`select count(*)::int cl from clause_templates where obligatoire`)
    assert.ok(cl >= 8)
  })

  test('vues de reporting : pipeline, délais par phase, quotas, alertes', async () => {
    const pipeline = await rpc('prm', 'select current_phase, nb_marches from v_pipeline_phases')
    assert.ok(pipeline.length >= 2)
    const delais = await rpc('prm', `select phase, jours_moyens from v_delais_moyens_phase where phase = 'PHASE_1_PROGRAMMATION'`)
    assert.equal(delais.length, 1)
    const quotas = await rpc('prm', 'select taux_pme, objectif_pme, objectif_pme_atteint from v_quotas_pme')
    assert.equal(Number(quotas[0].objectif_pme), 5); assert.equal(quotas[0].objectif_pme_atteint, true)
    await rpc('dcmp', 'select * from v_stats_recours')
    await rpc('prm', 'select * from v_alertes')
  })

  test('isolation multi-institutions : une autre institution ne voit rien', async () => {
    const other = (await q(`insert into institutions (code, name, type) values ('AUTRE', 'Autre ministère', 'ETAT') returning id`))[0].id
    await mkUser('prm2', 'PRM', other)
    assert.equal((await rpc('prm2', 'select id from tenders')).length, 0)
    assert.equal((await rpc('prm2', 'select * from v_pipeline_phases')).length, 0)
    assert.equal((await rpc('prm2', 'select id from audit_logs where institution_id=$1', [INST])).length, 0, "journal d'une autre institution invisible")
    await assert.rejects(rpc('prm2', 'select advance_phase($1,$2)', [TENDER, 'VALIDER_PPM']), /FORBIDDEN|TENDER_NOT_FOUND|INVALID_TRANSITION/)
    assert.ok((await rpc('dcmp', 'select id from tenders')).length >= 1, 'les régulateurs voient tout')
    await assert.rejects(rpc('prm', 'select * from verify_audit_chain($1)', [INST]), /FORBIDDEN/)
  })
})

describe('Procédure infructueuse et relance', () => {
  let T
  const adv = (key, payload) => rpc(key, 'select advance_phase($1,$2,$3::jsonb) as p', [T, 'DECLARER_INFRUCTUEUX', JSON.stringify(payload)])
  test('déclaration motivée par le PRM uniquement, clôture sans contrat, archivage sans évaluation de prestataire', async () => {
    T = (await q(`insert into tenders (institution_id, title, nature_marche, montant_estime, ligne_budgetaire, ppm_annee, mode_passation, current_phase, date_limite_depot)
                  values ($1,'Marché sans offre recevable','FOURNITURES',80000000,'1',2026,'AOO','PHASE_8_EVALUATION', now() - interval '3 days') returning id`, [INST]))[0].id
    await assert.rejects(adv('cpm', { motif: 'Aucune offre conforme aux spécifications du dossier' }), /FORBIDDEN/)
    await assert.rejects(adv('prm', { motif: 'trop court' }), /MOTIVATION_REQUIRED/)
    assert.equal((await adv('prm', { motif: 'Aucune offre conforme aux spécifications du dossier' }))[0].p, 'PHASE_15_CLOTURE_ARCHIVAGE')
    const [t] = await q('select issue, closed_at from tenders where id=$1', [T])
    assert.equal(t.issue, 'INFRUCTUEUX'); assert.ok(t.closed_at)
    await rpc('prm', 'select archive_tender($1)', [T])
  })

  test('refusée si une offre qualifiée est classée ; issue non modifiable directement', async () => {
    const t2 = (await q(`insert into tenders (institution_id, title, nature_marche, montant_estime, ligne_budgetaire, ppm_annee, mode_passation, current_phase)
                         values ($1,'Marché avec offre classée','FOURNITURES',80000000,'1',2026,'AOO','PHASE_8_EVALUATION') returning id`, [INST]))[0].id
    const bid = (await q(`insert into bids (tender_id, institution_id, soumissionnaire_id, status, montant_offre) values ($1,$2,$3,'EVALUEE',1000) returning id`, [t2, INST, U.b1]))[0].id
    await q(`insert into bid_rankings (tender_id, institution_id, round, bid_id, montant_offre, score_technique, score_financier, score_global, qualifie, rang) values ($1,$2,1,$3,1000,80,100,86,true,1)`, [t2, INST, bid])
    await assert.rejects(rpc('prm', 'select advance_phase($1,$2,$3::jsonb)', [t2, 'DECLARER_INFRUCTUEUX', JSON.stringify({ motif: 'Tentative injustifiée de clôture de la procédure' })]), /GUARD_INFRUCTUEUX/)
    await assert.rejects(rpc('prm', `update tenders set issue='INFRUCTUEUX' where id=$1`, [t2]), /LOCKED_COLUMNS/)
  })

  test('relance : nouveau marché en phase 1, un seul par marché infructueux', async () => {
    await assert.rejects(rpc('cpm', 'select relancer_marche($1)', [T]), /FORBIDDEN/)
    const [{ relancer_marche: n }] = await rpc('prm', 'select relancer_marche($1)', [T])
    const [nt] = await q('select current_phase, relance_de, title, reference from tenders where id=$1', [n])
    assert.equal(nt.current_phase, 'PHASE_1_PROGRAMMATION'); assert.equal(nt.relance_de, T)
    await assert.rejects(rpc('prm', 'select relancer_marche($1)', [T]), /ALREADY_RELAUNCHED/)
    await assert.rejects(rpc('prm', 'select relancer_marche($1)', [n]), /INVALID_STATE/)
  })
})

describe('Étanchéité : ce qu’un candidat étranger au marché peut lire', () => {
  const ALLOWED = new Set(['config_seuils', 'corps_metiers', 'catalog_attribute_defs', 'phase_transitions'])   // données de référence publiques
  test('aucune table interne n’expose de ligne à un utilisateur sans lien avec les marchés', async () => {
    await mkUser('outsider', 'SOUMISSIONNAIRE', null)
    const tables = (await q(`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','v') order by 1`)).map(r => r.relname)
    const leaks = []
    for (const t of tables) {
      if (ALLOWED.has(t) || t === 'users') continue
      let rows
      try { rows = await rpc('outsider', `select count(*)::int n from ${t}`) } catch { continue }   // permission refusée = étanche
      if (rows[0].n > 0 && !['v_stats_publiques', 'v_avis_publics', 'v_audit_anchors'].includes(t) && !t.startsWith('v_public_')) leaks.push(`${t}: ${rows[0].n}`)
    }
    assert.deepEqual(leaks, [])
    const self = await rpc('outsider', 'select id from users')
    assert.deepEqual(self.map(r => r.id), [U.outsider], 'un candidat ne voit que son propre profil')
  })

  test('un candidat ayant déposé ne voit que ses propres lignes, jamais celles des concurrents', async () => {
    for (const t of ['bids', 'appeals', 'notifications', 'dossier_retraits', 'clarifications', 'bid_rankings']) {
      const mine = await rpc('b2', `select * from ${t}`)
      for (const row of mine) {
        const owner = row.soumissionnaire_id ?? row.requerant_id ?? row.user_id ?? row.auteur_id
        if (owner) assert.equal(owner, U.b2, `${t} : ligne d'un autre candidat visible`)
      }
    }
    // les montants et notes des concurrents ne sont pas lisibles avant l'attribution provisoire
    assert.equal((await rpc('b3', 'select * from bid_evaluations')).length, 0)
    assert.equal((await rpc('b3', 'select * from bid_openings')).length, 0)
  })
})
