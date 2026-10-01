// Edge Function (Deno) — réception des confirmations de paiement du Trésor / SIGFIP (CDC §12).
//
// ⚠ Le format ci-dessous est un CONTRAT PROPOSÉ à adapter à la spécification réelle du SIGFIP (non disponible ici) :
//   POST  { "statement_id": "<uuid>", "reference_sigfip": "<ref>", "statut": "PAYE" | "REJETE", "motif": "<texte>" }
//   En-tête  X-Signature: hex(HMAC-SHA256(secret, corps brut))
// Le secret partagé est SIGFIP_WEBHOOK_SECRET. Sans signature valide, la requête est rejetée (401) : aucun effet.
//
// Déploiement : supabase functions deploy sigfip-webhook --no-verify-jwt
//               supabase secrets set SIGFIP_WEBHOOK_SECRET=...

import { createClient } from 'npm:@supabase/supabase-js@2'

const enc = new TextEncoder()

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body))
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Comparaison à temps constant. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

Deno.serve(async req => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const secret = Deno.env.get('SIGFIP_WEBHOOK_SECRET')
  if (!secret) return new Response('Webhook non configuré', { status: 503 })

  const raw = await req.text()
  const provided = req.headers.get('x-signature') ?? ''
  if (!safeEqual(await hmacHex(secret, raw), provided.toLowerCase())) return new Response('Signature invalide', { status: 401 })

  let payload: { statement_id?: string; reference_sigfip?: string; statut?: string; motif?: string }
  try { payload = JSON.parse(raw) } catch { return new Response('JSON invalide', { status: 400 }) }
  if (!payload.statement_id || !['PAYE', 'REJETE'].includes(payload.statut ?? '')) return new Response('Charge utile invalide', { status: 422 })

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  // Seul un décompte déjà transmis au Trésor peut être clos par ce canal.
  const { data: current, error: readError } = await supabase
    .from('payment_statements').select('id, statut').eq('id', payload.statement_id).single()
  if (readError || !current) return new Response('Décompte introuvable', { status: 404 })
  if (current.statut !== 'TRANSMIS_TRESOR') return new Response(`Statut ${current.statut} : transition refusée`, { status: 409 })

  const patch = payload.statut === 'PAYE'
    ? { statut: 'PAYE', reference_sigfip: payload.reference_sigfip ?? null }
    : { statut: 'REJETE', motif_rejet: payload.motif ?? 'Rejeté par le Trésor', reference_sigfip: payload.reference_sigfip ?? null }
  const { error } = await supabase.from('payment_statements').update(patch).eq('id', payload.statement_id)
  if (error) return new Response(error.message, { status: 500 })
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } })
})
