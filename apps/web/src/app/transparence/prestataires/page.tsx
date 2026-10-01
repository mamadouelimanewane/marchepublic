import { createSupabaseServerClient } from '@/lib/supabase/server'
import { fcfa } from '@/lib/format'
import { PublicShell } from '@/components/PublicShell'

export const revalidate = 600
export const metadata = { title: 'Performance des prestataires | Transparence' }

export default async function PrestatairesPage() {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.from('v_public_prestataires')
    .select('prestataire, nb_evaluations, note_moyenne, note_qualite, note_delai, note_cout, montant_contrats').order('note_moyenne', { ascending: false }).limit(200)
  return (
    <PublicShell title="Performance des prestataires" subtitle="Moyennes des évaluations de fin de marché" wide>
      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6 text-sm leading-relaxed text-gray-700">
        Après chaque marché, l&apos;autorité contractante évalue le prestataire (qualité, délais, coût). Un prestataire n&apos;apparaît ici qu&apos;à partir de <strong>3 évaluations</strong> ;
        seules les moyennes sont publiées, jamais un commentaire individuel, et chaque prestataire peut répondre à ses évaluations.
      </div>
      {error && <p role="alert" className="mb-4 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">Service momentanément indisponible.</p>}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500"><tr><th className="px-4 py-2">Prestataire</th><th className="px-4 py-2">Évaluations</th><th className="px-4 py-2">Note moyenne</th><th className="px-4 py-2">Qualité</th><th className="px-4 py-2">Délais</th><th className="px-4 py-2">Coût</th><th className="px-4 py-2">Montant des contrats</th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {(data ?? []).map(p => (
              <tr key={p.prestataire}><td className="px-4 py-2 font-medium">{p.prestataire}</td><td className="px-4 py-2">{p.nb_evaluations}</td><td className="px-4 py-2 font-semibold">{p.note_moyenne} / 10</td>
                <td className="px-4 py-2">{p.note_qualite}</td><td className="px-4 py-2">{p.note_delai}</td><td className="px-4 py-2">{p.note_cout}</td><td className="whitespace-nowrap px-4 py-2">{fcfa(p.montant_contrats)}</td></tr>
            ))}
            {!data?.length && <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-500">Aucun prestataire n&apos;atteint encore le seuil de publication.</td></tr>}
          </tbody>
        </table>
      </div>
    </PublicShell>
  )
}
