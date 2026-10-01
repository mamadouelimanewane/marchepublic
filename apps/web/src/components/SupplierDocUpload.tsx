'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { sha256Hex } from '@/lib/crypto'
import { addSupplierDocument } from '@/app/dashboard/actions/fournisseur'
import { PIECE_LABELS as LABELS, PIECE_TYPES } from '@/lib/pieces'

const field = 'mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-green-600 focus:outline-none focus:ring-1 focus:ring-green-600'
const MAX = 10 * 1024 * 1024

/** Téléverse une pièce du dossier permanent (PDF ou image, 10 Mo max) puis l'enregistre avec son empreinte SHA-256. */
export function SupplierDocUpload({ userId }: { userId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const data = new FormData(form)
    const file = data.get('fichier') as File
    try {
      if (!file || !file.size) throw new Error('Choisissez un fichier.')
      if (file.size > MAX) throw new Error('Fichier trop volumineux (10 Mo maximum).')
      if (!['application/pdf', 'image/png', 'image/jpeg'].includes(file.type)) throw new Error('Formats acceptés : PDF, PNG, JPEG.')
      setBusy(true)
      const bytes = await file.arrayBuffer()
      const hash = await sha256Hex(bytes)
      const ext = file.type === 'application/pdf' ? 'pdf' : file.type === 'image/png' ? 'png' : 'jpg'
      const path = `${userId}/${crypto.randomUUID()}.${ext}`           // aucun nom de fichier fourni par l'utilisateur
      const supabase = createSupabaseBrowserClient()
      // Nouvelle tentative avec attente croissante : connexions instables.
      let lastError: string | null = null
      for (let attempt = 0; attempt < 3; attempt++) {
        const up = await supabase.storage.from('supplier-docs').upload(path, new Blob([bytes], { type: file.type }), { contentType: file.type, upsert: false })
        if (!up.error) { lastError = null; break }
        lastError = up.error.message
        await new Promise(r => setTimeout(r, 800 * 2 ** attempt))
      }
      if (lastError) throw new Error(`Téléversement impossible : ${lastError}`)
      const res = await addSupplierDocument({
        type: String(data.get('type')), titre: String(data.get('titre')),
        date_emission: String(data.get('date_emission') ?? ''), date_expiration: String(data.get('date_expiration') ?? ''),
        storage_path: path, file_hash: hash,
      })
      if (!res.ok) { await supabase.storage.from('supplier-docs').remove([path]); throw new Error(res.message) }
      toast.success(res.message); form.reset(); router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
      <label className="block text-sm font-medium text-gray-700">Type de pièce
        <select name="type" required className={field} defaultValue="QUITUS_FISCAL">{PIECE_TYPES.map(t => <option key={t} value={t}>{LABELS[t]}</option>)}</select>
      </label>
      <label className="block text-sm font-medium text-gray-700">Intitulé
        <input name="titre" required minLength={3} className={field} placeholder="Quitus fiscal 2026" />
      </label>
      <label className="block text-sm font-medium text-gray-700">Date d&apos;émission<input type="date" name="date_emission" className={field} /></label>
      <label className="block text-sm font-medium text-gray-700">Date d&apos;expiration<input type="date" name="date_expiration" className={field} /></label>
      <label className="block text-sm font-medium text-gray-700 md:col-span-2">Fichier (PDF, PNG, JPEG — 10 Mo max)
        <input type="file" name="fichier" accept="application/pdf,image/png,image/jpeg" required className="mt-1 block w-full text-sm" />
      </label>
      <div className="md:col-span-2"><button disabled={busy} className="rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50">{busy ? 'Téléversement…' : 'Déposer la pièce'}</button></div>
    </form>
  )
}
