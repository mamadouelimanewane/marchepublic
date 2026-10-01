'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { round2, scoreTechnique, validerGrille } from '@marchepublic/workflow'
import { saveEvaluation } from '@/app/dashboard/actions/passation'

interface Critere { critere: string; ponderation: number }

/** Grille de notation d'un évaluateur pour une offre. Le score affiché est un aperçu : le serveur le recalcule. */
export function EvaluationGrid({ tenderId, bidId, criteres, initialNotes, disabled }: {
  tenderId: string
  bidId: string
  criteres: Critere[]
  initialNotes?: Record<string, number>
  disabled?: boolean
}) {
  const router = useRouter()
  const [notes, setNotes] = useState<Record<string, number>>(() => Object.fromEntries(criteres.map(c => [c.critere, initialNotes?.[c.critere] ?? 0])))
  const [pending, start] = useTransition()
  const grille = criteres.map(c => ({ ...c, note: Number(notes[c.critere] ?? 0) }))
  const errors = validerGrille(grille, criteres)
  const score = scoreTechnique(grille)

  const save = () => start(async () => {
    const res = await saveEvaluation(tenderId, bidId, grille)
    if (res.ok) { toast.success(res.message); router.refresh() } else toast.error(res.message)
  })

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        {criteres.map(c => (
          <label key={c.critere} className="flex items-center justify-between gap-3 rounded bg-gray-50 px-3 py-1.5 text-sm">
            <span>{c.critere} <span className="text-xs text-gray-400">(/{c.ponderation})</span></span>
            <input type="number" min={0} max={c.ponderation} step="0.5" value={notes[c.critere]} disabled={disabled}
              onChange={e => setNotes(n => ({ ...n, [c.critere]: Number(e.target.value) }))}
              className="w-20 rounded border border-gray-300 px-2 py-1 text-right" aria-label={`Note ${c.critere}`} />
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold text-gray-700">Total : {round2(score)} / 100</span>
        {errors.length > 0 && <span className="text-xs text-red-700">{errors[0]}</span>}
        {!disabled && <button type="button" onClick={save} disabled={pending || errors.length > 0}
          className="rounded-lg bg-green-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50">{pending ? 'Enregistrement…' : 'Enregistrer ma notation'}</button>}
      </div>
    </div>
  )
}
