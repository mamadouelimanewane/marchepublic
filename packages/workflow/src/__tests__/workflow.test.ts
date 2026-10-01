import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createActor } from 'xstate'
import { describe, expect, it } from 'vitest'
import {
  PHASES, TRANSITIONS, availableEvents, canAccessRoute, isLegalTransition, missingPreconditions, navFor, tenderMachine,
  ROLES, type Role, type TenderFacts, type TenderPhase,
} from '../index'

const migration = readFileSync(join(__dirname, '../../../../supabase/migrations/0010_workflow_engine.sql'), 'utf8')
const migration0003 = readFileSync(join(__dirname, '../../../../supabase/migrations/0003_tenders_workflow.sql'), 'utf8')

describe('parité TypeScript ↔ SQL', () => {
  it("les 15 phases de l'enum SQL sont exactement celles de PHASES, dans le même ordre", () => {
    const block = migration0003.match(/CREATE TYPE tender_phase AS ENUM \(([\s\S]*?)\);/)![1]
    const sql = [...block.matchAll(/'(PHASE_[A-Z0-9_]+)'/g)].map(m => m[1])
    expect(sql).toEqual([...PHASES])
  })

  it('la table phase_transitions du SQL et TRANSITIONS sont identiques (phases, événements, rôles, direct)', () => {
    const block = migration.match(/INSERT INTO phase_transitions[\s\S]*?;\n/)![0]
    const rows = [...block.matchAll(/\('(PHASE_\w+)', '(PHASE_\w+)', '(\w+)', ARRAY\[([^\]]*)\], (true|false)\)/g)].map(m => ({
      from: m[1], to: m[2], event: m[3],
      roles: [...m[4].matchAll(/'(\w+)'/g)].map(r => r[1]).sort(),
      direct: m[5] === 'true',
    }))
    const ts = TRANSITIONS.map(t => ({ from: t.from, to: t.to, event: t.event, roles: [...t.roles].sort(), direct: t.direct }))
    const key = (x: { from: string; to: string; event: string }) => `${x.from}>${x.to}>${x.event}`
    expect(rows.sort((a, b) => key(a).localeCompare(key(b)))).toEqual(ts.sort((a, b) => key(a).localeCompare(key(b))))
    expect(rows.length).toBe(17)
  })
})

describe('graphe des transitions', () => {
  it('toute phase sauf la dernière a une sortie ; la phase 15 est finale', () => {
    for (const p of PHASES.slice(0, -1)) expect(TRANSITIONS.some(t => t.from === p)).toBe(true)
    expect(TRANSITIONS.some(t => t.from === 'PHASE_15_CLOTURE_ARCHIVAGE')).toBe(false)
  })

  it('aucun saut de phase : seules les transitions déclarées sont légales', () => {
    expect(isLegalTransition('PHASE_10_RECOURS', 'PHASE_11_ATTRIBUTION_DEFINITIVE')).toBe(true)
    expect(isLegalTransition('PHASE_9_ATTRIBUTION_PROVISOIRE', 'PHASE_11_ATTRIBUTION_DEFINITIVE')).toBe(false)   // pas de contournement des recours
    expect(isLegalTransition('PHASE_5_CLARIFICATIONS', 'PHASE_7_OUVERTURE_PLIS')).toBe(false)
    expect(isLegalTransition('PHASE_10_RECOURS', 'PHASE_8_EVALUATION')).toBe(true)                               // recours favorable
  })

  it('actions proposées selon le rôle', () => {
    expect(availableEvents('PHASE_1_PROGRAMMATION', 'PRM').map(t => t.event)).toEqual(['VALIDER_PPM'])
    expect(availableEvents('PHASE_1_PROGRAMMATION', 'SOUMISSIONNAIRE')).toEqual([])
    expect(availableEvents('PHASE_3_VALIDATION_PRIORI', 'PRM')).toEqual([])                  // l'avis est l'affaire de la DCMP
    expect(availableEvents('PHASE_9_ATTRIBUTION_PROVISOIRE', 'CPM')).toEqual([])            // seul le PRM prononce l'attribution
  })
})

