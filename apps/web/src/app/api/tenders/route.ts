import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { tenderSchema } from '@marchepublic/validators'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    // Le middleware a injecté ces headers
    const institutionId = req.headers.get('x-institution-id')
    const userRole = req.headers.get('x-user-role')

    if (!institutionId || !['PRM', 'CPM', 'SERVICE_DEMANDEUR'].includes(userRole ?? '')) {
      return NextResponse.json({ error: 'Droits insuffisants' }, { status: 403 })
    }

    const body = await req.json()
    
    // Validation Zod
    const validatedData = tenderSchema.parse(body)

    // Détermination automatique du mode de passation
    // Note: Dans une vraie implémentation, on chercherait l'institution pour avoir ses seuils exacts
    const mode = determinerModePassation(validatedData.montant_estime, validatedData.nature_marche)

    // Insertion du marché
    const { data, error } = await supabase
      .from('tenders')
      .insert({
        institution_id: institutionId,
        reference: `AO-${new Date().getFullYear()}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`,
        title: validatedData.title,
        description: validatedData.description,
        nature_marche: validatedData.nature_marche,
        montant_estime: validatedData.montant_estime,
        corps_metier_id: validatedData.corps_metier_id,
        mode_passation: mode,
        current_phase: 'PHASE_1_PROGRAMMATION',
        ppm_annee: validatedData.ppm_annee,
        ppm_trimestre: validatedData.ppm_trimestre,
        is_reserve_pme: validatedData.is_reserve_pme,
        is_reserve_pme_feminine: validatedData.is_reserve_pme_feminine,
        created_by: user.id
      })
      .select()
      .single()

    if (error) {
      console.error(error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ data }, { status: 201 })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erreur serveur' }, { status: 400 })
  }
}

// Logique simplifiée de détermination du mode de passation
function determinerModePassation(montant: number, nature: string) {
  // Seuils par défaut (État)
  const seuil_travaux = 70000000
  const seuil_autres = 50000000
  
  const seuil = nature === 'TRAVAUX' ? seuil_travaux : seuil_autres
  
  if (montant >= seuil) return 'AOO'
  if (montant >= seuil * 0.5) return 'AOR'
  return 'DRP'
}
