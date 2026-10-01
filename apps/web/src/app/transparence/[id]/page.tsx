import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { dateFr, fcfa, pct } from '@/lib/format'
import { PublicShell } from '@/components/PublicShell'

export const revalidate = 120

export default async function TransparenceDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const supabase = await createSupabaseServerClient()
  const { data: m } = await supabase.from('v_public_marches').select('*').eq('id', id).maybeSingle()
  if (!m) notFound()
  const [offres, contrats] = await Promise.all([
    supabase.from('v_public_offres').select('numero_lot, candidat, montant_offre, score_technique, score_financier, score_global, rang, qualifie, retenue').eq('tender_id', id).order('numero_lot').order('rang'),
    supabase.from('v_public_contrats').select('numero_lot, titulaire, montant_initial, montant_actuel, avenants_cumules, montant_paye, status, date_signature').eq('tender_id', id).order('numero_lot'),
  ])

  return (
    <PublicShell title={m.reference} subtitle={m.title} wide>
      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6">
        <dl className="grid gap-4 text-sm sm:grid-cols-3">
          <div><dt className="text-gray-500">Autorité contractante</dt><dd className="font-medium">{m.institution}</dd></div>
          <div><dt className="text-gray-500">Mode de passation</dt><dd className="font-medium">{m.mode_passation}</dd></div>
          <div><dt className="text-gray-500">Publié le</dt><dd className="font-medium">{dateFr(m.date_publication)}</dd></div>
          <div><dt className="text-gray-500">Estimation</dt><dd className="font-medium">{fcfa(m.montant_estime)}</dd></div>
          <div><dt className="text-gray-500">Montant attribué</dt><dd className="font-medium">{fcfa(m.montant_attribue)}</dd></div>
          <div><dt className="text-gray-500">Offres recevables</dt><dd className="font-medium">{m.nb_offres ?? "publié à l'attribution"}</dd></div>
        </dl>
        {m.issue === 'INFRUCTUEUX' && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Procédure déclarée infructueuse.</p>}
        <p className="mt-4 text-sm">
          <Link className="text-green-700 underline" href={`/api/ocds/releases/${m.id}`}>Données OCDS (JSON)</Link> ·{' '}
          <Link className="text-green-700 underline" href={`/signalement?ref=${encodeURIComponent(m.reference)}`}>Signaler un problème sur ce marché</Link>
        </p>
      </div>

      {(offres.data ?? []).length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-lg font-semibold">Offres et classement</h2>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500"><tr><th className="px-4 py-2">Lot</th><th className="px-4 py-2">Candidat</th><th className="px-4 py-2">Montant</th><th className="px-4 py-2">Technique</th><th className="px-4 py-2">Financière</th><th className="px-4 py-2">Globale</th><th className="px-4 py-2">Rang</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {offres.data!.map((o, i) => (
                  <tr key={i} className={o.retenue ? 'bg-green-50' : ''}>
                    <td className="px-4 py-2">{o.numero_lot ?? '—'}</td>
                    <td className="px-4 py-2">{o.candidat}{o.retenue && <span className="ml-2 text-xs font-semibold text-green-700">retenu</span>}</td>
                    <td className="whitespace-nowrap px-4 py-2">{fcfa(o.montant_offre)}</td>
                    <td className="px-4 py-2">{o.score_technique}</td><td className="px-4 py-2">{o.score_financier ?? '—'}</td>
                    <td className="px-4 py-2">{o.score_global ?? '—'}</td><td className="px-4 py-2">{o.qualifie ? o.rang : 'éliminée'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {(contrats.data ?? []).length > 0 && (
        <section>
          <h2 className="mb-2 text-lg font-semibold">Contrat et exécution</h2>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500"><tr><th className="px-4 py-2">Lot</th><th className="px-4 py-2">Titulaire</th><th className="px-4 py-2">Montant initial</th><th className="px-4 py-2">Montant actuel</th><th className="px-4 py-2">Avenants</th><th className="px-4 py-2">Payé</th><th className="px-4 py-2">Signé le</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {contrats.data!.map((c, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2">{c.numero_lot ?? '—'}</td><td className="px-4 py-2">{c.titulaire}</td>
                    <td className="whitespace-nowrap px-4 py-2">{fcfa(c.montant_initial)}</td><td className="whitespace-nowrap px-4 py-2">{fcfa(c.montant_actuel)}</td>
                    <td className="whitespace-nowrap px-4 py-2">{fcfa(c.avenants_cumules)} <span className="text-xs text-gray-500">({pct((Number(c.avenants_cumules) / Number(c.montant_initial)) * 100)})</span></td>
                    <td className="whitespace-nowrap px-4 py-2">{fcfa(c.montant_paye)}</td><td className="px-4 py-2">{dateFr(c.date_signature)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </PublicShell>
  )
}
