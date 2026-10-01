import Link from 'next/link'
import { Alert, PageHeader } from '@/components/ui'

export default function Forbidden() {
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Accès refusé" />
      <Alert tone="red">
        Votre rôle ne vous permet pas d'accéder à cette page. Si vous pensez qu'il s'agit d'une erreur,
        contactez l'administrateur de votre institution.
      </Alert>
      <p className="mt-4"><Link href="/dashboard" className="text-sm font-medium text-green-700 hover:underline">← Retour au tableau de bord</Link></p>
    </div>
  )
}
