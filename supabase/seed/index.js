const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '../../apps/web/.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY // Nécessite la clé service_role

if (!supabaseUrl || !supabaseKey) {
  console.log('⚠️ Veuillez configurer NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY dans apps/web/.env.local')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function seed() {
  console.log('🌱 Démarrage du seed de la base de données...')

  // 1. Créer une institution de test (Ministère)
  console.log('Création de l\'institution de test...')
  const { data: instData, error: instError } = await supabase
    .from('institutions')
    .upsert({
      code: 'MEFP',
      name: 'Ministère de l\'Économie, des Finances et du Plan',
      type: 'ETAT',
      seuil_travaux: 70000000,
      seuil_fournitures: 50000000,
      is_active: true
    }, { onConflict: 'code' })
    .select()
    .single()

  if (instError) throw instError
  console.log('✅ Institution créée:', instData.name)

  // 2. Créer l'institution de régulation (ARCOP)
  const { data: arcopData, error: arcopError } = await supabase
    .from('institutions')
    .upsert({
      code: 'ARCOP',
      name: 'Autorité de Régulation de la Commande Publique',
      type: 'AGENCE',
      is_active: true
    }, { onConflict: 'code' })
    .select()
    .single()

  if (arcopError) throw arcopError
  console.log('✅ Institution ARCOP créée')

  // Note: La création d'utilisateurs via auth.users nécessite l'API admin
  // Pour le test local, on recommandera d'utiliser le dashboard Supabase.

  console.log('🎉 Seed terminé avec succès !')
}

seed().catch(console.error)
