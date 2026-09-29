import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

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
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Récupérer la session
  const { data: { user } } = await supabase.auth.getUser()
  const pathname = request.nextUrl.pathname

  // 1. Routes publiques → pas de protection
  const isPublic = PUBLIC_ROUTES.some(route =>
    pathname === route || pathname.startsWith('/avis') || pathname.startsWith('/auth')
  )

  if (isPublic) {
    return response
  }

  // 2. Routes dashboard → authentification requise
  if (pathname.startsWith('/dashboard') || pathname.startsWith('/api')) {
    if (!user) {
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
      return NextResponse.redirect(new URL('/login', request.url))
    }

    // 4. Vérification des droits par route
    const requiredRoles = Object.entries(ROLE_ROUTES).find(([route]) =>
      pathname.startsWith(route)
    )?.[1]

    if (requiredRoles && !requiredRoles.includes(profile.role)) {
      return NextResponse.redirect(new URL('/dashboard/403', request.url))
    }

    // 5. Injection contexte multi-tenant dans les headers
    // → Lu par Supabase Edge Functions pour appliquer les politiques RLS
    response.headers.set('x-user-id', user.id)
    response.headers.set('x-user-role', profile.role)
    response.headers.set('x-institution-id', profile.institution_id ?? '')
    response.headers.set('x-user-name', profile.full_name)
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
