// Catalogue électronique d'accords-cadres : création réservée au PRM, attributs standardisés, plafond de l'accord,
// hausse de prix plafonnée et historisée, commandes au prix figé, restitution du solde en cas d'annulation, publicité.
import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createDb, asUser, asAnon } from './harness.mjs'

let db, INST, INST2, AGR, ITEM, INFO, BUREAU
const U = {}
const q = (sql, params) => db.query(sql, params).then(r => r.rows)
const as = (key, sql, params) => asUser(db, U[key], () => q(sql, params))
const rejects = (p, re) => assert.rejects(p, e => re.test(e.message), `attendu : ${re}`)

async function mkUser(key, role, inst) {
  const id = randomUUID()
  await q('insert into auth.users (id, email) values ($1, $2)', [id, `${key}@ac.sn`])
  await q('update users set role=$2, institution_id=$3, full_name=$4 where id=$1', [id, role, inst, key.toUpperCase() + ' SARL'])
  U[key] = id
}

const GOOD_ATTRS = { origine: 'LOCAL', garantie_mois: 24, conformite_normes: true }

before(async () => {
  db = await createDb()
  INST = (await q(`insert into institutions (code, name, type) values ('ACA', 'Centrale d''achat', 'ETAT') returning id`))[0].id
  INST2 = (await q(`insert into institutions (code, name, type) values ('ACB', 'Hôpital bénéficiaire', 'ETAT') returning id`))[0].id
  const INST3 = (await q(`insert into institutions (code, name, type) values ('ACC', 'Autre autorité', 'ETAT') returning id`))[0].id
  await mkUser('prm', 'PRM', INST); await mkUser('cpm2', 'CPM', INST2); await mkUser('cpm3', 'CPM', INST3)
  await mkUser('dcmp', 'DCMP', null); await mkUser('titulaire', 'SOUMISSIONNAIRE', null); await mkUser('autre', 'SOUMISSIONNAIRE', null)
  INFO = (await q(`select id from corps_metiers where code='INFORMATIQUE'`))[0].id
  BUREAU = (await q(`select id from corps_metiers where code='FOURNITURES_BUREAU'`))[0].id

  const mk = async (mode, phase) => (await q(`insert into tenders (institution_id, title, nature_marche, montant_estime, ligne_budgetaire, ppm_annee, mode_passation, justification_mode, current_phase, is_alloti)
      values ($1,'Accord-cadre de fournitures informatiques','FOURNITURES',200000000,'1.2.3',2026,$2,'Achats récurrents couverts par un accord-cadre',$3,false) returning id`, [INST, mode, phase]))[0].id
  const tAC = await mk('ACCORD_CADRE', 'PHASE_13_EXECUTION')
  const tAOO = await mk('AOO', 'PHASE_13_EXECUTION')
  const tEarly = await mk('ACCORD_CADRE', 'PHASE_8_EVALUATION')
  const bid = (await q(`insert into bids (tender_id, institution_id, soumissionnaire_id, status, montant_offre) values ($1,$2,$3,'RETENUE',200000000) returning id`, [tAC, INST, U.titulaire]))[0].id
  await q(`insert into contracts (tender_id, institution_id, bid_id, attributaire_id, montant_initial, montant_actuel, signed_by_ac, signed_by_titulaire, signature_ac_at, signature_titulaire_at, visa_controleur, date_debut_execution, delai_execution)
           values ($1,$2,$3,$4,200000000,200000000,true,true,now(),now(),true,current_date,365)`, [tAC, INST, bid, U.titulaire])
  U._tAC = tAC; U._tAOO = tAOO; U._tEarly = tEarly; U._inst2 = INST2
})

test('création : réservée au PRM, marché ACCORD_CADRE contractualisé, plafond ≤ montant du contrat', async () => {
  const sql = `select create_framework_agreement($1, 'Fournitures informatiques 2026', current_date - 1, current_date + 365, $2, $3) as id`
  await rejects(as('cpm2', sql, [U._tAC, 100000000, null]), /FORBIDDEN/)
  await rejects(as('prm', sql, [U._tAOO, 100000000, null]), /INVALID_STATE/)
  await rejects(as('prm', sql, [U._tEarly, 100000000, null]), /INVALID_PHASE|INVALID_STATE/)
  await rejects(as('prm', sql, [U._tAC, 300000000, null]), /PLAFOND_INVALID/)
  AGR = (await as('prm', sql, [U._tAC, 100000000, `{${U._inst2}}`]))[0].id
  assert.ok(AGR)
  await rejects(as('prm', sql, [U._tAC, 100000000, null]), /unique|duplicate/i)   // un seul accord par marché
  await rejects(as('prm', `update framework_agreements set plafond_montant = 999999999 where id=$1`, [AGR]), /permission|denied|RLS|row-level/i)
})

