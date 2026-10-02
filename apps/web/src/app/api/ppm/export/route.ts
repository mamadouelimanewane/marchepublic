import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { renderPdf } from '@/lib/pdf'
import { ppmModel } from '@/lib/pdf-models'
import { buildXlsx } from '@/lib/xlsx'

// Export du PPM en CSV, Excel (.xlsx) ou PDF : ?annee=2026&format=csv|xlsx|pdf. L'accès suit la RLS : chacun n'exporte que ses marchés.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const esc = (v: unknown) => {
  let s = v === null || v === undefined ? '' : String(v)
  // Neutralise l'injection de formules (=, +, -, @) à l'ouverture dans un tableur.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const HEADER = ['Référence', 'Objet', 'Autorité', 'Nature', 'Mode', 'Montant estimé (FCFA)', 'Ligne budgétaire', 'Année', 'Trimestre', 'Phase', 'Lancement prévu', 'Attribution prévue']

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const annee = Number(request.nextUrl.searchParams.get('annee')) || new Date().getFullYear()
  if (annee < 2000 || annee > 2100) return NextResponse.json({ error: 'Année invalide' }, { status: 400 })
  const format = request.nextUrl.searchParams.get('format') ?? 'csv'
  if (!['csv', 'xlsx', 'pdf'].includes(format)) return NextResponse.json({ error: 'Format inconnu (csv, xlsx ou pdf)' }, { status: 400 })

  const { data, error } = await supabase.from('tenders')
    .select('reference, title, nature_marche, mode_passation, montant_estime, ligne_budgetaire, ppm_annee, ppm_trimestre, current_phase, date_prevue_lancement, date_prevue_attribution, institutions(name)')
    .eq('ppm_annee', annee).order('ppm_trimestre').order('reference')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const tenders = (data ?? []).map(t => ({ ...t, institution: (t.institutions as unknown as { name: string } | null)?.name ?? '' }))
  const rows = tenders.map(t => [t.reference, t.title, t.institution, t.nature_marche, t.mode_passation, t.montant_estime === null ? null : Number(t.montant_estime), t.ligne_budgetaire, t.ppm_annee, t.ppm_trimestre, t.current_phase, t.date_prevue_lancement, t.date_prevue_attribution])
  const file = (ext: string) => `attachment; filename="PPM-${annee}.${ext}"`
  const noStore = { 'Cache-Control': 'private, no-store' }

  if (format === 'xlsx') {
    const bytes = buildXlsx({ sheet: `PPM ${annee}`, header: HEADER, rows, widths: [20, 50, 34, 22, 14, 20, 16, 8, 10, 30, 16, 16], moneyColumns: [5] })
    return new NextResponse(Buffer.from(bytes), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': file('xlsx'), ...noStore } })
  }
  if (format === 'pdf') {
    const names = new Set(tenders.map(t => t.institution).filter(Boolean))
    const bytes = await renderPdf(ppmModel(annee, names.size === 1 ? [...names][0] : null, tenders))
    return new NextResponse(Buffer.from(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': file('pdf'), ...noStore } })
  }
  const csv = '﻿' + [HEADER, ...rows].map(r => r.map(esc).join(';')).join('\r\n')
  return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': file('csv'), ...noStore } })
}
