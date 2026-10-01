import type { SupabaseClient } from '@supabase/supabase-js'
import { phaseNumber, type TenderFacts } from '@marchepublic/workflow'
import type { TenderRow } from '@/lib/types'

/**
 * Rassemble les faits nécessaires aux pré-conditions affichées à l'utilisateur.
 * Les requêtes passent par le client de l'utilisateur : la RLS masque ce qu'il n'a pas le droit de voir
 * (par exemple, avant l'ouverture des plis, aucune offre n'est comptée).
 */
export async function loadFacts(supabase: SupabaseClient, t: TenderRow): Promise<TenderFacts> {
  const [docs, reviews, bids, evals, rankings, contract, guarantees, receptions] = await Promise.all([
    supabase.from('tender_documents').select('type, circuit_statut').eq('tender_id', t.id),
    supabase.from('dcmp_reviews').select('type, decision, created_at').eq('tender_id', t.id),
    supabase.from('bids').select('id, status').eq('tender_id', t.id),
    supabase.from('bid_evaluations').select('bid_id, evaluateur_id').eq('tender_id', t.id).eq('round', t.evaluation_round),
    supabase.from('bid_rankings').select('id').eq('tender_id', t.id).eq('round', t.evaluation_round).limit(1),
    supabase.from('contracts').select('id, signed_by_ac, signed_by_titulaire, visa_controleur').eq('tender_id', t.id),
    supabase.from('guarantees').select('contract_id, type, statut').eq('tender_id', t.id),
    supabase.from('receptions').select('contract_id, type, statut').eq('tender_id', t.id),
  ])
  const contracts = contract.data ?? []

  const since = t.transmis_dcmp_at ? new Date(t.transmis_dcmp_at).getTime() : 0
  const fav = (type: string, recent = true) => (reviews.data ?? []).some(r =>
    r.type === type && r.decision === 'FAVORABLE' && (!recent || new Date(r.created_at).getTime() >= since))

  const conformes = (bids.data ?? []).filter(b => b.status === 'CONFORME')
  const evaluatorsByBid = new Map<string, Set<string>>()
  for (const e of evals.data ?? []) {
    if (!evaluatorsByBid.has(e.bid_id)) evaluatorsByBid.set(e.bid_id, new Set())
    evaluatorsByBid.get(e.bid_id)!.add(e.evaluateur_id)
  }
  // Un marché alloti compte un contrat par lot : chaque contrat doit satisfaire la condition.
  const everyContract = (ok: (contractId: string) => boolean) => contracts.length > 0 && contracts.every(c => ok(c.id))
  const accepted = (type: string) => everyContract(id => (receptions.data ?? []).some(r => r.contract_id === id && r.type === type && r.statut !== 'REFUSEE'))

  return {
    phase: t.current_phase,
    modePassation: t.mode_passation,
    montantEstime: t.montant_estime,
    ligneBudgetaire: t.ligne_budgetaire,
    ppmAnnee: t.ppm_annee,
    criteresTotal: (t.criteres_evaluation ?? []).reduce((s, c) => s + Number(c.ponderation), 0),
    documentValide: (docs.data ?? []).some(d => ['TDR', 'DAO'].includes(d.type) && d.circuit_statut === 'VALIDE_PRM'),
    avisDcmpFavorable: fav('AVIS_NON_OBJECTION'),
    isCofinance: t.is_cofinance,
    bailleurFavorable: fav('NON_OBJECTION_BAILLEUR'),
    derogationFavorable: fav('DEROGATION', false),
    datePublication: t.date_publication,
    dateLimiteDepot: t.date_limite_depot,
    bidPublicKey: t.bid_public_key,
    ouvertureSignee: phaseNumber(t.current_phase) > 7,
    offresNonControlees: (bids.data ?? []).filter(b => b.status === 'SOUMISE').length,
    offresConformes: conformes.length,
    offresEvalueesParDeuxEvaluateurs: conformes.length > 0 && conformes.every(b => (evaluatorsByBid.get(b.id)?.size ?? 0) >= 2),
    classementFinalise: (rankings.data ?? []).length > 0,
    attributaireDefini: !!t.attributaire_id,
    hasAppealPending: t.has_appeal_pending,
    dateFinRecours: t.date_fin_recours,
    approbationDcmp: fav('APPROBATION_ATTRIBUTION', false),
    contratSigneEtVise: everyContract(() => true) && contracts.every(c => c.signed_by_ac && c.signed_by_titulaire && c.visa_controleur),
    garantieRequise: t.nature_marche !== 'PRESTATIONS_INTELLECTUELLES',
    garantieBonneExecution: everyContract(id => (guarantees.data ?? []).some(g => g.contract_id === id && g.type === 'BONNE_EXECUTION' && g.statut === 'VALIDE')),
    receptionProvisoire: accepted('PROVISOIRE'),
    receptionDefinitive: accepted('DEFINITIVE'),
  }
}
