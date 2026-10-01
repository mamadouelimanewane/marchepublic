import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireSession } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { dateFr } from '@/lib/format'
import { Alert, Card, Field, PageHeader } from '@/components/ui'
import { ActionForm } from '@/components/ActionForm'
import { submitAppeal } from '../../actions/passation'

export const dynamic = 'force-dynamic'

export default async function NouveauRecoursPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await requireSession('/dashboard/recours')
  if (session.role !== 'SOUMISSIONNAIRE') return notFound()
  const supabase = await createSupabaseServerClient()
  const { data: t } = await supabase.from('tenders').select('id, reference, title, current_phase, date_fin_recours').eq('id', id).maybeSingle()
  if (!t) notFound()
  const { data: bid } = await supabase.from('bids').select('status').eq('tender_id', id).maybeSingle()
  const { data: mine } = await supabase.from('appeals').select('id, status, date_depot').eq('tender_id', id)

  const open = t.current_phase === 'PHASE_10_RECOURS' && !!t.date_fin_recours && new Date(t.date_fin_recours) > new Date()
  const eligible = !!bid && !['RETARDEE', 'RETIREE', 'BROUILLON', 'PROVISOIREMENT_RETENUE'].includes(bid.status)

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title={`Recours — ${t.reference}`} subtitle={t.title} />
      <Alert tone={open ? 'amber' : 'red'} title={open ? `Délai de recours jusqu'au ${dateFr(t.date_fin_recours, true)}` : 'Aucun délai de recours ouvert'}>
        {open ? 'Le dépôt d\'un recours suspend la procédure : l\'attribution définitive est bloquée jusqu\'à la décision de l\'ARCOP.' : 'Le délai est échu ou la procédure n\'est pas au stade de l\'attribution provisoire.'}
      </Alert>
      {(mine ?? []).length > 0 && <Alert tone="blue">Vous avez déjà déposé {mine!.length} recours sur ce marché (statut : {mine!.map(m => m.status).join(', ')}). <Link className="underline" href="/dashboard/recours">Suivre</Link></Alert>}
      {open && eligible && (
        <Card title="Déposer un recours">
          <ActionForm action={submitAppeal} submitLabel="Déposer le recours" confirm="Déposer ce recours ? Il sera transmis à l'ARCOP et à l'autorité contractante.">
            <input type="hidden" name="tender_id" value={id} />
            <Field label="Motif" name="motif" required hint="Exposé synthétique des griefs (10 caractères min.)" />
            <Field label="Développement" name="description" rows={8} />
          </ActionForm>
        </Card>
      )}
      {open && !eligible && <Alert tone="red">Seul un candidat ayant déposé une offre recevable, et qui n'est pas l'attributaire provisoire, peut former un recours.</Alert>}
    </div>
  )
}
