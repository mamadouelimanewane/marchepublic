import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { dateFr } from '@/lib/format'
import { Alert, Badge, Card, DataTable, PageHeader } from '@/components/ui'
import { ActionButton } from '@/components/ActionForm'
import { archiveTender } from '../actions/execution'

export const dynamic = 'force-dynamic'

export default async function ArchivagePage() {
  const session = await requireSession('/dashboard/archivage')
  const supabase = await createSupabaseServerClient()
  const [closed, archives] = await Promise.all([
    supabase.from('tenders').select('id, reference, title, closed_at').eq('current_phase', 'PHASE_15_CLOTURE_ARCHIVAGE').order('closed_at', { ascending: false }),
    supabase.from('archives').select('id, tender_id, archived_at, manifest_hash, audit_head_hash, retention_until'),
  ])
  const arch = new Map((archives.data ?? []).map(a => [a.tender_id, a]))
  const canArchive = ['CPM', 'PRM', 'ADMIN'].includes(session.role)
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title="Clôture et archivage" subtitle="Coffre-fort horodaté : inventaire des pièces avec empreintes SHA-256 et rattachement au journal d'audit. Un dossier archivé ne peut plus être modifié." />
      <Alert tone="amber">La durée de conservation (paramètre <code>ARCHIVAGE_DUREE_ANS</code>) est à confirmer avec les textes d'archivage en vigueur.</Alert>
      <Card padded={false}>
        <DataTable rows={closed.data} rowKey={t => t.id} empty="Aucun marché clos."
          columns={[
            { header: 'Référence', cell: t => <Link className="font-medium text-green-800 hover:underline" href={`/dashboard/marches/${t.id}`}>{t.reference}</Link> },
            { header: 'Objet', cell: t => t.title }, { header: 'Clos le', cell: t => dateFr(t.closed_at, true) },
            { header: 'Archive', cell: t => arch.get(t.id) ? (
              <span className="text-xs"><Badge tone="green">Archivé {dateFr(arch.get(t.id)!.archived_at)}</Badge><br />Conservation jusqu'au {dateFr(arch.get(t.id)!.retention_until)}<br /><code title="Empreinte de l'inventaire">{arch.get(t.id)!.manifest_hash.slice(0, 16)}…</code></span>
            ) : canArchive ? <ActionButton label="Archiver" action={archiveTender.bind(null, t.id)} confirm="Archiver ce dossier ? L'inventaire sera figé." /> : <Badge tone="amber">À archiver</Badge> },
          ]} />
      </Card>
    </div>
  )
}
