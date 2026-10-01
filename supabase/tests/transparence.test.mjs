// Transparence et intégrité : publication OCDS (validée contre le schéma officiel 1.1.5), vues publiques à publicité
// graduée, alertes de risque, signalements citoyens, ancrage du journal d'audit.
import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import Ajv from 'ajv-draft-04'
import addFormats from 'ajv-formats'
import { createDb, asUser, asAnon, asService } from './harness.mjs'

const fixtures = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures')
const ajv = new Ajv({ strict: false, allErrors: true })
addFormats(ajv)
const validateRelease = ajv.compile(JSON.parse(readFileSync(join(fixtures, 'release-schema.json'), 'utf8')))
const packageSchema = JSON.parse(readFileSync(join(fixtures, 'release-package-schema.json'), 'utf8'))
const validatePackage = ajv.compile({ ...packageSchema, properties: { ...packageSchema.properties, releases: { type: 'array', items: { type: 'object' } } } })

let db, INST, INST2
const U = {}
const T = {}
const q = (sql, params) => db.query(sql, params).then(r => r.rows)
const rpc = (key, sql, params) => asUser(db, U[key], () => q(sql, params))
const anon = (sql, params) => asAnon(db, () => q(sql, params))

async function mkUser(key, role, inst, createdAt = null) {
  const id = randomUUID()
  await q('insert into auth.users (id, email) values ($1, $2)', [id, `${key}@tr.sn`])
  await q('update users set role=$2, institution_id=$3, full_name=$4, ninea=$5 where id=$1', [id, role, inst, key.toUpperCase() + ' SARL', role === 'SOUMISSIONNAIRE' ? '70' + key.length + '1234' : null])
  if (createdAt) await q(`update users set created_at = now() - interval '${createdAt}' where id=$1`, [id])
  U[key] = id
}

const tender = async (key, phase, extra = {}) => {
  const f = { title: `Marché ${key} pour essai de transparence`, nature: 'FOURNITURES', montant: 80000000, mode: 'AOO', published: true, limite: "now() - interval '5 days'", pubAt: "now() - interval '40 days'", ...extra }
  const [t] = await q(`insert into tenders (institution_id, title, nature_marche, montant_estime, ligne_budgetaire, ppm_annee, mode_passation, current_phase, date_publication, date_limite_depot, is_alloti, issue)
                       values ($1,$2,$3,$4,'1.2.3',2026,$5,$6, ${f.published ? f.pubAt : 'null'}, ${f.limite}, ${!!f.alloti}, $7) returning id, reference`, [INST, f.title, f.nature, f.montant, f.mode, phase, f.issue ?? null])
  T[key] = t.id
  return t.id
}

const award = async (id, winner, montant, status = 'PROVISOIREMENT_RETENUE') => {
  const bid = (await q(`insert into bids (tender_id, institution_id, soumissionnaire_id, status, montant_offre, submitted_at) values ($1,$2,$3,$4,$5, now() - interval '10 days') returning id`, [id, INST, U[winner], status, montant]))[0].id
  await q(`insert into bid_rankings (tender_id, institution_id, round, bid_id, montant_offre, score_technique, score_financier, score_global, qualifie, rang) values ($1,$2,1,$3,$4,85,100,89.5,true,1)`, [id, INST, bid, montant])
  await q(`update tenders set attributaire_id=$2, attributaire_bid_id=$3, montant_attribue=$4, date_attribution_provisoire = now() - interval '2 days', date_fin_recours = now() + interval '8 days' where id=$1`, [id, U[winner], bid, montant])
  return bid
}

