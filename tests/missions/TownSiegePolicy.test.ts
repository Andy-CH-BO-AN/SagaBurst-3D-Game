import { describe, expect, it } from 'vitest'
import { siegeRoster, siegeDefensePlans } from '../../src/career/TownSiege'
import { townRoster } from '../../src/town/TownRules'
import { createEnemyTownAssaultMission, resolveAssaultOutcome } from '../../src/career/EnemyTownAssault'

// Pure rosters/objectives own every faction/mode input without constructing actors.
for (const faction of ['roman', 'viking'] as const) describe(`${faction} shared four-gate Siege`, () => {
  it('uses four squads with four T4 officers and counts Player inside the Assault roster', () => {
    for (const assault of [false, true]) {
      const roster = siegeRoster(faction, assault)
      expect(roster).toHaveLength(assault ? 119 : 120)
      expect(roster.filter(s => s.spec.tier === 4)).toHaveLength(4)
      expect(roster.filter(s => s.spec.combatProfileId === 'ranger')).toHaveLength(1)
      expect(roster.find(s => s.spec.combatProfileId === 'ranger')!.spec.loadout?.mountId).toBe('black-cat')
      for (const id of ['north', 'south', 'east', 'west']) expect(roster.filter(s => s.gateId === id).length + (assault && id === 'north' ? 1 : 0)).toBe(30)
      expect(roster.every(s => s.spec.tier === 4 || s.spec.tier === 3)).toBe(true)
    }
  })
})

describe('Siege deployment and shared rule ownership', () => {
  it('keeps gate guards local, balances infantry and assigns four existing cavalry officers', () => {
    const plans = siegeDefensePlans(townRoster())
    expect(plans.map(p => p.infantry.length).sort()).toEqual([25, 25, 25, 26])
    expect(plans.map(p => p.cavalry.length).sort()).toEqual([25, 25, 26, 26])
    for (const p of plans) expect(p.infantry.filter(id => id.startsWith('gate:')).every(id => id.startsWith(`gate:${p.gateId}:`))).toBe(true)
    expect(plans.map(p => p.leaderId)).toEqual(['captain', 'ranger', 'town-patrol:a:captain', 'town-patrol:b:captain'])
  })

  it('counts military objectives independently of faction and excludes civilians', () => {
    const objective = createEnemyTownAssaultMission().targetActorIds
    expect(objective).toHaveLength(203)
    expect(objective.filter(id => id.startsWith('gate:'))).toHaveLength(40)
    expect(objective.filter(id => id.startsWith('town-patrol:'))).toHaveLength(40)
    expect(objective.some(id => id.startsWith('civilian'))).toBe(false)
  })
})

describe('Enemy Town Assault retained contracts', () => {
  it.each([
    [true, 0, 0, 'victory'], [false, 0, 0, 'victory'], [true, 1, 1, null],
    [true, 1, 0, 'failure'], [false, 1, 0, null],
  ] as const)('assault dead=%s military=%s NPC=%s => %s', (dead, military, allies, outcome) => {
    expect(resolveAssaultOutcome(dead, military, allies)).toBe(outcome)
  })
})
