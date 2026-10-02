/** Après un recours sur un lot, seul ce lot est réévalué dans une nouvelle ronde : les autres gardent le classement de leur dernière
 *  ronde. Pour afficher « le classement en vigueur », on retient donc, pour chaque lot (ou le marché entier si lot_id est nul), la ronde la plus récente. */
export function latestPerLot<T extends { lot_id?: string | null; round: number }>(rows: T[]): T[] {
  const max = new Map<string, number>()
  for (const r of rows) {
    const k = r.lot_id ?? ''
    if (r.round > (max.get(k) ?? -Infinity)) max.set(k, r.round)
  }
  return rows.filter(r => r.round === max.get(r.lot_id ?? ''))
}