before(async () => {
  db = await createDb()
  INST = (await q(`insert into institutions (code, name, type) values ('TRN', 'Ministère de la Transparence', 'ETAT') returning id`))[0].id
  INST2 = (await q(`insert into institutions (code, name, type) values ('AUT', 'Autre autorité', 'ETAT') returning id`))[0].id
  await mkUser('prm', 'PRM', INST); await mkUser('prm2', 'PRM', INST2)
  await mkUser('dcmp', 'DCMP', null); await mkUser('arcop', 'ARCOP', null)
  await mkUser('b1', 'SOUMISSIONNAIRE', null)                       // compte récent
  await mkUser('b2', 'SOUMISSIONNAIRE', null, '2 years')             // compte ancien
  await mkUser('b3', 'SOUMISSIONNAIRE', null, '2 years')

  await tender('inedit', 'PHASE_2_REDACTION', { published: false })
  await tender('publie', 'PHASE_5_CLARIFICATIONS', { limite: "now() + interval '20 days'", pubAt: "now() - interval '10 days'" })
  // Marchés attribués au même fournisseur b1 (gagnant récurrent) ; le premier cumule plusieurs signaux de risque.
  await tender('attribue', 'PHASE_10_RECOURS', { limite: "now() - interval '30 days'", pubAt: "now() - interval '40 days'" })   // délai de 10 jours
  await award(T.attribue, 'b1', 95000000)
  await q(`select write_audit('AWARD_OVERRIDE_RANKING','tender',$1,$2,null,null,null)`, [T.attribue, INST])
  for (const k of ['attribue2', 'attribue3']) { await tender(k, 'PHASE_11_ATTRIBUTION_DEFINITIVE', { limite: "now() - interval '10 days'" }); await award(T[k], 'b1', 70000000) }
  // Marché sain : deux offres, délai de 30 jours, gagnant ancien, prix conforme
  await tender('sain', 'PHASE_10_RECOURS', { limite: "now() - interval '10 days'", pubAt: "now() - interval '40 days'" })
  await award(T.sain, 'b2', 70000000)
  await q(`insert into bids (tender_id, institution_id, soumissionnaire_id, status, montant_offre) values ($1,$2,$3,'EVALUEE',75000000)`, [T.sain, INST, U.b1])
  // Exécution : contrat, avenants à 25 % (proche du plafond de 30 %), paiement effectué
  await tender('execution', 'PHASE_13_EXECUTION', { limite: "now() - interval '60 days'", pubAt: "now() - interval '95 days'" })
  const bid = await award(T.execution, 'b2', 100000000)
  const c = (await q(`insert into contracts (tender_id, institution_id, bid_id, attributaire_id, montant_initial, montant_actuel, signed_by_ac, signed_by_titulaire, signature_ac_at, signature_titulaire_at, visa_controleur, date_debut_execution, delai_execution)
                      values ($1,$2,$3,$4,100000000,125000000,true,true,now(),now(),true,current_date,90) returning id`, [T.execution, INST, bid, U.b2]))[0].id
  await q(`alter table contract_amendments disable trigger trig_check_amendment_limit`)
  await q(`insert into contract_amendments (contract_id, tender_id, institution_id, numero_avenant, motif, montant_avenant) values ($1,$2,$3,1,'Travaux complémentaires',25000000)`, [c, T.execution, INST])
  await q(`alter table contract_amendments enable trigger trig_check_amendment_limit`)
  await q(`insert into payment_statements (contract_id, tender_id, institution_id, numero, type, montant, statut, date_paiement) values ($1,$2,$3,1,'ACOMPTE',30000000,'PAYE', now())`, [c, T.execution, INST])
  await tender('infructueux', 'PHASE_15_CLOTURE_ARCHIVAGE', { issue: 'INFRUCTUEUX' })
  // Marché alloti : deux lots attribués à deux fournisseurs
  await tender('alloti', 'PHASE_10_RECOURS', { alloti: true, limite: "now() - interval '10 days'" })
  const lots = await q(`insert into tender_lots (tender_id, institution_id, numero_lot, libelle, montant_estime, statut, attributaire_id, montant_attribue) values ($1,$2,1,'Lot 1',40000000,'ATTRIBUE',$3,38000000),($1,$2,2,'Lot 2',40000000,'ATTRIBUE',$4,39000000) returning id`, [T.alloti, INST, U.b3, U.b3])
  await q(`update tenders set montant_attribue=77000000, date_attribution_provisoire=now() where id=$1`, [T.alloti])
  T.lots = lots.map(l => l.id)
})

