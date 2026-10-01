'use client'

export function PrintButton({ label = 'Imprimer / enregistrer en PDF' }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
      {label}
    </button>
  )
}
