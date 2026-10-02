# 13. Parcours de recette — un marché de bout en bout

Objectif : dérouler un marché complet avec les comptes de démonstration, pour vérifier l'application **dans l'interface** (les règles de gestion sont déjà couvertes par des tests automatiques sur la base de données ; l'interface, elle, n'a pas encore été éprouvée par des utilisateurs).

**Avant de commencer**
- Utilisez un **environnement de démonstration**, pas la production.
- Comptes `@demo.sn` fournis par l'administrateur : `admin`, `prm`, `cpm`, `demandeur`, `eval1`, `eval2`, `eval3`, `tresor`, `dcmp`, `arcop`, `bailleur`, `cdc`, `pme1`, `entreprise2`, `entreprise3`.
- Une fenêtre de **navigation privée par rôle** évite de se déconnecter à chaque étape.
- Pour chaque anomalie, notez : étape, compte, ce que vous attendiez, ce que vous avez vu (message exact et capture).

## Déroulé

| # | Compte | Action | Résultat attendu |
|---|---|---|---|
| 1 | `demandeur` | Programmation → *Exprimer un besoin*, puis *Soumettre au PRM* | Besoin « Soumis » |
| 2 | `prm` | Programmation → **Valider** le besoin | Marché créé, référence `MP-…`, au PPM |
| 3 | `prm` | Fiche du marché → *Valider l'inscription au PPM* | Phase 2 |
| 4 | `demandeur` | Rédaction → créer un TDR depuis un modèle ; compléter les `[●]` ; contrôle qualité sans bloquant ; *Transmettre à la CPM* | Document en relecture |
| 5 | `prm` | Tenter *Valider (PRM)* avec un `[●]` oublié | **Refus** `DOCUMENT_INCOMPLETE` ; puis succès une fois complété |
| 6 | `cpm` | Fiche du marché : critères (somme 100), commission (`eval1` président, `eval2`, `eval3`), calendrier (date limite courte pour l'essai), **clé de chiffrement partagée 2 parmi 3** ; conserver les parts | Calendrier et clé enregistrés |
| 7 | `prm` | *Transmettre à la DCMP* | Dossier verrouillé, phase 3 |
| 8 | `dcmp` | Contrôle a priori → avis **favorable** | Phase 4 |
| 9 | `cpm` | *Publier l'avis* puis *Ouvrir le dépôt* | Avis visible sur la page publique |
| 10 | `pme1` | Retirer le dossier ; poser une question | Question sans nom d'auteur visible des autres |
| 11 | `cpm` | Répondre ; publier un additif | Réponse visible de tous les candidats |
| 12 | `pme1`, `entreprise2` | **Déposer une offre** (deux candidats) | Accusé de réception horodaté |
| 13 | `entreprise3` | Date limite passée mais dépôt pas encore clôturé (phase 6) : tenter de déposer | **Refus** et incident tracé |
| 14 | `cpm` | *Clôturer le dépôt* ; consulter le type de séance ; **registre de présence** | Phase 7 |
| 15 | `cpm`, `eval1` | Signer l'ouverture (chacun) | Ouverture effective seulement après les **deux** signatures |
| 16 | `cpm` + 2 détenteurs de parts | Déchiffrement local ; conformité administrative ; montants lus | Offres lisibles, empreintes conformes |
| 17 | `pme1` | Séance publique : *Lecture des offres* | Les 2 offres, montants lus visibles ; `entreprise3` ne voit rien |
| 18 | `eval2`, `eval3` | Noter les deux offres (anonymisées) | Notes enregistrées |
| 19 | `cpm` | *Finaliser l'évaluation* | Classement calculé par le serveur |
| 20 | `prm` | Attribution provisoire (essayer un autre candidat **sans** justification) | **Refus** `JUSTIFICATION_REQUIRED` ; puis attribution au mieux classé |
| 21 | candidat non retenu | Former un **recours** (si marché alloti : choisir le lot) | Marché suspendu, 🔒 *Recours pendant* |
| 22 | `prm` | Tenter *Clore la période de recours* | **Refus** `HARD_LOCK_APPEAL` |
| 23 | `arcop` | **Rejeter** le recours (motivation) | Verrou levé |
| 24 | `prm`, `dcmp` | Clore le délai ; avis d'approbation ; *Confirmer l'attribution définitive* | Phase 12 |
| 25 | `prm`, titulaire, `tresor` | Contrat : préparer, signer (autorité et titulaire), visa du contrôle financier, garantie, *Lancer l'exécution* | Phase 13 |
| 26 | `cpm` | Ordre de service ; avenant de **40 %** | **Refus** `AVENANT_LIMIT_EXCEEDED` ; un avenant de 10 % passe |
| 27 | titulaire, `cpm`, `tresor` | Décompte → *Valider (AC)* → *Visa CF* → *Transmettre au Trésor* → *Marquer payé* | Circuit complet |
| 28 | `cpm`, `prm` | PV de réception provisoire puis définitive ; évaluation du prestataire ; *Clôturer le marché* | Phase 15 |
| 29 | `cpm` | Archivage | Dossier archivé |
| 30 | `dcmp`, `cdc` | Journal d'audit : filtrer, exporter, **vérifier la chaîne** ; PPM en Excel et PDF | Chaîne intacte ; fichiers lisibles |

## Variantes à jouer ensuite
1. **Marché alloti à 3 lots** : un candidat gagne un lot et conteste un autre ; décision favorable de l'ARCOP → seul ce lot est réévalué, les autres gardent leur attribution.
2. **Procédure infructueuse** : aucune offre au-dessus du seuil technique → *Déclarer infructueuse* → *Relancer le marché*.
3. **Marché réservé PME** : une grande entreprise ne peut pas déposer.
4. **Séance restreinte** (mode AOR ou DRP) : aucune lecture des offres communiquée aux candidats.
5. **Étanchéité** : un candidat n'ayant rien déposé ne voit aucune offre ni aucun montant ; l'administrateur non plus avant l'ouverture.
6. **Assistant IA** (si activé) : rédiger un TDR complet pour un métier, relire, appliquer les propositions.

## Critères d'acceptation (extraits du cahier §14.2)
- Chaque étape respecte l'ordre du cycle de vie et les droits du rôle.
- Aucune offre n'est visible avant l'ouverture, pour aucun profil.
- Les seuils, plafonds (30 %, 40 %) et quotas PME sont appliqués.
- Un marché complet est joué sur **au moins un cas par mode de passation** retenu pour le pilote.
- Les anomalies relevées sont classées (bloquante, majeure, mineure) et corrigées avant la mise en service.
