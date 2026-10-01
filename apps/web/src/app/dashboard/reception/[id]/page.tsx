import Link from 'next/link'
import { notFound } from 'next/navigation'
import { phaseNumber } from '@marchepublic/workflow'
import { requireSession } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { loadFacts } from '@/lib/tender-facts'
import { TENDER_COLUMNS, type TenderRow } from '@/lib/types'
import { dateFr, fcfa } from '@/lib/format'
import { missingPreconditions } from '@marchepublic/workflow'
import { Alert, Badge, Card, DataTable, Field, Grid, PageHeader } from '@/components/ui'
import { ActionButton, ActionForm } from '@/components/ActionForm'
import { WorkflowBadge } from '@/components/workflow/WorkflowBadge'
import { advancePhase } from '../../actions/marches'
import { addReception, evaluateProvider, processPayment, submitPayment } from '../../actions/execution'

export const dynamic = 'force-dynamic'

const PAY_TONE = { SOUMIS: 'amber', VALIDE_AC: 'blue', VISA_CF: 'blue', TRANSMIS_TRESOR: 'purple', PAYE: 'green', REJETE: 'red' } as const

export default async function ReceptionTenderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ contrat?: string }> }) {
  const { id } = await params
  const { contrat: contratId } = await searchParams
  const session = await requireSession('/dashboard/reception')
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.from('tenders').select(TENDER_COLUMNS).eq('id', id).maybeSingle()
  if (!data) notFound()
  const t = data as unknown as TenderRow
  const n = phaseNumber(t.current_phase)
  const facts = await loadFacts(supabase, t)
  const { data: allContracts } = await supabase.from('contracts').select('id, lot_id, montant_initial, montant_actuel, attributaire_id, lots:lot_id(numero_lot)').eq('tender_id', id).order('created_at')
  const contract = (allContracts ?? []).find(x => x.id === contratId) ?? (allContracts ?? [])[0] ?? null
  if (!contract) return <Alert tone="amber">Aucun contrat pour ce marché.</Alert>

  const [receptions, payments, evaluation] = await Promise.all([
    supabase.from('receptions').select('id, type, date_reception, statut, reserves').eq('contract_id', contract.id).order('date_reception'),
    supabase.from('payment_statements').select('id, numero, type, montant, statut, date_soumission, date_paiement, motif_rejet, reference_sigfip').eq('contract_id', contract.id).order('numero'),
    supabase.from('provider_evaluations').select('note_qualite, note_delai, note_cout, note_globale, commentaire').eq('contract_id', contract.id).maybeSingle(),
  ])
  const isPrm = session.role === 'PRM'
  const isStaff = isPrm || session.role === 'CPM'
  const isTresor = session.role === 'TRESOR'
  const isHolder = contract.attributaire_id === session.id
  const plafond = Number(contract.montant_actuel ?? contract.montant_initial)
  const engaged = (payments.data ?? []).filter(p => p.statut !== 'REJETE').reduce((s, p) => s + Number(p.montant), 0)
  const hasType = (type: string) => (receptions.data ?? []).some(r => r.type === type)
  const provMissing = missingPreconditions('CONSTATER_RECEPTION_PROVISOIRE', facts)
  const defMissing = missingPreconditions('CONSTATER_RECEPTION_DEFINITIVE', facts)

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title={`Réception et paiements — ${t.reference}`} subtitle={t.title}
        actions={<><WorkflowBadge phase={t.current_phase} /><Link href={`/dashboard/execution/${id}`} className="text-sm text-green-700 hover:underline">Contrat →</Link></>} />

      {(allContracts ?? []).length > 1 && (
        <div className="flex flex-wrap gap-2">
          {(allContracts ?? []).map(x => (
            <Link key={x.id} href={`/dashboard/reception/${id}?contrat=${x.id}`}
              className={`rounded-lg border px-3 py-1.5 text-sm ${x.id === contract.id ? 'border-green-700 bg-green-50 font-semibold' : 'border-gray-300 hover:bg-gray-50'}`}>
              Contrat lot {(x as unknown as { lots?: { numero_lot: number } }).lots?.numero_lot ?? '—'}
            </Link>
          ))}
        </div>
      )}

      <Card title="Réceptions" padded={false}>
        <DataTable rows={receptions.data} rowKey={r => r.id} empty="Aucune réception."
          columns={[{ header: 'Type', cell: r => r.type }, { header: 'Date', cell: r => dateFr(r.date_reception) }, { header: 'Statut', cell: r => <Badge tone={r.statut === 'REFUSEE' ? 'red' : 'green'}>{r.statut}</Badge> }, { header: 'Réserves', cell: r => r.reserves ?? '—' }, { header: 'PV', cell: r => <a href={`/api/pdf/pv-reception/${r.id}`} target="_blank" rel="noreferrer" className="text-sm font-medium text-green-700 hover:underline">PDF</a> }]} />
        {isStaff && (n === 13 || n === 14) && (
          <div className="space-y-4 border-t border-gray-100 p-5">
            {((n === 13 && !hasType('PROVISOIRE')) || (n === 14 && !hasType('DEFINITIVE'))) && (
              <ActionForm action={addReception} submitLabel="Enregistrer le PV" confirm="Enregistrer ce PV de réception ? Il est immuable.">
                <input type="hidden" name="contract_id" value={contract.id} /><input type="hidden" name="type" value={n === 13 ? 'PROVISOIRE' : 'DEFINITIVE'} />
                <Grid cols={2}>
                  <Field label={`Réception ${n === 13 ? 'provisoire' : 'définitive'}`} name="statut" required options={[{ value: 'ACCEPTEE', label: 'Acceptée' }, { value: 'ACCEPTEE_AVEC_RESERVES', label: 'Acceptée avec réserves' }, { value: 'REFUSEE', label: 'Refusée' }]} />
                  <Field label="Réserves" name="reserves" rows={2} />
                </Grid>
              </ActionForm>
            )}
            {n === 13 && hasType('PROVISOIRE') && <><ActionButton label="Passer en réception / paiement" action={advancePhase.bind(null, id, 'CONSTATER_RECEPTION_PROVISOIRE', {})} disabled={provMissing.length > 0} /></>}
            {n === 14 && hasType('DEFINITIVE') && (
              <div className="space-y-1">
                {!evaluation.data && <p className="text-xs text-amber-800">Pensez à évaluer le prestataire avant l'archivage.</p>}
                <ActionButton label="Clôturer le marché (phase 15)" action={advancePhase.bind(null, id, 'CONSTATER_RECEPTION_DEFINITIVE', {})} disabled={defMissing.length > 0} confirm="Clôturer le marché ? Il sera figé (aucune modification possible)." />
              </div>
            )}
          </div>
        )}
      </Card>

      <Card title="Décomptes et paiements" subtitle={`Engagé : ${fcfa(engaged)} sur ${fcfa(plafond)} (montant du contrat après avenants).`} padded={false}>
        <DataTable rows={payments.data} rowKey={p => p.id} empty="Aucun décompte."
          columns={[
            { header: 'N°', cell: p => p.numero }, { header: 'Type', cell: p => p.type }, { header: 'Montant', cell: p => fcfa(p.montant), className: 'whitespace-nowrap' },
            { header: 'Statut', cell: p => <span><Badge tone={PAY_TONE[p.statut as keyof typeof PAY_TONE]}>{p.statut}</Badge>{p.motif_rejet && <span className="ml-2 text-xs text-red-700">{p.motif_rejet}</span>}{p.reference_sigfip && <span className="ml-2 text-xs text-gray-500">SIGFIP {p.reference_sigfip}</span>}</span> },
            { header: 'Soumis', cell: p => dateFr(p.date_soumission) }, { header: 'Payé', cell: p => dateFr(p.date_paiement) },
            { header: 'Traitement', cell: p => (
              <span className="flex flex-wrap gap-2">
                {p.statut === 'SOUMIS' && isStaff && <ActionButton variant="secondary" label="Valider (AC)" action={processPayment.bind(null, p.id, 'VALIDE_AC', undefined)} />}
                {p.statut === 'VALIDE_AC' && isTresor && <ActionButton variant="secondary" label="Visa CF" action={processPayment.bind(null, p.id, 'VISA_CF', undefined)} />}
                {p.statut === 'VISA_CF' && isTresor && (
                  <ActionForm action={processPayment.bind(null, p.id, 'TRANSMIS_TRESOR')} submitLabel="Transmettre au Trésor" variant="secondary" className="flex items-end gap-2 space-y-0"><input name="reference_sigfip" placeholder="Réf. SIGFIP" className="w-28 rounded border border-gray-300 px-2 py-1 text-xs" /></ActionForm>
                )}
                {p.statut === 'TRANSMIS_TRESOR' && isTresor && <ActionButton label="Marquer payé" action={processPayment.bind(null, p.id, 'PAYE', undefined)} confirm="Confirmer le paiement ?" />}
                {!['PAYE', 'REJETE'].includes(p.statut) && (isStaff || isTresor) && (
                  <ActionForm action={processPayment.bind(null, p.id, 'REJETE')} submitLabel="Rejeter" variant="danger" className="flex items-end gap-2 space-y-0"><input name="motif_rejet" placeholder="Motif" required minLength={5} className="w-32 rounded border border-gray-300 px-2 py-1 text-xs" /></ActionForm>
                )}
              </span>
            ) },
          ]} />
        {isHolder && (n === 13 || n === 14) && (
          <div className="border-t border-gray-100 p-5">
            <ActionForm action={submitPayment} submitLabel="Soumettre le décompte">
              <input type="hidden" name="contract_id" value={contract.id} />
              <Grid cols={3}>
                <Field label="N°" name="numero" type="number" min={1} required defaultValue={(payments.data?.length ?? 0) + 1} />
                <Field label="Type" name="type" required options={[{ value: 'ACOMPTE', label: 'Acompte' }, { value: 'AVANCE', label: 'Avance' }, { value: 'SOLDE', label: 'Solde' }, { value: 'LIBERATION_RETENUE', label: 'Libération de retenue' }]} />
                <Field label="Montant (FCFA)" name="montant" type="number" min={1} required />
              </Grid>
            </ActionForm>
          </div>
        )}
      </Card>

      {(n === 14 || n === 15) && (
        <Card title="Évaluation du prestataire" subtitle="Alimente la base de référence pour les marchés futurs.">
          {evaluation.data ? (
            <p className="text-sm">Qualité {evaluation.data.note_qualite}/10 · Délai {evaluation.data.note_delai}/10 · Coût {evaluation.data.note_cout}/10 — <strong>Globale {evaluation.data.note_globale}/10</strong>{evaluation.data.commentaire && <> — {evaluation.data.commentaire}</>}</p>
          ) : isStaff ? (
            <ActionForm action={evaluateProvider} submitLabel="Enregistrer l'évaluation">
              <input type="hidden" name="contract_id" value={contract.id} />
              <Grid cols={4}><Field label="Qualité (/10)" name="note_qualite" type="number" min={0} max={10} step="0.5" required /><Field label="Délais (/10)" name="note_delai" type="number" min={0} max={10} step="0.5" required /><Field label="Coût (/10)" name="note_cout" type="number" min={0} max={10} step="0.5" required /><Field label="Commentaire" name="commentaire" /></Grid>
            </ActionForm>
          ) : <p className="text-sm text-gray-500">Non évalué.</p>}
        </Card>
      )}
    </div>
  )
}
