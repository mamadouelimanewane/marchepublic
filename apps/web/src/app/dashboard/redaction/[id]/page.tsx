import Link from 'next/link'
import { notFound } from 'next/navigation'
import { seuilAoo, type TypeInstitution } from '@marchepublic/workflow'
import { requireSession } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { dateFr, fcfa } from '@/lib/format'
import { Alert, Badge, Card, Field, Grid, PageHeader } from '@/components/ui'
import { ActionButton, ActionForm } from '@/components/ActionForm'
import { DocumentEditor, type ClauseOption, type Section } from '@/components/DocumentEditor'
import { WorkflowBadge } from '@/components/workflow/WorkflowBadge'
import { tenderVariables } from '@/lib/redaction'
import { addDocumentComment, createDocument, setDocumentCircuit } from '../../actions/passation'

export const dynamic = 'force-dynamic'

const CIRCUIT_TONE = { REDACTION: 'gray', RELECTURE_CPM: 'amber', VALIDE_PRM: 'green', TRANSMIS_DCMP: 'blue', PUBLIE: 'teal' } as const

export default async function RedactionTenderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await requireSession('/dashboard/redaction')
  const supabase = await createSupabaseServerClient()

  const { data: t } = await supabase.from('tenders')
    .select('id, reference, title, nature_marche, mode_passation, mode_suggere, montant_estime, ligne_budgetaire, current_phase, corps_metier_id, is_alloti, institutions(type)').eq('id', id).maybeSingle()
  if (!t) notFound()

  const [docs, templates, clauses, versions, comments] = await Promise.all([
    supabase.from('tender_documents').select('id, titre, type, contenu, circuit_statut, is_locked').eq('tender_id', id).in('type', ['TDR', 'DAO']).order('created_at'),
    supabase.from('document_templates').select('id, titre, type, nature_marche, corps_metier_id, mode_passation').eq('is_active', true),
    supabase.from('clause_templates').select('code, titre, contenu, obligatoire, natures').eq('is_active', true),
    supabase.from('document_versions').select('document_id, version, circuit_statut, content_hash, created_at, author_id').eq('tender_id', id).order('version', { ascending: false }),
    supabase.from('document_comments').select('id, document_id, contenu, created_at, users:author_id(full_name)').eq('tender_id', id).order('created_at'),
  ])

  const editablePhase = t.current_phase === 'PHASE_1_PROGRAMMATION' || t.current_phase === 'PHASE_2_REDACTION'
  const instType = ((t.institutions as unknown as { type: string } | null)?.type ?? 'ETAT') as TypeInstitution
  const seuil = seuilAoo(instType, t.nature_marche)
  const suggestedTemplates = (templates.data ?? []).filter(x =>
    (!x.nature_marche || x.nature_marche === t.nature_marche) && (!x.corps_metier_id || x.corps_metier_id === t.corps_metier_id) && (!x.mode_passation || x.mode_passation === t.mode_passation))
  const clauseOptions: ClauseOption[] = (clauses.data ?? [])
    .filter(c => !c.natures || c.natures.includes(t.nature_marche)).map(c => ({ code: c.code, titre: c.titre, contenu: c.contenu, obligatoire: c.obligatoire, natures: c.natures }))
  const variables = await tenderVariables(supabase, id)
  const lotsAdvice = !t.is_alloti && Number(t.montant_estime ?? 0) >= 2 * seuil && ['TRAVAUX', 'FOURNITURES'].includes(t.nature_marche)

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title={`Rédaction — ${t.reference}`} subtitle={t.title}
        actions={<><WorkflowBadge phase={t.current_phase} /><Link href={`/dashboard/marches/${id}`} className="text-sm text-green-700 hover:underline">Fiche du marché →</Link></>} />

      <Card title="Assistant de qualification" subtitle="Aide à la décision — le mode réglementaire est recalculé par la base à chaque enregistrement.">
        <ul className="space-y-1 text-sm text-gray-700">
          <li>Montant estimé : <strong>{fcfa(t.montant_estime)}</strong> — seuil d'appel d'offres ouvert : <strong>{fcfa(seuil)}</strong>.</li>
          <li>Mode réglementaire suggéré : <Badge tone="blue">{t.mode_suggere ?? '—'}</Badge> — mode retenu : <Badge>{t.mode_passation ?? '—'}</Badge></li>
          {lotsAdvice && <li className="text-amber-800">⚠ Le montant dépasse deux fois le seuil : l'<strong>allotissement</strong> est recommandé (le budget-programme et l'accès des PME le favorisent).</li>}
        </ul>
      </Card>

      {!editablePhase && <Alert tone="amber">Le dossier a été transmis : il est en lecture seule (verrouillage dès la transmission à la DCMP).</Alert>}

      {editablePhase && ['SERVICE_DEMANDEUR', 'CPM', 'PRM'].includes(session.role) && (
        <Card title="Créer un document">
          <ActionForm action={createDocument} submitLabel="Créer" redirectPattern={undefined}>
            <input type="hidden" name="tender_id" value={id} />
            <Grid cols={3}>
              <Field label="Type" name="type" required defaultValue="DAO" options={[{ value: 'DAO', label: 'Dossier d\'appel d\'offres' }, { value: 'TDR', label: 'Termes de référence' }]} />
              <Field label="Titre" name="titre" required />
              <Field label="Modèle" name="template_id" options={suggestedTemplates.map(x => ({ value: x.id, label: x.titre }))} hint="Modèles filtrés selon nature, corps de métier et mode" />
            </Grid>
          </ActionForm>
        </Card>
      )}

      {(docs.data ?? []).map(d => {
        const sections = ((d.contenu as { sections?: Section[] })?.sections ?? []) as Section[]
        const readOnly = !editablePhase || d.is_locked || d.circuit_statut === 'VALIDE_PRM' || !['SERVICE_DEMANDEUR', 'CPM', 'PRM'].includes(session.role)
        const myVersions = (versions.data ?? []).filter(v => v.document_id === d.id)
        const myComments = (comments.data ?? []).filter(c => c.document_id === d.id)
        return (
          <Card key={d.id} title={<span className="flex items-center gap-2">{d.titre} <Badge>{d.type}</Badge> <Badge tone={CIRCUIT_TONE[d.circuit_statut as keyof typeof CIRCUIT_TONE]}>{d.circuit_statut}</Badge>{d.is_locked && ' 🔒'}</span>}
            actions={(
              <span className="flex flex-wrap items-center gap-2">
                <a href={`/api/pdf/document/${d.id}`} target="_blank" rel="noreferrer" className="text-sm font-medium text-green-700 hover:underline">PDF</a>
                {editablePhase && !d.is_locked && <>
                {d.circuit_statut === 'REDACTION' && <ActionButton label="Transmettre à la CPM" variant="secondary" action={setDocumentCircuit.bind(null, d.id, 'RELECTURE_CPM')} />}
                {d.circuit_statut === 'RELECTURE_CPM' && ['CPM', 'PRM'].includes(session.role) && <ActionButton label="Renvoyer en rédaction" variant="secondary" action={setDocumentCircuit.bind(null, d.id, 'REDACTION')} />}
                {d.circuit_statut === 'RELECTURE_CPM' && session.role === 'PRM' && <ActionButton label="Valider (PRM)" action={setDocumentCircuit.bind(null, d.id, 'VALIDE_PRM')} confirm="Valider ce document ? Il ne sera plus modifiable sans renvoi en rédaction." />}
                {d.circuit_statut === 'VALIDE_PRM' && session.role === 'PRM' && <ActionButton label="Rouvrir la rédaction" variant="secondary" action={setDocumentCircuit.bind(null, d.id, 'REDACTION')} />}
                </>}
              </span>
            )}>
            <DocumentEditor documentId={d.id} type={d.type as 'TDR' | 'DAO'} nature={t.nature_marche} ligneBudgetaire={t.ligne_budgetaire} initial={sections}
              clauses={clauseOptions} variables={variables} readOnly={readOnly} />

            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <div>
                <h3 className="mb-2 text-sm font-semibold text-gray-700">Historique des versions (immuable)</h3>
                <ul className="max-h-48 space-y-1 overflow-auto text-xs text-gray-600">
                  {myVersions.map(v => (
                    <li key={v.version} className="flex justify-between rounded bg-gray-50 px-2 py-1">
                      <span>v{v.version} — {v.circuit_statut}</span><span title={v.content_hash}>{dateFr(v.created_at, true)} · {v.content_hash.slice(0, 8)}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold text-gray-700">Commentaires</h3>
                <ul className="mb-2 max-h-40 space-y-1 overflow-auto text-sm">
                  {myComments.map((c: any) => <li key={c.id} className="rounded bg-gray-50 px-2 py-1"><strong>{c.users?.full_name}</strong> <span className="text-xs text-gray-400">{dateFr(c.created_at, true)}</span><br />{c.contenu}</li>)}
                  {!myComments.length && <li className="text-xs text-gray-400">Aucun commentaire.</li>}
                </ul>
                <ActionForm action={addDocumentComment.bind(null, d.id, id)} submitLabel="Commenter" variant="secondary">
                  <Field label="Nouveau commentaire" name="contenu" rows={2} required />
                </ActionForm>
              </div>
            </div>
          </Card>
        )
      })}
      {!docs.data?.length && <Alert>Aucun document pour ce marché. Créez un TDR ou un DAO à partir d'un modèle.</Alert>}
    </div>
  )
}
