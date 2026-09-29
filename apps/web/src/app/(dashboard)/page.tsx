import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getPhaseLabel } from '@marchepublic/workflow'

export default async function DashboardHome() {
  const supabase = createSupabaseServerClient()

  // On suppose que l'utilisateur est connecté (middleware gère)
  const { data: { user } } = await supabase.auth.getUser()

  // Données de l'utilisateur
  const { data: profile } = await supabase
    .from('users')
    .select('full_name, role, institution_id')
    .eq('id', user!.id)
    .single()

  // Statistiques
  const [
    { count: totalEnCours },
    { count: totalAClore }
  ] = await Promise.all([
    supabase.from('tenders')
      .select('*', { count: 'exact', head: true })
      .neq('current_phase', 'PHASE_15_CLOTURE_ARCHIVAGE'),
    supabase.from('tenders')
      .select('*', { count: 'exact', head: true })
      .eq('current_phase', 'PHASE_14_RECEPTION_PAIEMENT')
  ])

  // Liste des derniers marchés
  const { data: recentTenders } = await supabase
    .from('tenders')
    .select('id, reference, title, current_phase, montant_estime')
    .order('created_at', { ascending: false })
    .limit(5)

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-6">Tableau de bord</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <p className="text-sm font-medium text-gray-500 mb-1">Marchés en cours</p>
          <p className="text-3xl font-bold text-gray-900">{totalEnCours ?? 0}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <p className="text-sm font-medium text-gray-500 mb-1">En attente de clôture</p>
          <p className="text-3xl font-bold text-gray-900">{totalAClore ?? 0}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <p className="text-sm font-medium text-gray-500 mb-1">Action requise</p>
          <p className="text-3xl font-bold text-orange-600">0</p>
        </div>
      </div>

      {/* Recent Tenders */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-800">Dossiers récents</h2>
        </div>
        <div className="divide-y divide-gray-200">
          {recentTenders?.length ? recentTenders.map(tender => (
            <div key={tender.id} className="px-6 py-4 flex items-center justify-between hover:bg-gray-50">
              <div>
                <p className="text-sm font-medium text-gray-900">{tender.reference}</p>
                <p className="text-sm text-gray-500">{tender.title}</p>
              </div>
              <div className="text-right">
                {/* @ts-ignore */}
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                  {getPhaseLabel(tender.current_phase as any)}
                </span>
              </div>
            </div>
          )) : (
            <div className="px-6 py-8 text-center text-gray-500 text-sm">
              Aucun marché trouvé pour votre institution.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
