import { ROLE_LABELS, type Role } from '@marchepublic/workflow'
import { requireRole } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { dateFr } from '@/lib/format'
import { Alert, Badge, Card, DataTable, Field, Grid, PageHeader } from '@/components/ui'
import { ActionButton, ActionForm } from '@/components/ActionForm'
import { createInstitution, createStaffUser, setSupplierStatus, setUserActive, toggleCorpsMetier, updateConfig } from '../actions/admin'

export const dynamic = 'force-dynamic'

const STAFF_ROLES: Role[] = ['SERVICE_DEMANDEUR', 'CPM', 'PRM', 'EVALUATEUR', 'TRESOR', 'DCMP', 'ARCOP', 'COUR_COMPTES', 'BAILLEUR', 'ADMIN']

export default async function AdminPage() {
  await requireRole(['ADMIN'])
  const supabase = await createSupabaseServerClient()
  const [config, institutions, users, corps] = await Promise.all([
    supabase.from('config_seuils').select('cle, valeur, description, modifie_le').order('cle'),
    supabase.from('institutions').select('id, code, name, type, is_active').order('name'),
    supabase.from('users').select('id, full_name, email, role, institution_id, is_active, is_pme, is_pme_feminine, is_ess, ninea, ninea_verified_at, institutions(name)').order('created_at', { ascending: false }).limit(200),
    supabase.from('corps_metiers').select('id, code, libelle, is_active').order('libelle'),
  ])
  const suppliers = (users.data ?? []).filter(u => u.role === 'SOUMISSIONNAIRE')
  const staff = (users.data ?? []).filter(u => u.role !== 'SOUMISSIONNAIRE')

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="Administration de la plateforme" subtitle="Paramétrage réglementaire sans redéploiement, institutions, comptes et nomenclature. Toute modification est tracée dans le journal d'audit." />

      <Card title="Paramètres réglementaires" subtitle="Seuils de passation, plafonds, délais, pondérations d'évaluation. Les arrêtés pouvant les réviser, ils ne sont jamais codés en dur." padded={false}>
        <DataTable rows={config.data} rowKey={c => c.cle} columns={[
          { header: 'Paramètre', cell: c => <code className="text-xs">{c.cle}</code> },
          { header: 'Description', cell: c => <span className="text-xs text-gray-600">{c.description}</span> },
          { header: 'Valeur', cell: c => (
            <ActionForm action={updateConfig} submitLabel="Modifier" variant="secondary" reset={false} className="flex items-center gap-2 space-y-0">
              <input type="hidden" name="cle" value={c.cle} />
              <input name="valeur" defaultValue={c.valeur} required aria-label={`Valeur de ${c.cle}`} className="w-32 rounded border border-gray-300 px-2 py-1 text-sm" />
            </ActionForm>) },
          { header: 'Modifié', cell: c => <span className="text-xs text-gray-400">{dateFr(c.modifie_le)}</span> },
        ]} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Institutions" padded={false}>
          <DataTable rows={institutions.data} rowKey={i => i.id} columns={[{ header: 'Code', cell: i => i.code }, { header: 'Nom', cell: i => i.name }, { header: 'Type', cell: i => i.type }]} />
          <div className="border-t border-gray-100 p-5">
            <ActionForm action={createInstitution} submitLabel="Créer l'institution">
              <Grid cols={3}><Field label="Code" name="code" required placeholder="MEFP" /><Field label="Nom" name="name" required />
                <Field label="Type" name="type" required options={[{ value: 'ETAT', label: 'État' }, { value: 'COLLECTIVITE', label: 'Collectivité territoriale' }, { value: 'ETABLISSEMENT_PUBLIC', label: 'Établissement public' }, { value: 'SOCIETE_PUBLIQUE', label: 'Société publique' }, { value: 'AGENCE', label: 'Agence' }]} /></Grid>
            </ActionForm>
          </div>
        </Card>
        <Card title="Nomenclature des corps de métier" padded={false}>
          <DataTable rows={corps.data} rowKey={c => c.id} columns={[
            { header: 'Libellé', cell: c => c.libelle },
            { header: 'Actif', cell: c => <ActionButton variant="secondary" label={c.is_active ? 'Désactiver' : 'Activer'} action={toggleCorpsMetier.bind(null, c.id, !c.is_active)} /> },
          ]} />
        </Card>
      </div>

      <Card title="Comptes institutionnels" subtitle="Création par invitation e-mail : aucun mot de passe n'est communiqué. Le rôle et l'institution sont attribués ici uniquement." padded={false}>
        <DataTable rows={staff} rowKey={u => u.id} columns={[
          { header: 'Nom', cell: u => <span>{u.full_name}<br /><span className="text-xs text-gray-400">{u.email}</span></span> },
          { header: 'Rôle', cell: u => <Badge tone="blue">{ROLE_LABELS[u.role as Role] ?? u.role}</Badge> },
          { header: 'Institution', cell: u => (u.institutions as unknown as { name: string } | null)?.name ?? '—' },
          { header: 'Statut', cell: u => <ActionButton variant="secondary" label={u.is_active ? 'Désactiver' : 'Réactiver'} action={setUserActive.bind(null, u.id, !u.is_active)} confirm={u.is_active ? 'Désactiver ce compte ?' : undefined} /> },
        ]} />
        <div className="border-t border-gray-100 p-5">
          <ActionForm action={createStaffUser} submitLabel="Inviter l'utilisateur">
            <Grid cols={2}>
              <Field label="E-mail" name="email" type="email" required /><Field label="Nom complet" name="full_name" required />
              <Field label="Rôle" name="role" required options={STAFF_ROLES.map(r => ({ value: r, label: ROLE_LABELS[r] }))} />
              <Field label="Institution" name="institution_id" options={(institutions.data ?? []).map(i => ({ value: i.id, label: i.name }))} hint="Requise sauf pour DCMP, ARCOP, Cour des Comptes et bailleurs" />
            </Grid>
          </ActionForm>
        </div>
      </Card>

      <Card title="Soumissionnaires — certification PME / ESS" subtitle="Ces statuts alimentent les quotas légaux (5 % dont 2 % PME féminines) et l'éligibilité aux marchés réservés." padded={false}>
        {suppliers.length === 0 ? <Alert tone="blue">Aucun soumissionnaire inscrit.</Alert> : (
          <DataTable rows={suppliers} rowKey={u => u.id} columns={[
            { header: 'Entreprise', cell: u => <span>{u.full_name}<br /><span className="text-xs text-gray-400">{u.email} · NINEA {u.ninea ?? '—'}</span></span> },
            { header: 'Statuts', cell: u => (
              <ActionForm action={setSupplierStatus.bind(null, u.id)} submitLabel="Enregistrer" variant="secondary" reset={false} className="flex flex-wrap items-center gap-3 space-y-0 text-xs">
                <label className="flex items-center gap-1"><input type="checkbox" name="is_pme" defaultChecked={u.is_pme} /> PME</label>
                <label className="flex items-center gap-1"><input type="checkbox" name="is_pme_feminine" defaultChecked={u.is_pme_feminine} /> Direction féminine</label>
                <label className="flex items-center gap-1"><input type="checkbox" name="is_ess" defaultChecked={u.is_ess} /> ESS</label>
                <label className="flex items-center gap-1"><input type="checkbox" name="ninea_verified" defaultChecked={!!u.ninea_verified_at} /> NINEA vérifié</label>
              </ActionForm>) },
          ]} />
        )}
      </Card>
    </div>
  )
}
