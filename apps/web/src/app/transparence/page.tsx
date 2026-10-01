import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { fcfa } from '@/lib/format'
import { PublicShell } from '@/components/PublicShell'

export const revalidate = 120
export const metadata = { title: 'Transparence de la commande publique | Sénégal' }

const PHASES_LABEL: Record<string, string> = {
  PHASE_4_PUBLICATION: 'Publication', PHASE_5_CLARIFICATIONS: 'Avis ouvert', PHASE_6_DEPOT_OFFRES: 'Dépôt des offres', PHASE_7_OUVERTURE_PLIS: 'Ouverture',
  PHASE_8_EVALUATION: 'Évaluation', PHASE_9_ATTRIBUTION_PROVISOIRE: 'Attribution provisoire', PHASE_10_RECOURS: 'Attribué — délai de recours',
  PHASE_11_ATTRIBUTION_DEFINITIVE: 'Attribué', PHASE_12_SIGNATURE_CONTRAT: 'Contrat en signature', PHASE_13_EXECUTION: 'En exécution',
  PHASE_14_RECEPTION_PAIEMENT: 'Réception / paiement', PHASE_15_CLOTURE_ARCHIVAGE: 'Clos',
}

export default async function TransparencePage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const f = await searchParams
  const page = Math.max(1, Number(f.page) || 1)
  const pageSize = 25
  const supabase = await createSupabaseServerClient()

  let rows: Record<string, any>[] = []
  let count = 0
  let total = { n: 0, montant: 0 }
  let unavailable = false
  try {
    let q = supabase.from('v_public_marches')
      .select('id, reference, title, institution, mode_passation, current_phase, date_publication, montant_estime, montant_attribue, nb_offres, issue', { count: 'exact' })
      .order('date_publication', { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1)
    if (f.q) {
      const safe = f.q.replace(/[(),.%]/g, ' ').trim()
      if (safe) q = q.or(`title.ilike.%${safe}%,reference.ilike.%${safe}%`)
    }
    const res = await q
    if (res.error) throw res.error
    rows = res.data ?? []
    count = res.count ?? 0
    const agg = await supabase.from('v_public_marches').select('montant_attribue').not('montant_attribue', 'is', null)
    total = { n: agg.data?.length ?? 0, montant: (agg.data ?? []).reduce((s, r) => s + Number(r.montant_attribue), 0) }
  } catch {
    unavailable = true
  }
  const pages = Math.ceil(count / pageSize)
  const qs = (p: number) => new URLSearchParams({ ...(f.q ? { q: f.q } : {}), page: String(p) }).toString()

  return (
    <PublicShell title="Transparence de la commande publique" subtitle="Qui achète quoi, auprès de qui et à quel prix — publié au fil de la procédure" wide>
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-5"><p className="text-sm text-gray-500">Marchés publiés</p><p className="text-3xl font-bold">{unavailable ? '—' : count}</p></div>
        <div className="rounded-xl border border-gray-200 bg-white p-5"><p className="text-sm text-gray-500">Marchés attribués</p><p className="text-3xl font-bold">{unavailable ? '—' : total.n}</p></div>
        <div className="rounded-xl border border-gray-200 bg-white p-5"><p className="text-sm text-gray-500">Montant total attribué</p><p className="text-2xl font-bold">{unavailable ? '—' : fcfa(total.montant)}</p></div>
      </div>

      {unavailable && <p role="alert" className="mb-4 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">Le service est momentanément indisponible. Réessayez dans quelques instants.</p>}
      <form className="mb-4 flex gap-3" role="search">
        <input name="q" defaultValue={f.q} placeholder="Référence ou objet…" aria-label="Recherche" className="w-72 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        <button className="rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800">Rechercher</button>
      </form>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr><th className="px-4 py-2">Référence</th><th className="px-4 py-2">Objet</th><th className="px-4 py-2">Autorité</th><th className="px-4 py-2">Estimation</th><th className="px-4 py-2">Attribué</th><th className="px-4 py-2">Offres</th><th className="px-4 py-2">Situation</th></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(r => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="whitespace-nowrap px-4 py-2 font-medium text-green-800"><Link href={`/transparence/${r.id}`} className="hover:underline">{r.reference}</Link></td>
                <td className="px-4 py-2">{r.title}</td>
                <td className="px-4 py-2">{r.institution}</td>
                <td className="whitespace-nowrap px-4 py-2">{fcfa(r.montant_estime)}</td>
                <td className="whitespace-nowrap px-4 py-2">{fcfa(r.montant_attribue)}</td>
                <td className="px-4 py-2">{r.nb_offres ?? '—'}</td>
                <td className="px-4 py-2">{r.issue === 'INFRUCTUEUX' ? 'Infructueux' : PHASES_LABEL[r.current_phase] ?? r.current_phase}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-500">Aucun marché publié.</td></tr>}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <nav className="mt-4 flex items-center justify-center gap-3 text-sm" aria-label="Pagination">
          {page > 1 && <Link className="rounded border px-3 py-1 hover:bg-white" href={`/transparence?${qs(page - 1)}`}>← Précédent</Link>}
          <span>Page {page} / {pages}</span>
          {page < pages && <Link className="rounded border px-3 py-1 hover:bg-white" href={`/transparence?${qs(page + 1)}`}>Suivant →</Link>}
        </nav>
      )}
      <p className="mt-6 text-xs text-gray-500">
        Les candidats, les montants des offres et le classement sont publiés à l&apos;attribution provisoire ; le contrat, les avenants et les paiements à partir de la signature.
        Un doute sur une procédure ? <Link className="underline" href="/signalement">Signalez-le</Link>.
      </p>
    </PublicShell>
  )
}
