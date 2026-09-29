'use client'

import { useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { toast } from 'sonner'

interface DepotOffreProps {
  tenderId: string
  /** Clé publique RSA-OAEP au format Base64 SPKI. La clé privée doit rester hors de la plateforme. */
  publicKey: string
}

function toBase64(value: ArrayBuffer) {
  const bytes = new Uint8Array(value)
  let binary = ''
  bytes.forEach(byte => { binary += String.fromCharCode(byte) })
  return btoa(binary)
}

export default function DepotOffreComponent({ tenderId, publicKey }: DepotOffreProps) {
  const [file, setFile] = useState<File | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [progress, setProgress] = useState(0)
  
  const supabase = createSupabaseBrowserClient()

  const handleEncryptAndSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) return
    
    setIsSubmitting(true)
    setProgress(10)
    
    try {
      if (file.type !== 'application/pdf' || file.size > 20 * 1024 * 1024) {
        throw new Error('Sélectionnez un PDF de 20 Mo maximum.')
      }
      if (!publicKey) throw new Error('La clé publique de dépôt de ce marché est manquante.')

      // Envelope encryption: AES-GCM for the dossier, RSA-OAEP for its random AES key.
      const rawPublicKey = Uint8Array.from(atob(publicKey), character => character.charCodeAt(0))
      const rsaKey = await crypto.subtle.importKey(
        'spki', rawPublicKey, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']
      )
      const aesKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt'])
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const encryptedData = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, await file.arrayBuffer())
      const wrappedKey = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, rsaKey, await crypto.subtle.exportKey('raw', aesKey))
      const envelope = JSON.stringify({ version: 1, algorithm: 'RSA-OAEP-256+A256GCM', iv: toBase64(iv.buffer), wrappedKey: toBase64(wrappedKey), ciphertext: toBase64(encryptedData) })
      const encryptedBlob = new Blob([envelope], { type: 'application/json' })
      const digest = await crypto.subtle.digest('SHA-256', await encryptedBlob.arrayBuffer())
      const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
      setProgress(55)

      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError || !user) throw new Error('Reconnectez-vous avant de déposer une offre.')
      const { data: tender, error: tenderError } = await supabase
        .from('tenders').select('institution_id, current_phase, date_limite_depot').eq('id', tenderId).single()
      if (tenderError || !tender) throw new Error('Marché introuvable ou inaccessible.')
      if (tender.current_phase !== 'PHASE_6_DEPOT_OFFRES' || !tender.date_limite_depot || Date.now() >= new Date(tender.date_limite_depot).getTime()) {
        throw new Error('La période de dépôt est fermée pour ce marché.')
      }

      // Le chemin ne contient aucun nom de fichier fourni par l'utilisateur.
      const filePath = `${tenderId}/${user.id}/${crypto.randomUUID()}.envelope.json`
      const { error: uploadError } = await supabase.storage
        .from('bids')
        .upload(filePath, encryptedBlob, { contentType: 'application/json', upsert: false })
        
      if (uploadError) throw uploadError
      
      setProgress(80)
      
      // 4. Créer l'enregistrement dans la base de données
      const { error: dbError } = await supabase
        .from('bids')
        .insert({
          tender_id: tenderId,
          institution_id: tender.institution_id,
          soumissionnaire_id: user.id,
          status: 'SOUMISE',
          fichier_financier_path: filePath,
          fichier_financier_encrypted: true,
          fichier_financier_hash: hash,
          submitted_at: new Date().toISOString(),
        })

      if (dbError) {
        await supabase.storage.from('bids').remove([filePath])
        throw dbError
      }
      
      setProgress(100)
      toast.success('Votre offre a été chiffrée et déposée avec succès dans le coffre-fort numérique.')
      
    } catch (err: any) {
      console.error(err)
      toast.error('Erreur lors du dépôt : ' + (err.message || 'Erreur inconnue'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="bg-purple-100 p-3 rounded-full">
          <span className="text-xl">🔒</span>
        </div>
        <div>
          <h2 className="text-lg font-bold text-gray-800">Coffre-fort Cryptographique</h2>
          <p className="text-sm text-gray-500">
            Le PDF est chiffré dans votre navigateur avec une clé aléatoire AES-GCM. Cette clé est scellée avec la clé publique RSA du marché.
          </p>
        </div>
      </div>

      <form onSubmit={handleEncryptAndSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Dossier de l'offre (PDF)
          </label>
          <input 
            type="file" 
            accept=".pdf"
            required
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100"
          />
        </div>

        <div>
          <p className="text-sm text-gray-600">
            Vérifiez que le PDF contient toutes les pièces administratives, techniques et financières requises.
          </p>
        </div>

        {isSubmitting && (
          <div className="w-full bg-gray-200 rounded-full h-2.5 mb-4">
            <div className="bg-purple-600 h-2.5 rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
          </div>
        )}

        <button 
          type="submit" 
          disabled={isSubmitting || !file}
          className="w-full bg-purple-700 text-white font-semibold py-2.5 rounded-lg hover:bg-purple-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isSubmitting ? 'Chiffrement et transmission en cours...' : 'Chiffrer et Sceller mon offre'}
        </button>
      </form>
      
      <div className="mt-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex gap-3">
        <span>⚠</span>
        <p className="text-xs text-yellow-800 text-justify">
          <strong>À savoir :</strong> Le condensat SHA-256 du dossier chiffré est conservé avec l'offre. La clé privée RSA permettant l'ouverture doit rester sous le contrôle indépendant de l'autorité compétente.
        </p>
      </div>
    </div>
  )
}
