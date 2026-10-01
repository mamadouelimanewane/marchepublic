import type { SupabaseClient } from '@supabase/supabase-js'
import type { VariableValues } from '@marchepublic/workflow'
import { fcfa } from '@/lib/format'

/** Valeurs des variables de fusion d'un marché ({{reference}}, {{autorite}}…), lues sous les droits de l'utilisateur. */
export async function tenderVariables(supabase: SupabaseClient, tenderId: string): Promise<VariableValues> {
  const [{ data: t }, { data: b }] = await Promise.all([
    supabase.from('tenders').select('reference, title, nature_marche, mode_passation, montant_estime, ligne_budgetaire, ppm_annee, institutions(name)').eq('id', tenderId).maybeSingle(),
    supabase.from('besoins').select('description, justification').eq('tender_id', tenderId).maybeSingle(),
  ])
  if (!t) return {}
  const inst = t.institutions as unknown as { name: string } | null
  return {
    reference: t.reference ?? undefined,
    intitule: t.title ?? undefined,
    autorite: inst?.name,
    nature: t.nature_marche?.replaceAll('_', ' ').toLowerCase(),
    mode: t.mode_passation ?? undefined,
    montant_estime: t.montant_estime ? fcfa(t.montant_estime).replace(/\s*FCFA$/i, '') : undefined,
    ligne_budgetaire: t.ligne_budgetaire ?? undefined,
    annee: t.ppm_annee ? String(t.ppm_annee) : undefined,
    besoin: b?.description ?? undefined,
    justification: b?.justification ?? undefined,
  }
}
