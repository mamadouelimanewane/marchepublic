'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { check, db, guarded, parse, rpc } from '@/lib/action-utils'
import { ok, type ActionResult } from '@/lib/errors'

const refresh = () => revalidatePath('/dashboard/catalogue', 'layout')
const UNITES = ['UNITE', 'KG', 'TONNE', 'LITRE', 'M2', 'M3', 'ML', 'HEURE', 'JOUR', 'FORFAIT', 'LOT'] as const

export async function createFrameworkAgreement(tenderId: string, fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const v = parse(z.object({
      titre: z.string().trim().min(5).max(200),
      date_debut: z.string().min(10), date_fin: z.string().min(10),
      plafond_montant: z.coerce.number().int().positive(),
    }), fd)
    const id = await rpc<string>('create_framework_agreement', {
      p_tender: tenderId, p_titre: v.titre, p_debut: v.date_debut, p_fin: v.date_fin, p_plafond: v.plafond_montant, p_beneficiaires: null,
    })
    refresh()
    return ok('Accord-cadre créé : le titulaire peut alimenter le catalogue', { id })
  })
}

/** Les attributs sont saisis dans des champs `attr_<clé>` ; seuls ceux de la catégorie choisie sont retenus, le serveur SQL tranche. */
export async function addCatalogItem(agreementId: string, fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const v = parse(z.object({
      corps_metier_id: z.string().uuid('Catégorie requise'),
      code_article: z.string().trim().regex(/^[A-Za-z0-9._-]{2,40}$/, 'Code : 2 à 40 caractères (lettres, chiffres, . _ -)'),
      designation: z.string().trim().min(5).max(200),
      unite: z.enum(UNITES),
      prix_unitaire: z.coerce.number().int().positive(),
      delai_livraison_jours: z.coerce.number().int().min(0).max(365),
    }), fd)
    const supabase = await db()
    const defs = check(await supabase.from('catalog_attribute_defs').select('cle, type, corps_metier_id')).data ?? []
    const attributs: Record<string, string | number | boolean> = {}
    for (const d of defs.filter(d => d.corps_metier_id === null || d.corps_metier_id === v.corps_metier_id)) {
      const raw = String(fd.get(`attr_${d.cle}`) ?? '').trim()
      if (raw === '') continue
      attributs[d.cle] = d.type === 'NOMBRE' ? Number(raw) : d.type === 'BOOLEEN' ? raw === 'true' : raw
    }
    check(await supabase.from('catalog_items').insert({ agreement_id: agreementId, ...v, attributs }))
    refresh()
    return ok('Article ajouté au catalogue')
  })
}

export async function revisePrice(itemId: string, fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const v = parse(z.object({ prix_unitaire: z.coerce.number().int().positive() }), fd)
    const supabase = await db()
    check(await supabase.from('catalog_items').update({ prix_unitaire: v.prix_unitaire }).eq('id', itemId))
    refresh()
    return ok('Prix révisé et historisé')
  })
}

export async function setItemActive(itemId: string, actif: boolean): Promise<ActionResult> {
  return guarded(async () => {
    const supabase = await db()
    check(await supabase.from('catalog_items').update({ actif }).eq('id', itemId))
    refresh()
    return ok(actif ? 'Article remis au catalogue' : 'Article retiré du catalogue')
  })
}

export async function placeCallOff(itemId: string, fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const v = parse(z.object({ quantite: z.coerce.number().positive().max(1_000_000) }), fd)
    await rpc('place_call_off', { p_item: itemId, p_quantite: v.quantite })
    refresh()
    return ok('Commande passée au prix du catalogue')
  })
}

export async function progressCallOff(orderId: string, action: 'LIVRER' | 'RECEPTIONNER' | 'ANNULER', fd?: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const motif = fd ? String(fd.get('motif') ?? '').trim() : ''
    await rpc('progress_call_off', { p_order: orderId, p_action: action, p_motif: motif || null })
    refresh()
    return ok({ LIVRER: 'Livraison déclarée', RECEPTIONNER: 'Réception enregistrée', ANNULER: 'Commande annulée, solde restitué' }[action])
  })
}
