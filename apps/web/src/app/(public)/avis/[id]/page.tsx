import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
import { dateFr } from '@/lib/format'
import { ActionButton, ActionForm } from '@/components/ActionForm'
import { retirerDossier, askQuestion } from '@/app/dashboard/actions/passation'

export const dynamic = 'force-dynamic'

export default async function AvisDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: a } = await supabase.from('v_avis_publics').select('*').eq('id', id).maybeSingle()
  if (!a) notFound()

  const session = await getSession()
  const isBidder = session?.role === 'SOUMISSIONNAIRE'
  const [docs, qr, retrait, lots] = isBidder
    ? await Promise.all([
        supabase.from('tender_documents').select('id, titre, type, contenu, created_at').eq('tender_id', id).in('type', ['TDR', 'DAO', 'ADDITIF']).order('created_at'),
        supabase.from('v_clarifications_publiques').select('id, question, reponse').eq('tender_id', id).order('created_at'),
        supabase.from('dossier_retraits').select('retire_le').eq('tender_id', id).maybeSingle(),
        a.is_alloti ? supabase.from('tender_lots').select('id, numero_lot, libelle, montant_estime').eq('tender_id', id).order('numero_lot') : Promise.resolve({ data: null }),
      ])
    : [null, null, null, null]
  const depositOpen = a.current_phase === 'PHASE_6_DEPOT_OFFRES'

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-green-800 px-6 py-4 text-white">
        <div className="mx-auto max-w-4xl"><Link href="/avis" className="text-sm text-green-200 hover:text-white">← Tous les avis</Link></div>
      </header>
      <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-bold text-green-800">{a.reference}</p>
          <h1 className="text-2xl font-bold text-gray-900">{a.title}</h1>
          <p className="mt-1 text-gray-600">{a.institution_name}</p>
          {a.description && <p className="mt-4 whitespace-pre-wrap text-sm text-gray-700">{a.description}</p>}
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-gray-500">Mode de passation</dt><dd className="font-medium">{a.mode_passation}</dd></div>
            <div><dt className="text-gray-500">Secteur</dt><dd className="font-medium">{a.corps_metier ?? a.nature_marche}</dd></div>
            <div><dt className="text-gray-500">Publié le</dt><dd className="font-medium">{dateFr(a.date_publication)}</dd></div>
            <div><dt className="text-gray-500">Date limite de dépôt</dt><dd className="font-semibold text-red-700">{dateFr(a.date_limite_depot, true)}</dd></div>
          </dl>
        </div>

        {!session && (
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-5 text-sm text-blue-900">
            Pour retirer le dossier, poser une question ou déposer une offre, <Link className="font-semibold underline" href={`/login?redirect=/avis/${id}`}>connectez-vous</Link> ou <Link className="font-semibold underline" href="/register">créez un compte soumissionnaire</Link>.
          </div>
        )}

        {isBidder && (
          <>
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="mb-3 text-lg font-semibold">Dossier d'appel d'offres</h2>
              {!retrait?.data ? (
                <div className="space-y-2">
                  <p className="text-sm text-gray-600">Retirez le dossier pour recevoir les additifs et les réponses aux questions.</p>
                  <ActionButton label="Retirer le dossier" action={retirerDossier.bind(null, id)} />
                </div>
              ) : <p className="text-sm text-green-700">Dossier retiré le {dateFr(retrait.data.retire_le, true)}.</p>}
              {retrait?.data && (
                <div className="mt-4 space-y-4">
                  {(docs?.data ?? []).map(d => (
                    <details key={d.id} className="rounded-lg border border-gray-200 p-3" open={d.type === 'ADDITIF'}>
                      <summary className="cursor-pointer text-sm font-semibold">{d.titre} <span className="text-xs text-gray-400">({d.type})</span></summary>
                      <div className="mt-3 space-y-3">
                        {((d.contenu as { sections?: { id: string; titre: string; contenu: string }[] })?.sections ?? []).map(s => (
                          <section key={s.id}><h3 className="text-sm font-semibold">{s.titre}</h3><p className="whitespace-pre-wrap text-sm text-gray-600">{s.contenu}</p></section>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </div>

            {(lots?.data ?? []).length > 0 && (
              <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                <h2 className="mb-3 text-lg font-semibold">Lots</h2>
                <ul className="space-y-1 text-sm">{lots!.data!.map(l => <li key={l.id} className="rounded bg-gray-50 px-3 py-1">Lot {l.numero_lot} — {l.libelle} <span className="text-gray-500">({Number(l.montant_estime ?? 0).toLocaleString('fr-FR')} FCFA estimés)</span></li>)}</ul>
              </div>
            )}

            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="mb-3 text-lg font-semibold">Questions et réponses</h2>
              <ul className="mb-4 space-y-2 text-sm">
                {(qr?.data ?? []).map(q => <li key={q.id} className="rounded bg-gray-50 p-2"><p className="font-medium">Q : {q.question}</p><p className="text-green-800">R : {q.reponse}</p></li>)}
                {!qr?.data?.length && <li className="text-gray-500">Aucune question publiée.</li>}
              </ul>
              <ActionForm action={askQuestion} submitLabel="Poser une question">
                <input type="hidden" name="tender_id" value={id} />
                <label className="block text-sm font-medium text-gray-700">Votre question
                  <textarea name="question" required minLength={10} rows={2} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                </label>
              </ActionForm>
            </div>

            <div className="text-center">
              {depositOpen
                ? <Link href={`/dashboard/depot/${id}`} className="inline-block rounded-lg bg-purple-700 px-6 py-3 font-semibold text-white hover:bg-purple-800">🔒 Déposer mon offre</Link>
                : <p className="text-sm text-gray-500">Le dépôt des offres n'est pas encore ouvert.</p>}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
