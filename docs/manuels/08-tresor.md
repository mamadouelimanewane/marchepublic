# 8. Manuel — Contrôleur financier / Trésor

**Votre rôle.** Apposer le visa budgétaire sur les contrats et traiter les paiements.
**Votre menu :** Marchés · Alertes · Contrats & exécution · Réception & paiements.

## A. Visa du contrat (phase 12)
Menu **Contrats & exécution** → le marché :
1. Vérifiez le contrat (montant, lot, titulaire, signatures).
2. Quand l'autorité contractante a signé, le bouton **Apposer le visa du contrôle financier** apparaît : cliquez pour viser. Il n'est proposé qu'**après** la signature de l'autorité.
3. Le PRM peut alors, une fois la garantie de bonne exécution enregistrée, lancer l'exécution.

## B. Circuit de paiement (phases 13 et 14)
Menu **Réception & paiements** → *Décomptes et paiements*. Un décompte suit ces états :

| État | Qui agit | Bouton |
|---|---|---|
| Soumis (par le titulaire) | CPM / PRM | **Valider (AC)** |
| Validé par l'autorité | **Vous** | **Visa CF** |
| Visé par le contrôle financier | **Vous** | **Transmettre au Trésor** (saisir la référence SIGFIP si disponible) |
| Transmis au Trésor | **Vous** | **Marquer payé** (confirmation demandée) |

À tout moment avant paiement, **Rejeter** avec un **motif** (5 caractères minimum). Le **montant cumulé des décomptes ne peut pas dépasser le montant du contrat** : la base refuse un décompte excédentaire.

## C. Suivi
Le menu **Alertes** signale notamment les **paiements en attente**. La plateforme n'exécute **aucun paiement réel** : « Marquer payé » enregistre un paiement effectué par ailleurs ; la liaison automatique avec le SIGFIP reste à mettre en place.
