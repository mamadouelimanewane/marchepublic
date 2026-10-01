const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })

export function fcfa(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  return `${nf.format(Number(value))} FCFA`
}

export function dateFr(value: string | Date | null | undefined, withTime = false): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('fr-FR', withTime
    ? { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Dakar' }
    : { dateStyle: 'medium', timeZone: 'Africa/Dakar' })
}

export function pct(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return `${Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`
}

/** Valeur d'un <input type="datetime-local"> (heure de Dakar = UTC, pas de changement d'heure) vers ISO. */
export function datetimeLocalToIso(value: string): string {
  return new Date(value + (value.length === 16 ? ':00Z' : 'Z')).toISOString()
}

export function isoToDatetimeLocal(value: string | null | undefined): string {
  return value ? new Date(value).toISOString().slice(0, 16) : ''
}
