import { createSupabaseServerClient } from '@/lib/supabase/server'
import { WorkflowBadge } from '@/components/workflow/WorkflowBadge'

export default async function DashboardHome() {
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // Données de l'utilisateur
  const { data: profile } = await supabase
    .from('users')
    .select('full_name, role, institution_id')
    .eq('id', user.id)
    .single()

  // Statistiques
  const [
    { count: totalEnCours },
    { count: totalAClore },
    { data: recentTenders }
  ] = await Promise.all([
    supabase.from('tenders')
      .select('*', { count: 'exact', head: true })
      .neq('current_phase', 'PHASE_15_CLOTURE_ARCHIVAGE'),
    supabase.from('tenders')
      .select('*', { count: 'exact', head: true })
      .eq('current_phase', 'PHASE_14_RECEPTION_PAIEMENT'),
    supabase.from('tenders')
      .select('id, reference, title, current_phase, montant_estime')
      .order('created_at', { ascending: false })
      .limit(5)
  ])

  const { count: totalRecours } = await supabase.from('appeals')
    .select('*', { count: 'exact', head: true })
    .in('status', ['DEPOSE', 'EN_INSTRUCTION'])

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-6">Tableau de bord — {profile?.role || 'Utilisateur'}</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <p className="text-sm font-medium text-gray-500 mb-1">Marchés en cours</p>
          <p className="text-3xl font-bold text-gray-900">{totalEnCours ?? '—'}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <p className="text-sm font-medium text-gray-500 mb-1">En attente de clôture</p>
          <p className="text-3xl font-bold text-gray-900">{totalAClore ?? '—'}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <p className="text-sm font-medium text-gray-500 mb-1">Recours en cours</p>
          <p className="text-3xl font-bold text-red-600">{totalRecours ?? '—'}</p>
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
              <div className="flex-1 pr-4">
                <p className="text-sm font-bold text-green-800 mb-0.5">{tender.reference}</p>
                <p className="text-sm text-gray-600 line-clamp-1">{tender.title}</p>
                <p className="text-xs text-gray-400 mt-1">Montant estimé : {tender.montant_estime?.toLocaleString('fr-SN') ?? 'Non renseigné'} FCFA</p>
              </div>
              <div className="text-right">
                <WorkflowBadge phase={tender.current_phase as any} />
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
