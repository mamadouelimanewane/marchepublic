# Matrice de conformité au cahier des charges (v1.0, septembre 2026)

Légende : ✅ implémenté et testé · 🟡 implémenté, non testé en conditions réelles / à valider · ⛔ non réalisé (voir « Reste à faire »).
« Test » renvoie au fichier qui vérifie l'exigence : `supabase/tests/workflow.test.mjs` (SQL, PostgreSQL réel en WASM), `packages/workflow/src/__tests__`, `packages/validators`.

## §2.3 Seuils et plafonds

| Exigence | État | Mise en œuvre | Test |
|---|---|---|---|
| Seuils AOO État/collectivités/EP (70 M / 50 M) et agences/sociétés (100 M / 60 M), paramétrables sans développement | ✅ | `config_seuils` + `seuil_aoo()` ; dérogation par institution (`institutions.seuil_*`) | workflow.test (mode de passation) · domain.test |
| Avenants ≤ 30 % (alerte/blocage) | ✅ | Trigger `check_amendment_limit` (compte les augmentations, pas les moins-values) ; tentative bloquée tracée via `record_blocked_attempt` ; alerte à 80 % du plafond (`v_alertes`) | workflow.test (Phase 13) |
| Sous-traitance ≤ 40 % | ✅ | Trigger `check_subcontractor_limit` | idem |
| Quotas PME/ESS 5 % dont 2 % PME féminines, suivi et reporting | ✅ | `pme_quota_entries` (idempotent) → `pme_quotas_tracking` → `v_quotas_pme` ; marchés réservés contrôlés au dépôt et à l'attribution | workflow.test (Phase 11) |

## §3 et §8 Acteurs, habilitations

| Exigence | État | Mise en œuvre |
|---|---|---|
| 11 rôles, droits par rôle | ✅ | RLS par table + RPC `SECURITY DEFINER` ; rôle lu en base (`users`), jamais depuis un en-tête ni un claim client |
| Aucune offre visible avant l'ouverture, **même par l'ADMIN** | ✅ | `bids_select` (phase ≥ 7) ; contenu chiffré hors plateforme | workflow.test (Phase 6) |
| Étanchéité entre institutions | ✅ | `is_inst_staff()`, `tenders_select` | workflow.test (isolation) |
| Création des comptes institutionnels par l'administrateur uniquement | ✅ | Trigger d'inscription → toujours SOUMISSIONNAIRE ; invitation e-mail par l'admin (service_role) | workflow.test (Sécurité de base) |

## §5 Workflow des 15 phases

