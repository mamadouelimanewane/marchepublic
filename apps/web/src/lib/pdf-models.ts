// Modèles de documents officiels : fonctions pures « données → blocs » (testables sans base ni PDF).
import { dateFr, fcfa } from '@/lib/format'
import type { PdfModel } from '@/lib/pdf'

interface TenderInfo { reference: string | null; title: string; institution: string; nature_marche?: string; mode_passation?: string | null; montant_estime?: number | null; montant_attribue?: number | null }

const ref = (t: TenderInfo) => t.reference ?? 'marché'

export function documentModel(t: TenderInfo, doc: { titre: string; type: string; circuit_statut: string; sections: { titre: string; contenu: string }[] }, versions: { version: number; circuit_statut: string; content_hash: string; created_at: string }[]): PdfModel {
  const last = versions[0]
  return {
    title: doc.titre, subtitle: `${doc.type === 'TDR' ? 'Termes de référence' : "Dossier d'appel d'offres"} — ${t.institution}`, reference: `${ref(t)} / ${doc.type}`,
    blocks: [
      { t: 'kv', rows: [['Marché', `${ref(t)} — ${t.title}`], ['Nature / mode', `${t.nature_marche ?? '-'} / ${t.mode_passation ?? '-'}`], ['Montant estimé', fcfa(t.montant_estime)], ['État du circuit', doc.circuit_statut], ['Version', last ? `v${last.version} du ${dateFr(last.created_at, true)}` : '-']] },
      ...doc.sections.flatMap(s => [{ t: 'h1' as const, text: s.titre }, { t: 'p' as const, text: s.contenu || '(section non renseignée)' }]),
      ...(last ? [{ t: 'spacer' as const }, { t: 'p' as const, text: `Empreinte de la version (SHA-256) : ${last.content_hash}` }] : []),
    ],
  }
}

export function pvOuvertureModel(t: TenderInfo & { date_limite_depot: string | null }, opening: { opened_at: string; nb_plis: number; key_fingerprint: string | null; observations: string | null }, commission: { nom: string; fonction: string }[], bids: { candidat: string; ninea: string | null; lot: string | null; recu: string | null; montant: number | null; statut: string; motif: string | null }[]): PdfModel {
  return {
    title: "Procès-verbal d'ouverture des plis", subtitle: t.institution, reference: `${ref(t)} / PV ouverture`,
    blocks: [
      { t: 'kv', rows: [['Marché', `${ref(t)} — ${t.title}`], ['Date limite de dépôt', dateFr(t.date_limite_depot, true)], ['Ouverture effective', dateFr(opening.opened_at, true)], ['Plis reçus dans les délais', String(opening.nb_plis)], ['Empreinte clé publique', opening.key_fingerprint ?? '-']] },
      { t: 'h2', text: 'Commission' }, { t: 'list', items: commission.map(c => `${c.nom} — ${c.fonction}`) },
      { t: 'h2', text: 'Offres' },
      { t: 'table', head: ['Candidat', 'NINEA', 'Lot', 'Reçue le', 'Montant lu', 'Statut'], widths: [3, 1.5, 0.8, 1.7, 1.7, 2],
        rows: bids.map(b => [b.candidat, b.ninea ?? '-', b.lot ?? '-', dateFr(b.recu, true), fcfa(b.montant), b.motif ? `${b.statut} - ${b.motif}` : b.statut]) },
      ...(opening.observations ? [{ t: 'p' as const, text: `Observations : ${opening.observations}` }] : []),
      { t: 'signatures', labels: ['Le CPM', 'Le Président de la commission'] },
      { t: 'p', text: "Les signatures électroniques de l'ouverture (CPM et président) sont enregistrées dans la base avec horodatage serveur." },
    ],
  }
}

export interface RankingRow { lot: string | null; rang: number | null; candidat: string; technique: number | null; financier: number | null; global: number | null; montant: number; qualifie: boolean }

