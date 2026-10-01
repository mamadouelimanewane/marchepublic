import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { dateFr } from '@/lib/format'

export const revalidate = 60  // portail public : cache d'une minute

const MODES = ['AOO', 'AOR', 'AOO_2ETAPES', 'CONCOURS', 'DRP', 'ACCORD_CADRE']

export default async function AvisPage({ searchParams }: { searchParams: Promise<{ corps?: string; mode?: string; q?: string; page?: string }> }) {
  const f = await searchParams
  const page = Math.max(1, Number.parseInt(f.page ?? '1', 10) || 1)
  const pageSize = 20
  const supabase = await createSupabaseServerClient()

  let query = supabase.from('v_avis_publics')
    .select('id, reference, title, mode_passation, nature_marche, date_limite_depot, date_publication, is_reserve_pme, is_reserve_pme_feminine, is_alloti, institution_name, corps_metier', { count: 'exact' })
    .order('date_publication', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1)
  if (f.corps) query = query.eq('corps_metier', f.corps)
  if (f.mode) query = query.eq('mode_passation', f.mode)
  if (f.q) {
    const safe = f.q.replace(/[(),.%]/g, ' ').trim()
    if (safe) query = query.or(`title.ilike.%${safe}%,reference.ilike.%${safe}%`)
  }
  interface Avis { id: string; reference: string; title: string; mode_passation: string; nature_marche: string; date_limite_depot: string; date_publication: string; is_reserve_pme: boolean; is_reserve_pme_feminine: boolean; is_alloti: boolean; institution_name: string; corps_metier: string | null }
  let avis: Avis[] = []
  let count: number | null = 0
  let corps: { libelle: string }[] | null = null
  let unavailable = false
  try {
    const [a, c] = await Promise.all([query, supabase.from('corps_metiers').select('libelle').eq('is_active', true).order('libelle')])
    if (a.error) throw a.error
    avis = (a.data ?? []) as Avis[]; count = a.count; corps = c.data
  } catch (e) {
    console.error('Portail public : base de données indisponible', e)
    unavailable = true
  }
  const pages = Math.ceil((count ?? 0) / pageSize)
  const qs = (p: number) => new URLSearchParams({ ...(f.corps ? { corps: f.corps } : {}), ...(f.mode ? { mode: f.mode } : {}), ...(f.q ? { q: f.q } : {}), page: String(p) }).toString()

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-green-800 px-6 py-4 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">🇸🇳 Portail des marchés publics</h1>
            <p className="text-sm text-green-200">Avis d'appel d'offres en cours — République du Sénégal</p>
          </div>
          <nav className="flex gap-4 text-sm"><Link href="/" className="text-green-200 hover:text-white">Accueil</Link><Link href="/login" className="font-semibold text-yellow-300 hover:text-yellow-200">Connexion</Link></nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        <form className="mb-6 flex flex-wrap gap-3 rounded-xl border border-gray-200 bg-white p-4" role="search">
          <input name="q" defaultValue={f.q} placeholder="Référence ou mots-clés…" aria-label="Recherche" className="w-64 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          <select name="corps" defaultValue={f.corps ?? ''} aria-label="Corps de métier" className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
            <option value="">Tous les secteurs</option>
            {(corps ?? []).map(c => <option key={c.libelle} value={c.libelle}>{c.libelle}</option>)}
          </select>
          <select name="mode" defaultValue={f.mode ?? ''} aria-label="Mode de passation" className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
            <option value="">Tous les modes</option>
            {MODES.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <button className="rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800">Rechercher</button>
        </form>

        {unavailable && <p role="alert" className="mb-4 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">Le service est momentanément indisponible. Réessayez dans quelques instants.</p>}
        <p className="mb-3 text-sm text-gray-500">{count ?? 0} avis</p>
        <ul className="space-y-3">
          {avis.map(a => (
            <li key={a.id}>
              <Link href={`/avis/${a.id}`} className="block rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-green-500">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold text-green-800">{a.reference}</p>
                    <h2 className="text-base font-semibold text-gray-900">{a.title}</h2>
                    <p className="text-sm text-gray-500">{a.institution_name} · {a.corps_metier ?? a.nature_marche}</p>
                  </div>
                  <div className="text-right text-sm">
                    <p className="font-semibold text-red-700">Limite : {dateFr(a.date_limite_depot, true)}</p>
                    <p className="text-gray-500">{a.mode_passation}</p>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  {a.is_reserve_pme && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">Réservé PME / ESS</span>}
                  {a.is_reserve_pme_feminine && <span className="rounded-full bg-pink-100 px-2 py-0.5 text-pink-800">Réservé PME féminines</span>}
                  {a.is_alloti && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-800">Alloti</span>}
                </div>
              </Link>
            </li>
          ))}
          {!avis.length && <li className="rounded-xl border border-dashed border-gray-300 p-10 text-center text-gray-500">Aucun avis ne correspond à votre recherche.</li>}
        </ul>

        {pages > 1 && (
          <nav className="mt-6 flex items-center justify-center gap-3 text-sm" aria-label="Pagination">
            {page > 1 && <Link className="rounded border px-3 py-1 hover:bg-white" href={`/avis?${qs(page - 1)}`}>← Précédent</Link>}
            <span>Page {page} / {pages}</span>
            {page < pages && <Link className="rounded border px-3 py-1 hover:bg-white" href={`/avis?${qs(page + 1)}`}>Suivant →</Link>}
          </nav>
        )}
      </main>
    </div>
  )
}
