import { describe, expect, it } from 'vitest'
import { renderBattleStats } from '../src/ui/BattleStatsView'
import type { BattleStatsSnapshot } from '../src/combat/BattleStatsTracker'

const snapshot: BattleStatsSnapshot = {
  player: {
    damageDealt: 1284,
    damageTaken: 73,
    kills: 7,
    structureDamage: 320,
    structuresDestroyed: 1,
    gateBreaches: 1,
    survived: true,
  },
  squads: [{
    squadId: 3,
    damageDealt: 5820,
    damageTaken: 910,
    kills: 31,
    structureDamage: 640,
    structuresDestroyed: 2,
    gateBreaches: 1,
    startingMembers: 25,
    survivors: 18,
    casualties: 7,
  }],
}

describe('BattleStatsView', () => {
  it('renders personal battle stats', () => {
    const html = renderBattleStats(snapshot, false)
    expect(html).toContain('戰鬥統計')
    expect(html).toContain('玩家統計')
    expect(html).toContain('PLAYER')
    expect(html).toContain('1,284')
    expect(html).toContain('擊殺')
    expect(html).toContain('320')
    expect(html).toContain('✓')
    expect(html).not.toContain('第 3 隊')
  })

  it('renders squad totals only when squad stats are requested', () => {
    const html = renderBattleStats(snapshot, true)
    expect(html).toContain('第 3 隊')
    expect(html).toContain('傷害 5,820')
    expect(html).toContain('擊殺 31')
    expect(html).toContain('破門 1')
    expect(html).toContain('存活 18/25')
  })
})