describe('pré-conditions affichées à l’utilisateur', () => {
  const now = new Date('2026-06-01T10:00:00Z')
  const base: TenderFacts = { phase: 'PHASE_10_RECOURS' }

  it('HARD LOCK recours : bloque clôture du délai, confirmation et signature', () => {
    const f = { ...base, hasAppealPending: true, dateFinRecours: '2026-05-01T00:00:00Z' }
    expect(missingPreconditions('CLORE_PERIODE_RECOURS', f, now).join(' ')).toMatch(/recours est pendant/)
    expect(missingPreconditions('CONFIRMER_ATTRIBUTION_DEFINITIVE', { ...f, approbationDcmp: true }, now).join(' ')).toMatch(/recours est pendant/)
    expect(missingPreconditions('SIGNER_CONTRAT', { ...f, contratSigneEtVise: true }, now).join(' ')).toMatch(/recours est pendant/)
    expect(missingPreconditions('CLORE_PERIODE_RECOURS', { ...base, dateFinRecours: '2026-05-01T00:00:00Z' }, now)).toEqual([])
  })

  it('le délai de recours doit être écoulé', () => {
    expect(missingPreconditions('CLORE_PERIODE_RECOURS', { ...base, dateFinRecours: '2026-06-05T00:00:00Z' }, now)[0]).toMatch(/court jusqu/)
  })

  it('dépôt : date limite, clé, délai minimal AOO de 30 jours', () => {
    const f: TenderFacts = { phase: 'PHASE_5_CLARIFICATIONS', modePassation: 'AOO', datePublication: '2026-06-01T00:00:00Z' }
    expect(missingPreconditions('OUVRIR_DEPOT', f, now).length).toBe(2)
    const court = { ...f, dateLimiteDepot: '2026-06-11T00:00:00Z', bidPublicKey: 'k' }
    expect(missingPreconditions('OUVRIR_DEPOT', court, now)[0]).toMatch(/Délai minimal/)
    expect(missingPreconditions('OUVRIR_DEPOT', { ...court, dateLimiteDepot: '2026-07-15T00:00:00Z' }, now)).toEqual([])
  })

  it('clôture du dépôt impossible avant la date limite', () => {
    expect(missingPreconditions('FERMER_DEPOT', { phase: 'PHASE_6_DEPOT_OFFRES', dateLimiteDepot: '2026-06-02T00:00:00Z' }, now).length).toBe(1)
    expect(missingPreconditions('FERMER_DEPOT', { phase: 'PHASE_6_DEPOT_OFFRES', dateLimiteDepot: '2026-05-31T00:00:00Z' }, now)).toEqual([])
  })

  it('transmission DCMP : TDR/DAO validé et critères Σ = 100', () => {
    const m = missingPreconditions('FINALISER_DAO', { phase: 'PHASE_2_REDACTION', modePassation: 'AOO', criteresTotal: 90 }, now)
    expect(m.length).toBe(2)
    expect(missingPreconditions('FINALISER_DAO', { phase: 'PHASE_2_REDACTION', modePassation: 'AOO', criteresTotal: 100, documentValide: true }, now)).toEqual([])
  })
})

describe('machine XState générée', () => {
  const run = (facts: Partial<TenderFacts> & { phase: TenderPhase }, now = new Date('2026-06-01T10:00:00Z')) => {
    const context = { tenderId: 't', institutionId: 'i', facts, now }
    const actor = createActor(tenderMachine, { input: {}, snapshot: tenderMachine.resolveState({ value: facts.phase, context }) })
    actor.start()
    return actor
  }

  it("l'avis DCMP favorable avance, défavorable renvoie en rédaction", () => {
    const a = run({ phase: 'PHASE_3_VALIDATION_PRIORI' })
    a.send({ type: 'RECEVOIR_AVIS_DCMP', avis: 'DEFAVORABLE' })
    expect(a.getSnapshot().value).toBe('PHASE_2_REDACTION')
    const b = run({ phase: 'PHASE_3_VALIDATION_PRIORI' })
    b.send({ type: 'RECEVOIR_AVIS_DCMP', avis: 'FAVORABLE' })
    expect(b.getSnapshot().value).toBe('PHASE_4_PUBLICATION')
  })

  it("une décision ARCOP favorable rouvre l'évaluation ; le HARD LOCK bloque la clôture du délai", () => {
    const a = run({ phase: 'PHASE_10_RECOURS', hasAppealPending: true, dateFinRecours: '2026-05-01T00:00:00Z' })
    a.send({ type: 'CLORE_PERIODE_RECOURS' })
    expect(a.getSnapshot().value).toBe('PHASE_10_RECOURS')
    a.send({ type: 'DECISION_ARCOP', decision: 'FAVORABLE' })
    expect(a.getSnapshot().value).toBe('PHASE_8_EVALUATION')
  })

  it('ne franchit pas une phase tant que les pré-conditions manquent, puis avance', () => {
    const a = run({ phase: 'PHASE_1_PROGRAMMATION', montantEstime: 0 })
    a.send({ type: 'VALIDER_PPM' })
    expect(a.getSnapshot().value).toBe('PHASE_1_PROGRAMMATION')
    a.send({ type: 'VALIDER_PPM', facts: { montantEstime: 80_000_000, ligneBudgetaire: '2.4.1', ppmAnnee: 2026, modePassation: 'AOO' } })
    expect(a.getSnapshot().value).toBe('PHASE_2_REDACTION')
  })

  it("n'utilise jamais l'horloge système : la date limite se juge sur `now` fourni", () => {
    const a = run({ phase: 'PHASE_1_PROGRAMMATION' })
    expect(a.getSnapshot().context.now.toISOString()).toBe('2026-06-01T10:00:00.000Z')
  })
})

describe('droits d’accès', () => {
  it("un soumissionnaire n'accède pas aux modules internes ; l'admin seul à l'administration", () => {
    expect(canAccessRoute('SOUMISSIONNAIRE', '/dashboard/admin')).toBe(false)
    expect(canAccessRoute('SOUMISSIONNAIRE', '/dashboard/programmation')).toBe(false)
    expect(canAccessRoute('SOUMISSIONNAIRE', '/dashboard/depot')).toBe(true)
    expect(canAccessRoute('PRM', '/dashboard/admin')).toBe(false)
    expect(canAccessRoute('ADMIN', '/dashboard/admin/users')).toBe(true)
  })

  it("régression : le soumissionnaire peut déposer un recours (l'ancien middleware réservait /recours à l'ARCOP)", () => {
    expect(canAccessRoute('SOUMISSIONNAIRE', '/dashboard/recours')).toBe(true)
  })

  it("chaque rôle dispose d'un menu cohérent, sans lien interdit", () => {
    for (const role of ROLES as readonly Role[]) {
      const nav = navFor(role)
      expect(nav.length).toBeGreaterThan(0)
      for (const item of nav.flatMap(s => s.items)) expect(canAccessRoute(role, item.href)).toBe(true)
    }
  })
})
