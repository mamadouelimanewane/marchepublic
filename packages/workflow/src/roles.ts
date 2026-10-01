// ==========================================
// Rôles et droits d'accès par module (CDC §3 et §8) — partagé par le middleware, le menu et les pages.
// Rappel : ce ne sont que des contrôles d'ergonomie ; les droits réels sont appliqués par la RLS et les RPC.
// ==========================================

export const ROLES = [
  'SERVICE_DEMANDEUR',
  'CPM',
  'PRM',
  'EVALUATEUR',
  'DCMP',
  'ARCOP',
  'TRESOR',
  'SOUMISSIONNAIRE',
  'COUR_COMPTES',
  'BAILLEUR',
  'ADMIN',
] as const

export type Role = (typeof ROLES)[number]

export const ROLE_LABELS: Record<Role, string> = {
  SERVICE_DEMANDEUR: 'Service demandeur',
  CPM: 'Cellule de passation (CPM)',
  PRM: 'Personne responsable des marchés (PRM)',
  EVALUATEUR: 'Membre de commission',
  DCMP: 'DCMP',
  ARCOP: 'ARCOP',
  TRESOR: 'Contrôleur financier / Trésor',
  SOUMISSIONNAIRE: 'Soumissionnaire',
  COUR_COMPTES: 'Cour des Comptes',
  BAILLEUR: 'Bailleur de fonds',
  ADMIN: 'Administrateur',
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
}

/** Personnel des autorités contractantes. */
export const INSTITUTION_ROLES: readonly Role[] = ['SERVICE_DEMANDEUR', 'CPM', 'PRM', 'EVALUATEUR', 'TRESOR', 'ADMIN']
export const REGULATOR_ROLES: readonly Role[] = ['DCMP', 'ARCOP', 'COUR_COMPTES']

/** Préfixe de route → rôles autorisés (le plus long préfixe correspondant l'emporte). */
export const ROUTE_ACCESS: Record<string, readonly Role[]> = {
  '/dashboard/admin': ['ADMIN'],
  '/dashboard/programmation': ['SERVICE_DEMANDEUR', 'CPM', 'PRM', 'DCMP', 'ADMIN'],
  '/dashboard/redaction': ['SERVICE_DEMANDEUR', 'CPM', 'PRM', 'DCMP', 'ADMIN'],
  '/dashboard/dcmp': ['DCMP', 'BAILLEUR'],
  '/dashboard/publication': ['CPM', 'PRM', 'DCMP', 'ADMIN'],
  '/dashboard/depot': ['SOUMISSIONNAIRE'],
  '/dashboard/mes-offres': ['SOUMISSIONNAIRE'],
  '/dashboard/evaluation': ['EVALUATEUR', 'CPM', 'PRM', 'DCMP', 'ARCOP', 'COUR_COMPTES'],
  '/dashboard/attribution': ['CPM', 'PRM', 'DCMP', 'ARCOP', 'COUR_COMPTES', 'SOUMISSIONNAIRE'],
  '/dashboard/recours': ['ARCOP', 'SOUMISSIONNAIRE', 'PRM', 'CPM', 'DCMP', 'COUR_COMPTES', 'ADMIN'],
  '/dashboard/execution': ['CPM', 'PRM', 'TRESOR', 'SOUMISSIONNAIRE', 'DCMP', 'COUR_COMPTES'],
  '/dashboard/reception': ['CPM', 'PRM', 'TRESOR', 'SOUMISSIONNAIRE', 'COUR_COMPTES'],
  '/dashboard/archivage': ['CPM', 'PRM', 'ADMIN', 'DCMP', 'ARCOP', 'COUR_COMPTES'],
  '/dashboard/reporting': ['PRM', 'CPM', 'DCMP', 'ARCOP', 'COUR_COMPTES', 'ADMIN'],
  '/dashboard/audit': ['DCMP', 'ARCOP', 'COUR_COMPTES', 'ADMIN', 'PRM', 'CPM'],
  '/dashboard/mes-documents': ['SOUMISSIONNAIRE'],
  '/dashboard/mes-alertes': ['SOUMISSIONNAIRE'],
  '/dashboard/mes-evaluations': ['SOUMISSIONNAIRE'],
  '/dashboard/pieces': ['ADMIN', 'DCMP'],
  '/dashboard/risques': ['DCMP', 'ARCOP', 'COUR_COMPTES', 'ADMIN', 'PRM'],
  '/dashboard/signalements': ['DCMP', 'ARCOP', 'COUR_COMPTES'],
  '/dashboard/catalogue': ['SERVICE_DEMANDEUR', 'CPM', 'PRM', 'SOUMISSIONNAIRE', 'DCMP', 'ARCOP', 'COUR_COMPTES'],
}

