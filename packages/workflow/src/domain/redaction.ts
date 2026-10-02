// ==========================================
// Aide à la rédaction des TDR / DAO — module pur (aucune dépendance) : partagé par l'éditeur, la page de rédaction et les tests.
//  • variables de fusion : {{reference}}, {{montant_estime}}… remplies depuis le marché et le besoin d'origine ;
//  • contrôle qualité : problèmes BLOQUANTS (refusés en base à la validation PRM — voir `document_blocking_issues`),
//    AVERTISSEMENTS (risques de contentieux ou d'ambiguïté) et CONSEILS ;
//  • guides par section : consignes, points de contrôle, exemple et erreurs fréquentes.
// ==========================================

export interface DocSection { id: string; titre: string; contenu: string; obligatoire?: boolean; consigne?: string; guide?: Omit<SectionGuide, 'titre'> }
export interface ClauseRef { code: string; titre: string; obligatoire: boolean; natures?: string[] | null }

/** Variables disponibles dans les modèles : `{{cle}}`. */
export const VARIABLES: Record<string, string> = {
  reference: 'Référence du marché',
  intitule: 'Intitulé du marché',
  autorite: 'Autorité contractante',
  nature: 'Nature du marché',
  mode: 'Mode de passation',
  montant_estime: 'Montant estimé (FCFA)',
  ligne_budgetaire: 'Ligne budgétaire',
  annee: 'Exercice budgétaire',
  besoin: 'Description du besoin (expression de besoin)',
  justification: 'Justification du besoin',
}
export type VariableValues = Partial<Record<keyof typeof VARIABLES, string>>

const VAR_RE = /\{\{\s*([a-z_]+)\s*\}\}/g
/** Marqueurs de texte restant à compléter : jamais acceptés dans un document validé. */
export const PLACEHOLDER_RE = /\[●\]|\{\{[^}]*\}\}|\[\s*à compléter\s*\]|\[\s*a completer\s*\]/i

/** Remplace les variables connues et renseignées ; les autres restent visibles pour être signalées. */
export function mergeVariables(text: string, values: VariableValues): string {
  return text.replace(VAR_RE, (m, k: string) => (values[k as keyof VariableValues]?.trim() ? values[k as keyof VariableValues]! : m))
}
export function mergeSections(sections: DocSection[], values: VariableValues): DocSection[] {
  return sections.map(s => ({ ...s, titre: mergeVariables(s.titre, values), contenu: mergeVariables(s.contenu, values) }))
}
export function unknownVariables(text: string): string[] {
  return [...text.matchAll(VAR_RE)].map(m => m[1]).filter(k => !(k in VARIABLES))
}

// ------------------------------------------
// Contrôle qualité
// ------------------------------------------
export type Severity = 'BLOQUANT' | 'AVERTISSEMENT' | 'CONSEIL'
export type IssueCode =
  | 'EMPTY' | 'PLACEHOLDER' | 'MANDATORY_SHORT' | 'MISSING_CLAUSE'                       // bloquants (miroir SQL)
  | 'VAGUE' | 'BRAND' | 'RESTRICTIVE' | 'CRITERIA_SUM' | 'RECOMMENDED_SECTION' | 'BUDGET_LINE'  // conseils de rédaction
export interface Issue { code: IssueCode; severity: Severity; sectionId?: string; message: string }

export const MIN_MANDATORY_CHARS = 40
export const BLOCKING_CODES: readonly IssueCode[] = ['EMPTY', 'PLACEHOLDER', 'MANDATORY_SHORT', 'MISSING_CLAUSE']

export interface LintContext {
  type: 'TDR' | 'DAO'
  nature?: string
  clauses?: ClauseRef[]
  ligneBudgetaire?: string | null
}

