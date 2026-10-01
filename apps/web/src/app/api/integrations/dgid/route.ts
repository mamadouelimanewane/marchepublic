import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'

// Vérification de régularité fiscale et légale (DGID + RCCM) — CDC §12.
//
// ⚠ SIMULATION : aucune API gouvernementale n'est encore branchée. En production, l'endpoint répond 501 pour qu'aucune
// « conformité » fictive ne soit prise pour une vérification réelle. Le branchement réel exigera les accès DGID/RCCM.
export async function GET(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  if (process.env.NODE_ENV === 'production' && process.env.DGID_SIMULATION !== 'true') {
    return NextResponse.json({ error: 'Intégration DGID non configurée' }, { status: 501 })
  }

  const ninea = new URL(request.url).searchParams.get('ninea')
  if (!ninea || !/^[0-9A-Z]{7,12}$/i.test(ninea)) return NextResponse.json({ error: 'NINEA manquant ou invalide' }, { status: 400 })

  if (ninea === '1234567') {
    return NextResponse.json({ simulation: true, status: 'CONFORME', ninea, quitus_fiscal_valide: true, rccm_status: 'ACTIF' })
  }
  return NextResponse.json({ simulation: true, status: 'NON_CONFORME', ninea, quitus_fiscal_valide: false }, { status: 403 })
}
