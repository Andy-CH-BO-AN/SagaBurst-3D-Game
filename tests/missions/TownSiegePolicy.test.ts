import { describe, expect, it, onTestFinished } from 'vitest'
import { createEnemyTownAssaultMission } from '../../src/career/EnemyTownAssault'
import { siegeDefensePlans } from '../../src/career/TownSiege'
import { TownFourGateSiege } from '../../src/career/TownFourGateSiege'
import { AIType, type NPC } from '../../src/world/NPC'
import { Vector3 } from 'three'
import { AvailableBreachEntrances } from '../../src/navigation/AvailableBreachEntrances'
import { TownGateBreachPolicy } from '../../src/career/TownGateBreachPolicy'
import { townRoster } from '../../src/town/TownRules'
import { SiegeConvoy } from '../../src/campaign/SiegeConvoy'

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

  it('routes a PR8 non-Crew ranged attacker through its own sector while preserving Attack', () => {
    const entries = new AvailableBreachEntrances(), orders: string[] = []
    const eastGate = { state: 'closed', siegeObstacle: { id: 'east-gate-collider' } }
    let siegeTarget: unknown = null
    for (const [gateId, x] of [['north', 198], ['east', 180]] as const) entries.set({ id: `town-siege-gate:${gateId}`, gateId,
      type: 'gate', position: new Vector3(x, 0, 62), approach: new Vector3(x, 0, 62), exit: new Vector3(x - 4, 0, 62),
      mounted: true, walkable: true, faction: null, connectionId: gateId })
    const npc = { combatantId: 'east:archer', dead: false, siegeTransport: null, tacticalOrder: 'attack', hasFormationTarget: false,
      campaignBreachCompleted: false, campaignEntranceId: null as string | null, characterFaction: 'viking', aiType: AIType.RANGED,
      combatPosition: new Vector3(200, 0, 62), isMounted: false, assignSiegeObstacle(target: unknown) { siegeTarget = target }, setTacticalOrder(order: string) { orders.push(order) } }
    const owner = Object.assign(Object.create(TownFourGateSiege.prototype) as { route(actor: typeof npc): void }, {
      attackerIds: new Set(['east:archer']), actorSectors: new Map([['east:archer', 'east']]), playerCommands: new Set(), departedActors: new Map(),
      options: { acceptsOrders: () => true, world: { gates: new Map([['east', eastGate]]) }, navigation: { townNav: { siegeEntrances: entries, isElevated: () => false }, areConnected: () => true } },
    })
    owner.route(npc)
    expect(npc.campaignEntranceId).toBe('town-siege-gate:east')
    expect(orders).toEqual(['attack'])
    entries.clear(); owner.route(npc)
    expect(npc.campaignEntranceId).toBeNull(); expect(siegeTarget).toBe(eastGate.siegeObstacle)
  })

  it('admits only rostered ground attackers to convoy detours and clears excluded actors', () => {
    const entrances = new AvailableBreachEntrances(), convoy = new SiegeConvoy()
    onTestFinished(() => convoy.dispose())
    const npc = { combatantId: 'east:flyer', dead: false, tacticalOrder: 'attack', hasFormationTarget: false,
      siegeTransport: null, siegeBypassTarget: null as Vector3 | null, combatPosition: new Vector3(0, 20, -5),
      mount: null as { isFlyingMount: boolean } | null }
    const ramp = { position: new Vector3(), placement: { dirX: 0, dirZ: 1 }, controller: { state: 'PUSHING' },
      surface: { startX: 0, startZ: -30, halfWidth: 2.5 } }
    const defender = { ...npc, combatantId: 'east:defender' }, ambient = { ...npc, combatantId: 'ambient' }
    const personal = { ...npc, combatantId: 'personal', combatOwnership: 'player-personal' }
    // Narrow data adapter to seed an existing real detour; no actor or vehicle constructors.
    const detours = convoy as unknown as { update(actor: typeof npc, ramps: readonly typeof ramp[]): void }
    detours.update(defender, [ramp])
    expect(defender.siegeBypassTarget).not.toBeNull()
    // Real Town caller and convoy policy; readiness, render/spawn and route rosters are data boundaries.
    const owner = Object.assign(Object.create(TownFourGateSiege.prototype) as Pick<TownFourGateSiege, 'update'>, {
      prepared: true, disposed: false, pending: new Set(), ramps: new Map(), rampList: [ramp], convoy,
      observedRevision: entrances.revision, actorsById: new Map(), playerCommands: new Set(), departedActors: new Map(),
      attackerIds: new Set([npc.combatantId]),
      options: { world: {}, grid: {}, navigation: { townNav: { siegeEntrances: entrances } },
        actors: () => [npc, defender, ambient, personal], acceptsOrders: () => true },
    })
    owner.update(.1)
    expect(npc.siegeBypassTarget).toEqual(new Vector3(6.5, 20, -5))
    expect([defender.siegeBypassTarget, ambient.siegeBypassTarget, personal.siegeBypassTarget]).toEqual([null, null, null])
    npc.mount = { isFlyingMount: true }
    owner.update(.1); expect(npc.siegeBypassTarget).toBeNull()
    owner.update(.1); expect(npc.siegeBypassTarget).toBeNull()
    npc.mount = null
    owner.update(.1); expect(npc.siegeBypassTarget).toEqual(new Vector3(6.5, 20, -5))
    convoy.dispose(); expect(npc.siegeBypassTarget).toBeNull()
  })

})