export function rapportEvaluationModel(t: TenderInfo & { evaluation_round: number }, criteres: { critere: string; ponderation: number }[], rankings: RankingRow[], seuil: number): PdfModel {
  return {
    title: "Rapport d'évaluation des offres", subtitle: t.institution, reference: `${ref(t)} / rapport évaluation`,
    blocks: [
      { t: 'kv', rows: [['Marché', `${ref(t)} — ${t.title}`], ['Ronde d\'évaluation', String(t.evaluation_round)], ['Note technique minimale', `${seuil} / 100`]] },
      { t: 'h2', text: "Critères d'évaluation" },
      { t: 'table', head: ['Critère', 'Pondération'], widths: [5, 1], rows: criteres.map(c => [c.critere, String(c.ponderation)]) },
      { t: 'h2', text: 'Classement' },
      { t: 'table', head: ['Lot', 'Rang', 'Candidat', 'Technique', 'Financière', 'Globale', 'Montant'], widths: [0.8, 0.8, 3, 1.2, 1.2, 1.2, 2],
        rows: rankings.map(r => [r.lot ?? '-', r.qualifie ? String(r.rang) : 'Eliminée', r.candidat, String(r.technique ?? '-'), String(r.financier ?? '-'), String(r.global ?? '-'), fcfa(r.montant)]) },
      { t: 'p', text: "La note financière est égale à 100 x (montant du moins-disant admis / montant de l'offre) ; la note globale pondère les notes technique et financière. Le classement est calculé par le serveur et immuable une fois finalisé." },
      { t: 'signatures', labels: ['Le Président de la commission', 'Le Secrétaire'] },
    ],
  }
}

export function decisionAttributionModel(t: TenderInfo & { date_fin_recours: string | null; date_attribution_provisoire: string | null }, awards: { lot: string | null; candidat: string; montant: number | null }[], infructueux: string[]): PdfModel {
  return {
    title: "Décision d'attribution provisoire", subtitle: t.institution, reference: `${ref(t)} / décision attribution`,
    blocks: [
      { t: 'kv', rows: [['Marché', `${ref(t)} — ${t.title}`], ['Date de la décision', dateFr(t.date_attribution_provisoire, true)], ['Montant total attribué', fcfa(t.montant_attribue)], ['Fin du délai de recours', dateFr(t.date_fin_recours, true)]] },
      { t: 'h2', text: 'Attributaires provisoires' },
      { t: 'table', head: ['Lot', 'Attributaire', 'Montant'], widths: [1, 4, 2], rows: awards.map(a => [a.lot ?? 'Marché entier', a.candidat, fcfa(a.montant)]) },
      ...(infructueux.length ? [{ t: 'p' as const, text: `Lots déclarés infructueux : ${infructueux.join(', ')}.` }] : []),
      { t: 'p', text: "Tout candidat non retenu peut former un recours devant l'ARCOP avant la fin du délai ci-dessus. L'attribution définitive est bloquée tant qu'un recours est pendant." },
      { t: 'signatures', labels: ['La Personne Responsable des Marchés'] },
    ],
  }
}

export function pvReceptionModel(t: TenderInfo, c: { montant_actuel: number | null; montant_initial: number; lot: string | null }, holder: string, r: { type: string; date_reception: string; statut: string; reserves: string | null }, commission: { nom: string }[]): PdfModel {
  return {
    title: `Procès-verbal de réception ${r.type === 'PROVISOIRE' ? 'provisoire' : 'définitive'}`, subtitle: t.institution, reference: `${ref(t)} / PV réception ${r.type}`,
    blocks: [
      { t: 'kv', rows: [['Marché', `${ref(t)} — ${t.title}`], ['Lot', c.lot ?? '-'], ['Titulaire', holder], ['Montant du contrat', fcfa(c.montant_actuel ?? c.montant_initial)], ['Date de réception', dateFr(r.date_reception)], ['Décision', r.statut.replace(/_/g, ' ')], ['Réserves', r.reserves ?? 'Aucune']] },
      ...(commission.length ? [{ t: 'h2' as const, text: 'Commission de réception' }, { t: 'list' as const, items: commission.map(m => m.nom) }] : []),
      { t: 'signatures', labels: ['Pour la commission de réception', 'Pour le titulaire', "Pour l'autorité contractante"] },
    ],
  }
}