test('OCDS : chaque release publiée est valide au regard du schéma officiel 1.1.5', async () => {
  const keys = ['publie', 'attribue', 'sain', 'execution', 'infructueux', 'alloti']
  for (const k of keys) {
    const [{ r }] = await anon('select ocds_release($1) as r', [T[k]])
    assert.ok(r, `release absente pour ${k}`)
    const ok = validateRelease(r)
    assert.ok(ok, `${k} invalide : ${JSON.stringify(validateRelease.errors?.slice(0, 3))}`)
    assert.match(r.ocid, /^ocds-sn-MP-TRN-\d{4}-\d{4}$/)
    assert.equal(r.tender.value.currency, 'XOF')
  }
  assert.equal((await anon('select ocds_release($1) as r', [T.inedit]))[0].r, null, 'un marché non publié n’a pas de release')
})

test('OCDS : publicité graduée — rien sur les candidats avant l’attribution, contrat seulement après la signature', async () => {
  const rel = async k => (await anon('select ocds_release($1) as r', [T[k]]))[0].r
  const publie = await rel('publie')
  assert.equal(publie.tender.status, 'active'); assert.equal(publie.tender.tenderers, undefined); assert.equal(publie.awards, undefined)
  assert.equal(publie.parties.length, 1)
  const attribue = await rel('attribue')
  assert.equal(attribue.tender.status, 'complete'); assert.equal(attribue.awards.length, 1); assert.equal(attribue.awards[0].value.amount, 95000000)
  assert.equal(attribue.contracts, undefined); assert.ok(attribue.tag.includes('award'))
  assert.ok(attribue.parties.some(p => p.roles.includes('supplier')))
  const exec = await rel('execution')
  assert.equal(exec.contracts.length, 1); assert.equal(exec.contracts[0].amendments.length, 1)
  assert.equal(exec.contracts[0].implementation.transactions[0].value.amount, 30000000)
  assert.equal(exec.contracts[0].status, 'active'); assert.ok(exec.tag.includes('implementation'))
  const infr = await rel('infructueux'); assert.equal(infr.tender.status, 'unsuccessful'); assert.equal(infr.awards, undefined)
  const alloti = await rel('alloti'); assert.equal(alloti.tender.lots.length, 2); assert.equal(alloti.awards.length, 2)
  assert.deepEqual(alloti.awards.map(a => a.relatedLots[0]).sort(), [...T.lots].sort())
})

test('OCDS : paquet de releases valide, paginé par date de mise à jour, sans donnée interne', async () => {
  const [{ p }] = await anon(`select ocds_release_package('https://exemple.sn/api/ocds/releases', 3) as p`)
  assert.ok(validatePackage(p), JSON.stringify(validatePackage.errors?.slice(0, 3)))
  assert.equal(p.releases.length, 3)
  for (const r of p.releases) assert.ok(validateRelease(r))
  const last = p.releases[2].date
  const [{ p: next }] = await anon(`select ocds_release_package('https://x', 100, $1::timestamptz) as p`, [last])
  assert.ok(next.releases.every(r => r.date > last))
  const text = JSON.stringify(p)
  for (const secret of ['bid_public_key', 'fichier_', 'timestamp_token', 'motif_non_conformite', '@tr.sn']) assert.ok(!text.includes(secret), `fuite : ${secret}`)
})

test('portail public : vues à publicité graduée, aucune table interne exposée', async () => {
  const marches = await anon('select id, montant_attribue, nb_offres from v_public_marches')
  assert.ok(!marches.some(m => m.id === T.inedit), 'marché non publié invisible')
  assert.equal(marches.find(m => m.id === T.publie).montant_attribue, null)
  assert.equal(marches.find(m => m.id === T.publie).nb_offres, null)
  assert.equal(Number(marches.find(m => m.id === T.attribue).montant_attribue), 95000000)
  assert.equal(marches.find(m => m.id === T.sain).nb_offres, 2)
  assert.equal((await anon('select * from v_public_offres where tender_id=$1', [T.publie])).length, 0)
  assert.ok((await anon('select * from v_public_offres where tender_id=$1', [T.attribue])).length >= 1)
  assert.equal((await anon('select * from v_public_contrats where tender_id=$1', [T.attribue])).length, 0, 'pas de contrat avant la phase 12')
  const [ct] = await anon('select * from v_public_contrats where tender_id=$1', [T.execution])
  assert.equal(Number(ct.montant_paye), 30000000); assert.equal(Number(ct.avenants_cumules), 25000000)
  for (const t of ['tenders', 'bids', 'users', 'contracts', 'audit_logs']) assert.equal((await anon(`select * from ${t}`)).length, 0, `${t} lisible par un anonyme`)
  await assert.rejects(anon('select * from v_red_flags'), /permission denied/)
})

