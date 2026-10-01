import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

// Export du journal d'audit pour les contrôles DCMP / ARCOP / Cour des Comptes (la RLS limite déjà le périmètre).
const esc = (v: unknown) => {
  let s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  const { data, error } = await supabase.from('audit_logs')
    .select('seq, occurred_at, action, entity_type, entity_id, user_name, user_role, institution_id, prev_hash, row_hash, old_value, new_value')
    .order('seq').limit(50000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const cols = ['seq', 'occurred_at', 'action', 'entity_type', 'entity_id', 'user_name', 'user_role', 'institution_id', 'prev_hash', 'row_hash', 'old_value', 'new_value']
  const csv = '﻿' + [cols, ...(data ?? []).map(r => cols.map(c => (r as Record<string, unknown>)[c]))].map(r => r.map(esc).join(';')).join('\r\n')
  return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="journal-audit.csv"' } })
}
