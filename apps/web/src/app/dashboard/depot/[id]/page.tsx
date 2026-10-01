import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireSession } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { dateFr, fcfa } from '@/lib/format'
import { Alert, Badge, Card, DefinitionList, PageHeader } from '@/components/ui'
import { ActionButton } from '@/components/ActionForm'
import DepotOffreComponent from '@/components/forms/DepotOffreComponent'
import { withdrawBid } from '../../actions/passation'

export const dynamic = 'force-dynamic'

export default async function DepotTenderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await requireSession('/dashboard/depot')
  const supabase = await createSupabaseServerClient()
  const { data: t } = await supabase.from('tenders')
    .select('id, reference, title, current_phase, date_limite_depot, bid_public_key, bid_key_fingerprint, is_reserve_pme, is_reserve_pme_feminine, is_alloti').eq('id', id).maybeSingle()
  if (!t) notFound()
  const [bidsRes, lotsRes] = await Promise.all([
    supabase.from('bids').select('id, lot_id, status, submitted_at, timestamp_token').eq('tender_id', id),
    t.is_alloti ? supabase.from('tender_lots').select('id, numero_lot, libelle, montant_estime').eq('tender_id', id).order('numero_lot') : Promise.resolve({ data: null }),
  ])
  const bids = bidsRes.data ?? []
  const open = t.current_phase === 'PHASE_6_DEPOT_OFFRES' && !!t.date_limite_depot && new Date(t.date_limite_depot) > new Date()
  const ineligible = (t.is_reserve_pme && !(session.is_pme || session.is_ess)) || (t.is_reserve_pme_feminine && !session.is_pme_feminine)
  const canDeposit = open && !ineligible && !!t.bid_public_key
  // Un « espace de dépôt » par lot (ou un seul pour un marché non alloti).
  const slots = t.is_alloti ? (lotsRes.data ?? []).map(l => ({ lotId: l.id as string | undefined, label: `Lot ${l.numero_lot} — ${l.libelle}`, hint: fcfa(l.montant_estime) })) : [{ lotId: undefined, label: '', hint: '' }]

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title={`Dépôt — ${t.reference}`} subtitle={t.title} />
      {ineligible && <Alert tone="red" title="Marché réservé">Ce marché est réservé à une catégorie d'entreprises (PME / ESS / PME féminines) dont votre profil n'est pas certifié. Contactez l'administrateur si votre statut n'est pas à jour.</Alert>}
      {!canDeposit && !ineligible && <Alert tone="amber">Le dépôt n'est pas ouvert pour ce marché (ou la date limite est dépassée).</Alert>}
      {t.is_alloti && <Alert tone="blue">Marché alloti : vous pouvez soumissionner à un ou plusieurs lots. Chaque lot fait l'objet d'un dépôt distinct et chiffré.</Alert>}

      {slots.map(slot => {
        const bid = bids.find(b => (b.lot_id ?? undefined) === slot.lotId)
        return (
          <section key={slot.lotId ?? 'unique'} className="space-y-4">
            {t.is_alloti && <h2 className="text-lg font-semibold text-gray-800">{slot.label} <span className="text-sm font-normal text-gray-500">(estimation {slot.hint})</span></h2>}
            {bid && (
              <Card title="Mon offre">
                <DefinitionList items={[
                  { label: 'Statut', value: <Badge tone={bid.status === 'SOUMISE' ? 'green' : bid.status === 'RETARDEE' ? 'red' : 'gray'}>{bid.status}</Badge> },
                  { label: 'Reçue le', value: dateFr(bid.submitted_at, true) },
                  { label: 'Accusé (empreinte)', value: <code className="break-all text-xs">{bid.timestamp_token ?? '—'}</code> },
                ]} />
                {bid.status === 'SOUMISE' && open && <div className="mt-4"><ActionButton variant="danger" label="Retirer mon offre" action={withdrawBid.bind(null, bid.id)} confirm="Retirer votre offre ? Vous pourrez la redéposer avant la date limite." /></div>}
              </Card>
            )}
            {canDeposit && <DepotOffreComponent tenderId={t.id} lotId={slot.lotId} lotLabel={slot.label || undefined} publicKey={t.bid_public_key!} keyFingerprint={t.bid_key_fingerprint} dateLimite={dateFr(t.date_limite_depot, true)} />}
          </section>
        )
      })}
      <p><Link href="/dashboard/depot" className="text-sm text-green-700 hover:underline">← Retour</Link></p>
    </div>
  )
}
