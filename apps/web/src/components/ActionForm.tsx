'use client'

import { useRef, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { cn } from '@marchepublic/ui'
import type { ActionResult } from '@/lib/errors'

const primary = 'inline-flex items-center justify-center rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-50'
const secondary = 'inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50'
const danger = 'inline-flex items-center justify-center rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50'

type Variant = 'primary' | 'secondary' | 'danger'
const VARIANTS: Record<Variant, string> = { primary, secondary, danger }

function useRun() {
  const router = useRouter()
  const [pending, start] = useTransition()
  const run = (fn: () => Promise<ActionResult>, onOk?: (res: ActionResult) => void) =>
    start(async () => {
      try {
        const res = await fn()
        if (res.ok) { toast.success(res.message); onOk?.(res); router.refresh() }
        else toast.error(res.message)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Erreur inattendue')
      }
    })
  return { pending, run }
}

/** Formulaire relié à une server action : validation côté serveur, retour par toast, rafraîchissement des données. */
export function ActionForm({ action, children, submitLabel = 'Enregistrer', variant = 'primary', className, reset = true, confirm, redirectPattern }: {
  action: (formData: FormData) => Promise<ActionResult>
  children: ReactNode
  submitLabel?: string
  variant?: Variant
  className?: string
  reset?: boolean
  confirm?: string
  /** Ex. « /dashboard/marches/{id} » : `{id}` est remplacé par `data.id` renvoyé par l'action. */
  redirectPattern?: string
}) {
  const router = useRouter()
  const ref = useRef<HTMLFormElement>(null)
  const { pending, run } = useRun()
  return (
    <form
      ref={ref}
      className={cn('space-y-4', className)}
      onSubmit={e => {
        e.preventDefault()
        if (confirm && !window.confirm(confirm)) return
        const data = new FormData(e.currentTarget)
        run(() => action(data), res => {
          if (reset) ref.current?.reset()
          const id = (res.data as { id?: string } | undefined)?.id
          if (redirectPattern && id) router.push(redirectPattern.replace('{id}', id))
        })
      }}
    >
      {children}
      <button type="submit" disabled={pending} className={VARIANTS[variant]}>{pending ? 'Traitement…' : submitLabel}</button>
    </form>
  )
}

/** Bouton d'action sans champ (ex. avancer d'une phase) — `action` est une server action déjà liée à ses arguments. */
export function ActionButton({ action, label, variant = 'primary', confirm, disabled, title, className }: {
  action: () => Promise<ActionResult>
  label: string
  variant?: Variant
  confirm?: string
  disabled?: boolean
  title?: string
  className?: string
}) {
  const { pending, run } = useRun()
  return (
    <button
      type="button"
      disabled={pending || disabled}
      title={title}
      className={cn(VARIANTS[variant], className)}
      onClick={() => { if (confirm && !window.confirm(confirm)) return; run(action) }}
    >
      {pending ? 'Traitement…' : label}
    </button>
  )
}
