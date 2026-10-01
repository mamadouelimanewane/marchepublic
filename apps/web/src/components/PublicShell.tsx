import Link from 'next/link'
import type { ReactNode } from 'react'

/** Cadre commun des pages publiques (portail de transparence, signalement, avis). */
export function PublicShell({ title, subtitle, children, wide }: { title: string; subtitle?: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-green-800 px-6 py-4 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">🇸🇳 {title}</h1>
            {subtitle && <p className="text-sm text-green-200">{subtitle}</p>}
          </div>
          <nav aria-label="Navigation publique" className="flex flex-wrap gap-4 text-sm">
            <Link href="/" className="text-green-200 hover:text-white">Accueil</Link>
            <Link href="/avis" className="text-green-200 hover:text-white">Avis d'appel d'offres</Link>
            <Link href="/transparence" className="text-green-200 hover:text-white">Transparence</Link>
            <Link href="/transparence/catalogue" className="text-green-200 hover:text-white">Catalogue</Link>
            <Link href="/transparence/prestataires" className="text-green-200 hover:text-white">Prestataires</Link>
            <Link href="/signalement" className="text-green-200 hover:text-white">Signaler</Link>
            <Link href="/login" className="font-semibold text-yellow-300 hover:text-yellow-200">Connexion</Link>
          </nav>
        </div>
      </header>
      <main className={`mx-auto px-4 py-8 ${wide ? 'max-w-6xl' : 'max-w-3xl'}`}>{children}</main>
      <footer className="border-t border-gray-200 py-6 text-center text-xs text-gray-500">
        Données ouvertes au standard <a className="underline" href="https://standard.open-contracting.org/" rel="noreferrer">OCDS</a> — licence CC BY 4.0 —{' '}
        <Link className="underline" href="/api/ocds/releases">API</Link> · <Link className="underline" href="/transparence/ancrage">Empreintes d'audit</Link>
      </footer>
    </div>
  )
}
