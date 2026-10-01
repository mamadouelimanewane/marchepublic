import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { dateFr, fcfa } from '@/lib/format'
import { Alert, Badge, Card, DataTable, Field, Grid, PageHeader } from '@/components/ui'
import { ActionForm } from '@/components/ActionForm'
import { createFrameworkAgreement } from '../actions/catalogue'

export const dynamic = 'force-dynamic'

export default async function CataloguePage() {
  const session = await requireSession('/dashboard/catalogue')
  const supabase = await createSupabaseServerClient()
  const { data: accords } = await supabase.from('framework_agreements')
    .select('id, reference, titre, date_debut, date_fin, plafond_montant, montant_commande, statut, institutions(name)').order('created_at', { ascending: false })

  // Marchés en accord-cadre déjà contractualisés et pas encore ouverts au catalogue (PRM de l'autorité).
  let pending: { id: string; reference: string; title: string }[] = []
  if (session.role === 'PRM') {
    const used = new Set((await supabase.from('framework_agreements').select('tender_id')).data?.map(a => a.tender_id) ?? [])
    const { data } = await supabase.from('tenders').select('id, reference, title').eq('mode_passation', 'ACCORD_CADRE').gte('current_phase', 'PHASE_13_EXECUTION')
    pending = (data ?? []).filter(t => !used.has(t.id))
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Catalogue électronique d'accords-cadres" subtitle="Achats récurrents au prix négocié : l'autorité commande directement dans le plafond de l'accord, sans nouvelle mise en concurrence." />
      <Alert tone="blue">Les articles sont décrits par des attributs standardisés (pas de texte libre) pour rester comparables. Les prix du catalogue sont publics ; les commandes restent confidentielles.</Alert>

      {pending.map(t => (
        <Card key={t.id} title={`Ouvrir un accord-cadre — ${t.reference}`} subtitle={t.title}>
          <ActionForm action={createFrameworkAgreement.bind(null, t.id)} submitLabel="Créer l'accord-cadre" redirectPattern="/dashboard/catalogue/{id}">
            <Grid cols={2}>
              <Field label="Intitulé" name="titre" required className="md:col-span-2" />
              <Field label="Début" name="date_debut" type="date" required />
              <Field label="Fin" name="date_fin" type="date" required />
              <Field label="Plafond (FCFA)" name="plafond_montant" type="number" min={1} required hint="Ne peut pas dépasser le montant contractualisé." />
            </Grid>
          </ActionForm>
        </Card>
      ))}

      <Card title="Accords-cadres" padded={false}>
        <DataTable rows={accords} rowKey={a => a.id} empty="Aucun accord-cadre accessible."
          columns={[
            { header: 'Référence', cell: a => <Link className="font-medium text-green-700 hover:underline" href={`/dashboard/catalogue/${a.id}`}>{a.reference}</Link> },
            { header: 'Intitulé', cell: a => a.titre },
            { header: 'Autorité', cell: (a: any) => a.institutions?.name },
            { header: 'Période', cell: a => `${dateFr(a.date_debut)} → ${dateFr(a.date_fin)}` },
            { header: 'Consommation', cell: a => `${fcfa(a.montant_commande)} / ${fcfa(a.plafond_montant)}` },
            { header: 'Statut', cell: a => <Badge tone={a.statut === 'ACTIF' ? 'green' : 'gray'}>{a.statut}</Badge> },
          ]} />
      </Card>
    </div>
  )
}
