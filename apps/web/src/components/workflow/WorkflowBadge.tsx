import { cn } from '@marchepublic/ui'
import { getPhaseLabel, phaseNumber, type TenderPhase } from '@marchepublic/workflow'

const COLORS: Record<number, string> = {
  1: 'bg-slate-100 text-slate-700', 2: 'bg-slate-100 text-slate-700',
  3: 'bg-yellow-100 text-yellow-800',
  4: 'bg-blue-100 text-blue-800', 5: 'bg-blue-100 text-blue-800', 6: 'bg-blue-100 text-blue-800',
  7: 'bg-purple-100 text-purple-800', 8: 'bg-purple-100 text-purple-800',
  9: 'bg-green-100 text-green-800',
  10: 'border border-red-300 bg-red-100 font-bold text-red-800',
  11: 'bg-green-100 text-green-800',
  12: 'bg-teal-100 text-teal-800', 13: 'bg-teal-100 text-teal-800', 14: 'bg-teal-100 text-teal-800',
  15: 'bg-gray-200 text-gray-500',
}

export function WorkflowBadge({ phase, className }: { phase: TenderPhase; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', COLORS[phaseNumber(phase)] ?? 'bg-gray-100 text-gray-800', className)}>
      {getPhaseLabel(phase)}
    </span>
  )
}

/** Frise des 15 phases ; la phase courante est mise en évidence. */
export function PhaseStepper({ phase }: { phase: TenderPhase }) {
  const current = phaseNumber(phase)
  return (
    <ol className="flex flex-wrap gap-1.5" aria-label="Progression du marché">
      {Array.from({ length: 15 }, (_, i) => i + 1).map(n => (
        <li key={n} aria-current={n === current ? 'step' : undefined}
          className={cn('flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold',
            n < current ? 'bg-green-600 text-white' : n === current ? 'bg-green-900 text-white ring-2 ring-green-300' : 'bg-gray-200 text-gray-500')}>
          {n}
        </li>
      ))}
    </ol>
  )
}
