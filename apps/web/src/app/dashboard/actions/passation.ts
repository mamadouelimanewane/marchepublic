'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import {
  appealDecisionSchema, appealSchema, attributionSchema, besoinSchema, conformiteSchema, documentSchema, grilleSchema,
  questionSchema, reponseSchema, reviewSchema, sectionsSchema, formDataToObject,
} from '@marchepublic/validators'
import { mergeSections, type DocSection } from '@marchepublic/workflow'
import { tenderVariables } from '@/lib/redaction'
import { check, db, guarded, parse, rpc } from '@/lib/action-utils'
import { ok, type ActionResult } from '@/lib/errors'

const refresh = () => revalidatePath('/dashboard', 'layout')

// ------------------------------------------
// Programmation : besoins
// ------------------------------------------
export async function createBesoin(fd: FormData): Promise<ActionResult> {
  return guarded(async session => {
    const v = parse(besoinSchema, fd)
    const submit = fd.get('intent') === 'submit'
    const supabase = await db()
    check(await supabase.from('besoins').insert({
      ...v, institution_id: session.institution_id, service_demandeur_id: session.id, statut: submit ? 'SOUMIS' : 'BROUILLON',
    }))
    refresh()
    return ok(submit ? 'Besoin soumis au PRM' : 'Brouillon enregistré')
  })
}

export async function submitBesoin(besoinId: string): Promise<ActionResult> {
  return guarded(async () => {
    const supabase = await db()
    check(await supabase.from('besoins').update({ statut: 'SOUMIS' }).eq('id', besoinId))
    refresh()
    return ok('Besoin soumis au PRM')
  })
}

export async function decideBesoin(besoinId: string, decision: 'VALIDER' | 'REJETER', fd?: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const motif = fd ? String(fd.get('motif') ?? '') : undefined
    const tender = await rpc<string | null>('programmer_besoin', { p_besoin: besoinId, p_decision: decision, p_motif: motif ?? null })
    refresh()
    return ok(decision === 'VALIDER' ? 'Besoin validé : marché inscrit au PPM' : 'Besoin rejeté', { tender })
  })
}

// ------------------------------------------
// Rédaction : documents, versions, circuit
// ------------------------------------------
export async function createDocument(fd: FormData): Promise<ActionResult<{ id: string }>> {
  return guarded(async session => {
    const v = parse(documentSchema, fd)
    const supabase = await db()
    let contenu: unknown = { sections: [] }
    if (v.template_id) {
      const { data } = check(await supabase.from('document_templates').select('sections').eq('id', v.template_id).single())
      // Les variables ({{reference}}, {{autorite}}…) sont remplacées par les données du marché et du besoin ; les autres restent à compléter.
      contenu = { sections: mergeSections(data!.sections as DocSection[], await tenderVariables(supabase, v.tender_id)) }
    }
    const { data } = check(await supabase.from('tender_documents').insert({
      tender_id: v.tender_id, institution_id: session.institution_id, type: v.type, titre: v.titre,
      template_id: v.template_id ?? null, contenu,
    }).select('id').single())
    refresh()
    return ok('Document créé', { id: data!.id })
  }) as Promise<ActionResult<{ id: string }>>
}

export async function saveDocument(documentId: string, sections: unknown): Promise<ActionResult> {
  return guarded(async () => {
    const valid = parse(sectionsSchema, sections as Record<string, unknown>)
    const supabase = await db()
    check(await supabase.from('tender_documents').update({ contenu: { sections: valid } }).eq('id', documentId))
    refresh()
    return ok('Nouvelle version enregistrée')
  })
}

export async function setDocumentCircuit(documentId: string, statut: 'RELECTURE_CPM' | 'VALIDE_PRM' | 'REDACTION'): Promise<ActionResult> {
  return guarded(async () => {
    const supabase = await db()
    check(await supabase.from('tender_documents').update({ circuit_statut: statut }).eq('id', documentId))
    refresh()
    return ok(statut === 'VALIDE_PRM' ? 'Document validé par le PRM' : statut === 'RELECTURE_CPM' ? 'Document transmis à la CPM pour relecture' : 'Document renvoyé en rédaction')
  })
}

