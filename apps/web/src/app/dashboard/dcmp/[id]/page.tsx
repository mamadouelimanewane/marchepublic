import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireSession } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { dateFr, fcfa } from '@/lib/format'
import { Alert, Badge, Card, DataTable, DefinitionList, Field, Grid, PageHeader } from '@/components/ui'
import { ActionForm } from '@/components/ActionForm'
import { WorkflowBadge } from '@/components/workflow/WorkflowBadge'
import { recordReview } from '../../actions/passation'

export const dynamic = 'force-dynamic'

const DECISION_TONE = { FAVORABLE: 'green', DEFAVORABLE: 'red', COMPLEMENTAIRE: 'amber' } as const

export default async function DcmpReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await requireSession('/dashboard/dcmp')
  const supabase = await createSupabaseServerClient()

  const { data: t } = await supabase.from('tenders')
    .select('id, reference, title, description, nature_marche, mode_passation, mode_suggere, justification_mode, montant_estime, current_phase, is_cofinance, criteres_evaluation, transmis_dcmp_at, attributaire_id, montant_attribue, institutions(name)')
    .eq('id', id).maybeSingle()
  if (!t) notFound()

  const [docs, reviews, ranking] = await Promise.all([
    supabase.from('tender_documents').select('id, titre, type, contenu, circuit_statut').eq('tender_id', id).in('type', ['TDR', 'DAO']),
    supabase.from('dcmp_reviews').select('id, type, decision, motivation, reviewer_role, created_at').eq('tender_id', id).order('created_at', { ascending: false }),
    supabase.from('bid_rankings').select('rang, score_global, montant_offre, qualifie').eq('tender_id', id).order('rang'),
  ])

  const isBailleur = session.role === 'BAILLEUR'
  const options = isBailleur
    ? [{ value: 'NON_OBJECTION_BAILLEUR', label: 'Non-objection du bailleur' }]
    : [
        ...(t.current_phase === 'PHASE_3_VALIDATION_PRIORI' ? [{ value: 'AVIS_NON_OBJECTION', label: 'Avis de non-objection (phase 3)' }] : []),
        ...(['PHASE_2_REDACTION', 'PHASE_3_VALIDATION_PRIORI'].includes(t.current_phase) ? [{ value: 'DEROGATION', label: 'Dérogation (entente directe)' }] : []),
        ...(t.current_phase === 'PHASE_11_ATTRIBUTION_DEFINITIVE' ? [{ value: 'APPROBATION_ATTRIBUTION', label: 'Approbation de l\'attribution (phase 11)' }] : []),
      ]

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title={`Examen — ${t.reference}`} subtitle={t.title} actions={<WorkflowBadge phase={t.current_phase} />} />
      <Card title="Éléments du dossier">
        <DefinitionList items={[
          { label: 'Autorité contractante', value: (t.institutions as unknown as { name: string } | null)?.name },
          { label: 'Nature / mode', value: `${t.nature_marche} / ${t.mode_passation}` },
          { label: 'Montant estimé', value: fcfa(t.montant_estime) },
          { label: 'Transmis le', value: dateFr(t.transmis_dcmp_at, true) },
          { label: 'Cofinancement', value: t.is_cofinance ? 'Oui — non-objection du bailleur requise' : 'Non' },
          { label: 'Montant attribué', value: fcfa(t.montant_attribue) },
        ]} />
        {t.mode_passation !== t.mode_suggere && <Alert tone="amber" title="Écart avec le mode réglementaire">Mode suggéré : {t.mode_suggere}. Justification : {t.justification_mode}</Alert>}
        {t.criteres_evaluation?.length > 0 && (
          <ul className="mt-4 grid gap-1 text-sm sm:grid-cols-2">
            {(t.criteres_evaluation as { critere: string; ponderation: number }[]).map(c => <li key={c.critere} className="flex justify-between rounded bg-gray-50 px-3 py-1"><span>{c.critere}</span><strong>{c.ponderation}</strong></li>)}
          </ul>
        )}
      </Card>

      {(docs.data ?? []).map(d => (
        <Card key={d.id} title={<span className="flex items-center gap-2">{d.titre} <Badge>{d.type}</Badge> <Badge tone="blue">{d.circuit_statut}</Badge></span>}>
          <div className="space-y-4">
            {((d.contenu as { sections?: { id: string; titre: string; contenu: string }[] })?.sections ?? []).map(s => (
              <section key={s.id}><h3 className="text-sm font-semibold text-gray-800">{s.titre}</h3><p className="whitespace-pre-wrap text-sm text-gray-600">{s.contenu}</p></section>
            ))}
          </div>
        </Card>
      ))}

      {t.current_phase === 'PHASE_11_ATTRIBUTION_DEFINITIVE' && (ranking.data ?? []).length > 0 && (
        <Card title="Classement des offres" padded={false}>
          <DataTable rows={ranking.data} rowKey={r => String(r.rang ?? Math.random())}
            columns={[
              { header: 'Rang', cell: r => r.rang ?? 'Éliminée' }, { header: 'Montant', cell: r => fcfa(r.montant_offre) },
              { header: 'Note globale', cell: r => r.score_global ?? '—' },
            ]} />
        </Card>
      )}

      <Card title="Décision">
        {options.length ? (
          <ActionForm action={recordReview} submitLabel="Enregistrer l'avis">
            <input type="hidden" name="tender_id" value={id} />
            <Grid cols={2}>
              <Field label="Objet de l'avis" name="type" required options={options} defaultValue={options[0].value} />
              <Field label="Décision" name="decision" required options={[{ value: 'FAVORABLE', label: 'Favorable' }, { value: 'DEFAVORABLE', label: 'Défavorable (retour en rédaction)' }, { value: 'COMPLEMENTAIRE', label: 'Demande de compléments (retour en rédaction)' }]} />
              <Field className="md:col-span-2" label="Motivation" name="motivation" rows={3} hint="Obligatoire pour toute décision non favorable." />
            </Grid>
          </ActionForm>
        ) : <Alert>Aucune décision n'est attendue de votre part à ce stade.</Alert>}
      </Card>

      <Card title="Avis rendus" padded={false}>
        <DataTable rows={reviews.data} rowKey={r => r.id} empty="Aucun avis."
          columns={[
            { header: 'Date', cell: r => dateFr(r.created_at, true) }, { header: 'Objet', cell: r => r.type },
            { header: 'Décision', cell: r => <Badge tone={DECISION_TONE[r.decision as keyof typeof DECISION_TONE]}>{r.decision}</Badge> },
            { header: 'Auteur', cell: r => r.reviewer_role }, { header: 'Motivation', cell: r => r.motivation ?? '—' },
          ]} />
      </Card>
      <p><Link href="/dashboard/dcmp" className="text-sm text-green-700 hover:underline">← Retour à la liste</Link></p>
    </div>
  )
}
