import { createSupabaseServerClient } from '@/lib/supabase/server'
import { dateFr } from '@/lib/format'
import { PublicShell } from '@/components/PublicShell'

export const revalidate = 600
export const metadata = { title: "Empreintes d'audit publiées | Transparence" }

export default async function AncragePage() {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.from('v_audit_anchors').select('institution, head_seq, head_hash, nb_entries, anchored_at').order('anchored_at', { ascending: false }).limit(200)
  return (
    <PublicShell title="Empreintes du journal d'audit" subtitle="Preuve publique que l'historique n'a pas été réécrit" wide>
      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6 text-sm leading-relaxed text-gray-700">
        <p>
          Toutes les actions sensibles de la plateforme sont consignées dans un journal chaîné par empreintes cryptographiques (SHA-256) : chaque ligne contient l&apos;empreinte de la précédente.
          Chaque jour, l&apos;empreinte de la dernière ligne de chaque autorité est <strong>publiée ici</strong>. Quiconque l&apos;archive de son côté pourra prouver plus tard que le journal n&apos;a pas été modifié
          rétroactivement, même par un administrateur de la base de données, car une réécriture complète changerait ces empreintes.
        </p>
        <p className="mt-3">Flux machine : <a className="underline" href="/api/audit/anchors">/api/audit/anchors</a> (JSON). Nous vous encourageons à l&apos;archiver périodiquement.</p>
      </div>
      {error && <p role="alert" className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">Service momentanément indisponible.</p>}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500"><tr><th className="px-4 py-2">Publiée le</th><th className="px-4 py-2">Autorité</th><th className="px-4 py-2">Entrées</th><th className="px-4 py-2">N° de tête</th><th className="px-4 py-2">Empreinte SHA-256</th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {(data ?? []).map(a => (
              <tr key={`${a.institution}-${a.head_seq}`}>
                <td className="whitespace-nowrap px-4 py-2">{dateFr(a.anchored_at, true)}</td><td className="px-4 py-2">{a.institution}</td>
                <td className="px-4 py-2">{a.nb_entries}</td><td className="px-4 py-2">{a.head_seq}</td><td className="px-4 py-2"><code className="break-all text-xs">{a.head_hash}</code></td>
              </tr>
            ))}
            {!data?.length && <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-500">Aucune empreinte publiée pour le moment.</td></tr>}
          </tbody>
        </table>
      </div>
    </PublicShell>
  )
}
