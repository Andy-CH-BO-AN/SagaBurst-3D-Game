import { describe, expect, it } from 'vitest'
import { createEnemyTownAssaultMission } from '../../src/career/EnemyTownAssault'
import { siegeDefensePlans } from '../../src/career/TownSiege'
import { townRoster } from '../../src/town/TownRules'

// Data owns deployment membership without constructing actors.

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
    expect(objective).toHaveLength(208)
    expect(objective.filter(id => id.startsWith('gate:'))).toHaveLength(40)
    expect(objective.filter(id => id.startsWith('town-patrol:'))).toHaveLength(40)
    expect(objective.some(id => id.startsWith('civilian'))).toBe(false)
  })
})
