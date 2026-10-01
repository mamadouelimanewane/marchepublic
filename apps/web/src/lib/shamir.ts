// Partage de secret de Shamir (k parmi n) sur GF(256), octet par octet.
// Usage : la clé privée d'ouverture des plis est découpée en n parts remises à n membres de la commission ;
// k parts suffisent pour la reconstituer, k-1 parts ne révèlent strictement rien (sécurité théorique de l'information).

// Tables de logarithmes pour GF(2^8) avec le polynôme irréductible x^8 + x^4 + x^3 + x + 1 (0x11b), générateur 3.
const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
{
  let x = 1
  for (let i = 0; i < 255; i++) {
    EXP[i] = x
    LOG[x] = i
    // x ← x × 3 dans GF(256)
    let x2 = x << 1
    if (x2 & 0x100) x2 ^= 0x11b
    x = x2 ^ x
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]
}

const mul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]])
const div = (a: number, b: number) => {
  if (b === 0) throw new Error('Division par zéro dans GF(256)')
  return a === 0 ? 0 : EXP[LOG[a] + 255 - LOG[b]]
}

export interface Share { x: number; y: Uint8Array }

export function splitSecret(secret: Uint8Array, n: number, k: number): Share[] {
  if (!Number.isInteger(n) || !Number.isInteger(k) || k < 2 || n < k || n > 255) throw new Error('Paramètres invalides : 2 ≤ k ≤ n ≤ 255')
  const shares: Share[] = Array.from({ length: n }, (_, i) => ({ x: i + 1, y: new Uint8Array(secret.length) }))
  const coeffs = new Uint8Array(k - 1)
  for (let b = 0; b < secret.length; b++) {
    crypto.getRandomValues(coeffs)
    // Le coefficient de plus haut degré doit être non nul pour garantir le degré exact k-1.
    while (coeffs[k - 2] === 0) crypto.getRandomValues(coeffs.subarray(k - 2))
    for (const s of shares) {
      // Évaluation de secret[b] + c1·x + c2·x² + … (schéma de Horner)
      let y = 0
      for (let d = k - 2; d >= 0; d--) y = mul(y, s.x) ^ coeffs[d]
      s.y[b] = mul(y, s.x) ^ secret[b]
    }
  }
  return shares
}

export function combineShares(shares: Share[]): Uint8Array {
  if (shares.length < 2) throw new Error('Au moins deux parts sont nécessaires')
  const xs = shares.map(s => s.x)
  if (new Set(xs).size !== xs.length) throw new Error('Parts en double')
  const len = shares[0].y.length
  if (shares.some(s => s.y.length !== len)) throw new Error('Parts incompatibles')
  const out = new Uint8Array(len)
  for (let b = 0; b < len; b++) {
    let acc = 0
    for (let i = 0; i < shares.length; i++) {
      // Polynôme de Lagrange évalué en 0 : Π x_j / (x_i ⊕ x_j)
      let num = 1, den = 1
      for (let j = 0; j < shares.length; j++) {
        if (i === j) continue
        num = mul(num, shares[j].x)
        den = mul(den, shares[i].x ^ shares[j].x)
      }
      acc ^= mul(shares[i].y[b], div(num, den))
    }
    out[b] = acc
  }
  return out
}

// ------------------------------------------
// Encodage des parts (fichiers remis aux membres de la commission)
// ------------------------------------------
const PREFIX = 'MPSHARE1'

const b64 = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s) }
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))

export interface ParsedShare extends Share { k: number; n: number; check: string }

/** Empreinte courte du secret : permet de vérifier la reconstitution sans rien révéler d'exploitable. */
export async function secretCheck(secret: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', secret as BufferSource)
  return [...new Uint8Array(d)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('')
}

export function encodeShare(s: Share, k: number, n: number, check: string): string {
  return [PREFIX, k, n, s.x, check, b64(s.y)].join('.')
}

export function isShare(text: string): boolean {
  return text.trim().startsWith(PREFIX + '.')
}

export function parseShare(text: string): ParsedShare {
  const parts = text.trim().split('.')
  if (parts.length !== 6 || parts[0] !== PREFIX) throw new Error('Format de part invalide')
  const [, k, n, x, check, y] = parts
  const kk = Number(k), nn = Number(n), xx = Number(x)
  if (![kk, nn, xx].every(Number.isInteger) || kk < 2 || nn < kk || xx < 1 || xx > nn) throw new Error('Part invalide ou corrompue')
  return { k: kk, n: nn, x: xx, check, y: unb64(y) }
}

/** Reconstitue le secret à partir de parts encodées et vérifie son empreinte. */
export async function recoverSecret(encoded: string[]): Promise<Uint8Array> {
  const parsed = encoded.map(parseShare)
  const { k, n, check } = parsed[0]
  if (parsed.some(p => p.k !== k || p.n !== n || p.check !== check)) throw new Error('Ces parts ne proviennent pas du même partage')
  const distinct = new Map(parsed.map(p => [p.x, p]))
  if (distinct.size < k) throw new Error(`${distinct.size} part(s) valide(s) sur ${k} requises`)
  const secret = combineShares([...distinct.values()].slice(0, k))
  if ((await secretCheck(secret)) !== check) throw new Error('Reconstitution invalide : une des parts est altérée')
  return secret
}
