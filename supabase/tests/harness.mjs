// Harnais de test SQL : PostgreSQL WASM (pglite) + simulation minimale de Supabase (auth, storage, rôles).
import { PGlite } from '@electric-sql/pglite'
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
export const migrationsDir = join(here, '..', 'migrations')

const SUPABASE_STUBS = `
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, raw_user_meta_data jsonb DEFAULT '{}');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
CREATE SCHEMA storage;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean DEFAULT false);
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
GRANT USAGE ON SCHEMA auth, storage TO anon, authenticated, service_role;
`

export async function createDb({ upTo } = {}) {
  const db = new PGlite({ extensions: { uuid_ossp, pgcrypto } })
  await db.exec(SUPABASE_STUBS)
  // Comme sur Supabase : les extensions vivent dans le schéma `extensions`, présent dans le search_path par défaut des sessions
  // mais ABSENT du search_path restreint des fonctions SECURITY DEFINER (qui doivent donc l'inclure explicitement).
  await db.exec(`CREATE SCHEMA extensions; GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
    CREATE EXTENSION "uuid-ossp" WITH SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
    SET search_path = "$user", public, extensions;`)
  // Miroir des privilèges par défaut de Supabase : les tables/fonctions créées ensuite sont accessibles aux 3 rôles API
  // (les REVOKE des migrations doivent donc être explicites, exactement comme en production).
  await db.exec(`
    GRANT USAGE, CREATE ON SCHEMA public TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
  `)
  const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()
  for (const f of files) {
    if (upTo && f > upTo) break
    try { await db.exec(readFileSync(join(migrationsDir, f), 'utf8')) }
    catch (e) { throw new Error(`Migration ${f} : ${e.message}`) }
  }
  return db
}

/** Exécute `fn` en tant qu'utilisateur Supabase (rôle authenticated + claims JWT simulés). */
export async function asUser(db, userId, fn) {
  await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${userId}', false); SELECT set_config('request.jwt.claim.role', 'authenticated', false);`)
  try { return await fn() } finally {
    await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false); SELECT set_config('request.jwt.claim.role', '', false);`)
  }
}
export async function asService(db, fn) {
  await db.exec(`SET ROLE service_role; SELECT set_config('request.jwt.claim.role', 'service_role', false);`)
  try { return await fn() } finally { await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.role', '', false);`) }
}

/** Visiteur non connecté (rôle anon, aucun claim JWT). */
export async function asAnon(db, fn) {
  await db.exec(`SET ROLE anon; SELECT set_config('request.jwt.claim.sub', '', false); SELECT set_config('request.jwt.claim.role', 'anon', false);`)
  try { return await fn() } finally { await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.role', '', false);`) }
}
