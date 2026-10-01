'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { saveDocument } from '@/app/dashboard/actions/passation'

export interface Section { id: string; titre: string; contenu: string; obligatoire?: boolean }
export interface ClauseOption { code: string; titre: string; contenu: string; obligatoire: boolean }

const area = 'mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-green-600 focus:outline-none focus:ring-1 focus:ring-green-600 disabled:bg-gray-50'

/** Éditeur de sections d'un TDR / DAO avec insertion de clauses types. Chaque enregistrement crée une version immuable. */
export function DocumentEditor({ documentId, initial, clauses, readOnly }: {
  documentId: string
  initial: Section[]
  clauses: ClauseOption[]
  readOnly: boolean
}) {
  const router = useRouter()
  const [sections, setSections] = useState<Section[]>(initial)
  const [pending, start] = useTransition()
  const [dirty, setDirty] = useState(false)

  const update = (i: number, patch: Partial<Section>) => { setSections(s => s.map((x, j) => (j === i ? { ...x, ...patch } : x))); setDirty(true) }
  const remove = (i: number) => { setSections(s => s.filter((_, j) => j !== i)); setDirty(true) }
  const addClause = (code: string) => {
    const c = clauses.find(x => x.code === code)
    if (!c) return
    if (sections.some(s => s.id === `clause-${c.code}`)) return void toast.info('Clause déjà insérée')
    setSections(s => [...s, { id: `clause-${c.code}`, titre: c.titre, contenu: c.contenu, obligatoire: c.obligatoire }])
    setDirty(true)
  }
  const missingMandatory = clauses.filter(c => c.obligatoire && !sections.some(s => s.id === `clause-${c.code}`))

  const save = () => start(async () => {
    const res = await saveDocument(documentId, sections)
    if (res.ok) { toast.success(res.message); setDirty(false); router.refresh() } else toast.error(res.message)
  })

  return (
    <div className="space-y-4">
      {sections.map((s, i) => (
        <div key={s.id} className="rounded-lg border border-gray-200 p-3">
          <div className="flex items-center gap-2">
            <input value={s.titre} disabled={readOnly} onChange={e => update(i, { titre: e.target.value })} aria-label={`Titre de la section ${i + 1}`}
              className={`${area} mt-0 font-semibold`} />
            {!readOnly && !s.obligatoire && (
              <button type="button" onClick={() => remove(i)} className="rounded border border-gray-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50">Supprimer</button>
            )}
          </div>
          <textarea value={s.contenu} disabled={readOnly} rows={5} onChange={e => update(i, { contenu: e.target.value })} aria-label={`Contenu de la section ${i + 1}`} className={area} />
        </div>
      ))}

      {!readOnly && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <select onChange={e => { addClause(e.target.value); e.target.value = '' }} defaultValue="" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" aria-label="Insérer une clause type">
              <option value="">+ Insérer une clause type…</option>
              {clauses.map(c => <option key={c.code} value={c.code}>{c.obligatoire ? '★ ' : ''}{c.titre}</option>)}
            </select>
            <button type="button" onClick={() => { setSections(s => [...s, { id: `s-${Date.now()}`, titre: 'Nouvelle section', contenu: '' }]); setDirty(true) }}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50">+ Section libre</button>
            <button type="button" disabled={pending || !dirty} onClick={save}
              className="rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50">
              {pending ? 'Enregistrement…' : 'Enregistrer une nouvelle version'}
            </button>
            {dirty && <span className="text-xs text-amber-700">Modifications non enregistrées</span>}
          </div>
          {missingMandatory.length > 0 && (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              Clauses obligatoires non encore insérées : {missingMandatory.map(c => c.titre).join(' · ')}.
            </p>
          )}
        </>
      )}
    </div>
  )
}
