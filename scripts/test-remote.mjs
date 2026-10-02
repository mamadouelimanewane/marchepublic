// Rejoue les tests SQL sur une base Supabase RÉELLE déjà migrée, sans rien enregistrer (transaction annulée à la fermeture).
//   REMOTE_DB_URL="postgres://postgres.<ref>:<mot-de-passe>@<hote>:5432/postgres" npm run test:db:remote [-- fichier.test.mjs …]
// Sans argument : workflow.test.mjs. Les fichiers sont exécutés un par un, avec une pause entre deux : le pooler met quelques secondes à
// libérer la connexion du fichier précédent, et un test qui tente un TRUNCATE (verrou exclusif) attendrait sinon derrière elle jusqu'au
// délai d'expiration des requêtes. Les tests qui rejouent les migrations d'un état antérieur (upTo) ne s'appliquent pas ici.
import { spawnSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

if (!process.env.REMOTE_DB_URL) { console.error('Définissez REMOTE_DB_URL (voir l\'en-tête de ce fichier).'); process.exit(1) }
const files = process.argv.slice(2).length ? process.argv.slice(2) : ['supabase/tests/workflow.test.mjs']
const PAUSE_MS = Number(process.env.REMOTE_PAUSE_MS ?? 15_000)

let failed = 0
for (const [i, file] of files.entries()) {
  if (i > 0) await sleep(PAUSE_MS)
  const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', file], { stdio: 'inherit', env: process.env })
  if (r.status !== 0) failed++
}
console.log(`\n${files.length - failed}/${files.length} fichier(s) de test réussi(s)`)
process.exit(failed ? 1 : 0)
