import { describe, expect, it } from 'vitest'
import {
  BLOCKING_CODES, GUIDES, VARIABLES, blockingIssues, lintDocument, mergeSections, mergeVariables, qualityScore, unknownVariables,
  type ClauseRef, type DocSection,
} from '../domain/redaction'

const long = 'Description détaillée, chiffrée et vérifiable des prestations attendues du titulaire.'
const sec = (id: string, contenu: string, extra: Partial<DocSection> = {}): DocSection => ({ id, titre: id, contenu, ...extra })
const CLAUSES: ClauseRef[] = [
  { code: 'GAR-BE', titre: 'Garantie de bonne exécution', obligatoire: true },
  { code: 'TRAVAUX-ONLY', titre: 'Retenue de garantie travaux', obligatoire: true, natures: ['TRAVAUX'] },
  { code: 'OPT', titre: 'Clause facultative', obligatoire: false },
]
const codes = (s: DocSection[], type: 'TDR' | 'DAO' = 'TDR', nature = 'FOURNITURES') => lintDocument(s, { type, nature, clauses: CLAUSES }).map(i => i.code)

describe('variables de fusion', () => {
  const values = { reference: 'M-2026-001', autorite: 'Ministère de la Santé', montant_estime: '80 000 000' }
  it('remplace les variables renseignées et laisse les autres visibles', () => {
    expect(mergeVariables('{{reference}} / {{ autorite }} / {{besoin}}', values)).toBe('M-2026-001 / Ministère de la Santé / {{besoin}}')
  })
  it('ignore une valeur vide ou blanche', () => {
    expect(mergeVariables('{{reference}}', { reference: '  ' })).toBe('{{reference}}')
  })
  it('fusionne titres et contenus sans toucher aux consignes', () => {
    const [s] = mergeSections([{ id: 'a', titre: 'Marché {{reference}}', contenu: '{{autorite}}', consigne: '{{reference}}' }], values)
    expect(s).toMatchObject({ titre: 'Marché M-2026-001', contenu: 'Ministère de la Santé', consigne: '{{reference}}' })
  })
  it('repère les variables inconnues', () => {
    expect(unknownVariables('{{reference}} {{inconnue}} {{autre}}')).toEqual(['inconnue', 'autre'])
    expect(Object.keys(VARIABLES)).toContain('montant_estime')
  })
})

describe('contrôle qualité — bloquants', () => {
  it('document vide', () => { expect(codes([sec('a', '  ')])).toContain('EMPTY') })
  it('texte à compléter : [●], {{variable}}, [à compléter]', () => {
    for (const bad of ['délai de [●] jours', 'voir {{besoin}}', 'Montant [à compléter]', 'Montant [A COMPLETER]']) {
      expect(codes([sec('a', `${long} ${bad}`)])).toContain('PLACEHOLDER')
    }
  })
  it('section obligatoire trop courte (< 40 caractères)', () => {
    expect(codes([sec('a', 'Trop court', { obligatoire: true }), sec('b', long)])).toContain('MANDATORY_SHORT')
    expect(codes([sec('a', 'x'.repeat(40), { obligatoire: true })])).not.toContain('MANDATORY_SHORT')
    expect(codes([sec('a', 'Court', { obligatoire: false }), sec('b', long)])).not.toContain('MANDATORY_SHORT')
  })
  it('clauses obligatoires du DAO selon la nature ; aucune exigence pour un TDR', () => {
    expect(codes([sec('a', long)], 'DAO', 'FOURNITURES').filter(c => c === 'MISSING_CLAUSE')).toHaveLength(1)
    expect(codes([sec('a', long)], 'DAO', 'TRAVAUX').filter(c => c === 'MISSING_CLAUSE')).toHaveLength(2)
    expect(codes([sec('a', long), sec('clause-GAR-BE', long)], 'DAO', 'FOURNITURES')).not.toContain('MISSING_CLAUSE')
    expect(codes([sec('a', long)], 'TDR')).not.toContain('MISSING_CLAUSE')
  })
  it('un document complet n\'a aucun bloquant', () => {
    const doc = [sec('contexte', long, { obligatoire: true }), sec('clause-GAR-BE', long, { obligatoire: true })]
    expect(blockingIssues(lintDocument(doc, { type: 'DAO', nature: 'FOURNITURES', clauses: CLAUSES }))).toEqual([])
  })
  it('les codes bloquants sont ceux déclarés', () => {
    const all = lintDocument([sec('a', '[●]', { obligatoire: true })], { type: 'DAO', nature: 'TRAVAUX', clauses: CLAUSES })
    for (const i of all) expect(i.severity === 'BLOQUANT').toBe(BLOCKING_CODES.includes(i.code))
  })
})

