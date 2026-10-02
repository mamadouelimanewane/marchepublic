# 4. Manuel — PRM (Personne responsable des marchés)

**Votre rôle.** Autorité contractante : vous validez, vous décidez et vous signez. La plateforme vous réserve les décisions que la réglementation ne permet pas de déléguer.
**Votre menu :** Marchés · Alertes · Programmation · Rédaction · Publication · Ouverture & évaluation · Attribution · Recours · Contrats & exécution · Réception & paiements · Catalogue · Archivage · Reporting · Alertes de risque · Journal d'audit.

## Phase 1 — Valider les besoins et programmer
Menu **Programmation / PPM** :
1. Examinez chaque besoin soumis ; **Valider** (le marché est inscrit au PPM avec sa référence `MP-CODE-AAAA-NNNN`, et le mode de passation réglementaire est calculé) ou **Rejeter** avec un motif.
2. Sur la **fiche du marché**, cliquez **Valider l'inscription au PPM** pour ouvrir la rédaction.
3. **Exporter le PPM** de l'année : Excel, PDF ou CSV.

> Si vous retenez un mode de passation différent du mode réglementaire (par exemple une DRP au-delà du seuil, ou une entente directe), une **justification** (20 caractères minimum) est obligatoire ; la DRP est refusée au-delà du seuil.

## Phase 2 — Valider les documents
Menu **Rédaction TDR / DAO** : pour un document « transmis à la CPM », cliquez **Valider (PRM)**. La base **refuse** la validation tant que le document contient un `[●]`, une section obligatoire vide ou une clause type obligatoire manquante (message `DOCUMENT_INCOMPLETE`).
Ensuite, sur la fiche du marché : fixez les **critères d'évaluation** (somme = 100) puis **Transmettre à la DCMP** (le dossier est alors verrouillé).

## Phases 4 à 8 — Suivi
Vous suivez la publication et le dépôt, et vous pouvez remplacer le CPM pour la plupart des actions. Vous **ne pouvez pas** lire les offres avant l'ouverture. En cas d'absence d'offre qualifiée à la phase 8, vous pouvez **Déclarer la procédure infructueuse** (motivation obligatoire).

## Phase 9 — Attribution provisoire
Menu **Attribution** :
1. Consultez le **classement** calculé par le serveur (scores techniques, financiers, global ; par lot si le marché est alloti).
2. **Prononcer l'attribution provisoire** : l'offre retenue est, par défaut, la mieux classée. Choisir une autre offre qualifiée exige une **justification d'au moins 30 caractères**, tracée dans le journal d'audit.
3. Tous les candidats sont notifiés ; le **délai de recours** s'ouvre.

## Phase 10 — Recours
Pendant le délai, un recours suspend la procédure : l'icône 🔒 *Recours pendant* apparaît et **rien ne peut avancer** (verrou dans la base). Pour un marché alloti, un recours peut ne viser **qu'un lot** ; une décision favorable de l'ARCOP ne rouvre alors que ce lot, mais le marché reste en phase 10 tant qu'un recours est pendant.
Sans recours à l'expiration du délai : **Clore la période de recours**.

## Phases 11 et 12 — Attribution définitive et contrat
1. La DCMP rend son avis d'approbation, puis **Confirmer l'attribution définitive** (les quotas PME/ESS sont calculés).
2. Menu **Contrats & exécution** : préparez le contrat (un contrat **par lot** attribué), **Signer (autorité contractante)** ; le titulaire signe de son côté ; le contrôleur financier appose son visa ; enregistrez la **garantie de bonne exécution**.
3. Quand tout est réuni, **Lancer l'exécution**. Le bouton reste grisé tant qu'un élément manque ; la liste de ce qui manque s'affiche au-dessus.

## Phases 13 à 15 — Exécution et clôture
- **Avenants** : numéro, montant (négatif = moins-value), motif. Le cumul des augmentations est limité à **30 %** du montant initial ; une alerte apparaît à 80 % du plafond.
- **Sous-traitance** : déclarez le sous-traitant (NINEA, objet, montant) ; plafond **40 %**.
- **Réception & paiements** : *Passer en réception / paiement*, puis *Clôturer le marché (phase 15)* après réception définitive ; **évaluez le prestataire** (qualité, délais, coût sur 10) — l'évaluation est immuable et alimente la base de référence.
- **Archivage** : *Archiver* le dossier clos.

## Reporting et contrôle
**Reporting & statistiques** : pipeline par phase, délais moyens par phase, montants par corps de métier, quotas légaux PME/ESS. **Alertes de risque** : signaux automatiques sur vos marchés (délais anormalement courts, attributaire récurrent, avenants proches du plafond…) ; vous pouvez consigner un examen.
