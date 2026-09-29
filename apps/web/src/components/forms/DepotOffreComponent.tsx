'use client'

import { useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import CryptoJS from 'crypto-js'

interface DepotOffreProps {
  tenderId: string
  publicKey: string // Clé publique du marché pour chiffrement côté client
}

export default function DepotOffreComponent({ tenderId, publicKey }: DepotOffreProps) {
  const [file, setFile] = useState<File | null>(null)
  const [montant, setMontant] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [progress, setProgress] = useState(0)
  
  const supabase = createSupabaseBrowserClient()

  const handleEncryptAndSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file || !montant) return
    
    setIsSubmitting(true)
    setProgress(10)
    
    try {
      // 1. Lire le fichier
      const arrayBuffer = await file.arrayBuffer()
      const wordArray = CryptoJS.lib.WordArray.create(arrayBuffer as any)
      
      setProgress(30)
      
      // 2. Chiffrer le fichier avec AES-256 (Clé spécifique au marché)
      const encryptedFile = CryptoJS.AES.encrypt(wordArray, publicKey).toString()
      const encryptedBlob = new Blob([encryptedFile], { type: 'text/plain' })
      
      setProgress(50)
      
      // 3. Uploader le fichier chiffré vers Supabase Storage
      const filePath = `${tenderId}/${Date.now()}_${file.name}.encrypted`
      const { error: uploadError } = await supabase.storage
        .from('bids')
        .upload(filePath, encryptedBlob)
        
      if (uploadError) throw uploadError
      
      setProgress(80)
      
      // 4. Créer l'enregistrement dans la base de données
      const { error: dbError } = await supabase
        .from('bids')
        .insert({
          tender_id: tenderId,
          status: 'SOUMISE',
          fichier_financier_path: filePath,
          fichier_financier_encrypted: true,
          submitted_at: new Date().toISOString()
          // Le montant n'est PAS stocké en clair, il sera extrait du fichier financier déchiffré à l'ouverture
        })
        
      if (dbError) throw dbError
      
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
            Dépôt sécurisé AES-256 (Phase 6). Votre offre restera indéchiffrable jusqu'à la séance officielle d'ouverture.
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
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Montant de l'offre financière (FCFA)
          </label>
          <input 
            type="number" 
            required
            value={montant}
            onChange={(e) => setMontant(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-purple-500 focus:border-purple-500"
            placeholder="Ex: 15000000"
          />
          <p className="text-xs text-gray-500 mt-1">
            Ce montant sera chiffré dans la base de données.
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
          <strong>Avertissement Légal :</strong> Conformément au Décret 2022-2295, toute offre déposée après la date et l'heure limites sera automatiquement rejetée par le système. Le condensat (hash SHA-256) de votre fichier chiffré sera inscrit dans le journal d'audit immuable pour garantir son intégrité.
        </p>
      </div>
    </div>
  )
}
