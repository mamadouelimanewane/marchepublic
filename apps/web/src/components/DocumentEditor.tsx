'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  blockingIssues, guideFor, lintDocument, mergeVariables, qualityScore, unknownVariables,
  type ClauseRef, type DocSection, type Issue, type VariableValues,
} from '@marchepublic/workflow'
import { saveDocument } from '@/app/dashboard/actions/passation'
import { draftSection, reviewDocument } from '@/app/dashboard/actions/assistant'

export type Section = DocSection
export interface ClauseOption extends ClauseRef { contenu: string }

const area = 'mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-green-600 focus:outline-none focus:ring-1 focus:ring-green-600 disabled:bg-gray-50'
const TONE = { BLOQUANT: 'border-red-200 bg-red-50 text-red-900', AVERTISSEMENT: 'border-amber-200 bg-amber-50 text-amber-900', CONSEIL: 'border-blue-200 bg-blue-50 text-blue-900' } as const
const LABEL = { BLOQUANT: 'Bloquant', AVERTISSEMENT: 'À corriger', CONSEIL: 'Conseil' } as const

/** Éditeur de sections d'un TDR / DAO : guide par section, variables de fusion, clauses types, contrôle qualité en direct
 *  et assistant IA (proposition de rédaction et relecture). Chaque enregistrement crée une version immuable ; les problèmes
 *  « bloquants » empêchent la validation par le PRM (règle appliquée en base). L'IA ne propose que : rien n'est enregistré sans l'agent. */
