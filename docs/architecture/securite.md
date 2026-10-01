# Modèle de sécurité

## Principe directeur : la base de données est l'autorité

L'interface et les server actions sont des commodités. Tout ce qui protège la procédure est appliqué en PostgreSQL, de sorte que
contourner l'application (appel direct de l'API Supabase, requête SQL avec un compte applicatif) n'ouvre aucune brèche.

| Menace | Parade |
|---|---|
| Un utilisateur s'attribue un rôle ou une institution | Profil créé par trigger avec le seul rôle SOUMISSIONNAIRE ; `users_guard_sensitive` interdit de modifier rôle, institution, statuts PME, e-mail |
| Usurpation du rôle via en-tête ou variable de session | Rôle et institution relus depuis `users` par `current_user_role()` / `current_institution_id()` (SECURITY DEFINER, `row_security = off`) |
| Lecture d'une offre avant l'ouverture | RLS `bids_select` (phase ≥ 7 uniquement, même pour l'ADMIN) ; contenu chiffré ; clé privée détenue hors plateforme |
| Contournement d'un verrou en modifiant `current_phase` | `tenders_guard` : transition légale exigée (`phase_transitions`), pré-conditions vérifiées, UPDATE direct refusé au rôle applicatif ; les verrous s'appliquent aussi au service_role |
| Attribution pendant un recours | Trigger : aucune entrée en phase ≥ 11 tant qu'un recours est `DEPOSE`/`EN_INSTRUCTION` ; signature du contrat refusée |
| Dépassement des plafonds avenants/sous-traitance | Triggers `BEFORE INSERT` ; tentative tracée par une fonction qui **revérifie** le dépassement (pas de pollution du journal) |
| Falsification de l'horodatage d'un dépôt | Dépôt uniquement via `submit_bid` (horloge serveur) ; INSERT direct révoqué ; `submitted_at` non modifiable |
| Altération du journal d'audit | Aucun droit d'écriture directe ; triggers anti-mutation ; chaînage SHA-256 par institution ; `verify_audit_chain` détecte une modification même par un administrateur de base qui désactiverait le trigger (testé) |
| Fuite inter-institutions | RLS sur toutes les tables (un test échoue si une table publique n'a pas la RLS) ; vues en `security_invoker` |
| Identification des candidats par les évaluateurs | Les évaluateurs ne voient pas les profils des soumissionnaires (`bidder_visible_to_staff` réservé CPM/PRM) |
| Injection CSV dans les exports | Préfixe `'` des cellules commençant par `= + - @` |
| Open redirect à la connexion | Redirection limitée aux chemins internes |

## Coffre-fort des offres

1. Le CPM génère dans son navigateur une paire RSA-OAEP 3072 bits ; seule la clé publique (et son empreinte) est enregistrée.
2. Le candidat chiffre chaque dossier (AES-256-GCM, clé aléatoire) et scelle la clé AES avec la clé publique.
3. La clé privée est remise au président de la commission ; elle n'est jamais transmise.
4. À l'ouverture (double signature CPM + président enregistrée en base), la commission colle la clé dans son navigateur : déchiffrement local, vérification de l'empreinte du pli, puis oubli de la clé.

**Partage de la clé (Shamir k parmi n)** : le CPM peut découper la clé privée en n parts (2 ≤ k ≤ n ≤ 10), remises chacune à un membre de la commission ; k parts suffisent à l'ouverture et k−1 parts ne révèlent rien. La reconstitution se fait dans le navigateur, avec contrôle d'une empreinte du secret (`apps/web/src/lib/shamir.ts`, testé de bout en bout). Le mode « clé unique » reste disponible.

**Limite assumée** : la plateforme ne peut pas vérifier que les parts ont été distribuées à des personnes distinctes, ni empêcher le CPM de conserver une copie lors de la génération (moment de confiance unique). Un montage plus strict exigerait une génération distribuée de la clé.

## Ce que ces tests ne prouvent pas

- Les tests SQL tournent sur PostgreSQL en WASM avec une simulation minimale de Supabase (`auth.uid()`, rôles, stockage). Ils n'exercent pas
  PostgREST, GoTrue ni le Storage réels : à rejouer sur `supabase start` avant mise en production.
- Le protocole de chiffrement est testé avec le WebCrypto de Node (même API) ; les écrans de dépôt et d'ouverture n'ont pas été parcourus dans un navigateur réel.
- Aucun test d'intrusion ni test de charge n'a été réalisé (exigés au CDC §14.2).
