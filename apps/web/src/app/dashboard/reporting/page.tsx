import { PHASES, PHASE_LABELS, type TenderPhase } from '@marchepublic/workflow'
import { requireSession } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { fcfa, pct } from '@/lib/format'
import { Badge, Card, DataTable, PageHeader, Stat } from '@/components/ui'
import { DelaysChart, PhaseBarChart, SectorPie } from '@/components/ReportCharts'

export const dynamic = 'force-dynamic'

export default async function ReportingPage() {
  const session = await requireSession('/dashboard/reporting')
  const supabase = await createSupabaseServerClient()

  const [pipeline, delais, quotas, secteurs, recours, dcmp] = await Promise.all([
    supabase.from('v_pipeline_phases').select('current_phase, nb_marches'),
    supabase.from('v_delais_moyens_phase').select('phase, nb_passages, jours_moyens, jours_max'),
    supabase.from('v_quotas_pme').select('*').order('annee_fiscale', { ascending: false }),
    supabase.from('v_stats_sectorielles').select('corps_metier, mode_passation, nb_marches, montant_estime, montant_attribue'),
    supabase.from('v_stats_recours').select('institution, nb_recours, nb_en_cours, nb_favorables, nb_marches_attribues, taux_litiges_pct').order('nb_recours', { ascending: false }),
    supabase.from('v_dcmp_en_attente').select('tender_id', { count: 'exact', head: true }),
  ])

  const byPhase = new Map<string, number>()
  for (const r of pipeline.data ?? []) byPhase.set(r.current_phase, (byPhase.get(r.current_phase) ?? 0) + r.nb_marches)
  const phaseData = PHASES.map(p => ({ label: PHASE_LABELS[p as TenderPhase].replace(/^\d+\. /, ''), value: byPhase.get(p) ?? 0 }))

  const d = new Map<string, { sum: number; n: number; max: number }>()
  for (const r of delais.data ?? []) {
    const cur = d.get(r.phase) ?? { sum: 0, n: 0, max: 0 }
    cur.sum += Number(r.jours_moyens) * r.nb_passages; cur.n += r.nb_passages; cur.max = Math.max(cur.max, Number(r.jours_max))
    d.set(r.phase, cur)
  }
  const delaysData = PHASES.filter(p => d.has(p)).map(p => ({ label: PHASE_LABELS[p as TenderPhase].replace(/^\d+\. /, ''), moyen: Math.round((d.get(p)!.sum / d.get(p)!.n) * 10) / 10, max: d.get(p)!.max }))

  const sector = new Map<string, number>()
  const mode = new Map<string, { n: number; m: number }>()
  for (const r of secteurs.data ?? []) {
    sector.set(r.corps_metier, (sector.get(r.corps_metier) ?? 0) + Number(r.montant_estime))
    const k = r.mode_passation ?? 'Non défini'; const cur = mode.get(k) ?? { n: 0, m: 0 }
    cur.n += r.nb_marches; cur.m += Number(r.montant_estime); mode.set(k, cur)
  }
  const total = [...byPhase.values()].reduce((a, b) => a + b, 0)
  const isRegulator = ['DCMP', 'ARCOP', 'COUR_COMPTES', 'ADMIN'].includes(session.role)

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="Reporting et statistiques" subtitle="Pilotage de la commande publique : dossiers, délais par phase, quotas légaux PME, statistiques sectorielles et contentieux."
        actions={<a className="text-sm font-medium text-green-700 hover:underline" href="/api/reporting/export?vue=v_stats_sectorielles">Exporter les statistiques (CSV)</a>} />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Marchés" value={total} />
        <Stat label="Dossiers en attente DCMP" value={dcmp.count ?? 0} tone="amber" />
        <Stat label="Recours en cours" value={(recours.data ?? []).reduce((s, r) => s + r.nb_en_cours, 0)} tone="red" />
        <Stat label="Montant estimé total" value={fcfa([...sector.values()].reduce((a, b) => a + b, 0))} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Marchés par phase"><PhaseBarChart data={phaseData} /></Card>
        <Card title="Délais moyens par phase" subtitle="Identifie les goulots d'étranglement de la procédure.">
          {delaysData.length ? <DelaysChart data={delaysData} /> : <p className="py-10 text-center text-sm text-gray-500">Pas encore de transitions enregistrées.</p>}
        </Card>
      </div>

      <Card title="Quotas légaux PME / économie sociale et solidaire" subtitle="Objectif : 5 % de la valeur annuelle des marchés, dont 2 % pour les PME à direction féminine." padded={false}>
        <DataTable rows={quotas.data} rowKey={q => `${q.institution_id}-${q.annee_fiscale}`} empty="Aucun marché attribué définitivement."
          columns={[
            ...(isRegulator ? [{ header: 'Autorité', cell: (q: any) => q.institution }] : []),
            { header: 'Année', cell: (q: any) => q.annee_fiscale }, { header: 'Total attribué', cell: (q: any) => fcfa(q.montant_total_marches), className: 'whitespace-nowrap' },
            { header: 'PME / ESS', cell: (q: any) => <span>{pct(q.taux_pme)} <Badge tone={q.objectif_pme_atteint ? 'green' : 'red'}>{q.objectif_pme_atteint ? 'objectif atteint' : `objectif ${q.objectif_pme} %`}</Badge></span> },
            { header: 'PME féminines', cell: (q: any) => <span>{pct(q.taux_pme_feminine)} <Badge tone={q.objectif_feminin_atteint ? 'green' : 'red'}>{q.objectif_feminin_atteint ? 'objectif atteint' : `objectif ${q.objectif_feminin} %`}</Badge></span> },
          ]} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Montants par corps de métier"><SectorPie data={[...sector.entries()].map(([name, value]) => ({ name, value }))} /></Card>
        <Card title="Par mode de passation" padded={false}>
          <DataTable rows={[...mode.entries()]} rowKey={([k]) => k} empty="Aucune donnée."
            columns={[{ header: 'Mode', cell: ([k]) => k }, { header: 'Marchés', cell: ([, v]) => v.n }, { header: 'Montant estimé', cell: ([, v]) => fcfa(v.m) }]} />
        </Card>
      </div>

      {isRegulator && (
        <Card title="Contentieux par autorité contractante" padded={false}>
          <DataTable rows={recours.data} rowKey={r => r.institution} empty="Aucun recours."
            columns={[
              { header: 'Autorité', cell: r => r.institution }, { header: 'Marchés attribués', cell: r => r.nb_marches_attribues }, { header: 'Recours', cell: r => r.nb_recours },
              { header: 'En cours', cell: r => r.nb_en_cours }, { header: 'Favorables', cell: r => r.nb_favorables }, { header: 'Taux de litiges', cell: r => pct(r.taux_litiges_pct) },
            ]} />
        </Card>
      )}
    </div>
  )
}
