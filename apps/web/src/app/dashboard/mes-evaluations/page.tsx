import { requireSession } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { dateFr } from '@/lib/format'
import { Alert, Card, Field, PageHeader } from '@/components/ui'
import { ActionForm } from '@/components/ActionForm'
import { respondToEvaluation } from '../actions/fournisseur'

export const dynamic = 'force-dynamic'

export default async function MesEvaluationsPage() {
  const session = await requireSession('/dashboard/mes-evaluations')
  const supabase = await createSupabaseServerClient()
  const [evals, record] = await Promise.all([
    supabase.from('provider_evaluations').select('id, note_qualite, note_delai, note_cout, note_globale, commentaire, reponse_fournisseur, reponse_le, created_at, tenders(reference, title)').eq('prestataire_id', session.id).order('created_at', { ascending: false }),
    supabase.rpc('supplier_track_record', { p_user: session.id }),
  ])
  const r = (record.data as Record<string, number | null>[] | null)?.[0]

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="Mes évaluations de prestataire" subtitle="Après chaque marché, l'autorité contractante vous évalue. Vous pouvez y répondre une fois : votre réponse est conservée avec l'évaluation." />
      <Alert tone="blue">Seules des moyennes (à partir de 3 évaluations) sont publiées sur le portail de transparence ; les commentaires individuels restent confidentiels. Les autorités consultent votre historique lorsqu'elles évaluent vos offres.</Alert>
      {r && (
        <Card title="Mon historique">
          <dl className="grid gap-3 text-sm sm:grid-cols-4">
            <div><dt className="text-gray-500">Contrats</dt><dd className="text-xl font-bold">{r.nb_contrats}</dd></div>
            <div><dt className="text-gray-500">Évaluations</dt><dd className="text-xl font-bold">{r.nb_evaluations}</dd></div>
            <div><dt className="text-gray-500">Note globale</dt><dd className="text-xl font-bold">{r.note_globale ?? '—'} / 10</dd></div>
            <div><dt className="text-gray-500">Incidents critiques</dt><dd className="text-xl font-bold">{r.nb_incidents_critiques}</dd></div>
          </dl>
        </Card>
      )}
      {(evals.data ?? []).length === 0 && <Alert>Aucune évaluation pour le moment.</Alert>}
      {(evals.data ?? []).map((e: any) => (
        <Card key={e.id} title={`${e.tenders?.reference ?? ''} — ${e.tenders?.title ?? ''}`} subtitle={`Évalué le ${dateFr(e.created_at)}`}>
          <p className="text-sm">Qualité <strong>{e.note_qualite}</strong>/10 · Délais <strong>{e.note_delai}</strong>/10 · Coût <strong>{e.note_cout}</strong>/10 — globale <strong>{e.note_globale}</strong>/10</p>
          {e.commentaire && <p className="mt-2 rounded bg-gray-50 p-3 text-sm text-gray-700">Commentaire de l&apos;autorité : {e.commentaire}</p>}
          {e.reponse_fournisseur
            ? <p className="mt-2 rounded bg-green-50 p-3 text-sm text-green-900">Votre réponse ({dateFr(e.reponse_le)}) : {e.reponse_fournisseur}</p>
            : (
              <ActionForm action={respondToEvaluation.bind(null, e.id)} submitLabel="Envoyer ma réponse" className="mt-3" confirm="Une seule réponse est possible. L'envoyer ?">
                <Field label="Votre réponse (droit de réponse)" name="reponse" rows={3} required hint="20 à 2000 caractères — définitive une fois envoyée." />
              </ActionForm>
            )}
        </Card>
      ))}
    </div>
  )
}
