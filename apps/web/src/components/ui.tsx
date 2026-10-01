import type { ReactNode } from 'react'
import { cn } from '@marchepublic/ui'

// Composants de présentation (compatibles Server Components). Palette : vert institutionnel + tons sémantiques.

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-gray-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Card({ title, subtitle, actions, children, className, padded = true }: {
  title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean
}) {
  return (
    <section className={cn('rounded-xl border border-gray-200 bg-white shadow-sm', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-5 py-3">
          <div>
            {title && <h2 className="text-base font-semibold text-gray-800">{title}</h2>}
            {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={padded ? 'p-5' : ''}>{children}</div>
    </section>
  )
}

type Tone = 'gray' | 'green' | 'red' | 'amber' | 'blue' | 'purple' | 'teal'
const TONES: Record<Tone, string> = {
  gray: 'bg-gray-100 text-gray-700',
  green: 'bg-green-100 text-green-800',
  red: 'bg-red-100 text-red-800',
  amber: 'bg-amber-100 text-amber-800',
  blue: 'bg-blue-100 text-blue-800',
  purple: 'bg-purple-100 text-purple-800',
  teal: 'bg-teal-100 text-teal-800',
}

export function Badge({ tone = 'gray', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', TONES[tone], className)}>{children}</span>
}

export function Stat({ label, value, hint, tone = 'gray' }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone }) {
  const color = tone === 'red' ? 'text-red-600' : tone === 'green' ? 'text-green-700' : tone === 'amber' ? 'text-amber-600' : 'text-gray-900'
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <p className={cn('mt-1 text-3xl font-bold', color)}>{value}</p>
      {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
  )
}

export function Alert({ tone = 'blue', title, children }: { tone?: 'blue' | 'red' | 'amber' | 'green'; title?: string; children: ReactNode }) {
  const styles = {
    blue: 'border-blue-200 bg-blue-50 text-blue-900',
    red: 'border-red-200 bg-red-50 text-red-900',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    green: 'border-green-200 bg-green-50 text-green-900',
  }[tone]
  return (
    <div role={tone === 'red' ? 'alert' : 'status'} className={cn('rounded-lg border p-4 text-sm', styles)}>
      {title && <p className="mb-1 font-semibold">{title}</p>}
      {children}
    </div>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="px-6 py-10 text-center text-sm text-gray-500">{children}</div>
}

export interface Column<T> { header: string; cell: (row: T) => ReactNode; className?: string }

export function DataTable<T>({ columns, rows, empty = 'Aucune donnée.', rowKey }: {
  columns: Column<T>[]; rows: T[] | null | undefined; empty?: ReactNode; rowKey: (row: T) => string
}) {
  if (!rows?.length) return <EmptyState>{empty}</EmptyState>
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            {columns.map(c => (
              <th key={c.header} scope="col" className={cn('px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500', c.className)}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map(row => (
            <tr key={rowKey(row)} className="hover:bg-gray-50">
              {columns.map(c => <td key={c.header} className={cn('px-4 py-2.5 align-top text-gray-700', c.className)}>{c.cell(row)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const inputClass = 'mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-green-600 focus:outline-none focus:ring-1 focus:ring-green-600 disabled:bg-gray-100'

export function Field({ label, name, type = 'text', required, defaultValue, options, hint, rows, placeholder, min, max, step, disabled, className }: {
  label: string; name: string; type?: string; required?: boolean; defaultValue?: string | number | null
  options?: { value: string; label: string }[]; hint?: string; rows?: number; placeholder?: string
  min?: number | string; max?: number | string; step?: number | string; disabled?: boolean; className?: string
}) {
  const id = `f-${name}`
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700">
        {label}{required && <span className="text-red-600"> *</span>}
      </label>
      {options ? (
        <select id={id} name={name} required={required} defaultValue={defaultValue ?? ''} disabled={disabled} className={inputClass}>
          {!required && <option value="">—</option>}
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : rows ? (
        <textarea id={id} name={name} required={required} defaultValue={defaultValue ?? ''} rows={rows} placeholder={placeholder} disabled={disabled} className={inputClass} />
      ) : (
        <input id={id} name={name} type={type} required={required} defaultValue={defaultValue ?? ''} placeholder={placeholder}
               min={min} max={max} step={step} disabled={disabled} className={inputClass} />
      )}
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  )
}

export function Grid({ cols = 2, children }: { cols?: 1 | 2 | 3 | 4; children: ReactNode }) {
  const c = { 1: 'grid-cols-1', 2: 'grid-cols-1 md:grid-cols-2', 3: 'grid-cols-1 md:grid-cols-3', 4: 'grid-cols-2 md:grid-cols-4' }[cols]
  return <div className={cn('grid gap-4', c)}>{children}</div>
}

export function DefinitionList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(i => (
        <div key={i.label}>
          <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">{i.label}</dt>
          <dd className="mt-0.5 text-sm text-gray-900">{i.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  )
}
