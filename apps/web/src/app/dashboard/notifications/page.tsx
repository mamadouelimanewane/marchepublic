import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { dateFr } from '@/lib/format'
import { Badge, Card, PageHeader } from '@/components/ui'
import { ActionButton } from '@/components/ActionForm'
import { markNotificationsRead } from '../actions/admin'

export const dynamic = 'force-dynamic'

export default async function NotificationsPage() {
  await requireSession()
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.from('notifications').select('id, titre, message, kind, tender_id, created_at, read_at').order('created_at', { ascending: false }).limit(100)

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Notifications" actions={<ActionButton action={markNotificationsRead} label="Tout marquer comme lu" variant="secondary" />} />
      <Card padded={false}>
        <ul className="divide-y divide-gray-100">
          {data?.length ? data.map(n => (
            <li key={n.id} className="flex items-start justify-between gap-3 px-5 py-3">
              <div>
                <p className={n.read_at ? 'text-sm text-gray-600' : 'text-sm font-semibold text-gray-900'}>{n.titre}</p>
                {n.message && <p className="text-xs text-gray-500">{n.message}</p>}
                <p className="text-xs text-gray-400">{dateFr(n.created_at, true)}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                {!n.read_at && <Badge tone="amber">Nouveau</Badge>}
                {n.tender_id && <Link className="text-xs text-green-700 hover:underline" href={`/dashboard/marches/${n.tender_id}`}>Voir le marché</Link>}
              </div>
            </li>
          )) : <li className="px-5 py-8 text-center text-sm text-gray-500">Aucune notification.</li>}
        </ul>
      </Card>
    </div>
  )
}
