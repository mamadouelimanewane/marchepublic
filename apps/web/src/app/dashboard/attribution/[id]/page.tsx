import Link from 'next/link'
import { notFound } from 'next/navigation'
import { missingPreconditions } from '@marchepublic/workflow'
import { requireSession } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { loadFacts } from '@/lib/tender-facts'
import { TENDER_COLUMNS, type TenderRow } from '@/lib/types'
import { dateFr, fcfa } from '@/lib/format'
import { Alert, Badge, Card, DataTable, DefinitionList, Field, PageHeader } from '@/components/ui'
import { ActionButton, ActionForm } from '@/components/ActionForm'
import { WorkflowBadge } from '@/components/workflow/WorkflowBadge'
import { advancePhase } from '../../actions/marches'
import { prononcerAttribution } from '../../actions/passation'

export const dynamic = 'force-dynamic'

export default async function AttributionTenderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await requireSession('/dashboard/attribution')
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.from('tenders').select(TENDER_COLUMNS).eq('id', id).maybeSingle()
  if (!data) notFound()
  const t = data as unknown as TenderRow
  const facts = await loadFacts(supabase, t)

  const [rankings, bids, reviews, lots] = await Promise.all([
    supabase.from('bid_rankings').select('bid_id, lot_id, rang, qualifie, score_technique, score_financier, score_global, montant_offre').eq('tender_id', id).eq('round', t.evaluation_round).order('rang', { nullsFirst: false }),
    supabase.from('bids').select('id, status, users:soumissionnaire_id(full_name, is_pme, is_pme_feminine)').eq('tender_id', id),
    supabase.from('dcmp_reviews').select('type, decision, created_at, motivation').eq('tender_id', id).eq('type', 'APPROBATION_ATTRIBUTION').order('created_at', { ascending: false }),
    supabase.from('tender_lots').select('id, numero_lot, libelle, statut, attributaire_bid_id, montant_attribue').eq('tender_id', id).order('numero_lot'),
  ])
  const lotLabel = (lotId: string | null) => { const l = (lots.data ?? []).find(x => x.id === lotId); return l ? `Lot ${l.numero_lot}` : '—' }
  const name = (bidId: string) => (bids.data as any[] | null)?.find(b => b.id === bidId)?.users?.full_name ?? '—'
  const isBidderRole = session.role === 'SOUMISSIONNAIRE'
  const isPrm = session.role === 'PRM'
  const isStaff = isPrm || session.role === 'CPM'
  const retained = t.attributaire_bid_id

  const closeMissing = missingPreconditions('CLORE_PERIODE_RECOURS', facts)
  const confirmMissing = missingPreconditions('CONFIRMER_ATTRIBUTION_DEFINITIVE', facts)

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title={`Attribution — ${t.reference}`} subtitle={t.title}
        actions={<><WorkflowBadge phase={t.current_phase} /><Link href={`/dashboard/marches/${id}`} className="text-sm text-green-700 hover:underline">Fiche du marché →</Link></>} />

      {t.has_appeal_pending && <Alert tone="red" title="🔒 Recours pendant">L'attribution définitive et la signature du contrat sont bloquées par la base tant que l'ARCOP n'a pas statué.</Alert>}

      <Card title="Classement des offres" padded={false}
        actions={<span className="flex gap-3">{(rankings.data ?? []).length > 0 && !isBidderRole && <a href={`/api/pdf/rapport-evaluation/${id}`} target="_blank" rel="noreferrer" className="text-sm font-medium text-green-700 hover:underline">Rapport d'évaluation (PDF)</a>}{t.date_fin_recours && <a href={`/api/pdf/decision-attribution/${id}`} target="_blank" rel="noreferrer" className="text-sm font-medium text-green-700 hover:underline">Décision d'attribution (PDF)</a>}</span>}>
        <DataTable rows={rankings.data} rowKey={r => r.bid_id} empty="Le classement n'est pas encore disponible."
          columns={[
            ...(t.is_alloti ? [{ header: 'Lot', cell: (r: { lot_id: string | null }) => lotLabel(r.lot_id) }] : []),
            { header: 'Rang', cell: r => r.qualifie ? <strong>{r.rang}</strong> : <Badge tone="red">Éliminée</Badge> },
            { header: 'Candidat', cell: r => <span>{isStaff || session.role !== 'SOUMISSIONNAIRE' ? name(r.bid_id) : (bids.data ?? []).some((b: any) => b.id === r.bid_id) ? 'Votre offre' : '—'}{(r.bid_id === retained || (lots.data ?? []).some(l => l.attributaire_bid_id === r.bid_id)) && <Badge tone="green" className="ml-2">Retenue</Badge>}</span> },
            { header: 'Technique', cell: r => r.score_technique }, { header: 'Financière', cell: r => r.score_financier ?? '—' },
            { header: 'Globale', cell: r => <strong>{r.score_global ?? '—'}</strong> }, { header: 'Montant', cell: r => fcfa(r.montant_offre) },
          ]} />
      </Card>

      {t.current_phase === 'PHASE_9_ATTRIBUTION_PROVISOIRE' && isPrm && (
        <Card title="Prononcer l'attribution provisoire" subtitle="L'offre la mieux classée est proposée. Attribuer à une autre offre qualifiée exige une justification, tracée au journal d'audit.">
          <ActionForm action={prononcerAttribution} submitLabel="Prononcer l'attribution provisoire" confirm="Prononcer l'attribution ? Tous les candidats seront notifiés et le délai de recours s'ouvrira.">
            <input type="hidden" name="tender_id" value={id} />
            {t.is_alloti ? (lots.data ?? []).filter(l => l.statut === 'OUVERT').map(l => {
              const ranked = (rankings.data ?? []).filter(r => r.lot_id === l.id && r.qualifie)
              return ranked.length ? (
                <div key={l.id} className="rounded-lg border border-gray-200 p-3">
                  <p className="mb-2 text-sm font-semibold">Lot {l.numero_lot} — {l.libelle}</p>
                  <Field label="Offre retenue" name={`bid_${l.id}`} required defaultValue={ranked.find(r => r.rang === 1)?.bid_id}
                    options={ranked.map(r => ({ value: r.bid_id, label: `Rang ${r.rang} — ${name(r.bid_id)} — ${fcfa(r.montant_offre)}` }))} />
                  <Field label="Justification (si l'offre retenue n'est pas la mieux classée)" name={`justification_${l.id}`} rows={2} />
                </div>
              ) : <p key={l.id} className="text-sm text-amber-800">Lot {l.numero_lot} : aucune offre qualifiée, déclaré infructueux.</p>
            }) : <>
            <Field label="Offre retenue" name="bid_id" required defaultValue={rankings.data?.find(r => r.rang === 1)?.bid_id}
              options={(rankings.data ?? []).filter(r => r.qualifie).map(r => ({ value: r.bid_id, label: `Rang ${r.rang} — ${name(r.bid_id)} — ${fcfa(r.montant_offre)}` }))} />
            <Field label="Justification (obligatoire si l'offre retenue n'est pas la mieux classée)" name="justification" rows={2} />
            </>}
          </ActionForm>
        </Card>
      )}


      {['PHASE_10_RECOURS', 'PHASE_11_ATTRIBUTION_DEFINITIVE', 'PHASE_12_SIGNATURE_CONTRAT'].includes(t.current_phase) && (
        <Card title="Attribution et recours">
          <DefinitionList items={[
            { label: 'Attributaire provisoire', value: t.is_alloti ? `${(lots.data ?? []).filter(l => l.statut === 'ATTRIBUE').length} lot(s) attribué(s), ${(lots.data ?? []).filter(l => l.statut === 'INFRUCTUEUX').length} infructueux` : retained ? name(retained) : '—' },
            { label: 'Montant attribué', value: fcfa(t.montant_attribue) },
            { label: 'Fin du délai de recours', value: dateFr(t.date_fin_recours, true) },
            { label: 'Décision ARCOP', value: t.arcop_decision ?? '—' },
          ]} />
          {t.current_phase === 'PHASE_10_RECOURS' && isStaff && (
            <div className="mt-4 space-y-2">
              {closeMissing.length > 0 && <ul className="list-disc pl-5 text-xs text-amber-800">{closeMissing.map(m => <li key={m}>{m}</li>)}</ul>}
              <ActionButton label="Clore la période de recours" action={advancePhase.bind(null, id, 'CLORE_PERIODE_RECOURS', {})} disabled={closeMissing.length > 0} confirm="Clore la période de recours et passer à l'attribution définitive ?" />
            </div>
          )}
          {t.current_phase === 'PHASE_11_ATTRIBUTION_DEFINITIVE' && (
            <div className="mt-4 space-y-2">
              <p className="text-sm">Approbation DCMP : {facts.approbationDcmp ? <Badge tone="green">Favorable</Badge> : <Badge tone="amber">En attente</Badge>}</p>
              {(reviews.data ?? []).map((r, i) => <p key={i} className="text-xs text-gray-500">{dateFr(r.created_at, true)} — {r.decision} {r.motivation ?? ''}</p>)}
              {isPrm && (
                <>
                  {confirmMissing.length > 0 && <ul className="list-disc pl-5 text-xs text-amber-800">{confirmMissing.map(m => <li key={m}>{m}</li>)}</ul>}
                  <ActionButton label="Confirmer l'attribution définitive" action={advancePhase.bind(null, id, 'CONFIRMER_ATTRIBUTION_DEFINITIVE', {})} disabled={confirmMissing.length > 0} confirm="Confirmer l'attribution définitive ?" />
                </>
              )}
            </div>
          )}
          {session.role === 'SOUMISSIONNAIRE' && t.current_phase === 'PHASE_10_RECOURS' && (
            <p className="mt-4"><Link className="font-semibold text-red-700 hover:underline" href={`/dashboard/recours/${id}`}>Former un recours →</Link></p>
          )}
        </Card>
      )}
    </div>
  )
}