export function DocumentEditor({ documentId, type, nature, ligneBudgetaire, initial, clauses, variables, readOnly, ai }: {
  documentId: string
  type: 'TDR' | 'DAO'
  nature: string
  ligneBudgetaire: string | null
  initial: Section[]
  clauses: ClauseOption[]
  variables: VariableValues
  readOnly: boolean
  /** Assistant IA : activé si une clé est configurée côté serveur ; `remaining` = requêtes restantes sur 24 h. */
  ai?: { enabled: boolean; remaining: number | null }
}) {
  const router = useRouter()
  const [sections, setSections] = useState<Section[]>(initial)
  const [open, setOpen] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const [dirty, setDirty] = useState(false)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [draft, setDraft] = useState<{ id: string; texte: string } | null>(null)
  const [avis, setAvis] = useState<string | null>(null)
  const [aiBusy, setAiBusy] = useState<string | null>(null)
  const aiOn = Boolean(ai?.enabled) && !readOnly

  const issues = useMemo(() => lintDocument(sections, { type, nature, clauses, ligneBudgetaire }), [sections, type, nature, clauses, ligneBudgetaire])
  const score = qualityScore(issues)
  const blocking = blockingIssues(issues).length
  const bySection = (id: string) => issues.filter(i => i.sectionId === id)
  const hasUnmerged = sections.some(s => /\{\{/.test(s.contenu + s.titre))

  const update = (i: number, patch: Partial<Section>) => { setSections(s => s.map((x, j) => (j === i ? { ...x, ...patch } : x))); setDirty(true) }
  const remove = (i: number) => { setSections(s => s.filter((_, j) => j !== i)); setDirty(true) }
  const addClause = (code: string) => {
    const c = clauses.find(x => x.code === code)
    if (!c) return
    if (sections.some(s => s.id === `clause-${c.code}`)) return void toast.info('Clause déjà insérée')
    setSections(s => [...s, { id: `clause-${c.code}`, titre: c.titre, contenu: c.contenu, obligatoire: c.obligatoire }])
    setDirty(true)
  }
  const missingClauses = issues.filter(i => i.code === 'MISSING_CLAUSE')
  const insertMissingClauses = () => {
    const present = new Set(sections.map(s => s.id))
    const toAdd = clauses.filter(c => c.obligatoire && (!c.natures?.length || c.natures.includes(nature)) && !present.has(`clause-${c.code}`))
    setSections(s => [...s, ...toAdd.map(c => ({ id: `clause-${c.code}`, titre: c.titre, contenu: c.contenu, obligatoire: c.obligatoire }))])
    setDirty(true)
    toast.success(`${toAdd.length} clause(s) obligatoire(s) insérée(s) : complétez les montants et délais entre crochets.`)
  }
  const mergeAll = () => {
    setSections(s => s.map(x => ({ ...x, titre: mergeVariables(x.titre, variables), contenu: mergeVariables(x.contenu, variables) })))
    setDirty(true)
    toast.success('Variables remplacées par les données du marché')
  }
  const insertExample = (i: number, example: string) => update(i, { contenu: (sections[i].contenu.trim() ? sections[i].contenu.trimEnd() + '\n\n' : '') + mergeVariables(example, variables) })

  const askDraft = async (i: number) => {
    const s = sections[i]
    setAiBusy(s.id)
    const res = await draftSection(documentId, { sectionId: s.id, titre: s.titre, consigne: s.consigne, contenuActuel: s.contenu, notes: notes[s.id] })
    setAiBusy(null)
    if (res.ok && res.data) setDraft({ id: s.id, texte: res.data.texte }); else toast.error(res.message)
  }
  const useDraft = (i: number, mode: 'replace' | 'append') => {
    if (!draft) return
    update(i, { contenu: mode === 'replace' || !sections[i].contenu.trim() ? draft.texte : sections[i].contenu.trimEnd() + '\n\n' + draft.texte })
    setDraft(null)
    toast.info('Texte inséré : relisez-le, complétez les [●] puis enregistrez.')
  }
  const askReview = async () => {
    setAiBusy('review')
    const res = await reviewDocument(documentId, sections)
    setAiBusy(null)
    if (res.ok && res.data) setAvis(res.data.avis); else toast.error(res.message)
  }

  const save = () => start(async () => {
    const res = await saveDocument(documentId, sections)
    if (res.ok) { toast.success(res.message); setDirty(false); router.refresh() } else toast.error(res.message)
  })

  return (
    <div className="space-y-4">
      <div className={`rounded-lg border p-3 text-sm ${blocking ? TONE.BLOQUANT : issues.length ? TONE.AVERTISSEMENT : 'border-green-200 bg-green-50 text-green-900'}`} role="status" aria-live="polite">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <strong>Contrôle qualité : {score}/100 — {blocking ? `${blocking} point(s) bloquant(s) pour la validation PRM` : 'aucun point bloquant'}</strong>
          <span className="flex gap-2">
            {aiOn && <button type="button" disabled={aiBusy !== null} onClick={askReview} className="rounded border border-current px-2 py-1 text-xs font-medium disabled:opacity-50">{aiBusy === 'review' ? 'Relecture…' : 'Relecture IA'}</button>}
            {!readOnly && hasUnmerged && <button type="button" onClick={mergeAll} className="rounded border border-current px-2 py-1 text-xs font-medium">Remplir les variables</button>}
            {!readOnly && missingClauses.length > 0 && <button type="button" onClick={insertMissingClauses} className="rounded border border-current px-2 py-1 text-xs font-medium">Insérer les clauses obligatoires</button>}
          </span>
        </div>
        {avis && (
          <div className="mt-2 rounded border border-purple-200 bg-purple-50 p-2 text-xs text-purple-950">
            <div className="flex items-center justify-between"><strong>Relecture IA (avis indicatif, à vérifier)</strong><button type="button" onClick={() => setAvis(null)} className="underline">Fermer</button></div>
            <pre className="mt-1 whitespace-pre-wrap font-sans">{avis}</pre>
          </div>
        )}
        {issues.length > 0 && (
          <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-xs">
            {issues.map((i, k) => <IssueRow key={k} issue={i} />)}
          </ul>
        )}
      </div>

      {sections.map((s, i) => {
        const g = guideFor(s.id)
        const mine = bySection(s.id)
        const stillVars = unknownVariables(s.contenu + s.titre)
        return (
          <div key={s.id} className={`rounded-lg border p-3 ${mine.some(m => m.severity === 'BLOQUANT') ? 'border-red-300' : 'border-gray-200'}`}>
            <div className="flex items-center gap-2">
              <input value={s.titre} disabled={readOnly} onChange={e => update(i, { titre: e.target.value })} aria-label={`Titre de la section ${i + 1}`} className={`${area} mt-0 font-semibold`} />
              {g && <button type="button" onClick={() => setOpen(open === s.id ? null : s.id)} aria-expanded={open === s.id} className="shrink-0 rounded border border-gray-300 px-2 py-1 text-xs text-green-800 hover:bg-green-50">Aide</button>}
              {!readOnly && !s.obligatoire && (
                <button type="button" onClick={() => remove(i)} className="rounded border border-gray-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50">Supprimer</button>
              )}
            </div>
            {s.consigne && !s.contenu.trim() && <p className="mt-1 text-xs italic text-gray-500">Consigne : {s.consigne}</p>}
            {open === s.id && g && (
              <div className="mt-2 space-y-2 rounded-lg bg-green-50 p-3 text-xs text-green-950">
                <p><strong>Objectif.</strong> {g.objectif}</p>
                <div><strong>À couvrir :</strong><ul className="ml-4 list-disc">{g.points.map(p => <li key={p}>{p}</li>)}</ul></div>
                <div><strong>Exemple de formulation :</strong><p className="mt-1 rounded bg-white p-2 italic">{g.exemple}</p>
                  {!readOnly && <button type="button" onClick={() => insertExample(i, g.exemple)} className="mt-1 rounded border border-green-700 px-2 py-1 font-medium text-green-800 hover:bg-white">Insérer cet exemple</button>}</div>
                <div><strong>Erreurs fréquentes :</strong><ul className="ml-4 list-disc text-red-900">{g.erreurs.map(p => <li key={p}>{p}</li>)}</ul></div>
              </div>
            )}
            {aiOn && (
              <div className="mt-2 rounded-lg border border-purple-200 bg-purple-50 p-2 text-xs text-purple-950">
                <div className="flex flex-wrap items-end gap-2">
                  <label className="min-w-[14rem] flex-1">Précisions pour l&apos;assistant (facultatif)
                    <input value={notes[s.id] ?? ''} maxLength={2000} onChange={e => setNotes(n => ({ ...n, [s.id]: e.target.value }))}
                      placeholder="ex. 6 sites, livraison avant décembre, formation des agents" className={`${area} mt-0.5 text-xs`} />
                  </label>
                  <button type="button" disabled={aiBusy !== null} onClick={() => askDraft(i)} className="rounded bg-purple-700 px-3 py-2 font-semibold text-white hover:bg-purple-800 disabled:opacity-50">
                    {aiBusy === s.id ? 'Rédaction…' : s.contenu.trim() ? 'Améliorer avec l’IA' : 'Rédiger avec l’IA'}
                  </button>
                </div>
                {draft?.id === s.id && (
                  <div className="mt-2 space-y-2">
                    <p className="font-medium">Proposition de l&apos;IA, à relire : elle peut se tromper et ne remplace pas votre expertise.</p>
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-white p-2 font-sans text-gray-900">{draft.texte}</pre>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => useDraft(i, 'replace')} className="rounded border border-purple-700 px-2 py-1 font-medium hover:bg-white">Remplacer le contenu</button>
                      <button type="button" onClick={() => useDraft(i, 'append')} className="rounded border border-purple-700 px-2 py-1 font-medium hover:bg-white">Ajouter à la suite</button>
                      <button type="button" onClick={() => setDraft(null)} className="rounded border border-gray-400 px-2 py-1 hover:bg-white">Rejeter</button>
                    </div>
                  </div>
                )}
              </div>
            )}
            <textarea value={s.contenu} disabled={readOnly} rows={s.contenu.length > 400 ? 9 : 5} onChange={e => update(i, { contenu: e.target.value })} aria-label={`Contenu de la section ${i + 1}`}
              placeholder={s.consigne} className={area} />
            {stillVars.length > 0 && <p className="mt-1 text-xs text-red-700">Variable inconnue : {stillVars.map(v => `{{${v}}}`).join(', ')}</p>}
            {mine.length > 0 && <ul className="mt-2 space-y-1 text-xs">{mine.map((m, k) => <IssueRow key={k} issue={m} />)}</ul>}
          </div>
        )
      })}

      {aiOn && (
        <p className="text-xs text-gray-500">
          Assistant IA : l&apos;intitulé, le montant estimé, le besoin et le texte de la section sont transmis au service d&apos;IA pour produire la proposition ; aucune offre ni donnée de candidat n&apos;est concernée.
          {ai?.remaining != null && ` Requêtes restantes sur 24 h : ${ai.remaining}.`}
        </p>
      )}
      {!readOnly && (
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
      )}
    </div>
  )
}

function IssueRow({ issue }: { issue: Issue }) {
  return <li className={`rounded border px-2 py-1 ${TONE[issue.severity]}`}><strong>{LABEL[issue.severity]} · </strong>{issue.message}</li>
}
