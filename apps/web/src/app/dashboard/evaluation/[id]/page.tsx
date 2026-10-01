import Link from 'next/link'
import { notFound } from 'next/navigation'
import { phaseNumber } from '@marchepublic/workflow'
import { requireSession } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { dateFr, fcfa } from '@/lib/format'
import { Alert, Badge, Card, DataTable, Field, PageHeader } from '@/components/ui'
import { ActionButton, ActionForm } from '@/components/ActionForm'
import { EvaluationGrid } from '@/components/EvaluationGrid'
import { OpeningPanel } from '@/components/OpeningPanel'
import { WorkflowBadge } from '@/components/workflow/WorkflowBadge'
import { advancePhase, declareInfructueux } from '../../actions/marches'
import { recordConformite, signOpening } from '../../actions/passation'

export const dynamic = 'force-dynamic'

export default async function EvaluationTenderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await requireSession('/dashboard/evaluation')
  const supabase = await createSupabaseServerClient()

  const { data: t } = await supabase.from('tenders')
    .select('id, reference, title, current_phase, date_limite_depot, criteres_evaluation, evaluation_round, nature_marche, bid_key_shares, bid_key_threshold').eq('id', id).maybeSingle()
  if (!t) notFound()
  const n = phaseNumber(t.current_phase)
  const criteres = (t.criteres_evaluation ?? []) as { critere: string; ponderation: number }[]

  const [bidsRes, sigs, members, evals, rankings] = await Promise.all([
    supabase.from('bids').select('id, status, montant_offre, conformite_admin, motif_non_conformite, submitted_at, lot_id, lots:lot_id(numero_lot, libelle), fichier_technique_path, fichier_financier_path, fichier_technique_hash, fichier_financier_hash, users:soumissionnaire_id(full_name, ninea, is_pme)').eq('tender_id', id).order('submitted_at'),
    supabase.from('opening_signatures').select('signer_role, signed_at').eq('tender_id', id),
    supabase.from('commission_members').select('user_id, role_commission, users(full_name)').eq('tender_id', id),
    supabase.from('bid_evaluations').select('bid_id, evaluateur_id, score_technique, grille_technique').eq('tender_id', id).eq('round', t.evaluation_round),
    supabase.from('bid_rankings').select('bid_id, lot_id, rang, qualifie, score_technique, score_financier, score_global, montant_offre').eq('tender_id', id).order('lot_id').order('rang', { nullsFirst: false }),
  ])
  const bids = (bidsRes.data ?? []) as any[]
  const isStaff = ['CPM', 'PRM'].includes(session.role)
  const me = (members.data ?? []).find(m => m.user_id === session.id)
  const isPresident = me?.role_commission === 'PRESIDENT'
  const canGrade = !!me && me.role_commission !== 'OBSERVATEUR' && t.current_phase === 'PHASE_8_EVALUATION'
  const hasSigned = (role: string) => (sigs.data ?? []).some(s => s.signer_role === role)
  const showIdentities = session.role !== 'EVALUATEUR'   // les évaluateurs notent des offres anonymisées
  const alias = (i: number) => `Offre n°${i + 1}`
  const lotOf = (b: any) => (b?.lots ? ` · Lot ${b.lots.numero_lot}` : '')
  const valid = bids.filter(b => !['RETARDEE', 'RETIREE'].includes(b.status))
  const conformes = bids.filter(b => b.status === 'CONFORME')
  const myNotes = (bidId: string) => Object.fromEntries(
    ((evals.data ?? []).find(e => e.bid_id === bidId && e.evaluateur_id === session.id)?.grille_technique as { critere: string; note: number }[] | undefined ?? []).map(c => [c.critere, c.note]))

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title={`Ouverture et évaluation — ${t.reference}`} subtitle={t.title}
        actions={<><WorkflowBadge phase={t.current_phase} /><Link href={`/dashboard/marches/${id}`} className="text-sm text-green-700 hover:underline">Fiche du marché →</Link></>} />

      {n < 7 && <Alert tone="amber">L'ouverture n'est possible qu'après la date limite de dépôt et la clôture du dépôt. Aucune offre n'est visible avant.</Alert>}

      {/* ---------- Ouverture ---------- */}
      {n >= 7 && (
        <Card title="1. Ouverture officielle des plis" subtitle="Règle des deux personnes : le CPM et le président de la commission signent chacun.">
          <ul className="mb-4 space-y-1 text-sm">
            <li>CPM : {hasSigned('CPM') ? <Badge tone="green">Signé</Badge> : <Badge tone="amber">En attente</Badge>}</li>
            <li>Président de la commission : {hasSigned('PRESIDENT') ? <Badge tone="green">Signé</Badge> : <Badge tone="amber">En attente</Badge>}</li>
          </ul>
          {t.current_phase === 'PHASE_7_OUVERTURE_PLIS' && (session.role === 'CPM' || isPresident) && !(session.role === 'CPM' && hasSigned('CPM')) && !(isPresident && hasSigned('PRESIDENT')) && (
            <ActionButton label={isPresident ? 'Signer en tant que président de la commission' : 'Signer en tant que CPM'} action={signOpening.bind(null, id, undefined)} confirm="Signer l'ouverture des plis ? Cette signature est tracée et irrévocable." />
          )}
          {n >= 7 && (isStaff || me) && (
            <div className="mt-5 border-t border-gray-100 pt-4">
              <h3 className="mb-2 text-sm font-semibold text-gray-700">Déchiffrement local des plis</h3>
              <OpeningPanel threshold={t.bid_key_threshold} shares={t.bid_key_shares} bids={valid.map((b, i) => ({
                bidId: b.id, label: showIdentities ? (b.users?.full_name ?? alias(i)) : alias(i),
                techniquePath: b.fichier_technique_path, financierPath: b.fichier_financier_path,
                techniqueHash: b.fichier_technique_hash, financierHash: b.fichier_financier_hash,
              }))} />
            </div>
          )}
          {n >= 8 && <p className="mt-4"><Link className="text-sm font-medium text-green-700 hover:underline" href={`/dashboard/evaluation/${id}/pv`}>Afficher le procès-verbal d'ouverture →</Link> · <a href={`/api/pdf/pv-ouverture/${id}`} target="_blank" rel="noreferrer" className="text-sm font-medium text-green-700 hover:underline">Télécharger le PDF</a></p>}
        </Card>
      )}

      {/* ---------- Conformité ---------- */}
      {n >= 7 && (
        <Card title="2. Conformité administrative et montants" subtitle="Retard automatiquement rejeté et tracé. Saisissez le montant relevé dans l'offre financière." padded={false}>
          <DataTable rows={bids} rowKey={b => b.id} empty="Aucune offre reçue."
            columns={[
              { header: 'Candidat', cell: (b: any) => <span><strong>{showIdentities ? b.users?.full_name ?? '—' : alias(bids.indexOf(b))}</strong>{b.lots && <Badge tone="blue" className="ml-2">Lot {b.lots.numero_lot}</Badge>}{showIdentities && b.users?.is_pme && <Badge tone="amber" className="ml-2">PME</Badge>}<br /><span className="text-xs text-gray-400">Déposée le {dateFr(b.submitted_at, true)}</span></span> },
              { header: 'Statut', cell: (b: any) => <Badge tone={b.status === 'CONFORME' || b.status === 'EVALUEE' ? 'green' : ['RETARDEE', 'NON_CONFORME', 'REJETEE'].includes(b.status) ? 'red' : 'blue'}>{b.status}</Badge> },
              { header: 'Montant', cell: (b: any) => fcfa(b.montant_offre) },
              { header: 'Contrôle', cell: (b: any) => isStaff && ['SOUMISE', 'CONFORME', 'NON_CONFORME'].includes(b.status) && ['PHASE_7_OUVERTURE_PLIS', 'PHASE_8_EVALUATION'].includes(t.current_phase) ? (
                <ActionForm action={recordConformite} submitLabel="Enregistrer" reset={false} variant="secondary" className="flex flex-wrap items-end gap-2 space-y-0">
                  <input type="hidden" name="bid_id" value={b.id} />
                  <select name="conformite_admin" defaultValue={String(b.conformite_admin ?? true)} aria-label="Conformité" className="rounded border border-gray-300 px-2 py-1 text-xs">
                    <option value="true">Conforme</option><option value="false">Non conforme</option>
                  </select>
                  <input name="montant_offre" type="number" min={1} placeholder="Montant FCFA" defaultValue={b.montant_offre ?? ''} className="w-36 rounded border border-gray-300 px-2 py-1 text-xs" aria-label="Montant de l'offre" />
                  <input name="motif_non_conformite" placeholder="Motif si non conforme" defaultValue={b.motif_non_conformite ?? ''} className="w-44 rounded border border-gray-300 px-2 py-1 text-xs" aria-label="Motif" />
                </ActionForm>) : (b.motif_non_conformite ?? '—') },
            ]} />
        </Card>
      )}

      {/* ---------- Notation ---------- */}
      {n >= 8 && (
        <Card title="3. Notation technique" subtitle={`Ronde ${t.evaluation_round} — au moins deux évaluateurs par offre conforme. Les évaluateurs notent des offres anonymisées.`}>
          {criteres.length === 0 && <Alert tone="amber">Aucun critère défini sur ce marché.</Alert>}
          <div className="space-y-5">
            {conformes.map((b, i) => (
              <div key={b.id} className="rounded-lg border border-gray-200 p-4">
                <p className="mb-2 font-semibold text-gray-800">{showIdentities ? b.users?.full_name : alias(i)}{lotOf(b)} <span className="text-sm font-normal text-gray-500">— {fcfa(b.montant_offre)}</span></p>
                {canGrade
                  ? <EvaluationGrid tenderId={id} bidId={b.id} criteres={criteres} initialNotes={myNotes(b.id)} />
                  : <p className="text-sm text-gray-500">{(evals.data ?? []).filter(e => e.bid_id === b.id).length} évaluation(s) enregistrée(s).</p>}
              </div>
            ))}
            {!conformes.length && <p className="text-sm text-gray-500">Aucune offre conforme à évaluer.</p>}
          </div>
          {isStaff && t.current_phase === 'PHASE_8_EVALUATION' && (
            <div className="mt-5 border-t border-gray-100 pt-4">
              <ActionButton label="Finaliser l'évaluation et classer les offres" action={advancePhase.bind(null, id, 'FINALISER_EVALUATION', {})}
                confirm="Finaliser ? Le classement est calculé par le serveur et les notes sont figées." />
            </div>
          )}
          {session.role === 'PRM' && t.current_phase === 'PHASE_8_EVALUATION' && (
            <div className="mt-5 border-t border-gray-100 pt-4">
              <p className="mb-2 text-sm font-semibold text-gray-700">Aucune offre recevable ?</p>
              <ActionForm action={declareInfructueux.bind(null, id)} submitLabel="Déclarer la procédure infructueuse" variant="danger"
                confirm="Déclarer la procédure infructueuse ? Le dossier sera clos sans contrat (relance possible ensuite).">
                <Field label="Motif détaillé" name="motif" rows={3} required hint="20 caractères minimum. Refusé par la base si une offre qualifiée est classée." />
              </ActionForm>
            </div>
          )}
        </Card>
      )}

      {/* ---------- Classement ---------- */}
      {(rankings.data ?? []).length > 0 && (
        <Card title="4. Classement" actions={<a href={`/api/pdf/rapport-evaluation/${id}`} target="_blank" rel="noreferrer" className="text-sm font-medium text-green-700 hover:underline">Rapport d'évaluation (PDF)</a>} subtitle="Calculé par le serveur : moyenne des évaluateurs, seuil technique, note financière relative au moins-disant admis." padded={false}>
          <DataTable rows={rankings.data} rowKey={r => r.bid_id} columns={[
            { header: 'Rang', cell: r => r.qualifie ? <strong>{r.rang}</strong> : <Badge tone="red">Éliminée</Badge> },
            { header: 'Lot', cell: r => { const b = bids.find(x => x.id === r.bid_id); return b?.lots ? `Lot ${b.lots.numero_lot}` : '—' } },
            { header: 'Candidat', cell: r => { const i = bids.findIndex(b => b.id === r.bid_id); return showIdentities ? (bids[i]?.users?.full_name ?? '—') : alias(i) } },
            { header: 'Note technique', cell: r => r.score_technique }, { header: 'Note financière', cell: r => r.score_financier ?? '—' },
            { header: 'Note globale', cell: r => <strong>{r.score_global ?? '—'}</strong> }, { header: 'Montant', cell: r => fcfa(r.montant_offre) },
          ]} />
        </Card>
      )}
    </div>
  )
}
