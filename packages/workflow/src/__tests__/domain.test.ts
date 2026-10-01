import { describe, expect, it } from 'vitest'
import {
  calculerModePassation, classerOffres, dateLimiteMinimale, EvaluationError, scoreTechnique, seuilAoo, seuilsFromConfig,
  validerGrille, validerModePassation, verifierAvenant, verifierSousTraitance, tauxQuota, estTardif,
} from '../index'

describe('seuils et mode de passation', () => {
  it('applique les seuils État (70 M travaux / 50 M autres) et Agences (100 M / 60 M)', () => {
    expect(seuilAoo('ETAT', 'TRAVAUX')).toBe(70_000_000)
    expect(seuilAoo('COLLECTIVITE', 'FOURNITURES')).toBe(50_000_000)
    expect(seuilAoo('AGENCE', 'TRAVAUX')).toBe(100_000_000)
    expect(seuilAoo('SOCIETE_PUBLIQUE', 'SERVICES_COURANTS')).toBe(60_000_000)
  })

  it('AOO à partir du seuil, DRP en dessous, jamais d\'AOR automatique (correction de l\'ancienne bande à 50 %)', () => {
    expect(calculerModePassation(70_000_000, 'TRAVAUX', 'ETAT')).toBe('AOO')
    expect(calculerModePassation(69_999_999, 'TRAVAUX', 'ETAT')).toBe('DRP')
    expect(calculerModePassation(40_000_000, 'TRAVAUX', 'ETAT')).toBe('DRP')   // avant : 'AOR'
    expect(calculerModePassation(1, 'DSP', 'ETAT')).toBe('AOO')
  })

  it('utilise les seuils paramétrés par l\'administrateur et les dérogations d\'institution', () => {
    const cfg = seuilsFromConfig([{ cle: 'SEUIL_ETAT_FOURNITURES', valeur: '30000000' }])
    expect(calculerModePassation(35_000_000, 'FOURNITURES', 'ETAT', cfg)).toBe('AOO')
    expect(calculerModePassation(35_000_000, 'FOURNITURES', 'ETAT', undefined, { fournitures: 40_000_000 })).toBe('DRP')
  })

  it('refuse la DRP au-delà du seuil et exige une justification pour tout écart', () => {
    expect(validerModePassation('DRP', 60_000_000, 'FOURNITURES', 'ETAT', null).ok).toBe(false)
    expect(validerModePassation('AOR', 60_000_000, 'FOURNITURES', 'ETAT', null).erreurs[0]).toMatch(/justifié/)
    expect(validerModePassation('AOR', 60_000_000, 'FOURNITURES', 'ETAT', 'Spécificité technique justifiant une consultation restreinte').ok).toBe(true)
    expect(validerModePassation('ENTENTE_DIRECTE', 1_000_000, 'FOURNITURES', 'ETAT', 'court').ok).toBe(false)
  })
})

