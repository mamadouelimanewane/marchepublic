import { PublicShell } from '@/components/PublicShell'
import { SignalementForm } from '@/components/SignalementForm'

export const metadata = { title: 'Signaler un problème | Marchés publics Sénégal' }

export default async function SignalementPage({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  const { ref } = await searchParams
  return (
    <PublicShell title="Signaler un problème" subtitle="Toute personne peut alerter les autorités de régulation, sans compte et sans donner son identité">
      <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        Votre signalement est lu par la DCMP, l&apos;ARCOP et la Cour des Comptes et rapproché des alertes automatiques de la plateforme.
        Aucun signalement n&apos;est publié. Vous recevez un code pour suivre son traitement ; votre contact n&apos;est demandé que si vous souhaitez être recontacté.
      </div>
      <SignalementForm defaultReference={ref} />
    </PublicShell>
  )
}
