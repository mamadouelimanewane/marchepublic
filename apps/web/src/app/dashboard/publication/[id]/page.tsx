import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireSession } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { dateFr } from '@/lib/format'
import { Alert, Badge, Card, DataTable, Field, PageHeader } from '@/components/ui'
import { ActionForm } from '@/components/ActionForm'
import { WorkflowBadge } from '@/components/workflow/WorkflowBadge'
import { answerQuestion, publishAddendum } from '../../actions/passation'

export const dynamic = 'force-dynamic'

export default async function PublicationTenderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await requireSession('/dashboard/publication')
  const supabase = await createSupabaseServerClient()
  const { data: t } = await supabase.from('tenders').select('id, reference, title, current_phase, date_publication, date_limite_depot').eq('id', id).maybeSingle()
  if (!t) notFound()

  const [qr, retraits, addenda] = await Promise.all([
    supabase.from('clarifications').select('id, question, reponse, publie, created_at, repondu_le').eq('tender_id', id).order('created_at'),
    supabase.from('dossier_retraits').select('soumissionnaire_id, retire_le, users:soumissionnaire_id(full_name, ninea)').eq('tender_id', id).order('retire_le'),
    supabase.from('tender_documents').select('id, titre, created_at').eq('tender_id', id).eq('type', 'ADDITIF').order('created_at'),
  ])
  const canAct = ['CPM', 'PRM'].includes(session.role)
  const open = ['PHASE_5_CLARIFICATIONS', 'PHASE_6_DEPOT_OFFRES'].includes(t.current_phase)
  const pending = (qr.data ?? []).filter(q => !q.reponse)

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title={`Publication — ${t.reference}`} subtitle={t.title}
        actions={<><WorkflowBadge phase={t.current_phase} /><Link href={`/dashboard/marches/${id}`} className="text-sm text-green-700 hover:underline">Fiche du marché (calendrier, clé, avancement) →</Link></>} />

      {t.current_phase === 'PHASE_4_PUBLICATION' && <Alert tone="blue">L'avis a reçu la non-objection de la DCMP. Utilisez la fiche du marché pour <strong>publier l'avis</strong> (l'horodatage de publication est posé par le serveur).</Alert>}

      <Card title={`Questions des candidats (${pending.length} sans réponse)`} subtitle="Toute réponse est diffusée à l'ensemble des candidats, sans divulguer l'auteur de la question." padded={false}>
        <ul className="divide-y divide-gray-100">
          {(qr.data ?? []).map(q => (
            <li key={q.id} className="space-y-2 px-5 py-4">
              <p className="text-sm font-medium text-gray-800">Q : {q.question}</p>
              <p className="text-xs text-gray-400">Posée le {dateFr(q.created_at, true)}</p>
              {q.reponse ? (
                <p className="rounded bg-green-50 p-2 text-sm text-green-900">R : {q.reponse} <Badge tone="green">Publiée {dateFr(q.repondu_le)}</Badge></p>
              ) : canAct && open ? (
                <ActionForm action={answerQuestion} submitLabel="Publier la réponse" className="space-y-2">
                  <input type="hidden" name="id" value={q.id} />
                  <Field label="Réponse" name="reponse" rows={2} required />
                </ActionForm>
              ) : <Badge tone="amber">En attente de réponse</Badge>}
            </li>
          ))}
          {!qr.data?.length && <li className="px-5 py-8 text-center text-sm text-gray-500">Aucune question.</li>}
        </ul>
      </Card>

      <Card title="Additifs au dossier" subtitle="Un additif est publié immédiatement, verrouillé, horodaté et notifié aux candidats ayant retiré le dossier.">
        <ul className="mb-4 space-y-1 text-sm">
          {(addenda.data ?? []).map(a => <li key={a.id} className="rounded bg-gray-50 px-3 py-1">{a.titre} <span className="text-xs text-gray-400">— {dateFr(a.created_at, true)}</span></li>)}
          {!addenda.data?.length && <li className="text-gray-500">Aucun additif.</li>}
        </ul>
        {canAct && open && (
          <ActionForm action={publishAddendum.bind(null, id)} submitLabel="Publier l'additif" confirm="Publier cet additif ? Il sera irrévocable et notifié à tous les candidats.">
            <Field label="Titre" name="titre" required />
            <Field label="Contenu" name="contenu" rows={4} required />
          </ActionForm>
        )}
      </Card>

      <Card title={`Dossier retiré par ${retraits.data?.length ?? 0} candidat(s)`} padded={false}>
        <DataTable rows={retraits.data as never[]} rowKey={(r: { soumissionnaire_id: string }) => r.soumissionnaire_id} empty="Aucun retrait pour le moment."
          columns={[{ header: 'Candidat', cell: (r: any) => r.users?.full_name ?? '—' }, { header: 'NINEA', cell: (r: any) => r.users?.ninea ?? '—' }, { header: 'Retiré le', cell: (r: any) => dateFr(r.retire_le, true) }]} />
      </Card>
    </div>
  )
}
