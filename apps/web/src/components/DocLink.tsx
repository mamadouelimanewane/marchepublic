'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import { supplierDocumentUrl } from '@/app/dashboard/actions/fournisseur'

/** Ouvre une pièce via un lien signé de 5 minutes. */
export function DocLink({ docId, label = 'Ouvrir' }: { docId: string; label?: string }) {
  const [pending, start] = useTransition()
  return (
    <button type="button" disabled={pending} className="text-sm font-medium text-green-700 hover:underline disabled:opacity-50"
      onClick={() => start(async () => { const r = await supplierDocumentUrl(docId); if (r.ok && r.data) window.open(r.data.url, '_blank', 'noopener'); else toast.error(r.message) })}>
      {pending ? '…' : label}
    </button>
  )
}
