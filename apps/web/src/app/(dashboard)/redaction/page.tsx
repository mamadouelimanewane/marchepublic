'use client'

import { useState } from 'react'
import { toast } from 'sonner'

export default function RedactionAssistantIAPage() {
  const [sujet, setSujet] = useState('')
  const [nature, setNature] = useState('SERVICES_COURANTS')
  const [isGenerating, setIsGenerating] = useState(false)
  const [result, setResult] = useState('')

  const handleGenerate = async () => {
    if (!sujet) return
    setIsGenerating(true)
    
    // Simulation d'appel à un LLM (Modèle de langage) fine-tuné sur les modèles de la DCMP
    setTimeout(() => {
      setResult(`
# DOSSIER D'APPEL D'OFFRES TYPE (Généré par IA)
**Objet :** ${sujet}
**Nature :** ${nature}

## Section I. Avis d'Appel d'Offres
1. Cet Avis d'appel d'offres fait suite à l'Avis Général de Passation des Marchés paru dans le journal officiel...
2. L'Autorité contractante a obtenu des fonds dans le cadre de son budget, afin de financer ce projet, et a l'intention d'utiliser une partie de ces fonds pour effectuer des paiements...

## Section II. Critères d'Évaluation (Suggérés)
- Expérience générale : Au moins 3 marchés similaires lors des 5 dernières années.
- Capacité financière : Chiffre d'affaires moyen annuel représentant au moins 1,5 fois le montant estimé.
- Personnel clé : Chef de projet (Ingénieur, 10 ans d'expérience).

*(Ce document est un brouillon conforme aux standards de la DCMP. Veuillez le valider avant la transmission à la cellule de passation).*
      `)
      setIsGenerating(false)
      toast.success('Brouillon généré avec succès !')
    }, 3000)
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="bg-blue-100 p-2 rounded-lg border border-blue-200">
          <span className="text-xl">🤖</span>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Assistant IA de Rédaction</h1>
          <p className="text-sm text-gray-500">
            Générez automatiquement vos TDR et DAO conformes aux standards de la DCMP.
          </p>
        </div>
      </div>

      <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Objet détaillé du marché</label>
          <textarea
            rows={3}
            value={sujet}
            onChange={(e) => setSujet(e.target.value)}
            placeholder="Ex: Fourniture, installation et mise en service de 500 ordinateurs portables pour le Ministère de l'Éducation..."
            className="w-full rounded-lg border-gray-300 border p-3 text-sm focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        
        <div className="flex gap-4 items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">Nature du marché</label>
            <select 
              value={nature} 
              onChange={(e) => setNature(e.target.value)}
              className="w-full rounded-lg border-gray-300 border p-3 text-sm"
            >
              <option value="TRAVAUX">Travaux</option>
              <option value="FOURNITURES">Fournitures</option>
              <option value="SERVICES_COURANTS">Services courants</option>
              <option value="PRESTATIONS_INTELLECTUELLES">Prestations Intellectuelles</option>
            </select>
          </div>
          <button
            onClick={handleGenerate}
            disabled={isGenerating || !sujet}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            {isGenerating ? 'Génération en cours ⏳' : '✨ Générer le modèle DCMP'}
          </button>
        </div>
      </div>

      {result && (
        <div className="bg-white p-6 rounded-xl border border-green-200 shadow-sm relative">
          <div className="absolute top-4 right-4 space-x-2">
            <button className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded font-medium">Copier</button>
            <button className="text-xs bg-green-100 hover:bg-green-200 text-green-800 px-3 py-1.5 rounded font-medium border border-green-200">Enregistrer vers Phase 3</button>
          </div>
          <h3 className="text-sm font-bold text-gray-400 uppercase mb-4">Résultat de l'IA</h3>
          <div className="prose prose-sm max-w-none prose-blue">
            <pre className="whitespace-pre-wrap bg-gray-50 p-4 rounded-lg text-gray-700 border border-gray-100 font-sans">
              {result}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
