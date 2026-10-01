import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  EVENT_LABELS, PHASE_META, availableEvents, missingPreconditions, phaseNumber, seuilAoo,
  type TenderEventType, type TypeInstitution,
} from '@marchepublic/workflow'
import { requireSession } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { loadFacts } from '@/lib/tender-facts'
import { TENDER_COLUMNS, type TenderRow } from '@/lib/types'
import { dateFr, fcfa, isoToDatetimeLocal } from '@/lib/format'
import { Alert, Badge, Card, DataTable, DefinitionList, Field, Grid, PageHeader } from '@/components/ui'
import { ActionButton, ActionForm } from '@/components/ActionForm'
import { TenderForm } from '@/components/forms/TenderForm'
import { KeyGenerator } from '@/components/KeyGenerator'
import { PhaseStepper, WorkflowBadge } from '@/components/workflow/WorkflowBadge'
import {
  addCommissionMember, addLot, advancePhase, applyEvaluationTemplate, relancerMarche, removeCommissionMember, removeLot, setCalendrier, setCriteres, updateTender,
} from '../../actions/marches'

export const dynamic = 'force-dynamic'

/** Événements dont l'exécution passe par un écran dédié (saisie de données nécessaire) plutôt que par un simple bouton. */
const DEDICATED: Partial<Record<TenderEventType, (id: string) => { href: string; label: string }>> = {
  PRONONCER_ATTRIBUTION_PROVISOIRE: id => ({ href: `/dashboard/attribution/${id}`, label: 'Choisir l\'offre retenue' }),
  DECLARER_INFRUCTUEUX: id => ({ href: `/dashboard/evaluation/${id}`, label: 'Déclarer (motif requis)' }),
}

