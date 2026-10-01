import { requireRole } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Alert, Card, PageHeader } from '@/components/ui'
import { TenderForm } from '@/components/forms/TenderForm'
import { createTender } from '../../actions/marches'
import type { TypeInstitution } from '@marchepublic/workflow'

export const dynamic = 'force-dynamic'

export default async function NouveauMarche() {
  const session = await requireRole(['PRM', 'CPM'])
  const supabase = await createSupabaseServerClient()
  const { data: corps } = await supabase.from('corps_metiers').select('id, libelle').eq('is_active', true).order('libelle')

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Nouveau marché" subtitle="Inscription directe au PPM. Les besoins exprimés par les services demandeurs passent par « Programmation »." />
      <Alert tone="blue">La référence est attribuée automatiquement (MP-CODE-ANNÉE-N°) et le marché démarre en phase 1.</Alert>
      <Card className="mt-4">
        <TenderForm action={createTender} redirectPattern="/dashboard/marches/{id}" corps={corps ?? []} institutionType={(session.institution?.type ?? 'ETAT') as TypeInstitution} submitLabel="Créer le marché" />
      </Card>
    </div>
  )
}
