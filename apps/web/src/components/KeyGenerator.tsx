'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { downloadText, fromBase64, generateMarketKeyPair } from '@/lib/crypto'
import { encodeShare, secretCheck, splitSecret } from '@/lib/shamir'
import { setMarketKey } from '@/app/dashboard/actions/marches'

/**
 * Génère, DANS LE NAVIGATEUR, la paire de clés RSA du marché. Seule la clé publique est envoyée à la plateforme.
 * La clé privée est soit téléchargée telle quelle (clé unique, remise au président), soit découpée en n parts de Shamir
 * dont k suffisent à l'ouverture : aucune part isolée ne révèle quoi que ce soit.
 */
export function KeyGenerator({ tenderId, reference, existingFingerprint, existingShares, existingThreshold }: {
  tenderId: string
  reference: string
  existingFingerprint?: string | null
  existingShares?: number | null
  existingThreshold?: number | null
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [done, setDone] = useState<null | { shares?: number; threshold?: number }>(null)
  const [shared, setShared] = useState(true)
  const [n, setN] = useState(3)
  const [k, setK] = useState(2)

  const generate = () => {
    if (existingFingerprint && !window.confirm('Une clé existe déjà. La remplacer rendra les anciennes parts/clés inutilisables. Continuer ?')) return
    if (shared && (k < 2 || n < k || n > 10)) return void toast.error('Paramètres de partage : 2 ≤ seuil ≤ nombre de parts ≤ 10.')
    start(async () => {
      try {
        const pair = await generateMarketKeyPair()
        const privateBytes = fromBase64(pair.privateKey)
        const res = await setMarketKey(tenderId, pair.publicKey, pair.fingerprint, shared ? n : undefined, shared ? k : undefined)
        if (!res.ok) return void toast.error(res.message)
        if (shared) {
          const check = await secretCheck(privateBytes)
          splitSecret(privateBytes, n, k).forEach(s => downloadText(`part-${s.x}-sur-${n}-${reference}.share`, encodeShare(s, k, n, check)))
          setDone({ shares: n, threshold: k })
        } else {
          downloadText(`cle-privee-${reference}.key`, pair.privateKey)
          setDone({})
        }
        toast.success(res.message)
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Échec de la génération de clé')
      }
    })
  }

  return (
    <div className="space-y-3">
      {existingFingerprint && (
        <p className="break-all text-xs text-gray-500">
          Empreinte de la clé publique : <code>{existingFingerprint}</code>
          {existingShares && existingThreshold ? <> — partagée en <strong>{existingShares}</strong> parts, <strong>{existingThreshold}</strong> requises à l'ouverture.</> : <> — clé unique.</>}
        </p>
      )}
      <fieldset className="space-y-2 text-sm">
        <legend className="font-medium text-gray-700">Mode de conservation de la clé privée</legend>
        <label className="flex items-center gap-2"><input type="radio" checked={shared} onChange={() => setShared(true)} /> Partagée entre les membres de la commission (recommandé)</label>
        {shared && (
          <div className="ml-6 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1">Parts <input type="number" min={2} max={10} value={n} onChange={e => setN(Number(e.target.value))} className="w-16 rounded border border-gray-300 px-2 py-1" /></label>
            <label className="flex items-center gap-1">dont <input type="number" min={2} max={n} value={k} onChange={e => setK(Number(e.target.value))} className="w-16 rounded border border-gray-300 px-2 py-1" /> requises</label>
          </div>
        )}
        <label className="flex items-center gap-2"><input type="radio" checked={!shared} onChange={() => setShared(false)} /> Clé unique remise au président de la commission</label>
      </fieldset>
      <button type="button" disabled={pending} onClick={generate}
        className="rounded-lg bg-purple-700 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-800 disabled:opacity-50">
        {pending ? 'Génération en cours…' : existingFingerprint ? 'Régénérer la clé' : 'Générer la clé de chiffrement des offres'}
      </button>
      {done && (
        <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          {done.shares
            ? <>{done.shares} fichiers <strong>part-X-sur-{done.shares}-{reference}.share</strong> viennent d'être téléchargés. Remettez <strong>une part à chaque membre</strong> désigné, par un canal distinct, puis détruisez vos copies :
               il en faudra <strong>{done.threshold}</strong> pour ouvrir les plis, et aucune part seule ne révèle quoi que ce soit. Elles ne seront plus affichées.</>
            : <>Le fichier <strong>cle-privee-{reference}.key</strong> vient d'être téléchargé. Remettez-le au <strong>président de la commission</strong>. Sans lui, aucune offre ne pourra être ouverte. Il ne sera plus affiché.</>}
        </p>
      )}
    </div>
  )
}