export function contratModel(t: TenderInfo, c: { montant_initial: number; date_debut_execution: string | null; delai_execution: number | null; signed_by_ac: boolean; signed_by_titulaire: boolean; visa_controleur: boolean; lot: string | null }, holder: { nom: string; ninea: string | null }, clauses: { titre: string; contenu: string }[], garanties: { type: string; montant: number; emetteur: string; reference: string; date_expiration: string }[]): PdfModel {
  const etat = (b: boolean) => (b ? 'signé (électroniquement, horodaté en base)' : 'en attente')
  return {
    title: 'Contrat de marché public', subtitle: t.institution, reference: `${ref(t)} / contrat${c.lot ? ` ${c.lot}` : ''}`,
    blocks: [
      { t: 'h1', text: 'Article 1 - Parties et objet' },
      { t: 'kv', rows: [['Autorité contractante', t.institution], ['Titulaire', `${holder.nom}${holder.ninea ? ` (NINEA ${holder.ninea})` : ''}`], ['Objet', `${ref(t)} — ${t.title}${c.lot ? ` — ${c.lot}` : ''}`], ['Nature / mode de passation', `${t.nature_marche ?? '-'} / ${t.mode_passation ?? '-'}`]] },
      { t: 'h1', text: 'Article 2 - Prix et délais' },
      { t: 'kv', rows: [['Montant du marché', fcfa(c.montant_initial)], ['Début d\'exécution', dateFr(c.date_debut_execution)], ['Délai d\'exécution', c.delai_execution ? `${c.delai_execution} jours` : '-']] },
      ...(garanties.length ? [{ t: 'h1' as const, text: 'Article 3 - Garanties' }, { t: 'table' as const, head: ['Type', 'Montant', 'Emetteur', 'Reference', 'Expiration'], rows: garanties.map(g => [g.type, fcfa(g.montant), g.emetteur, g.reference, dateFr(g.date_expiration)]) }] : []),
      ...clauses.flatMap((cl, i) => [{ t: 'h1' as const, text: `Article ${i + 4} - ${cl.titre}` }, { t: 'p' as const, text: cl.contenu }]),
      { t: 'h1', text: 'État des signatures' },
      { t: 'kv', rows: [['Autorité contractante', etat(c.signed_by_ac)], ['Titulaire', etat(c.signed_by_titulaire)], ['Visa du contrôle financier', c.visa_controleur ? 'apposé' : 'en attente']] },
      { t: 'signatures', labels: ["Pour l'autorité contractante", 'Pour le titulaire'] },
    ],
  }
}

// ------------------------------------------
// Plan de passation des marchés (PPM)
// ------------------------------------------
export interface PpmRow { reference: string | null; title: string; nature_marche: string; mode_passation: string | null; montant_estime: number | null; ppm_trimestre: number | null; current_phase: string; institution?: string }

const label = (v: string | null | undefined) => (v ?? '—').replaceAll('_', ' ').toLowerCase()

export function ppmModel(annee: number, institution: string | null, rows: PpmRow[]): PdfModel {
  const total = rows.reduce((n, r) => n + Number(r.montant_estime ?? 0), 0)
  const trimestres = [1, 2, 3, 4].map(t => {
    const r = rows.filter(x => x.ppm_trimestre === t)
    return [`T${t}`, String(r.length), fcfa(r.reduce((n, x) => n + Number(x.montant_estime ?? 0), 0))]
  })
  const sans = rows.filter(x => !x.ppm_trimestre)
  if (sans.length) trimestres.push(['Non planifié', String(sans.length), fcfa(sans.reduce((n, x) => n + Number(x.montant_estime ?? 0), 0))])
  const multi = new Set(rows.map(r => r.institution ?? '')).size > 1
  const sorted = [...rows].sort((a, b) => (a.ppm_trimestre ?? 9) - (b.ppm_trimestre ?? 9) || (a.reference ?? '').localeCompare(b.reference ?? ''))
  return {
    title: `Plan de passation des marchés ${annee}`, subtitle: institution ?? (multi ? 'Plusieurs autorités contractantes' : undefined), reference: `PPM-${annee}`,
    blocks: [
      { t: 'kv', rows: [['Exercice', String(annee)], ['Nombre de marchés', String(rows.length)], ['Montant total estimé', fcfa(total)]] },
      { t: 'h2', text: 'Répartition par trimestre' },
      { t: 'table', head: ['Trimestre', 'Marchés', 'Montant estimé'], widths: [2, 1, 3], rows: trimestres },
      { t: 'h2', text: 'Liste des marchés programmés' },
      { t: 'table', head: multi ? ['T', 'Référence', 'Objet', 'Autorité', 'Mode', 'Montant estimé'] : ['T', 'Référence', 'Objet', 'Nature', 'Mode', 'Montant estimé'],
        widths: [0.5, 3.1, 3.6, 2.2, 1.1, 2.2],
        rows: sorted.map(r => [r.ppm_trimestre ? `T${r.ppm_trimestre}` : '—', r.reference ?? '—', r.title, multi ? (r.institution ?? '—') : label(r.nature_marche), r.mode_passation ?? '—', fcfa(r.montant_estime)]) },
      { t: 'p', text: 'Document généré par la plateforme à partir des marchés inscrits au plan ; les montants sont des estimations hors engagement.' },
    ],
  }
}