test('attributs standardisés : inconnus, obligatoires, types et listes fermées', async () => {
  const ins = attrs => as('titulaire', `insert into catalog_items (agreement_id, corps_metier_id, code_article, designation, unite, prix_unitaire, attributs)
      values ($1,$2,'LAP-14','Ordinateur portable 14 pouces','UNITE',500000,$3) returning id`, [AGR, INFO, JSON.stringify(attrs)])
  await rejects(ins({ ...GOOD_ATTRS, couleur: 'rouge' }), /ATTRIBUTES_INVALID.*inconnu/)
  await rejects(ins({ origine: 'LOCAL', garantie_mois: 24 }), /ATTRIBUTES_INVALID.*obligatoire/)
  await rejects(ins({ ...GOOD_ATTRS, garantie_mois: 'deux ans' }), /ATTRIBUTES_INVALID.*nombre/)
  await rejects(ins({ ...GOOD_ATTRS, origine: 'MARS' }), /ATTRIBUTES_INVALID.*liste/)
  await rejects(ins({ ...GOOD_ATTRS, conformite_normes: 'oui' }), /ATTRIBUTES_INVALID.*oui\/non/)
  ITEM = (await ins(GOOD_ATTRS))[0].id
  assert.ok(ITEM)
  // L'attribut d'une autre catégorie est refusé.
  await rejects(as('titulaire', `insert into catalog_items (agreement_id, corps_metier_id, code_article, designation, unite, prix_unitaire, attributs)
      values ($1,$2,'RAM-01','Ramette de papier A4','UNITE',3000,$3)`, [AGR, BUREAU, JSON.stringify({ ...GOOD_ATTRS })]), /ATTRIBUTES_INVALID/)
})

test('seul le titulaire de l\'accord alimente le catalogue ; l\'identité d\'un article est figée', async () => {
  await rejects(as('autre', `insert into catalog_items (agreement_id, supplier_id, corps_metier_id, code_article, designation, unite, prix_unitaire, attributs)
      values ($1,$2,$3,'X-1','Article intrus pour essai','UNITE',1000,$4)`, [AGR, U.autre, INFO, JSON.stringify(GOOD_ATTRS)]), /row-level|policy|denied/i)
  await rejects(as('titulaire', `update catalog_items set code_article='AUTRE-CODE' where id=$1`, [ITEM]), /IMMUTABLE_RECORD/)
  await rejects(as('titulaire', `delete from catalog_items where id=$1`, [ITEM]), /permission|denied/i)
})

test('prix : hausse plafonnée à 10 %, baisse libre, historique immuable', async () => {
  await rejects(as('titulaire', `update catalog_items set prix_unitaire = 600000 where id=$1`, [ITEM]), /PRICE_INCREASE_TOO_HIGH/)
  await as('titulaire', `update catalog_items set prix_unitaire = 540000 where id=$1`, [ITEM])
  await as('titulaire', `update catalog_items set prix_unitaire = 480000 where id=$1`, [ITEM])
  const h = await as('titulaire', `select ancien_prix, nouveau_prix from catalog_price_history where item_id=$1 order by changed_at, nouveau_prix desc`, [ITEM])
  assert.equal(h.length, 3)
  assert.deepEqual(h.map(x => Number(x.nouveau_prix)).sort((a, b) => a - b), [480000, 500000, 540000])
  await rejects(db.query(`update catalog_price_history set nouveau_prix = 1`), /IMMUTABLE|immuable|interdit/i)
})

