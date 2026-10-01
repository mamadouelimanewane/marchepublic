import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { createSupabaseAdminClient } from '@/lib/supabase/server'

// Tâche quotidienne (Vercel Cron, protégée par CRON_SECRET) :
//   1. ancrage des empreintes du journal d'audit ;
//   2. alertes d'expiration des pièces des fournisseurs ;
//   3. envoi des messages en attente (e-mail via SMTP ; SMS et WhatsApp via un webhook d'opérateur).
// Un canal sans fournisseur configuré n'est pas traité : ses messages restent en attente, rien n'est perdu ni simulé.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface Outbox { id: string; canal: 'EMAIL' | 'SMS' | 'WHATSAPP'; destinataire: string; sujet: string; corps: string }

async function sendEmail(m: Outbox) {
  const nodemailer = (await import('nodemailer')) as unknown as { createTransport: (url: string) => { sendMail: (o: Record<string, string>) => Promise<unknown> } }
  const transport = nodemailer.createTransport(process.env.SMTP_URL!)
  await transport.sendMail({ from: process.env.MAIL_FROM ?? 'no-reply@marchepublic.example', to: m.destinataire, subject: m.sujet, text: m.corps })
}

async function sendViaWebhook(m: Outbox) {
  const url = m.canal === 'SMS' ? process.env.SMS_WEBHOOK_URL! : process.env.WHATSAPP_WEBHOOK_URL!
  const token = m.canal === 'SMS' ? process.env.SMS_WEBHOOK_TOKEN : process.env.WHATSAPP_WEBHOOK_TOKEN
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ to: m.destinataire, text: m.corps, channel: m.canal }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Opérateur : HTTP ${res.status}`)
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET non configuré' }, { status: 503 })
  const provided = Buffer.from(request.headers.get('authorization') ?? '')
  const expected = Buffer.from(`Bearer ${secret}`)
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const admin = createSupabaseAdminClient()
  const report: Record<string, unknown> = {}

  const anchors = await admin.rpc('anchor_audit_chain'); report.ancres_creees = anchors.error ? `erreur : ${anchors.error.message}` : anchors.data
  const expiring = await admin.rpc('notify_expiring_documents'); report.alertes_expiration = expiring.error ? `erreur : ${expiring.error.message}` : expiring.data

  const canaux = [
    ...(process.env.SMTP_URL ? ['EMAIL'] : []),
    ...(process.env.SMS_WEBHOOK_URL ? ['SMS'] : []),
    ...(process.env.WHATSAPP_WEBHOOK_URL ? ['WHATSAPP'] : []),
  ]
  const outbox = { canaux_actifs: canaux, envoyes: 0, echecs: 0 }
  if (canaux.length) {
    const claimed = await admin.rpc('claim_outbox', { p_canaux: canaux, p_limit: 100 })
    for (const m of (claimed.data ?? []) as Outbox[]) {
      try {
        if (m.canal === 'EMAIL') await sendEmail(m); else await sendViaWebhook(m)
        await admin.rpc('mark_outbox', { p_id: m.id, p_ok: true, p_erreur: null })
        outbox.envoyes++
      } catch (e) {
        await admin.rpc('mark_outbox', { p_id: m.id, p_ok: false, p_erreur: e instanceof Error ? e.message : String(e) })
        outbox.echecs++
      }
    }
  }
  report.envoi = outbox
  return NextResponse.json(report)
}
