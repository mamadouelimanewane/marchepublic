import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

// Export du PPM en CSV (ouvrable dans Excel). L'accès suit la RLS : chacun n'exporte que ses marchés.
const esc = (v: unknown) => {
  let s = v === null || v === undefined ? '' : String(v)
  // Neutralise l'injection de formules (=, +, -, @) à l'ouverture dans un tableur.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const annee = Number(request.nextUrl.searchParams.get('annee')) || new Date().getFullYear()
  const { data, error } = await supabase.from('tenders')
    .select('reference, title, nature_marche, mode_passation, montant_estime, ligne_budgetaire, ppm_annee, ppm_trimestre, current_phase, date_prevue_lancement, date_prevue_attribution')
    .eq('ppm_annee', annee).order('ppm_trimestre')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const header = ['Référence', 'Objet', 'Nature', 'Mode', 'Montant estimé (FCFA)', 'Ligne budgétaire', 'Année', 'Trimestre', 'Phase', 'Lancement prévu', 'Attribution prévue']
  const rows = (data ?? []).map(t => [t.reference, t.title, t.nature_marche, t.mode_passation, t.montant_estime, t.ligne_budgetaire, t.ppm_annee, t.ppm_trimestre, t.current_phase, t.date_prevue_lancement, t.date_prevue_attribution])
  const csv = '﻿' + [header, ...rows].map(r => r.map(esc).join(';')).join('\r\n')
  return new NextResponse(csv, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="PPM-${annee}.csv"` },
  })
}
