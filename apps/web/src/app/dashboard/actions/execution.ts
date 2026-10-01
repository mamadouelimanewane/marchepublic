'use server'

import { revalidatePath } from 'next/cache'
import {
  amendmentSchema, guaranteeSchema, incidentSchema, paymentSchema, progressSchema, providerEvaluationSchema,
  receptionSchema, serviceOrderSchema, subcontractorSchema, formDataToObject,
} from '@marchepublic/validators'
import { check, db, guarded, parse, rpc } from '@/lib/action-utils'
import { fail, ok, toMessage, type ActionResult } from '@/lib/errors'

const refresh = () => revalidatePath('/dashboard', 'layout')

async function contractInfo(contractId: string) {
  const supabase = await db()
  const { data } = check(await supabase.from('contracts').select('id, tender_id, institution_id').eq('id', contractId).single())
  return data!
}

export async function prepareContract(tenderId: string, fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const raw = formDataToObject(fd)
    await rpc('prepare_contract', {
      p_tender: tenderId, p_date_debut: raw.date_debut ?? null, p_delai_jours: raw.delai_jours ? Number(raw.delai_jours) : null,
      p_lot: raw.lot_id ?? null,
    })
    refresh()
    return ok('Contrat préparé (montant = montant attribué)')
  })
}

export async function signContract(contractId: string): Promise<ActionResult> {
  return guarded(async () => {
    const r = await rpc<{ party: string }>('sign_contract', { p_contract: contractId })
    refresh()
    return ok(r.party === 'TITULAIRE' ? 'Contrat signé par le titulaire' : 'Contrat signé par l\'autorité contractante')
  })
}

export async function visaContract(contractId: string): Promise<ActionResult> {
  return guarded(async () => {
    await rpc('visa_contract', { p_contract: contractId })
    refresh()
    return ok('Visa du contrôle financier apposé')
  })
}

export async function addGuarantee(fd: FormData): Promise<ActionResult> {
  return guarded(async session => {
    const v = parse(guaranteeSchema, fd)
    const supabase = await db()
    check(await supabase.from('guarantees').insert({ ...v, contract_id: v.contract_id ?? null, institution_id: session.institution_id }))
    refresh()
    return ok('Garantie enregistrée')
  })
}

/** Avenant : le plafond de 30 % est imposé par la base ; en cas de refus la tentative est tracée au journal d'audit. */
export async function addAmendment(fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const v = parse(amendmentSchema, fd)
    const c = await contractInfo(v.contract_id)
    const supabase = await db()
    const { error } = await supabase.from('contract_amendments').insert({
      contract_id: v.contract_id, tender_id: c.tender_id, institution_id: c.institution_id,
      numero_avenant: v.numero_avenant, motif: v.motif, montant_avenant: v.montant_avenant,
    })
    if (error) {
      if (/AVENANT_LIMIT_EXCEEDED/.test(error.message)) {
        await supabase.rpc('record_blocked_attempt', { p_kind: 'AVENANT', p_contract: v.contract_id, p_montant: v.montant_avenant })
      }
      return fail(error)
    }
    refresh()
    return ok('Avenant enregistré')
  })
}

export async function addSubcontractor(fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const v = parse(subcontractorSchema, fd)
    const c = await contractInfo(v.contract_id)
    const supabase = await db()
    const { error } = await supabase.from('subcontractors').insert({
      contract_id: v.contract_id, tender_id: c.tender_id, institution_id: c.institution_id,
      nom_sous_traitant: v.nom_sous_traitant, ninea: v.ninea ?? null, objet: v.objet, montant: v.montant,
    })
    if (error) {
      if (/SUBCONTRACTOR_LIMIT_EXCEEDED/.test(error.message)) {
        await supabase.rpc('record_blocked_attempt', { p_kind: 'SOUS_TRAITANCE', p_contract: v.contract_id, p_montant: v.montant })
      }
      return fail(error)
    }
    refresh()
    return ok('Sous-traitant déclaré')
  })
}

export async function addServiceOrder(fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const v = parse(serviceOrderSchema, fd)
    const c = await contractInfo(v.contract_id)
    const supabase = await db()
    check(await supabase.from('service_orders').insert({ ...v, tender_id: c.tender_id, institution_id: c.institution_id }))
    refresh()
    return ok('Ordre de service enregistré')
  })
}

