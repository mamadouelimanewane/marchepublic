'use server'

import { z } from 'zod'
import { formatZodError } from '@marchepublic/validators'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { toMessage } from '@/lib/errors'

// Signalement citoyen : ouvert à tous, sans compte. La base limite le débit et ne restitue que le code de suivi.
const schema = z.object({
  reference: z.string().trim().max(40).optional(),
  categorie: z.enum(['CORRUPTION', 'FAVORITISME', 'CONFLIT_INTERETS', 'EXECUTION_NON_CONFORME', 'ACCES_ENTRAVE', 'AUTRE']),
  description: z.string().trim().min(30, 'Décrivez les faits en 30 caractères minimum').max(4000),
  contact: z.string().trim().max(200).optional(),
  // Champ piège invisible : un robot le remplit, une personne non.
  site_web: z.string().max(0).optional(),
})

export interface ReportResult { ok: boolean; message: string; code?: string }

export async function submitCitizenReport(fd: FormData): Promise<ReportResult> {
  const raw = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, typeof v === 'string' && v.trim() === '' ? undefined : v]))
  const parsed = schema.safeParse(raw)
  if (!parsed.success) return { ok: false, message: formatZodError(parsed.error) }
  const v = parsed.data
  try {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.rpc('submit_citizen_report', {
      p_tender: null, p_reference: v.reference ?? null, p_categorie: v.categorie, p_description: v.description, p_contact: v.contact ?? null,
    })
    if (error) throw error
    return { ok: true, code: data.code_suivi, message: data.marche_identifie ? 'Signalement enregistré et rattaché au marché.' : 'Signalement enregistré.' }
  } catch (e) {
    return { ok: false, message: toMessage(e) }
  }
}

export async function checkReportStatus(fd: FormData): Promise<{ ok: boolean; message: string }> {
  const code = String(fd.get('code') ?? '').trim()
  if (!/^[0-9A-Fa-f]{10}$/.test(code)) return { ok: false, message: 'Code de suivi invalide (10 caractères).' }
  try {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.rpc('citizen_report_status', { p_code: code })
    if (error) throw error
    if (!data) return { ok: false, message: 'Aucun signalement avec ce code.' }
    const labels: Record<string, string> = { RECU: 'Reçu', EN_EXAMEN: 'En cours d\'examen', TRANSMIS: 'Transmis aux autorités compétentes', CLOS_SANS_SUITE: 'Clos sans suite' }
    return { ok: true, message: `${labels[data.statut] ?? data.statut} — reçu le ${new Date(data.recu_le).toLocaleDateString('fr-FR')}, dernière mise à jour le ${new Date(data.mis_a_jour_le).toLocaleDateString('fr-FR')}.` }
  } catch (e) {
    return { ok: false, message: toMessage(e) }
  }
}
