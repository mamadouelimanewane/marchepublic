import { requireSession } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { dateFr } from '@/lib/format'
import { Badge, Card, DataTable, PageHeader } from '@/components/ui'
import { AuditVerify } from '@/components/AuditVerify'

export const dynamic = 'force-dynamic'

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ action?: string; entity?: string; page?: string }> }) {
  const session = await requireSession('/dashboard/audit')
  const f = await searchParams
  const page = Math.max(1, Number(f.page) || 1)
  const pageSize = 50
  const supabase = await createSupabaseServerClient()

  let q = supabase.from('audit_logs')
    .select('id, occurred_at, action, entity_type, entity_id, user_name, user_role, institution_id, row_hash', { count: 'exact' })
    .order('seq', { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1)
  if (f.action) q = q.ilike('action', `%${f.action.replace(/[%,()]/g, ' ').trim()}%`)
  if (f.entity) q = q.eq('entity_type', f.entity)
  const [{ data, count }, institutions] = await Promise.all([
    q,
    ['DCMP', 'ARCOP', 'COUR_COMPTES', 'ADMIN'].includes(session.role)
      ? supabase.from('institutions').select('id, name').order('name')
      : Promise.resolve({ data: session.institution ? [{ id: session.institution.id, name: session.institution.name }] : [] }),
  ])
  const canVerify = ['DCMP', 'ARCOP', 'COUR_COMPTES', 'ADMIN'].includes(session.role)
  const pages = Math.ceil((count ?? 0) / pageSize)

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeader title="Journal d'audit" subtitle="Toutes les actions sensibles : qui, quoi, quand. Écriture seule (WORM) et chaînage cryptographique : toute altération est détectable."
        actions={<a className="text-sm font-medium text-green-700 hover:underline" href="/api/audit/export">Exporter (CSV)</a>} />
      {canVerify && <Card><AuditVerify institutionId={session.institution?.id ?? null} institutions={institutions.data ?? []} /></Card>}
      <form className="flex flex-wrap gap-3" role="search">
        <input name="action" defaultValue={f.action} placeholder="Action (ex. PHASE_TRANSITION)" className="w-64 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        <select name="entity" defaultValue={f.entity ?? ''} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
          <option value="">Toutes entités</option>
          {['tender', 'bids', 'appeals', 'contracts', 'contract_amendments', 'subcontractors', 'tender_documents', 'dcmp_reviews', 'users', 'config_seuils'].map(e => <option key={e} value={e}>{e}</option>)}
        </select>
        <button className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium hover:bg-gray-50">Filtrer</button>
      </form>
      <Card padded={false}>
        <DataTable rows={data} rowKey={r => r.id} empty="Aucune entrée."
          columns={[
            { header: 'Horodatage', cell: r => dateFr(r.occurred_at, true), className: 'whitespace-nowrap' },
            { header: 'Action', cell: r => <Badge tone={/SEUIL|LATE|OVERRIDE|BLOCK/.test(r.action) ? 'red' : /PHASE/.test(r.action) ? 'blue' : 'gray'}>{r.action}</Badge> },
            { header: 'Entité', cell: r => <span className="text-xs">{r.entity_type}<br /><code className="text-gray-400">{r.entity_id?.slice(0, 8)}</code></span> },
            { header: 'Utilisateur', cell: r => r.user_name ? `${r.user_name} (${r.user_role})` : 'Système' },
            { header: 'Empreinte', cell: r => <code className="text-xs text-gray-400">{r.row_hash?.slice(0, 10)}</code> },
          ]} />
      </Card>
      {pages > 1 && <p className="text-center text-sm text-gray-500">Page {page} / {pages} — {count} entrées</p>}
    </div>
  )
}
