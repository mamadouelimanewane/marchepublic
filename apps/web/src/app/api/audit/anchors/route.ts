import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

// Empreintes de tête du journal d'audit, publiées chaque jour. N'importe qui peut les archiver ailleurs :
// une réécriture ultérieure du journal devient alors détectable sans faire confiance à la plateforme.
export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.from('v_audit_anchors').select('institution, head_seq, head_hash, nb_entries, anchored_at').order('anchored_at', { ascending: false }).limit(5000)
  if (error) return NextResponse.json({ error: 'Service indisponible' }, { status: 503 })
  return NextResponse.json({ algorithme: 'SHA-256 chaîné par institution', ancres: data }, { headers: { 'Cache-Control': 'public, s-maxage=600', 'Access-Control-Allow-Origin': '*' } })
}
