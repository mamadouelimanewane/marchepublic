# Inventaire des fonctionnalités et comparaison avec le cahier des charges (v1.0, septembre 2026)

Site : https://marchepublic-eight.vercel.app — état au dépôt `main`, migrations 0001 à 0020.

**Légende** : ✅ réalisé et vérifié par des tests automatiques · 🟡 réalisé en partie, ou non vérifié en conditions réelles · ⛔ non réalisé.

**Ce que « vérifié » veut dire ici.** Les règles de gestion (base de données) sont couvertes par 64 tests sur PostgreSQL ; les migrations ont été appliquées sur un vrai Supabase. En revanche, **aucun écran n'a encore été parcouru dans un navigateur par un utilisateur** : la mise en page, les parcours et l'interface de déchiffrement des offres restent à éprouver. Le site en ligne est un projet d'essai (comptes de démonstration).

---

## Partie A — Inventaire complet des fonctionnalités

### A1. Comptes, rôles, sécurité
- Inscription des soumissionnaires ; comptes institutionnels créés uniquement par l'administrateur (jamais par auto-inscription).
- 11 rôles : service demandeur, CPM, PRM, évaluateur, DCMP, ARCOP, Trésor/contrôleur financier, soumissionnaire, Cour des Comptes, bailleur, administrateur.
- Menu et accès par rôle ; les droits réels sont imposés par la base (sécurité par ligne, fonctions sécurisées), pas par l'interface.
- Isolation des données par institution.
- Aucune offre lisible avant l'ouverture des plis, y compris par l'administrateur.

### A2. Programmation (phase 1)
- Expression de besoin par le service demandeur, validation/rejet motivé par le PRM, inscription au PPM.
- Référence séquentielle `MP-CODE-AAAA-NNNN`.
- Plan de passation annuel, export Excel, PDF et CSV, alerte de retard par rapport au calendrier prévisionnel.

### A3. Rédaction des TDR / DAO (phase 2)
- Bibliothèque : 43 modèles de TDR sectoriels (un par corps de métier) et 4 modèles génériques, modèles de DAO par mode de passation, 12 clauses types, grilles d'évaluation types par corps de métier.
- Calcul automatique du mode de passation selon montant, nature et type d'entité ; justification obligatoire si l'on s'écarte du mode réglementaire ; DRP refusée au-delà du seuil.
- Alerte d'allotissement recommandé.
- Circuit rédaction → relecture CPM → validation PRM ; versions immuables avec empreinte ; commentaires ; verrouillage à la transmission à la DCMP.
- **Aide à la rédaction** : variables de fusion remplies depuis le marché et le besoin, consignes par section, guides (objectif, points à couvrir, exemple, erreurs fréquentes), contrôle qualité en direct avec score, insertion des clauses obligatoires en un clic.
- **Validation PRM refusée en base** tant qu'il reste un texte à compléter, une section obligatoire vide ou une clause obligatoire manquante (DAO).
- **Assistant IA** (facultatif, activé par une clé serveur) : rédaction ou amélioration d'une section, relecture critique ; quota quotidien et journal en base.
- Grille d'évaluation du marché : pondérations dont la somme doit faire 100.
- Allotissement : lots avec montant, dépôt, classement, attribution et contrat par lot.

### A4. Contrôle a priori (phase 3)
- Transmission à la DCMP, avis de non-objection (et du bailleur si cofinancement), dérogation obligatoire pour l'entente directe ; avis défavorable = retour en rédaction.

### A5. Publication et clarifications (phases 4–5)
- Avis public (`/avis`), délai minimal de dépôt par mode de passation, horodatage serveur.
- Retrait du dossier par le candidat (registre `dossier_retraits`).
- Questions-réponses : questions anonymisées, réponses diffusées à tous ; additifs publiés et notifiés.

### A6. Dépôt des offres (phase 6)
- Chiffrement dans le navigateur (AES-256-GCM + RSA-OAEP 3072) ; la clé privée n'est jamais stockée par la plateforme.
- Accusé de réception horodaté par le serveur ; remplacement ou retrait avant la limite ; offre tardive rejetée et tracée.
- Dépôt par lot sur un marché alloti ; contrôle des marchés réservés PME.

### A7. Ouverture des plis (phase 7)
- Double signature (CPM + président) ; déchiffrement local dans le navigateur ; contrôle des empreintes SHA-256 ; procès-verbal.
- Clé d'ouverture partagée (Shamir k parmi n) pour éviter un point de défaillance unique.

