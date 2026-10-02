import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireSession } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { dateFr } from '@/lib/format'
import { Alert, Card, Field, PageHeader } from '@/components/ui'
import { ActionForm } from '@/components/ActionForm'
import { submitAppeal } from '../../actions/passation'

export const dynamic = 'force-dynamic'

const NOT_ADMISSIBLE = ['RETARDEE', 'RETIREE', 'BROUILLON', 'PROVISOIREMENT_RETENUE']

export default async function NouveauRecoursPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await requireSession('/dashboard/recours')
  if (session.role !== 'SOUMISSIONNAIRE') return notFound()
  const supabase = await createSupabaseServerClient()
  const { data: t } = await supabase.from('tenders').select('id, reference, title, current_phase, date_fin_recours, is_alloti').eq('id', id).maybeSingle()
  if (!t) notFound()
  const [bids, lots, mine] = await Promise.all([
    supabase.from('bids').select('status, lot_id').eq('tender_id', id),        // la RLS ne renvoie que mes offres
    supabase.from('tender_lots').select('id, numero_lot, libelle, statut').eq('tender_id', id).order('numero_lot'),
    supabase.from('appeals').select('id, status, date_depot, lot_id').eq('tender_id', id),
  ])
  const myBids = bids.data ?? []
  const pendingScopes = new Set((mine.data ?? []).filter(a => ['DEPOSE', 'EN_INSTRUCTION'].includes(a.status)).map(a => a.lot_id ?? 'ALL'))
  const lotNo = (lotId: string | null) => (lotId ? `lot ${(lots.data ?? []).find(l => l.id === lotId)?.numero_lot ?? '?'}` : 'marché entier')

  const open = t.current_phase === 'PHASE_10_RECOURS' && !!t.date_fin_recours && new Date(t.date_fin_recours) > new Date()
  const admissible = myBids.some(b => !NOT_ADMISSIBLE.includes(b.status))
  // Lots contestables : attribués, avec une offre recevable de ma part sur ce lot (je n'en suis pas l'attributaire), sans recours déjà en cours.
  const contestable = t.is_alloti
    ? (lots.data ?? []).filter(l => l.statut === 'ATTRIBUE' && myBids.some(b => b.lot_id === l.id && !NOT_ADMISSIBLE.includes(b.status)) && !pendingScopes.has(l.id))
    : []
  const wholeMarket = admissible && !pendingScopes.has('ALL')
  const options = t.is_alloti
    ? [...contestable.map(l => ({ value: l.id, label: `Lot ${l.numero_lot} — ${l.libelle}` })), ...(wholeMarket ? [{ value: 'ALL', label: 'Marché entier (tous les lots)' }] : [])]
    : []
  const canFile = open && (t.is_alloti ? options.length > 0 : admissible && !pendingScopes.has('ALL'))

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title={`Recours — ${t.reference}`} subtitle={t.title} />
      <Alert tone={open ? 'amber' : 'red'} title={open ? `Délai de recours jusqu'au ${dateFr(t.date_fin_recours, true)}` : 'Aucun délai de recours ouvert'}>
        {open ? 'Le dépôt d\'un recours suspend la procédure : l\'attribution définitive est bloquée jusqu\'à la décision de l\'ARCOP.' : 'Le délai est échu ou la procédure n\'est pas au stade de l\'attribution provisoire.'}
      </Alert>
      {t.is_alloti && open && (
        <Alert tone="blue">Marché alloti : vous pouvez contester un lot précis (sur lequel vous avez déposé une offre recevable). Une décision favorable ne rouvre que ce lot ; les autres lots gardent leur attribution.</Alert>
      )}
      {(mine.data ?? []).length > 0 && (
        <Alert tone="blue">Vos recours sur ce marché : {mine.data!.map(m => `${lotNo(m.lot_id)} (${m.status})`).join(', ')}. <Link className="underline" href="/dashboard/recours">Suivre</Link></Alert>
      )}
      {canFile && (
        <Card title="Déposer un recours">
          <ActionForm action={submitAppeal} submitLabel="Déposer le recours" confirm="Déposer ce recours ? Il sera transmis à l'ARCOP et à l'autorité contractante.">
            <input type="hidden" name="tender_id" value={id} />
            {t.is_alloti && <Field label="Périmètre du recours" name="lot_id" required options={options} hint="Un recours par lot et par candidat à la fois." />}
            <Field label="Motif" name="motif" required hint="Exposé synthétique des griefs (10 caractères min.)" />
            <Field label="Développement" name="description" rows={8} />
          </ActionForm>
        </Card>
      )}
      {open && !canFile && !admissible && <Alert tone="red">Seul un candidat ayant déposé une offre recevable, et qui n&apos;est pas l&apos;attributaire provisoire, peut former un recours.</Alert>}
      {open && !canFile && admissible && <Alert tone="amber">Aucun recours supplémentaire n&apos;est possible pour vous : soit vous avez déjà un recours en cours sur chaque lot concerné, soit vous êtes l&apos;attributaire provisoire des lots où vous êtes candidat.</Alert>}
    </div>
  )
}
