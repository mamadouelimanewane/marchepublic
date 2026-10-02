# 7. Manuel — ARCOP (régulation et recours)

**Votre rôle.** Instruire et trancher les recours, surveiller les risques, traiter les signalements citoyens et accéder au journal d'audit.
**Votre menu :** Marchés · Alertes · Ouverture & évaluation · Attribution · Recours · Catalogue · Archivage · Reporting · Alertes de risque · Signalements citoyens · Journal d'audit.

## A. Instruire un recours (phase 10)
Menu **Recours** → *Dossiers contentieux* (le nombre de dossiers en cours est affiché). Chaque dossier indique le marché, le **périmètre** (un lot précis ou le marché entier), le requérant, la date de dépôt, la **date limite d'instruction** (7 jours par défaut), le motif et le développement.

Pour chaque dossier en cours, le formulaire propose :
- **Mettre en instruction** (la décision finale reste à prendre) ;
- **Irrecevable** ou **Rejeté** — motivation obligatoire (20 caractères minimum) ;
- **Favorable** ou **Partiellement favorable** — motivation obligatoire. La décision **rouvre l'évaluation** :
  - recours sur **un lot** : seul ce lot est réévalué dans une nouvelle ronde ; les autres lots gardent leur attribution ;
  - recours sur le **marché entier** : tous les lots sont réévalués.

> **Règles à connaître.**
> - Une décision **favorable** n'est possible que lorsque le marché est en phase 10. Si le marché est déjà en réévaluation, tranchez les autres recours en *rejet* / *irrecevable*, ou attendez son retour en phase 10 (message `INVALID_STATE`).
> - Tant qu'un recours est pendant, la base **interdit** l'attribution définitive et la signature du contrat, quelle que soit la voie d'accès.
> - Les parties sont notifiées de votre décision.

## B. Surveillance
- **Alertes de risque** : signaux automatiques (par exemple délai de dépôt très court, offre unique, gagnant récurrent, avenants proches du plafond). Ouvrez un signal, consignez un **statut** et une **note** : l'examen est conservé et ne peut être modifié.
- **Signalements citoyens** : les signalements anonymes déposés sur le portail public arrivent ici ; mettez à jour leur **nouvel état** et ajoutez une **note interne**. Le citoyen suit son dossier avec son code, sans jamais révéler son identité.
- **Reporting** : contentieux par autorité contractante, recours en cours, taux de litiges.

## C. Journal d'audit
Menu **Journal d'audit** : toutes les actions, filtrables par action et par type d'entité, exportables en CSV. La **vérification de la chaîne** recalcule les empreintes ; un résultat vide signifie que la chaîne est intacte, une ligne signale le premier maillon rompu. Des empreintes d'ancrage sont publiées chaque jour sur le portail public.
