// Jeu de données de DÉMONSTRATION pour le développement local.
//   1. supabase start  (les migrations créent paramètres, nomenclature, modèles…)
//   2. npm run db:seed
//
// Sécurité : ce script crée des comptes avec des mots de passe connus. Il refuse de s'exécuter contre autre chose
// qu'une instance locale (127.0.0.1 / localhost), sauf avec --force explicite.
const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: require('node:path').join(__dirname, '../../apps/web/.env.local') })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Configurez NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY dans apps/web/.env.local (voir .env.example).')
  process.exit(1)
}
const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(url)
if (!isLocal && !process.argv.includes('--force')) {
  console.error(`Refus : ${url} n'est pas une instance locale. Le seed crée des comptes à mot de passe connu.`)
  process.exit(1)
}

const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
const PASSWORD = 'Demo-Passw0rd!'

const USERS = [
  { email: 'admin@demo.sn', full_name: 'Administrateur Plateforme', role: 'ADMIN', inst: 'MEFP' },
  { email: 'prm@demo.sn', full_name: 'Aminata Diop (PRM)', role: 'PRM', inst: 'MEFP' },
  { email: 'cpm@demo.sn', full_name: 'Ibrahima Ndiaye (CPM)', role: 'CPM', inst: 'MEFP' },
  { email: 'demandeur@demo.sn', full_name: 'Fatou Sow (Service demandeur)', role: 'SERVICE_DEMANDEUR', inst: 'MEFP' },
  { email: 'eval1@demo.sn', full_name: 'Moussa Fall (Évaluateur)', role: 'EVALUATEUR', inst: 'MEFP' },
  { email: 'eval2@demo.sn', full_name: 'Awa Ba (Évaluatrice)', role: 'EVALUATEUR', inst: 'MEFP' },
  { email: 'eval3@demo.sn', full_name: 'Cheikh Sy (Évaluateur)', role: 'EVALUATEUR', inst: 'MEFP' },
  { email: 'tresor@demo.sn', full_name: 'Mariama Gueye (Contrôle financier)', role: 'TRESOR', inst: 'MEFP' },
  { email: 'dcmp@demo.sn', full_name: 'Agent DCMP', role: 'DCMP', inst: null },
  { email: 'arcop@demo.sn', full_name: 'Agent ARCOP', role: 'ARCOP', inst: null },
  { email: 'bailleur@demo.sn', full_name: 'Représentant du bailleur', role: 'BAILLEUR', inst: null },
  { email: 'cdc@demo.sn', full_name: 'Magistrat Cour des Comptes', role: 'COUR_COMPTES', inst: null },
  { email: 'pme1@demo.sn', full_name: 'SENEGAL TECH SOLUTIONS SUARL', role: 'SOUMISSIONNAIRE', inst: null, pme: true, ninea: '1234567' },
  { email: 'entreprise2@demo.sn', full_name: 'DAKAR INFORMATIQUE SA', role: 'SOUMISSIONNAIRE', inst: null, ninea: '7654321' },
  { email: 'entreprise3@demo.sn', full_name: 'TERANGA SERVICES SARL', role: 'SOUMISSIONNAIRE', inst: null, ninea: '7001234' },
]

async function must(promise, label) {
  const { data, error } = await promise
  if (error) throw new Error(`${label} : ${error.message}`)
  return data
}

async function main() {
  console.log('🌱 Seed de démonstration (local)…')
  const inst = await must(supabase.from('institutions').upsert(
    { code: 'MEFP', name: 'Ministère de l\'Économie, des Finances et du Plan', type: 'ETAT', is_active: true }, { onConflict: 'code' }).select().single(), 'institution')
  await must(supabase.from('institutions').upsert(
    { code: 'AGEROUTE', name: 'Agence des travaux et de gestion des routes', type: 'AGENCE', is_active: true }, { onConflict: 'code' }), 'agence')

  const ids = {}
  for (const u of USERS) {
    const { data: existing } = await supabase.from('users').select('id').eq('email', u.email).maybeSingle()
    let id = existing?.id
    if (!id) {
      const created = await supabase.auth.admin.createUser({ email: u.email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: u.full_name } })
      if (created.error) throw new Error(`${u.email} : ${created.error.message}`)
      id = created.data.user.id
    }
    // Le déclencheur d'inscription crée un soumissionnaire : le rôle institutionnel est attribué ici (service_role).
    await must(supabase.from('users').update({
      role: u.role, institution_id: u.inst ? inst.id : null, full_name: u.full_name,
      is_pme: !!u.pme, is_pme_feminine: false, ninea: u.ninea ?? null, ninea_verified_at: u.ninea ? new Date().toISOString() : null,
    }).eq('id', id), u.email)
    ids[u.email] = id
  }

  const corps = await must(supabase.from('corps_metiers').select('id, code').in('code', ['INFORMATIQUE', 'BTP']), 'corps de métier')
  const info = corps.find(c => c.code === 'INFORMATIQUE').id

  // Un besoin soumis (à valider par le PRM) et un marché déjà inscrit au PPM.
  const { data: b } = await supabase.from('besoins').select('id').eq('intitule', 'Acquisition de 200 ordinateurs pour les services centraux').maybeSingle()
  if (!b) {
    await must(supabase.from('besoins').insert({
      institution_id: inst.id, service_demandeur_id: ids['demandeur@demo.sn'], intitule: 'Acquisition de 200 ordinateurs pour les services centraux',
      nature_marche: 'FOURNITURES', corps_metier_id: info, montant_estime: 80_000_000, ligne_budgetaire: '2.4.1.12', annee_budget: new Date().getFullYear(),
      trimestre_souhaite: 2, statut: 'SOUMIS',
    }), 'besoin')
  }
  const { data: t } = await supabase.from('tenders').select('id').eq('title', 'Fourniture de matériel informatique — lot bureautique').maybeSingle()
  if (!t) {
    await must(supabase.from('tenders').insert({
      institution_id: inst.id, title: 'Fourniture de matériel informatique — lot bureautique', nature_marche: 'FOURNITURES', corps_metier_id: info,
      montant_estime: 65_000_000, ligne_budgetaire: '2.4.1.13', ppm_annee: new Date().getFullYear(), ppm_trimestre: 3, prm_id: ids['prm@demo.sn'], created_by: ids['prm@demo.sn'],
    }), 'marché')
  }

  console.log('✅ Terminé. Connexion : <compte>@demo.sn / ' + PASSWORD)
  console.log('   Comptes : ' + USERS.map(u => u.email).join(', '))
}

main().catch(e => { console.error('❌', e.message); process.exit(1) })
