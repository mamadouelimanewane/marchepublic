// Construction des modèles de TDR à partir de fiches métier, et rendu de la migration SQL.
//   node supabase/modeles-tdr/generate.mjs   →   supabase/migrations/0021_modeles_tdr_sectoriels.sql
//
// FORMAT D'UNE SECTION (colonne document_templates.sections, JSONB) :
//   { id, titre, obligatoire, consigne, contenu, guide: { objectif, points[], exemple, erreurs[] } }
//   • consigne : ce que l'agent doit écrire (affichée tant que la section est vide)
//   • contenu  : point de départ. Chaque `[●]` est une valeur à fournir : le document ne peut pas être validé tant qu'il en reste.
//   • guide    : aide propre au métier (points à couvrir, exemple de formulation, erreurs fréquentes)
// FORMAT D'UN MODÈLE (colonne document_templates.meta) : { famille, questions[], references[], vigilance[], version }
//
// Les sept identifiants contexte/objectifs/consistance/livrables/profil/duree/suivi sont communs à tous les modèles (contrôle qualité).

export const FAMILLES = ['SERVICES', 'TRAVAUX', 'FOURNITURES']

const T = {
  SERVICES: {
    consistance: 'Consistance des prestations et méthodologie', livrables: 'Livrables et calendrier', obligations: 'Obligations des parties, confidentialité et propriété intellectuelle',
    consigneConsistance: 'Décrire sans ambiguïté les prestations attendues, leur étendue chiffrée et la méthodologie exigée.',
    consigneLivrables: 'Lister chaque livrable, son format, son échéance et son critère d\'acceptation.',
  },
  TRAVAUX: {
    consistance: 'Consistance des travaux et spécifications techniques', livrables: 'Planning, jalons et documents d\'exécution', obligations: 'Garanties, assurances et obligations du titulaire',
    consigneConsistance: 'Décrire les ouvrages, leurs caractéristiques, les quantités principales, le site et les spécifications techniques applicables.',
    consigneLivrables: 'Lister les jalons, les documents d\'exécution à fournir (plans, notes de calcul, DOE) et leurs échéances.',
  },
  FOURNITURES: {
    consistance: 'Spécifications techniques et quantités', livrables: 'Livraison, installation et documentation', obligations: 'Garanties, service après-vente et obligations du fournisseur',
    consigneConsistance: 'Décrire chaque article ou lot : caractéristiques techniques minimales (avec « ou équivalent »), quantités et lieux de livraison.',
    consigneLivrables: 'Préciser les conditions de livraison, d\'installation, de formation et la documentation fournie.',
  },
}

const bullets = (items, f = x => x) => items.map(f).join('\n')
const num = items => items.map((x, i) => `${i + 1}. ${x}`).join('\n')