export async function addIncident(fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const v = parse(incidentSchema, fd)
    const c = await contractInfo(v.contract_id)
    const supabase = await db()
    check(await supabase.from('execution_incidents').insert({ ...v, tender_id: c.tender_id, institution_id: c.institution_id }))
    refresh()
    return ok('Incident consigné')
  })
}

export async function addProgress(fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const v = parse(progressSchema, fd)
    const c = await contractInfo(v.contract_id)
    const supabase = await db()
    check(await supabase.from('progress_reports').insert({ ...v, tender_id: c.tender_id, institution_id: c.institution_id }))
    refresh()
    return ok('Rapport d\'avancement enregistré')
  })
}

export async function addReception(fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const v = parse(receptionSchema, fd)
    const c = await contractInfo(v.contract_id)
    const supabase = await db()
    check(await supabase.from('receptions').insert({ ...v, reserves: v.reserves ?? null, tender_id: c.tender_id, institution_id: c.institution_id }))
    refresh()
    return ok(`Réception ${v.type === 'PROVISOIRE' ? 'provisoire' : 'définitive'} enregistrée`)
  })
}

export async function submitPayment(fd: FormData): Promise<ActionResult> {
  return guarded(async session => {
    const v = parse(paymentSchema, fd)
    const c = await contractInfo(v.contract_id)
    const supabase = await db()
    check(await supabase.from('payment_statements').insert({
      ...v, tender_id: c.tender_id, institution_id: c.institution_id, soumis_par: session.id, statut: 'SOUMIS',
    }))
    refresh()
    return ok('Décompte soumis')
  })
}

export async function processPayment(paymentId: string, statut: 'VALIDE_AC' | 'VISA_CF' | 'TRANSMIS_TRESOR' | 'PAYE' | 'REJETE', fd?: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const supabase = await db()
    const patch: Record<string, unknown> = { statut }
    if (statut === 'REJETE') {
      const motif = String(fd?.get('motif_rejet') ?? '').trim()
      if (motif.length < 5) throw new Error('Motif de rejet obligatoire')
      patch.motif_rejet = motif
    }
    if (statut === 'TRANSMIS_TRESOR' && fd?.get('reference_sigfip')) patch.reference_sigfip = String(fd.get('reference_sigfip'))
    check(await supabase.from('payment_statements').update(patch).eq('id', paymentId))
    refresh()
    return ok(`Décompte : ${statut}`)
  })
}

export async function evaluateProvider(fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const v = parse(providerEvaluationSchema, fd)
    const supabase = await db()
    const { data: c } = check(await supabase.from('contracts').select('id, tender_id, institution_id, attributaire_id').eq('id', v.contract_id).single())
    check(await supabase.from('provider_evaluations').insert({
      contract_id: v.contract_id, tender_id: c!.tender_id, institution_id: c!.institution_id, prestataire_id: c!.attributaire_id,
      note_qualite: v.note_qualite, note_delai: v.note_delai, note_cout: v.note_cout, commentaire: v.commentaire ?? null,
    }))
    refresh()
    return ok('Évaluation du prestataire enregistrée')
  })
}

export async function archiveTender(tenderId: string): Promise<ActionResult> {
  return guarded(async () => {
    await rpc('archive_tender', { p_tender: tenderId })
    refresh()
    return ok('Dossier archivé : inventaire et empreinte enregistrés, marché figé')
  })
}

export async function verifyAuditChain(institutionId: string | null): Promise<ActionResult<{ broken: number }>> {
  try {
    const supabase = await db()
    const { data, error } = await supabase.rpc('verify_audit_chain', { p_institution: institutionId })
    if (error) throw error
    const broken = (data as unknown[]).length
    return broken === 0
      ? { ok: true, message: 'Chaîne d\'audit intègre : aucune altération détectée.', data: { broken } }
      : { ok: false, message: `⚠ ${broken} anomalie(s) détectée(s) dans la chaîne d'audit.`, data: { broken } }
  } catch (e) {
    return { ok: false, message: toMessage(e) }
  }
}
