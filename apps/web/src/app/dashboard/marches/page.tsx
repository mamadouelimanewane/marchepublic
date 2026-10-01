import Link from 'next/link'
import { PHASES, PHASE_LABELS, type TenderPhase } from '@marchepublic/workflow'
import { requireSession } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { dateFr, fcfa } from '@/lib/format'
import { Badge, Card, DataTable, PageHeader } from '@/components/ui'
import { WorkflowBadge } from '@/components/workflow/WorkflowBadge'

export const dynamic = 'force-dynamic'

export default async function MarchesPage({ searchParams }: { searchParams: Promise<{ phase?: string; q?: string; mode?: string }> }) {
  const session = await requireSession('/dashboard/marches')
  const f = await searchParams
  const supabase = await createSupabaseServerClient()

  let query = supabase.from('tenders')
    .select('id, reference, title, current_phase, mode_passation, montant_estime, date_limite_depot, has_appeal_pending, institutions(name)')
    .order('created_at', { ascending: false }).limit(200)
  if (f.phase && (PHASES as readonly string[]).includes(f.phase)) query = query.eq('current_phase', f.phase)
  if (f.mode) query = query.eq('mode_passation', f.mode)
  if (f.q) {
    const safe = f.q.replace(/[(),.%]/g, ' ').trim()
    if (safe) query = query.or(`title.ilike.%${safe}%,reference.ilike.%${safe}%`)
  }
  const { data: tenders } = await query
  const canCreate = session.role === 'PRM' || session.role === 'CPM'

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Marchés" subtitle="Tous les marchés visibles avec vos droits. Les offres restent invisibles jusqu'à l'ouverture des plis."
        actions={canCreate ? <Link href="/dashboard/marches/nouveau" className="rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800">+ Nouveau marché</Link> : undefined} />

      <form className="mb-4 flex flex-wrap gap-3" role="search">
        <input name="q" defaultValue={f.q} placeholder="Référence ou objet…" className="w-64 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        <select name="phase" defaultValue={f.phase ?? ''} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
          <option value="">Toutes les phases</option>
          {PHASES.map(p => <option key={p} value={p}>{PHASE_LABELS[p]}</option>)}
        </select>
        <select name="mode" defaultValue={f.mode ?? ''} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
          <option value="">Tous les modes</option>
          {['AOO', 'AOR', 'AOO_2ETAPES', 'CONCOURS', 'DRP', 'ENTENTE_DIRECTE', 'ACCORD_CADRE'].map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <button className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium hover:bg-gray-50">Filtrer</button>
      </form>

      <Card padded={false}>
        <DataTable rows={tenders as never[]} rowKey={(r: { id: string }) => r.id} empty="Aucun marché ne correspond à ces critères."
          columns={[
            { header: 'Référence', cell: (r: any) => <Link className="font-medium text-green-800 hover:underline" href={`/dashboard/marches/${r.id}`}>{r.reference}</Link>, className: 'whitespace-nowrap' },
            { header: 'Objet', cell: (r: any) => <span className="line-clamp-2">{r.title}</span> },
            { header: 'Autorité', cell: (r: any) => r.institutions?.name ?? '—' },
            { header: 'Mode', cell: (r: any) => r.mode_passation ?? '—' },
            { header: 'Montant estimé', cell: (r: any) => fcfa(r.montant_estime), className: 'whitespace-nowrap' },
            { header: 'Limite dépôt', cell: (r: any) => dateFr(r.date_limite_depot), className: 'whitespace-nowrap' },
            { header: 'Phase', cell: (r: any) => (
              <span className="flex flex-col items-start gap-1">
                <WorkflowBadge phase={r.current_phase as TenderPhase} />
                {r.has_appeal_pending && <Badge tone="red">Recours pendant</Badge>}
              </span>
            ) },
          ]} />
      </Card>
    </div>
  )
}
