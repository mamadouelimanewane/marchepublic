import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Badge, Card, DataTable, PageHeader } from '@/components/ui'

export const dynamic = 'force-dynamic'

const LABELS: Record<string, { label: string; tone: 'red' | 'amber' | 'blue' }> = {
  RETARD_PPM: { label: 'Retard de calendrier', tone: 'amber' },
  GARANTIE_EXPIRE_BIENTOT: { label: 'Garantie à échéance', tone: 'amber' },
  AVENANT_PROCHE_PLAFOND: { label: 'Avenants proches du plafond', tone: 'red' },
  PAIEMENT_EN_ATTENTE: { label: 'Paiement en souffrance', tone: 'amber' },
  RECOURS_A_INSTRUIRE: { label: 'Recours à instruire', tone: 'red' },
}

export default async function AlertesPage() {
  await requireSession('/dashboard/alertes')
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.from('v_alertes').select('tender_id, reference, type_alerte, message')
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="Alertes" subtitle="Retards par rapport au PPM, garanties à échéance, plafonds d'avenants, paiements en souffrance, recours à instruire."
        actions={<a className="text-sm font-medium text-green-700 hover:underline" href="/api/reporting/export?vue=v_alertes">Exporter (CSV)</a>} />
      <Card padded={false}>
        <DataTable rows={data} rowKey={a => `${a.tender_id}-${a.type_alerte}-${a.message}`} empty="Aucune alerte active."
          columns={[
            { header: 'Type', cell: a => <Badge tone={LABELS[a.type_alerte]?.tone ?? 'blue'}>{LABELS[a.type_alerte]?.label ?? a.type_alerte}</Badge> },
            { header: 'Marché', cell: a => <Link className="font-medium text-green-800 hover:underline" href={`/dashboard/marches/${a.tender_id}`}>{a.reference}</Link> },
            { header: 'Détail', cell: a => a.message },
          ]} />
      </Card>
    </div>
  )
}
