import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ROLE_LABELS, navFor } from '@marchepublic/workflow'
import { getSession } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session) redirect('/login')

  const supabase = await createSupabaseServerClient()
  const { count: unread } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null)
  const nav = navFor(session.role)

  return (
    <div className="flex min-h-screen bg-gray-100">
      <aside className="hidden w-64 flex-shrink-0 flex-col bg-green-900 text-white md:flex">
        <div className="border-b border-green-700 p-4">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="text-2xl" aria-hidden>🇸🇳</span>
            <span>
              <span className="block text-sm font-bold leading-tight">Marchés Publics</span>
              <span className="block text-xs text-green-300">République du Sénégal</span>
            </span>
          </Link>
        </div>
        <div className="border-b border-green-700 p-4">
          <p className="text-xs text-green-300">{session.institution ? 'Institution' : 'Profil'}</p>
          <p className="truncate text-sm font-semibold">{session.institution?.name ?? session.full_name}</p>
          <span className="mt-1 inline-block rounded-full bg-green-700 px-2 py-0.5 text-xs text-green-100">{ROLE_LABELS[session.role]}</span>
        </div>
        <nav aria-label="Navigation principale" className="flex-1 overflow-y-auto p-2">
          {nav.map(section => (
            <div key={section.section} className="mb-3">
              <p className="px-3 py-1 text-xs font-medium uppercase tracking-wider text-green-400">{section.section}</p>
              {section.items.map(item => (
                <Link key={item.href} href={item.href}
                  className="mb-0.5 block rounded-lg px-3 py-2 text-sm text-green-100 transition-colors hover:bg-green-700 hover:text-white">
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="border-t border-green-700 p-4">
          <p className="truncate text-sm font-medium">{session.full_name}</p>
          <form action="/auth/signout" method="post">
            <button className="mt-1 text-xs text-green-300 hover:text-white">Se déconnecter</button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 md:px-6">
          <details className="relative md:hidden">
            <summary className="cursor-pointer list-none rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700">☰ Menu</summary>
            <nav aria-label="Navigation mobile" className="absolute left-0 top-10 z-20 max-h-[70vh] w-64 overflow-y-auto rounded-xl border border-gray-200 bg-white p-2 shadow-lg">
              {nav.map(section => (
                <div key={section.section} className="mb-2">
                  <p className="px-3 py-1 text-xs font-semibold uppercase text-gray-400">{section.section}</p>
                  {section.items.map(item => (
                    <Link key={item.href} href={item.href} className="block rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-green-50">{item.label}</Link>
                  ))}
                </div>
              ))}
              <form action="/auth/signout" method="post"><button className="w-full px-3 py-2 text-left text-sm text-red-600">Se déconnecter</button></form>
            </nav>
          </details>
          <p className="hidden text-sm text-gray-500 md:block">Plateforme intégrée des marchés publics — Décret n°2022-2295</p>
          <div className="flex items-center gap-3 text-sm">
            <Link href="/dashboard/notifications" className="relative rounded-lg px-2 py-1 text-gray-600 hover:bg-gray-100" aria-label="Notifications">
              🔔{!!unread && <span className="ml-1 rounded-full bg-red-600 px-1.5 py-0.5 text-xs font-bold text-white">{unread}</span>}
            </Link>
          </div>
        </header>
        <main className="flex-1 overflow-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  )
}
