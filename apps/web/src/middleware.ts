import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import type { SetAllCookies } from '@supabase/ssr'
// Import direct (et non depuis l'index) : le middleware s'exécute sur l'Edge, on évite d'y embarquer XState.
import { canAccessRoute, isRole } from '@marchepublic/workflow/src/roles'

// ==========================================
// MIDDLEWARE — authentification + contrôle d'accès par rôle
// Première ligne de défense ergonomique : les droits réels sont imposés par la RLS et les RPC de la base.
// Aucun en-tête « x-user-* » n'est transmis aux pages : elles relisent la session et le profil depuis la base.
// ==========================================

const PUBLIC_EXACT = new Set(['/', '/avis', '/login', '/register'])
// Portail de transparence, signalements citoyens et données ouvertes : publics par conception.
const PUBLIC_PREFIXES = ['/avis/', '/auth/', '/transparence', '/signalement', '/api/ocds/', '/api/audit/anchors', '/api/cron/']
const SPOOFABLE_HEADERS = ['x-user-id', 'x-user-role', 'x-institution-id', 'x-user-name']

function isPublic(pathname: string) {
  return PUBLIC_EXACT.has(pathname) || PUBLIC_PREFIXES.some(p => pathname.startsWith(p))
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const requestHeaders = new Headers(request.headers)
  for (const h of SPOOFABLE_HEADERS) requestHeaders.delete(h)

  if (isPublic(pathname) || !(pathname.startsWith('/dashboard') || pathname.startsWith('/api/'))) {
    return NextResponse.next({ request: { headers: requestHeaders } })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  const isApi = pathname.startsWith('/api/')
  if (!url || !anon) {
    return isApi
      ? NextResponse.json({ error: 'Authentification indisponible' }, { status: 503 })
      : new NextResponse('Authentification momentanément indisponible', { status: 503 })
  }

  let response = NextResponse.next({ request: { headers: requestHeaders } })
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: ((cookies: Parameters<SetAllCookies>[0]) => {
        cookies.forEach(({ name, value }) => request.cookies.set(name, value))
        requestHeaders.set('cookie', request.cookies.toString())
        response = NextResponse.next({ request: { headers: requestHeaders } })
        cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      }) as SetAllCookies,
    },
  })

  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      if (isApi) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
      const login = new URL('/login', request.url)
      login.searchParams.set('redirect', pathname)
      return NextResponse.redirect(login)
    }

    const { data: profile } = await supabase.from('users').select('role, is_active').eq('id', user.id).single()
    if (!profile || !profile.is_active || !isRole(profile.role)) {
      return isApi
        ? NextResponse.json({ error: 'Profil introuvable ou désactivé' }, { status: 403 })
        : NextResponse.redirect(new URL('/login?error=profil', request.url))
    }
    if (pathname.startsWith('/dashboard') && pathname !== '/dashboard/403' && !canAccessRoute(profile.role, pathname)) {
      return NextResponse.redirect(new URL('/dashboard/403', request.url))
    }
  } catch (error) {
    console.error('Erreur de vérification de session Supabase dans le middleware:', error)
    return isApi
      ? NextResponse.json({ error: 'Service d\'authentification indisponible' }, { status: 503 })
      : new NextResponse('Service d\'authentification momentanément indisponible', { status: 503 })
  }
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
