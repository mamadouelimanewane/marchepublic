import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { fcfa } from '@/lib/format'
import { Badge, Card, DataTable, PageHeader } from '@/components/ui'
import { WorkflowBadge } from '@/components/workflow/WorkflowBadge'

export const dynamic = 'force-dynamic'

export default async function ExecutionListPage() {
  await requireSession('/dashboard/execution')
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.from('tenders')
    .select('id, reference, title, current_phase, montant_attribue, taux_avancement, montant_avenants_cumule, montant_soustrait_cumule')
    .in('current_phase', ['PHASE_12_SIGNATURE_CONTRAT', 'PHASE_13_EXECUTION', 'PHASE_14_RECEPTION_PAIEMENT'])
    .order('created_at', { ascending: false })
  const pct = (part: number | null, whole: number | null) => (whole ? `${((Number(part ?? 0) / Number(whole)) * 100).toFixed(1)} %` : '—')
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title="Contrats et exécution" subtitle="Signature, garanties, ordres de service, avancement, avenants (plafond 30 %) et sous-traitance (plafond 40 %)." />
      <Card padded={false}>
        <DataTable rows={data} rowKey={t => t.id} empty="Aucun contrat en cours."
          columns={[
            { header: 'Référence', cell: t => <Link className="font-medium text-green-800 hover:underline" href={`/dashboard/execution/${t.id}`}>{t.reference}</Link> },
            { header: 'Objet', cell: t => t.title }, { header: 'Montant', cell: t => fcfa(t.montant_attribue), className: 'whitespace-nowrap' },
            { header: 'Avancement', cell: t => `${t.taux_avancement} %` },
            { header: 'Avenants', cell: t => <Badge tone={Number(t.montant_avenants_cumule) / Number(t.montant_attribue || 1) > 0.24 ? 'red' : 'gray'}>{pct(t.montant_avenants_cumule, t.montant_attribue)} / 30 %</Badge> },
            { header: 'Sous-traitance', cell: t => <Badge tone={Number(t.montant_soustrait_cumule) / Number(t.montant_attribue || 1) > 0.32 ? 'red' : 'gray'}>{pct(t.montant_soustrait_cumule, t.montant_attribue)} / 40 %</Badge> },
            { header: 'Phase', cell: t => <WorkflowBadge phase={t.current_phase} /> },
          ]} />
      </Card>
    </div>
  )
}
