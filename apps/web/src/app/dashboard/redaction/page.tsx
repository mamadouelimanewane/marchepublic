import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { fcfa } from '@/lib/format'
import { Alert, Card, DataTable, PageHeader } from '@/components/ui'
import { WorkflowBadge } from '@/components/workflow/WorkflowBadge'

export const dynamic = 'force-dynamic'

export default async function RedactionListPage() {
  await requireSession('/dashboard/redaction')
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.from('tenders')
    .select('id, reference, title, nature_marche, mode_passation, montant_estime, current_phase')
    .in('current_phase', ['PHASE_1_PROGRAMMATION', 'PHASE_2_REDACTION', 'PHASE_3_VALIDATION_PRIORI'])
    .order('created_at', { ascending: false })

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title="Rédaction des TDR et dossiers d'appel d'offres"
        subtitle="Modèles par nature, corps de métier et mode de passation ; clauses types ; circuit Rédaction → Relecture CPM → Validation PRM ; historique des versions." />
      <Alert tone="blue">Le dossier est verrouillé dès sa transmission à la DCMP : toute modification ultérieure impose un renvoi en rédaction par un avis non favorable.</Alert>
      <Card padded={false}>
        <DataTable rows={data} rowKey={t => t.id} empty="Aucun marché en phase de programmation ou de rédaction."
          columns={[
            { header: 'Référence', cell: t => <Link className="font-medium text-green-800 hover:underline" href={`/dashboard/redaction/${t.id}`}>{t.reference}</Link> },
            { header: 'Objet', cell: t => t.title },
            { header: 'Nature', cell: t => t.nature_marche },
            { header: 'Mode', cell: t => t.mode_passation ?? '—' },
            { header: 'Montant', cell: t => fcfa(t.montant_estime), className: 'whitespace-nowrap' },
            { header: 'Phase', cell: t => <WorkflowBadge phase={t.current_phase} /> },
          ]} />
      </Card>
    </div>
  )
}
