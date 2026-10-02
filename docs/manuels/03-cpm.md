# 3. Manuel — CPM (Cellule de passation des marchés)

**Votre rôle.** Préparer les dossiers, conduire le calendrier de la procédure, publier, répondre aux candidats, organiser l'ouverture des plis et assurer le secrétariat de la commission.
**Votre menu :** Marchés · Alertes · Programmation · Rédaction · Publication & Q/R · Ouverture & évaluation · Attribution · Recours · Contrats & exécution · Réception & paiements · Catalogue · Archivage · Reporting · Journal d'audit.

## Phase 2 — Relecture des documents
Dans **Rédaction TDR / DAO**, ouvrez les documents « transmis à la CPM » : lisez, **commentez** (les commentaires sont conservés) puis **Renvoyer en rédaction** ou laissez le PRM valider. Vérifiez en particulier le contrôle qualité (points bloquants) et les clauses obligatoires du DAO.

## Préparer le marché (fiche du marché → *Calendrier et chiffrement des offres*)
1. **Calendrier** : date de publication, date limite de dépôt (respectez le délai minimal du mode de passation : la base refuse un délai trop court).
2. **Critères d'évaluation** : pondérations dont la somme doit faire **100**, et seuil technique.
3. **Lots** (marché alloti) : *Ajouter le lot* avec numéro, libellé et montant estimé.
4. **Commission des marchés** : *Ajouter à la commission* (président, membres, observateurs).
5. **Clé de chiffrement** : générez la paire de clés du marché. Deux modes :
   - *clé simple* : une seule clé privée à conserver ;
   - *clé partagée (k parmi n)* : plusieurs personnes détiennent une part ; il en faut *k* pour ouvrir. **Conservez les parts hors de la plateforme**, qui ne les stocke jamais. Sans elles, les offres sont définitivement illisibles.

## Phases 4 et 5 — Publication et clarifications
Menu **Publication & Q/R** :
- **Publier l'avis d'appel d'offres** (après l'avis favorable de la DCMP). L'avis apparaît sur la page publique des avis.
- **Répondre** aux questions : la réponse est diffusée à **tous** les candidats, **sans nom d'auteur** (*Publier la réponse*).
- **Additifs au dossier** : *Publier l'additif* ; les candidats sont notifiés.
- **Ouvrir le dépôt des offres** au moment prévu par le calendrier.

## Phases 6 et 7 — Dépôt et ouverture
1. Après la date limite : **Clôturer le dépôt** (phase 7).
2. Menu **Ouverture & évaluation** → carte *Ouverture officielle des plis*. Le **type de séance** (publique ou restreinte) est affiché ; tenez le **registre de présence** (nom, qualité, organisme).
3. **Signez l'ouverture** : la règle des deux personnes exige votre signature **et** celle du président de la commission. Dès les deux signatures, le marché passe en évaluation.
4. Avec la commission, **déchiffrez localement les plis** (panneau *Déchiffrement local des plis*) : saisissez la clé (ou les parts) ; le déchiffrement se fait dans le navigateur ; les empreintes sont contrôlées.
5. Enregistrez la **conformité administrative** de chaque offre (*recordConformite*) et le **montant lu**. Une offre non conforme est motivée.
6. Le **procès-verbal d'ouverture** est ensuite affiché et téléchargeable en PDF.

## Phase 9 à 11 — Attribution
- Menu **Attribution** : consultez le classement, puis le PRM prononce l'attribution provisoire (voir manuel PRM).
- Après le délai de recours, vous pouvez **Clore la période de recours** si aucun recours n'est pendant.

## Exécution, réception, archivage
- **Contrats & exécution** : préparez le contrat (par lot si le marché est alloti) ; émettez les **ordres de service** ; consignez l'avancement et les **incidents** ; enregistrez avenants et sous-traitance (plafonds 30 % et 40 % refusés par la base).
- **Réception & paiements** : *Valider (AC)* les décomptes soumis par le titulaire ; composez la commission de réception ; *Enregistrer le PV*.
- **Archivage** : une fois le marché clos, *Archiver* (inventaire daté, avec empreinte).

## Alertes et suivi
Le menu **Alertes** liste notamment les retards par rapport au PPM, les recours à instruire, les garanties qui expirent, les avenants proches du plafond et les paiements en attente.

## Rappels de prudence
- Une offre déposée après la date limite est **rejetée automatiquement** ; ne tentez pas de la « rattraper ».
- Aucun accès aux offres avant l'ouverture, même pour vous.
- Procédure **infructueuse** (aucune offre qualifiée) : le PRM la déclare, motivée ; vous pouvez ensuite **Relancer le marché** (nouveau marché en phase 1, historique conservé).
