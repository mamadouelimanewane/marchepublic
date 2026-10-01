import { NextRequest, NextResponse } from 'next/server'
import { tenderSchema, formatZodError } from '@marchepublic/validators'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'

// API d'inscription d'un marché au PPM (intégrations externes). L'interface web utilise les server actions.
// Le rôle et l'institution sont relus en base (jamais depuis des en-têtes) ; la RLS et les triggers font le reste :
// référence séquentielle, calcul du mode de passation, phase initiale imposée.
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  if (!session.institution_id || !['PRM', 'CPM'].includes(session.role)) {
    return NextResponse.json({ error: 'Droits insuffisants' }, { status: 403 })
  }

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }
  const parsed = tenderSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 422 })
  const t = parsed.data

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.from('tenders').insert({
    institution_id: session.institution_id, title: t.title, description: t.description, nature_marche: t.nature_marche,
    montant_estime: t.montant_estime, corps_metier_id: t.corps_metier_id, ligne_budgetaire: t.ligne_budgetaire,
    ppm_annee: t.ppm_annee, ppm_trimestre: t.ppm_trimestre, is_reserve_pme: t.is_reserve_pme,
    is_reserve_pme_feminine: t.is_reserve_pme_feminine, is_cofinance: t.is_cofinance,
    mode_passation: t.mode_passation, justification_mode: t.justification_mode,
  }).select('id, reference, mode_passation, current_phase').single()

  if (error) {
    const message = error.message.replace(/^[A-Z_0-9]+: /, '')
    return NextResponse.json({ error: message }, { status: /row-level security|permission/i.test(error.message) ? 403 : 422 })
  }
  return NextResponse.json({ data }, { status: 201 })
}
