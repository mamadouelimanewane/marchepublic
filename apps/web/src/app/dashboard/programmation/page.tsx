import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { dateFr, fcfa } from '@/lib/format'
import { Badge, Card, DataTable, Field, Grid, PageHeader } from '@/components/ui'
import { ActionButton, ActionForm } from '@/components/ActionForm'
import { WorkflowBadge } from '@/components/workflow/WorkflowBadge'
import { createBesoin, decideBesoin, submitBesoin } from '../actions/passation'

export const dynamic = 'force-dynamic'

const NATURES = [
  { value: 'TRAVAUX', label: 'Travaux' }, { value: 'FOURNITURES', label: 'Fournitures' }, { value: 'SERVICES_COURANTS', label: 'Services courants' },
  { value: 'PRESTATIONS_INTELLECTUELLES', label: 'Prestations intellectuelles' }, { value: 'DSP', label: 'Délégation de service public' }, { value: 'PPP', label: 'PPP' },
]
const STATUT_TONE = { BROUILLON: 'gray', SOUMIS: 'amber', VALIDE: 'blue', REJETE: 'red', PROGRAMME: 'green' } as const

export default async function ProgrammationPage({ searchParams }: { searchParams: Promise<{ annee?: string }> }) {
  const session = await requireSession('/dashboard/programmation')
  const { annee } = await searchParams
  const year = Number(annee) || new Date().getFullYear()
  const supabase = await createSupabaseServerClient()

  const [besoins, ppm, corps] = await Promise.all([
    supabase.from('besoins').select('id, intitule, nature_marche, montant_estime, ligne_budgetaire, annee_budget, statut, motif_rejet, tender_id, service_demandeur_id, users:service_demandeur_id(full_name), created_at').order('created_at', { ascending: false }).limit(100),
    supabase.from('tenders').select('id, reference, title, mode_passation, montant_estime, ppm_annee, ppm_trimestre, current_phase, date_prevue_lancement').eq('ppm_annee', year).order('ppm_trimestre').order('created_at'),
    supabase.from('corps_metiers').select('id, libelle').eq('is_active', true).order('libelle'),
  ])
  const canExpress = ['SERVICE_DEMANDEUR', 'CPM', 'PRM'].includes(session.role)
  const isPrm = session.role === 'PRM'
  const total = (ppm.data ?? []).reduce((s, t) => s + Number(t.montant_estime ?? 0), 0)

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="Programmation budgétaire et PPM" subtitle="Expression des besoins, validation par le PRM et Plan de Passation des Marchés annuel (phase 1)." />

      {canExpress && (
        <Card title="Exprimer un besoin" subtitle="Le besoin est rattaché à une ligne budgétaire ; le PRM le valide pour l'inscrire au PPM.">
          <ActionForm action={createBesoin} submitLabel="Soumettre au PRM">
            <input type="hidden" name="intent" value="submit" />
            <Grid cols={2}>
              <Field className="md:col-span-2" label="Intitulé du besoin" name="intitule" required hint="10 caractères minimum" />
              <Field label="Nature" name="nature_marche" required options={NATURES} defaultValue="FOURNITURES" />
              <Field label="Corps de métier" name="corps_metier_id" options={(corps.data ?? []).map(c => ({ value: c.id, label: c.libelle }))} />
              <Field label="Montant estimé (FCFA)" name="montant_estime" type="number" min={1} required />
              <Field label="Ligne budgétaire" name="ligne_budgetaire" required />
              <Field label="Programme budgétaire" name="programme_budget" />
              <Field label="Année budgétaire" name="annee_budget" type="number" min={2024} max={2050} required defaultValue={year} />
              <Field label="Trimestre souhaité" name="trimestre_souhaite" type="number" min={1} max={4} />
              <Field className="md:col-span-2" label="Justification" name="justification" rows={2} />
            </Grid>
          </ActionForm>
        </Card>
      )}

      <Card title="Besoins" padded={false}>
        <DataTable rows={besoins.data as never[]} rowKey={(b: { id: string }) => b.id} empty="Aucun besoin exprimé."
          columns={[
            { header: 'Intitulé', cell: (b: any) => <span className="font-medium">{b.intitule}</span> },
            { header: 'Demandeur', cell: (b: any) => b.users?.full_name ?? '—' },
            { header: 'Montant', cell: (b: any) => fcfa(b.montant_estime), className: 'whitespace-nowrap' },
            { header: 'Ligne', cell: (b: any) => b.ligne_budgetaire },
            { header: 'Statut', cell: (b: any) => <span><Badge tone={STATUT_TONE[b.statut as keyof typeof STATUT_TONE]}>{b.statut}</Badge>{b.motif_rejet && <span className="ml-2 text-xs text-red-700">{b.motif_rejet}</span>}</span> },
            { header: 'Actions', cell: (b: any) => (
              <span className="flex flex-wrap gap-2">
                {b.statut === 'BROUILLON' && b.service_demandeur_id === session.id && <ActionButton variant="secondary" label="Soumettre" action={submitBesoin.bind(null, b.id)} />}
                {isPrm && b.statut === 'SOUMIS' && (
                  <>
                    <ActionButton label="Valider et programmer" action={decideBesoin.bind(null, b.id, 'VALIDER', undefined)} />
                    <ActionForm action={decideBesoin.bind(null, b.id, 'REJETER')} submitLabel="Rejeter" variant="danger" className="flex items-end gap-2 space-y-0">
                      <input name="motif" placeholder="Motif du rejet" required minLength={10} className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs" />
                    </ActionForm>
                  </>
                )}
                {b.tender_id && <Link className="text-xs text-green-700 hover:underline" href={`/dashboard/marches/${b.tender_id}`}>Voir le marché</Link>}
              </span>
            ) },
          ]} />
      </Card>

      <Card title={`Plan de passation des marchés ${year}`} subtitle={`${ppm.data?.length ?? 0} marché(s) — ${fcfa(total)}`} padded={false}
        actions={<div className="flex items-center gap-3 text-sm">
          <form><select name="annee" defaultValue={year} className="rounded-lg border border-gray-300 px-2 py-1">{[year - 1, year, year + 1].map(y => <option key={y} value={y}>{y}</option>)}</select> <button className="rounded border px-2 py-1">Afficher</button></form>
          <span className="flex items-center gap-2">Exporter :
            <a className="font-medium text-green-700 hover:underline" href={`/api/ppm/export?annee=${year}&format=xlsx`}>Excel</a>
            <a className="font-medium text-green-700 hover:underline" href={`/api/ppm/export?annee=${year}&format=pdf`} target="_blank" rel="noreferrer">PDF</a>
            <a className="font-medium text-green-700 hover:underline" href={`/api/ppm/export?annee=${year}&format=csv`}>CSV</a></span>
        </div>}>
        <DataTable rows={ppm.data} rowKey={t => t.id} empty="Aucun marché programmé cette année."
          columns={[
            { header: 'T', cell: t => `T${t.ppm_trimestre}` },
            { header: 'Référence', cell: t => <Link className="font-medium text-green-800 hover:underline" href={`/dashboard/marches/${t.id}`}>{t.reference}</Link> },
            { header: 'Objet', cell: t => t.title },
            { header: 'Mode', cell: t => t.mode_passation ?? '—' },
            { header: 'Montant estimé', cell: t => fcfa(t.montant_estime), className: 'whitespace-nowrap' },
            { header: 'Lancement prévu', cell: t => dateFr(t.date_prevue_lancement) },
            { header: 'Phase', cell: t => <WorkflowBadge phase={t.current_phase} /> },
          ]} />
      </Card>
    </div>
  )
}
