import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { createSupabaseAdminClient } from '@/lib/supabase/server'

// Tâche planifiée (Vercel Cron) : ancre les empreintes de tête du journal d'audit. Protégée par CRON_SECRET.
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET non configuré' }, { status: 503 })
  const provided = Buffer.from(request.headers.get('authorization') ?? '')
  const expected = Buffer.from(`Bearer ${secret}`)
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { data, error } = await createSupabaseAdminClient().rpc('anchor_audit_chain')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ancres_creees: data })
}
