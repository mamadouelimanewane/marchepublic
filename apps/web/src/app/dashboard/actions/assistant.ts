'use server'

import { z } from 'zod'
import { sectionsSchema } from '@marchepublic/validators'
import type { DocSection } from '@marchepublic/workflow'
import { check, db, guarded, parse, rpc } from '@/lib/action-utils'
import { AiError, aiEnabled, aiModel, askClaude } from '@/lib/ai'
import { LIMITS, SYSTEM_PROMPT, draftPrompt, reviewPrompt } from '@/lib/ai-prompts'
import { ok, type ActionResult } from '@/lib/errors'
import { tenderVariables } from '@/lib/redaction'

/** Contexte du document, lu sous les droits de l'utilisateur (la RLS décide de ce qu'il peut voir). */
async function context(documentId: string) {
  const supabase = await db()
  const { data: d } = check(await supabase.from('tender_documents').select('id, type, tender_id, tenders(nature_marche)').eq('id', documentId).single())
  const tender = d!.tenders as unknown as { nature_marche: string } | null
  return { type: d!.type as 'TDR' | 'DAO', tenderId: d!.tender_id as string, nature: tender?.nature_marche ?? 'FOURNITURES', variables: await tenderVariables(supabase, d!.tender_id as string) }
}

/** Réserve le quota (droits, phase, verrouillage vérifiés en base), appelle le modèle, clôture la requête. */
async function withAi(documentId: string, kind: 'REDIGER_SECTION' | 'RELIRE_DOCUMENT', user: string, maxTokens: number): Promise<string> {
  if (!aiEnabled()) throw new Error('L\'assistant IA n\'est pas activé sur cette plateforme.')
  const id = await rpc<string>('claim_ai_request', { p_document: documentId, p_kind: kind, p_model: aiModel(), p_input_chars: user.length })
  try {
    const text = await askClaude({ system: SYSTEM_PROMPT, user, maxTokens })
    await rpc('finish_ai_request', { p_id: id, p_ok: true, p_output_chars: text.length })
    return text
  } catch (e) {
    await rpc('finish_ai_request', { p_id: id, p_ok: false, p_output_chars: null }).catch(() => undefined)
    throw e instanceof AiError ? new Error(e.message) : e
  }
}

export async function aiStatus(): Promise<{ enabled: boolean; remaining: number | null }> {
  if (!aiEnabled()) return { enabled: false, remaining: null }
  try { return { enabled: true, remaining: await rpc<number>('ai_quota_remaining', {}) } } catch { return { enabled: true, remaining: null } }
}

/** Propose un texte pour UNE section. Rien n'est enregistré : l'agent relit, ajuste puis enregistre lui-même. */
export async function draftSection(documentId: string, input: { sectionId: string; titre: string; consigne?: string; contenuActuel?: string; notes?: string }): Promise<ActionResult<{ texte: string }>> {
  return guarded(async () => {
    const v = parse(z.object({
      sectionId: z.string().min(1).max(80), titre: z.string().min(1).max(200),
      consigne: z.string().max(5_000).optional(), contenuActuel: z.string().max(100_000).optional(), notes: z.string().max(LIMITS.notes).optional(),
    }), input)
    const c = await context(documentId)
    const texte = await withAi(documentId, 'REDIGER_SECTION', draftPrompt({
      type: c.type, nature: c.nature, variables: c.variables, section: { id: v.sectionId, titre: v.titre }, consigne: v.consigne, contenuActuel: v.contenuActuel, notes: v.notes,
    }), 1_500)
    return ok('Proposition générée : relisez-la avant de l\'utiliser', { texte })
  }) as Promise<ActionResult<{ texte: string }>>
}

/** Relecture critique du document tel qu'il est à l'écran (même non enregistré). */
export async function reviewDocument(documentId: string, sections: DocSection[]): Promise<ActionResult<{ avis: string }>> {
  return guarded(async () => {
    const valid = parse(sectionsSchema, sections as unknown as Record<string, unknown>)
    const c = await context(documentId)
    const avis = await withAi(documentId, 'RELIRE_DOCUMENT', reviewPrompt({ type: c.type, nature: c.nature, variables: c.variables, sections: valid as DocSection[] }), 1_800)
    return ok('Relecture terminée', { avis })
  }) as Promise<ActionResult<{ avis: string }>>
}
