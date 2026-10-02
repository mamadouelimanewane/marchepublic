# 11. Manuel — Administrateur de la plateforme

**Votre rôle.** Paramétrer la plateforme (seuils, nomenclatures, modèles, comptes) sans développement.
**Votre menu :** Tableau de bord · Marchés · Pièces à vérifier · Programmation · Rédaction · Publication · Recours · Archivage · Reporting · Alertes de risque · Journal d'audit · **Paramétrage & comptes**.

> **Limite volontaire.** Même administrateur, vous ne pouvez **pas** lire les offres avant l'ouverture, ni modifier le journal d'audit, ni forcer un passage de phase : ces règles sont dans la base de données.

## Menu Paramétrage & comptes

### 1. Paramètres réglementaires
Carte **Paramètres réglementaires** : chaque paramètre a une *clé*, une *valeur* et une *description* ; modifiez la valeur puis **Modifier**. La date et l'auteur de la dernière modification sont conservés (et tracés dans le journal d'audit).

| Famille | Exemples de paramètres |
|---|---|
| Seuils de passation | Seuils d'appel d'offres ouvert par type d'entité et nature (par défaut 70 / 50 M FCFA pour l'État, 100 / 60 M pour les agences et sociétés) |
| Plafonds | Avenants (30 %), sous-traitance (40 %), catalogue (hausse de prix 10 %) |
| Délais | Dépôt minimal par mode, recours (10 jours), instruction des recours (7 jours), archivage |
| Évaluation | Note technique minimale (70), pondération technique/financière (70/30 ; 80/20 pour les prestations intellectuelles) |
| Alertes de risque | Seuils des signaux (délai court, écart de prix, gagnant récurrent…) |
| IA | Quota quotidien de requêtes par agent |

> **Important.** Ces valeurs par défaut n'ont **pas été validées par un juriste** : faites-les confirmer par la DCMP avant la mise en service, puis relisez-les à chaque nouvel arrêté.

### 2. Séance d'ouverture par mode de passation
Carte **Séance d'ouverture des plis par mode de passation** : pour chaque mode, choisissez **publique** ou **restreinte**. Le changement ne concerne que les prochaines ouvertures.

### 3. Institutions
Carte **Institutions** : *Créer l'institution* (code, nom, type : État, collectivité, établissement public, agence, société publique). Le type détermine les seuils applicables.

### 4. Nomenclature des corps de métier
Carte **Nomenclature des corps de métier** : activez ou désactivez un corps de métier. La plateforme en compte **43**, chacun avec son modèle de TDR et sa grille d'évaluation type.

### 5. Comptes institutionnels
Carte **Comptes institutionnels** : *créer un compte* (nom, e-mail, rôle, institution). Le compte est créé **par invitation e-mail** : aucun mot de passe n'est communiqué. Pour un départ, **désactivez** le compte (on ne supprime jamais, par traçabilité).

### 6. Soumissionnaires — certification PME / ESS
Carte **Soumissionnaires** : après vérification des justificatifs, attribuez les statuts **PME**, **PME féminine**, **ESS** et vérifiez le **NINEA**. Ces statuts alimentent les quotas légaux (5 % dont 2 % aux PME féminines) et l'accès aux marchés réservés.

## Autres tâches
- **Pièces à vérifier** : vérifier ou refuser les pièces du dossier permanent des fournisseurs (avec motif en cas de refus).
- **Configuration technique** (hors interface) : variables d'environnement de l'hébergement — clés d'accès à la base, secret de la tâche planifiée (`CRON_SECRET`), envoi des alertes (SMTP, SMS, WhatsApp), clé de l'assistant IA (`ANTHROPIC_API_KEY`). Voir le fichier `.env.example` du dépôt.
- **Sauvegardes et supervision** : à organiser avec l'hébergeur ; voir `docs/architecture/securite.md`.
