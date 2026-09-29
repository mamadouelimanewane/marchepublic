import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import type { SetAllCookies } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Client Supabase côté serveur (Server Components, Route Handlers)
export async function createSupabaseServerClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll: ((cookiesToSet: Parameters<SetAllCookies>[0]) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch {
            // Server Components cannot write refreshed cookies; middleware handles refreshes.
          }
        }) as SetAllCookies,
      },
    }
  )
}

// Client service_role : serveur uniquement, jamais importé dans le navigateur.
export function createSupabaseAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
