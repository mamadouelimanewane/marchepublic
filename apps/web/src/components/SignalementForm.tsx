'use client'

import { useState, useTransition } from 'react'
import { checkReportStatus, submitCitizenReport, type ReportResult } from '@/app/signalement/actions'

const field = 'mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-green-600 focus:outline-none focus:ring-1 focus:ring-green-600'

const CATEGORIES = [
  ['CORRUPTION', 'Corruption ou pot-de-vin'], ['FAVORITISME', 'Favoritisme / dossier taillé sur mesure'], ['CONFLIT_INTERETS', "Conflit d'intérêts"],
  ['EXECUTION_NON_CONFORME', 'Exécution non conforme du marché'], ['ACCES_ENTRAVE', "Accès à l'appel d'offres entravé"], ['AUTRE', 'Autre'],
]

export function SignalementForm({ defaultReference }: { defaultReference?: string }) {
  const [pending, start] = useTransition()
  const [result, setResult] = useState<ReportResult | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  return (
    <div className="space-y-8">
      <form
        className="space-y-4 rounded-xl border border-gray-200 bg-white p-6"
        onSubmit={e => {
          e.preventDefault()
          const form = e.currentTarget
          const data = new FormData(form)
          start(async () => { const r = await submitCitizenReport(data); setResult(r); if (r.ok) form.reset() })
        }}
      >
        <label className="block text-sm font-medium text-gray-700">Référence du marché (si vous la connaissez)
          <input name="reference" defaultValue={defaultReference} placeholder="MP-…-2026-0001" className={field} />
        </label>
        <label className="block text-sm font-medium text-gray-700">Nature du problème
          <select name="categorie" required className={field} defaultValue="">
            <option value="" disabled>Choisir…</option>
            {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium text-gray-700">Que s&apos;est-il passé ?
          <textarea name="description" required minLength={30} rows={6} className={field} placeholder="Faits précis, dates, personnes ou entreprises concernées. Ne joignez aucune donnée personnelle inutile." />
        </label>
        <label className="block text-sm font-medium text-gray-700">Contact (facultatif)
          <input name="contact" className={field} placeholder="E-mail ou téléphone, uniquement si vous acceptez d'être recontacté" />
        </label>
        <input name="site_web" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
        <button disabled={pending} className="rounded-lg bg-green-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50">
          {pending ? 'Envoi…' : 'Envoyer le signalement'}
        </button>
        {result && (
          <p role="status" className={`rounded-lg p-3 text-sm ${result.ok ? 'bg-green-50 text-green-900' : 'bg-red-50 text-red-900'}`}>
            {result.message}
            {result.code && <> <strong>Conservez ce code pour suivre votre signalement : <code className="text-base">{result.code}</code></strong></>}
          </p>
        )}
      </form>

      <form
        className="space-y-3 rounded-xl border border-gray-200 bg-white p-6"
        onSubmit={e => { e.preventDefault(); const data = new FormData(e.currentTarget); start(async () => setStatus((await checkReportStatus(data)).message)) }}
      >
        <h2 className="text-base font-semibold text-gray-800">Suivre un signalement</h2>
        <div className="flex gap-3">
          <input name="code" placeholder="Code de suivi (10 caractères)" aria-label="Code de suivi" className={field} />
          <button disabled={pending} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-gray-50">Vérifier</button>
        </div>
        {status && <p role="status" className="text-sm text-gray-700">{status}</p>}
      </form>
    </div>
  )
}
