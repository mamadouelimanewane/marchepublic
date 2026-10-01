import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { dateFr, fcfa } from '@/lib/format'
import { Badge, Card, DataTable, PageHeader } from '@/components/ui'
import { WorkflowBadge } from '@/components/workflow/WorkflowBadge'

export const dynamic = 'force-dynamic'

export default async function AttributionListPage() {
  const session = await requireSession('/dashboard/attribution')
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.from('tenders')
    .select('id, reference, title, current_phase, montant_attribue, date_fin_recours, has_appeal_pending, arcop_decision')
    .in('current_phase', ['PHASE_9_ATTRIBUTION_PROVISOIRE', 'PHASE_10_RECOURS', 'PHASE_11_ATTRIBUTION_DEFINITIVE', 'PHASE_12_SIGNATURE_CONTRAT'])
    .order('created_at', { ascending: false })
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title="Attribution" subtitle={session.role === 'SOUMISSIONNAIRE' ? 'Décisions d\'attribution des marchés auxquels vous avez candidaté.' : 'Attribution provisoire, délai de recours, approbation DCMP et attribution définitive.'} />
      <Card padded={false}>
        <DataTable rows={data} rowKey={t => t.id} empty="Aucun marché à cette étape."
          columns={[
            { header: 'Référence', cell: t => <Link className="font-medium text-green-800 hover:underline" href={`/dashboard/attribution/${t.id}`}>{t.reference}</Link> },
            { header: 'Objet', cell: t => t.title }, { header: 'Montant attribué', cell: t => fcfa(t.montant_attribue), className: 'whitespace-nowrap' },
            { header: 'Fin du délai de recours', cell: t => dateFr(t.date_fin_recours, true) },
            { header: 'Recours', cell: t => t.has_appeal_pending ? <Badge tone="red">Pendant</Badge> : t.arcop_decision ?? '—' },
            { header: 'Phase', cell: t => <WorkflowBadge phase={t.current_phase} /> },
          ]} />
      </Card>
    </div>
  )
}
