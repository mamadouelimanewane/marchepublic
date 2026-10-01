import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { dateFr, fcfa } from '@/lib/format'
import { Badge, Card, DataTable, PageHeader } from '@/components/ui'
import { WorkflowBadge } from '@/components/workflow/WorkflowBadge'

export const dynamic = 'force-dynamic'

export default async function MesOffresPage() {
  await requireSession('/dashboard/mes-offres')
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.from('bids')
    .select('id, status, submitted_at, montant_offre, lots:lot_id(numero_lot), tenders(id, reference, title, current_phase, has_appeal_pending, date_fin_recours)').order('submitted_at', { ascending: false })
  const { data: rankings } = await supabase.from('bid_rankings').select('bid_id, rang, score_global, qualifie')
  const rk = new Map((rankings ?? []).map(r => [r.bid_id, r]))

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title="Mes offres et mes contrats" subtitle="Suivi de votre dossier uniquement : vous ne voyez jamais les offres des autres candidats." />
      <Card padded={false}>
        <DataTable rows={data as never[]} rowKey={(b: { id: string }) => b.id} empty="Vous n'avez déposé aucune offre."
          columns={[
            { header: 'Marché', cell: (b: any) => <Link className="font-medium text-green-800 hover:underline" href={`/avis/${b.tenders?.id}`}>{b.tenders?.reference}</Link> },
            { header: 'Objet', cell: (b: any) => <span>{b.tenders?.title}{b.lots && <Badge tone="blue" className="ml-2">Lot {b.lots.numero_lot}</Badge>}</span> },
            { header: 'Déposée le', cell: (b: any) => dateFr(b.submitted_at, true) },
            { header: 'Mon offre', cell: (b: any) => <Badge tone={b.status === 'PROVISOIREMENT_RETENUE' || b.status === 'RETENUE_DEFINITIVE' ? 'green' : b.status === 'RETARDEE' || b.status === 'REJETEE' || b.status === 'NON_CONFORME' ? 'red' : 'blue'}>{b.status}</Badge> },
            { header: 'Classement', cell: (b: any) => rk.get(b.id) ? `${rk.get(b.id)!.qualifie ? `Rang ${rk.get(b.id)!.rang}` : 'Éliminée'} — ${rk.get(b.id)!.score_global ?? '—'} pts` : '—' },
            { header: 'Phase du marché', cell: (b: any) => b.tenders ? <WorkflowBadge phase={b.tenders.current_phase} /> : '—' },
            { header: 'Recours', cell: (b: any) => b.tenders?.current_phase === 'PHASE_10_RECOURS' && b.status !== 'PROVISOIREMENT_RETENUE'
              ? <Link className="text-xs font-semibold text-red-700 hover:underline" href={`/dashboard/recours/${b.tenders.id}`}>Délai jusqu'au {dateFr(b.tenders.date_fin_recours)} →</Link> : '—' },
          ]} />
      </Card>
      <p className="text-xs text-gray-400">Montants et classement ne sont communiqués qu'après l'attribution provisoire.</p>
    </div>
  )
}
