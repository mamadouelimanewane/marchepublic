import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

// Données ouvertes : paquet de releases OCDS 1.1 (Open Contracting Data Standard), public et paginé.
//   GET /api/ocds/releases?limit=100&after=<date ISO d'une release>
// La publicité est graduée par la base (rien sur les candidats avant l'attribution provisoire, contrat après signature).
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 500)
  const after = url.searchParams.get('after')
  if (after && Number.isNaN(Date.parse(after))) return NextResponse.json({ error: 'Paramètre « after » invalide (date ISO attendue)' }, { status: 400 })

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('ocds_release_package', { p_uri: url.toString(), p_limit: limit, p_after: after })
  if (error) return NextResponse.json({ error: 'Service indisponible' }, { status: 503 })

  const releases = (data?.releases ?? []) as { date: string }[]
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
    'Access-Control-Allow-Origin': '*',
  }
  if (releases.length === limit) {
    const next = new URL(url); next.searchParams.set('after', releases[releases.length - 1].date)
    headers['Link'] = `<${next.toString()}>; rel="next"`
    headers['X-Next-After'] = releases[releases.length - 1].date
  }
  return new NextResponse(JSON.stringify(data), { headers })
}
