import { describe, expect, it } from 'vitest'
import { combineShares, encodeShare, parseShare, recoverSecret, secretCheck, splitSecret } from './shamir'
import { decryptEnvelope, encryptForMarket, fromBase64, generateMarketKeyPair, toBase64 } from './crypto'

const rnd = (n: number) => crypto.getRandomValues(new Uint8Array(n))

describe('partage de secret de Shamir', () => {
  it('toute combinaison de k parts reconstitue le secret', () => {
    const secret = rnd(64)
    const shares = splitSecret(secret, 5, 3)
    const combos = [[0, 1, 2], [0, 2, 4], [1, 3, 4], [2, 3, 4], [0, 1, 4]]
    for (const c of combos) expect(combineShares(c.map(i => shares[i]))).toEqual(secret)
    expect(combineShares(shares)).toEqual(secret)                  // plus de k parts : également correct
  })

  it('moins de k parts ne donnent pas le secret', () => {
    const secret = rnd(64)
    const shares = splitSecret(secret, 5, 3)
    expect(combineShares([shares[0], shares[1]])).not.toEqual(secret)
  })

  it('une part isolée est indépendante du secret (mêmes parts possibles pour deux secrets)', () => {
    // Avec k = 2, chaque octet d'une part est uniformément réparti : on vérifie qu'il n'est pas égal au secret.
    const secret = new Uint8Array(512)                                // secret nul : une fuite se verrait immédiatement
    const share = splitSecret(secret, 3, 2)[0]
    expect(new Set(share.y).size).toBeGreaterThan(100)
  })

  it('refuse les paramètres incohérents', () => {
    expect(() => splitSecret(rnd(8), 3, 1)).toThrow()
    expect(() => splitSecret(rnd(8), 2, 3)).toThrow()
  })

  it('encodage : aller-retour, détection d’une part altérée ou étrangère', async () => {
    const secret = rnd(100)
    const check = await secretCheck(secret)
    const enc = splitSecret(secret, 4, 2).map(s => encodeShare(s, 2, 4, check))
    expect(parseShare(enc[1]).x).toBe(2)
    expect(await recoverSecret([enc[3], enc[0]])).toEqual(secret)
    await expect(recoverSecret([enc[0]])).rejects.toThrow(/requises/)
    await expect(recoverSecret([enc[0], enc[0]])).rejects.toThrow(/requises/)       // la même part deux fois ne compte qu'une fois
    const bad = parseShare(enc[1]); bad.y[0] ^= 1
    await expect(recoverSecret([enc[0], encodeShare(bad, 2, 4, check)])).rejects.toThrow(/altérée/)
    const other = splitSecret(rnd(100), 4, 2).map(s => encodeShare(s, 2, 4, 'deadbeefdeadbeef'))
    await expect(recoverSecret([enc[0], other[1]])).rejects.toThrow(/même partage/)
  })

  it('de bout en bout : une offre chiffrée s’ouvre avec la clé privée reconstituée par k membres', async () => {
    const pair = await generateMarketKeyPair()
    const privateBytes = fromBase64(pair.privateKey)
    const check = await secretCheck(privateBytes)
    const parts = splitSecret(privateBytes, 5, 3).map(s => encodeShare(s, 3, 5, check))

    const { blob } = await encryptForMarket(new TextEncoder().encode('offre confidentielle').buffer as ArrayBuffer, pair.publicKey)
    const envelope = await blob.text()

    const rebuilt = toBase64(await recoverSecret([parts[4], parts[1], parts[2]]))
    expect(new TextDecoder().decode(await decryptEnvelope(envelope, rebuilt))).toBe('offre confidentielle')
    await expect(recoverSecret([parts[0], parts[1]])).rejects.toThrow()               // deux membres ne suffisent pas
  }, 60_000)
})
