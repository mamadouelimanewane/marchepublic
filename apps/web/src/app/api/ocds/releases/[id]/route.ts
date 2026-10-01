import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

// Release OCDS d'un marché (identifié par son UUID ou sa référence MP-…).
export const dynamic = 'force-dynamic'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  let tenderId: string | null = UUID.test(id) ? id : null
  if (!tenderId && /^MP-[A-Z0-9_]+-\d{4}-\d{4}$/i.test(id)) {
    const { data } = await supabase.from('v_public_marches').select('id').eq('reference', id.toUpperCase()).maybeSingle()
    tenderId = data?.id ?? null
  }
  if (!tenderId) return NextResponse.json({ error: 'Marché introuvable' }, { status: 404 })
  const { data: release, error } = await supabase.rpc('ocds_release', { p_tender: tenderId })
  if (error) return NextResponse.json({ error: 'Service indisponible' }, { status: 503 })
  if (!release) return NextResponse.json({ error: 'Marché introuvable' }, { status: 404 })
  const envelope = {
    uri: request.url, version: '1.1', publishedDate: new Date().toISOString(),
    publisher: { name: 'Plateforme intégrée des marchés publics du Sénégal' },
    license: 'https://creativecommons.org/licenses/by/4.0/', releases: [release],
  }
  return NextResponse.json(envelope, { headers: { 'Cache-Control': 'public, s-maxage=300', 'Access-Control-Allow-Origin': '*' } })
}
