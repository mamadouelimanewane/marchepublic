import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PLAFOND_AVENANTS, PLAFOND_SOUS_TRAITANCE, phaseNumber, missingPreconditions } from '@marchepublic/workflow'
import { requireSession } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { loadFacts } from '@/lib/tender-facts'
import { TENDER_COLUMNS, type ContractRow, type TenderRow } from '@/lib/types'
import { dateFr, fcfa, pct } from '@/lib/format'
import { Alert, Badge, Card, DataTable, DefinitionList, Field, Grid, PageHeader } from '@/components/ui'
import { ActionButton, ActionForm } from '@/components/ActionForm'
import { WorkflowBadge } from '@/components/workflow/WorkflowBadge'
import { advancePhase } from '../../actions/marches'
import {
  addAmendment, addGuarantee, addIncident, addProgress, addServiceOrder, addSubcontractor, prepareContract, signContract, visaContract,
} from '../../actions/execution'

export const dynamic = 'force-dynamic'

export default async function ExecutionTenderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ contrat?: string }> }) {
  const { id } = await params
  const { contrat } = await searchParams
  const session = await requireSession('/dashboard/execution')
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.from('tenders').select(TENDER_COLUMNS).eq('id', id).maybeSingle()
  if (!data) notFound()
  const t = data as unknown as TenderRow
  const n = phaseNumber(t.current_phase)
  const facts = await loadFacts(supabase, t)

  const { data: allContracts } = await supabase.from('contracts').select('*, lots:lot_id(numero_lot, libelle)').eq('tender_id', id).order('created_at')
  const c = (allContracts ?? []).find(x => x.id === contrat) ?? (allContracts ?? [])[0] ?? null
  const { data: awardedLots } = t.is_alloti ? await supabase.from('tender_lots').select('id, numero_lot, libelle, montant_attribue').eq('tender_id', id).eq('statut', 'ATTRIBUE').order('numero_lot') : { data: null }
  const lotsWithoutContract = (awardedLots ?? []).filter(l => !(allContracts ?? []).some(x => x.lot_id === l.id))
  const contract = c as (ContractRow & { signature_ac_at: string | null; signature_titulaire_at: string | null; visa_at: string | null }) | null
  const cid = contract?.id
  const [guarantees, orders, incidents, progress, amendments, subs] = cid ? await Promise.all([
    supabase.from('guarantees').select('id, type, montant, emetteur, reference, date_expiration, statut').eq('contract_id', cid).order('date_emission'),
    supabase.from('service_orders').select('id, numero, type, objet, date_effet').eq('contract_id', cid).order('numero'),
    supabase.from('execution_incidents').select('id, date_incident, gravite, description, penalites_montant, statut').eq('contract_id', cid).order('date_incident', { ascending: false }),
    supabase.from('progress_reports').select('id, date_rapport, taux_avancement, commentaire').eq('contract_id', cid).order('date_rapport', { ascending: false }),
    supabase.from('contract_amendments').select('id, numero_avenant, motif, montant_avenant, pourcentage, cumul_apres').eq('contract_id', cid).order('numero_avenant'),
    supabase.from('subcontractors').select('id, nom_sous_traitant, objet, montant, pourcentage').eq('contract_id', cid),
  ]) : [null, null, null, null, null, null]

  const isPrm = session.role === 'PRM'
  const isStaff = isPrm || session.role === 'CPM'
  const isHolder = !!contract && contract.attributaire_id === session.id
  const initial = Number(contract?.montant_initial ?? 0)
  const avenantPositif = (amendments?.data ?? []).reduce((s, a) => s + Math.max(Number(a.montant_avenant), 0), 0)
  const subTotal = (subs?.data ?? []).reduce((s, x) => s + Number(x.montant), 0)
  const signMissing = missingPreconditions('SIGNER_CONTRAT', facts)
  const execOpen = t.current_phase === 'PHASE_13_EXECUTION'
  const Meter = ({ label, value, cap }: { label: string; value: number; cap: number }) => {
    const ratio = initial ? value / initial : 0
    return (
      <div>
        <div className="mb-1 flex justify-between text-sm"><span>{label}</span><strong className={ratio > cap * 0.8 ? 'text-red-700' : ''}>{pct(ratio * 100)} / {cap * 100} %</strong></div>
        <div className="h-2.5 rounded-full bg-gray-200"><div className={`h-2.5 rounded-full ${ratio > cap * 0.8 ? 'bg-red-600' : 'bg-green-600'}`} style={{ width: `${Math.min(100, (ratio / cap) * 100)}%` }} /></div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title={`Contrat — ${t.reference}`} subtitle={t.title}
        actions={<><WorkflowBadge phase={t.current_phase} /><Link href={`/dashboard/marches/${id}`} className="text-sm text-green-700 hover:underline">Fiche du marché →</Link></>} />
      {t.has_appeal_pending && <Alert tone="red" title="🔒 Recours pendant">La signature du contrat est bloquée par la base tant que l'ARCOP n'a pas statué.</Alert>}

      {t.is_alloti && (
        <Card title="Contrats par lot" subtitle="Un contrat par lot attribué : signatures, garanties, avenants et paiements sont propres à chaque contrat.">
          <div className="flex flex-wrap gap-2">
            {(allContracts ?? []).map(x => (
              <Link key={x.id} href={`/dashboard/execution/${id}?contrat=${x.id}`}
                className={`rounded-lg border px-3 py-1.5 text-sm ${x.id === contract?.id ? 'border-green-700 bg-green-50 font-semibold' : 'border-gray-300 hover:bg-gray-50'}`}>
                Lot {(x as { lots?: { numero_lot: number } }).lots?.numero_lot} — {fcfa(x.montant_initial)}
              </Link>
            ))}
          </div>
          {n === 12 && isStaff && lotsWithoutContract.length > 0 && (
            <div className="mt-4 space-y-3 border-t border-gray-100 pt-4">
              {lotsWithoutContract.map(l => (
                <ActionForm key={l.id} action={prepareContract.bind(null, id)} submitLabel={`Préparer le contrat du lot ${l.numero_lot}`} className="flex flex-wrap items-end gap-3 space-y-0">
                  <input type="hidden" name="lot_id" value={l.id} />
                  <Field label={`Lot ${l.numero_lot} — début`} name="date_debut" type="date" /><Field label="Délai (jours)" name="delai_jours" type="number" min={1} />
                </ActionForm>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ----- Contrat / signatures ----- */}
      <Card title="Contrat">
        {contract && <p className="mb-3"><a href={`/api/pdf/contrat/${contract.id}`} target="_blank" rel="noreferrer" className="text-sm font-medium text-green-700 hover:underline">Télécharger le contrat (PDF)</a></p>}
        {!contract ? (
          n === 12 && isStaff && !t.is_alloti ? (
            <ActionForm action={prepareContract.bind(null, id)} submitLabel="Préparer le contrat">
              <Grid cols={2}><Field label="Date de début d'exécution" name="date_debut" type="date" /><Field label="Délai d'exécution (jours)" name="delai_jours" type="number" min={1} /></Grid>
            </ActionForm>
          ) : <p className="text-sm text-gray-500">Le contrat n'a pas encore été préparé.</p>
        ) : (
          <div className="space-y-4">
            <DefinitionList items={[
              { label: 'Montant initial', value: fcfa(contract.montant_initial) }, { label: 'Montant actuel (après avenants)', value: fcfa(contract.montant_actuel) },
              { label: 'Début d\'exécution', value: dateFr(contract.date_debut_execution) }, { label: 'Délai', value: contract.delai_execution ? `${contract.delai_execution} jours` : '—' },
              { label: 'Signature autorité contractante', value: contract.signed_by_ac ? <Badge tone="green">Signé {dateFr(contract.signature_ac_at, true)}</Badge> : <Badge tone="amber">En attente</Badge> },
              { label: 'Signature titulaire', value: contract.signed_by_titulaire ? <Badge tone="green">Signé {dateFr(contract.signature_titulaire_at, true)}</Badge> : <Badge tone="amber">En attente</Badge> },
              { label: 'Visa du contrôle financier', value: contract.visa_controleur ? <Badge tone="green">Visé {dateFr(contract.visa_at, true)}</Badge> : <Badge tone="amber">En attente</Badge> },
            ]} />
            {n === 12 && (
              <div className="flex flex-wrap gap-2">
                {isHolder && !contract.signed_by_titulaire && <ActionButton label="Signer en tant que titulaire" action={signContract.bind(null, contract.id)} confirm="Signer le contrat ?" />}
                {isPrm && !contract.signed_by_ac && <ActionButton label="Signer (autorité contractante)" action={signContract.bind(null, contract.id)} confirm="Signer le contrat au nom de l'autorité contractante ?" />}
                {session.role === 'TRESOR' && contract.signed_by_ac && !contract.visa_controleur && <ActionButton label="Apposer le visa du contrôle financier" action={visaContract.bind(null, contract.id)} />}
              </div>
            )}
            {n === 12 && isPrm && (
              <div className="space-y-1 border-t border-gray-100 pt-3">
                {signMissing.length > 0 && <ul className="list-disc pl-5 text-xs text-amber-800">{signMissing.map(m => <li key={m}>{m}</li>)}</ul>}
                <ActionButton label="Lancer l'exécution" action={advancePhase.bind(null, id, 'SIGNER_CONTRAT', {})} disabled={signMissing.length > 0} />
              </div>
            )}
          </div>
        )}
      </Card>

      {contract && (
        <>
          {/* ----- Garanties ----- */}
          <Card title="Garanties" padded={false}>
            <DataTable rows={guarantees?.data} rowKey={g => g.id} empty="Aucune garantie enregistrée."
              columns={[
                { header: 'Type', cell: g => g.type }, { header: 'Montant', cell: g => fcfa(g.montant) }, { header: 'Émetteur', cell: g => `${g.emetteur} (${g.reference})` },
                { header: 'Expiration', cell: g => dateFr(g.date_expiration) }, { header: 'Statut', cell: g => <Badge tone={g.statut === 'VALIDE' ? 'green' : 'gray'}>{g.statut}</Badge> },
              ]} />
            {isStaff && n >= 11 && n <= 14 && (
              <div className="border-t border-gray-100 p-5">
                <ActionForm action={addGuarantee} submitLabel="Enregistrer la garantie">
                  <input type="hidden" name="tender_id" value={id} /><input type="hidden" name="contract_id" value={contract.id} />
                  <Grid cols={3}>
                    <Field label="Type" name="type" required options={[{ value: 'BONNE_EXECUTION', label: 'Bonne exécution' }, { value: 'AVANCE_DEMARRAGE', label: 'Avance de démarrage' }, { value: 'RETENUE_GARANTIE', label: 'Retenue de garantie' }, { value: 'SOUMISSION', label: 'Soumission' }]} />
                    <Field label="Montant (FCFA)" name="montant" type="number" min={1} required /><Field label="Émetteur (banque)" name="emetteur" required />
                    <Field label="Référence" name="reference" required /><Field label="Émission" name="date_emission" type="date" required /><Field label="Expiration" name="date_expiration" type="date" required />
                  </Grid>
                </ActionForm>
              </div>
            )}
          </Card>

          {n >= 13 && (
            <>
              {/* ----- Plafonds ----- */}
              <Card title="Plafonds légaux" subtitle="Contrôlés par la base de données : un dépassement est refusé et tracé.">
                <div className="grid gap-5 md:grid-cols-2">
                  <Meter label="Avenants (augmentations cumulées)" value={avenantPositif} cap={PLAFOND_AVENANTS} />
                  <Meter label="Sous-traitance déclarée" value={subTotal} cap={PLAFOND_SOUS_TRAITANCE} />
                </div>
              </Card>

              <Card title="Avenants" padded={false}>
                <DataTable rows={amendments?.data} rowKey={a => a.id} empty="Aucun avenant."
                  columns={[{ header: 'N°', cell: a => a.numero_avenant }, { header: 'Motif', cell: a => a.motif }, { header: 'Montant', cell: a => fcfa(a.montant_avenant) }, { header: 'Cumul', cell: a => pct(a.pourcentage) }]} />
                {isPrm && execOpen && (
                  <div className="border-t border-gray-100 p-5">
                    <ActionForm action={addAmendment} submitLabel="Enregistrer l'avenant" confirm="Enregistrer cet avenant ? L'opération est irréversible.">
                      <input type="hidden" name="contract_id" value={contract.id} />
                      <Grid cols={3}><Field label="N° d'avenant" name="numero_avenant" type="number" min={1} required defaultValue={(amendments?.data?.length ?? 0) + 1} />
                        <Field label="Montant (FCFA, négatif = moins-value)" name="montant_avenant" type="number" required /><Field label="Motif" name="motif" required /></Grid>
                    </ActionForm>
                  </div>
                )}
              </Card>

              <Card title="Sous-traitance" padded={false}>
                <DataTable rows={subs?.data} rowKey={s => s.id} empty="Aucun sous-traitant déclaré."
                  columns={[{ header: 'Sous-traitant', cell: s => s.nom_sous_traitant }, { header: 'Objet', cell: s => s.objet }, { header: 'Montant', cell: s => fcfa(s.montant) }, { header: 'Part', cell: s => pct(s.pourcentage) }]} />
                {isStaff && execOpen && (
                  <div className="border-t border-gray-100 p-5">
                    <ActionForm action={addSubcontractor} submitLabel="Déclarer le sous-traitant">
                      <input type="hidden" name="contract_id" value={contract.id} />
                      <Grid cols={2}><Field label="Sous-traitant" name="nom_sous_traitant" required /><Field label="NINEA" name="ninea" /><Field label="Objet" name="objet" required /><Field label="Montant (FCFA)" name="montant" type="number" min={1} required /></Grid>
                    </ActionForm>
                  </div>
                )}
              </Card>

              <Card title="Ordres de service et avancement" padded={false}>
                <DataTable rows={orders?.data} rowKey={o => o.id} empty="Aucun ordre de service."
                  columns={[{ header: 'N°', cell: o => o.numero }, { header: 'Type', cell: o => o.type }, { header: 'Objet', cell: o => o.objet }, { header: 'Effet', cell: o => dateFr(o.date_effet) }]} />
                <DataTable rows={progress?.data} rowKey={p => p.id} empty="Aucun rapport d'avancement."
                  columns={[{ header: 'Date', cell: p => dateFr(p.date_rapport) }, { header: 'Avancement', cell: p => `${p.taux_avancement} %` }, { header: 'Commentaire', cell: p => p.commentaire ?? '—' }]} />
                {isStaff && execOpen && (
                  <div className="grid gap-6 border-t border-gray-100 p-5 lg:grid-cols-2">
                    <ActionForm action={addServiceOrder} submitLabel="Émettre l'ordre de service">
                      <input type="hidden" name="contract_id" value={contract.id} />
                      <Grid cols={2}><Field label="N°" name="numero" type="number" min={1} required defaultValue={(orders?.data?.length ?? 0) + 1} />
                        <Field label="Type" name="type" required options={[{ value: 'DEMARRAGE', label: 'Démarrage' }, { value: 'ARRET', label: 'Arrêt' }, { value: 'REPRISE', label: 'Reprise' }, { value: 'MODIFICATION', label: 'Modification' }, { value: 'AUTRE', label: 'Autre' }]} />
                        <Field label="Objet" name="objet" required /><Field label="Date d'effet" name="date_effet" type="date" required /></Grid>
                    </ActionForm>
                    <ActionForm action={addProgress} submitLabel="Enregistrer l'avancement">
                      <input type="hidden" name="contract_id" value={contract.id} />
                      <Grid cols={2}><Field label="Taux d'avancement (%)" name="taux_avancement" type="number" min={0} max={100} required /><Field label="Commentaire" name="commentaire" /></Grid>
                    </ActionForm>
                  </div>
                )}
              </Card>

              <Card title="Incidents d'exécution" padded={false}>
                <DataTable rows={incidents?.data} rowKey={i => i.id} empty="Aucun incident."
                  columns={[{ header: 'Date', cell: i => dateFr(i.date_incident) }, { header: 'Gravité', cell: i => <Badge tone={i.gravite === 'CRITIQUE' ? 'red' : i.gravite === 'MAJEURE' ? 'amber' : 'gray'}>{i.gravite}</Badge> }, { header: 'Description', cell: i => i.description }, { header: 'Pénalités', cell: i => fcfa(i.penalites_montant) }]} />
                {isStaff && execOpen && (
                  <div className="border-t border-gray-100 p-5">
                    <ActionForm action={addIncident} submitLabel="Consigner l'incident">
                      <input type="hidden" name="contract_id" value={contract.id} />
                      <Grid cols={3}><Field label="Gravité" name="gravite" required options={[{ value: 'MINEURE', label: 'Mineure' }, { value: 'MAJEURE', label: 'Majeure' }, { value: 'CRITIQUE', label: 'Critique' }]} />
                        <Field label="Pénalités (FCFA)" name="penalites_montant" type="number" min={0} defaultValue={0} /><Field label="Description" name="description" required /></Grid>
                    </ActionForm>
                  </div>
                )}
              </Card>
            </>
          )}
          {n >= 13 && <p><Link href={`/dashboard/reception/${id}`} className="text-sm font-medium text-green-700 hover:underline">Réception et paiements →</Link></p>}
        </>
      )}
    </div>
  )
}
