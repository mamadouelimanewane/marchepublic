# 1. Démarrage et règles communes

## Se connecter
1. Ouvrez l'adresse de la plateforme, puis **Connexion**.
2. Saisissez votre adresse e-mail et votre mot de passe.
3. Vous arrivez sur le **Tableau de bord**. Le **menu de gauche** ne propose que les modules de votre profil.

Les comptes du personnel des autorités, de la DCMP, de l'ARCOP, du Trésor, de la Cour des Comptes et des bailleurs sont **créés par l'administrateur** (invitation par e-mail). Les entreprises **s'inscrivent elles-mêmes** (« S'inscrire (Soumissionnaire) ») et sont toujours créées avec le profil soumissionnaire : aucun rôle institutionnel ne peut être obtenu par auto-inscription.

> **Sécurité.** Ne partagez jamais votre mot de passe. Déconnectez-vous d'un poste partagé. Toute action est enregistrée dans le journal d'audit, avec votre identité et l'heure.

## Naviguer
- **Fiche du marché** (menu *Marchés*) : la page centrale d'un marché. Elle présente, selon l'avancement : informations générales, calendrier et chiffrement des offres, commission des marchés, critères d'évaluation, lots, documents, historique des phases et **« Prochaine étape »**.
- Le **bandeau de phase** montre où en est le marché (de 1 à 15). Un bouton d'avancement n'apparaît que si **votre profil** peut faire franchir cette étape **et** que les conditions sont réunies ; sinon la plateforme indique ce qui manque.
- **Notifications** : la cloche signale les événements qui vous concernent (avis, décisions, recours, expirations…). Selon vos abonnements, des alertes peuvent aussi arriver par e-mail.

## Messages de blocage fréquents
Ces messages ne sont pas des pannes : ils protègent la procédure.

| Message (début) | Signification | Que faire |
|---|---|---|
| `HARD_LOCK_APPEAL` / « recours pendant » | Un recours est pendant devant l'ARCOP : aucune attribution définitive ni signature de contrat | Attendre la décision de l'ARCOP |
| `DOCUMENT_INCOMPLETE` | Le TDR/DAO contient un texte à compléter (`[●]`), une section obligatoire vide ou une clause obligatoire manquante | Compléter le document puis le soumettre à nouveau |
| `TOO_EARLY` | La date limite de dépôt n'est pas atteinte | Attendre la date et l'heure limites |
| `GUARD_PHASE_n` | Une condition de la phase n n'est pas remplie (document non validé, évaluation non finalisée, contrat non signé…) | Lire le détail et traiter l'élément manquant |
| `JUSTIFICATION_REQUIRED` / `MOTIVATION_REQUIRED` | Une justification ou une motivation est obligatoire (écart de mode de passation, attribution hors classement, décision, annulation…) | Saisir un texte motivé |
| `AVENANT_LIMIT_EXCEEDED` | Le cumul des avenants dépasserait 30 % du montant initial | Revoir le besoin ; la base refuse l'avenant |
| `SUBCONTRACTOR_LIMIT_EXCEEDED` | La sous-traitance dépasserait 40 % du marché | Réduire la part sous-traitée |
| `LOT_REQUIRED` | Marché alloti : indiquez le lot | Choisir le lot |
| `APPEAL_TOO_LATE` | Le délai de recours est échu | Aucun recours possible |
| `QUOTA_EXCEEDED` | Limite quotidienne de l'assistant IA atteinte | Réessayer dans 24 heures |
| « Action non autorisée pour votre rôle » | Votre profil n'a pas ce droit à cette étape | Contacter le profil compétent |

## Principes à connaître
- **Confidentialité des offres.** Aucune offre n'est lisible avant l'ouverture officielle, **même par l'administrateur**. Les offres sont chiffrées dans le navigateur du candidat ; la clé n'est jamais stockée par la plateforme.
- **Horodatage.** Les dépôts sont horodatés par le serveur ; une offre déposée après la date limite est rejetée et l'incident est tracé.
- **Documents.** Une fois transmis à la DCMP ou publiés, les documents sont verrouillés. Chaque modification d'un document en rédaction crée une **version immuable** (avec empreinte).
- **Traçabilité.** Le journal d'audit est en écriture seule et chaîné : on ne peut ni modifier ni supprimer une ligne.