export async function addDocumentComment(documentId: string, tenderId: string, fd: FormData): Promise<ActionResult> {
  return guarded(async session => {
    const contenu = parse(z.object({ contenu: z.string().trim().min(1, 'Commentaire vide') }), fd).contenu
    const supabase = await db()
    check(await supabase.from('document_comments').insert({
      document_id: documentId, tender_id: tenderId, institution_id: session.institution_id, contenu, section_id: String(fd.get('section_id') || '') || null,
    }))
    refresh()
    return ok('Commentaire ajouté')
  })
}

// ------------------------------------------
// Contrôle a priori : avis DCMP / bailleur
// ------------------------------------------
export async function recordReview(fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const v = parse(reviewSchema, fd)
    await rpc('record_review', { p_tender: v.tender_id, p_type: v.type, p_decision: v.decision, p_motivation: v.motivation ?? null, p_document_path: null })
    refresh()
    return ok('Avis enregistré')
  })
}

// ------------------------------------------
// Publication : Q&R, retrait du dossier
// ------------------------------------------
export async function askQuestion(fd: FormData): Promise<ActionResult> {
  return guarded(async session => {
    const v = parse(questionSchema, fd)
    const supabase = await db()
    const { data: tender } = check(await supabase.from('tenders').select('institution_id').eq('id', v.tender_id).single())
    check(await supabase.from('clarifications').insert({ tender_id: v.tender_id, institution_id: tender!.institution_id, question: v.question, auteur_id: session.id }))
    refresh()
    return ok('Question envoyée à la cellule de passation')
  })
}

export async function answerQuestion(fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const v = parse(reponseSchema, fd)
    const supabase = await db()
    check(await supabase.from('clarifications').update({ reponse: v.reponse }).eq('id', v.id))
    refresh()
    return ok('Réponse publiée à tous les candidats')
  })
}

export async function retirerDossier(tenderId: string): Promise<ActionResult> {
  return guarded(async session => {
    const supabase = await db()
    const { data: tender } = check(await supabase.from('tenders').select('institution_id').eq('id', tenderId).single())
    check(await supabase.from('dossier_retraits').upsert(
      { tender_id: tenderId, soumissionnaire_id: session.id, institution_id: tender!.institution_id }, { onConflict: 'tender_id,soumissionnaire_id', ignoreDuplicates: true }))
    refresh()
    return ok('Dossier retiré : vous recevrez les additifs et réponses')
  })
}

// ------------------------------------------
// Dépôt et ouverture
// ------------------------------------------
export async function submitBid(input: { tender_id: string; lot_id?: string | null; technique_path: string; technique_hash: string; financier_path: string; financier_hash: string }): Promise<ActionResult<{ receipt?: string }>> {
  return guarded(async () => {
    const v = parse(z.object({
      tender_id: z.string().uuid(), lot_id: z.string().uuid().nullish(), technique_path: z.string().min(10), technique_hash: z.string().regex(/^[0-9a-f]{64}$/),
      financier_path: z.string().min(10), financier_hash: z.string().regex(/^[0-9a-f]{64}$/),
    }), input)
    const res = await rpc<{ ok: boolean; reason?: string; receipt?: string; submitted_at?: string }>('submit_bid', {
      p_tender: v.tender_id, p_technique_path: v.technique_path, p_technique_hash: v.technique_hash,
      p_financier_path: v.financier_path, p_financier_hash: v.financier_hash, p_lot: v.lot_id ?? null,
    })
    refresh()
    if (!res.ok) {
      return { ok: false, message: res.reason === 'LATE' ? 'Offre tardive : rejetée et tracée.' : 'Le dépôt n\'est pas ouvert pour ce marché.' }
    }
    return ok('Offre déposée. Accusé de réception enregistré.', { receipt: res.receipt })
  }) as Promise<ActionResult<{ receipt?: string }>>
}

export async function withdrawBid(bidId: string): Promise<ActionResult> {
  return guarded(async () => {
    const supabase = await db()
    check(await supabase.from('bids').update({ status: 'RETIREE' }).eq('id', bidId))
    refresh()
    return ok('Offre retirée')
  })
}