test('alertes de risque : signaux attendus, périmètre par institution, qualification par les régulateurs', async () => {
  const flags = async key => (await rpc(key, 'select tender_id, flag from v_red_flags')).reduce((m, r) => ((m[r.tender_id] ??= new Set()).add(r.flag), m), {})
  const dc = await flags('dcmp')
  const a = dc[T.attribue]
  for (const f of ['OFFRE_UNIQUE', 'DELAI_COURT', 'ATTRIBUTION_HORS_CLASSEMENT', 'PRIX_SUPERIEUR_ESTIMATION', 'GAGNANT_RECURRENT', 'NOUVEAU_FOURNISSEUR']) assert.ok(a.has(f), `${f} attendu`)
  assert.ok(dc[T.execution].has('AVENANTS_PROCHES_PLAFOND'))
  assert.equal(dc[T.sain], undefined, 'un marché sain ne déclenche aucune alerte')
  assert.deepEqual(await flags('prm2'), {}, 'une autre institution ne voit aucune alerte')
  assert.ok((await flags('prm'))[T.attribue], 'l’institution voit ses propres alertes')
  const top = await rpc('dcmp', 'select tender_id, score from v_risk_scores order by score desc')
  assert.equal(top[0].tender_id, T.attribue)

  await assert.rejects(rpc('prm', 'select review_red_flag($1,$2,$3,$4)', [T.attribue, 'OFFRE_UNIQUE', 'JUSTIFIE', 'Je valide moi-même mon marché']), /FORBIDDEN/)
  await rpc('prm', 'select review_red_flag($1,$2,$3,$4)', [T.attribue, 'OFFRE_UNIQUE', 'EXPLICATION', 'Un seul fournisseur homologué sur ce segment.'])
  await assert.rejects(rpc('dcmp', 'select review_red_flag($1,$2,$3,$4)', [T.attribue, 'INCONNUE', 'CONFIRME', 'Alerte inexistante sur ce marché']), /FLAG_UNKNOWN/)
  await rpc('dcmp', 'select review_red_flag($1,$2,$3,$4)', [T.attribue, 'OFFRE_UNIQUE', 'CONFIRME', 'Explication jugée insuffisante, transmis à l’ARCOP.'])
  assert.equal((await rpc('arcop', 'select * from red_flag_reviews where tender_id=$1', [T.attribue])).length, 2)
  assert.equal((await rpc('prm2', 'select * from red_flag_reviews')).length, 0)
  await assert.rejects(q(`update red_flag_reviews set note='falsifié'`), /IMMUTABLE_RECORD/)
})