| Phase | Règles imposées par la base (triggers, toutes voies d'accès) | Test |
|---|---|---|
| 1 Programmation | Besoin → validation PRM → marché inscrit ; référence séquentielle `MP-CODE-AAAA-NNNN` ; mode calculé, écart justifié, DRP interdite au-delà du seuil | ✅ |
| 2 Rédaction | Modèles TDR/DAO, clauses types, circuit Rédaction → CPM → PRM, versions immuables, critères Σ = 100 | ✅ |
| 3 Contrôle a priori | Dossier verrouillé ; avis DCMP (+ bailleur si cofinancé, dérogation si entente directe) ; avis défavorable → retour en rédaction | ✅ |
| 4-5 Publication, clarifications | Horodatage serveur ; Q&R diffusées sans auteur ; additifs publiés/notifiés ; délai minimal de dépôt par mode | ✅ |
| 6 Dépôt | Chiffrement navigateur (AES-256-GCM + RSA-OAEP), horodatage et accusé par le serveur, remplacement/retrait avant la limite, offre tardive rejetée et tracée | ✅ |
| 7 Ouverture | Double signature CPM + président ; déchiffrement **local** ; contrôle des empreintes SHA-256 ; PV imprimable | ✅ (signature) · ✅ protocole crypto (aller-retour, mauvaise clé, altération : `apps/web/src/lib/crypto.test.ts`) · 🟡 interface de déchiffrement non exercée dans un navigateur réel |
| 8 Évaluation | Notes par ≥ 2 évaluateurs sur offres anonymisées, score recalculé serveur, seuil technique, note financière relative, classement immuable | ✅ |
| 9 Attribution provisoire | Mieux classé, sinon justification tracée ; notification de tous les candidats | ✅ |
| 10 Recours | Dépôt par RPC (candidat recevable, dans le délai) ; décision motivée ARCOP ; **verrou dur** : aucune phase ≥ 11 tant qu'un recours est pendant, même par UPDATE direct ; recours favorable → nouvelle ronde d'évaluation | ✅ |
| 11 Attribution définitive | Délai de recours écoulé, approbation DCMP, quotas PME | ✅ |
| 12 Contrat | Signatures AC + titulaire, visa contrôle financier, garantie de bonne exécution ; **signature bloquée si recours pendant** | ✅ |
| 13 Exécution | OS, incidents, avancement, avenants, sous-traitance | ✅ |
| 14 Réception / paiement | Réception provisoire → définitive ; décomptes plafonnés au montant du contrat ; circuit AC → CF → Trésor | ✅ |
| 15 Clôture | Évaluation du prestataire, archive à empreinte, marché figé | ✅ |

## §9 Exigences non fonctionnelles

| Exigence | État | Mise en œuvre |
|---|---|---|
| Isolation par institution (RLS) | ✅ | Toutes les tables (vérifié automatiquement : test « toutes les tables ont la RLS ») |
| Journal d'audit immuable | ✅ | Écriture seule (triggers anti UPDATE/DELETE/TRUNCATE, aucun droit d'écriture direct) **+ chaînage SHA-256** par institution, vérifiable (`verify_audit_chain`), export CSV |
| Impossibilité de modifier un document transmis/publié | ✅ | `tender_documents_guard`, `tenders_guard` (colonnes verrouillées par phase), tables immuables |
| Chiffrement des offres jusqu'à l'ouverture | ✅ | Clé privée jamais stockée par la plateforme |
| Horodatage qualifié / signature électronique qualifiée | ⛔ | Horodatage **serveur** et accusé par empreinte uniquement (voir ADIE) |
| Loi 2008-12 (données personnelles) | 🟡 | Minimisation et cloisonnement appliqués ; registre des traitements et mentions CDP à produire |
| Interface française, mobile/faible débit | 🟡 | Interface française responsive, pages légères ; application Capacitor non réalisée |
| Haute disponibilité / test de charge | ⛔ | Non testé |

## §11 Reporting

✅ Tableaux de bord (pipeline par phase, délais par phase, alertes), quotas légaux, statistiques sectorielles, taux de litiges, dossiers DCMP en attente, exports CSV. Vues en `security_invoker` (la RLS de l'appelant s'applique).

## §12 Interopérabilité

| Système | État |
|---|---|
| Trésor / SIGFIP | 🟡 Webhook signé HMAC (`supabase/functions/sigfip-webhook`) sur un contrat **proposé**, à aligner sur la spécification SIGFIP réelle |
| ADIE (signature, horodatage qualifié) | ⛔ |
| Portail national (republication des avis) | ⛔ |
| Mobile money (Wave, Orange Money) | ⛔ — l'ancienne modale simulait un paiement réussi : **supprimée** (un faux succès est dangereux) |
| DGID / RCCM | ⛔ — endpoint de simulation, désactivé en production (501) |

## Paramètres juridiques à faire confirmer

Ces valeurs sont paramétrables (`/dashboard/admin`) mais n'ont pas été validées par un juriste des marchés publics :
`DELAI_RECOURS_JOURS` (10), `DELAI_INSTRUCTION_RECOURS_JOURS` (7), délais minimaux de dépôt (AOO 30, AOR 21, DRP 10…), `EVAL_SEUIL_TECHNIQUE` (70), pondération technique/financière (70/30 ; 80/20 prestations intellectuelles), `ARCHIVAGE_DUREE_ANS` (10), ainsi que tous les taux `[●]` des clauses types (garanties, pénalités).

## Compléments (procédure infructueuse, allotissement)

| Exigence | État | Mise en œuvre | Test |
|---|---|---|---|
| Procédure infructueuse | ✅ | Déclaration motivée par le PRM (phase 8), refusée si une offre qualifiée est classée ; clôture sans contrat ; relance en nouveau marché (`relancer_marche`), historique intact | `workflow.test.mjs` |
| Allotissement systématique (CDC §2.2) | ✅ | Dépôt par lot (lot obligatoire sur marché alloti) ; classement, attribution et contrat **par lot** ; lot sans offre qualifiée déclaré infructueux sans bloquer les autres ; quotas PME par lot ; recours sur le marché entier ; plafonds d'avenants/sous-traitance par contrat | `lots.test.mjs` |