test('commandes : droits, prix figé, plafond de l\'accord, restitution du solde', async () => {
  await rejects(as('cpm3', `select place_call_off($1, 10)`, [ITEM]), /FORBIDDEN/)               // autorité non bénéficiaire
  await rejects(as('titulaire', `select place_call_off($1, 10)`, [ITEM]), /FORBIDDEN/)
  await rejects(as('prm', `select place_call_off($1, 0)`, [ITEM]), /INVALID_INPUT/)
  const o1 = (await as('cpm2', `select place_call_off($1, 100) as id`, [ITEM]))[0].id           // bénéficiaire : 100 × 480 000 = 48 M
  const [o] = await as('cpm2', `select prix_unitaire, montant from call_off_orders where id=$1`, [o1])
  assert.equal(Number(o.prix_unitaire), 480000); assert.equal(Number(o.montant), 48000000)

  // Une révision ultérieure du prix ne touche pas la commande passée.
  await as('titulaire', `update catalog_items set prix_unitaire = 500000 where id=$1`, [ITEM])
  assert.equal(Number((await as('cpm2', `select prix_unitaire from call_off_orders where id=$1`, [o1]))[0].prix_unitaire), 480000)

  await rejects(as('prm', `select place_call_off($1, 110)`, [ITEM]), /PLAFOND_ACCORD_EXCEEDED/)  // 55 M > solde de 52 M
  const o2 = (await as('prm', `select place_call_off($1, 100) as id`, [ITEM]))[0].id             // 50 M → 98 M consommés
  assert.equal(Number((await q(`select montant_commande from framework_agreements where id=$1`, [AGR]))[0].montant_commande), 98000000)

  // Annulation : motif obligatoire, solde restitué, tiers refusés.
  await rejects(as('cpm2', `select progress_call_off($1,'ANNULER','court')`, [o2]), /FORBIDDEN|MOTIVATION/)
  await rejects(as('prm', `select progress_call_off($1,'ANNULER','court')`, [o2]), /MOTIVATION_REQUIRED/)
  await as('prm', `select progress_call_off($1,'ANNULER','Besoin finalement couvert par le stock existant')`, [o2])
  assert.equal(Number((await q(`select montant_commande from framework_agreements where id=$1`, [AGR]))[0].montant_commande), 48000000)
  await rejects(as('prm', `select progress_call_off($1,'ANNULER','Annulation répétée sans objet')`, [o2]), /INVALID_STATE/)

  // Livraison par le titulaire, réception par l'autorité qui a commandé.
  await rejects(as('cpm2', `select progress_call_off($1,'RECEPTIONNER')`, [o1]), /INVALID_STATE/)
  await rejects(as('cpm2', `select progress_call_off($1,'LIVRER')`, [o1]), /FORBIDDEN/)
  await as('titulaire', `select progress_call_off($1,'LIVRER')`, [o1])
  await rejects(as('prm', `select progress_call_off($1,'RECEPTIONNER')`, [o1]), /FORBIDDEN/)     // l'accord appartient à une autre autorité que l'acheteur
  await as('cpm2', `select progress_call_off($1,'RECEPTIONNER')`, [o1])
  assert.equal((await q(`select statut from call_off_orders where id=$1`, [o1]))[0].statut, 'RECEPTIONNE')
})

test('articles retirés ou accord expiré : plus de commande', async () => {
  await as('titulaire', `update catalog_items set actif=false where id=$1`, [ITEM])
  await rejects(as('prm', `select place_call_off($1, 1)`, [ITEM]), /ITEM_INACTIVE/)
  await as('titulaire', `update catalog_items set actif=true where id=$1`, [ITEM])
  await q(`update framework_agreements set date_fin = current_date - 1, date_debut = current_date - 30 where id=$1`, [AGR])
  await rejects(as('prm', `select place_call_off($1, 1)`, [ITEM]), /AGREEMENT_CLOSED/)
  await q(`update framework_agreements set date_fin = current_date + 300 where id=$1`, [AGR])
})

test('visibilité : catalogue et prix publics ; commandes confidentielles', async () => {
  const cat = await asAnon(db, () => q(`select designation, prix_unitaire, fournisseur, attributs from v_public_catalogue`))
  assert.equal(cat.length, 1)
  assert.equal(Number(cat[0].prix_unitaire), 500000)
  const acc = await asAnon(db, () => q(`select reference, taux_consommation from v_public_accords`))
  assert.equal(acc.length, 1); assert.equal(Number(acc[0].taux_consommation), 48)
  assert.equal((await asAnon(db, () => q(`select * from call_off_orders`))).length, 0)
  assert.equal((await asAnon(db, () => q(`select * from catalog_items`))).length, 0)
  assert.equal((await as('autre', `select * from call_off_orders`)).length, 0)                  // un fournisseur tiers ne voit pas les commandes d'autrui
  assert.equal((await as('cpm3', `select * from call_off_orders`)).length, 0)
  assert.equal((await as('titulaire', `select * from call_off_orders`)).length, 2)
})

test('audit : créations et commandes tracées dans la chaîne', async () => {
  const n = (await q(`select count(*)::int n from audit_logs where entity_type in ('framework_agreements','catalog_items','call_off_orders')`))[0].n
  assert.ok(n >= 6, `journal trop court : ${n}`)
  // verify_audit_chain ne renvoie que les maillons rompus : un résultat vide = chaîne intacte (vérification réservée aux régulateurs).
  const broken = await as('dcmp', `select * from verify_audit_chain($1)`, [INST])
  assert.deepEqual(broken, [])
})