export function canAccessRoute(role: Role, pathname: string): boolean {
  const match = Object.keys(ROUTE_ACCESS)
    .filter(prefix => pathname === prefix || pathname.startsWith(prefix + '/'))
    .sort((a, b) => b.length - a.length)[0]
  return match ? ROUTE_ACCESS[match].includes(role) : true   // /dashboard, /dashboard/marches… : filtrés par la RLS
}

export interface NavItem { href: string; label: string }
export interface NavSection { section: string; items: NavItem[] }

const NAV: { section: string; items: (NavItem & { roles?: readonly Role[] })[] }[] = [
  {
    section: 'Pilotage',
    items: [
      { href: '/dashboard', label: 'Tableau de bord' },
      { href: '/dashboard/marches', label: 'Marchés', roles: ['SERVICE_DEMANDEUR', 'CPM', 'PRM', 'EVALUATEUR', 'TRESOR', 'DCMP', 'ARCOP', 'COUR_COMPTES', 'BAILLEUR', 'ADMIN'] },
      { href: '/dashboard/mes-offres', label: 'Mes offres', roles: ['SOUMISSIONNAIRE'] },
      { href: '/dashboard/mes-documents', label: 'Mon dossier permanent', roles: ['SOUMISSIONNAIRE'] },
      { href: '/dashboard/mes-alertes', label: 'Mes alertes', roles: ['SOUMISSIONNAIRE'] },
      { href: '/dashboard/mes-evaluations', label: 'Mes évaluations', roles: ['SOUMISSIONNAIRE'] },
      { href: '/dashboard/pieces', label: 'Pièces à vérifier', roles: ['ADMIN', 'DCMP'] },
      { href: '/dashboard/alertes', label: 'Alertes', roles: ['PRM', 'CPM', 'DCMP', 'ARCOP', 'TRESOR'] },
    ],
  },
  {
    section: 'Passation',
    items: [
      { href: '/dashboard/programmation', label: 'Programmation / PPM' },
      { href: '/dashboard/redaction', label: 'Rédaction TDR / DAO' },
      { href: '/dashboard/dcmp', label: 'Contrôle a priori' },
      { href: '/dashboard/publication', label: 'Publication & Q/R' },
      { href: '/dashboard/depot', label: 'Dépôt des offres' },
      { href: '/dashboard/evaluation', label: 'Ouverture & évaluation' },
      { href: '/dashboard/attribution', label: 'Attribution' },
      { href: '/dashboard/recours', label: 'Recours' },
    ],
  },
  {
    section: 'Exécution',
    items: [
      { href: '/dashboard/execution', label: 'Contrats & exécution' },
      { href: '/dashboard/reception', label: 'Réception & paiements' },
      { href: '/dashboard/catalogue', label: 'Catalogue accords-cadres' },
      { href: '/dashboard/archivage', label: 'Archivage' },
    ],
  },
  {
    section: 'Contrôle',
    items: [
      { href: '/dashboard/reporting', label: 'Reporting & statistiques' },
      { href: '/dashboard/risques', label: 'Alertes de risque' },
      { href: '/dashboard/signalements', label: 'Signalements citoyens' },
      { href: '/dashboard/audit', label: 'Journal d\'audit' },
    ],
  },
  { section: 'Administration', items: [{ href: '/dashboard/admin', label: 'Paramétrage & comptes' }] },
]

export function navFor(role: Role): NavSection[] {
  return NAV.map(section => ({
    section: section.section,
    items: section.items
      .filter(item => (item.roles ? item.roles.includes(role) : canAccessRoute(role, item.href)))
      .map(({ href, label }) => ({ href, label })),
  })).filter(section => section.items.length > 0)
}
