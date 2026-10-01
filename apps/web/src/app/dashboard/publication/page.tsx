import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { dateFr, fcfa } from '@/lib/format'
import { Badge, Card, DataTable, PageHeader } from '@/components/ui'
import { WorkflowBadge } from '@/components/workflow/WorkflowBadge'

export const dynamic = 'force-dynamic'

export default async function PublicationListPage() {
  await requireSession('/dashboard/publication')
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.from('tenders')
    .select('id, reference, title, mode_passation, montant_estime, current_phase, date_publication, date_limite_depot, bid_public_key')
    .in('current_phase', ['PHASE_4_PUBLICATION', 'PHASE_5_CLARIFICATIONS', 'PHASE_6_DEPOT_OFFRES'])
    .order('date_limite_depot', { ascending: true })
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title="Publication, clarifications et additifs" subtitle="Lancement de l'appel d'offres, questions-réponses diffusées à tous les candidats, additifs horodatés." />
      <Card padded={false}>
        <DataTable rows={data} rowKey={t => t.id} empty="Aucun marché en cours de publication."
          columns={[
            { header: 'Référence', cell: t => <Link className="font-medium text-green-800 hover:underline" href={`/dashboard/publication/${t.id}`}>{t.reference}</Link> },
            { header: 'Objet', cell: t => t.title }, { header: 'Mode', cell: t => t.mode_passation },
            { header: 'Montant', cell: t => fcfa(t.montant_estime), className: 'whitespace-nowrap' },
            { header: 'Publication', cell: t => dateFr(t.date_publication) }, { header: 'Limite de dépôt', cell: t => dateFr(t.date_limite_depot, true) },
            { header: 'Clé', cell: t => t.bid_public_key ? <Badge tone="green">Générée</Badge> : <Badge tone="amber">Manquante</Badge> },
            { header: 'Phase', cell: t => <WorkflowBadge phase={t.current_phase} /> },
          ]} />
      </Card>
    </div>
  )
}
