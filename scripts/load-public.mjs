// Test de charge LÉGER des pages publiques (aucune authentification, lecture seule).
//   node scripts/load-public.mjs https://marchepublic-eight.vercel.app [requetes-par-page=60] [concurrence=10]
// À n'utiliser que sur un site dont vous êtes responsable. Ce n'est PAS le test de charge de clôture de dépôt exigé par la recette
// (dépôts simultanés authentifiés) : celui-ci exige un environnement dédié et des comptes de test en nombre.
const base = (process.argv[2] ?? '').replace(/\/$/, '')
const per = Number(process.argv[3] ?? 60)
const conc = Number(process.argv[4] ?? 10)
if (!/^https?:\/\//.test(base)) { console.error('Usage : node scripts/load-public.mjs <url> [requetes-par-page] [concurrence]'); process.exit(1) }

const PAGES = ['/', '/avis', '/transparence', '/transparence/catalogue', '/api/ocds/releases']
const pct = (a, p) => a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))]

async function hit(path) {
  const t0 = performance.now()
  try {
    const r = await fetch(base + path, { redirect: 'manual', headers: { 'user-agent': 'marchepublic-load-test' } })
    await r.arrayBuffer()
    return { ok: r.status === 200, status: r.status, ms: performance.now() - t0 }
  } catch (e) { return { ok: false, status: 0, ms: performance.now() - t0 } }
}

console.log(`Cible ${base} — ${per} requêtes par page, concurrence ${conc}\n`)
let failures = 0
for (const path of PAGES) {
  const results = []
  let next = 0
  await Promise.all(Array.from({ length: conc }, async () => {
    while (next < per) { next++; results.push(await hit(path)) }
  }))
  const ms = results.map(r => r.ms).sort((a, b) => a - b)
  const bad = results.filter(r => !r.ok)
  failures += bad.length
  const statuses = [...new Set(bad.map(r => r.status))].join(',')
  console.log(`${path.padEnd(28)} ok ${String(results.length - bad.length).padStart(3)}/${results.length}  p50 ${pct(ms, 50).toFixed(0).padStart(5)} ms  p95 ${pct(ms, 95).toFixed(0).padStart(5)} ms  max ${ms.at(-1).toFixed(0).padStart(5)} ms${bad.length ? `  ÉCHECS (${statuses})` : ''}`)
}
console.log(failures ? `\n${failures} requête(s) en échec` : '\nAucun échec')
process.exit(failures ? 1 : 0)