### A8. Évaluation (phase 8)
- Notes de chaque évaluateur (au moins 2) sur offres anonymisées, score recalculé côté serveur, seuil technique, note financière relative, classement immuable.
- Procédure infructueuse (déclaration motivée, clôture, relance en nouveau marché).

### A9. Attribution et recours (phases 9–11)
- Attribution provisoire (justification si l'offre n'est pas la mieux classée), notification de tous les candidats.
- Recours par un candidat recevable dans le délai, **par lot ou sur le marché entier** (une décision favorable sur un lot ne rouvre que ce lot), décompte du délai légal, instruction et décision motivée de l'ARCOP.
- **Verrou dur** : aucun passage en phase 11 ni signature de contrat tant qu'un recours est pendant, même par écriture directe en base.
- Attribution définitive après purge des recours, approbation, vérification des quotas PME.

### A10. Contrat, exécution, réception, paiement, clôture (phases 12–15)
- Contrat à partir de clauses types, signatures AC et titulaire, visa du contrôle financier, garanties (soumission, bonne exécution, avance de démarrage) avec alerte d'expiration.
- Ordres de service, incidents, avancement ; avenants plafonnés à 30 % ; sous-traitance plafonnée à 40 % ; tentatives bloquées tracées.
- Commission de réception, réception provisoire puis définitive, décomptes plafonnés au montant du contrat, circuit AC → contrôle financier → Trésor.
- Clôture : évaluation du prestataire, archive à empreinte, marché figé.
- Documents PDF : TDR/DAO, PV d'ouverture, rapport d'évaluation, décision d'attribution, PV de réception, contrat (avec empreinte SHA-256).

### A11. Contrôle, reporting, audit
- Tableaux de bord : pipeline par phase, délais moyens par phase, alertes, quotas PME/ESS (5 % dont 2 % féminines), statistiques sectorielles, litiges par autorité, dossiers DCMP en attente, paiements.
- Exports CSV ; journal d'audit consultable et exportable.
- Journal d'audit en écriture seule avec **chaînage SHA-256** vérifiable et ancrage quotidien publié.
- Alertes de risque (règles paramétrables) avec examens immuables.

