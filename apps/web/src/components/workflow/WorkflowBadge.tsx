import { cn } from '@marchepublic/ui'
import { getPhaseLabel, TenderPhase } from '@marchepublic/workflow'

interface WorkflowBadgeProps {
  phase: TenderPhase
  className?: string
}

export function WorkflowBadge({ phase, className }: WorkflowBadgeProps) {
  let colorClass = 'bg-gray-100 text-gray-800' // defaut

  switch (phase) {
    case 'PHASE_1_PROGRAMMATION':
    case 'PHASE_2_REDACTION':
      colorClass = 'bg-slate-100 text-slate-700'
      break
    case 'PHASE_3_VALIDATION_PRIORI':
      colorClass = 'bg-yellow-100 text-yellow-800'
      break
    case 'PHASE_4_PUBLICATION':
    case 'PHASE_5_CLARIFICATIONS':
    case 'PHASE_6_DEPOT_OFFRES':
      colorClass = 'bg-blue-100 text-blue-800'
      break
    case 'PHASE_7_OUVERTURE_PLIS':
    case 'PHASE_8_EVALUATION':
      colorClass = 'bg-purple-100 text-purple-800'
      break
    case 'PHASE_9_ATTRIBUTION_PROVISOIRE':
    case 'PHASE_11_ATTRIBUTION_DEFINITIVE':
      colorClass = 'bg-green-100 text-green-800'
      break
    case 'PHASE_10_RECOURS':
      colorClass = 'bg-red-100 text-red-800 border border-red-300 font-bold'
      break
    case 'PHASE_12_SIGNATURE_CONTRAT':
    case 'PHASE_13_EXECUTION':
    case 'PHASE_14_RECEPTION_PAIEMENT':
      colorClass = 'bg-teal-100 text-teal-800'
      break
    case 'PHASE_15_CLOTURE_ARCHIVAGE':
      colorClass = 'bg-gray-200 text-gray-500'
      break
  }

  return (
    <span
      className={cn(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
        colorClass,
        className
      )}
    >
      {getPhaseLabel(phase)}
    </span>
  )
}
