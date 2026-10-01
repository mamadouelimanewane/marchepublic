'use client'
// Coffre-fort cryptographique côté navigateur (CDC §9 : offres chiffrées jusqu'à l'ouverture officielle).
//
//  • Chiffrement enveloppe : le dossier est chiffré en AES-256-GCM avec une clé aléatoire à usage unique ;
//    cette clé est scellée avec la clé publique RSA-OAEP-256 du marché.
//  • La clé PRIVÉE est générée dans le navigateur du CPM, téléchargée une seule fois et confiée au président de
//    la commission. Elle n'est JAMAIS transmise à la plateforme : personne, pas même un administrateur de base
//    de données, ne peut lire une offre avant l'ouverture. L'ouverture exige donc que le détenteur de la clé
//    la fournisse localement (en plus de la double signature enregistrée en base).

export interface Envelope {
  version: 1
  algorithm: 'RSA-OAEP-256+A256GCM'
  iv: string
  wrappedKey: string
  ciphertext: string
}

export const toBase64 = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export const fromBase64 = (b64: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(b64)
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export interface MarketKeyPair {
  publicKey: string        // SPKI base64 — stockée dans tenders.bid_public_key
  privateKey: string       // PKCS8 base64 — à confier au président de la commission, jamais envoyée
  fingerprint: string      // SHA-256 de la clé publique — stockée dans tenders.bid_key_fingerprint
}

export async function generateMarketKeyPair(): Promise<MarketKeyPair> {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['encrypt', 'decrypt'],
  )
  const spki = await crypto.subtle.exportKey('spki', pair.publicKey)
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey)
  return { publicKey: toBase64(spki), privateKey: toBase64(pkcs8), fingerprint: await sha256Hex(spki) }
}

/** Chiffre `data` pour la clé publique du marché ; renvoie l'enveloppe (JSON) et son empreinte SHA-256. */
export async function encryptForMarket(data: ArrayBuffer, publicKeyB64: string): Promise<{ blob: Blob; hash: string }> {
  const rsa = await crypto.subtle.importKey('spki', fromBase64(publicKeyB64), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt'])
  const aes = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, data)
  const wrapped = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, rsa, await crypto.subtle.exportKey('raw', aes))
  const envelope: Envelope = {
    version: 1, algorithm: 'RSA-OAEP-256+A256GCM',
    iv: toBase64(iv), wrappedKey: toBase64(wrapped), ciphertext: toBase64(ciphertext),
  }
  const blob = new Blob([JSON.stringify(envelope)], { type: 'application/json' })
  return { blob, hash: await sha256Hex(await blob.arrayBuffer()) }
}

/** Déchiffre une enveloppe avec la clé privée (PKCS8 base64) fournie localement par le président de la commission. */
export async function decryptEnvelope(envelopeJson: string, privateKeyB64: string): Promise<ArrayBuffer> {
  const env = JSON.parse(envelopeJson) as Envelope
  if (env.version !== 1 || env.algorithm !== 'RSA-OAEP-256+A256GCM') throw new Error('Format d\'enveloppe non reconnu')
  const rsa = await crypto.subtle.importKey('pkcs8', fromBase64(privateKeyB64.trim()), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt'])
  const rawAes = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, rsa, fromBase64(env.wrappedKey))
  const aes = await crypto.subtle.importKey('raw', rawAes, { name: 'AES-GCM' }, false, ['decrypt'])
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(env.iv) }, aes, fromBase64(env.ciphertext))
}

export function downloadText(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain' }))
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
