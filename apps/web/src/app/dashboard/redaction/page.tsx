'use client'

import { useState } from 'react'
import { toast } from 'sonner'

export default function RedactionAssistantIAPage() {
  const [sujet, setSujet] = useState('')
  const [nature, setNature] = useState('TRAVAUX')
  const [secteur, setSecteur] = useState('BTP')
  const [isGenerating, setIsGenerating] = useState(false)
  const [result, setResult] = useState('')

  const handleGenerate = async () => {
    if (!sujet) return
    setIsGenerating(true)
    
    setTimeout(() => {
      let contenuGenere = ''

      if (secteur === 'BTP') {
        contenuGenere = `
# CAHIER DES CLAUSES TECHNIQUES PARTICULIÈRES (CCTP) - BTP & GÉNIE CIVIL
**Objet du marché :** ${sujet}

## 1. Exigences Réglementaires & Normes (Sénégal)
- **Normes de construction :** Tous les matériaux (Béton, Fer à béton, Ciment) doivent respecter les normes édictées par l'Association Sénégalaise de Normalisation (ASN).
- **Garantie Décennale :** L'entrepreneur est soumis à l'obligation de souscrire à une police d'assurance couvrant la garantie décennale des ouvrages.
- **Sécurité et Environnement :** Un Plan de Gestion Environnementale et Sociale (PGES) devra être soumis avant le démarrage des travaux, conformément aux directives du Ministère de l'Environnement.

## 2. Visite de Site Obligatoire
Une visite de site obligatoire sera organisée par l'Autorité Contractante. L'absence d'une attestation de visite de site signée par la Personne Responsable des Marchés (PRM) entraînera le rejet automatique de l'offre (conformément à la jurisprudence de l'ARCOP).

## 3. Critères de Qualification (Personnel & Matériel)
- **Directeur des Travaux :** Ingénieur en Génie Civil inscrit à l'Ordre des Ingénieurs du Sénégal (OIES), justifiant d'au moins dix (10) ans d'expérience.
- **Matériel lourd :** Preuve de propriété ou contrat de location ferme pour : 2 pelles mécaniques, 3 camions bennes (20m³), et 1 bétonnière.
- **Capacité financière :** Attestation de ligne de crédit (minimum 30% du montant estimé) délivrée par une banque reconnue par le Ministère des Finances.
`
      } else if (secteur === 'SANTE') {
        contenuGenere = `
# TERMES DE RÉFÉRENCE (TDR) - ÉQUIPEMENTS MÉDICAUX & SANTÉ
**Objet du marché :** ${sujet}

## 1. Homologation et Exigences Légales
- **Autorisation de Mise sur le Marché (AMM) :** Tout produit pharmaceutique ou équipement médical soumis doit obligatoirement disposer d'une AMM valide délivrée par la Direction de la Pharmacie et des Médicaments (DPM) du Sénégal.
- **Normes OMS / ISO :** Les équipements (imagerie, bloc opératoire, conservation) doivent être certifiés ISO 13485 ou posséder un marquage CE médical.

## 2. Spécifications Logistiques (Chaîne du froid & Sensibilité)
Pour les réactifs et vaccins, le soumissionnaire doit garantir une traçabilité de la chaîne du froid (2°C à 8°C) avec enregistreurs de température intégrés lors de la livraison à la Pharmacie Nationale d'Approvisionnement (PNA).

## 3. SAV, Garantie et Formation
- **Garantie Pièces et Main-d'œuvre :** Une garantie constructeur absolue de trois (3) ans est exigée sur site.
- **Disponibilité des pièces de rechange :** Le candidat doit s'engager par écrit à garantir la disponibilité des pièces de rechange et consommables pendant au moins sept (7) ans.
- **Personnel Technique :** Le soumissionnaire doit disposer d'un Ingénieur Biomédical résident au Sénégal pour assurer les interventions sous 48h.
`
      } else {
        contenuGenere = `
# DOSSIER D'APPEL D'OFFRES TYPE
**Objet :** ${sujet}

## Section I. Critères d'Évaluation
- Expérience générale : Au moins 3 marchés similaires lors des 5 dernières années.
- Capacité financière : Chiffre d'affaires moyen annuel suffisant.
*(Sélectionnez BTP ou Santé pour un modèle ultra-spécialisé)*
`
      }

      setResult(contenuGenere.trim())
      setIsGenerating(false)
      toast.success('Dossier technique généré avec succès !')
    }, 2000)
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="bg-blue-100 p-2 rounded-lg border border-blue-200">
          <span className="text-xl">🤖</span>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Assistant IA : Spécialiste Métier</h1>
          <p className="text-sm text-gray-500">
            Génération de CCTP et TDR intégrant le cadre légal et normatif sectoriel du Sénégal.
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
            placeholder="Ex: Construction d'un hôpital de niveau 2 à Tambacounda..."
            className="w-full rounded-lg border-gray-300 border p-3 text-sm focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        
        <div className="flex gap-4 items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">Secteur technique</label>
            <select 
              value={secteur} 
              onChange={(e) => setSecteur(e.target.value)}
              className="w-full rounded-lg border-gray-300 border p-3 text-sm font-semibold text-gray-800"
            >
              <option value="BTP">🏗️ BTP, Infrastructures & Génie Civil</option>
              <option value="SANTE">⚕️ Santé, Équipements Médicaux & Pharma</option>
              <option value="INFORMATIQUE">💻 Informatique & Numérique</option>
              <option value="AUTRE">📄 Autre (Générique)</option>
            </select>
          </div>
          <button
            onClick={handleGenerate}
            disabled={isGenerating || !sujet}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            {isGenerating ? 'Analyse sectorielle... ⏳' : '✨ Générer le Dossier Technique'}
          </button>
        </div>
      </div>

      {result && (
        <div className="bg-white p-6 rounded-xl border border-green-200 shadow-sm relative">
          <div className="absolute top-4 right-4 space-x-2">
            <button className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded font-medium">Copier pour Word</button>
          </div>
          <h3 className="text-sm font-bold text-green-700 uppercase mb-4">Cahier des Prescriptions Techniques Généré</h3>
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

