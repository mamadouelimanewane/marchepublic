import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/supabase/server'
import { renderPdf, type PdfModel } from '@/lib/pdf'
import {
  contratModel, decisionAttributionModel, documentModel, pvOuvertureModel, pvReceptionModel, rapportEvaluationModel,
} from '@/lib/pdf-models'

// Documents officiels générés à la demande depuis les données de la base. Les lectures passent par la session de
// l'utilisateur : la RLS décide de ce qu'il peut produire (un document inaccessible répond 404, sans fuite d'information).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const notFound = () => NextResponse.json({ error: 'Document introuvable' }, { status: 404 })

type Row = Record<string, any>

export async function GET(_req: NextRequest, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params
  if (!UUID.test(id)) return notFound()
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const tenderInfo = (t: Row) => ({
    reference: t.reference, title: t.title, institution: t.institutions?.name ?? '', nature_marche: t.nature_marche,
    mode_passation: t.mode_passation, montant_estime: t.montant_estime, montant_attribue: t.montant_attribue,
  })
  const tenderCols = 'id, reference, title, nature_marche, mode_passation, montant_estime, montant_attribue, evaluation_round, criteres_evaluation, date_limite_depot, date_fin_recours, date_attribution_provisoire, institutions(name)'
  let model: PdfModel | null = null

  if (kind === 'document') {
    const { data: d } = await supabase.from('tender_documents').select('id, tender_id, titre, type, circuit_statut, contenu').eq('id', id).maybeSingle()
    if (!d) return notFound()
    const [{ data: t }, { data: v }] = await Promise.all([
      supabase.from('tenders').select(tenderCols).eq('id', d.tender_id).single(),
      supabase.from('document_versions').select('version, circuit_statut, content_hash, created_at').eq('document_id', id).order('version', { ascending: false }),
    ])
    if (!t) return notFound()
    model = documentModel(tenderInfo(t), { titre: d.titre, type: d.type, circuit_statut: d.circuit_statut, sections: (d.contenu as Row)?.sections ?? [] }, (v ?? []) as never[])
  } else if (kind === 'pv-ouverture') {
    const { data: t } = await supabase.from('tenders').select(tenderCols).eq('id', id).maybeSingle()
    const { data: o } = await supabase.from('bid_openings').select('opened_at, nb_plis, key_fingerprint, observations').eq('tender_id', id).maybeSingle()
    if (!t || !o) return notFound()
    const [{ data: members }, { data: bids }] = await Promise.all([
      supabase.from('commission_members').select('role_commission, users(full_name)').eq('tender_id', id),
      supabase.from('bids').select('status, montant_offre, submitted_at, motif_non_conformite, lots:lot_id(numero_lot), users:soumissionnaire_id(full_name, ninea)').eq('tender_id', id).order('submitted_at'),
    ])
    model = pvOuvertureModel({ ...tenderInfo(t), date_limite_depot: t.date_limite_depot }, o,
      (members ?? []).map((m: Row) => ({ nom: m.users?.full_name ?? '-', fonction: m.role_commission })),
      (bids ?? []).map((b: Row) => ({ candidat: b.users?.full_name ?? 'Candidat', ninea: b.users?.ninea ?? null, lot: b.lots ? `Lot ${b.lots.numero_lot}` : null, recu: b.submitted_at, montant: b.montant_offre, statut: b.status, motif: b.motif_non_conformite })))
  } else if (kind === 'rapport-evaluation') {
    const { data: t } = await supabase.from('tenders').select(tenderCols).eq('id', id).maybeSingle()
    if (!t) return notFound()
    const [{ data: rk }, { data: bids }, { data: cfg }] = await Promise.all([
      supabase.from('bid_rankings').select('bid_id, rang, qualifie, score_technique, score_financier, score_global, montant_offre').eq('tender_id', id).eq('round', t.evaluation_round).order('lot_id').order('rang', { nullsFirst: false }),
      supabase.from('bids').select('id, lots:lot_id(numero_lot), users:soumissionnaire_id(full_name)').eq('tender_id', id),
      supabase.from('config_seuils').select('valeur').eq('cle', 'EVAL_SEUIL_TECHNIQUE').maybeSingle(),
    ])
    if (!rk?.length) return notFound()
    const by = new Map((bids ?? []).map((b: Row) => [b.id, b]))
    model = rapportEvaluationModel({ ...tenderInfo(t), evaluation_round: t.evaluation_round }, t.criteres_evaluation ?? [],
      rk.map((r: Row) => ({ lot: by.get(r.bid_id)?.lots ? `Lot ${by.get(r.bid_id)?.lots?.numero_lot}` : null, rang: r.rang, candidat: by.get(r.bid_id)?.users?.full_name ?? 'Candidat', technique: r.score_technique, financier: r.score_financier, global: r.score_global, montant: r.montant_offre, qualifie: r.qualifie })),
      Number(cfg?.valeur ?? 70))
  } else if (kind === 'decision-attribution') {
    const { data: t } = await supabase.from('tenders').select(`${tenderCols}, is_alloti, attributaire_id, current_phase`).eq('id', id).maybeSingle()
    if (!t || !t.date_attribution_provisoire) return notFound()
    let awards: { lot: string | null; candidat: string; montant: number | null }[] = []
    let infructueux: string[] = []
    if (t.is_alloti) {
      const { data: lots } = await supabase.from('tender_lots').select('numero_lot, libelle, statut, montant_attribue, attributaire:attributaire_id(full_name)').eq('tender_id', id).order('numero_lot')
      awards = (lots ?? []).filter((l: Row) => l.statut === 'ATTRIBUE').map((l: Row) => ({ lot: `Lot ${l.numero_lot} - ${l.libelle}`, candidat: l.attributaire?.full_name ?? 'Attributaire', montant: l.montant_attribue }))
      infructueux = (lots ?? []).filter((l: Row) => l.statut === 'INFRUCTUEUX').map((l: Row) => `Lot ${l.numero_lot}`)
    } else {
      const { data: u } = t.attributaire_id ? await supabase.from('users').select('full_name').eq('id', t.attributaire_id).maybeSingle() : { data: null }
      awards = [{ lot: null, candidat: u?.full_name ?? 'Attributaire', montant: t.montant_attribue }]
    }
    model = decisionAttributionModel({ ...tenderInfo(t), date_fin_recours: t.date_fin_recours, date_attribution_provisoire: t.date_attribution_provisoire }, awards, infructueux)
  } else if (kind === 'pv-reception') {
    const { data: r } = await supabase.from('receptions').select('type, date_reception, statut, reserves, contract_id, tender_id, commission').eq('id', id).maybeSingle()
    if (!r) return notFound()
    const [{ data: t }, { data: c }] = await Promise.all([
      supabase.from('tenders').select(tenderCols).eq('id', r.tender_id).single(),
      supabase.from('contracts').select('montant_initial, montant_actuel, attributaire_id, lots:lot_id(numero_lot)').eq('id', r.contract_id).single(),
    ])
    if (!t || !c) return notFound()
    const { data: holder } = await supabase.from('users').select('full_name').eq('id', c.attributaire_id).maybeSingle()
    model = pvReceptionModel(tenderInfo(t), { montant_actuel: c.montant_actuel, montant_initial: c.montant_initial, lot: (c as Row).lots ? `Lot ${(c as Row).lots.numero_lot}` : null },
      holder?.full_name ?? 'Titulaire', r, ((r.commission as Row[]) ?? []).map(m => ({ nom: m.nom ?? m.full_name ?? '-' })))
  } else if (kind === 'contrat') {
    const { data: c } = await supabase.from('contracts').select('id, tender_id, attributaire_id, montant_initial, date_debut_execution, delai_execution, signed_by_ac, signed_by_titulaire, visa_controleur, lots:lot_id(numero_lot, libelle)').eq('id', id).maybeSingle()
    if (!c) return notFound()
    const [{ data: t }, { data: holder }, { data: g }] = await Promise.all([
      supabase.from('tenders').select(tenderCols).eq('id', c.tender_id).single(),
      supabase.from('users').select('full_name, ninea').eq('id', c.attributaire_id).maybeSingle(),
      supabase.from('guarantees').select('type, montant, emetteur, reference, date_expiration').eq('contract_id', id),
    ])
    if (!t) return notFound()
    // Clauses types : données de référence non sensibles, lues avec le client de service une fois l'accès au contrat établi.
    let clauses: Row[] | null = null
    try {
      clauses = (await createSupabaseAdminClient().from('clause_templates').select('titre, contenu, natures, obligatoire').eq('is_active', true).eq('obligatoire', true)).data
    } catch {
      clauses = null   // clé de service absente : le contrat est produit sans les clauses types plutôt que d'échouer
    }
    const applicable = (clauses ?? []).filter((cl: Row) => !cl.natures || cl.natures.includes(t.nature_marche))
    model = contratModel(tenderInfo(t), { ...c, lot: (c as Row).lots ? `Lot ${(c as Row).lots.numero_lot} - ${(c as Row).lots.libelle}` : null },
      { nom: holder?.full_name ?? 'Titulaire', ninea: holder?.ninea ?? null }, applicable as never[], (g ?? []) as never[])
  } else return notFound()

  const bytes = await renderPdf(model)
  const filename = `${kind}-${(model.reference || id).replace(/[^A-Za-z0-9._-]+/g, '_')}.pdf`
  return new NextResponse(Buffer.from(bytes), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${filename}"`, 'Cache-Control': 'no-store' },
  })
}
