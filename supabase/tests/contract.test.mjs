// Test de contrat code web ↔ schéma SQL.
// Le client Supabase du front est faiblement typé (Database = any) : une colonne ou une RPC mal orthographiée ne serait
// détectée qu'à l'exécution. Ce test analyse le code source de apps/web et vérifie, contre le schéma réellement migré :
//   • chaque .from('x') cible une table ou une vue existante ;
//   • chaque colonne d'un .select('…'), y compris dans les jointures imbriquées, existe ;
//   • chaque clé d'un .insert/.update/.upsert({…}) littéral correspond à une colonne ;
//   • chaque .rpc('f', { p_… }) cible une fonction existante avec des paramètres nommés valides.
import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDb } from './harness.mjs'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'apps', 'web', 'src')
let db
const columns = new Map()     // relation -> Set(colonnes)
const fks = new Map()         // "table.col" -> table référencée
const functions = new Map()   // nom -> Set(noms de paramètres)

function walk(dir) {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : []
  })
}

function balanced(src, openIdx, open = '(', close = ')') {
  let depth = 0, inStr = null
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i]
    if (inStr) { if (c === '\\') i++; else if (c === inStr) inStr = null; continue }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue }
    if (c === open) depth++
    else if (c === close && --depth === 0) return src.slice(openIdx + 1, i)
  }
  return null
}

function splitTop(s) {
  const parts = []; let depth = 0, cur = '', inStr = null
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inStr) { cur += c; if (c === '\\') cur += s[++i]; else if (c === inStr) inStr = null; continue }
    if (c === '"' || c === "'" || c === '`') { inStr = c; cur += c; continue }
    if ('({['.includes(c)) depth++
    if (')}]'.includes(c)) depth--
    if (c === ',' && depth === 0) { parts.push(cur); cur = '' } else cur += c
  }
  if (cur.trim()) parts.push(cur)
  return parts.map(p => p.trim()).filter(Boolean)
}

before(async () => {
  db = await createDb()
  const cols = await db.query(`select table_name, column_name from information_schema.columns where table_schema='public'`)
  for (const r of cols.rows) { if (!columns.has(r.table_name)) columns.set(r.table_name, new Set()); columns.get(r.table_name).add(r.column_name) }
  const fk = await db.query(`
    select kcu.table_name, kcu.column_name, ccu.table_name as ref
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
    join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
    where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'`)
  for (const r of fk.rows) fks.set(`${r.table_name}.${r.column_name}`, r.ref)
  const fn = await db.query(`select proname, coalesce(proargnames, '{}') as args from pg_proc where pronamespace = 'public'::regnamespace`)
  for (const r of fn.rows) functions.set(r.proname, new Set(r.args))
})

// Constantes de colonnes partagées, interpolées dans certains select()
const consts = {}
{
  const t = readFileSync(join(root, 'lib', 'types.ts'), 'utf8')
  const m = t.match(/TENDER_COLUMNS = `([\s\S]*?)`/)
  if (m) consts.TENDER_COLUMNS = m[1]
}

function selectArg(arg, local = {}) {
  const m = arg.trim().match(/^(['"`])([\s\S]*)\1$/)
  if (!m) return null
  const all = { ...consts, ...local }
  // Interpole les constantes de colonnes (partagées ou locales au fichier). Interpolation inconnue : analyse ignorée.
  let unknown = false
  const out = m[2].replace(/\$\{(\w+)\}/g, (_, name) => { if (name in all) return all[name]; unknown = true; return '' })
  return unknown ? null : out.replace(/\s+/g, ' ')
}

function checkSelect(rel, sel, where, errors) {
  for (const part of splitTop(sel)) {
    if (part === '*') continue
    const emb = part.match(/^(?:(\w+):)?(\w+)(?:![\w!]+)?\(([\s\S]*)\)$/)
    if (emb) {
      const [, alias, name, inner] = emb
      let target = name
      if (alias) target = fks.get(`${rel}.${name}`) ?? name                   // alias:colonne_fk(…)
      if (!columns.has(target)) { errors.push(`${where}: relation « ${name} » inconnue dans ${rel}`); continue }
      if (alias && !columns.get(rel)?.has(name) && !columns.has(name)) errors.push(`${where}: clé « ${name} » absente de ${rel}`)
      checkSelect(target, inner, where, errors)
      continue
    }
    const col = part.replace(/^\w+:/, '').replace(/::\w+$/, '').trim()
    if (!columns.get(rel)?.has(col)) errors.push(`${where}: colonne « ${col} » absente de ${rel}`)
  }
}

test('le code web n’utilise que des tables, colonnes et RPC existantes', () => {
  const errors = []
  let checked = 0
  const seed = join(root, '..', '..', '..', 'supabase', 'seed', 'index.js')
  for (const file of [...walk(root), seed]) {
    const src = readFileSync(file, 'utf8')
    const rel = relative(join(root, '..', '..', '..'), file)
    const local = {}
    for (const c of src.matchAll(/const (\w+) = (['"`])([^'"`]*)\2/g)) local[c[1]] = c[3]

    for (const m of src.matchAll(/\.from\('(\w+)'\)/g)) {
      const table = m[1]
      const where = `${rel}`
      if (!columns.has(table)) { errors.push(`${where}: table/vue « ${table} » inexistante`); continue }
      const window = src.slice(m.index + m[0].length, m.index + m[0].length + 1500)
      // on s'arrête à la fin de l'instruction courante (point-virgule ou nouveau .from)
      const cut = window.search(/\.from\('|;\n/)
      const chain = cut >= 0 ? window.slice(0, cut) : window

      for (const call of chain.matchAll(/\.(select|insert|update|upsert)\(/g)) {
        const open = m.index + m[0].length + call.index + call[0].length - 1
        const arg = balanced(src, open)
        if (arg === null) continue
        checked++
        if (call[1] === 'select') {
          const first = splitTop(arg)[0]
          const sel = selectArg(first ?? '', local)
          if (sel) checkSelect(table, sel, where, errors)
        } else if (arg.trim().startsWith('{')) {
          const obj = balanced(arg.trim(), 0, '{', '}')
          for (const prop of splitTop(obj ?? '')) {
            if (prop.startsWith('...')) continue
            const key = prop.match(/^(\w+)\s*(?::|$)/)?.[1]
            if (key && !columns.get(table).has(key)) errors.push(`${where}: ${call[1]}() sur ${table} : colonne « ${key} » inexistante`)
          }
        }
      }
    }

    for (const m of src.matchAll(/\brpc(?:<[^>]*>)?\(\s*'(\w+)'\s*(?:,\s*(\{[\s\S]*?\}))?\s*\)/g)) {
      checked++
      const [, name, argsObj] = m
      if (!functions.has(name)) { errors.push(`${rel}: RPC « ${name} » inexistante`); continue }
      if (argsObj) {
        for (const prop of splitTop(balanced(argsObj, 0, '{', '}') ?? '')) {
          const key = prop.match(/^(\w+)\s*(?::|$)/)?.[1]
          if (key && !functions.get(name).has(key)) errors.push(`${rel}: RPC ${name} : paramètre « ${key} » inconnu (attendus : ${[...functions.get(name)].join(', ')})`)
        }
      }
    }
  }
  assert.ok(checked > 60, `analyse trop courte (${checked} appels) : le parseur ne couvre plus le code`)
  assert.deepEqual(errors, [])
})
