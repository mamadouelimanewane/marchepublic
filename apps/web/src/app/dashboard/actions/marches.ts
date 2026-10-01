'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { criteresSchema, tenderSchema, calendrierSchema, lotSchema, formDataToObject } from '@marchepublic/validators'
import { check, db, guarded, parse, rpc, toBool } from '@/lib/action-utils'
import { ok, type ActionResult } from '@/lib/errors'
import { datetimeLocalToIso } from '@/lib/format'

const refresh = () => revalidatePath('/dashboard', 'layout')

/** Fait avancer le marché (RPC advance_phase : rôle, pré-conditions et verrous vérifiés par la base). */
export async function advancePhase(tenderId: string, event: string, payload: Record<string, unknown> = {}): Promise<ActionResult> {
  return guarded(async () => {
    const phase = await rpc<string>('advance_phase', { p_tender: tenderId, p_event: event, p_payload: payload })
    refresh()
    return ok(`Marché passé en ${phase}`, { phase })
  })
}

function tenderFromForm(fd: FormData) {
  const raw = formDataToObject(fd)
  return parse(tenderSchema, {
    ...raw,
    montant_estime: Number(raw.montant_estime),
    ppm_annee: Number(raw.ppm_annee),
    ppm_trimestre: Number(raw.ppm_trimestre),
    is_reserve_pme: toBool(fd.get('is_reserve_pme')),
    is_reserve_pme_feminine: toBool(fd.get('is_reserve_pme_feminine')),
    is_cofinance: toBool(fd.get('is_cofinance')),
    is_alloti: toBool(fd.get('is_alloti')),
  })
}

export async function createTender(fd: FormData): Promise<ActionResult<{ id: string }>> {
  return guarded(async session => {
    if (!session.institution_id) throw new Error('Votre compte n\'est rattaché à aucune institution.')
    const t = tenderFromForm(fd)
    const supabase = await db()
    const { data } = check(await supabase.from('tenders').insert({
      institution_id: session.institution_id, title: t.title, description: t.description, nature_marche: t.nature_marche,
      montant_estime: t.montant_estime, corps_metier_id: t.corps_metier_id, ligne_budgetaire: t.ligne_budgetaire,
      ppm_annee: t.ppm_annee, ppm_trimestre: t.ppm_trimestre, is_reserve_pme: t.is_reserve_pme,
      is_reserve_pme_feminine: t.is_reserve_pme_feminine, is_cofinance: t.is_cofinance, is_alloti: t.is_alloti,
      mode_passation: t.mode_passation, justification_mode: t.justification_mode, prm_id: session.role === 'PRM' ? session.id : null,
    }).select('id, reference, mode_passation').single())
    refresh()
    return ok(`Marché ${data!.reference} créé (mode : ${data!.mode_passation})`, { id: data!.id })
  }) as Promise<ActionResult<{ id: string }>>
}

export async function updateTender(tenderId: string, fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const t = tenderFromForm(fd)
    const supabase = await db()
    check(await supabase.from('tenders').update({
      title: t.title, description: t.description ?? null, nature_marche: t.nature_marche, montant_estime: t.montant_estime,
      corps_metier_id: t.corps_metier_id, ligne_budgetaire: t.ligne_budgetaire ?? null, ppm_annee: t.ppm_annee, ppm_trimestre: t.ppm_trimestre,
      is_reserve_pme: t.is_reserve_pme, is_reserve_pme_feminine: t.is_reserve_pme_feminine, is_cofinance: t.is_cofinance, is_alloti: t.is_alloti,
      mode_passation: t.mode_passation ?? null, justification_mode: t.justification_mode ?? null,
    }).eq('id', tenderId))
    refresh()
    return ok('Marché mis à jour')
  })
}

/** Les critères sont saisis « Critère | pondération », un par ligne. */
export async function setCriteres(tenderId: string, fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const lines = String(fd.get('criteres') ?? '').split('\n').map(l => l.trim()).filter(Boolean)
    const criteres = lines.map(line => {
      const [critere, ponderation] = line.split('|').map(s => s.trim())
      return { critere, ponderation: Number(ponderation) }
    })
    const valid = parse(criteresSchema, criteres)
    const supabase = await db()
    check(await supabase.from('tenders').update({ criteres_evaluation: valid }).eq('id', tenderId))
    refresh()
    return ok('Critères d\'évaluation enregistrés')
  })
}

