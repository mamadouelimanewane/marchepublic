const ENDPOINT = 'https://api.anthropic.com/v1/messages'
export const aiModel = () => process.env.AI_MODEL?.trim() || 'claude-sonnet-5-5'
/** L'assistant n'est proposé que si une clé est configurée côté serveur (elle ne quitte jamais le serveur). */
export const aiEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY?.trim())

export class AiError extends Error {}

/** Appel minimal à l'API Messages d'Anthropic (sans SDK) : un tour, texte seul. */
export async function askClaude(opts: { system: string; user: string; maxTokens?: number; fetchImpl?: typeof fetch }): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY?.trim()
  if (!key) throw new AiError('Assistant IA non configuré.')
  let res: Response
  try {
    res = await (opts.fetchImpl ?? fetch)(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: aiModel(), max_tokens: opts.maxTokens ?? 1500, system: opts.system, messages: [{ role: 'user', content: opts.user }] }),
      signal: AbortSignal.timeout(60_000),
    })
  } catch {
    throw new AiError('Le service d\'assistance ne répond pas. Réessayez dans un instant.')
  }
  if (!res.ok) {
    // Le détail (clé, quota fournisseur) reste dans les journaux serveur ; l'agent reçoit un message neutre.
    console.error('[ai] réponse', res.status, await res.text().catch(() => ''))
    throw new AiError(res.status === 429 ? 'Le service d\'assistance est saturé. Réessayez dans une minute.' : 'Le service d\'assistance est momentanément indisponible.')
  }
  const json = await res.json() as { content?: { type: string; text?: string }[]; stop_reason?: string }
  const text = (json.content ?? []).filter(c => c.type === 'text').map(c => c.text ?? '').join('').trim()
  if (!text) throw new AiError('Réponse vide du service d\'assistance.')
  return text
}
