import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireSession } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { dateFr, fcfa } from '@/lib/format'
import { Alert, Badge, Card, DataTable, PageHeader } from '@/components/ui'

export const dynamic = 'force-dynamic'

const TONE = { CONFORME: 'green', NON_CONFORME: 'red', SOUMISE: 'amber' } as const

/** Lecture des offres de la séance d'ouverture PUBLIQUE : réservée aux candidats ayant déposé une offre dans les délais et au personnel
 *  habilité. En séance restreinte, la vue ne renvoie rien : aucune information n'est communiquée avant l'attribution. */
export default async function LectureOffresPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await requireSession('/dashboard/lecture-offres')
  const supabase = await createSupabaseServerClient()
  const [{ data: t }, { data: opening }, { data: rows }, { data: presents }] = await Promise.all([
    supabase.from('tenders').select('id, reference, title').eq('id', id).maybeSingle(),
    supabase.from('bid_openings').select('opened_at, seance_publique').eq('tender_id', id).maybeSingle(),
    supabase.from('v_lecture_ouverture').select('numero_lot, candidat, montant_lu, statut, motif, recu_le').eq('tender_id', id).order('numero_lot', { nullsFirst: true }).order('recu_le'),
    supabase.from('opening_attendance').select('nom, qualite, organisme').eq('tender_id', id).order('created_at'),
  ])
  if (!t) notFound()
  const list = rows ?? []

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title={`Lecture des offres — ${t.reference}`} subtitle={t.title} actions={<Link href="/dashboard/mes-offres" className="text-sm text-green-700 hover:underline">← Mes offres</Link>} />
      {!opening && <Alert tone="amber">L&apos;ouverture des plis n&apos;a pas encore eu lieu.</Alert>}
      {opening && !opening.seance_publique && (
        <Alert tone="blue" title="Séance restreinte">Pour cette procédure, la séance d&apos;ouverture est restreinte : la lecture des offres n&apos;est pas communiquée aux candidats. Les résultats seront publiés à l&apos;attribution provisoire.</Alert>
      )}
      {opening?.seance_publique && (
        <>
          <Alert tone="green" title={`Séance publique du ${dateFr(opening.opened_at, true)}`}>
            Offres reçues dans les délais. Les montants sont ceux relevés à l&apos;ouverture ; le classement n&apos;est pas encore établi.
          </Alert>
          <Card title="Offres lues" padded={false}>
            <DataTable rows={list} rowKey={r => `${r.candidat}-${r.numero_lot ?? 0}-${r.recu_le}`} empty="Aucune offre à afficher (vous devez avoir déposé une offre dans les délais)."
              columns={[
                { header: 'Lot', cell: r => (r.numero_lot ? `Lot ${r.numero_lot}` : '—') },
                { header: 'Candidat', cell: r => <strong>{r.candidat}</strong> },
                { header: 'Reçue le', cell: r => dateFr(r.recu_le, true) },
                { header: 'Montant lu', cell: r => (r.montant_lu === null ? <span className="text-gray-400">à relever</span> : fcfa(r.montant_lu)), className: 'whitespace-nowrap' },
                { header: 'Conformité administrative', cell: r => <span><Badge tone={TONE[r.statut as keyof typeof TONE] ?? 'gray'}>{r.statut}</Badge>{r.motif ? <span className="ml-2 text-xs text-gray-500">{r.motif}</span> : null}</span> },
              ]} />
          </Card>
          {(presents ?? []).length > 0 && (
            <Card title="Registre de présence">
              <ul className="list-disc pl-5 text-sm">{presents!.map((p, i) => <li key={i}>{p.nom} — {p.qualite.toLowerCase()}{p.organisme ? ` (${p.organisme})` : ''}</li>)}</ul>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
