import { redirect } from 'next/navigation'
import { cache } from 'react'
import { canAccessRoute, isRole, type Role } from '@marchepublic/workflow'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export interface SessionProfile {
  id: string
  email: string
  full_name: string
  role: Role
  institution_id: string | null
  is_pme: boolean
  is_pme_feminine: boolean
  is_ess: boolean
  ninea: string | null
  institution: { id: string; name: string; type: string; code: string } | null
}

/** Utilisateur connecté + profil (mis en cache pour la durée de la requête). */
export const getSession = cache(async (): Promise<SessionProfile | null> => {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('users')
    .select('id, email, full_name, role, institution_id, is_pme, is_pme_feminine, is_ess, ninea, institutions(id, name, type, code)')
    .eq('id', user.id)
    .single()
  if (!profile || !isRole(profile.role)) return null
  const inst = Array.isArray(profile.institutions) ? profile.institutions[0] : profile.institutions
  return {
    id: profile.id, email: profile.email, full_name: profile.full_name, role: profile.role,
    institution_id: profile.institution_id, is_pme: profile.is_pme, is_pme_feminine: profile.is_pme_feminine,
    is_ess: profile.is_ess, ninea: profile.ninea, institution: inst ?? null,
  }
})

/** À appeler en tête de chaque page protégée. */
export async function requireSession(pathname?: string): Promise<SessionProfile> {
  const session = await getSession()
  if (!session) redirect('/login' + (pathname ? `?redirect=${encodeURIComponent(pathname)}` : ''))
  if (pathname && !canAccessRoute(session.role, pathname)) redirect('/dashboard/403')
  return session
}

export async function requireRole(roles: readonly Role[]): Promise<SessionProfile> {
  const session = await requireSession()
  if (!roles.includes(session.role)) redirect('/dashboard/403')
  return session
}
