import { createSupabaseServerClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('users')
    .select('full_name, role, institution_id, institutions(name, type)')
    .eq('id', user.id)
    .single()

  const navItems = getNavItems(profile?.role ?? '')

  return (
    <div className="min-h-screen bg-gray-100 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-green-900 text-white flex-shrink-0">
        {/* Logo */}
        <div className="p-4 border-b border-green-700">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🇸🇳</span>
            <div>
              <p className="font-bold text-sm leading-tight">Marchés Publics</p>
              <p className="text-green-300 text-xs">Sénégal</p>
            </div>
          </div>
        </div>

        {/* Institution / Rôle */}
        <div className="p-4 border-b border-green-700">
          <p className="text-xs text-green-300 mb-0.5">Institution</p>
          {/* @ts-ignore */}
          <p className="font-semibold text-sm truncate">{profile?.institutions?.name ?? '—'}</p>
          <span className="mt-1 inline-block px-2 py-0.5 bg-green-700 text-green-100 text-xs rounded-full">
            {getRoleLabel(profile?.role)}
          </span>
        </div>

        {/* Navigation */}
        <nav className="p-2 flex-1">
          {navItems.map((section) => (
            <div key={section.section} className="mb-4">
              <p className="px-3 py-1 text-xs text-green-400 uppercase tracking-wider font-medium">
                {section.section}
              </p>
              {section.items.map((item) => (
                <a key={item.href} href={item.href}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-green-100 hover:bg-green-700 hover:text-white transition-colors mb-0.5">
                  <span>{item.icon}</span>
                  <span>{item.label}</span>
                </a>
              ))}
            </div>
          ))}
        </nav>

        {/* User info */}
        <div className="p-4 border-t border-green-700">
          <p className="text-sm font-medium truncate">{profile?.full_name}</p>
          <form action="/auth/signout" method="post">
            <button className="text-xs text-green-400 hover:text-white mt-1">
              Se déconnecter
            </button>
          </form>
        </div>
      </aside>

      {/* Contenu principal */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
          <h2 className="text-gray-600 text-sm">
            Plateforme Intégrée des Marchés Publics — Décret n°2022-2295
          </h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400">
              {new Date().toLocaleDateString('fr-SN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </span>
          </div>
        </header>
        <main className="flex-1 p-6 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  )
}

function getRoleLabel(role?: string) {
  const labels: Record<string, string> = {
    SERVICE_DEMANDEUR: 'Service demandeur',
    CPM: 'CPM',
    PRM: 'PRM',
    EVALUATEUR: 'Évaluateur',
    DCMP: 'DCMP',
    ARCOP: 'ARCOP',
    TRESOR: 'Trésor',
    SOUMISSIONNAIRE: 'Soumissionnaire',
    COUR_COMPTES: 'Cour des Comptes',
    ADMIN: 'Administrateur',
  }
  return labels[role ?? ''] ?? role
}

function getNavItems(role: string) {
  const allItems = [
    {
      section: 'Marchés',
      roles: ['SERVICE_DEMANDEUR', 'CPM', 'PRM', 'DCMP', 'ARCOP', 'ADMIN'],
      items: [
        { href: '/dashboard', icon: '🏠', label: 'Tableau de bord' },
        { href: '/dashboard/programmation', icon: '📋', label: 'Programmation / PPM' },
        { href: '/dashboard/redaction', icon: '📝', label: 'Rédaction TDR/DAO' },
        { href: '/dashboard/publication', icon: '📢', label: 'Publication AO' },
        { href: '/dashboard/depot', icon: '🔒', label: 'Dépôt des offres' },
        { href: '/dashboard/evaluation', icon: '⭐', label: 'Évaluation' },
        { href: '/dashboard/attribution', icon: '🏆', label: 'Attribution' },
      ],
    },
    {
      section: 'Exécution',
      roles: ['CPM', 'PRM', 'TRESOR', 'ADMIN'],
      items: [
        { href: '/dashboard/execution', icon: '⚙️', label: 'Exécution contrat' },
        { href: '/dashboard/reception', icon: '✅', label: 'Réception & paiement' },
        { href: '/dashboard/archivage', icon: '🗄️', label: 'Archivage' },
      ],
    },
    {
      section: 'Régulation',
      roles: ['ARCOP', 'DCMP', 'ADMIN'],
      items: [
        { href: '/dashboard/recours', icon: '⚖️', label: 'Recours ARCOP' },
        { href: '/dashboard/reporting', icon: '📊', label: 'Reporting / Statistiques' },
      ],
    },
    {
      section: 'Administration',
      roles: ['ADMIN'],
      items: [
        { href: '/dashboard/admin', icon: '⚙️', label: 'Administration' },
      ],
    },
  ]

  return allItems.filter(section => section.roles.includes(role))
}
