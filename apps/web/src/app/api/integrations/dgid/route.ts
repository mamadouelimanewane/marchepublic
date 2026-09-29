import { NextResponse } from 'next/server'

// MOCK API: Vérification Fiscale et Légale (DGID + RCCM)
// Dans la réalité, cela se connecte aux API gouvernementales via le NINEA
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const ninea = searchParams.get('ninea')

  if (!ninea) {
    return NextResponse.json({ error: 'NINEA manquant' }, { status: 400 })
  }

  // Simulation d'une latence réseau
  await new Promise(r => setTimeout(r, 1200))

  // Test avec NINEA fictif
  if (ninea === '123456789') {
    return NextResponse.json({
      status: 'CONFORME',
      ninea: '123456789',
      entreprise: 'SENEGAL TECH SOLUTIONS SUARL',
      quitus_fiscal_valide: true,
      quitus_date_expiration: '2027-01-01',
      rccm_status: 'ACTIF',
      rccm_numero: 'SN-DKR-2023-B-1234',
      is_pme_certifiee: true,
      is_direction_feminine: false,
    })
  } else {
    // Cas de non-conformité
    return NextResponse.json({
      status: 'NON_CONFORME',
      ninea: ninea,
      quitus_fiscal_valide: false,
      motif: "Dette fiscale non soldée de 1.500.000 FCFA"
    }, { status: 403 })
  }
}
