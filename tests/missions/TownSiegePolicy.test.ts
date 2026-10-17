import { describe, expect, it } from 'vitest'
import { createEnemyTownAssaultMission } from '../../src/career/EnemyTownAssault'
import { siegeDefensePlans } from '../../src/career/TownSiege'
import { TownFourGateSiege } from '../../src/career/TownFourGateSiege'
import type { NPC } from '../../src/world/NPC'
import { TownGateBreachPolicy } from '../../src/career/TownGateBreachPolicy'
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
  it('releases only East wall defenders once when East-left docks, keeping all cavalry and East-right independent', () => {
    const events: string[] = [], policy = new TownGateBreachPolicy(event => { events.push(`${event.gateId}:${event.kind}`); return ['east:wall:1'] })
    policy.ramp('east', -1, true); policy.ramp('east', -1, true)
    expect(events).toEqual(['east:wall'])
    expect(policy.gates.get('east')).toMatchObject({ dockedRampIds: ['town-siege-ramp:east:left'], cavalryEventHandled: false })
    expect(policy.gates.get('north')?.wallEventHandled).toBe(false)
    expect(policy.gates.get('south')?.wallEventHandled).toBe(false)
    expect(policy.gates.get('west')?.wallEventHandled).toBe(false)
  })
  it('releases only destroyed North gate cavalry and restores its one-shot event without replay', () => {
    const events: string[] = [], policy = new TownGateBreachPolicy(event => { events.push(`${event.gateId}:${event.kind}`); return ['north:cavalry:1'] })
    policy.gate('east', 'open'); policy.gate('north', 'destroyed'); policy.gate('north', 'destroyed')
    expect(events).toEqual(['north:cavalry'])
    const restored = new TownGateBreachPolicy(() => { throw new Error('replayed breach') }, policy.snapshot())
    restored.gate('north', 'destroyed')
    expect(restored.gates.get('north')).toMatchObject({ wallEventHandled: false, cavalryEventHandled: true, dockedRampIds: [], releasedCavalryActorIds: ['north:cavalry:1'] })
    expect(restored.gates.get('east')?.cavalryEventHandled).toBe(false)
    expect(restored.gates.get('south')?.cavalryEventHandled).toBe(false)
    expect(restored.gates.get('west')?.cavalryEventHandled).toBe(false)
  })

  it('keeps an actual sector dispatch inside its roster and preserves HR, follow, formation and explicit player orders', () => {
    const orders: string[] = []
    const actor = (id: string, overrides: Partial<Pick<NPC, 'combatOwnership' | 'tacticalOrder' | 'hasFormationTarget'>> = {}) => ({
      combatantId: id, dead: false, tacticalOrder: 'defend', hasFormationTarget: false,
      releaseOutpostRampartGarrison() {}, setTacticalOrder() { orders.push(id) }, ...overrides,
    })
    const actors = [actor('east:auto'), actor('east:personal', { combatOwnership: 'player-personal' }),
      actor('east:follow', { tacticalOrder: 'follow' }), actor('east:formation', { hasFormationTarget: true }), actor('east:player'), actor('north:auto')]
    // Boundary only: live actor command methods are dependencies; the sector/authority decisions are real.
    const owner = Object.assign(Object.create(TownFourGateSiege.prototype) as { dispatch(event: { gateId: 'east'; kind: 'wall' }): string[] }, {
      restoring: false, departedActors: new Map(), playerCommands: new Set(['east:player']), actorsById: new Map(actors.map(n => [n.combatantId, n])),
      sectorById: new Map([['east', { gateId: 'east', wallActorIds: actors.filter(n => n.combatantId.startsWith('east:')).map(n => n.combatantId), cavalryActorIds: [] }]]),
      options: { acceptsOrders: () => true },
    })
    expect(owner.dispatch({ gateId: 'east', kind: 'wall' })).toEqual(['east:auto'])
    expect(orders).toEqual(['east:auto'])
  })

})
