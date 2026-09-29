'use client'

import { useState } from 'react'
import { toast } from 'sonner'

interface MobilePaymentModalProps {
  montant: number
  motif: string
  onSuccess: () => void
}

export function MobilePaymentModal({ montant, motif, onSuccess }: MobilePaymentModalProps) {
  const [phone, setPhone] = useState('')
  const [provider, setProvider] = useState<'WAVE' | 'ORANGE_MONEY' | 'FREE_MONEY'>('WAVE')
  const [isProcessing, setIsProcessing] = useState(false)

  const handlePayment = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsProcessing(true)

    // Simulation d'appel à l'API de paiement (ex: PayDunya ou InTouch)
    setTimeout(() => {
      setIsProcessing(false)
      toast.success(`Paiement de ${montant} FCFA réussi via ${provider}`)
      onSuccess()
    }, 2500)
  }

  return (
    <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
      <h3 className="text-lg font-bold text-gray-800 mb-2">Paiement Sécurisé</h3>
      <p className="text-sm text-gray-500 mb-6">{motif}</p>

      <form onSubmit={handlePayment} className="space-y-4">
        {/* Choix du fournisseur */}
        <div className="flex gap-3">
          {(['WAVE', 'ORANGE_MONEY', 'FREE_MONEY'] as const).map((prov) => (
            <button
              key={prov}
              type="button"
              onClick={() => setProvider(prov)}
              className={`flex-1 py-3 px-2 border rounded-lg text-xs font-bold transition-all ${
                provider === prov 
                  ? 'border-green-600 bg-green-50 text-green-700 ring-2 ring-green-600/20' 
                  : 'border-gray-200 hover:border-gray-300 text-gray-600'
              }`}
            >
              {prov === 'WAVE' ? '🌊 Wave' : prov === 'ORANGE_MONEY' ? '🟧 Orange' : '🔴 Free'}
            </button>
          ))}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Numéro de téléphone</label>
          <div className="flex">
            <span className="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-gray-300 bg-gray-50 text-gray-500 sm:text-sm">
              +221
            </span>
            <input
              type="tel"
              required
              pattern="[0-9]{9}"
              placeholder="77 123 45 67"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 9))}
              className="flex-1 block w-full rounded-none rounded-r-lg border border-gray-300 px-3 py-2 sm:text-sm focus:ring-green-500 focus:border-green-500"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={isProcessing || phone.length !== 9}
          className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-green-700 hover:bg-green-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50"
        >
          {isProcessing ? 'En attente de validation sur votre téléphone...' : `Payer ${montant.toLocaleString('fr-SN')} FCFA`}
        </button>
      </form>
    </div>
  )
}
