'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { check, db, guarded, parse, rpc } from '@/lib/action-utils'
import { ok, type ActionResult } from '@/lib/errors'
import { PIECE_TYPES } from '@/lib/pieces'

const refresh = () => revalidatePath('/dashboard', 'layout')

/** Enregistre une pièce après son téléversement (le fichier est déjà dans le dossier personnel du fournisseur). */
export async function addSupplierDocument(input: { type: string; titre: string; date_emission?: string; date_expiration?: string; storage_path: string; file_hash: string }): Promise<ActionResult> {
  return guarded(async session => {
    const v = parse(z.object({
      type: z.enum(PIECE_TYPES), titre: z.string().trim().min(3).max(200),
      date_emission: z.string().optional().transform(s => s || undefined), date_expiration: z.string().optional().transform(s => s || undefined),
      storage_path: z.string().min(10), file_hash: z.string().regex(/^[0-9a-f]{64}$/, 'Empreinte SHA-256 invalide'),
    }), input)
    if (!v.storage_path.startsWith(`${session.id}/`)) throw new Error('Le fichier doit se trouver dans votre dossier personnel.')
    const supabase = await db()
    check(await supabase.from('supplier_documents').insert({
      type: v.type, titre: v.titre, date_emission: v.date_emission ?? null, date_expiration: v.date_expiration ?? null,
      storage_path: v.storage_path, file_hash: v.file_hash,
    }))
    refresh()
    return ok('Pièce déposée : elle sera vérifiée par l\'administration')
  })
}

export async function deleteSupplierDocument(id: string): Promise<ActionResult> {
  return guarded(async () => {
    const supabase = await db()
    const { data } = check(await supabase.from('supplier_documents').select('storage_path, statut').eq('id', id).single())
    if (data!.statut !== 'DEPOSE') throw new Error('Une pièce déjà traitée ne peut pas être supprimée.')
    check(await supabase.from('supplier_documents').delete().eq('id', id))
    await supabase.storage.from('supplier-docs').remove([data!.storage_path])
    refresh()
    return ok('Pièce supprimée')
  })
}

export async function reviewSupplierDocument(docId: string, fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const v = parse(z.object({ statut: z.enum(['VERIFIE', 'REFUSE']), motif: z.string().trim().optional() }), fd)
    await rpc('review_supplier_document', { p_doc: docId, p_statut: v.statut, p_motif: v.motif ?? null })
    refresh()
    return ok(v.statut === 'VERIFIE' ? 'Pièce vérifiée' : 'Pièce refusée, le fournisseur est notifié')
  })
}

/** Lien de téléchargement temporaire (5 min) vers une pièce ; la RLS décide si l'utilisateur peut la lire. */
export async function supplierDocumentUrl(docId: string): Promise<ActionResult<{ url: string }>> {
  return guarded(async () => {
    const supabase = await db()
    const { data } = check(await supabase.from('supplier_documents').select('storage_path').eq('id', docId).single())
    const signed = await supabase.storage.from('supplier-docs').createSignedUrl(data!.storage_path, 300)
    if (signed.error || !signed.data) throw new Error('Fichier inaccessible')
    return ok('Lien généré', { url: signed.data.signedUrl })
  }) as Promise<ActionResult<{ url: string }>>
}

export async function addAlertSubscription(fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const v = parse(z.object({
      canal: z.enum(['EMAIL', 'SMS', 'WHATSAPP']), destinataire: z.string().trim().min(5).max(120),
      corps_metier_id: z.string().uuid().optional(), nature: z.enum(['TRAVAUX', 'FOURNITURES', 'SERVICES_COURANTS', 'PRESTATIONS_INTELLECTUELLES', 'DSP', 'PPP']).optional(),
      montant_min: z.coerce.number().int().min(0).optional(),
    }), fd)
    const supabase = await db()
    check(await supabase.from('tender_alert_subscriptions').insert({
      canal: v.canal, destinataire: v.destinataire.replace(/[\s.-]/g, v.canal === 'EMAIL' ? '$&' : ''),
      corps_metier_id: v.corps_metier_id ?? null, nature: v.nature ?? null, montant_min: v.montant_min ?? null,
    }))
    refresh()
    return ok('Alerte créée : vous serez prévenu des nouveaux appels d\'offres correspondants')
  })
}

export async function removeAlertSubscription(id: string): Promise<ActionResult> {
  return guarded(async () => {
    const supabase = await db()
    check(await supabase.from('tender_alert_subscriptions').delete().eq('id', id))
    refresh()
    return ok('Alerte supprimée')
  })
}

export async function toggleAlertSubscription(id: string, actif: boolean): Promise<ActionResult> {
  return guarded(async () => {
    const supabase = await db()
    check(await supabase.from('tender_alert_subscriptions').update({ actif }).eq('id', id))
    refresh()
    return ok(actif ? 'Alerte réactivée' : 'Alerte suspendue')
  })
}
