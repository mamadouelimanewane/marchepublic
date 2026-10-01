'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { verifyAuditIntegrity } from '@/app/dashboard/actions/controle'

/** Recalcule la chaîne de hachage du journal d'audit côté base et signale toute altération. */
export function AuditVerify({ institutionId, institutions }: { institutionId: string | null; institutions: { id: string; name: string }[] }) {
  const [pending, start] = useTransition()
  const [target, setTarget] = useState<string>(institutionId ?? '')
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const run = () => start(async () => {
    const res = await verifyAuditIntegrity(target || null)
    setResult(res)
    if (res.ok) toast.success(res.message); else toast.error(res.message)
  })
  return (
    <div className="flex flex-wrap items-center gap-3">
      {institutions.length > 1 && (
        <select value={target} onChange={e => setTarget(e.target.value)} aria-label="Institution" className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
          <option value="">Journal global (hors institution)</option>
          {institutions.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
      )}
      <button type="button" onClick={run} disabled={pending} className="rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50">
        {pending ? 'Vérification…' : 'Vérifier l\'intégrité (chaîne et empreintes publiées)'}
      </button>
      {result && <span role="status" className={result.ok ? 'text-sm text-green-700' : 'text-sm font-semibold text-red-700'}>{result.message}</span>}
    </div>
  )
}
