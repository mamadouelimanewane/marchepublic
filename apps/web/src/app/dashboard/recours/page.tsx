import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getPhaseLabel } from '@marchepublic/workflow'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'

export default async function RecoursArcopPage() {
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user!.id)
    .single()

  const isArcop = profile?.role === 'ARCOP' || profile?.role === 'ADMIN'

  // Récupérer les recours
  const { data: recours } = await supabase
    .from('appeals')
    .select(`
      id, motif, status, date_depot,
      tenders ( reference, title, current_phase, montant_estime ),
      users ( full_name, ninea )
    `)
    .order('date_depot', { ascending: false })

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="bg-red-100 p-2 rounded-lg border border-red-200">
          <span className="text-xl">⚖️</span>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Régulation et Recours (ARCOP)</h1>
          <p className="text-sm text-gray-500">
            Tout recours déposé ici bloque immédiatement le passage du marché concerné en "Attribution Définitive".
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
          <h2 className="font-semibold text-gray-800">Dossiers Contentieux</h2>
          <span className="bg-red-100 text-red-800 text-xs font-bold px-3 py-1 rounded-full">
            {recours?.filter(r => r.status === 'EN_INSTRUCTION' || r.status === 'DEPOSE').length ?? 0} Actifs
          </span>
        </div>

        <div className="divide-y divide-gray-200">
          {recours?.length ? recours.map((r) => (
            <div key={r.id} className="p-6 hover:bg-gray-50 transition-colors">
              <div className="flex flex-col md:flex-row justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                      r.status === 'DEPOSE' ? 'bg-orange-100 text-orange-800' :
                      r.status === 'EN_INSTRUCTION' ? 'bg-blue-100 text-blue-800' :
                      r.status === 'REJETE' ? 'bg-gray-100 text-gray-800' :
                      'bg-green-100 text-green-800'
                    }`}>
                      {r.status.replace('_', ' ')}
                    </span>
                    <span className="text-xs text-gray-400 font-mono">
                      {/* @ts-ignore */}
                      {r.tenders?.reference}
                    </span>
                    {/* @ts-ignore */}
                    {r.tenders?.current_phase === 'PHASE_10_RECOURS' && (
                      <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs font-bold border border-red-300 rounded flex items-center gap-1">
                        <span>🔒</span> HARD LOCK ACTIF
                      </span>
                    )}
                  </div>
                  
                  {/* @ts-ignore */}
                  <h3 className="font-bold text-gray-800 text-lg mb-1">{r.tenders?.title}</h3>
                  <p className="text-sm text-gray-600 mb-3">{r.motif}</p>
                  
                  <div className="flex items-center gap-4 text-xs text-gray-500">
                    <span><strong>Requérant :</strong> {r.users[0]?.full_name} (NINEA: {r.users[0]?.ninea})</span>
                    <span><strong>Déposé le :</strong> {format(new Date(r.date_depot), 'dd MMM yyyy', { locale: fr })}</span>
                  </div>
                </div>

                {isArcop && (r.status === 'DEPOSE' || r.status === 'EN_INSTRUCTION') && (
                  <div className="flex flex-col gap-2 min-w-48">
                    {r.status === 'DEPOSE' && (
                      <button className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold py-2 px-4 rounded-lg transition-colors">
                        Mettre en instruction
                      </button>
                    )}
                    {(r.status === 'DEPOSE' || r.status === 'EN_INSTRUCTION') && (
                      <div className="flex gap-2">
                        <button className="flex-1 border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 text-xs font-semibold py-2 px-2 rounded-lg transition-colors">
                          Rejeter
                        </button>
                        <button className="flex-1 border border-red-300 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-semibold py-2 px-2 rounded-lg transition-colors">
                          Favorable
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )) : (
            <div className="p-12 text-center text-gray-500">
              <span className="text-3xl block mb-2">✅</span>
              <p>Aucun recours n'a été déposé sur la plateforme.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
