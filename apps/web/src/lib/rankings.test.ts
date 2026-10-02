import { describe, expect, it } from 'vitest'
import { latestPerLot } from './rankings'

describe('latestPerLot', () => {
  const r = (lot: string | null, round: number, bid: string) => ({ lot_id: lot, round, bid_id: bid })
  it('garde, pour chaque lot, la ronde la plus récente', () => {
    const rows = [r('L1', 1, 'a'), r('L1', 1, 'b'), r('L2', 1, 'c'), r('L1', 2, 'd'), r('L1', 2, 'e'), r('L3', 1, 'f')]
    expect(latestPerLot(rows).map(x => x.bid_id).sort()).toEqual(['c', 'd', 'e', 'f'])
  })
  it('marché non alloti : la dernière ronde seulement', () => {
    expect(latestPerLot([r(null, 1, 'a'), r(null, 2, 'b'), r(null, 3, 'c'), r(null, 3, 'd')]).map(x => x.bid_id)).toEqual(['c', 'd'])
  })
  it('un lot réévalué deux fois ne montre que sa ronde 3, les autres restent en ronde 1', () => {
    const rows = [r('L1', 1, 'a'), r('L2', 1, 'b'), r('L1', 2, 'c'), r('L1', 3, 'd')]
    expect(latestPerLot(rows).map(x => x.bid_id).sort()).toEqual(['b', 'd'])
  })
  it('liste vide', () => { expect(latestPerLot([])).toEqual([]) })
})
