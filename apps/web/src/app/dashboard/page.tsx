import Link from 'next/link'
import { PHASES, PHASE_LABELS, ROLE_LABELS, phaseNumber, type TenderPhase } from '@marchepublic/workflow'
import { requireSession } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { dateFr, fcfa } from '@/lib/format'
import { Alert, Badge, Card, DataTable, PageHeader, Stat } from '@/components/ui'
import { WorkflowBadge } from '@/components/workflow/WorkflowBadge'

export const dynamic = 'force-dynamic'

export default async function DashboardHome() {
  const session = await requireSession('/dashboard')
  const supabase = await createSupabaseServerClient()
  const role = session.role

  const [pipeline, recent, notifications, alertes, recours, dcmp, besoins] = await Promise.all([
    supabase.from('v_pipeline_phases').select('current_phase, nb_marches, montant_estime_total'),
    supabase.from('tenders').select('id, reference, title, current_phase, montant_estime, date_limite_depot').order('updated_at', { ascending: false }).limit(6),
    supabase.from('notifications').select('id, titre, message, created_at, read_at, tender_id').order('created_at', { ascending: false }).limit(5),
    supabase.from('v_alertes').select('tender_id, reference, type_alerte, message').limit(6),
    supabase.from('appeals').select('id', { count: 'exact', head: true }).in('status', ['DEPOSE', 'EN_INSTRUCTION']),
    supabase.from('v_dcmp_en_attente').select('tender_id, reference, title, institution, jours_attente').order('jours_attente', { ascending: false }).limit(5),
    supabase.from('besoins').select('id', { count: 'exact', head: true }).eq('statut', 'SOUMIS'),
  ])

  // Agrégation par phase (plusieurs lignes par institution pour les régulateurs)
  const byPhase = new Map<TenderPhase, number>()
  for (const row of pipeline.data ?? []) byPhase.set(row.current_phase as TenderPhase, (byPhase.get(row.current_phase as TenderPhase) ?? 0) + row.nb_marches)
  const total = [...byPhase.values()].reduce((a, b) => a + b, 0)
  const enCours = total - (byPhase.get('PHASE_15_CLOTURE_ARCHIVAGE') ?? 0)
  const max = Math.max(1, ...byPhase.values())
  const isBidder = role === 'SOUMISSIONNAIRE'

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title={`Bonjour ${session.full_name.split(' ')[0]}`} subtitle={`${ROLE_LABELS[role]}${session.institution ? ` — ${session.institution.name}` : ''}`} />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        {isBidder ? (
          <>
            <Stat label="Avis ouverts" value={(byPhase.get('PHASE_5_CLARIFICATIONS') ?? 0) + (byPhase.get('PHASE_6_DEPOT_OFFRES') ?? 0)} />
            <Stat label="Mes marchés suivis" value={total} />
            <Stat label="Notifications non lues" value={(notifications.data ?? []).filter(n => !n.read_at).length} tone="amber" />
          </>
        ) : (
          <>
            <Stat label="Marchés en cours" value={enCours} />
            <Stat label="Recours en cours" value={recours.count ?? 0} tone={recours.count ? 'red' : 'gray'} hint={recours.count ? 'Attribution définitive bloquée' : undefined} />
            {role === 'PRM' && <Stat label="Besoins à valider" value={besoins.count ?? 0} tone={besoins.count ? 'amber' : 'gray'} />}
            {role === 'DCMP' && <Stat label="Avis en attente" value={dcmp.data?.length ?? 0} tone="amber" />}
            <Stat label="Alertes" value={alertes.data?.length ?? 0} tone={alertes.data?.length ? 'amber' : 'gray'} />
          </>
        )}
      </div>

      {(role === 'DCMP') && (
        <Card title="Dossiers en attente d'avis" className="mb-6" padded={false}>
          <DataTable rows={dcmp.data} rowKey={r => r.tender_id} empty="Aucun dossier en attente."
            columns={[
              { header: 'Référence', cell: r => <Link className="font-medium text-green-800 hover:underline" href={`/dashboard/dcmp/${r.tender_id}`}>{r.reference}</Link> },
              { header: 'Objet', cell: r => r.title },
              { header: 'Autorité contractante', cell: r => r.institution },
              { header: 'Attente', cell: r => <Badge tone={Number(r.jours_attente) > 7 ? 'red' : 'amber'}>{r.jours_attente} j</Badge> },
            ]} />
        </Card>
      )}

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card title="Répartition par phase" subtitle="Nombre de marchés à chaque étape du cycle de vie">
          <ul className="space-y-1.5">
            {PHASES.map(p => (
              <li key={p} className="flex items-center gap-2 text-xs">
                <span className="w-44 flex-shrink-0 truncate text-gray-600">{PHASE_LABELS[p]}</span>
                <span className="h-4 flex-1 rounded bg-gray-100">
                  <span className="block h-4 rounded bg-green-600" style={{ width: `${((byPhase.get(p) ?? 0) / max) * 100}%` }} />
                </span>
                <span className="w-6 text-right font-semibold text-gray-700">{byPhase.get(p) ?? 0}</span>
              </li>
            ))}
          </ul>
        </Card>

        <div className="space-y-6">
          <Card title="Notifications" padded={false}>
            <ul className="divide-y divide-gray-100">
              {(notifications.data ?? []).length ? notifications.data!.map(n => (
                <li key={n.id} className="px-5 py-3 text-sm">
                  <p className={n.read_at ? 'text-gray-600' : 'font-semibold text-gray-900'}>{n.titre}</p>
                  {n.message && <p className="text-xs text-gray-500">{n.message}</p>}
                  <p className="text-xs text-gray-400">{dateFr(n.created_at, true)}</p>
                </li>
              )) : <li className="px-5 py-6 text-center text-sm text-gray-500">Aucune notification.</li>}
            </ul>
          </Card>
          {!isBidder && (
            <Card title="Alertes" padded={false}>
              {(alertes.data ?? []).length ? (
                <ul className="divide-y divide-gray-100">
                  {alertes.data!.map((a, i) => (
                    <li key={i} className="px-5 py-3 text-sm">
                      <Link href={`/dashboard/marches/${a.tender_id}`} className="font-medium text-green-800 hover:underline">{a.reference}</Link>
                      <p className="text-xs text-gray-600">{a.message}</p>
                    </li>
                  ))}
                </ul>
              ) : <p className="px-5 py-6 text-center text-sm text-gray-500">Aucune alerte.</p>}
            </Card>
          )}
        </div>
      </div>

      <Card title="Dossiers récemment modifiés" actions={<Link href="/dashboard/marches" className="text-sm font-medium text-green-700 hover:underline">Tous les marchés →</Link>} padded={false}>
        <DataTable rows={recent.data} rowKey={r => r.id} empty={<Alert>Aucun marché visible pour votre profil.</Alert>}
          columns={[
            { header: 'Référence', cell: r => <Link className="font-medium text-green-800 hover:underline" href={`/dashboard/marches/${r.id}`}>{r.reference}</Link> },
            { header: 'Objet', cell: r => <span className="line-clamp-1">{r.title}</span> },
            { header: 'Montant estimé', cell: r => fcfa(r.montant_estime), className: 'whitespace-nowrap' },
            { header: 'Phase', cell: r => <WorkflowBadge phase={r.current_phase as TenderPhase} /> },
          ]} />
      </Card>
      <p className="mt-2 text-right text-xs text-gray-400">{PHASES.length} phases — {phaseNumber('PHASE_15_CLOTURE_ARCHIVAGE')} étapes réglementaires</p>
    </div>
  )
}