describe('évaluation — mêmes valeurs que le test SQL', () => {
  const grille = (a: number, b: number, c: number) => [
    { critere: 'Expérience', ponderation: 40, note: a }, { critere: 'Méthodologie', ponderation: 35, note: b }, { critere: 'Moyens', ponderation: 25, note: c },
  ]

  it('score technique = somme des notes, grille validée', () => {
    expect(scoreTechnique(grille(34, 30, 21))).toBe(85)
    expect(validerGrille(grille(34, 30, 21))).toEqual([])
    expect(validerGrille(grille(41, 30, 21))[0]).toMatch(/entre 0 et 40/)
    expect(validerGrille(grille(34, 30, 21), [{ critere: 'Autre', ponderation: 100 }])[0]).toMatch(/exactement les critères/)
  })

  it('classement : B1 (85 pts, 50 M) devant B2 (90 pts, 60 M) → 89,5 contre 88', () => {
    const r = classerOffres([
      { id: 'b1', montant: 50_000_000, soumisLe: '2026-01-01', notesEvaluateurs: [85, 85, 85] },
      { id: 'b2', montant: 60_000_000, soumisLe: '2026-01-02', notesEvaluateurs: [90, 90, 90] },
    ])
    expect(r.map(x => x.id)).toEqual(['b1', 'b2'])
    expect(r[0]).toMatchObject({ scoreGlobal: 89.5, scoreFinancier: 100, rang: 1 })
    expect(r[1]).toMatchObject({ scoreGlobal: 88, scoreFinancier: 83.33, rang: 2 })
  })

  it('une offre sous le seuil technique est éliminée avant la comparaison financière', () => {
    const r = classerOffres([
      { id: 'cheap', montant: 10_000_000, soumisLe: '2026-01-01', notesEvaluateurs: [60, 60] },
      { id: 'ok', montant: 50_000_000, soumisLe: '2026-01-01', notesEvaluateurs: [80, 80] },
    ])
    expect(r.find(x => x.id === 'cheap')).toMatchObject({ qualifie: false, rang: null, scoreGlobal: null })
    expect(r.find(x => x.id === 'ok')).toMatchObject({ rang: 1, scoreFinancier: 100 })
  })

  it('refuse un classement sous-instruit (moins de deux évaluateurs, aucune offre admise)', () => {
    expect(() => classerOffres([{ id: 'a', montant: 1, soumisLe: '2026-01-01', notesEvaluateurs: [90] }])).toThrowError(EvaluationError)
    expect(() => classerOffres([{ id: 'a', montant: 1, soumisLe: '2026-01-01', notesEvaluateurs: [10, 10] }])).toThrow(/minimale/)
    expect(() => classerOffres([])).toThrow(/infructueuse/)
  })

  it('départage : montant le plus bas, puis dépôt le plus ancien', () => {
    const r = classerOffres([
      { id: 'tard', montant: 50_000_000, soumisLe: '2026-01-02', notesEvaluateurs: [80, 80] },
      { id: 'tot', montant: 50_000_000, soumisLe: '2026-01-01', notesEvaluateurs: [80, 80] },
    ])
    expect(r[0].id).toBe('tot')
  })
})

describe('plafonds légaux', () => {
  it('avenants : 30 % pile autorisé, au-delà bloqué, avenant négatif sans effet de recharge', () => {
    const base = 50_000_000
    expect(verifierAvenant(base, [10_000_000], 5_000_000).ok).toBe(true)
    expect(verifierAvenant(base, [10_000_000], 6_000_000)).toMatchObject({ ok: false, pourcentage: 32 })
    expect(verifierAvenant(base, [10_000_000, 5_000_000, -8_000_000], 1_000_000).ok).toBe(false)
    expect(verifierAvenant(base, [15_000_000], -5_000_000).ok).toBe(true)
  })

  it('sous-traitance : 40 % maximum', () => {
    expect(verifierSousTraitance(50_000_000, [15_000_000], 5_000_000).ok).toBe(true)
    expect(verifierSousTraitance(50_000_000, [15_000_000], 5_000_001).ok).toBe(false)
  })

  it('quotas PME', () => {
    expect(tauxQuota(2_500_000, 50_000_000)).toBe(5)
    expect(tauxQuota(0, 0)).toBe(0)
  })
})

describe('délais', () => {
  it('délai minimal de dépôt selon le mode, offre tardive dès l\'heure limite', () => {
    const pub = new Date('2026-01-01T08:00:00Z')
    expect(dateLimiteMinimale(pub, 'AOO').toISOString()).toBe('2026-01-31T08:00:00.000Z')
    expect(dateLimiteMinimale(pub, 'DRP').toISOString()).toBe('2026-01-11T08:00:00.000Z')
    const limite = new Date('2026-02-01T12:00:00Z')
    expect(estTardif(new Date('2026-02-01T11:59:59Z'), limite)).toBe(false)
    expect(estTardif(new Date('2026-02-01T12:00:00Z'), limite)).toBe(true)
  })
})