/** Les sections d'un modèle, dans l'ordre. */
export function sectionsFor(s) {
  const t = T[s.famille]
  const lieu = s.famille === 'TRAVAUX' ? 'du site des travaux' : s.famille === 'FOURNITURES' ? 'des lieux de livraison' : 'd\'exécution'
  return [
    {
      id: 'contexte', titre: '1. Contexte et justification', obligatoire: true,
      consigne: 'Présenter le cadre institutionnel, le besoin et sa justification. ' + s.contexte,
      contenu: '{{autorite}} conduit le projet « {{intitule}} » (réf. {{reference}}), financé sur la ligne {{ligne_budgetaire}} de l\'exercice {{annee}}.\n\nBesoin exprimé : {{besoin}}\n\nJustification : {{justification}}',
      guide: {
        objectif: 'Expliquer pourquoi ce marché existe, en une page, pour que tout candidat comprenne l\'enjeu.',
        points: ['Mission de l\'autorité et lien avec la politique sectorielle', 'Situation actuelle chiffrée et problème à résoudre', ...s.contextePoints ?? [], 'Financement (ligne budgétaire, bailleur éventuel)'],
        exemple: s.contexteExemple ?? 'Le service [●] constate [problème chiffré]. Le présent marché vise à [résultat attendu] au bénéfice de [bénéficiaires], dans [zone géographique].',
        erreurs: ['Copier l\'historique de l\'institution sans lien avec le besoin', 'Omettre le financement ou les bénéficiaires', 'Justifier par l\'urgence sans date ni fait'],
      },
    },
    {
      id: 'objectifs', titre: '2. Objectifs', obligatoire: true,
      consigne: 'Un objectif général et des objectifs spécifiques mesurables.',
      contenu: `Objectif général : [●]\n\nObjectifs spécifiques :\n${bullets(s.objectifs, (o, i) => `${i + 1}. ${o}`)}`,
      guide: {
        objectif: 'Fixer des objectifs vérifiables à la réception ; chacun a un indicateur et une cible.',
        points: ['Un objectif général (une phrase)', ...s.objectifs.slice(0, 3), 'Un indicateur et une cible par objectif'],
        exemple: s.objectifs[0].replace(/\[●\]/g, '[●]'),
        erreurs: ['Objectifs non mesurables (« améliorer la qualité »)', 'Confondre objectifs et moyens', 'Plus de cinq objectifs'],
      },
    },
    {
      id: 'consistance', titre: '3. ' + t.consistance, obligatoire: true,
      consigne: t.consigneConsistance,
      contenu: `${num(s.prestations)}\n\nExclusions du marché : [●]`,
      guide: {
        objectif: t.consigneConsistance,
        points: s.prestations,
        exemple: s.prestations[0],
        erreurs: [...s.vigilance.slice(0, 2), 'Quantités « environ » ou « selon besoin »', 'Marque ou référence commerciale sans « ou équivalent »'],
      },
    },
    {
      id: 'livrables', titre: '4. ' + t.livrables, obligatoire: true,
      consigne: t.consigneLivrables,
      contenu: bullets(s.livrables, (l, i) => `L${i + 1} — ${l} : échéance [●] ; validé par [●] sous [●] jours ouvrés.`),
      guide: {
        objectif: 'Rendre le paiement vérifiable : un livrable ou un jalon = une preuve datée, validée par une personne désignée.',
        points: [...s.livrables, 'Lien entre livrable et paiement'],
        exemple: `${s.livrables[0]} : au plus tard à T0 + 30 jours calendaires, validé par le comité de suivi sous 10 jours ouvrés.`,
        erreurs: ['Livrables sans échéance', 'Aucun critère d\'acceptation', 'Délai de validation non fixé'],
      },
    },
    {
      id: 'profil', titre: '5. Qualifications et moyens requis', obligatoire: true,
      consigne: 'Exigences proportionnées à l\'objet : trop faibles, risque de mauvaise exécution ; trop fortes, exclusion des PME.',
      contenu: bullets(s.profil, p => `- ${p} : [●]`) + '\n\nGroupement et sous-traitance : [●]',
      guide: {
        objectif: 'Fixer des exigences proportionnées et vérifiables, ouvertes aux PME locales.',
        points: [...s.profil, 'Possibilité de groupement et de sous-traitance (plafond de 40 %)'],
        exemple: `${s.profil[0]} : au moins [●] ans d'expérience et [●] références similaires sur les 5 dernières années.`,
        erreurs: ['Exiger un chiffre d\'affaires supérieur au double du marché', 'Imposer une marque d\'équipement', 'Exclure implicitement les PME'],
      },
    },
    {
      id: 'duree', titre: '6. Durée et lieu d\'exécution', obligatoire: true,
      consigne: 'Délai réaliste, point de départ précis, lieux.',
      contenu: `Le délai d'exécution est de [●] jours calendaires à compter de l'ordre de service de démarrage. Lieu(x) ${lieu} : [●].`,
      guide: {
        objectif: 'Donner un délai réaliste et un point de départ précis.',
        points: ['Délai en jours calendaires et point de départ (ordre de service)', 'Lieux d\'exécution (régions, communes, sites)', 'Jalons intermédiaires', ...(s.dureePoints ?? [])],
        exemple: 'Le délai d\'exécution est de 120 jours calendaires à compter de l\'ordre de service de démarrage. Lieu d\'exécution : [commune, région].',
        erreurs: ['Délai en « mois » sans date de départ', 'Délai incompatible avec les procédures de recours', 'Plusieurs lieux non listés'],
      },
    },
    {
      id: 'specifiques', titre: '7. Exigences propres au secteur (normes, sécurité, environnement)', obligatoire: true,
      consigne: 'Normes, réglementation sectorielle, sécurité, environnement : ' + s.references.slice(0, 2).join(' ; ') + '.',
      contenu: `Normes et réglementation applicables : [●]\n\nExigences de sécurité, d'hygiène et d'environnement : [●]`,
      guide: {
        objectif: 'Citer les règles propres au métier, sans en inventer : en cas de doute, renvoyer à l\'autorité sectorielle compétente.',
        points: [...s.references.map(r => `Références usuelles (à confirmer auprès de l'autorité compétente) : ${r}`), ...s.vigilance],
        exemple: 'Le titulaire respecte les normes sénégalaises (ASN) ou internationales équivalentes applicables à [●], ainsi que la réglementation sectorielle en vigueur.',
        erreurs: ['Citer un texte sans en vérifier la version en vigueur', 'Norme étrangère sans équivalent admis', 'Oublier les exigences de sécurité et d\'environnement'],
      },
    },
    {
      id: 'suivi', titre: '8. Suivi, contrôle et réception', obligatoire: true,
      consigne: 'Qui contrôle, à quel rythme, selon quels critères de réception.',
      contenu: `Un comité de suivi se réunit tous les [●] jours.\n\nCritères de réception :\n${bullets(s.reception, r => `- ${r}`)}\n\nPénalités applicables : voir la clause type « Pénalités de retard ».`,
      guide: {
        objectif: 'Dire comment l\'autorité contrôle et réceptionne, pour éviter les litiges de fin de marché.',
        points: [...s.reception, 'Responsable du suivi et fréquence des rapports', 'Réception provisoire puis définitive, garantie'],
        exemple: 'La réception provisoire est prononcée après contrôle des livrables par la commission de réception ; la réception définitive intervient à l\'expiration de la garantie.',
        erreurs: ['Aucun responsable désigné', 'Réception sans critères', 'Oublier la garantie après réception'],
      },
    },
    {
      id: 'obligations', titre: '9. ' + t.obligations, obligatoire: false,
      consigne: 'Obligations de chaque partie ; renvoi aux clauses types (garanties, propriété intellectuelle, avenants).',
      contenu: '',
      guide: {
        objectif: 'Répartir clairement les obligations et renvoyer aux clauses types plutôt que les recopier.',
        points: ['Obligations de l\'autorité (accès, données, validation dans les délais)', 'Obligations du titulaire (moyens, confidentialité, rapports)', 'Garanties et assurances requises', 'Propriété et restitution des livrables, données et équipements'],
        exemple: 'L\'autorité contractante met à disposition [●] dans un délai de [●] jours après l\'ordre de service. Le titulaire garde confidentielles les informations reçues.',
        erreurs: ['Obligations unilatérales', 'Confidentialité sans durée', 'Propriété des livrables non précisée'],
      },
    },
    {
      id: 'budget', titre: '10. Estimation budgétaire', obligatoire: false,
      consigne: 'Ligne budgétaire et estimation prévisionnelle (hors taxes), méthode d\'estimation.',
      contenu: 'Estimation prévisionnelle : {{montant_estime}} FCFA, imputée sur la ligne budgétaire {{ligne_budgetaire}} (exercice {{annee}}).',
      guide: {
        objectif: 'Rendre le prix estimé traçable (il détermine la procédure et les seuils).',
        points: ['Ligne budgétaire et exercice', 'Méthode d\'estimation (références, prix antérieurs, catalogue d\'accords-cadres)', 'Montant estimé hors taxes'],
        exemple: 'Estimation : {{montant_estime}} FCFA sur la ligne {{ligne_budgetaire}}, établie à partir des marchés similaires de [années].',
        erreurs: ['Estimation sans méthode', 'Fractionner pour passer sous un seuil', 'Confondre HT et TTC'],
      },
    },
  ]
}

