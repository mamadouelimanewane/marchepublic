// Rejoue les tests SQL sur une base Supabase RÉELLE déjà migrée, sans rien enregistrer (transaction annulée à la fermeture).
//   REMOTE_DB_URL="postgres://postgres.<ref>:<mot-de-passe>@<hote>:5432/postgres" npm run test:db:remote [-- fichier.test.mjs …]
// Les tests qui rejouent les migrations d'un état antérieur (upTo) ne s'appliquent pas ici.
import { spawnSync } from 'node:child_process'
if (!process.env.REMOTE_DB_URL) { console.error('Définissez REMOTE_DB_URL (voir l\'en-tête de ce fichier).'); process.exit(1) }
const files = process.argv.slice(2).length ? process.argv.slice(2) : ['supabase/tests/workflow.test.mjs']
const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], { stdio: 'inherit', env: process.env })
process.exit(r.status ?? 1)