const VAGUE_RE = /(?<!\p{L})(etc\.?|et autres|et cetera|diverses?|tout autre|toute autre|si nécessaire|le cas échéant|à définir|à préciser|quantité suffisante|dans les meilleurs délais|au plus vite|environ|approximativement|de bonne qualité|de qualité)(?!\p{L})|…|\.\.\./iu
const BRAND_RE = /(?<!\p{L})(de marque|marque|référence commerciale|modèle exact)(?!\p{L})/iu
const RESTRICTIVE_RE = /(?<!\p{L})(exclusivement|uniquement|seules? les (entreprises|sociétés)|à l'exclusion|réservé(e)? aux entreprises (sénégalaises|nationales))(?!\p{L})/iu
const NATIONAL_RE = /(entreprises?|sociétés?|candidats?|soumissionnaires?)\s+(sénégalaises?|nationale?s?)/i

const clauseId = (code: string) => `clause-${code}`
const cut = (s: string, n = 60) => (s.length > n ? s.slice(0, n) + '…' : s)

/** Rubriques à recommander dans un TDR (identifiants des modèles). */
const TDR_RECOMMENDED = ['contexte', 'objectifs', 'consistance', 'livrables', 'profil', 'duree', 'suivi']

export function lintDocument(sections: DocSection[], ctx: LintContext): Issue[] {
  const out: Issue[] = []
  const filled = sections.filter(s => s.contenu.trim() !== '')
  if (filled.length === 0) out.push({ code: 'EMPTY', severity: 'BLOQUANT', message: 'Le document ne contient aucun texte.' })

  for (const s of sections) {
    const text = `${s.titre}\n${s.contenu}`
    if (PLACEHOLDER_RE.test(text)) out.push({ code: 'PLACEHOLDER', severity: 'BLOQUANT', sectionId: s.id, message: `« ${cut(s.titre)} » contient un texte à compléter ([●], {{variable}} ou [à compléter]).` })
    if (s.obligatoire && s.contenu.trim().length < MIN_MANDATORY_CHARS) out.push({ code: 'MANDATORY_SHORT', severity: 'BLOQUANT', sectionId: s.id, message: `La section obligatoire « ${cut(s.titre)} » est vide ou trop courte (${MIN_MANDATORY_CHARS} caractères minimum).` })

    if (VAGUE_RE.test(s.contenu)) out.push({ code: 'VAGUE', severity: 'AVERTISSEMENT', sectionId: s.id, message: `« ${cut(s.titre)} » : formulation imprécise (« etc. », « le cas échéant », « environ »…). Une exigence floue est source de recours : chiffrez-la ou listez-la.` })
    if (BRAND_RE.test(s.contenu) && !/équivalent/i.test(s.contenu)) out.push({ code: 'BRAND', severity: 'AVERTISSEMENT', sectionId: s.id, message: `« ${cut(s.titre)} » : une marque ou référence commerciale doit être suivie de « ou équivalent » et des caractéristiques techniques attendues (principe d'égalité d'accès).` })
    if (RESTRICTIVE_RE.test(s.contenu) || NATIONAL_RE.test(s.contenu)) out.push({ code: 'RESTRICTIVE', severity: 'AVERTISSEMENT', sectionId: s.id, message: `« ${cut(s.titre)} » : condition restrictive de participation (exclusivité, nationalité). Seules les préférences prévues par la réglementation sont admises ; justifiez ou reformulez.` })
  }

  // Grille de notation : si des pondérations chiffrées sont listées, elles doivent totaliser 100.
  const crit = sections.find(s => /crit[eè]res|notation|évaluation/i.test(s.id + ' ' + s.titre))
  if (crit) {
    const pts = [...crit.contenu.matchAll(/(\d+(?:[.,]\d+)?)\s*(%|points?|pts)\b/gi)].map(m => Number(m[1].replace(',', '.')))
    if (pts.length >= 2) {
      const total = Math.round(pts.reduce((a, b) => a + b, 0) * 100) / 100
      if (total !== 100) out.push({ code: 'CRITERIA_SUM', severity: 'AVERTISSEMENT', sectionId: crit.id, message: `Les pondérations citées dans « ${cut(crit.titre)} » totalisent ${total} au lieu de 100 (la base refuse la grille du marché si elle ne totalise pas 100).` })
    }
  }

  if (ctx.type === 'DAO') {
    for (const c of ctx.clauses ?? []) {
      if (!c.obligatoire) continue
      if (c.natures && c.natures.length && ctx.nature && !c.natures.includes(ctx.nature)) continue
      if (!sections.some(s => s.id === clauseId(c.code))) out.push({ code: 'MISSING_CLAUSE', severity: 'BLOQUANT', message: `Clause type obligatoire absente : ${c.titre}.` })
    }
  } else {
    for (const id of TDR_RECOMMENDED) {
      if (!sections.some(s => s.id === id)) out.push({ code: 'RECOMMENDED_SECTION', severity: 'CONSEIL', message: `Rubrique usuelle d'un TDR absente : ${GUIDES[id]?.titre ?? id}.` })
    }
  }
  if (ctx.ligneBudgetaire && !sections.some(s => s.contenu.includes(ctx.ligneBudgetaire!))) {
    out.push({ code: 'BUDGET_LINE', severity: 'CONSEIL', message: `La ligne budgétaire ${ctx.ligneBudgetaire} n'est citée nulle part : rappelez le financement (variable {{ligne_budgetaire}}).` })
  }
  return out
}

export const blockingIssues = (issues: Issue[]) => issues.filter(i => i.severity === 'BLOQUANT')

/** Score indicatif de 0 à 100 ; un document avec un bloquant ne peut pas être validé quel que soit son score. */
export function qualityScore(issues: Issue[]): number {
  const w = { BLOQUANT: 20, AVERTISSEMENT: 6, CONSEIL: 2 } as const
  return Math.max(0, 100 - issues.reduce((n, i) => n + w[i.severity], 0))
}

// ------------------------------------------
// Guides par section
// ------------------------------------------
export interface SectionGuide { titre: string; objectif: string; points: string[]; exemple: string; erreurs: string[] }

export const GUIDES: Record<string, SectionGuide> = {
  contexte: {
    titre: 'Contexte et justification',
    objectif: 'Expliquer pourquoi ce marché existe, en une page, pour que n\'importe quel candidat comprenne l\'enjeu.',
    points: ['Cadre institutionnel et mission de l\'autorité', 'Besoin identifié et situation actuelle (chiffres)', 'Lien avec le budget-programme et la politique sectorielle', 'Financement (ligne budgétaire, bailleur éventuel)'],
    exemple: '{{autorite}} assure [mission]. Le service [X] constate [problème chiffré]. Le présent marché « {{intitule}} » (réf. {{reference}}) vise à [résultat attendu]. Il est financé sur la ligne {{ligne_budgetaire}} de l\'exercice {{annee}}.',
    erreurs: ['Copier l\'historique de l\'institution sans lien avec le besoin', 'Omettre le financement', 'Justifier par l\'urgence sans date ni fait'],
  },
  objectifs: {
    titre: 'Objectifs',
    objectif: 'Fixer un objectif général et des objectifs spécifiques vérifiables à la réception.',
    points: ['Un objectif général (une phrase)', '3 à 5 objectifs spécifiques, chacun mesurable', 'Un indicateur et une cible par objectif'],
    exemple: 'Objectif général : [améliorer X]. Objectifs spécifiques : (1) livrer [N unités] avant le [date] ; (2) former [N agents] ; (3) atteindre un taux de [Y %] mesuré par [indicateur].',
    erreurs: ['Objectifs non mesurables (« améliorer la qualité »)', 'Confondre objectifs et moyens', 'Plus de cinq objectifs'],
  },
  consistance: {
    titre: 'Consistance des prestations',
    objectif: 'Décrire sans ambiguïté ce que le titulaire doit faire ou fournir : c\'est la base du prix et du contrôle.',
    points: ['Liste numérotée des prestations, quantités chiffrées', 'Normes et spécifications applicables (citer « ou équivalent »)', 'Contraintes de site, d\'accès, de sécurité', 'Ce qui est exclu du marché'],
    exemple: '1. Fourniture de 120 ordinateurs portables répondant aux caractéristiques de l\'annexe 2 (processeur de performance équivalente ou supérieure à [référence], 16 Go de mémoire) ou équivalent. 2. Livraison et installation sur 6 sites listés en annexe 3. 3. Reprise des anciens équipements.',
    erreurs: ['Citer une marque sans « ou équivalent »', 'Quantités « environ » ou « selon besoin »', 'Spécifications taillées pour un seul fournisseur'],
  },
  livrables: {
    titre: 'Livrables et calendrier',
    objectif: 'Rendre le paiement vérifiable : un livrable = une preuve datée.',
    points: ['Chaque livrable, son format, sa date limite', 'Qui valide et sous quel délai', 'Lien entre livrable et paiement'],
    exemple: 'L1 — Rapport de démarrage, T0 + 15 jours ; L2 — Rapport intermédiaire, T0 + 60 jours ; L3 — Rapport final, T0 + 120 jours. Chaque livrable est validé par [service] dans un délai de 10 jours ouvrés.',
    erreurs: ['Livrables sans date', 'Aucun critère d\'acceptation', 'Délai de validation non fixé'],
  },
  profil: {
    titre: 'Qualifications et moyens requis',
    objectif: 'Fixer des exigences proportionnées à l\'objet : trop faibles, on risque la mauvaise exécution ; trop fortes, on exclut les PME.',
    points: ['Expérience similaire (nombre, montant, période) — proportionnée', 'Personnel clé et diplômes ou années d\'expérience', 'Moyens matériels indispensables', 'Possibilité de groupement et de sous-traitance'],
    exemple: 'Avoir exécuté au moins 2 marchés similaires d\'un montant unitaire supérieur à [montant] au cours des 5 dernières années. Personnel clé : 1 chef de projet (5 ans d\'expérience) et 2 techniciens. Le groupement est admis.',
    erreurs: ['Exiger un chiffre d\'affaires supérieur au double du marché', 'Imposer une marque d\'équipement', 'Exclure implicitement les PME'],
  },
  duree: {
    titre: 'Durée et lieu d\'exécution',
    objectif: 'Donner un délai réaliste et un point de départ précis.',
    points: ['Délai en jours calendaires et date de départ (ordre de service)', 'Lieu(x) d\'exécution', 'Jalons intermédiaires'],
    exemple: 'Le délai d\'exécution est de 120 jours calendaires à compter de l\'ordre de service de démarrage. Lieu d\'exécution : [commune, région].',
    erreurs: ['Délai en « mois » sans date de départ', 'Délai incompatible avec les procédures de recours', 'Plusieurs lieux non listés'],
  },
  suivi: {
    titre: 'Suivi, contrôle et réception',
    objectif: 'Dire comment l\'autorité contrôle et réceptionne, pour éviter les litiges de fin de marché.',
    points: ['Responsable du suivi et fréquence des rapports', 'Procédure de réception provisoire puis définitive', 'Pénalités applicables (renvoi à la clause type)'],
    exemple: 'Un comité de suivi se réunit tous les 15 jours. La réception provisoire est prononcée après contrôle des livrables par la commission de réception ; la réception définitive intervient à l\'expiration de la garantie.',
    erreurs: ['Aucun responsable désigné', 'Réception sans critères', 'Oublier la garantie après réception'],
  },
  budget: {
    titre: 'Estimation budgétaire',
    objectif: 'Rendre le prix estimé traçable (il détermine la procédure et les seuils).',
    points: ['Ligne budgétaire et exercice', 'Méthode d\'estimation (références, prix antérieurs)', 'Montant estimé hors taxes'],
    exemple: 'Estimation : {{montant_estime}} FCFA sur la ligne {{ligne_budgetaire}}, établie à partir des marchés similaires de [années].',
    erreurs: ['Estimation sans méthode', 'Fractionner pour passer sous un seuil', 'Confondre HT et TTC'],
  },
  criteres: {
    titre: 'Critères de qualification et d\'évaluation',
    objectif: 'Annoncer d\'avance, sans équivoque, comment les offres seront notées.',
    points: ['Critères éliminatoires distincts des critères notés', 'Pondérations totalisant 100', 'Seuil technique minimal', 'Méthode de calcul de la note financière'],
    exemple: 'Qualification (éliminatoire) : références similaires, capacité financière. Notation technique : Méthodologie — 40 points ; Personnel — 35 points ; Moyens — 25 points. Seuil technique : 70 points.',
    erreurs: ['Pondérations ne totalisant pas 100', 'Sous-critères inventés à l\'évaluation', 'Critère calibré pour un candidat'],
  },
}

export function guideFor(sectionId: string): SectionGuide | undefined {
  return GUIDES[sectionId]
}
