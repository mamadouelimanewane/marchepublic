import { requireSession } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { fcfa } from '@/lib/format'
import { Alert, Badge, Card, DataTable, Field, Grid, PageHeader } from '@/components/ui'
import { ActionButton, ActionForm } from '@/components/ActionForm'
import { addAlertSubscription, removeAlertSubscription, toggleAlertSubscription } from '../actions/fournisseur'

export const dynamic = 'force-dynamic'

const CANAUX = [{ value: 'EMAIL', label: 'E-mail' }, { value: 'SMS', label: 'SMS' }, { value: 'WHATSAPP', label: 'WhatsApp' }]
const NATURES = [
  { value: 'TRAVAUX', label: 'Travaux' }, { value: 'FOURNITURES', label: 'Fournitures' }, { value: 'SERVICES_COURANTS', label: 'Services courants' },
  { value: 'PRESTATIONS_INTELLECTUELLES', label: 'Prestations intellectuelles' },
]

export default async function MesAlertesPage() {
  const session = await requireSession('/dashboard/mes-alertes')
  const supabase = await createSupabaseServerClient()
  const [subs, corps] = await Promise.all([
    supabase.from('tender_alert_subscriptions').select('id, canal, destinataire, nature, montant_min, actif, corps_metiers(libelle)').order('created_at'),
    supabase.from('corps_metiers').select('id, libelle').eq('is_active', true).order('libelle'),
  ])
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Mes alertes d'appels d'offres" subtitle="Soyez prévenu dès la publication d'un avis qui vous concerne, par e-mail, SMS ou WhatsApp, sans consulter le portail." />
      <Alert tone="blue">Les marchés réservés aux PME, à l&apos;économie sociale et solidaire ou aux PME à direction féminine ne vous sont signalés que si votre profil est certifié ({session.is_pme ? 'PME' : 'non PME'}{session.is_pme_feminine ? ', direction féminine' : ''}{session.is_ess ? ', ESS' : ''}).
        L&apos;envoi par SMS ou WhatsApp dépend du raccordement d&apos;un opérateur par l&apos;administrateur de la plateforme ; vos notifications en ligne sont toujours créées.</Alert>

      <Card title="Mes abonnements" padded={false}>
        <DataTable rows={subs.data as never[]} rowKey={(s: { id: string }) => s.id} empty="Aucune alerte."
          columns={[
            { header: 'Canal', cell: (s: any) => <Badge tone="blue">{s.canal}</Badge> }, { header: 'Destinataire', cell: (s: any) => s.destinataire },
            { header: 'Secteur', cell: (s: any) => s.corps_metiers?.libelle ?? 'Tous' }, { header: 'Nature', cell: (s: any) => s.nature ?? 'Toutes' },
            { header: 'Montant minimum', cell: (s: any) => s.montant_min ? fcfa(s.montant_min) : '—' },
            { header: 'Statut', cell: (s: any) => <Badge tone={s.actif ? 'green' : 'gray'}>{s.actif ? 'Active' : 'Suspendue'}</Badge> },
            { header: '', cell: (s: any) => <span className="flex gap-2"><ActionButton variant="secondary" label={s.actif ? 'Suspendre' : 'Réactiver'} action={toggleAlertSubscription.bind(null, s.id, !s.actif)} /><ActionButton variant="secondary" label="Supprimer" action={removeAlertSubscription.bind(null, s.id)} /></span> },
          ]} />
      </Card>

      <Card title="Nouvelle alerte" subtitle="10 alertes maximum. Laissez un critère vide pour tout recevoir.">
        <ActionForm action={addAlertSubscription} submitLabel="Créer l'alerte">
          <Grid cols={2}>
            <Field label="Canal" name="canal" required options={CANAUX} defaultValue="EMAIL" />
            <Field label="Adresse e-mail ou numéro (ex. +221771234567)" name="destinataire" required />
            <Field label="Secteur" name="corps_metier_id" options={(corps.data ?? []).map(c => ({ value: c.id, label: c.libelle }))} />
            <Field label="Nature" name="nature" options={NATURES} />
            <Field label="Montant estimé minimum (FCFA)" name="montant_min" type="number" min={0} />
          </Grid>
        </ActionForm>
      </Card>
    </div>
  )
}
