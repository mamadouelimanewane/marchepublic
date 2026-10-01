'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { decryptEnvelope, sha256Hex, toBase64 } from '@/lib/crypto'
import { isShare, parseShare, recoverSecret } from '@/lib/shamir'

interface BidFile { bidId: string; label: string; techniquePath: string | null; financierPath: string | null; techniqueHash: string | null; financierHash: string | null }
interface Opened { bidId: string; label: string; technique?: string; financier?: string; error?: string }

/**
 * Déchiffrement LOCAL des plis par la commission. La clé privée (fichier remis au président) est lue dans le navigateur,
 * utilisée en mémoire puis oubliée : elle n'est jamais envoyée à la plateforme. Les empreintes SHA-256 enregistrées
 * au dépôt sont comparées pour prouver que les plis n'ont pas été altérés depuis leur réception.
 */
export function OpeningPanel({ bids, threshold, shares }: { bids: BidFile[]; threshold?: number | null; shares?: number | null }) {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [opened, setOpened] = useState<Opened[]>([])

  /** Les parts de Shamir (une par ligne) sont fusionnées ; sinon le texte est la clé privée complète. */
  const tokens = key.split(/\s+/).filter(Boolean)
  const shareTokens = tokens.filter(isShare)
  const validShares = new Set(shareTokens.flatMap(t => { try { return [parseShare(t).x] } catch { return [] } })).size

  async function decryptAll() {
    if (!key.trim()) return toast.error('Fournissez la clé privée du marché ou les parts des membres.')
    let privateKey = key.trim()
    if (shareTokens.length > 0) {
      try { privateKey = toBase64(await recoverSecret(shareTokens)) }
      catch (e) { return toast.error(e instanceof Error ? e.message : 'Parts invalides') }
    }
    setBusy(true)
    const supabase = createSupabaseBrowserClient()
    const out: Opened[] = []
    for (const b of bids) {
      const entry: Opened = { bidId: b.bidId, label: b.label }
      try {
        for (const kind of ['technique', 'financier'] as const) {
          const path = kind === 'technique' ? b.techniquePath : b.financierPath
          const expected = kind === 'technique' ? b.techniqueHash : b.financierHash
          if (!path) continue
          const { data, error } = await supabase.storage.from('bids').download(path)
          if (error || !data) throw new Error(`Téléchargement impossible (${kind})`)
          const text = await data.text()
          const actual = await sha256Hex(new TextEncoder().encode(text))
          if (expected && actual !== expected) throw new Error(`Empreinte ${kind} différente de celle enregistrée au dépôt : pli altéré`)
          const plain = await decryptEnvelope(text, privateKey)
          entry[kind] = URL.createObjectURL(new Blob([plain], { type: 'application/pdf' }))
        }
      } catch (e) {
        entry.error = e instanceof Error ? e.message : 'Déchiffrement impossible'
      }
      out.push(entry)
    }
    setKey('')                   // la clé ne reste pas en mémoire de l'interface
    setOpened(out)
    setBusy(false)
    const ok = out.filter(o => !o.error).length
    toast[ok === out.length ? 'success' : 'error'](`${ok}/${out.length} pli(s) déchiffré(s) localement`)
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        {threshold ? <>La clé est partagée : réunissez <strong>{threshold}</strong> parts sur {shares} (une par ligne, ou plusieurs fichiers <code>.share</code>).</> : <>Collez le contenu du fichier <code>cle-privee-….key</code> détenu par le président de la commission (ou chargez-le).</>}{' '}
        Le déchiffrement s'effectue dans ce navigateur uniquement ; rien n'est transmis.
      </p>
      <textarea value={key} onChange={e => setKey(e.target.value)} rows={3} placeholder={threshold ? 'Une part par ligne (MPSHARE1.…)' : 'Clé privée (PKCS#8, base64)'} aria-label="Clé privée"
        className="block w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs" />
      <div className="flex flex-wrap items-center gap-3">
        <input type="file" multiple accept=".key,.share,text/plain" aria-label="Fichiers de clé ou de parts"
          onChange={async e => { const texts = await Promise.all([...(e.target.files ?? [])].map(f => f.text())); setKey(k => [k.trim(), ...texts.map(t => t.trim())].filter(Boolean).join(' ')) }} className="text-sm" />
        {shareTokens.length > 0 && <span className={validShares >= (threshold ?? 2) ? 'text-sm text-green-700' : 'text-sm text-amber-700'}>{validShares} part(s) valide(s){threshold ? ` / ${threshold} requises` : ''}</span>}
        <button type="button" disabled={busy || !bids.length} onClick={decryptAll}
          className="rounded-lg bg-purple-700 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-800 disabled:opacity-50">
          {busy ? 'Déchiffrement…' : `Déchiffrer ${bids.length} pli(s)`}
        </button>
      </div>
      {opened.length > 0 && (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
          {opened.map(o => (
            <li key={o.bidId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
              <span className="font-medium">{o.label}</span>
              {o.error ? <span className="text-red-700">⚠ {o.error}</span> : (
                <span className="flex gap-3">
                  {o.technique && <a className="text-green-700 underline" href={o.technique} target="_blank" rel="noreferrer">Offre technique</a>}
                  {o.financier && <a className="text-green-700 underline" href={o.financier} target="_blank" rel="noreferrer">Offre financière</a>}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