export default async function MarchePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await requireSession()
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase.from('tenders').select(`${TENDER_COLUMNS}, phase_history`).eq('id', id).maybeSingle()
  if (!data) notFound()
  const t = data as unknown as TenderRow & { phase_history: { from: string; phase: string; enteredAt: string }[] }

  const [facts, docs, members, staff, corps, templates, lots] = await Promise.all([
    loadFacts(supabase, t),
    supabase.from('tender_documents').select('id, titre, type, circuit_statut, is_locked, updated_at').eq('tender_id', id).order('created_at'),
    supabase.from('commission_members').select('id, role_commission, user_id, users(full_name, role)').eq('tender_id', id),
    supabase.from('users').select('id, full_name, role').eq('institution_id', t.institution_id).in('role', ['CPM', 'PRM', 'EVALUATEUR', 'SERVICE_DEMANDEUR', 'TRESOR']).eq('is_active', true),
    supabase.from('corps_metiers').select('id, libelle').eq('is_active', true).order('libelle'),
    supabase.from('evaluation_templates').select('id, code, criteres, corps_metier_id'),
    supabase.from('tender_lots').select('id, numero_lot, libelle, montant_estime, montant_attribue, statut').eq('tender_id', id).order('numero_lot'),
  ])

  const n = phaseNumber(t.current_phase)
  const isStaff = session.role === 'PRM' || session.role === 'CPM'
  const isBidder = session.role === 'SOUMISSIONNAIRE'
  const events = availableEvents(t.current_phase, session.role)
  const inst = (t.institutions as { name: string; type: string } | null) ?? null
  const editable = isStaff && n <= 2
  const planning = isStaff && n >= 2 && n <= 5
  const tmpl = (templates.data ?? []).filter(x => !t.corps_metier_id || x.corps_metier_id === t.corps_metier_id)

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={t.reference ?? 'Marché'}
        subtitle={t.title}
        actions={<WorkflowBadge phase={t.current_phase} />}
      />

      <Card>
        <PhaseStepper phase={t.current_phase} />
        <p className="mt-3 text-sm text-gray-600"><strong>{PHASE_META[t.current_phase].label}</strong> — {PHASE_META[t.current_phase].description}</p>
      </Card>

      {t.has_appeal_pending && (
        <Alert tone="red" title="🔒 Recours pendant devant l'ARCOP">
          L'attribution définitive et la signature du contrat sont bloquées par la base de données tant que le recours n'est pas tranché.
        </Alert>
      )}
      {t.closed_at && t.issue === 'INFRUCTUEUX' && (
        <Alert tone="amber" title="Procédure déclarée infructueuse">
          <p>{t.motif_infructueux}</p>
          {session.role === 'PRM' && (
            <div className="mt-3">
              <ActionForm action={relancerMarche.bind(null, t.id)} submitLabel="Relancer le marché" redirectPattern="/dashboard/marches/{id}" reset={false}>
                <span className="text-xs">Crée un nouveau marché en phase 1 ; l'historique de celui-ci est conservé.</span>
              </ActionForm>
            </div>
          )}
        </Alert>
      )}
      {t.closed_at && t.issue !== 'INFRUCTUEUX' && <Alert tone="green" title="Marché clos et archivé">Le dossier est figé : aucune modification n'est possible.</Alert>}

      {/* ---------- Prochaines étapes ---------- */}
      {events.length > 0 && !t.closed_at && (
        <Card title="Prochaine étape">
          <ul className="space-y-4">
            {events.map(ev => {
              const missing = missingPreconditions(ev.event, facts)
              const dedicated = DEDICATED[ev.event]?.(t.id)
              return (
                <li key={ev.event} className="flex flex-wrap items-start justify-between gap-3">
                  <div className="max-w-2xl">
                    <p className="text-sm font-semibold text-gray-800">{EVENT_LABELS[ev.event]} → phase {phaseNumber(ev.to)}</p>
                    {missing.length > 0 ? (
                      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-amber-800">
                        {missing.map(m => <li key={m}>{m}</li>)}
                      </ul>
                    ) : <p className="mt-1 text-xs text-green-700">Toutes les pré-conditions sont remplies.</p>}
                  </div>
                  {dedicated ? (
                    <Link href={dedicated.href} className="rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800">{dedicated.label}</Link>
                  ) : (
                    <ActionButton
                      label={EVENT_LABELS[ev.event]}
                      action={advancePhase.bind(null, t.id, ev.event, {})}
                      confirm={`Confirmer : ${EVENT_LABELS[ev.event]} ? Cette action est tracée dans le journal d'audit.`}
                      title={missing.length ? 'La base refusera tant que les pré-conditions ne sont pas remplies' : undefined}
                    />
                  )}
                </li>
              )
            })}
          </ul>
          <p className="mt-4 text-xs text-gray-400">Même si l'interface affichait un bouton à tort, la base de données revérifie chaque règle (rôle, délais, verrous) avant de modifier le marché.</p>
        </Card>
      )}

      {/* ---------- Informations ---------- */}
      <Card title="Informations générales">
        <DefinitionList items={[
          { label: 'Autorité contractante', value: inst?.name },
          { label: 'Nature', value: t.nature_marche },
          { label: 'Mode de passation', value: <>{t.mode_passation ?? '—'} {t.mode_suggere && t.mode_suggere !== t.mode_passation && <Badge tone="amber">écart avec le mode réglementaire ({t.mode_suggere})</Badge>}</> },
          { label: 'Corps de métier', value: t.corps_metiers?.libelle },
          { label: 'Montant estimé', value: fcfa(t.montant_estime) },
          { label: 'Montant attribué', value: fcfa(t.montant_attribue) },
          { label: 'PPM', value: t.ppm_annee ? `${t.ppm_annee} — T${t.ppm_trimestre}` : '—' },
          { label: 'Ligne budgétaire', value: t.ligne_budgetaire },
          { label: 'Publication', value: dateFr(t.date_publication, true) },
          { label: 'Date limite de dépôt', value: dateFr(t.date_limite_depot, true) },
          { label: 'Fin du délai de recours', value: dateFr(t.date_fin_recours, true) },
          { label: 'Réserves', value: [t.is_reserve_pme && 'PME / ESS', t.is_reserve_pme_feminine && 'PME féminines', t.is_cofinance && 'Cofinancé'].filter(Boolean).join(' · ') || '—' },
        ]} />
        {t.justification_mode && <p className="mt-4 rounded-lg bg-gray-50 p-3 text-sm text-gray-700"><strong>Justification du mode :</strong> {t.justification_mode}</p>}
        {t.criteres_evaluation?.length > 0 && (
          <div className="mt-4">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">Critères d'évaluation</p>
            <ul className="grid gap-1 text-sm sm:grid-cols-2">
              {t.criteres_evaluation.map(c => <li key={c.critere} className="flex justify-between rounded bg-gray-50 px-3 py-1"><span>{c.critere}</span><strong>{c.ponderation}</strong></li>)}
            </ul>
          </div>
        )}
      </Card>

      {/* ---------- Édition (phases 1-2) ---------- */}
      {editable && (
        <>
          <Card title="Modifier le marché" subtitle="Modifiable jusqu'à la transmission à la DCMP ; ensuite le dossier est verrouillé.">
            <TenderForm
              action={updateTender.bind(null, t.id)}
              corps={corps.data ?? []}
              institutionType={(inst?.type ?? 'ETAT') as TypeInstitution}
              submitLabel="Enregistrer les modifications"
              values={{ ...t, nature_marche: t.nature_marche }}
            />
          </Card>
          <Card title="Critères d'évaluation" subtitle="Un critère par ligne : « Libellé | pondération ». La somme doit être égale à 100.">
            {tmpl.length > 0 && (
              <div className="mb-4 flex flex-wrap gap-2">
                {tmpl.map(x => (
                  <ActionButton key={x.id} variant="secondary" label={`Appliquer la grille type (${x.code.replace('EVAL-', '')})`}
                    action={applyEvaluationTemplate.bind(null, t.id, x.id)} confirm="Remplacer les critères actuels par la grille type ?" />
                ))}
              </div>
            )}
            <ActionForm action={setCriteres.bind(null, t.id)} submitLabel="Enregistrer les critères" reset={false}>
              <Field label="Critères" name="criteres" rows={6} defaultValue={(t.criteres_evaluation ?? []).map(c => `${c.critere} | ${c.ponderation}`).join('\n')} />
            </ActionForm>
          </Card>
        </>
      )}

      {/* ---------- Lots ---------- */}
      {t.is_alloti && (
        <Card title="Lots" subtitle="Chaque lot est évalué, attribué et contractualisé séparément. Au moins deux lots avant transmission à la DCMP." padded={false}>
          <DataTable rows={lots.data} rowKey={l => l.id} empty="Aucun lot défini."
            columns={[
              { header: 'N°', cell: l => l.numero_lot }, { header: 'Libellé', cell: l => l.libelle },
              { header: 'Montant estimé', cell: l => fcfa(l.montant_estime), className: 'whitespace-nowrap' },
              { header: 'Attribué', cell: l => fcfa(l.montant_attribue), className: 'whitespace-nowrap' },
              { header: 'Statut', cell: l => <Badge tone={l.statut === 'ATTRIBUE' ? 'green' : l.statut === 'INFRUCTUEUX' ? 'red' : 'gray'}>{l.statut}</Badge> },
              ...(editable ? [{ header: '', cell: (l: { id: string }) => <ActionButton variant="secondary" label="Supprimer" action={removeLot.bind(null, l.id)} confirm="Supprimer ce lot ?" /> }] : []),
            ]} />
          {editable && (
            <div className="border-t border-gray-100 p-5">
              <ActionForm action={addLot.bind(null, t.id)} submitLabel="Ajouter le lot">
                <Grid cols={4}>
                  <Field label="N°" name="numero_lot" type="number" min={1} required defaultValue={(lots.data?.length ?? 0) + 1} />
                  <Field label="Libellé" name="libelle" required /><Field label="Montant estimé (FCFA)" name="montant_estime" type="number" min={1} required />
                  <Field label="Description" name="description" />
                </Grid>
              </ActionForm>
            </div>
          )}
        </Card>
      )}

      {/* ---------- Calendrier et chiffrement ---------- */}
      {planning && (
        <Card title="Calendrier et chiffrement des offres" subtitle="Préparation du dépôt (phases 2 à 5).">
          <div className="grid gap-6 lg:grid-cols-2">
            <ActionForm action={setCalendrier.bind(null, t.id)} submitLabel="Enregistrer le calendrier" reset={false}>
              <Field label="Date et heure limites de dépôt" name="date_limite_depot" type="datetime-local" required defaultValue={isoToDatetimeLocal(t.date_limite_depot)}
                     hint={t.mode_passation ? `Délai minimal entre publication et dépôt selon le mode ${t.mode_passation} (paramétrable).` : undefined} />
              <Field label="Séance d'ouverture des plis (prévue)" name="date_ouverture_plis" type="datetime-local" defaultValue={isoToDatetimeLocal(t.date_ouverture_plis)} />
            </ActionForm>
            <div>
              <p className="mb-2 text-sm font-medium text-gray-700">Clé de chiffrement</p>
              <KeyGenerator tenderId={t.id} reference={t.reference ?? t.id} existingFingerprint={t.bid_key_fingerprint} existingShares={t.bid_key_shares} existingThreshold={t.bid_key_threshold} />
            </div>
          </div>
        </Card>
      )}

      {/* ---------- Commission ---------- */}
      {(isStaff || (members.data ?? []).length > 0) && !isBidder && (
        <Card title="Commission des marchés" subtitle="Figée à l'ouverture des plis. Le président détient la clé privée d'ouverture.">
          <DataTable rows={members.data as never[]} rowKey={(r: { id: string }) => r.id} empty="Aucun membre désigné."
            columns={[
              { header: 'Nom', cell: (r: any) => r.users?.full_name ?? r.user_id },
              { header: 'Fonction', cell: (r: any) => <Badge tone={r.role_commission === 'PRESIDENT' ? 'purple' : 'gray'}>{r.role_commission}</Badge> },
              ...(isStaff && n <= 7 ? [{ header: '', cell: (r: any) => <ActionButton variant="secondary" label="Retirer" action={removeCommissionMember.bind(null, r.id)} confirm="Retirer ce membre ?" /> }] : []),
            ]} />
          {isStaff && n <= 7 && (
            <ActionForm action={addCommissionMember.bind(null, t.id)} submitLabel="Ajouter à la commission" className="mt-4 border-t border-gray-100 pt-4">
              <Grid cols={2}>
                <Field label="Membre" name="user_id" required options={(staff.data ?? []).map(u => ({ value: u.id, label: `${u.full_name} (${u.role})` }))} />
                <Field label="Fonction" name="role_commission" required defaultValue="MEMBRE" options={[
                  { value: 'PRESIDENT', label: 'Président' }, { value: 'MEMBRE', label: 'Membre' }, { value: 'SECRETAIRE', label: 'Secrétaire' }, { value: 'OBSERVATEUR', label: 'Observateur (sans voix)' }]} />
              </Grid>
            </ActionForm>
          )}
        </Card>
      )}

      {/* ---------- Documents ---------- */}
      <Card title="Documents" padded={false}
        actions={!isBidder && n <= 2 ? <Link href={`/dashboard/redaction/${t.id}`} className="text-sm font-medium text-green-700 hover:underline">Ouvrir la rédaction →</Link> : undefined}>
        <DataTable rows={docs.data} rowKey={d => d.id} empty="Aucun document."
          columns={[
            { header: 'Titre', cell: d => d.titre },
            { header: 'Type', cell: d => <Badge>{d.type}</Badge> },
            { header: 'Circuit', cell: d => <Badge tone={d.circuit_statut === 'PUBLIE' ? 'green' : d.circuit_statut === 'TRANSMIS_DCMP' ? 'amber' : 'gray'}>{d.circuit_statut}</Badge> },
            { header: 'Verrouillé', cell: d => d.is_locked ? '🔒' : '—' },
            { header: 'Mis à jour', cell: d => dateFr(d.updated_at, true) },
          ]} />
      </Card>

      {/* ---------- Historique ---------- */}
      <Card title="Historique des phases" padded={false}>
        <DataTable rows={[...(t.phase_history ?? [])].reverse()} rowKey={h => `${h.phase}-${h.enteredAt}`} empty="Aucune transition."
          columns={[
            { header: 'Date', cell: h => dateFr(h.enteredAt, true), className: 'whitespace-nowrap' },
            { header: 'De', cell: h => h.from },
            { header: 'Vers', cell: h => <WorkflowBadge phase={h.phase as never} /> },
          ]} />
      </Card>

      <p className="text-xs text-gray-400">Seuil AOO applicable : {fcfa(seuilAoo((inst?.type ?? 'ETAT') as TypeInstitution, t.nature_marche))}</p>
    </div>
  )
}
