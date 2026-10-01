import { requireSession } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { dateFr } from '@/lib/format'
import { PIECE_LABELS, SITUATION_LABEL, SITUATION_TONE } from '@/lib/pieces'
import { Alert, Badge, Card, DataTable, PageHeader } from '@/components/ui'
import { ActionButton } from '@/components/ActionForm'
import { DocLink } from '@/components/DocLink'
import { SupplierDocUpload } from '@/components/SupplierDocUpload'
import { deleteSupplierDocument } from '../actions/fournisseur'

export const dynamic = 'force-dynamic'

export default async function MesDocumentsPage() {
  const session = await requireSession('/dashboard/mes-documents')
  const supabase = await createSupabaseServerClient()
  const [docs, pieces] = await Promise.all([
    supabase.from('supplier_documents').select('id, type, titre, date_emission, date_expiration, statut, motif_refus, created_at').order('created_at', { ascending: false }),
    supabase.rpc('supplier_pieces', { p_user: session.id }),
  ])
  const missing = ((pieces.data ?? []) as { type: string; situation: string }[]).filter(p => p.situation !== 'VALIDE')

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Mon dossier permanent" subtitle="Déposez vos pièces administratives une seule fois : elles sont vérifiées par l'administration et réutilisées pour toutes vos candidatures, avec alerte avant expiration." />

      <Card title="Pièces requises pour être réputé en règle">
        <ul className="grid gap-2 sm:grid-cols-3">
          {((pieces.data ?? []) as { type: string; situation: string; date_expiration: string | null }[]).map(p => (
            <li key={p.type} className="rounded-lg border border-gray-200 p-3">
              <p className="text-sm font-medium text-gray-800">{PIECE_LABELS[p.type] ?? p.type}</p>
              <Badge tone={SITUATION_TONE[p.situation] ?? 'gray'}>{SITUATION_LABEL[p.situation] ?? p.situation}</Badge>
              {p.date_expiration && <p className="mt-1 text-xs text-gray-500">Expire le {dateFr(p.date_expiration)}</p>}
            </li>
          ))}
        </ul>
        {missing.length > 0 && <div className="mt-4"><Alert tone="amber">Il manque ou il reste à vérifier : {missing.map(m => PIECE_LABELS[m.type] ?? m.type).join(', ')}. Votre offre sera jugée conforme administrativement seulement si ces pièces sont valides à la date limite de dépôt.</Alert></div>}
      </Card>

      <Card title="Déposer une pièce"><SupplierDocUpload userId={session.id} /></Card>

      <Card title="Mes pièces" padded={false}>
        <DataTable rows={docs.data} rowKey={d => d.id} empty="Aucune pièce déposée."
          columns={[
            { header: 'Pièce', cell: d => <span><strong>{d.titre}</strong><br /><span className="text-xs text-gray-500">{PIECE_LABELS[d.type] ?? d.type}</span></span> },
            { header: 'Émission', cell: d => dateFr(d.date_emission) }, { header: 'Expiration', cell: d => dateFr(d.date_expiration) },
            { header: 'Statut', cell: d => <span><Badge tone={d.statut === 'VERIFIE' ? 'green' : d.statut === 'REFUSE' ? 'red' : 'amber'}>{d.statut}</Badge>{d.motif_refus && <span className="ml-2 text-xs text-red-700">{d.motif_refus}</span>}</span> },
            { header: '', cell: d => <span className="flex gap-3"><DocLink docId={d.id} />{d.statut === 'DEPOSE' && <ActionButton variant="secondary" label="Supprimer" action={deleteSupplierDocument.bind(null, d.id)} confirm="Supprimer cette pièce ?" />}</span> },
          ]} />
      </Card>
    </div>
  )
}