export function metaFor(s) {
  return { famille: s.famille, version: 2, questions: s.questions, references: s.references, vigilance: s.vigilance }
}

// ------------------------------------------
// Rendu SQL
// ------------------------------------------
const lit = v => `'${String(v).replaceAll("'", "''")}'`
const json = o => `$j$${JSON.stringify(o)}$j$::jsonb`

export function render(specs) {
  const out = []
  out.push(`-- ==========================================
-- Migration 0021 : Modèles de TDR sectoriels (GÉNÉRÉE — ne pas éditer à la main)
--   source : supabase/modeles-tdr/*.mjs   —   commande : node supabase/modeles-tdr/generate.mjs
--   • ${specs.filter(s => !s.generic).length} corps de métiers, chacun avec son modèle de TDR sectoriel et sa grille d'évaluation type
--   • ${specs.filter(s => s.generic).length} modèles génériques par famille de marché (sans corps de métier)
--   • assistant IA « TDR complet » : nouveau type de requête dans le journal
-- ==========================================

ALTER TABLE document_templates ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}';
ALTER TABLE ai_requests DROP CONSTRAINT IF EXISTS ai_requests_kind_check;
ALTER TABLE ai_requests ADD CONSTRAINT ai_requests_kind_check CHECK (kind IN ('REDIGER_SECTION', 'RELIRE_DOCUMENT', 'REDIGER_TDR_COMPLET'));
`)
  out.push('-- Nomenclature des corps de métiers (extension)\nINSERT INTO corps_metiers (code, libelle, description) VALUES')
  const trades = specs.filter(s => !s.generic)
  out.push(trades.map(s => `  (${lit(s.code)}, ${lit(s.libelle)}, ${lit(s.description)})`).join(',\n'))
  out.push('ON CONFLICT (code) DO UPDATE SET description = COALESCE(corps_metiers.description, EXCLUDED.description);\n')

  out.push('-- Modèles de TDR\n')
  for (const s of specs) {
    const code = s.generic ? `TDR-GEN-${s.code}` : `TDR-${s.code}`
    const titre = s.generic ? `Termes de référence — ${s.libelle}` : `Termes de référence — ${s.libelle}`
    const nature = s.nature ? `${lit(s.nature)}::nature_marche` : 'NULL'
    const body = `${json(sectionsFor(s))}, ${json(metaFor(s))}`
    if (s.generic) {
      out.push(`INSERT INTO document_templates (code, type, titre, nature_marche, corps_metier_id, version, sections, meta)
VALUES (${lit(code)}, 'TDR', ${lit(titre)}, ${nature}, NULL, 2, ${body})
ON CONFLICT (code) DO UPDATE SET titre = EXCLUDED.titre, nature_marche = EXCLUDED.nature_marche, version = EXCLUDED.version, sections = EXCLUDED.sections, meta = EXCLUDED.meta;\n`)
    } else {
      out.push(`INSERT INTO document_templates (code, type, titre, nature_marche, corps_metier_id, version, sections, meta)
SELECT ${lit(code)}, 'TDR', ${lit(titre)}, ${nature}, cm.id, 2, ${body} FROM corps_metiers cm WHERE cm.code = ${lit(s.code)}
ON CONFLICT (code) DO UPDATE SET titre = EXCLUDED.titre, nature_marche = EXCLUDED.nature_marche, corps_metier_id = EXCLUDED.corps_metier_id, version = EXCLUDED.version, sections = EXCLUDED.sections, meta = EXCLUDED.meta;\n`)
    }
  }

  out.push('-- Grilles d\'évaluation types par corps de métier (la somme des pondérations doit faire 100)\n')
  for (const s of trades) {
    const criteres = s.criteres.map(([critere, ponderation]) => ({ critere, ponderation }))
    out.push(`INSERT INTO evaluation_templates (code, corps_metier_id, criteres, seuil_technique)
SELECT ${lit('EVAL-' + s.code)}, cm.id, ${json(criteres)}, ${s.seuil ?? 70} FROM corps_metiers cm WHERE cm.code = ${lit(s.code)}
ON CONFLICT (code) DO UPDATE SET criteres = EXCLUDED.criteres, seuil_technique = EXCLUDED.seuil_technique;\n`)
  }
  return out.join('\n')
}
