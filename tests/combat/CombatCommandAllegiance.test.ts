import { describe, expect, it } from 'vitest'
import { combatAllegiancesHostile, Faction } from '../../src/combat/CombatFaction'

describe('Combat allegiance', () => {
  it('checks hostility against Town based on player hostility in either direction', () => {
    const table = [
      ['town-command', false, false],
      ['town-command', true, true],
      ['player-personal', false, false],
      ['player-personal', true, true],
    ] as const
    for (const [combatOwnership, hostileToPlayer, expected] of table) {
      const ally = { faction: Faction.PLAYER, combatOwnership }, town = { faction: Faction.TOWN, hostileToPlayer }
      expect(combatAllegiancesHostile(ally, town)).toBe(expected)
      expect(combatAllegiancesHostile(town, ally)).toBe(expected)
    }
  })

  it('keeps unowned player troops hostile to Town residents', () => {
    expect(combatAllegiancesHostile({ faction: Faction.PLAYER }, { faction: Faction.TOWN })).toBe(true)
  })
})
