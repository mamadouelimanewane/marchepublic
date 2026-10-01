import { createSupabaseServerClient } from '@/lib/supabase/server'
import { fcfa } from '@/lib/format'
import { PublicShell } from '@/components/PublicShell'

export const revalidate = 600
export const metadata = { title: 'Catalogue des accords-cadres | Transparence' }

export default async function CataloguePublicPage() {
  const supabase = await createSupabaseServerClient()
  const [cat, acc] = await Promise.all([
    supabase.from('v_public_catalogue').select('id, accord, institution, fournisseur, categorie, code_article, designation, unite, prix_unitaire, delai_livraison_jours').order('categorie').order('designation').limit(500),
    supabase.from('v_public_accords').select('reference, titre, institution, plafond_montant, taux_consommation').order('reference'),
  ])
  return (
    <PublicShell title="Catalogue des accords-cadres" subtitle="Prix négociés pour les achats récurrents de l'État" wide>
      {(cat.error || acc.error) && <p role="alert" className="mb-4 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">Service momentanément indisponible.</p>}
      <div className="mb-6 overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500"><tr><th className="px-4 py-2">Accord</th><th className="px-4 py-2">Autorité</th><th className="px-4 py-2">Plafond</th><th className="px-4 py-2">Consommé</th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {(acc.data ?? []).map(a => <tr key={a.reference}><td className="px-4 py-2"><strong>{a.reference}</strong> — {a.titre}</td><td className="px-4 py-2">{a.institution}</td><td className="whitespace-nowrap px-4 py-2">{fcfa(a.plafond_montant)}</td><td className="px-4 py-2">{a.taux_consommation} %</td></tr>)}
            {!acc.data?.length && <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-500">Aucun accord-cadre actif.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500"><tr><th className="px-4 py-2">Catégorie</th><th className="px-4 py-2">Article</th><th className="px-4 py-2">Fournisseur</th><th className="px-4 py-2">Prix</th><th className="px-4 py-2">Délai</th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {(cat.data ?? []).map(i => <tr key={i.id}><td className="px-4 py-2">{i.categorie}</td><td className="px-4 py-2">{i.code_article} — {i.designation}</td><td className="px-4 py-2">{i.fournisseur}</td><td className="whitespace-nowrap px-4 py-2 font-semibold">{fcfa(i.prix_unitaire)} / {String(i.unite).toLowerCase()}</td><td className="px-4 py-2">{i.delai_livraison_jours} j</td></tr>)}
            {!cat.data?.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">Aucun article publié.</td></tr>}
          </tbody>
        </table>
      </div>
    </PublicShell>
  )
}
