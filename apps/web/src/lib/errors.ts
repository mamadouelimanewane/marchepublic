// Traduit les erreurs PostgreSQL / Supabase (codes métier levés par les triggers et RPC) en messages lisibles.
export interface ActionResult<T = unknown> {
  ok: boolean
  message: string
  data?: T
}

const KNOWN: Record<string, string> = {
  HARD_LOCK_APPEAL: '🔒 Un recours est pendant devant l\'ARCOP : cette étape est bloquée.',
  AVENANT_LIMIT_EXCEEDED: 'Plafond légal des avenants (30 %) dépassé.',
  SUBCONTRACTOR_LIMIT_EXCEEDED: 'Plafond légal de sous-traitance (40 %) dépassé.',
  USE_ADVANCE_PHASE: 'Le changement de phase doit passer par l\'action dédiée.',
  INVALID_TRANSITION: 'Cette transition n\'est pas permise à ce stade de la procédure.',
  AUDIT_IMMUTABLE: 'Le journal d\'audit ne peut pas être modifié.',
}

const DOC_ISSUES: [RegExp, string][] = [
  [/EMPTY/g, 'document vide'],
  [/PLACEHOLDER:([w-]*)/g, 'texte à compléter dans « $1 »'],
  [/MANDATORY_SHORT:([w-]*)/g, 'section obligatoire « $1 » vide ou trop courte'],
  [/MISSING_CLAUSE:([w-]*)/g, 'clause type obligatoire manquante (« $1 »)'],
]
const readableIssues = (text: string) => DOC_ISSUES.reduce((t, [re, to]) => t.replace(re, to), text)

export function toMessage(error: unknown): string {
  const raw = typeof error === 'string' ? error : (error as { message?: string })?.message ?? 'Erreur inconnue'
  const m = raw.match(/^([A-Z][A-Z0-9_]+): ([\s\S]+)$/)
  if (m) return KNOWN[m[1]] && !m[2] ? KNOWN[m[1]] : m[1] === 'DOCUMENT_INCOMPLETE' ? readableIssues(m[2]) : m[2]
  if (/row-level security|permission denied/i.test(raw)) return 'Action non autorisée pour votre rôle ou à ce stade de la procédure.'
  if (/duplicate key/i.test(raw)) return 'Cet enregistrement existe déjà.'
  if (/violates check constraint/i.test(raw)) return 'Une valeur saisie ne respecte pas les règles de gestion.'
  if (/violates foreign key/i.test(raw)) return 'Référence invalide.'
  return raw
}

export const ok = <T = unknown>(message: string, data?: T): ActionResult<T> => ({ ok: true, message, data })
export const fail = (error: unknown): ActionResult => ({ ok: false, message: toMessage(error) })
