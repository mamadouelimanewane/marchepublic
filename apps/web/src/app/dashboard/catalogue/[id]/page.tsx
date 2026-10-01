import { notFound } from 'next/navigation'
import { requireSession } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { dateFr, fcfa } from '@/lib/format'
import { Alert, Badge, Card, DataTable, Field, Grid, PageHeader, Stat } from '@/components/ui'
import { ActionButton, ActionForm } from '@/components/ActionForm'
import { addCatalogItem, placeCallOff, progressCallOff, revisePrice, setItemActive } from '../../actions/catalogue'

export const dynamic = 'force-dynamic'

const UNITES = ['UNITE', 'KG', 'TONNE', 'LITRE', 'M2', 'M3', 'ML', 'HEURE', 'JOUR', 'FORFAIT', 'LOT']
const STATUT_TONE = { COMMANDE: 'amber', LIVRE: 'blue', RECEPTIONNE: 'green', ANNULE: 'gray' } as const

export default async function AccordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await requireSession('/dashboard/catalogue')
  const supabase = await createSupabaseServerClient()
  const { data: a } = await supabase.from('framework_agreements').select('*, institutions(name)').eq('id', id).single()
  if (!a) notFound()

  const [items, orders, defs, corps] = await Promise.all([
    supabase.from('catalog_items').select('id, supplier_id, code_article, designation, unite, prix_unitaire, delai_livraison_jours, attributs, actif, corps_metiers(libelle)').eq('agreement_id', id).order('code_article'),
    supabase.from('call_off_orders').select('id, supplier_id, institution_id, quantite, prix_unitaire, montant, statut, created_at, catalog_items(code_article, designation)').eq('agreement_id', id).order('created_at', { ascending: false }),
    supabase.from('catalog_attribute_defs').select('cle, libelle, type, options, obligatoire, corps_metier_id'),
    supabase.from('corps_metiers').select('id, libelle').order('libelle'),
  ])
  const canOrder = ['SERVICE_DEMANDEUR', 'CPM', 'PRM'].includes(session.role)
  const isBuyerStaff = ['CPM', 'PRM'].includes(session.role)
  const solde = Number(a.plafond_montant) - Number(a.montant_commande)
  const defLabel = new Map((defs.data ?? []).map(d => [d.cle, d.libelle]))

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title={a.titre} subtitle={`${a.reference} — ${(a as any).institutions?.name} — du ${dateFr(a.date_debut)} au ${dateFr(a.date_fin)}`} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Plafond de l'accord" value={fcfa(a.plafond_montant)} />
        <Stat label="Commandé" value={fcfa(a.montant_commande)} tone="amber" />
        <Stat label="Solde disponible" value={fcfa(solde)} tone={solde > 0 ? 'green' : 'red'} />
      </div>
      {a.statut !== 'ACTIF' && <Alert tone="amber">Accord {a.statut.toLowerCase()} : plus de commande ni de modification du catalogue.</Alert>}

      <Card title="Catalogue" padded={false}>
        <DataTable rows={items.data} rowKey={i => i.id} empty="Le titulaire n'a pas encore publié d'article."
          columns={[
            { header: 'Article', cell: i => <div><div className="font-medium">{i.code_article} — {i.designation}</div><div className="text-xs text-gray-500">{(i as any).corps_metiers?.libelle}</div></div> },
            { header: 'Attributs', cell: i => <ul className="text-xs text-gray-600">{Object.entries(i.attributs as Record<string, unknown>).map(([k, v]) => <li key={k}>{defLabel.get(k) ?? k} : <strong>{v === true ? 'oui' : v === false ? 'non' : String(v)}</strong></li>)}</ul> },
            { header: 'Prix', cell: i => <div className="whitespace-nowrap font-semibold">{fcfa(i.prix_unitaire)} <span className="text-xs font-normal text-gray-500">/ {i.unite.toLowerCase()}</span><div className="text-xs font-normal text-gray-500">livraison {i.delai_livraison_jours} j</div></div> },
            {
              header: 'Action', cell: i => i.supplier_id === session.id ? (
                <div className="space-y-2">
                  <ActionForm action={revisePrice.bind(null, i.id)} submitLabel="Réviser" variant="secondary" reset={false} className="flex items-end gap-2 space-y-0">
                    <Field label="Nouveau prix" name="prix_unitaire" type="number" min={1} required defaultValue={i.prix_unitaire} />
                  </ActionForm>
                  <ActionButton action={setItemActive.bind(null, i.id, !i.actif)} label={i.actif ? 'Retirer' : 'Remettre'} variant="secondary" />
                </div>
              ) : canOrder && i.actif && a.statut === 'ACTIF' ? (
                <ActionForm action={placeCallOff.bind(null, i.id)} submitLabel="Commander" className="flex items-end gap-2 space-y-0" confirm="Passer cette commande au prix du catalogue ?">
                  <Field label="Quantité" name="quantite" type="number" min={0.01} step="0.01" required />
                </ActionForm>
              ) : !i.actif ? <Badge>Retiré</Badge> : null,
            },
          ]} />
      </Card>

      {session.role === 'SOUMISSIONNAIRE' && a.statut === 'ACTIF' && (
        <Card title="Ajouter un article" subtitle="Remplissez les attributs de la catégorie choisie ; les autres champs sont ignorés.">
          <ActionForm action={addCatalogItem.bind(null, id)} submitLabel="Publier l'article">
            <Grid cols={3}>
              <Field label="Catégorie" name="corps_metier_id" required options={(corps.data ?? []).map(c => ({ value: c.id, label: c.libelle }))} />
              <Field label="Code article" name="code_article" required />
              <Field label="Désignation" name="designation" required />
              <Field label="Unité" name="unite" required options={UNITES.map(u => ({ value: u, label: u.toLowerCase() }))} />
              <Field label="Prix unitaire (FCFA)" name="prix_unitaire" type="number" min={1} required />
              <Field label="Délai de livraison (jours)" name="delai_livraison_jours" type="number" min={0} max={365} required defaultValue={7} />
            </Grid>
            <fieldset className="rounded-lg border border-gray-200 p-3">
              <legend className="px-1 text-sm font-medium text-gray-700">Attributs standardisés</legend>
              <Grid cols={3}>
                {(defs.data ?? []).map(d => {
                  const cat = d.corps_metier_id ? ` (${(corps.data ?? []).find(c => c.id === d.corps_metier_id)?.libelle ?? ''})` : ' (toutes catégories)'
                  const options = d.type === 'CHOIX' ? (d.options as string[]).map(o => ({ value: o, label: o })) : d.type === 'BOOLEEN' ? [{ value: 'true', label: 'Oui' }, { value: 'false', label: 'Non' }] : undefined
                  return <Field key={d.cle + (d.corps_metier_id ?? '')} label={`${d.libelle}${d.obligatoire ? ' *' : ''}`} name={`attr_${d.cle}`} type={d.type === 'NOMBRE' ? 'number' : 'text'} options={options} hint={cat} />
                })}
              </Grid>
            </fieldset>
          </ActionForm>
        </Card>
      )}

      <Card title="Commandes" padded={false}>
        <DataTable rows={orders.data} rowKey={o => o.id} empty="Aucune commande."
          columns={[
            { header: 'Date', cell: o => dateFr(o.created_at) },
            { header: 'Article', cell: (o: any) => `${o.catalog_items?.code_article} — ${o.catalog_items?.designation}` },
            { header: 'Quantité', cell: o => `${o.quantite} × ${fcfa(o.prix_unitaire)}` },
            { header: 'Montant', cell: o => <strong>{fcfa(o.montant)}</strong> },
            { header: 'Statut', cell: o => <Badge tone={STATUT_TONE[o.statut as keyof typeof STATUT_TONE]}>{o.statut}</Badge> },
            {
              header: 'Action', cell: o => (
                <div className="flex flex-wrap gap-2">
                  {o.supplier_id === session.id && o.statut === 'COMMANDE' && <ActionButton action={progressCallOff.bind(null, o.id, 'LIVRER')} label="Déclarer livré" confirm="Confirmer la livraison ?" />}
                  {isBuyerStaff && o.institution_id === session.institution_id && o.statut === 'LIVRE' && <ActionButton action={progressCallOff.bind(null, o.id, 'RECEPTIONNER')} label="Réceptionner" confirm="Confirmer la réception conforme ?" />}
                  {isBuyerStaff && o.institution_id === session.institution_id && o.statut === 'COMMANDE' && (
                    <ActionForm action={progressCallOff.bind(null, o.id, 'ANNULER')} submitLabel="Annuler" variant="secondary" className="flex items-end gap-2 space-y-0" confirm="Annuler cette commande ?">
                      <Field label="Motif" name="motif" required placeholder="10 caractères min." />
                    </ActionForm>
                  )}
                </div>
              ),
            },
          ]} />
      </Card>
    </div>
  )
}
