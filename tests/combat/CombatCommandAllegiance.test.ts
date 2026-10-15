import { describe, expect, it } from 'vitest'
import { combatAllegiancesHostile, Faction } from '../../src/combat/CombatFaction'

describe('Combat allegiance', () => {
  it.each([
    ['town-command', false, false],
    ['town-command', true, true],
    ['player-personal', false, false],
    ['player-personal', true, true],
  ] as const)('%s against Town hostile=%s yields hostility=%s in either direction', (combatOwnership, hostileToPlayer, expected) => {
    const ally = { faction: Faction.PLAYER, combatOwnership }, town = { faction: Faction.TOWN, hostileToPlayer }
    expect(combatAllegiancesHostile(ally, town)).toBe(expected)
    expect(combatAllegiancesHostile(town, ally)).toBe(expected)
  })

  it('keeps unowned player troops hostile to Town residents', () => {
    expect(combatAllegiancesHostile({ faction: Faction.PLAYER }, { faction: Faction.TOWN })).toBe(true)
  })
})
