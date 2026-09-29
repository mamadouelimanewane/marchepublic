import { createSupabaseServerClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'

export const revalidate = 60  // Cache 1 minute - portail public

export default async function AvisPage({
  searchParams,
}: {
  searchParams: Promise<{ corps_metier?: string; mode?: string; q?: string; page?: string }>
}) {
  const filters = await searchParams
  const supabase = await createSupabaseServerClient()
  const page = Math.max(1, Number.parseInt(filters.page ?? '1', 10) || 1)
  const pageSize = 20
  const offset = (page - 1) * pageSize

  let query = supabase
    .from('tenders')
    .select(`
      id, reference, title, mode_passation, nature_marche, montant_estime,
      date_limite_depot, date_publication, current_phase, is_alloti,
      corps_metiers ( libelle ),
      institutions ( name, type )
    `, { count: 'exact' })
    .gte('current_phase', 'PHASE_4_PUBLICATION')
    .lte('current_phase', 'PHASE_6_DEPOT_OFFRES')  // Uniquement marchés en cours
    .order('date_publication', { ascending: false })
    .range(offset, offset + pageSize - 1)

  // Filtres
  if (filters.corps_metier) {
    query = query.eq('corps_metier_id', filters.corps_metier)
  }
  if (filters.mode) {
    query = query.eq('mode_passation', filters.mode)
  }
  if (filters.q) {
    const safeQuery = filters.q.replace(/[(),.%]/g, ' ').trim()
    if (safeQuery) query = query.or(`title.ilike.%${safeQuery}%,reference.ilike.%${safeQuery}%`)
  }

  const { data: avis, count } = await query

  const totalPages = Math.ceil((count ?? 0) / pageSize)

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header portail */}
      <header className="bg-green-800 text-white py-4 px-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">🇸🇳 Portail des Marchés Publics</h1>
            <p className="text-green-200 text-sm">République du Sénégal</p>
          </div>
          <Link href="/" className="text-green-200 hover:text-white text-sm">← Accueil</Link>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-800">
            Appels d'Offres en cours
            <span className="ml-2 text-lg font-normal text-gray-500">({count ?? 0} résultats)</span>
          </h2>
        </div>

        {/* Filtres */}
        <form className="bg-white rounded-xl border border-gray-200 p-4 mb-6 flex flex-wrap gap-3">
          <input
            name="q"
            defaultValue={filters.q}
            placeholder="Rechercher par titre ou référence..."
            className="flex-1 min-w-48 border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <select name="mode" defaultValue={filters.mode} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
            <option value="">Tous les modes</option>
            <option value="AOO">Appel d'Offres Ouvert (AOO)</option>
            <option value="AOR">Appel d'Offres Restreint (AOR)</option>
            <option value="DRP">Demande de Prix (DRP)</option>
            <option value="CONCOURS">Concours</option>
          </select>
          <button type="submit" className="bg-green-700 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-600">
            Filtrer
          </button>
        </form>

        {/* Liste des AO */}
        <div className="space-y-4">
          {avis?.map((ao) => {
            const isUrgent = ao.date_limite_depot
              ? new Date(ao.date_limite_depot).getTime() - Date.now() < 3 * 24 * 60 * 60 * 1000
              : false

            return (
              <div key={ao.id}
                className={`bg-white rounded-xl border ${isUrgent ? 'border-orange-300' : 'border-gray-200'} p-5 hover:shadow-md transition-shadow`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs text-gray-400 font-mono">{ao.reference}</span>
                      <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full font-medium">
                        {ao.mode_passation}
                      </span>
                      {isUrgent && (
                        <span className="px-2 py-0.5 bg-orange-100 text-orange-700 text-xs rounded-full font-medium">
                          ⚠ Clôture imminente
                        </span>
                      )}
                      {ao.is_alloti && (
                        <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">
                          Alloti
                        </span>
                      )}
                    </div>
                    <h3 className="font-semibold text-gray-800 text-lg mb-1">{ao.title}</h3>
                    <p className="text-sm text-gray-500">
                      {/* @ts-ignore */}
                      {ao.institutions?.name} · {/* @ts-ignore */}{ao.corps_metiers?.libelle}
                    </p>
                  </div>
                  <div className="text-right">
                    {ao.montant_estime && (
                      <p className="font-bold text-gray-800">
                        {ao.montant_estime.toLocaleString('fr-SN')} FCFA
                      </p>
                    )}
                    {ao.date_limite_depot && (
                      <p className={`text-sm ${isUrgent ? 'text-orange-600 font-semibold' : 'text-gray-500'}`}>
                        Clôture : {format(new Date(ao.date_limite_depot), 'dd MMM yyyy HH:mm', { locale: fr })}
                      </p>
                    )}
                    <Link href={`/avis/${ao.id}`}
                      className="mt-2 inline-block bg-green-700 text-white px-4 py-1.5 rounded-lg text-sm hover:bg-green-600">
                      Voir le dossier →
                    </Link>
                  </div>
                </div>
              </div>
            )
          })}

          {(!avis || avis.length === 0) && (
            <div className="text-center py-16 text-gray-500">
              <p className="text-xl mb-2">Aucun appel d'offres en cours</p>
              <p className="text-sm">Revenez prochainement ou modifiez vos filtres</p>
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex justify-center gap-2 mt-8">
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <Link key={p} href={`/avis?page=${p}`}
                className={`px-3 py-1.5 rounded-lg text-sm ${p === page ? 'bg-green-700 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                {p}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
