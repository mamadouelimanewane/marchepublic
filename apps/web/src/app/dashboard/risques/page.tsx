import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { dateFr } from '@/lib/format'
import { Alert, Badge, Card, Field, PageHeader } from '@/components/ui'
import { ActionForm } from '@/components/ActionForm'
import { reviewRedFlag } from '../actions/controle'

export const dynamic = 'force-dynamic'

const FLAG_LABEL: Record<string, string> = {
  OFFRE_UNIQUE: 'Offre unique', DELAI_COURT: 'Délai de dépôt court', ATTRIBUTION_HORS_CLASSEMENT: 'Attribution hors classement',
  PRIX_SUPERIEUR_ESTIMATION: 'Prix supérieur à l\'estimation', ENTENTE_DIRECTE: 'Entente directe', AVENANTS_PROCHES_PLAFOND: 'Avenants proches du plafond',
  GAGNANT_RECURRENT: 'Gagnant récurrent', NOUVEAU_FOURNISSEUR: 'Nouveau fournisseur', RECOURS_FAVORABLE: 'Recours favorable',
}
const STATUT_TONE = { A_EXAMINER: 'amber', EXPLICATION: 'blue', JUSTIFIE: 'green', CONFIRME: 'red' } as const

export default async function RisquesPage() {
  const session = await requireSession('/dashboard/risques')
  const supabase = await createSupabaseServerClient()
  const [scores, flags, reviews] = await Promise.all([
    supabase.from('v_risk_scores').select('tender_id, reference, score, nb_alertes').order('score', { ascending: false }).limit(100),
    supabase.from('v_red_flags').select('tender_id, flag, severite, detail'),
    supabase.from('red_flag_reviews').select('tender_id, flag, statut, note, reviewer_role, created_at').order('created_at', { ascending: false }),
  ])
  const isRegulator = ['DCMP', 'ARCOP', 'COUR_COMPTES'].includes(session.role)
  const canExplain = session.role === 'PRM'
  const statuts = isRegulator
    ? [{ value: 'A_EXAMINER', label: 'À examiner' }, { value: 'JUSTIFIE', label: 'Justifiée' }, { value: 'CONFIRME', label: 'Confirmée (risque avéré)' }]
    : [{ value: 'EXPLICATION', label: 'Explication de l\'autorité contractante' }]

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Alertes de risque" subtitle="Indicateurs calculés automatiquement sur les marchés (candidat unique, délai court, attribution hors classement, prix, avenants, gagnants récurrents…). Une alerte n'est pas une preuve : elle désigne un dossier à examiner." />
      <Alert tone="blue">Chaque examen est conservé de façon immuable. Les alertes confirmées ou justifiées servent à affiner les seuils (paramètres <code>RF_*</code> dans l&apos;administration).</Alert>

      {(scores.data ?? []).length === 0 && <Alert tone="green">Aucune alerte active sur les marchés visibles avec votre profil.</Alert>}
      {(scores.data ?? []).map(s => {
        const myFlags = (flags.data ?? []).filter(f => f.tender_id === s.tender_id)
        return (
          <Card key={s.tender_id} title={<span className="flex items-center gap-2"><Link className="text-green-800 hover:underline" href={`/dashboard/marches/${s.tender_id}`}>{s.reference}</Link><Badge tone={s.score >= 6 ? 'red' : s.score >= 3 ? 'amber' : 'gray'}>score {s.score}</Badge></span>}>
            <ul className="space-y-4">
              {myFlags.map(f => {
                const hist = (reviews.data ?? []).filter(r => r.tender_id === s.tender_id && r.flag === f.flag)
                return (
                  <li key={f.flag} className="rounded-lg border border-gray-200 p-4">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-gray-800">
                      {FLAG_LABEL[f.flag] ?? f.flag} <Badge tone={f.severite >= 3 ? 'red' : f.severite === 2 ? 'amber' : 'gray'}>gravité {f.severite}</Badge>
                      {hist[0] && <Badge tone={STATUT_TONE[hist[0].statut as keyof typeof STATUT_TONE]}>{hist[0].statut}</Badge>}
                    </p>
                    <p className="mt-1 text-sm text-gray-600">{f.detail}</p>
                    {hist.length > 0 && (
                      <ul className="mt-2 space-y-1 text-xs text-gray-600">
                        {hist.map((h, i) => <li key={i}><strong>{h.reviewer_role}</strong> ({dateFr(h.created_at, true)}) — {h.statut} : {h.note}</li>)}
                      </ul>
                    )}
                    {(isRegulator || canExplain) && (
                      <ActionForm action={reviewRedFlag} submitLabel="Enregistrer" variant="secondary" className="mt-3 grid gap-3 space-y-0 md:grid-cols-[200px_1fr_auto] md:items-end">
                        <input type="hidden" name="tender_id" value={s.tender_id} /><input type="hidden" name="flag" value={f.flag} />
                        <Field label="Statut" name="statut" required options={statuts} defaultValue={statuts[0].value} />
                        <Field label="Note" name="note" required placeholder="10 caractères minimum" />
                      </ActionForm>
                    )}
                  </li>
                )
              })}
            </ul>
          </Card>
        )
      })}
    </div>
  )
}