describe('contrôle qualité — conseils de rédaction', () => {
  it('formulation imprécise', () => {
    for (const w of ['fournir des pièces diverses', 'quantité environ 10', 'matériel, etc.', 'si nécessaire', 'à définir ultérieurement']) {
      expect(codes([sec('a', `${long} ${w}`)])).toContain('VAGUE')
    }
    expect(codes([sec('a', long)])).not.toContain('VAGUE')
  })
  it('marque sans « ou équivalent »', () => {
    expect(codes([sec('a', `${long} Ordinateur de marque Acme.`)])).toContain('BRAND')
    expect(codes([sec('a', `${long} Ordinateur de marque Acme ou équivalent.`)])).not.toContain('BRAND')
  })
  it('condition restrictive de participation', () => {
    expect(codes([sec('a', `${long} Réservé exclusivement aux entreprises établies à Dakar.`)])).toContain('RESTRICTIVE')
    expect(codes([sec('a', `${long} Les entreprises sénégalaises sont seules admises.`)])).toContain('RESTRICTIVE')
  })
  it('pondérations de la grille : alerte si ≠ 100', () => {
    const grille = (txt: string) => [sec('criteres', txt, { titre: 'Critères d\'évaluation' })]
    expect(codes(grille('Méthodologie 40 points, Personnel 35 points, Moyens 20 points'))).toContain('CRITERIA_SUM')
    expect(codes(grille('Méthodologie 40 points, Personnel 35 points, Moyens 25 points'))).not.toContain('CRITERIA_SUM')
    expect(codes(grille('Un seul critère de 70 %'))).not.toContain('CRITERIA_SUM')
  })
  it('rubriques usuelles d\'un TDR et ligne budgétaire', () => {
    const issues = lintDocument([sec('contexte', long)], { type: 'TDR', ligneBudgetaire: '1.2.3.4' })
    expect(issues.filter(i => i.code === 'RECOMMENDED_SECTION').length).toBe(6)
    expect(issues.some(i => i.code === 'BUDGET_LINE')).toBe(true)
    expect(lintDocument([sec('a', 'ligne 1.2.3.4')], { type: 'DAO', ligneBudgetaire: '1.2.3.4' }).some(i => i.code === 'BUDGET_LINE')).toBe(false)
  })
})

describe('score et guides', () => {
  it('le score baisse avec la gravité et reste dans [0, 100]', () => {
    expect(qualityScore([])).toBe(100)
    const one = (severity: 'BLOQUANT' | 'AVERTISSEMENT' | 'CONSEIL') => qualityScore([{ code: 'VAGUE', severity, message: '' }])
    expect(one('BLOQUANT')).toBeLessThan(one('AVERTISSEMENT'))
    expect(one('AVERTISSEMENT')).toBeLessThan(one('CONSEIL'))
    expect(qualityScore(Array.from({ length: 20 }, () => ({ code: 'EMPTY' as const, severity: 'BLOQUANT' as const, message: '' })))).toBe(0)
  })
  it('chaque guide est complet et n\'utilise que des variables connues', () => {
    for (const [id, g] of Object.entries(GUIDES)) {
      expect(g.points.length, id).toBeGreaterThan(0)
      expect(g.erreurs.length, id).toBeGreaterThan(0)
      expect(unknownVariables(g.exemple), id).toEqual([])
    }
  })
})
