import { requireSession } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { dateFr } from '@/lib/format'
import { PIECE_LABELS } from '@/lib/pieces'
import { Badge, Card, DataTable, PageHeader } from '@/components/ui'
import { ActionForm } from '@/components/ActionForm'
import { DocLink } from '@/components/DocLink'
import { reviewSupplierDocument } from '../actions/fournisseur'

export const dynamic = 'force-dynamic'

export default async function PiecesPage() {
  await requireSession('/dashboard/pieces')
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.from('supplier_documents')
    .select('id, type, titre, date_emission, date_expiration, statut, created_at, users:user_id(full_name, ninea)')
    .eq('statut', 'DEPOSE').order('created_at').limit(200)
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title="Pièces fournisseurs à vérifier" subtitle="Vérifiez la pièce (lisibilité, concordance avec le NINEA, dates). Un refus est motivé et notifié au fournisseur ; une pièce vérifiée est réutilisée pour toutes ses candidatures." />
      <Card padded={false}>
        <DataTable rows={data as never[]} rowKey={(d: { id: string }) => d.id} empty="Aucune pièce en attente."
          columns={[
            { header: 'Fournisseur', cell: (d: any) => <span><strong>{d.users?.full_name}</strong><br /><span className="text-xs text-gray-500">NINEA {d.users?.ninea ?? '—'}</span></span> },
            { header: 'Pièce', cell: (d: any) => <span>{d.titre}<br /><Badge>{PIECE_LABELS[d.type] ?? d.type}</Badge></span> },
            { header: 'Validité', cell: (d: any) => `${dateFr(d.date_emission)} → ${dateFr(d.date_expiration)}` },
            { header: 'Déposée', cell: (d: any) => dateFr(d.created_at, true) },
            { header: 'Fichier', cell: (d: any) => <DocLink docId={d.id} /> },
            { header: 'Décision', cell: (d: any) => (
              <span className="flex flex-wrap items-end gap-2">
                <ActionForm action={reviewSupplierDocument.bind(null, d.id)} submitLabel="Vérifier" className="space-y-0"><input type="hidden" name="statut" value="VERIFIE" /></ActionForm>
                <ActionForm action={reviewSupplierDocument.bind(null, d.id)} submitLabel="Refuser" variant="danger" className="flex items-end gap-2 space-y-0">
                  <input type="hidden" name="statut" value="REFUSE" />
                  <input name="motif" required minLength={10} placeholder="Motif du refus" aria-label="Motif" className="w-48 rounded border border-gray-300 px-2 py-1.5 text-xs" />
                </ActionForm>
              </span>) },
          ]} />
      </Card>
    </div>
  )
}
