import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { dateFr, fcfa } from '@/lib/format'
import { Badge, Card, DataTable, PageHeader } from '@/components/ui'
import { WorkflowBadge } from '@/components/workflow/WorkflowBadge'

export const dynamic = 'force-dynamic'

export default async function DcmpPage() {
  const session = await requireSession('/dashboard/dcmp')
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.from('tenders')
    .select('id, reference, title, mode_passation, montant_estime, current_phase, transmis_dcmp_at, is_cofinance, institutions(name)')
    .in('current_phase', ['PHASE_2_REDACTION', 'PHASE_3_VALIDATION_PRIORI', 'PHASE_11_ATTRIBUTION_DEFINITIVE'])
    .order('transmis_dcmp_at', { ascending: true, nullsFirst: false })

  const rows = (data ?? []).filter(t => t.current_phase !== 'PHASE_2_REDACTION' || t.mode_passation === 'ENTENTE_DIRECTE')
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title={session.role === 'BAILLEUR' ? 'Non-objection du bailleur' : 'Contrôle a priori — DCMP'}
        subtitle="Avis de non-objection avant publication (phase 3), dérogations (entente directe) et approbation des attributions (phase 11)." />
      <Card padded={false}>
        <DataTable rows={rows as never[]} rowKey={(t: { id: string }) => t.id} empty="Aucun dossier à examiner."
          columns={[
            { header: 'Référence', cell: (t: any) => <Link className="font-medium text-green-800 hover:underline" href={`/dashboard/dcmp/${t.id}`}>{t.reference}</Link> },
            { header: 'Objet', cell: (t: any) => t.title },
            { header: 'Autorité', cell: (t: any) => t.institutions?.name },
            { header: 'Mode', cell: (t: any) => t.mode_passation },
            { header: 'Montant', cell: (t: any) => fcfa(t.montant_estime), className: 'whitespace-nowrap' },
            { header: 'Transmis le', cell: (t: any) => dateFr(t.transmis_dcmp_at) },
            { header: 'Objet de l\'examen', cell: (t: any) => (
              <span className="flex flex-col gap-1">
                <WorkflowBadge phase={t.current_phase} />
                {t.is_cofinance && <Badge tone="purple">Cofinancé</Badge>}
              </span>
            ) },
          ]} />
      </Card>
    </div>
  )
}