test('signalements citoyens : dépôt anonyme, code de suivi, débit limité, lecture réservée aux régulateurs', async () => {
  const submit = (ref, cat, desc, contact = null, tender = null) => anon('select submit_citizen_report($1,$2,$3,$4,$5) as r', [tender, ref, cat, desc, contact]).then(r => r[0].r)
  const long = 'Le dossier d’appel d’offres semble taillé sur mesure pour un fournisseur.'
  const ref = (await q('select reference from tenders where id=$1', [T.attribue]))[0].reference
  const ok = await submit(ref.toLowerCase(), 'FAVORITISME', long)
  assert.equal(ok.ok, true); assert.equal(ok.marche_identifie, true); assert.match(ok.code_suivi, /^[0-9A-F]{10}$/)
  const inconnu = await submit('MP-XXX-0000-0000', 'AUTRE', long)
  assert.equal(inconnu.marche_identifie, false)
  assert.equal((await submit(null, 'AUTRE', long, null, T.inedit)).marche_identifie, false, 'un marché non publié ne peut pas être ciblé')
  await assert.rejects(submit(ref, 'FAVORITISME', 'trop court'), /check|violates/i)
  await assert.rejects(submit(ref, 'N_IMPORTE_QUOI', long), /check|violates/i)

  assert.equal((await anon('select * from citizen_reports')).length, 0, 'un anonyme ne relit pas les signalements')
  await assert.rejects(anon(`insert into citizen_reports (code_suivi, categorie, description) values ('X','AUTRE','${long}')`), /permission denied/)
  assert.deepEqual(Object.keys((await anon('select citizen_report_status($1) as s', [ok.code_suivi]))[0].s).sort(), ['mis_a_jour_le', 'recu_le', 'statut'])
  assert.equal((await anon('select citizen_report_status($1) as s', ['0000000000']))[0].s, null)

  const id = (await rpc('dcmp', 'select id from citizen_reports where code_suivi=$1', [ok.code_suivi]))[0].id
  assert.equal((await rpc('prm', 'select * from citizen_reports')).length, 0)
  await assert.rejects(rpc('prm', 'select handle_citizen_report($1,$2)', [id, 'EN_EXAMEN']), /FORBIDDEN/)
  await assert.rejects(rpc('dcmp', 'select handle_citizen_report($1,$2)', [id, 'CLOS_SANS_SUITE']), /MOTIVATION_REQUIRED/)
  await rpc('dcmp', 'select handle_citizen_report($1,$2,$3)', [id, 'EN_EXAMEN', 'Rapproché de l’alerte OFFRE_UNIQUE'])
  assert.equal((await anon('select citizen_report_status($1) as s', [ok.code_suivi]))[0].s.statut, 'EN_EXAMEN')

  for (let i = 0; i < 19; i++) await submit(ref, 'AUTRE', long)
  await assert.rejects(submit(ref, 'AUTRE', long), /RATE_LIMITED/)
})

test('ancrage : une réécriture complète de la chaîne d’audit, invisible de la seule chaîne, est détectée', async () => {
  const anchored = (await asService(db, () => q('select anchor_audit_chain() as n')))[0].n
  assert.ok(anchored >= 1)
  assert.equal((await asService(db, () => q('select anchor_audit_chain() as n')))[0].n, 0, 'idempotent sans nouvelle entrée')
  assert.deepEqual(await rpc('dcmp', 'select * from verify_audit_anchors()'), [])
  await assert.rejects(rpc('prm', 'select * from verify_audit_anchors()'), /FORBIDDEN/)
  const pub = await anon('select institution, head_hash from v_audit_anchors')
  assert.ok(pub.length >= 1 && pub.every(a => /^[0-9a-f]{64}$/.test(a.head_hash)), 'empreintes publiées sans autre donnée')
  await assert.rejects(anon(`insert into audit_anchors (head_seq, head_hash, nb_entries) values (1,'x',1)`), /permission denied/)

  // Attaque : un administrateur de base désactive le trigger, modifie une ancienne ligne puis RECALCULE toute la chaîne.
  const target = (await q(`select seq from audit_logs where institution_id=$1 order by seq offset 3 limit 1`, [INST]))[0].seq
  await q('alter table audit_logs disable trigger trig_audit_no_update_delete')
  await q(`update audit_logs set new_value='{"falsifie":true}'::jsonb where seq=$1`, [target])
  await q(`do $$ declare r record; prev text := (select row_hash from audit_logs where institution_id = '${INST}' and seq < ${target} order by seq desc limit 1); h text;
           begin for r in select * from audit_logs where institution_id = '${INST}' and seq >= ${target} order by seq loop
             h := audit_compute_hash(prev, r.id, r.institution_id, r.action, r.entity_type, r.entity_id, r.old_value, r.new_value, r.occurred_at);
             update audit_logs set prev_hash = prev, row_hash = h where id = r.id; prev := h; end loop; end $$`)
  await q('alter table audit_logs enable trigger trig_audit_no_update_delete')
  assert.deepEqual(await rpc('dcmp', 'select * from verify_audit_chain($1)', [INST]), [], 'la chaîne réécrite reste cohérente en elle-même…')
  const broken = await rpc('dcmp', 'select * from verify_audit_anchors()')
  assert.ok(broken.length >= 1 && broken[0].reason === 'EMPREINTE_DIFFERENTE', '…mais plus compatible avec l’empreinte déjà publiée')
})
