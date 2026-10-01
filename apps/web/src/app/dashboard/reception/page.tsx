import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { fcfa } from '@/lib/format'
import { Badge, Card, DataTable, PageHeader } from '@/components/ui'
import { WorkflowBadge } from '@/components/workflow/WorkflowBadge'

export const dynamic = 'force-dynamic'

export default async function ReceptionListPage() {
  await requireSession('/dashboard/reception')
  const supabase = await createSupabaseServerClient()
  const [tenders, pay] = await Promise.all([
    supabase.from('tenders').select('id, reference, title, current_phase, montant_attribue').in('current_phase', ['PHASE_13_EXECUTION', 'PHASE_14_RECEPTION_PAIEMENT']).order('created_at', { ascending: false }),
    supabase.from('v_paiements').select('tender_id, statut, montant, delai_jours'),
  ])
  const pending = (id: string) => (pay.data ?? []).filter(p => p.tender_id === id && !['PAYE', 'REJETE'].includes(p.statut))
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title="Réception et paiements" subtitle="PV de réception provisoire et définitive, décomptes, visa du contrôle financier et transmission au Trésor." />
      <Card padded={false}>
        <DataTable rows={tenders.data} rowKey={t => t.id} empty="Aucun marché en exécution ou en réception."
          columns={[
            { header: 'Référence', cell: t => <Link className="font-medium text-green-800 hover:underline" href={`/dashboard/reception/${t.id}`}>{t.reference}</Link> },
            { header: 'Objet', cell: t => t.title }, { header: 'Montant', cell: t => fcfa(t.montant_attribue), className: 'whitespace-nowrap' },
            { header: 'Décomptes en attente', cell: t => pending(t.id).length ? <Badge tone="amber">{pending(t.id).length} — {fcfa(pending(t.id).reduce((s, p) => s + Number(p.montant), 0))}</Badge> : '—' },
            { header: 'Phase', cell: t => <WorkflowBadge phase={t.current_phase} /> },
          ]} />
      </Card>
    </div>
  )
}
