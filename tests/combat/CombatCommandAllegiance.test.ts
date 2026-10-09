import { describe, expect, it } from 'vitest'
import { combatAllegiancesHostile, Faction } from '../../src/combat/CombatFaction'

describe('Explicitly owned command allies', () => {
  it.each(['town-command', 'player-personal'] as const)('%s allies share peaceful Town combat but defend against hostile residents', combatOwnership => {
    const ally = { faction: Faction.PLAYER, combatOwnership }
    const peaceful = { faction: Faction.TOWN, hostileToPlayer: false }
    const hostile = { faction: Faction.TOWN, hostileToPlayer: true }
    expect(combatAllegiancesHostile(ally, peaceful)).toBe(false)
    expect(combatAllegiancesHostile(peaceful, ally)).toBe(false)
    expect(combatAllegiancesHostile(ally, hostile)).toBe(true)
    expect(combatAllegiancesHostile(hostile, ally)).toBe(true)
    expect(combatAllegiancesHostile(ally, { faction: Faction.PLAYER })).toBe(false)
  })

  it('preserves normal unowned allegiances and official Town ownership', () => {
    expect(combatAllegiancesHostile({ faction: Faction.PLAYER }, { faction: Faction.TOWN })).toBe(true)
    expect(combatAllegiancesHostile({ faction: Faction.TOWN, combatOwnership: 'mission-official' }, { faction: Faction.TOWN })).toBe(false)
    expect(combatAllegiancesHostile({ faction: Faction.TOWN, combatOwnership: 'mission-official' }, { faction: Faction.BANDIT })).toBe(true)
  })
})
