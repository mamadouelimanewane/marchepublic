# 🇸🇳 Plateforme Intégrée de Pilotage du Cycle des Marchés Publics

Bienvenue dans le dépôt principal de la plateforme de gestion des marchés publics de la République du Sénégal. Ce système dématérialise intégralement la commande publique, de l'inscription au budget (PPM) jusqu'à la réception définitive, en stricte conformité avec le **Décret n°2022-2295**.

---

## 🏗️ Architecture Technologique

Cette application repose sur une architecture moderne orientée sécurité et conformité réglementaire :

- **Monorepo (Turborepo)** : Permet de gérer le front-end, le back-end et les packages (workflow) depuis un dépôt unique.
- **Frontend (Next.js 15)** : Application React avec Server Components (SSR), conçue pour les connexions bas-débit (low-bandwidth) et accessible sur mobile via Capacitor.
- **Backend (Supabase / PostgreSQL)** : 
  - **RLS (Row Level Security)** assurant un fonctionnement multi-tenant strict (chaque Ministère ou Agence est isolé).
  - Triggers immuables (WORM - Write Once Read Many) pour le journal d'audit (`audit_logs`) garanti anti-corruption.
- **Workflow Engine (XState v5)** : Orchestration formelle des 15 phases du marché.

---

## 🔒 Règles Métier Bloquantes (Hard Locks)

L'intégrité de la procédure est garantie mathématiquement par la base de données (Triggers) et la State Machine :

1. **Coffre-fort Cryptographique (Phase 6)** : Les offres financières sont chiffrées en AES-256 dans le navigateur du soumissionnaire. La clé de déchiffrement n'est libérée qu'à la Phase 7.
2. **Recours ARCOP (Phase 10)** : Tout recours déposé bloque systémiquement le passage en Phase 11 (Attribution Définitive) tant qu'il n'est pas rejeté ou jugé irrecevable.
3. **Plafond Avenants (Phase 13)** : Le cumul des avenants est bloqué au-delà de **30%** du montant initial (Trigger DB).
4. **Plafond Sous-traitance (Phase 13)** : La sous-traitance est bloquée au-delà de **40%** (Trigger DB).
5. **Quotas PME/ESS** : Suivi automatisé des quotas obligatoires (5% global, 2% PME féminines).

---

## 🚀 Démarrage Rapide (Développement)

### Prérequis
- [Node.js](https://nodejs.org) (v18+)
- [Docker Desktop](https://www.docker.com/products/docker-desktop) (nécessaire pour Supabase Local)
- [Supabase CLI](https://supabase.com/docs/guides/cli)

### 1. Initialiser la Base de données locale
```bash
# Démarrer l'environnement Supabase local
npx supabase start

# (Optionnel) Si les migrations ne se sont pas jouées automatiquement
npx supabase db push

# Peupler la base avec les institutions de test et les seuils
npm run db:seed
```

### 2. Démarrer l'application (Next.js)
```bash
# Lancer l'environnement de développement (Monorepo Turborepo)
npm run dev
```

L'application sera accessible sur : [http://localhost:3000](http://localhost:3000)

---

## 📁 Structure du Projet

```text
marchepublic/
├── apps/
│   ├── web/                     # Next.js 15 (Portail public & Dashboard)
│   │   ├── src/app/(public)/    # Pages accessibles à tous (Avis AO)
│   │   ├── src/app/(dashboard)/ # Back-office (RBAC selon profil)
│   │   └── src/components/      # Composants (DepotOffre chiffré, etc.)
│   └── mobile/                  # Projet Capacitor (iOS/Android)
├── packages/
│   ├── workflow/                # Machine à états XState des 15 phases
│   ├── db/                      # Typages TS générés depuis Supabase
│   ├── validators/              # Schémas Zod (Validation des formulaires)
│   └── ui/                      # Composants visuels partagés
└── supabase/
    ├── migrations/              # 0001 à 0006 : Les schémas, triggers et RLS
    ├── functions/               # Edge Functions (ex: webhook SIGFIP)
    └── seed/                    # Données de démonstration
```

---

## 👨‍💻 Matrice des Rôles (RBAC)

Le système adapte automatiquement l'interface et les droits d'accès selon le profil :
- `SERVICE_DEMANDEUR` : Initialise le PPM et rédige le DAO.
- `CPM` : Administre le marché de A à Z.
- `PRM` : Valide, approuve et signe.
- `DCMP` : Contrôle a priori (Avis de non-objection).
- `ARCOP` : Traite les recours (Phase 10) et audits ex-post.
- `SOUMISSIONNAIRE` : Dépôt sécurisé et consultation.
- `TRESOR` : Visas budgétaires et suivi des paiements.
- `ADMIN` : Gestion des paramétrages (seuils, corps de métier).

*(Développé par PROCESSINGENIERIE - 2026)*
