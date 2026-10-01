-- ==========================================
-- Migration 0012 : Reporting (CDC §11) et données de référence (CDC §7)
-- Les vues sont en security_invoker : la RLS de l'appelant s'applique (une institution ne voit que ses marchés,
-- les régulateurs voient tout). Aucune vue n'expose d'offre avant l'ouverture des plis.
-- ==========================================

-- Pipeline des dossiers par phase (tableau de bord PRM/CPM)
CREATE OR REPLACE VIEW v_pipeline_phases WITH (security_invoker = true) AS
SELECT t.institution_id, t.current_phase, COUNT(*)::int AS nb_marches, COALESCE(SUM(t.montant_estime), 0)::bigint AS montant_estime_total
FROM tenders t GROUP BY t.institution_id, t.current_phase;

-- Durée passée dans chaque phase (goulots d'étranglement) — calculée à partir de phase_history
CREATE OR REPLACE VIEW v_durees_phases WITH (security_invoker = true) AS
WITH ev AS (
  SELECT t.id AS tender_id, t.institution_id, t.mode_passation, t.nature_marche,
         (e.value ->> 'from') AS phase_quittee,
         (e.value ->> 'enteredAt')::timestamptz AS sortie_at,
         LAG((e.value ->> 'enteredAt')::timestamptz) OVER (PARTITION BY t.id ORDER BY e.ord) AS entree_at,
         e.ord
  FROM tenders t, jsonb_array_elements(t.phase_history) WITH ORDINALITY AS e(value, ord)
)
SELECT tender_id, institution_id, mode_passation, nature_marche, phase_quittee AS phase,
       COALESCE(entree_at, (SELECT created_at FROM tenders WHERE id = ev.tender_id)) AS entree_at, sortie_at,
       ROUND(EXTRACT(EPOCH FROM (sortie_at - COALESCE(entree_at, (SELECT created_at FROM tenders WHERE id = ev.tender_id)))) / 86400.0, 2) AS jours
FROM ev;

CREATE OR REPLACE VIEW v_delais_moyens_phase WITH (security_invoker = true) AS
SELECT institution_id, phase, COUNT(*)::int AS nb_passages, ROUND(AVG(jours), 2) AS jours_moyens, ROUND(MAX(jours), 2) AS jours_max
FROM v_durees_phases GROUP BY institution_id, phase;

-- Quotas légaux PME / ESS (5 %) dont PME à direction féminine (2 %)
CREATE OR REPLACE VIEW v_quotas_pme WITH (security_invoker = true) AS
SELECT q.institution_id, i.name AS institution, q.annee_fiscale, q.montant_total_marches, q.montant_pme, q.montant_pme_feminine,
       q.taux_pme, q.taux_pme_feminine,
       config_num('PME_QUOTA_GLOBAL', 0.05) * 100 AS objectif_pme, config_num('PME_QUOTA_FEMININ', 0.02) * 100 AS objectif_feminin,
       q.taux_pme >= config_num('PME_QUOTA_GLOBAL', 0.05) * 100 AS objectif_pme_atteint,
       q.taux_pme_feminine >= config_num('PME_QUOTA_FEMININ', 0.02) * 100 AS objectif_feminin_atteint
FROM pme_quotas_tracking q JOIN institutions i ON i.id = q.institution_id;

-- Statistiques sectorielles : corps de métier × mode de passation × institution
CREATE OR REPLACE VIEW v_stats_sectorielles WITH (security_invoker = true) AS
SELECT t.institution_id, COALESCE(cm.libelle, 'Non renseigné') AS corps_metier, t.mode_passation, t.nature_marche,
       COUNT(*)::int AS nb_marches, COALESCE(SUM(t.montant_estime), 0)::bigint AS montant_estime,
       COALESCE(SUM(t.montant_attribue), 0)::bigint AS montant_attribue
FROM tenders t LEFT JOIN corps_metiers cm ON cm.id = t.corps_metier_id
GROUP BY t.institution_id, cm.libelle, t.mode_passation, t.nature_marche;

-- ARCOP : taux de litiges par autorité contractante
CREATE OR REPLACE VIEW v_stats_recours WITH (security_invoker = true) AS
SELECT i.id AS institution_id, i.name AS institution,
       COUNT(DISTINCT a.id)::int AS nb_recours,
       COUNT(DISTINCT a.id) FILTER (WHERE a.status IN ('DEPOSE', 'EN_INSTRUCTION'))::int AS nb_en_cours,
       COUNT(DISTINCT a.id) FILTER (WHERE a.status IN ('FAVORABLE', 'PARTIELLEMENT_FAVORABLE'))::int AS nb_favorables,
       (SELECT COUNT(*)::int FROM tenders t WHERE t.institution_id = i.id AND t.current_phase >= 'PHASE_10_RECOURS') AS nb_marches_attribues,
       CASE WHEN (SELECT COUNT(*) FROM tenders t WHERE t.institution_id = i.id AND t.current_phase >= 'PHASE_10_RECOURS') > 0
            THEN ROUND(100.0 * COUNT(DISTINCT a.tender_id) / (SELECT COUNT(*) FROM tenders t WHERE t.institution_id = i.id AND t.current_phase >= 'PHASE_10_RECOURS'), 2)
            ELSE 0 END AS taux_litiges_pct
FROM institutions i LEFT JOIN appeals a ON a.institution_id = i.id
GROUP BY i.id, i.name;

-- DCMP : dossiers en attente d'avis
CREATE OR REPLACE VIEW v_dcmp_en_attente WITH (security_invoker = true) AS
SELECT t.id AS tender_id, t.reference, t.title, t.institution_id, i.name AS institution, t.mode_passation, t.montant_estime,
       t.transmis_dcmp_at, ROUND(EXTRACT(EPOCH FROM (NOW() - t.transmis_dcmp_at)) / 86400.0, 1) AS jours_attente, t.is_cofinance
FROM tenders t JOIN institutions i ON i.id = t.institution_id
WHERE t.current_phase = 'PHASE_3_VALIDATION_PRIORI';

-- Alertes (retards de calendrier, garanties à échéance, plafonds proches, paiements en souffrance)
CREATE OR REPLACE VIEW v_alertes WITH (security_invoker = true) AS
SELECT t.institution_id, t.id AS tender_id, t.reference, 'RETARD_PPM'::text AS type_alerte,
       'Lancement prévu le ' || to_char(t.date_prevue_lancement, 'DD/MM/YYYY') || ' dépassé (phase ' || t.current_phase || ')' AS message
FROM tenders t WHERE t.date_prevue_lancement < CURRENT_DATE AND t.current_phase < 'PHASE_4_PUBLICATION'
UNION ALL
SELECT g.institution_id, g.tender_id, t.reference, 'GARANTIE_EXPIRE_BIENTOT',
       'Garantie ' || g.type || ' (' || g.reference || ') expire le ' || to_char(g.date_expiration, 'DD/MM/YYYY')
FROM guarantees g JOIN tenders t ON t.id = g.tender_id
WHERE g.statut = 'VALIDE' AND g.date_expiration <= CURRENT_DATE + config_num('ALERTE_GARANTIE_JOURS', 30)::int
UNION ALL
SELECT c.institution_id, c.tender_id, t.reference, 'AVENANT_PROCHE_PLAFOND',
       'Avenants cumulés à ' || ROUND(100.0 * COALESCE((SELECT SUM(GREATEST(montant_avenant, 0)) FROM contract_amendments WHERE contract_id = c.id), 0) / c.montant_initial, 1) || ' % du montant initial'
FROM contracts c JOIN tenders t ON t.id = c.tender_id
WHERE COALESCE((SELECT SUM(GREATEST(montant_avenant, 0)) FROM contract_amendments WHERE contract_id = c.id), 0) >= 0.8 * c.montant_initial * config_num('AVENANT_PLAFOND', 0.30)
UNION ALL
SELECT p.institution_id, p.tender_id, t.reference, 'PAIEMENT_EN_ATTENTE',
       'Décompte n°' || p.numero || ' en attente depuis le ' || to_char(p.date_soumission, 'DD/MM/YYYY') || ' (' || p.statut || ')'
FROM payment_statements p JOIN tenders t ON t.id = p.tender_id
WHERE p.statut NOT IN ('PAYE', 'REJETE') AND p.date_soumission < NOW() - INTERVAL '30 days'
UNION ALL
SELECT t.institution_id, t.id, t.reference, 'RECOURS_A_INSTRUIRE',
       'Recours à instruire avant le ' || to_char(a.date_limite_instruction, 'DD/MM/YYYY')
FROM appeals a JOIN tenders t ON t.id = a.tender_id WHERE a.status IN ('DEPOSE', 'EN_INSTRUCTION');

-- Paiements : délais moyens et encours
CREATE OR REPLACE VIEW v_paiements WITH (security_invoker = true) AS
SELECT p.institution_id, p.tender_id, t.reference, p.contract_id, p.numero, p.type, p.montant, p.statut, p.date_soumission, p.date_paiement,
       ROUND(EXTRACT(EPOCH FROM (COALESCE(p.date_paiement, NOW()) - p.date_soumission)) / 86400.0, 1) AS delai_jours
FROM payment_statements p JOIN tenders t ON t.id = p.tender_id;

GRANT SELECT ON v_pipeline_phases, v_durees_phases, v_delais_moyens_phase, v_quotas_pme, v_stats_sectorielles,
                v_stats_recours, v_dcmp_en_attente, v_alertes, v_paiements TO authenticated;
REVOKE ALL ON v_pipeline_phases, v_durees_phases, v_delais_moyens_phase, v_quotas_pme, v_stats_sectorielles,
              v_stats_recours, v_dcmp_en_attente, v_alertes, v_paiements FROM anon;

-- ==========================================
-- DONNÉES DE RÉFÉRENCE (modèles à faire valider par la DCMP avant mise en production)
-- Les taux et pourcentages sont volontairement laissés en paramètres [●] : ils relèvent des arrêtés en vigueur.
-- ==========================================

-- Clauses types obligatoires (CDC §7.1)
INSERT INTO clause_templates (code, categorie, titre, contenu, obligatoire, natures) VALUES
  ('GAR-SOUM', 'GARANTIE', 'Garantie de soumission',
   'Le soumissionnaire joint à son offre une garantie de soumission d''un montant de [●] % du montant de son offre, valable [●] jours à compter de la date limite de dépôt.', true, NULL),
  ('GAR-BE', 'GARANTIE', 'Garantie de bonne exécution',
   'L''attributaire constitue, avant la signature du contrat, une garantie de bonne exécution de [●] % du montant du marché, restituée après la réception définitive.', true, ARRAY['TRAVAUX','FOURNITURES','SERVICES_COURANTS']::nature_marche[]),
  ('GAR-AVANCE', 'GARANTIE', 'Garantie de restitution d''avance de démarrage',
   'Toute avance de démarrage est subordonnée à la remise d''une garantie à première demande de même montant, dégressive au prorata des décomptes.', false, NULL),
  ('PEN-RETARD', 'PENALITES', 'Pénalités de retard',
   'En cas de retard d''exécution, une pénalité de [●] ‰ du montant du marché par jour de retard est appliquée, plafonnée à [●] % du montant du marché.', true, NULL),
  ('REC-PROV-DEF', 'RECEPTION', 'Réception provisoire et définitive',
   'La réception provisoire est prononcée après constat de l''achèvement des prestations ; la réception définitive intervient à l''expiration du délai de garantie de [●] mois, sous réserve de la levée des réserves.', true, NULL),
  ('PI-PROPRIETE', 'PROPRIETE_INTELLECTUELLE', 'Propriété intellectuelle des livrables',
   'Les rapports, données, logiciels et documents produits dans le cadre de la mission sont la propriété exclusive de l''autorité contractante, qui en dispose librement. Le consultant ne peut les utiliser sans son accord écrit.', true, ARRAY['PRESTATIONS_INTELLECTUELLES']::nature_marche[]),
  ('PME-RESERVATION', 'PME', 'Promotion des PME et de l''économie sociale et solidaire',
   'L''autorité contractante s''engage à réserver au moins 5 % de la valeur annuelle de ses marchés aux PME nationales et acteurs de l''économie sociale et solidaire, dont 2 % aux PME à direction féminine.', true, NULL),
  ('ENV-SOC', 'ENVIRONNEMENT', 'Clauses environnementales et sociales',
   'Le titulaire respecte la réglementation environnementale et sociale en vigueur, prend les mesures de prévention des pollutions et de sécurité sur le lieu d''exécution, et déclare son personnel aux organismes sociaux.', true, NULL),
  ('ALLOT', 'ALLOTISSEMENT', 'Allotissement',
   'Le marché est divisé en lots lorsque la nature des prestations le permet. Un candidat peut soumissionner à un ou plusieurs lots ; les conditions d''attribution cumulée des lots sont précisées aux données particulières.', true, NULL),
  ('SOUS-TRAIT', 'SOUS_TRAITANCE', 'Sous-traitance',
   'La sous-traitance est soumise à l''agrément préalable de l''autorité contractante et ne peut excéder 40 % du montant du marché. Le titulaire demeure seul responsable de l''exécution.', true, NULL),
  ('AVENANT', 'AVENANT', 'Avenants',
   'Toute modification du marché fait l''objet d''un avenant. Le cumul des avenants en augmentation ne peut excéder 30 % du montant initial du marché.', true, NULL),
  ('PAIEMENT', 'PAIEMENT', 'Modalités de paiement',
   'Les paiements sont effectués sur décomptes visés par l''autorité contractante et le contrôle financier, dans un délai de [●] jours à compter de la réception du décompte complet.', true, NULL)
ON CONFLICT (code) DO NOTHING;

-- Modèles de TDR par corps de métier (CDC §7.1)
INSERT INTO document_templates (code, type, titre, nature_marche, corps_metier_id, sections)
SELECT 'TDR-' || cm.code, 'TDR', 'Termes de référence — ' || cm.libelle,
       CASE WHEN cm.code IN ('PRESTATIONS_INTELLECTUELLES', 'FORMATION') THEN 'PRESTATIONS_INTELLECTUELLES'::nature_marche END,
       cm.id,
       jsonb_build_array(
         jsonb_build_object('id', 'contexte', 'titre', '1. Contexte et justification', 'obligatoire', true, 'contenu', 'Présenter le cadre institutionnel, le besoin identifié et sa justification au regard du budget-programme.'),
         jsonb_build_object('id', 'objectifs', 'titre', '2. Objectifs', 'obligatoire', true, 'contenu', 'Objectif général et objectifs spécifiques, mesurables.'),
         jsonb_build_object('id', 'consistance', 'titre', '3. Consistance des prestations', 'obligatoire', true, 'contenu', 'Description détaillée des prestations, fournitures ou travaux attendus, et des contraintes techniques propres au secteur « ' || cm.libelle || ' ».'),
         jsonb_build_object('id', 'livrables', 'titre', '4. Livrables et calendrier', 'obligatoire', true, 'contenu', 'Liste des livrables, échéances, modalités de validation.'),
         jsonb_build_object('id', 'profil', 'titre', '5. Qualifications et moyens requis', 'obligatoire', true, 'contenu', 'Expérience, personnel clé, moyens matériels exigés.'),
         jsonb_build_object('id', 'duree', 'titre', '6. Durée et lieu d''exécution', 'obligatoire', true, 'contenu', 'Délai d''exécution et lieu(x) d''intervention.'),
         jsonb_build_object('id', 'suivi', 'titre', '7. Suivi, contrôle et réception', 'obligatoire', true, 'contenu', 'Dispositif de suivi, rapports d''avancement, modalités de réception.'),
         jsonb_build_object('id', 'budget', 'titre', '8. Estimation budgétaire', 'obligatoire', false, 'contenu', 'Ligne budgétaire et estimation prévisionnelle.'))
FROM corps_metiers cm
ON CONFLICT (code) DO NOTHING;

-- Modèles de DAO par mode de passation
INSERT INTO document_templates (code, type, titre, mode_passation, sections)
SELECT 'DAO-' || m.mode, 'DAO', 'Dossier d''appel d''offres — ' || m.libelle, m.mode::mode_passation,
       jsonb_build_array(
         jsonb_build_object('id', 'avis', 'titre', 'Section 1 — Avis d''appel d''offres', 'obligatoire', true, 'contenu', 'Objet, autorité contractante, financement, conditions de participation, date et heure limites de dépôt, lieu et modalités d''ouverture.'),
         jsonb_build_object('id', 'ic', 'titre', 'Section 2 — Instructions aux candidats', 'obligatoire', true, 'contenu', 'Conditions de participation, contenu et présentation des offres, validité, garanties, langues, monnaies, modalités d''ouverture et d''évaluation, attribution, recours.'),
         jsonb_build_object('id', 'dpao', 'titre', 'Section 3 — Données particulières', 'obligatoire', true, 'contenu', 'Précisions propres au marché : lots, variantes, délais, garantie de soumission, sous-traitance.'),
         jsonb_build_object('id', 'criteres', 'titre', 'Section 4 — Critères de qualification et d''évaluation', 'obligatoire', true, 'contenu', 'Critères éliminatoires, grille de notation technique (Σ = 100), seuil technique, méthode d''évaluation financière.'),
         jsonb_build_object('id', 'ccap', 'titre', 'Section 5 — Cahier des clauses administratives particulières', 'obligatoire', true, 'contenu', 'Clauses types obligatoires : garanties, pénalités, réception, PME, environnement et social.'),
         jsonb_build_object('id', 'cctp', 'titre', 'Section 6 — Cahier des clauses techniques / spécifications', 'obligatoire', true, 'contenu', 'Spécifications techniques, plans, normes applicables.'),
         jsonb_build_object('id', 'formulaires', 'titre', 'Section 7 — Formulaires', 'obligatoire', true, 'contenu', 'Lettre de soumission, bordereau des prix, détail quantitatif et estimatif, modèles de garanties.'))
FROM (VALUES ('AOO', 'appel d''offres ouvert'), ('AOR', 'appel d''offres restreint'), ('AOO_2ETAPES', 'appel d''offres en deux étapes'),
             ('CONCOURS', 'concours'), ('DRP', 'demande de renseignements et de prix'), ('ACCORD_CADRE', 'accord-cadre')) AS m(mode, libelle)
ON CONFLICT (code) DO NOTHING;

-- Grilles d'évaluation types par corps de métier (Σ pondérations = 100, vérifié par contrainte)
INSERT INTO evaluation_templates (code, corps_metier_id, criteres, seuil_technique)
SELECT 'EVAL-' || cm.code, cm.id, g.criteres::jsonb, 70
FROM corps_metiers cm
JOIN (VALUES
  ('BTP', '[{"critere":"Références de travaux similaires","ponderation":30},{"critere":"Méthodologie et planning","ponderation":25},{"critere":"Personnel clé","ponderation":25},{"critere":"Matériel et moyens","ponderation":20}]'),
  ('INFORMATIQUE', '[{"critere":"Conformité aux spécifications techniques","ponderation":40},{"critere":"Références et certifications","ponderation":20},{"critere":"Support, maintenance et garantie","ponderation":25},{"critere":"Plan de déploiement et transfert de compétences","ponderation":15}]'),
  ('SANTE', '[{"critere":"Conformité pharmaceutique et autorisations","ponderation":35},{"critere":"Qualité et traçabilité des produits","ponderation":30},{"critere":"Capacité logistique et délais de livraison","ponderation":20},{"critere":"Références","ponderation":15}]'),
  ('TRANSPORT', '[{"critere":"Caractéristiques techniques des véhicules","ponderation":35},{"critere":"Capacité de maintenance et disponibilité","ponderation":30},{"critere":"Références","ponderation":20},{"critere":"Délais de livraison","ponderation":15}]'),
  ('ENERGIE', '[{"critere":"Références de réalisations comparables","ponderation":30},{"critere":"Solution technique proposée","ponderation":35},{"critere":"Personnel et moyens","ponderation":20},{"critere":"Planning et gestion des risques","ponderation":15}]'),
  ('AGRICULTURE', '[{"critere":"Approche technique et durabilité","ponderation":35},{"critere":"Références sectorielles","ponderation":25},{"critere":"Moyens humains et matériels","ponderation":25},{"critere":"Impact environnemental et social","ponderation":15}]'),
  ('PRESTATIONS_INTELLECTUELLES', '[{"critere":"Qualifications et expérience du consultant","ponderation":30},{"critere":"Compréhension des TDR et méthodologie","ponderation":40},{"critere":"Composition et organisation de l''équipe","ponderation":20},{"critere":"Transfert de compétences","ponderation":10}]'),
  ('FOURNITURES_BUREAU', '[{"critere":"Conformité des échantillons et spécifications","ponderation":50},{"critere":"Garantie et service après-vente","ponderation":25},{"critere":"Délais et conditions de livraison","ponderation":25}]'),
  ('SECURITE', '[{"critere":"Agréments et conformité réglementaire","ponderation":30},{"critere":"Effectifs, formation et encadrement","ponderation":30},{"critere":"Références","ponderation":20},{"critere":"Moyens matériels et de communication","ponderation":20}]'),
  ('RESTAURATION', '[{"critere":"Qualité et diversité de l''offre","ponderation":35},{"critere":"Hygiène et sécurité alimentaire","ponderation":30},{"critere":"Références","ponderation":20},{"critere":"Capacité logistique","ponderation":15}]'),
  ('COMMUNICATION', '[{"critere":"Créativité et pertinence de la proposition","ponderation":35},{"critere":"Références et portfolio","ponderation":25},{"critere":"Moyens de production","ponderation":20},{"critere":"Planning et gestion de projet","ponderation":20}]'),
  ('FORMATION', '[{"critere":"Pertinence du programme et pédagogie","ponderation":35},{"critere":"Qualification des formateurs","ponderation":30},{"critere":"Références","ponderation":20},{"critere":"Évaluation et suivi des apprenants","ponderation":15}]')
) AS g(code, criteres) ON g.code = cm.code
ON CONFLICT (code) DO NOTHING;
