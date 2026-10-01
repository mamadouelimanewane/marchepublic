import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { dateFr } from '@/lib/format'
import { Badge, Card, Field, Grid, PageHeader } from '@/components/ui'
import { ActionForm } from '@/components/ActionForm'
import { handleCitizenReport } from '../actions/controle'

export const dynamic = 'force-dynamic'

const TONE = { RECU: 'amber', EN_EXAMEN: 'blue', TRANSMIS: 'purple', CLOS_SANS_SUITE: 'gray' } as const
const CAT: Record<string, string> = {
  CORRUPTION: 'Corruption', FAVORITISME: 'Favoritisme', CONFLIT_INTERETS: 'Conflit d\'intérêts', EXECUTION_NON_CONFORME: 'Exécution non conforme', ACCES_ENTRAVE: 'Accès entravé', AUTRE: 'Autre',
}

export default async function SignalementsPage() {
  await requireSession('/dashboard/signalements')
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.from('citizen_reports')
    .select('id, code_suivi, tender_id, reference_texte, categorie, description, contact, statut, note_interne, created_at, tenders(reference, title)')
    .order('created_at', { ascending: false }).limit(200)
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Signalements citoyens" subtitle="Reçus du portail public, sans compte. Confidentiels : seuls les régulateurs les voient. Le déclarant suit l'état de son signalement avec son code." />
      {(data ?? []).length === 0 && <p className="rounded-xl border border-dashed border-gray-300 p-10 text-center text-sm text-gray-500">Aucun signalement.</p>}
      {(data ?? []).map((r: any) => (
        <Card key={r.id} title={<span className="flex flex-wrap items-center gap-2">{CAT[r.categorie]} <Badge tone={TONE[r.statut as keyof typeof TONE]}>{r.statut}</Badge> <span className="text-xs font-normal text-gray-400">code {r.code_suivi} · {dateFr(r.created_at, true)}</span></span>}>
          <p className="mb-2 text-sm text-gray-600">
            Marché : {r.tenders ? <Link className="text-green-800 underline" href={`/dashboard/marches/${r.tender_id}`}>{r.tenders.reference} — {r.tenders.title}</Link> : (r.reference_texte ? `${r.reference_texte} (non identifié)` : 'non précisé')}
          </p>
          <p className="whitespace-pre-wrap text-sm text-gray-800">{r.description}</p>
          {r.contact && <p className="mt-2 text-xs text-gray-500">Contact laissé : {r.contact}</p>}
          {r.note_interne && <p className="mt-2 rounded bg-gray-50 p-2 text-xs text-gray-600">Note interne : {r.note_interne}</p>}
          {r.statut !== 'CLOS_SANS_SUITE' && (
            <ActionForm action={handleCitizenReport.bind(null, r.id)} submitLabel="Mettre à jour" variant="secondary" className="mt-4">
              <Grid cols={2}>
                <Field label="Nouvel état" name="statut" required options={[{ value: 'EN_EXAMEN', label: 'En examen' }, { value: 'TRANSMIS', label: 'Transmis aux autorités compétentes' }, { value: 'CLOS_SANS_SUITE', label: 'Clos sans suite (motif requis)' }]} />
                <Field label="Note interne" name="note" />
              </Grid>
            </ActionForm>
          )}
        </Card>
      ))}
    </div>
  )
}