Limites de l'allotissement : un recours suspend l'ensemble du marché (pas de recours par lot) ; pas d'attribution cumulée des lots (rabais pour plusieurs lots) ; un lot infructueux ne se relance pas individuellement.

| Exigence | État | Mise en œuvre | Test |
|---|---|---|---|
| Clé d'ouverture sans point de défaillance unique | ✅ | Partage de Shamir k parmi n, reconstitution locale dans le navigateur | `apps/web/src/lib/shamir.test.ts` |
| Génération de PDF (TDR/DAO, PV d'ouverture et de réception, rapport d'évaluation, décision d'attribution, contrat) | ✅ | `/api/pdf/[kind]/[id]` (pdf-lib), lectures sous RLS, pied de page avec empreinte SHA-256 du contenu | `apps/web/src/lib/pdf.test.ts` (validité et pagination ; mise en page non inspectée visuellement) |

## Transparence et intégrité (au-delà du cahier des charges)

| Fonctionnalité | État | Mise en œuvre | Test |
|---|---|---|---|
| Publication OCDS 1.1 | ✅ | `ocds_release`, `ocds_release_package`, `/api/ocds/*` ; préfixe d'ocid à remplacer par le préfixe officiel (paramètre `OCDS_PREFIX`) | `transparence.test.mjs` (validation contre le schéma officiel 1.1.5) |
| Portail public à publicité graduée | ✅ | Vues `v_public_*` (définisseur), pages `/transparence` | idem |
| Alertes de risque + examens immuables | ✅ (règles fixes, seuils paramétrables `RF_*`) ; ⛔ apprentissage automatique (exige un volume réel de données) | `v_red_flags`, `v_risk_scores`, `review_red_flag` | idem |
| Signalements citoyens | ✅ | `submit_citizen_report` (anonyme, débit limité), suivi par code, traitement par les régulateurs | idem |
| Ancrage du journal d'audit | ✅ publication quotidienne ; ⛔ horodatage externe qualifié (RFC 3161) | `anchor_audit_chain`, `verify_audit_anchors`, `v_audit_anchors` | idem (attaque par réécriture complète) |

Positionnement : la plateforme nationale APPEL (ARCOP, octobre 2025) existe ; ces fonctions font de cette application une couche de contrôle, de transparence et d'inclusion interopérable via OCDS.

## Inclusion des PME

| Fonctionnalité | État | Mise en œuvre | Test |
|---|---|---|---|
| Dossier permanent du fournisseur | ✅ | `supplier_documents`, `supplier_pieces`, stockage privé, vérification ADMIN/DCMP, alertes d'expiration | `inclusion.test.mjs` |
| Alertes d'appels d'offres | ✅ file d'envoi, ciblage, éligibilité ; 🟡 envoi réel non vérifié (SMTP/opérateurs non disponibles ici) | `tender_alert_subscriptions`, `outbox_messages`, `/api/cron/maintenance` | `inclusion.test.mjs` |
| Vérification automatique NINEA/RCCM/quitus auprès de la DGID | ⛔ | Les pièces sont vérifiées manuellement ; le connecteur DGID exige un accès |  |
| Mode faible débit / hors ligne | 🟡 service worker limité aux pages publiques ; non éprouvé sur appareil | `public/sw.js`, `/hors-ligne` |  |
| Historique de performance des prestataires | ✅ | `respond_to_evaluation`, `supplier_track_record`, `v_public_prestataires` (agrégat ≥ 3), évaluations immuables | `inclusion.test.mjs` |
| Catalogue d'accords-cadres (achats récurrents) | ✅ | `0018` : `create_framework_agreement`, `catalog_attribute_defs`, `place_call_off`, `progress_call_off`, plafond et hausse de prix en base, vues publiques | `catalogue.test.mjs` |
| Aide à la rédaction TDR/DAO (variables, guides, contrôle qualité, validation conditionnée) | ✅ | `0019` : `document_blocking_issues` + garde du circuit ; `domain/redaction.ts` (linter, parité testée) | `redaction.test.ts`, `redaction-parity.test.ts`, `workflow.test.mjs` |
| Assistant IA de rédaction (proposition + relecture) | ✅ | `0020` : `claim_ai_request` (droits, verrouillage, quota), journal `ai_requests` ; prompts à saisies délimitées | `assistant.test.mjs`, `ai.test.ts` |
