'use server'

import { revalidatePath } from 'next/cache'
import { adminUserSchema, configValueSchema } from '@marchepublic/validators'
import { z } from 'zod'
import { check, db, guarded, parse } from '@/lib/action-utils'
import { createSupabaseAdminClient } from '@/lib/supabase/server'
import { ok, type ActionResult } from '@/lib/errors'

const refresh = () => revalidatePath('/dashboard/admin')

function requireAdmin(role: string) {
  if (role !== 'ADMIN') throw new Error('Réservé à l\'administrateur de la plateforme.')
}

/** Met à jour un paramètre réglementaire (seuils, plafonds, délais) sans redéploiement. */
export async function updateConfig(fd: FormData): Promise<ActionResult> {
  return guarded(async session => {
    requireAdmin(session.role)
    const v = parse(configValueSchema, fd)
    const supabase = await db()
    check(await supabase.from('config_seuils').update({ valeur: v.valeur, modifie_par: session.id, modifie_le: new Date().toISOString() }).eq('cle', v.cle))
    refresh()
    return ok(`Paramètre ${v.cle} mis à jour`)
  })
}

export async function createInstitution(fd: FormData): Promise<ActionResult> {
  return guarded(async session => {
    requireAdmin(session.role)
    const v = parse(z.object({
      code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,20}$/, 'Code : 2 à 20 caractères A-Z, 0-9, _'),
      name: z.string().trim().min(3).max(200),
      type: z.enum(['ETAT', 'COLLECTIVITE', 'ETABLISSEMENT_PUBLIC', 'SOCIETE_PUBLIQUE', 'AGENCE']),
    }), fd)
    const supabase = await db()
    check(await supabase.from('institutions').insert(v))
    refresh()
    return ok('Institution créée')
  })
}

/**
 * Création d'un compte institutionnel : invitation par e-mail (aucun mot de passe transmis), puis affectation du rôle
 * et de l'institution avec le client service_role. Seul un ADMIN authentifié atteint ce code.
 */
export async function createStaffUser(fd: FormData): Promise<ActionResult> {
  return guarded(async session => {
    requireAdmin(session.role)
    const v = parse(adminUserSchema, fd)
    const admin = createSupabaseAdminClient()
    const { data, error } = await admin.auth.admin.inviteUserByEmail(v.email, { data: { full_name: v.full_name } })
    if (error) throw error
    const { error: upd } = await admin.from('users').update({
      role: v.role, institution_id: v.institution_id ?? null, full_name: v.full_name,
    }).eq('id', data.user.id)
    if (upd) throw upd
    refresh()
    return ok(`Invitation envoyée à ${v.email}`)
  })
}

export async function setUserActive(userId: string, active: boolean): Promise<ActionResult> {
  return guarded(async session => {
    requireAdmin(session.role)
    if (userId === session.id) throw new Error('Vous ne pouvez pas désactiver votre propre compte.')
    const supabase = await db()
    check(await supabase.from('users').update({ is_active: active }).eq('id', userId))
    refresh()
    return ok(active ? 'Compte réactivé' : 'Compte désactivé')
  })
}

/** Certification PME / ESS d'un soumissionnaire (alimentera les quotas légaux 5 % / 2 %). */
export async function setSupplierStatus(userId: string, fd: FormData): Promise<ActionResult> {
  return guarded(async session => {
    requireAdmin(session.role)
    const supabase = await db()
    check(await supabase.from('users').update({
      is_pme: fd.get('is_pme') === 'on', is_pme_feminine: fd.get('is_pme_feminine') === 'on', is_ess: fd.get('is_ess') === 'on',
      ninea_verified_at: fd.get('ninea_verified') === 'on' ? new Date().toISOString() : null,
    }).eq('id', userId))
    refresh()
    return ok('Statut du fournisseur mis à jour')
  })
}

export async function toggleCorpsMetier(id: string, active: boolean): Promise<ActionResult> {
  return guarded(async session => {
    requireAdmin(session.role)
    const supabase = await db()
    check(await supabase.from('corps_metiers').update({ is_active: active }).eq('id', id))
    refresh()
    return ok('Nomenclature mise à jour')
  })
}

export async function markNotificationsRead(): Promise<ActionResult> {
  return guarded(async () => {
    const supabase = await db()
    check(await supabase.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null))
    revalidatePath('/dashboard', 'layout')
    return ok('Notifications marquées comme lues')
  })
}

const MODES = ['AOO', 'AOR', 'AOO_2ETAPES', 'CONCOURS', 'DRP', 'ENTENTE_DIRECTE', 'ACCORD_CADRE'] as const

/** Type de séance d'ouverture par mode de passation : publique (lecture des offres aux candidats) ou restreinte. N'affecte pas les ouvertures déjà enregistrées. */
export async function setRegleOuverture(mode: string, publique: boolean): Promise<ActionResult> {
  return guarded(async session => {
    requireAdmin(session.role)
    const m = parse(z.enum(MODES), mode)
    const supabase = await db()
    check(await supabase.from('regles_ouverture').update({ publique }).eq('mode', m))
    refresh()
    return ok(`Mode ${m} : séance ${publique ? 'publique' : 'restreinte'} pour les prochaines ouvertures`)
  })
}
