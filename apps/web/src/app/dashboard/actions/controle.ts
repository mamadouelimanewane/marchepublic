'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { check, db, guarded, parse, rpc } from '@/lib/action-utils'
import { ok, type ActionResult } from '@/lib/errors'

const refresh = () => revalidatePath('/dashboard', 'layout')

const FLAGS = ['OFFRE_UNIQUE', 'DELAI_COURT', 'ATTRIBUTION_HORS_CLASSEMENT', 'PRIX_SUPERIEUR_ESTIMATION', 'ENTENTE_DIRECTE',
  'AVENANTS_PROCHES_PLAFOND', 'GAGNANT_RECURRENT', 'NOUVEAU_FOURNISSEUR', 'RECOURS_FAVORABLE'] as const

/** Qualification d'une alerte (régulateurs) ou explication de l'autorité contractante (PRM) — la base arbitre les droits. */
export async function reviewRedFlag(fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const v = parse(z.object({
      tender_id: z.string().uuid(), flag: z.enum(FLAGS), statut: z.enum(['A_EXAMINER', 'EXPLICATION', 'JUSTIFIE', 'CONFIRME']),
      note: z.string().trim().min(10, 'Note : 10 caractères minimum'),
    }), fd)
    await rpc('review_red_flag', { p_tender: v.tender_id, p_flag: v.flag, p_statut: v.statut, p_note: v.note })
    refresh()
    return ok('Examen enregistré (conservé de façon immuable)')
  })
}

export async function handleCitizenReport(reportId: string, fd: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const v = parse(z.object({ statut: z.enum(['EN_EXAMEN', 'TRANSMIS', 'CLOS_SANS_SUITE']), note: z.string().trim().optional() }), fd)
    await rpc('handle_citizen_report', { p_report: reportId, p_statut: v.statut, p_note: v.note ?? null })
    refresh()
    return ok('Signalement mis à jour')
  })
}

/** Vérifie la chaîne d'audit ET sa compatibilité avec les empreintes déjà publiées. */
export async function verifyAuditIntegrity(institutionId: string | null): Promise<ActionResult<{ anomalies: number }>> {
  return guarded(async () => {
    const supabase = await db()
    const chain = check(await supabase.rpc('verify_audit_chain', { p_institution: institutionId }))
    const anchors = check(await supabase.rpc('verify_audit_anchors'))
    const nChain = (chain.data as unknown[]).length
    const nAnchors = (anchors.data as unknown[]).length
    const anomalies = nChain + nAnchors
    return anomalies === 0
      ? { ok: true, message: "Chaîne intègre et conforme aux empreintes publiées : aucune altération détectée.", data: { anomalies } }
      : { ok: false, message: `⚠ ${nChain} rupture(s) de chaîne et ${nAnchors} écart(s) avec les empreintes publiées.`, data: { anomalies } }
  }) as Promise<ActionResult<{ anomalies: number }>>
}
