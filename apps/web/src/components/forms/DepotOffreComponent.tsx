'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { encryptForMarket } from '@/lib/crypto'
import { submitBid } from '@/app/dashboard/actions/passation'

interface DepotOffreProps {
  tenderId: string
  /** Clé publique RSA-OAEP (SPKI base64) du marché. La clé privée reste hors de la plateforme. */
  publicKey: string
  keyFingerprint?: string | null
  dateLimite: string
  /** Marché alloti : lot visé par ce dépôt. */
  lotId?: string
  lotLabel?: string
}

const MAX_SIZE = 20 * 1024 * 1024
const fileInput = 'block w-full text-sm text-gray-500 file:mr-4 file:rounded-full file:border-0 file:bg-purple-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-purple-700 hover:file:bg-purple-100'

export default function DepotOffreComponent({ tenderId, publicKey, keyFingerprint, dateLimite, lotId, lotLabel }: DepotOffreProps) {
  const router = useRouter()
  const [technique, setTechnique] = useState<File | null>(null)
  const [financier, setFinancier] = useState<File | null>(null)
  const [step, setStep] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [receipt, setReceipt] = useState<string | null>(null)

  const check = (f: File, label: string) => {
    if (f.type !== 'application/pdf') throw new Error(`${label} : un fichier PDF est requis.`)
    if (f.size > MAX_SIZE) throw new Error(`${label} : 20 Mo maximum.`)
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!technique || !financier) return
    try {
      check(technique, 'Offre technique'); check(financier, 'Offre financière')
      if (!publicKey) throw new Error('La clé de chiffrement de ce marché n\'est pas disponible.')
      const supabase = createSupabaseBrowserClient()
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError || !user) throw new Error('Reconnectez-vous avant de déposer une offre.')

      setStep('Chiffrement dans votre navigateur…'); setProgress(10)
      const [tech, fin] = await Promise.all([
        technique.arrayBuffer().then(b => encryptForMarket(b, publicKey)),
        financier.arrayBuffer().then(b => encryptForMarket(b, publicKey)),
      ])
      setProgress(45)

      // Aucun nom de fichier fourni par l'utilisateur n'entre dans le chemin de stockage.
      const base = `${tenderId}/${user.id}`
      const techPath = `${base}/${crypto.randomUUID()}.technique.envelope.json`
      const finPath = `${base}/${crypto.randomUUID()}.financier.envelope.json`
      setStep('Transmission sécurisée…')
      const up1 = await supabase.storage.from('bids').upload(techPath, tech.blob, { contentType: 'application/json', upsert: false })
      if (up1.error) throw new Error(/row-level security|policy/i.test(up1.error.message) ? 'Le dépôt est fermé ou la date limite est dépassée.' : up1.error.message)
      setProgress(70)
      const up2 = await supabase.storage.from('bids').upload(finPath, fin.blob, { contentType: 'application/json', upsert: false })
      if (up2.error) { await supabase.storage.from('bids').remove([techPath]); throw new Error(up2.error.message) }
      setProgress(85)

      // Enregistrement : horodatage, contrôles et accusé de réception par le SERVEUR.
      setStep('Enregistrement et accusé de réception…')
      const res = await submitBid({ tender_id: tenderId, lot_id: lotId ?? null, technique_path: techPath, technique_hash: tech.hash, financier_path: finPath, financier_hash: fin.hash })
      if (!res.ok) {
        await supabase.storage.from('bids').remove([techPath, finPath])
        throw new Error(res.message)
      }
      setProgress(100)
      setReceipt(res.data?.receipt ?? null)
      toast.success(res.message)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur lors du dépôt')
    } finally {
      setStep(null)
    }
  }

  return (
    <div className="mx-auto max-w-2xl rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-5 flex items-center gap-3">
        <div className="rounded-full bg-purple-100 p-3" aria-hidden>🔒</div>
        <div>
          <h2 className="text-lg font-bold text-gray-800">Coffre-fort cryptographique{lotLabel ? ` — ${lotLabel}` : ''}</h2>
          <p className="text-sm text-gray-500">Vos deux dossiers sont chiffrés dans votre navigateur (AES-256-GCM) ; la clé est scellée avec la clé publique du marché (RSA-OAEP 3072).
            Personne ne peut les lire avant l'ouverture officielle des plis. Date limite : <strong>{dateLimite}</strong>.</p>
        </div>
      </div>

      <form onSubmit={onSubmit} className="space-y-5">
        <label className="block text-sm font-medium text-gray-700">Offre technique et dossier administratif (PDF)
          <input type="file" accept="application/pdf,.pdf" required onChange={e => setTechnique(e.target.files?.[0] ?? null)} className={fileInput} />
        </label>
        <label className="block text-sm font-medium text-gray-700">Offre financière (PDF)
          <input type="file" accept="application/pdf,.pdf" required onChange={e => setFinancier(e.target.files?.[0] ?? null)} className={fileInput} />
        </label>
        {step && (
          <div aria-live="polite">
            <p className="mb-1 text-xs text-gray-600">{step}</p>
            <div className="h-2.5 w-full rounded-full bg-gray-200"><div className="h-2.5 rounded-full bg-purple-600 transition-all" style={{ width: `${progress}%` }} /></div>
          </div>
        )}
        <button type="submit" disabled={!!step || !technique || !financier}
          className="w-full rounded-lg bg-purple-700 py-2.5 font-semibold text-white hover:bg-purple-800 disabled:cursor-not-allowed disabled:opacity-50">
          {step ? 'Traitement en cours…' : 'Chiffrer et déposer mon offre'}
        </button>
      </form>

      {receipt && (
        <div role="status" className="mt-5 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900">
          <p className="font-semibold">Accusé de réception</p>
          <p className="break-all text-xs">Empreinte : {receipt}</p>
          <p className="mt-1 text-xs">Conservez cette empreinte. Vous pouvez remplacer ou retirer votre offre jusqu'à la date limite.</p>
        </div>
      )}
      <p className="mt-5 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
        Empreinte de la clé publique du marché : <code className="break-all">{keyFingerprint ?? '—'}</code>. Le déposant n'a rien à conserver : seule la commission, avec la clé privée confiée à son président, peut ouvrir les plis.
      </p>
    </div>
  )
}
