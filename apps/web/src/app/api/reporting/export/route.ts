import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

// Export CSV de vues de reporting (liste blanche ; l'accès suit la RLS de l'utilisateur).
const VUES = new Set(['v_stats_sectorielles', 'v_quotas_pme', 'v_delais_moyens_phase', 'v_stats_recours', 'v_paiements', 'v_alertes'])

const esc = (v: unknown) => {
  let s = v === null || v === undefined ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`   // neutralise l'injection de formules dans les tableurs
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function GET(request: NextRequest) {
  const vue = request.nextUrl.searchParams.get('vue') ?? ''
  if (!VUES.has(vue)) return NextResponse.json({ error: 'Vue inconnue' }, { status: 400 })
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  const { data, error } = await supabase.from(vue).select('*').limit(10000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const rows = (data ?? []) as Record<string, unknown>[]
  const cols = rows.length ? Object.keys(rows[0]) : []
  const csv = '﻿' + [cols, ...rows.map(r => cols.map(c => r[c]))].map(r => r.map(esc).join(';')).join('\r\n')
  return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${vue}.csv"` } })
}
