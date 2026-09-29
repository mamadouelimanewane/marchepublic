import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export default async function HomePage() {
  const supabase = await createSupabaseServerClient()

  let totalAO = 0;
  let totalInstitutions = 0;

  try {
    const [resAO, resInst] = await Promise.all([
      supabase
        .from('tenders')
        .select('*', { count: 'exact', head: true })
        .gte('current_phase', 'PHASE_4_PUBLICATION'),
      supabase
        .from('institutions')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true),
    ]);
    totalAO = resAO.count ?? 0;
    totalInstitutions = resInst.count ?? 0;
  } catch (error) {
    console.warn("Base de données injoignable (Docker manquant ?). Mode démo activé.");
    totalAO = 12; // Valeurs factices pour la démo UI
    totalInstitutions = 4;
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-green-900 to-green-700">
      {/* Header national */}
      <header className="bg-green-900 border-b border-green-700">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-yellow-400 rounded-full flex items-center justify-center">
              <span className="text-green-900 font-bold text-xs">🇸🇳</span>
            </div>
            <div>
              <p className="text-yellow-300 text-xs font-medium">RÉPUBLIQUE DU SÉNÉGAL</p>
              <p className="text-white text-xs">Un Peuple – Un But – Une Foi</p>
            </div>
          </div>
          <nav className="flex items-center gap-4">
            <Link href="/avis" className="text-green-100 hover:text-white text-sm">
              Avis d'AO
            </Link>
            <Link href="/login"
              className="bg-yellow-400 text-green-900 px-4 py-2 rounded-md text-sm font-semibold hover:bg-yellow-300 transition-colors">
              Connexion
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-7xl mx-auto px-4 py-16 text-center">
        <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">
          Plateforme Intégrée des Marchés Publics
        </h1>
        <p className="text-green-100 text-lg mb-2">
          De la programmation budgétaire à l'archivage définitif
        </p>
        <p className="text-green-200 text-sm mb-10">
          Conforme au Décret n°2022-2295 du 28 décembre 2022 portant Code des Marchés Publics
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center mb-16">
          <Link href="/avis"
            className="bg-yellow-400 text-green-900 px-8 py-3 rounded-lg font-semibold hover:bg-yellow-300 transition-colors">
            Consulter les Appels d'Offres
          </Link>
          <Link href="/register"
            className="border-2 border-white text-white px-8 py-3 rounded-lg font-semibold hover:bg-white/10 transition-colors">
            S'inscrire (Soumissionnaire)
          </Link>
        </div>

        {/* Statistiques publiques */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-3xl mx-auto">
          <div className="bg-white/10 backdrop-blur rounded-xl p-6">
            <p className="text-4xl font-bold text-yellow-300">{totalAO ?? 0}</p>
            <p className="text-green-100 text-sm mt-1">Appels d'offres actifs</p>
          </div>
          <div className="bg-white/10 backdrop-blur rounded-xl p-6">
            <p className="text-4xl font-bold text-yellow-300">{totalInstitutions ?? 0}</p>
            <p className="text-green-100 text-sm mt-1">Autorités contractantes</p>
          </div>
          <div className="bg-white/10 backdrop-blur rounded-xl p-6">
            <p className="text-4xl font-bold text-yellow-300">15</p>
            <p className="text-green-100 text-sm mt-1">Phases de workflow conformes</p>
          </div>
        </div>
      </section>

      {/* Modules */}
      <section className="bg-white py-16">
        <div className="max-w-7xl mx-auto px-4">
          <h2 className="text-2xl font-bold text-gray-800 text-center mb-10">
            Couverture complète du cycle des marchés publics
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { icon: '📋', title: 'Programmation & PPM', desc: 'Plan de Passation des Marchés annuel' },
              { icon: '📝', title: 'Rédaction assistée', desc: 'TDR et DAO conformes aux modèles DCMP' },
              { icon: '🔒', title: 'Coffre-fort cryptographique', desc: 'Offres chiffrées AES-256 jusqu\'à l\'ouverture' },
              { icon: '⚖️', title: 'Recours ARCOP', desc: 'Gestion des recours avec blocage automatique' },
              { icon: '📊', title: 'Tableaux de bord', desc: 'KPI par institution, phase et corps de métier' },
              { icon: '🏢', title: 'Quotas PME', desc: 'Suivi automatique 5% PME/ESS, 2% PME féminines' },
            ].map((item) => (
              <div key={item.title} className="bg-gray-50 rounded-xl p-6 border border-gray-100">
                <div className="text-3xl mb-3">{item.icon}</div>
                <h3 className="font-semibold text-gray-800 mb-1">{item.title}</h3>
                <p className="text-gray-500 text-sm">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-green-900 text-green-200 py-8 text-center text-sm">
        <p>© 2026 République du Sénégal — Plateforme développée par PROCESSINGENIERIE</p>
        <p className="mt-1">Conforme au Décret n°2022-2295 — Directives UEMOA 2005</p>
      </footer>
    </main>
  )
}
