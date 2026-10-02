// Génère supabase/migrations/0021_modeles_tdr_sectoriels.sql à partir des fiches métier.
//   node supabase/modeles-tdr/generate.mjs           écrit le fichier
//   node supabase/modeles-tdr/generate.mjs --check   échoue si le fichier committé n'est pas à jour
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { ALL } from './index.mjs'
import { render } from './build.mjs'

const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations', '0021_modeles_tdr_sectoriels.sql')
const sql = render(ALL)
if (process.argv.includes('--check')) {
  const current = readFileSync(target, 'utf8').replace(/\r\n/g, '\n')
  if (current !== sql) { console.error('0021_modeles_tdr_sectoriels.sql n\'est pas à jour : relancez generate.mjs'); process.exit(1) }
  console.log('à jour')
} else {
  writeFileSync(target, sql)
  console.log(`écrit : ${target} (${ALL.length} modèles, ${(sql.length / 1024).toFixed(0)} Ko)`)
}
