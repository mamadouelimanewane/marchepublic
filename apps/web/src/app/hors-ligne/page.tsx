export const metadata = { title: 'Hors ligne | Marchés publics Sénégal' }

export default function HorsLigne() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-6">
      <div className="max-w-md text-center">
        <p className="text-4xl" aria-hidden>📡</p>
        <h1 className="mt-3 text-xl font-bold text-gray-900">Vous êtes hors ligne</h1>
        <p className="mt-2 text-sm text-gray-600">
          Cette page n&apos;est pas disponible sans connexion. Les avis déjà consultés restent lisibles. Votre travail en cours (dépôt d&apos;offre,
          saisies) n&apos;est pas perdu tant que la page reste ouverte : rétablissez la connexion puis réessayez.
        </p>
      </div>
    </main>
  )
}
