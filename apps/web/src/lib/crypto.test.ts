import { describe, expect, it } from 'vitest'
import { decryptEnvelope, encryptForMarket, fromBase64, generateMarketKeyPair, sha256Hex, toBase64 } from './crypto'

// WebCrypto de Node = même API que le navigateur : valide le protocole du coffre-fort (dépôt → ouverture).
describe('coffre-fort cryptographique', () => {
  it('aller-retour : un pli chiffré pour le marché est déchiffré par la clé privée et seulement par elle', async () => {
    const market = await generateMarketKeyPair()
    const other = await generateMarketKeyPair()
    const pdf = new TextEncoder().encode('%PDF-1.7 offre financière 50 000 000 FCFA').buffer as ArrayBuffer

    const { blob, hash } = await encryptForMarket(pdf, market.publicKey)
    const envelope = await blob.text()

    expect(envelope).not.toContain('50 000 000')                      // rien de lisible dans l'enveloppe
    expect(hash).toBe(await sha256Hex(new TextEncoder().encode(envelope)))   // empreinte vérifiable à l'ouverture
    expect(new TextDecoder().decode(await decryptEnvelope(envelope, market.privateKey))).toContain('50 000 000 FCFA')
    await expect(decryptEnvelope(envelope, other.privateKey)).rejects.toThrow()   // mauvaise clé
  }, 60_000)

  it('toute altération du pli est détectée (AES-GCM authentifié + empreinte)', async () => {
    const market = await generateMarketKeyPair()
    const { blob, hash } = await encryptForMarket(new TextEncoder().encode('offre').buffer as ArrayBuffer, market.publicKey)
    const env = JSON.parse(await blob.text())
    const bytes = fromBase64(env.ciphertext); bytes[0] ^= 1
    env.ciphertext = toBase64(bytes)
    const tampered = JSON.stringify(env)
    expect(await sha256Hex(new TextEncoder().encode(tampered))).not.toBe(hash)
    await expect(decryptEnvelope(tampered, market.privateKey)).rejects.toThrow()
  }, 60_000)

  it("l'empreinte de la clé publique est stable et la clé privée n'est pas dans la clé publique", async () => {
    const k = await generateMarketKeyPair()
    expect(k.fingerprint).toBe(await sha256Hex(fromBase64(k.publicKey)))
    expect(k.publicKey).not.toBe(k.privateKey)
    expect(k.publicKey.length).toBeLessThan(k.privateKey.length)
  }, 60_000)

  it('rejette un format d’enveloppe inconnu', async () => {
    const k = await generateMarketKeyPair()
    await expect(decryptEnvelope(JSON.stringify({ version: 2 }), k.privateKey)).rejects.toThrow(/Format/)
  }, 60_000)
})
