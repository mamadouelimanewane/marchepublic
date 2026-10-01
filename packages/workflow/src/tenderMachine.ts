// ==========================================
// Machine à états XState v5 du cycle de vie (15 phases), GÉNÉRÉE depuis TRANSITIONS.
//
// Rôle : représentation côté client (aperçu, tests, futures interfaces temps réel). Elle ne détient aucune autorité :
//  - pas d'horloge interne (`now` est fourni par l'appelant, jamais `new Date()` dans une action) ;
//  - pas d'exception levée dans un garde (un garde renvoie false, l'interface affiche les pré-conditions manquantes) ;
//  - le contexte est un instantané de la ligne `tenders` ; la base valide et applique chaque transition.
// ==========================================
import { assign, createMachine } from 'xstate'
import { PHASES, PHASE_META, TRANSITIONS, getPhaseLabel, type TenderEventType, type TenderPhase } from './phases'
import { missingPreconditions, type TenderFacts } from './preconditions'

export interface TenderContext {
  tenderId: string
  institutionId: string
  facts: TenderFacts
  /** Horloge injectée (testabilité) ; mise à jour à chaque événement. */
  now: Date
}

export type TenderEvent =
  | { type: Exclude<TenderEventType, 'RECEVOIR_AVIS_DCMP' | 'DECISION_ARCOP'>; now?: Date; facts?: Partial<TenderFacts> }
  | { type: 'RECEVOIR_AVIS_DCMP'; avis: 'FAVORABLE' | 'DEFAVORABLE' | 'COMPLEMENTAIRE'; now?: Date; facts?: Partial<TenderFacts> }
  | { type: 'DECISION_ARCOP'; decision: 'REJETE' | 'IRRECEVABLE' | 'FAVORABLE' | 'PARTIELLEMENT_FAVORABLE'; now?: Date; facts?: Partial<TenderFacts> }

type States = Record<TenderPhase, Record<string, unknown>>

function buildStates(): States {
  const states = {} as States
  for (const phase of PHASES) {
    const on: Record<string, unknown[]> = {}
    for (const t of TRANSITIONS.filter(x => x.from === phase)) {
      const transition: Record<string, unknown> = {
        target: t.to,
        actions: assign(({ context, event }: { context: TenderContext; event: TenderEvent }) => ({
          now: event.now ?? context.now,
          facts: { ...context.facts, ...(event.facts ?? {}), phase: t.to },
        })),
        guard: ({ context, event }: { context: TenderContext; event: TenderEvent }) => {
          const facts = { ...context.facts, ...(event.facts ?? {}) }
          const now = event.now ?? context.now
          // Les avis défavorables/complémentaires renvoient en rédaction ; l'avis favorable avance.
          if (event.type === 'RECEVOIR_AVIS_DCMP') {
            return (event.avis === 'FAVORABLE') === (t.to === 'PHASE_4_PUBLICATION')
          }
          // Une décision ARCOP favorable rouvre l'évaluation ; rejet/irrecevabilité passent par CLORE_PERIODE_RECOURS.
          if (event.type === 'DECISION_ARCOP') {
            return event.decision === 'FAVORABLE' || event.decision === 'PARTIELLEMENT_FAVORABLE'
          }
          return missingPreconditions(t.event, facts, now).length === 0
        },
      }
      ;(on[t.event] ??= []).push(transition)
    }
    states[phase] = {
      meta: { ...PHASE_META[phase], label: PHASE_META[phase].label },
      ...(Object.keys(on).length ? { on } : { type: 'final' }),
    }
  }
  return states
}

export const tenderMachine = createMachine({
  id: 'tenderWorkflow',
  initial: 'PHASE_1_PROGRAMMATION',
  types: {} as { context: TenderContext; events: TenderEvent; input: Partial<TenderContext> },
  context: ({ input }) => ({
    tenderId: input.tenderId ?? '',
    institutionId: input.institutionId ?? '',
    facts: input.facts ?? { phase: 'PHASE_1_PROGRAMMATION' },
    now: input.now ?? new Date(0),
  }),
  states: buildStates() as never,
})
