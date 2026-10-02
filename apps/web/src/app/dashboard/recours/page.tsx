import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { dateFr } from '@/lib/format'
import { Alert, Badge, Card, DataTable, Field, PageHeader } from '@/components/ui'
import { ActionForm } from '@/components/ActionForm'
import { decideAppeal } from '../actions/passation'

export const dynamic = 'force-dynamic'

const TONE = { DEPOSE: 'amber', EN_INSTRUCTION: 'blue', IRRECEVABLE: 'gray', REJETE: 'gray', FAVORABLE: 'green', PARTIELLEMENT_FAVORABLE: 'green' } as const

export default async function RecoursPage() {
  const session = await requireSession('/dashboard/recours')
  const supabase = await createSupabaseServerClient()
  const isArcop = session.role === 'ARCOP'

  const [appeals, open] = await Promise.all([
    supabase.from('appeals')
      .select('id, motif, description, status, date_depot, date_limite_instruction, date_decision, decision_arcop, tender_id, lot_id, tender_lots(numero_lot, libelle), tenders(reference, title, current_phase, montant_attribue), users:requerant_id(full_name, ninea)')
      .order('date_depot', { ascending: false }),
    session.role === 'SOUMISSIONNAIRE'
      ? supabase.from('bids').select('tender_id, status, tenders(id, reference, title, current_phase, date_fin_recours)').not('status', 'in', '(RETARDEE,RETIREE,BROUILLON,PROVISOIREMENT_RETENUE)')
      : Promise.resolve({ data: null }),
  ])
  const rows = (appeals.data ?? []) as any[]
  const active = rows.filter(a => ['DEPOSE', 'EN_INSTRUCTION'].includes(a.status))
  const windows = ((open.data ?? []) as any[]).filter(b => b.tenders?.current_phase === 'PHASE_10_RECOURS')

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title={isArcop ? 'Régulation et recours (ARCOP)' : 'Recours'}
        subtitle="Tout recours pendant bloque, dans la base de données, l'attribution définitive et la signature du contrat." />
      <Card title="Dossiers contentieux" subtitle={`${active.length} en cours`} padded={false}>
        <div className="divide-y divide-gray-100">
          {rows.length ? rows.map(a => (
            <div key={a.id} className="space-y-3 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-green-800"><Link href={`/dashboard/marches/${a.tender_id}`} className="hover:underline">{a.tenders?.reference}</Link> — {a.tenders?.title}</p>
                  <p className="text-xs text-gray-500">Périmètre : {a.tender_lots ? `lot ${a.tender_lots.numero_lot} — ${a.tender_lots.libelle}` : 'marché entier'} · Requérant : {a.users?.full_name ?? '—'} · déposé le {dateFr(a.date_depot, true)} · instruction avant le {dateFr(a.date_limite_instruction, true)}</p>
                </div>
                <Badge tone={TONE[a.status as keyof typeof TONE]}>{a.status}</Badge>
              </div>
              <p className="text-sm font-medium text-gray-800">{a.motif}</p>
              {a.description && <p className="whitespace-pre-wrap text-sm text-gray-600">{a.description}</p>}
              {a.decision_arcop && <p className="rounded bg-gray-50 p-3 text-sm"><strong>Décision ({dateFr(a.date_decision)}) :</strong> {a.decision_arcop}</p>}
              {isArcop && ['DEPOSE', 'EN_INSTRUCTION'].includes(a.status) && (
                <ActionForm action={decideAppeal} submitLabel="Enregistrer" variant="primary" confirm="Enregistrer cette décision ? Les parties seront notifiées.">
                  <input type="hidden" name="appeal_id" value={a.id} />
                  <div className="grid gap-3 md:grid-cols-3">
                    <Field label="Décision" name="decision" required options={[
                      ...(a.status === 'DEPOSE' ? [{ value: 'EN_INSTRUCTION', label: 'Mettre en instruction' }] : []),
                      { value: 'IRRECEVABLE', label: 'Irrecevable' }, { value: 'REJETE', label: 'Rejeté' },
                      { value: 'FAVORABLE', label: a.lot_id ? 'Favorable (réévaluation de ce lot seulement)' : 'Favorable (reprise de l\'évaluation)' },
                      { value: 'PARTIELLEMENT_FAVORABLE', label: a.lot_id ? 'Partiellement favorable (réévaluation de ce lot)' : 'Partiellement favorable (reprise)' }]} />
                    <Field className="md:col-span-2" label="Motivation (20 caractères min. sauf mise en instruction)" name="motivation" rows={2} />
                  </div>
                </ActionForm>
              )}
            </div>
          )) : <p className="px-5 py-10 text-center text-sm text-gray-500">Aucun recours.</p>}
        </div>
      </Card>

      {session.role === 'SOUMISSIONNAIRE' && (
        <Card title="Délais de recours ouverts pour vous" padded={false}>
          <DataTable rows={windows} rowKey={(b: any) => b.tender_id} empty={<Alert>Aucun délai de recours n'est ouvert pour vos candidatures.</Alert>}
            columns={[
              { header: 'Marché', cell: (b: any) => `${b.tenders.reference} — ${b.tenders.title}` },
              { header: 'Fin du délai', cell: (b: any) => <strong className="text-red-700">{dateFr(b.tenders.date_fin_recours, true)}</strong> },
              { header: '', cell: (b: any) => <Link href={`/dashboard/recours/${b.tender_id}`} className="font-semibold text-red-700 hover:underline">Former un recours →</Link> },
            ]} />
        </Card>
      )}
    </div>
  )
}
