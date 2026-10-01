# 🇸🇳 Plateforme intégrée de pilotage du cycle des marchés publics

Dématérialisation de la commande publique sénégalaise, de la programmation budgétaire à l'archivage, conformément au
**Décret n°2022-2295** et au cahier des charges (`docs/` — matrice de conformité : [docs/architecture/matrice-conformite-cdc.md](docs/architecture/matrice-conformite-cdc.md)).

## Architecture

```
apps/web            Next.js 15 (App Router, server actions) — back-offices, portail public, dépôt chiffré
packages/workflow   Phases, transitions, rôles, règles métier pures (seuils, évaluation, plafonds), machine XState générée
packages/validators Schémas Zod partagés (formulaires, actions, API)
packages/ui, db     Utilitaires d'interface ; types de base (à régénérer : npm run db:types)
supabase/migrations 14 migrations : schéma, RLS, moteur de workflow, audit chaîné, reporting, données de référence
supabase/functions  sigfip-webhook (Trésor) — contrat à aligner sur la spécification réelle
supabase/tests      Tests d'intégration SQL sur PostgreSQL (pglite) — migrations réelles
```

**Principe : la base de données est l'autorité.** Les 15 phases, leurs pré-conditions, les verrous durs (recours, dates limites, plafonds
30 % / 40 %), la confidentialité des offres et l'audit sont appliqués par des triggers, des politiques RLS et des RPC `SECURITY DEFINER`.
L'interface ne fait que présenter ; la contourner n'ouvre aucune brèche. Détails : [docs/architecture/securite.md](docs/architecture/securite.md).

## Démarrage

Prérequis : Node 20+, [Supabase CLI](https://supabase.com/docs/guides/cli) + Docker (pour la pile locale).

```bash
npm install
npx supabase start            # applique les migrations (paramètres, nomenclature, modèles, clauses…)
cp .env.example apps/web/.env.local   # renseigner l'URL locale, la clé anon et la clé service_role affichées par « supabase start »
npm run db:seed               # comptes et marchés de démonstration (local uniquement ; mots de passe connus)
npm run dev                   # http://localhost:3000
```

Comptes de démonstration : `prm@demo.sn`, `cpm@demo.sn`, `demandeur@demo.sn`, `eval1@demo.sn`…, `dcmp@demo.sn`, `arcop@demo.sn`,
`tresor@demo.sn`, `admin@demo.sn`, `pme1@demo.sn`, `entreprise2@demo.sn` (mot de passe : voir `supabase/seed/index.js`).

## Tests

```bash
npm test            # unitaires (workflow, validateurs) + intégration SQL
npm run test:unit   # vitest — 52 tests (règles métier, chiffrement des offres, partage de clé, génération de PDF)
npm run test:db     # 38 tests sur les migrations réelles : cycle des 15 phases, verrous, RLS, étanchéité, audit, contrat code ↔ schéma
```

Le test `supabase/tests/contract.test.mjs` analyse le code web et échoue si une table, une colonne ou une RPC utilisée n'existe pas dans le schéma.
La parité TypeScript ↔ SQL des transitions est vérifiée par `packages/workflow/src/__tests__/workflow.test.ts`.

## Règles métier bloquantes (vérifiées par les tests)

1. **Coffre-fort** : offres chiffrées dans le navigateur ; la clé privée n'est jamais stockée ; aucune offre lisible avant l'ouverture, même par l'administrateur.
2. **Ouverture** : double signature (CPM + président de commission) ; déchiffrement local ; empreintes SHA-256 contrôlées.
3. **Recours** : tout recours pendant bloque l'attribution définitive **et** la signature du contrat, y compris par UPDATE SQL direct.
4. **Avenants ≤ 30 %** et **sous-traitance ≤ 40 %** : dépassement refusé par la base et tracé.
5. **Quotas PME/ESS 5 % (dont 2 % féminines)** : calcul idempotent, marchés réservés contrôlés au dépôt et à l'attribution.
6. **Audit WORM chaîné** : écriture seule, chaînage SHA-256, vérification d'intégrité par DCMP/ARCOP/Cour des Comptes.

## Ce qui a été corrigé par rapport à la version précédente

| Problème | Correction |
|---|---|
| Journal d'audit insérable par n'importe quel utilisateur | Écriture directe révoquée, fonction dédiée, chaînage cryptographique |
| Verrou de recours uniquement dans XState (inutilisé) | Verrou en base sur toutes les voies d'accès |
| Tables `config_seuils`/`corps_metiers` modifiables par tout utilisateur connecté | RLS : lecture publique, écriture ADMIN |
| Six tables avec RLS activée **sans aucune politique** (documents, lots, évaluations…) | Politiques complètes par rôle |
| Aucun profil créé à l'inscription ; pas d'écran de connexion | Trigger d'inscription (rôle soumissionnaire uniquement), pages login/register |
| ADMIN pouvant lire les offres avant l'ouverture ; DCMP/ARCOP bloqués par une comparaison d'institution | Règle unique : phase ≥ 7 |
| `submitted_at` fourni par le client (horodatage falsifiable) ; doublons d'offres avec lot NULL | Dépôt par RPC, horloge serveur, index unique corrigé |
| Alerte d'avenant écrite puis annulée avec la transaction | Journalisation par fonction dédiée qui revérifie le dépassement |
| Mode de passation inventé (bande « AOR à 50 % du seuil ») ; seuils codés en dur | Règle réglementaire AOO/DRP, seuils en base, écart à justifier |
| Référence `AO-année-aléatoire(1000)` | Séquence par institution et par année |
| Taux PME non recalculés lors d'un marché non-PME (dénominateur périmé), calcul non idempotent, colonne accentuée | Table d'écritures + recalcul |
| Enum `arcop_decision` incompatible avec `PARTIELLEMENT_FAVORABLE` | Contrainte corrigée |
| Middleware : `/recours` interdit aux candidats, en-têtes `x-user-*` de confiance | Droits partagés et testés ; en-têtes supprimés |
| Page « Assistant IA » simulée par `setTimeout`, modale de paiement mobile simulant un succès, compteurs d'accueil inventés | Remplacées par des modèles réels / supprimées / compteurs réels |
| Portail public lisant `tenders` sans droit (vide pour un anonyme) | Vue publique `v_avis_publics` |

## Reste à faire avant mise en production

Voir la section « ⛔ / 🟡 » de la [matrice de conformité](docs/architecture/matrice-conformite-cdc.md). Points majeurs :
rejouer les tests sur une pile Supabase réelle et dans un navigateur (WebCrypto), horodatage et signature qualifiés (ADIE), branchements
SIGFIP / DGID / portail national / mobile money, application Capacitor, 
test de charge, test d'intrusion, validation juridique des paramètres réglementaires.
