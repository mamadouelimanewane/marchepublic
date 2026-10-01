import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { dateFr, fcfa } from '@/lib/format'
import { Card, DataTable, PageHeader } from '@/components/ui'
import { WorkflowBadge } from '@/components/workflow/WorkflowBadge'

export const dynamic = 'force-dynamic'

export default async function EvaluationListPage() {
  await requireSession('/dashboard/evaluation')
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.from('tenders')
    .select('id, reference, title, current_phase, montant_estime, date_limite_depot, evaluation_round')
    .in('current_phase', ['PHASE_7_OUVERTURE_PLIS', 'PHASE_8_EVALUATION', 'PHASE_9_ATTRIBUTION_PROVISOIRE'])
    .order('date_limite_depot')
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title="Ouverture des plis et évaluation" subtitle="Ouverture à double signature, déchiffrement local, conformité administrative, notation par la commission et classement calculé par le serveur." />
      <Card padded={false}>
        <DataTable rows={data} rowKey={t => t.id} empty="Aucun marché en phase d'ouverture ou d'évaluation."
          columns={[
            { header: 'Référence', cell: t => <Link className="font-medium text-green-800 hover:underline" href={`/dashboard/evaluation/${t.id}`}>{t.reference}</Link> },
            { header: 'Objet', cell: t => t.title }, { header: 'Montant estimé', cell: t => fcfa(t.montant_estime), className: 'whitespace-nowrap' },
            { header: 'Date limite', cell: t => dateFr(t.date_limite_depot, true) }, { header: 'Ronde', cell: t => t.evaluation_round },
            { header: 'Phase', cell: t => <WorkflowBadge phase={t.current_phase} /> },
          ]} />
      </Card>
    </div>
  )
}