export async function applyEvaluationTemplate(tenderId: string, templateId: string): Promise<ActionResult> {
  return guarded(async () => {
    const supabase = await db()
    const { data } = check(await supabase.from('evaluation_templates').select('criteres').eq('id', templateId).single())
    check(await supabase.from('tenders').update({ criteres_evaluation: data!.criteres }).eq('id', tenderId))
    refresh()
    return ok('Grille type appliquée')
  })
}

export async function setCalendrier(tenderId: string, fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const raw = formDataToObject(fd)
    const v = parse(calendrierSchema, raw)
    const supabase = await db()
    check(await supabase.from('tenders').update({
      date_limite_depot: datetimeLocalToIso(v.date_limite_depot),
      date_ouverture_plis: v.date_ouverture_plis ? datetimeLocalToIso(v.date_ouverture_plis) : null,
    }).eq('id', tenderId))
    refresh()
    return ok('Calendrier enregistré')
  })
}

/** Enregistre la CLÉ PUBLIQUE du marché (la clé privée ne quitte jamais le navigateur du CPM). */
export async function setMarketKey(tenderId: string, publicKey: string, fingerprint: string, shares?: number, threshold?: number): Promise<ActionResult> {
  return guarded(async () => {
    parse(z.object({ pk: z.string().min(100).max(2000), fp: z.string().regex(/^[0-9a-f]{64}$/) }), { pk: publicKey, fp: fingerprint })
    const supabase = await db()
    check(await supabase.from('tenders').update({
      bid_public_key: publicKey, bid_key_fingerprint: fingerprint,
      bid_key_shares: shares && threshold ? shares : null, bid_key_threshold: shares && threshold ? threshold : null,
    }).eq('id', tenderId))
    refresh()
    return ok('Clé publique de chiffrement enregistrée')
  })
}

export async function addCommissionMember(tenderId: string, fd: FormData): Promise<ActionResult> {
  return guarded(async session => {
    const v = parse(z.object({ user_id: z.string().uuid('Membre invalide'), role_commission: z.enum(['PRESIDENT', 'MEMBRE', 'SECRETAIRE', 'OBSERVATEUR']) }), fd)
    const supabase = await db()
    check(await supabase.from('commission_members').insert({ tender_id: tenderId, institution_id: session.institution_id, ...v }))
    refresh()
    return ok('Membre ajouté à la commission')
  })
}

export async function removeCommissionMember(memberId: string): Promise<ActionResult> {
  return guarded(async () => {
    const supabase = await db()
    check(await supabase.from('commission_members').delete().eq('id', memberId))
    refresh()
    return ok('Membre retiré')
  })
}

/** Procédure infructueuse (phase 8) : motif obligatoire, dossier clos sans contrat. */
export async function declareInfructueux(tenderId: string, fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const motif = String(fd.get('motif') ?? '').trim()
    await rpc('advance_phase', { p_tender: tenderId, p_event: 'DECLARER_INFRUCTUEUX', p_payload: { motif } })
    refresh()
    return ok('Procédure déclarée infructueuse : dossier clos, candidats et DCMP notifiés')
  })
}

/** Relance : crée un nouveau marché en phase 1 à partir du marché infructueux. */
export async function relancerMarche(tenderId: string): Promise<ActionResult<{ id: string }>> {
  return guarded(async () => {
    const id = await rpc<string>('relancer_marche', { p_tender: tenderId })
    refresh()
    return ok('Nouveau marché créé en phase 1', { id })
  }) as Promise<ActionResult<{ id: string }>>
}

/** Lots d'un marché alloti (modifiables jusqu'à la transmission à la DCMP). */
export async function addLot(tenderId: string, fd: FormData): Promise<ActionResult> {
  return guarded(async session => {
    const v = parse(lotSchema, fd)
    const supabase = await db()
    check(await supabase.from('tender_lots').insert({ tender_id: tenderId, institution_id: session.institution_id, ...v, description: v.description ?? null }))
    refresh()
    return ok(`Lot ${v.numero_lot} ajouté`)
  })
}

export async function removeLot(lotId: string): Promise<ActionResult> {
  return guarded(async () => {
    const supabase = await db()
    check(await supabase.from('tender_lots').delete().eq('id', lotId))
    refresh()
    return ok('Lot supprimé')
  })
}
