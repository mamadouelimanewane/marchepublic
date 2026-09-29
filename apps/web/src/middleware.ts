import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import type { SetAllCookies } from '@supabase/ssr'

// ==========================================
// MIDDLEWARE RBAC — Plateforme Marchés Publics
// Protection routes + injection contexte tenant
// ==========================================

// Routes publiques (portail soumissionnaires, avis AO)
const PUBLIC_ROUTES = [
  '/',
  '/avis',
  '/avis/:id',
  '/login',
  '/register',
  '/auth/callback',
]

// Routes protégées par rôle
const ROLE_ROUTES: Record<string, string[]> = {
  '/dashboard/admin': ['ADMIN'],
  '/dashboard/dcmp': ['DCMP', 'ADMIN'],
  '/dashboard/arcop': ['ARCOP', 'ADMIN'],
  '/dashboard/evaluation': ['EVALUATEUR', 'CPM', 'PRM', 'ADMIN'],
  '/dashboard/recours': ['ARCOP', 'ADMIN'],
  '/dashboard/reporting': ['PRM', 'CPM', 'DCMP', 'ARCOP', 'ADMIN'],
}

export async function middleware(request: NextRequest) {
  const requestHeaders = new Headers(request.headers)
  const pathname = request.nextUrl.pathname
  const isPublic = PUBLIC_ROUTES.some(route =>
    pathname === route || pathname.startsWith('/avis/') || pathname.startsWith('/auth/')
  )

  // Public pages and assets must remain available even if Supabase is not
  // configured or temporarily unreachable in the deployment environment.
  if (isPublic) {
    return NextResponse.next({ request: { headers: requestHeaders } })
  }

  // Only protected application endpoints need a Supabase session check.
  const isProtected = pathname.startsWith('/dashboard') || pathname.startsWith('/api/')
  if (!isProtected) {
    return NextResponse.next({ request: { headers: requestHeaders } })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) {
    return pathname.startsWith('/api/')
      ? NextResponse.json({ error: 'Authentification indisponible' }, { status: 503 })
      : new NextResponse('Authentification momentanément indisponible', { status: 503 })
  }

  let response = NextResponse.next({ request: { headers: requestHeaders } })

  const supabase: any = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll: ((cookiesToSet: Parameters<SetAllCookies>[0]) => {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          requestHeaders.set('cookie', request.cookies.toString())
          response = NextResponse.next({ request: { headers: requestHeaders } })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        }) as SetAllCookies,
      },
    }
  )

  try {
    // Récupérer la session
    const { data: { user } } = await supabase.auth.getUser()

    // Routes dashboard → authentification requise
    if (!user) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
      }
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('redirect', pathname)
      return NextResponse.redirect(loginUrl)
    }

    // 3. Récupérer profil utilisateur (rôle + institution)
    const { data: profile } = await supabase
      .from('users')
      .select('role, institution_id, full_name')
      .eq('id', user.id)
      .single()

    if (!profile) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Profil utilisateur introuvable' }, { status: 403 })
      }
      return NextResponse.redirect(new URL('/login', request.url))
    }

    // 4. Vérification des droits par route
    const requiredRoles = Object.entries(ROLE_ROUTES).find(([route]) =>
      pathname.startsWith(route)
    )?.[1]

    if (requiredRoles && !requiredRoles.includes(profile.role)) {
      return NextResponse.redirect(new URL('/dashboard/403', request.url))
    }

    // Transmettre des valeurs calculées côté serveur aux Route Handlers.
    // Les politiques SQL se basent sur auth.uid() et le profil en base, jamais sur ces headers.
    requestHeaders.set('x-user-id', user.id)
    requestHeaders.set('x-user-role', profile.role)
    requestHeaders.set('x-institution-id', profile.institution_id ?? '')
    requestHeaders.set('x-user-name', profile.full_name)
    const securedResponse = NextResponse.next({ request: { headers: requestHeaders } })
    response.cookies.getAll().forEach(cookie => securedResponse.cookies.set(cookie))
    response = securedResponse
  } catch (error) {
    console.error('Erreur de vérification de session Supabase dans le middleware:', error)
    return pathname.startsWith('/api/')
      ? NextResponse.json({ error: 'Service d’authentification indisponible' }, { status: 503 })
      : new NextResponse('Service d’authentification momentanément indisponible', { status: 503 })
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
