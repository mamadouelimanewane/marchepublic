import { notFound } from 'next/navigation'
import { requireSession } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { dateFr, fcfa } from '@/lib/format'
import { PrintButton } from '@/components/PrintButton'

export const dynamic = 'force-dynamic'

/** Procès-verbal d'ouverture des plis — généré depuis les données de la base, imprimable (Ctrl+P → PDF). */
export default async function PvOuverturePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await requireSession('/dashboard/evaluation')
  const supabase = await createSupabaseServerClient()
  const { data: t } = await supabase.from('tenders').select('id, reference, title, date_limite_depot, institutions(name)').eq('id', id).maybeSingle()
  if (!t) notFound()
  const [opening, bids, members] = await Promise.all([
    supabase.from('bid_openings').select('opened_at, nb_plis, observations, key_fingerprint, opened_by, president_id').eq('tender_id', id).maybeSingle(),
    supabase.from('bids').select('id, status, montant_offre, submitted_at, motif_non_conformite, users:soumissionnaire_id(full_name, ninea)').eq('tender_id', id).order('submitted_at'),
    supabase.from('commission_members').select('role_commission, users(full_name)').eq('tender_id', id),
  ])
  if (!opening.data) notFound()

  return (
    <article className="mx-auto max-w-3xl bg-white p-8 text-sm leading-relaxed shadow-sm print:shadow-none">
      <div className="mb-6 flex items-start justify-between print:hidden"><PrintButton /></div>
      <header className="mb-6 text-center">
        <p className="text-xs uppercase tracking-widest text-gray-500">République du Sénégal — Un Peuple, Un But, Une Foi</p>
        <h1 className="mt-2 text-xl font-bold">PROCÈS-VERBAL D'OUVERTURE DES PLIS</h1>
        <p className="text-gray-600">{(t.institutions as unknown as { name: string } | null)?.name}</p>
      </header>
      <p><strong>Marché :</strong> {t.reference} — {t.title}</p>
      <p><strong>Date limite de dépôt :</strong> {dateFr(t.date_limite_depot, true)}</p>
      <p><strong>Ouverture effective :</strong> {dateFr(opening.data.opened_at, true)} — {opening.data.nb_plis} pli(s) reçu(s) dans les délais</p>
      <p className="break-all"><strong>Empreinte de la clé publique du marché :</strong> <code className="text-xs">{opening.data.key_fingerprint}</code></p>

      <h2 className="mb-2 mt-6 font-semibold">Commission</h2>
      <ul className="list-disc pl-5">{(members.data ?? []).map((m: any, i) => <li key={i}>{m.users?.full_name} — {m.role_commission}</li>)}</ul>

      <h2 className="mb-2 mt-6 font-semibold">Offres</h2>
      <table className="w-full border-collapse text-xs">
        <thead><tr className="bg-gray-100 text-left"><th className="border p-2">Candidat</th><th className="border p-2">NINEA</th><th className="border p-2">Reçue le</th><th className="border p-2">Montant lu</th><th className="border p-2">Statut</th></tr></thead>
        <tbody>
          {(bids.data ?? []).map((b: any) => (
            <tr key={b.id}><td className="border p-2">{b.users?.full_name}</td><td className="border p-2">{b.users?.ninea ?? '—'}</td><td className="border p-2">{dateFr(b.submitted_at, true)}</td>
              <td className="border p-2">{fcfa(b.montant_offre)}</td><td className="border p-2">{b.status}{b.motif_non_conformite ? ` — ${b.motif_non_conformite}` : ''}</td></tr>
          ))}
        </tbody>
      </table>
      {opening.data.observations && <p className="mt-4"><strong>Observations :</strong> {opening.data.observations}</p>}
      <p className="mt-10 text-xs text-gray-500">Document généré par la plateforme à partir du journal d'audit ; les signatures électroniques de l'ouverture (CPM et président) sont enregistrées dans la base avec horodatage serveur.</p>
    </article>
  )
}