### A12. Fonctions ajoutées (hors cahier des charges)
- Publication de données ouvertes **OCDS 1.1** (validée contre le schéma officiel) et portail de transparence public à publicité graduée.
- Signalements citoyens anonymes avec suivi par code.
- Dossier permanent du fournisseur (pièces, vérification, alertes d'expiration), alertes d'appels d'offres, historique de performance des prestataires avec droit de réponse et moyennes publiques (à partir de 3 évaluations).
- Catalogue électronique d'accords-cadres (attributs standardisés, commandes plafonnées, prix publics).
- Application installable (PWA) avec pages publiques hors ligne.

---

## Partie B — Comparaison avec le cahier des charges

### §2 Cadre réglementaire et seuils
| Exigence | État | Commentaire |
|---|---|---|
| Seuils AOO (70/50 M État ; 100/60 M agences), paramétrables sans développement | ✅ | Écran d'administration ; dérogation possible par institution |
| Avenants ≤ 30 %, alerte | ✅ | Blocage en base + alerte à 80 % |
| Sous-traitance ≤ 40 % | ✅ | |
| Quotas 5 % PME/ESS dont 2 % PME féminines, suivi automatisé | ✅ | |
| Paramètres juridiques (délais de recours 10 j, archivage 10 ans, etc.) | 🟡 | Paramétrables mais **non validés par un juriste** |

### §3–4 Acteurs, natures, modes, corps de métiers
| Exigence | État | Commentaire |
|---|---|---|
| 10 types d'acteurs + administrateur | ✅ | Le bailleur et la Cour des Comptes sont en lecture/avis |
| Travaux, fournitures, services, prestations intellectuelles | ✅ | |
| Délégations de service public et PPP | 🟡 | Existent comme **nature** de marché, mais sans procédure dédiée (concession, partage des risques) |
| 7 modes de passation (AOO, AOR, 2 étapes, concours, DRP, entente directe, accords-cadres) | ✅ | Accords-cadres : catalogue et commandes en plus |
| Nomenclature de 12 corps de métiers, paramétrable | ✅ | |

### §5 Workflow des 15 phases
| Phase | État | Commentaire |
|---|---|---|
| 1 Programmation | ✅ | |
| 2 Élaboration TDR/DAO | ✅ | |
| 3 Validation et contrôle a priori | ✅ | |
| 4 Publication | 🟡 | Publication sur la plateforme et en données ouvertes ; pas de republication automatique sur le portail national |
| 5 Retrait et clarifications | ✅ | |
| 6 Dépôt des offres | ✅ | Horodatage **serveur**, pas qualifié |
| 7 Ouverture des plis | 🟡 | Protocole vérifié par tests ; interface de déchiffrement jamais exercée dans un navigateur réel ; pas de distinction « séance publique / restreinte » |
| 8 Évaluation | ✅ | |
| 9 Attribution provisoire | ✅ | |
| 10 Recours | ✅ | Recours sur le marché entier, pas par lot |
| 11 Attribution définitive | ✅ | |
| 12 Contrat | ✅ | Signature simple (pas de signature électronique qualifiée) |
| 13 Exécution | ✅ | |
| 14 Réception et paiement | ✅ | Pas de paiement réel (aucune passerelle) |
| 15 Clôture et archivage | ✅ | Durée d'archivage à confirmer juridiquement |

### §6 Modules fonctionnels
| Module | État | Écart éventuel |
|---|---|---|
| Programmation et PPM | ✅ | Export du plan en Excel (.xlsx), PDF et CSV |
| Rédaction | ✅ | Édition collaborative **asynchrone** (circuit + commentaires), pas d'édition simultanée en temps réel |
| Publication et gestion des AO | 🟡 | Pas de publication multicanal (portail national, affichage) |
| Dépôt et ouverture | ✅ | Offres retirées et tardives gérées |
| Évaluation et attribution | ✅ | |
| Recours et contentieux | ✅ | |
| Contrat et exécution | ✅ | |
| Réception et paiement | ✅ | |
| Archivage et audit | ✅ | Coffre-fort à empreintes ; conformité d'archivage légal à valider |

### §7 Rédaction assistée
| Exigence | État |
|---|---|
| Bibliothèque de TDR par corps de métier, DAO par mode, clauses types obligatoires | ✅ |
| Assistant de qualification (seuil, mode, alerte d'allotissement) | ✅ |
| Suggestion de critères d'évaluation types par corps de métier | ✅ |
| Circuit de validation, historique des versions et des commentaires | ✅ |
| Verrouillage dès la transmission à la DCMP | ✅ |
| *(ajout)* variables, guides, contrôle qualité bloquant, assistant IA | ✅ |

### §8 Habilitations
| Exigence | État | Commentaire |
|---|---|---|
| Matrice des droits par rôle | ✅ | Vérifiée par tests (droits refusés, étanchéité entre institutions) |
| Offres invisibles avant l'ouverture officielle | ✅ | Test d'étanchéité sur toutes les tables et vues |

### §9 Exigences non fonctionnelles
| Exigence | État | Commentaire |
|---|---|---|
| Isolation par institution (RLS) | ✅ | |
| Chiffrement des offres jusqu'à l'ouverture | ✅ | |
| Journal d'audit immuable, exportable | ✅ | Chaîné et ancré |
| Impossibilité de modifier un document transmis ou publié | ✅ | |
| **Signature électronique et horodatage qualifiés** | ⛔ | Horodatage serveur seulement ; nécessite un prestataire de confiance ou l'ADIE |
| Loi 2008-12 sur les données personnelles | 🟡 | Minimisation et cloisonnement en place ; registre des traitements et déclaration à la CDP à produire |
| Interface française, adaptée aux faibles débits | 🟡 | Responsive et pages légères ; PWA non éprouvée sur appareil |
| **Application mobile compagnon (Capacitor)** | ⛔ | Remplacée par une application web installable (PWA) |
| Haute disponibilité, **test de charge** | ⛔ | Non testés |
| **Hébergement conforme à la souveraineté des données** | ⛔ | Actuellement hébergé aux **États-Unis** (Vercel Washington, Supabase us-east-1) ; à revoir avant toute mise en service réelle |

### §11 Reporting
| Exigence | État |
|---|---|
| Tableaux de bord PRM/CPM, DCMP, ARCOP | ✅ |
| Quotas PME/PME féminines vs 5 % / 2 % | ✅ |
| Statistiques par corps de métier, mode, autorité | ✅ |
| Délais moyens par phase (goulots d'étranglement) | ✅ |

### §12 Interopérabilité
| Système | État | Commentaire |
|---|---|---|
| Trésor / SIGFIP | 🟡 | Webhook signé sur un contrat **proposé**, à aligner sur la spécification réelle |
| ADIE (signature, horodatage) | ⛔ | |
| Portail national (republication automatique) | ⛔ | Données ouvertes OCDS disponibles pour l'interconnexion |
| Mobile money (frais de dossier, cautionnement) | ⛔ | L'ancienne simulation de paiement a été supprimée volontairement |
| DGID / RCCM | ⛔ | Vérification manuelle des pièces ; endpoint de simulation désactivé en production |

### §13–14 Déploiement, livrables, recette
| Exigence | État | Commentaire |
|---|---|---|
| Plateforme déployée (back-office, portail public) | 🟡 | En ligne en projet d'essai, sans parcours utilisateur éprouvé |
| Spécifications fonctionnelles détaillées, maquettes | ⛔ | Seules l'architecture et la matrice de conformité existent |
| Manuels utilisateurs par profil, plan de formation | 🟡 | Rédigés (`docs/manuels/` : 11 manuels, plan de formation, parcours de recette) d'après le code ; **captures d'écran à ajouter** après la première recette utilisateur, formation à dispenser |
| Recette : un marché complet de bout en bout par mode de passation | 🟡 | Parcours complet testé en base pour un marché ouvert, plus l'infructueux et l'allotissement ; pas un cas par mode |
| Recette : étanchéité avant ouverture | ✅ | Test automatique ; **pas de test d'intrusion externe** |
| Recette : seuils et quotas | ✅ | |
| Recette : test de charge | ⛔ | Seul un test léger des pages publiques a été fait (`scripts/load-public.mjs` : 300 requêtes, 0 échec, médiane ≈ 300 ms, p95 ≤ 1,7 s). Le test exigé, celui de la clôture de dépôt (dépôts authentifiés simultanés), reste à faire sur un environnement dédié |

---

## Partie C — Bilan

### Décompte (68 lignes évaluées de la partie B)
| État | Nombre |
|---|---|
| ✅ Conforme | 47 |
| 🟡 Partiel ou non éprouvé | 11 |
| ⛔ Non réalisé | 10 |

### Les écarts qui comptent le plus, par ordre de priorité
1. **Souveraineté des données** (⛔) : hébergement aux États-Unis. Décision d'hébergement à prendre avant toute donnée réelle.
2. **Parcours utilisateur jamais éprouvé** (🟡) : à faire en priorité avec les comptes de démonstration ; c'est là que se trouveront les défauts restants.
3. **Signature et horodatage qualifiés** (⛔) : dépend d'un prestataire de confiance ou de l'ADIE ; condition de la valeur probante.
4. **Validation juridique des paramètres** (🟡) : délais, seuils, archivage, publication des moyennes de prestataires.
5. **Test d'intrusion et test de charge** (⛔) : exigés par les critères de recette.
6. **Interconnexions** (⛔/🟡) : SIGFIP, ADIE, portail national, DGID, mobile money — chacune exige un accès ou une spécification que seules ces institutions fournissent.
7. **Documentation et formation** (🟡) : manuels et plan de formation rédigés, à illustrer et valider en recette ; spécifications fonctionnelles détaillées et maquettes restent à produire.
8. **Écarts de périmètre réalisables sans tiers** : procédure propre aux DSP/PPP.
9. **Application mobile native (Capacitor)** : la PWA couvre l'essentiel du besoin ; la version native reste à décider.

### Ce que l'application fait en plus du cahier des charges
Données ouvertes OCDS, alertes de risque, signalements citoyens, ancrage du journal d'audit, dossier permanent et alertes d'appels d'offres pour les PME, historique de performance des prestataires, catalogue d'accords-cadres, partage de la clé d'ouverture (Shamir), procédure infructueuse, allotissement complet, aide à la rédaction et assistant IA.

### Dépendances : état de l'audit de sécurité (`npm audit`)
Sept alertes subsistent, toutes dans l'outillage de développement ou de compilation, jamais dans le code qui traite des données d'utilisateurs :
`vitest` (« critique », uniquement lorsque son interface web de développement est lancée, ce qui n'est jamais le cas), `vite`, `esbuild`, `vite-node`, `@vitest/mocker`, et `postcss` embarqué par `next` (traitement de CSS contrôlé par un attaquant à la compilation). Leur correction passe par des montées de version majeures (vitest 5, next 16) à planifier avec les tests de non-régression. Corrigées : `nodemailer` (6 → 10) et `sharp` (dépendance inutile retirée).
