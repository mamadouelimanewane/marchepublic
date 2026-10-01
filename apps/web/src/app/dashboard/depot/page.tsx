import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { dateFr } from '@/lib/format'
import { Badge, Card, DataTable, PageHeader } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function DepotListPage() {
  await requireSession('/dashboard/depot')
  const supabase = await createSupabaseServerClient()
  const [open, mine] = await Promise.all([
    supabase.from('v_avis_publics').select('id, reference, title, institution_name, mode_passation, date_limite_depot, current_phase').eq('current_phase', 'PHASE_6_DEPOT_OFFRES').order('date_limite_depot'),
    supabase.from('bids').select('tender_id, status').in('status', ['SOUMISE', 'RETIREE', 'RETARDEE']),
  ])
  const myStatus = new Map((mine.data ?? []).map(b => [b.tender_id, b.status]))
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title="Dépôt des offres" subtitle="Appels d'offres dont le dépôt est ouvert. Le chiffrement est réalisé dans votre navigateur." />
      <Card padded={false}>
        <DataTable rows={open.data} rowKey={t => t.id} empty="Aucun dépôt ouvert actuellement. Consultez les avis publiés."
          columns={[
            { header: 'Référence', cell: t => <Link className="font-medium text-green-800 hover:underline" href={`/dashboard/depot/${t.id}`}>{t.reference}</Link> },
            { header: 'Objet', cell: t => t.title }, { header: 'Autorité', cell: t => t.institution_name }, { header: 'Mode', cell: t => t.mode_passation },
            { header: 'Limite', cell: t => <span className="font-semibold text-red-700">{dateFr(t.date_limite_depot, true)}</span> },
            { header: 'Mon offre', cell: t => myStatus.get(t.id) ? <Badge tone="green">{myStatus.get(t.id)}</Badge> : <Badge>Non déposée</Badge> },
          ]} />
      </Card>
    </div>
  )
}