export async function signOpening(tenderId: string, observations?: string): Promise<ActionResult> {
  return guarded(async () => {
    const r = await rpc<{ opened: boolean; waiting_for?: string; nb_plis?: number }>('sign_opening', { p_tender: tenderId, p_observations: observations ?? null })
    refresh()
    return r.opened ? ok(`Ouverture effective : ${r.nb_plis} pli(s). Le marché passe en évaluation.`) : ok(`Signature enregistrée. En attente de : ${r.waiting_for === 'PRESIDENT' ? 'président de la commission' : 'CPM'}.`)
  })
}

export async function recordConformite(fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const raw = formDataToObject(fd)
    const v = parse(conformiteSchema, { ...raw, conformite_admin: fd.get('conformite_admin') === 'true', montant_offre: raw.montant_offre ? Number(raw.montant_offre) : undefined })
    const supabase = await db()
    const patch: Record<string, unknown> = { conformite_admin: v.conformite_admin, motif_non_conformite: v.motif_non_conformite ?? null }
    if (v.montant_offre) patch.montant_offre = v.montant_offre
    check(await supabase.from('bids').update(patch).eq('id', v.bid_id))
    refresh()
    return ok('Contrôle de conformité enregistré')
  })
}

// ------------------------------------------
// Évaluation et attribution
// ------------------------------------------
export async function saveEvaluation(tenderId: string, bidId: string, grille: unknown): Promise<ActionResult> {
  return guarded(async session => {
    const g = parse(grilleSchema, grille as Record<string, unknown>)
    const supabase = await db()
    const { data: existing } = await supabase.from('bid_evaluations').select('id').eq('bid_id', bidId).eq('evaluateur_id', session.id).maybeSingle()
    if (existing) {
      check(await supabase.from('bid_evaluations').update({ grille_technique: g }).eq('id', existing.id))
    } else {
      check(await supabase.from('bid_evaluations').insert({
        tender_id: tenderId, institution_id: session.institution_id, bid_id: bidId, evaluateur_id: session.id, grille_technique: g,
      }))
    }
    refresh()
    return ok('Notation enregistrée (score recalculé par le serveur)')
  })
}

export async function prononcerAttribution(fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const v = parse(attributionSchema, fd)
    // Marché alloti : champs bid_<lot> / justification_<lot> (un couple par lot) ; sinon champs uniques.
    const awards: { lot_id: string; bid_id: string | null; justification: string | null }[] = []
    for (const [k, val] of fd.entries()) {
      const m = k.match(/^bid_([0-9a-f-]{36})$/)
      if (m) awards.push({ lot_id: m[1], bid_id: String(val) || null, justification: String(fd.get(`justification_${m[1]}`) ?? '').trim() || null })
    }
    const phase = await rpc<string>('advance_phase', {
      p_tender: v.tender_id, p_event: 'PRONONCER_ATTRIBUTION_PROVISOIRE',
      p_payload: awards.length ? { awards } : { bid_id: v.bid_id ?? null, justification: v.justification ?? null },
    })
    refresh()
    return ok('Attribution provisoire prononcée, candidats notifiés', { phase })
  })
}

// ------------------------------------------
// Recours
// ------------------------------------------
export async function submitAppeal(fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const v = parse(appealSchema, fd)
    await rpc('submit_appeal', { p_tender: v.tender_id, p_motif: v.motif, p_description: v.description ?? null, p_document_path: null })
    refresh()
    return ok('Recours déposé. La procédure est suspendue jusqu\'à la décision de l\'ARCOP.')
  })
}

export async function decideAppeal(fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const v = parse(appealDecisionSchema, fd)
    await rpc('decide_appeal', { p_appeal: v.appeal_id, p_decision: v.decision, p_motivation: v.motivation ?? null })
    refresh()
    return ok(v.decision === 'EN_INSTRUCTION' ? 'Recours mis en instruction' : 'Décision notifiée aux parties')
  })
}

export async function publishAddendum(tenderId: string, fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const v = parse(z.object({ titre: z.string().trim().min(5).max(200), contenu: z.string().trim().min(10).max(20000) }), fd)
    await rpc('publish_addendum', { p_tender: tenderId, p_titre: v.titre, p_contenu: v.contenu })
    refresh()
    return ok('Additif publié et notifié aux candidats ayant retiré le dossier')
  })
}
