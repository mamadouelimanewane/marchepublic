import { z } from 'zod'
import { formatZodError, formDataToObject } from '@marchepublic/validators'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getSession, type SessionProfile } from '@/lib/auth'
import { fail, type ActionResult } from '@/lib/errors'

/** Client Supabase lié à la session de l'utilisateur : la RLS et les RPC s'appliquent à SES droits. */
export const db = () => createSupabaseServerClient()

/** Exécute une server action : exige une session, convertit toute exception (erreur SQL métier incluse) en message. */
export async function guarded(fn: (session: SessionProfile) => Promise<ActionResult>): Promise<ActionResult> {
  try {
    const session = await getSession()
    if (!session) return { ok: false, message: 'Session expirée, reconnectez-vous.' }
    return await fn(session)
  } catch (e) {
    return fail(e)
  }
}

/** Valide un FormData (ou objet) avec un schéma Zod ; lève une erreur au message lisible. */
export function parse<S extends z.ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  const raw = input instanceof FormData ? formDataToObject(input) : input
  const res = schema.safeParse(raw)
  if (!res.success) throw new Error(formatZodError(res.error))
  return res.data
}

export async function rpc<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
  const supabase = await db()
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw error
  return data as T
}

/** Exécute une requête Supabase déjà construite et lève son erreur éventuelle. */
export function check<T extends { error: unknown }>(res: T): T {
  if (res.error) throw res.error
  return res
}

export const toBool = (v: FormDataEntryValue | null | undefined) => v === 'on' || v === 'true' || v === '1'
