import { seuilAoo, type NatureMarche, type TypeInstitution } from '@marchepublic/workflow'
import { ActionForm } from '@/components/ActionForm'
import { Field, Grid } from '@/components/ui'
import { fcfa } from '@/lib/format'
import type { ActionResult } from '@/lib/errors'

const NATURES = [
  { value: 'TRAVAUX', label: 'Travaux' },
  { value: 'FOURNITURES', label: 'Fournitures' },
  { value: 'SERVICES_COURANTS', label: 'Services courants' },
  { value: 'PRESTATIONS_INTELLECTUELLES', label: 'Prestations intellectuelles' },
  { value: 'DSP', label: 'Délégation de service public' },
  { value: 'PPP', label: 'Partenariat public-privé' },
]
const MODES = [
  { value: 'AOO', label: 'Appel d\'offres ouvert' }, { value: 'AOR', label: 'Appel d\'offres restreint' },
  { value: 'AOO_2ETAPES', label: 'Appel d\'offres en deux étapes' }, { value: 'CONCOURS', label: 'Concours' },
  { value: 'DRP', label: 'Demande de renseignements et de prix' }, { value: 'ENTENTE_DIRECTE', label: 'Entente directe (dérogation)' },
  { value: 'ACCORD_CADRE', label: 'Accord-cadre / marché à commandes' },
]

export interface TenderFormValues {
  title?: string; description?: string | null; nature_marche?: string; montant_estime?: number | null; corps_metier_id?: string | null
  ligne_budgetaire?: string | null; ppm_annee?: number | null; ppm_trimestre?: number | null; mode_passation?: string | null
  justification_mode?: string | null; is_reserve_pme?: boolean; is_reserve_pme_feminine?: boolean; is_cofinance?: boolean; is_alloti?: boolean
}

function Check({ name, label, defaultChecked }: { name: string; label: string; defaultChecked?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm text-gray-700">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="h-4 w-4 rounded border-gray-300 text-green-700" /> {label}
    </label>
  )
}

export function TenderForm({ action, corps, values = {}, institutionType, submitLabel, redirectPattern }: {
  action: (fd: FormData) => Promise<ActionResult>
  corps: { id: string; libelle: string }[]
  values?: TenderFormValues
  institutionType: TypeInstitution
  submitLabel: string
  redirectPattern?: string
}) {
  const nature = (values.nature_marche ?? 'FOURNITURES') as NatureMarche
  const seuil = seuilAoo(institutionType, nature)
  return (
    <ActionForm action={action} submitLabel={submitLabel} reset={false} redirectPattern={redirectPattern}>
      <Grid cols={2}>
        <Field className="md:col-span-2" label="Objet du marché" name="title" required defaultValue={values.title} hint="10 caractères minimum" />
        <Field className="md:col-span-2" label="Description" name="description" rows={3} defaultValue={values.description} />
        <Field label="Nature" name="nature_marche" required defaultValue={nature} options={NATURES} />
        <Field label="Corps de métier" name="corps_metier_id" required defaultValue={values.corps_metier_id} options={corps.map(c => ({ value: c.id, label: c.libelle }))} />
        <Field label="Montant estimé (FCFA)" name="montant_estime" type="number" min={0} required defaultValue={values.montant_estime}
               hint={`Seuil de l'appel d'offres ouvert pour cette nature : ${fcfa(seuil)} (paramétrable par l'administrateur). Le mode est calculé automatiquement.`} />
        <Field label="Ligne budgétaire" name="ligne_budgetaire" defaultValue={values.ligne_budgetaire} />
        <Field label="Année du PPM" name="ppm_annee" type="number" min={2024} max={2050} required defaultValue={values.ppm_annee ?? new Date().getFullYear()} />
        <Field label="Trimestre prévu" name="ppm_trimestre" type="number" min={1} max={4} required defaultValue={values.ppm_trimestre ?? 1} />
        <Field label="Mode de passation" name="mode_passation" defaultValue={values.mode_passation} options={MODES}
               hint="Laisser vide pour le mode réglementaire. Tout autre choix doit être justifié." />
        <Field label="Justification du mode" name="justification_mode" rows={2} defaultValue={values.justification_mode} hint="Obligatoire si le mode diffère du mode réglementaire, et pour l'entente directe (20 caractères min.)" />
      </Grid>
      <div className="flex flex-wrap gap-6">
        <Check name="is_reserve_pme" label="Marché réservé aux PME / ESS" defaultChecked={values.is_reserve_pme} />
        <Check name="is_reserve_pme_feminine" label="Réservé aux PME à direction féminine" defaultChecked={values.is_reserve_pme_feminine} />
        <Check name="is_cofinance" label="Marché cofinancé (non-objection du bailleur)" defaultChecked={values.is_cofinance} />
        <Check name="is_alloti" label="Marché alloti (plusieurs lots)" defaultChecked={values.is_alloti} />
      </div>
    </ActionForm>
  )
}
