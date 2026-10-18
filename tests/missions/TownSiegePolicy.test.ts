import { describe, expect, it, onTestFinished } from 'vitest'
import { siegeDefensePlans } from '../../src/career/TownSiege'
import { TownFourGateSiege, type TownSiegeAttackerRole } from '../../src/career/TownFourGateSiege'
import { planCommanderFourGateDefenseDeployment } from '../../src/career/CommanderFourGateDefenseDeployment'
import { AIType, NPC } from '../../src/world/NPC'
import { parseCommandActorCheckpoint } from '../../src/career/CareerCommandAuthority'
import { Box3, Vector3 } from 'three'
import { AvailableBreachEntrances } from '../../src/navigation/AvailableBreachEntrances'
import { TownGateBreachPolicy } from '../../src/career/TownGateBreachPolicy'
import { townSiegeSectorReceiptsMatch } from '../../src/career/TownFourGateSiegePolicy'
import { townAuthoredRoster, type TownActorSpec } from '../../src/town/TownRules'
import { getTownRampartLayout, townRampartHeight } from '../../src/town/TownRamparts'
import { townCommanderSpec } from '../../src/town/TownCommanderIdentity'
import type { ObstacleData } from '../../src/world/Terrain'
import { SiegeConvoy } from '../../src/campaign/SiegeConvoy'

// Exercise the full authored identity/capacity contract without allocating normal-Town
// daily garrison or civilian homes. CaptainMissionPolicy keeps exact slot/order parity
// with the positioned townRoster; TownResidentLayout owns those placement invariants.

describe('Siege deployment and shared rule ownership', () => {
  it('keeps native gate membership and deploys all ground defenders without replacing the eight official squads', () => {
    const residents = townAuthoredRoster(), plans = siegeDefensePlans(residents)
    expect(plans.map(p => p.infantry.length).sort()).toEqual([25, 25, 25, 26])
    expect(plans.map(p => p.cavalry.length).sort()).toEqual([25, 25, 26, 26])
    for (const p of plans) expect(p.infantry.filter(id => id.startsWith('gate:')).every(id => id.startsWith(`gate:${p.gateId}:`))).toBe(true)
    expect(plans.map(p => p.leaderId)).toEqual(['captain', 'ranger', 'town-patrol:a:captain', 'town-patrol:b:captain'])
    const trainer: TownActorSpec = { id: 'eagle-trainer', role: 'eagle-trainer', duty: 'service', tier: 4,
      mounted: false, training: false, assaultObjective: true, index: 0, x: -90, z: 36, yaw: 0 }
    const native = [...residents, townCommanderSpec({ x: 52, z: -22, yaw: 0 }), trainer]
    const original = structuredClone(native), layout = getTownRampartLayout()
    // Math-only walk surfaces and two physical volumes: a firing blocker outside
    // the deck and an occupied portion of its inner lanes. No scene/model builder.
    const obstacles: ObstacleData[] = [
      { box: new Box3(new Vector3(-31, -100, -115), new Vector3(-12, 100, -113.3)), isBarricade: false },
      { box: new Box3(new Vector3(10, -100, -112), new Vector3(20, 100, -104)), isBarricade: false },
    ]
    const deployment = planCommanderFourGateDefenseDeployment(native, layout, obstacles)
    const groundIds = native.filter(actor => actor.duty !== 'eagle_garrison'
      && (actor.unitKind || ['ranger', 'commander', 'eagle-trainer'].includes(actor.role))).map(actor => actor.id)
    const sectorIds = deployment.sectors.flatMap(sector => [...sector.wallActorIds, ...sector.cavalryActorIds])
    expect(deployment.stations.size).toBe(205)
    expect(new Set(sectorIds).size).toBe(205)
    expect([...deployment.stations.keys()].sort()).toEqual(groundIds.sort())
    expect(sectorIds.sort()).toEqual(groundIds)
    expect(deployment.sectors.map(sector => [sector.wallActorIds.length, sector.cavalryActorIds.length]))
      .toEqual([[26, 27], [26, 26], [25, 25], [25, 25]])
    expect(deployment.squads.map(squad => squad.squadId)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(deployment.squads.map(squad => squad.actorIds.length)).toEqual([30, 30, 30, 30, 30, 30, 25, 5])
    expect(new Set(deployment.squads.flatMap(squad => squad.actorIds)).size).toBe(210)
    expect(deployment.squads[1].actorIds).toContain('commander')
    expect(deployment.squads[6].actorIds).toContain('eagle-trainer')
    expect(deployment.squads[7].actorIds).toEqual([1, 2, 3, 4, 5].map(id => `town-eagle-rider:${id}`))
    expect(deployment.squads[7].actorIds.some(id => deployment.stations.has(id))).toBe(false)
    expect(deployment.stations.get('gate:north:0')!.z).toBeLessThan(deployment.stations.get('gate:north:4')!.z)
    expect(native).toEqual(original)
    const stations = [...deployment.stations], invalid: string[] = []
    const radius = (kind: 'wall' | 'cavalry') => kind === 'wall' ? .6 : 1.25
    for (const [index, [id, station]] of stations.entries()) {
      const r = radius(station.kind), spec = native.find(actor => actor.id === id)!
      if (station.kind === 'wall' && townRampartHeight(layout, station.x, station.z) !== station.y) invalid.push(`${id}:unsupported`)
      if (spec.gateId && station.gateId !== spec.gateId) invalid.push(`${id}:wrong gate`)
      if (obstacles.some(({ box }) => station.x + r > box.min.x && station.x - r < box.max.x
        && station.z + r > box.min.z && station.z - r < box.max.z)) invalid.push(`${id}:blocked`)
      if (station.kind === 'wall' && station.gateId === 'north' && ['ranged', 'archer'].includes(spec.unitKind ?? '')
        && station.x >= -31 && station.x <= -12) invalid.push(`${id}:blocked shot`)
      // West pad 4's standing/approach envelope is reserved even without a ground collider.
      if (station.kind === 'cavalry' && station.x >= -99 && station.x <= -71 && station.z >= -27 && station.z <= 113) invalid.push(`${id}:eagle corridor`)
      for (let other = 0; other < index; other++) {
        const neighbor = stations[other][1]
        if (Math.abs(neighbor.y - station.y) < 3.6
          && Math.hypot(neighbor.x - station.x, neighbor.z - station.z) < r + radius(neighbor.kind)) invalid.push(`${id}:overlap`)
      }
    }
    expect(invalid).toEqual([])
  })

  it('keeps horse-equipped native infantry on supported wall slots and dismounted native cavalry at its gate', () => {
    const ids = ['gate:north:0', 'gate:north:1', 'gate:north:7', 'captain', 'town-eagle-rider:1']
    const residents = townAuthoredRoster().filter(actor => ids.includes(actor.id)), original = structuredClone(residents)
    const layout = getTownRampartLayout()
    const equipment = (actor: TownActorSpec) => ({ mounted: actor.id !== 'captain',
      ranged: actor.unitKind === 'archer', flying: actor.duty === 'eagle_garrison' })
    const deployment = planCommanderFourGateDefenseDeployment(residents, layout, [], equipment)
    expect(deployment.sectors[0].wallActorIds).toEqual(['gate:north:0', 'gate:north:1', 'gate:north:7'])
    expect(deployment.sectors[0].cavalryActorIds).toEqual(['captain'])
    expect(deployment.stations.get('captain')?.kind).toBe('cavalry')
    expect(deployment.stations.has('town-eagle-rider:1')).toBe(false)
    const wall = deployment.sectors[0].wallActorIds.map(id => deployment.stations.get(id)!)
    for (const station of wall) {
      expect(station.kind).toBe('wall')
      for (const [dx, dz] of [[1.25, 0], [-1.25, 0], [0, 1.25], [0, -1.25]]) {
        const support = townRampartHeight(layout, station.x + dx, station.z + dz)
        expect(support).not.toBeNull()
        expect(Math.abs(support! - station.y)).toBeLessThanOrEqual(.4)
      }
    }
    expect(Math.hypot(wall[0].x - wall[1].x, wall[0].z - wall[1].z)).toBeGreaterThanOrEqual(3.6)
    expect(residents).toEqual(original)
  })

  it('requires explicit mounted wall permission, preserves it in checkpoints and clears it when command ownership is released', () => {
    type GarrisonActor = Pick<NPC, 'activateTownRampartGarrison' | 'releaseOutpostRampartGarrison'
      | 'isTownRampartGarrisonActive' | 'isMountedTownRampartGarrisonEnabled' | 'holdsRampartPosition'
      | 'holdsRampartFirePosition' | 'tacticalOrder' | 'setTacticalOrder'> & { mount: { dead: boolean } | null; aiType: AIType }
    // Only the order boundary is supplied; the real garrison activation/getters/release run.
    const actor: GarrisonActor = Object.assign(Object.create(NPC.prototype) as GarrisonActor, {
      mount: { dead: false },
      setTacticalOrder(this: GarrisonActor, order: NPC['tacticalOrder']) { this.tacticalOrder = order },
    })
    Object.defineProperty(actor, 'aiType', { value: AIType.RANGED })
    actor.activateTownRampartGarrison()
    expect(actor.isTownRampartGarrisonActive).toBe(false)
    expect(actor.holdsRampartPosition).toBe(false)
    actor.activateTownRampartGarrison('defend', true)
    expect(actor.isTownRampartGarrisonActive).toBe(true)
    expect(actor.holdsRampartFirePosition).toBe(true)
    const saved = parseCommandActorCheckpoint({ status: 'deployed', order: actor.tacticalOrder,
      townRampartGarrison: actor.isTownRampartGarrisonActive, townRampartMounted: actor.isMountedTownRampartGarrisonEnabled })!
    expect(saved).toEqual({ status: 'deployed', order: 'defend', townRampartGarrison: true, townRampartMounted: true })
    actor.releaseOutpostRampartGarrison()
    expect(actor.isMountedTownRampartGarrisonEnabled).toBe(false)
    expect(actor.holdsRampartFirePosition).toBe(false)
    actor.activateTownRampartGarrison('defend', saved.townRampartMounted)
    expect(actor.holdsRampartFirePosition).toBe(true)
    actor.releaseOutpostRampartGarrison(); actor.mount = null; actor.activateTownRampartGarrison()
    expect(actor.holdsRampartFirePosition).toBe(true)
    expect(actor.isMountedTownRampartGarrisonEnabled).toBe(false)
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
    const oldReceipt = policy.gates.get('north')!
    // An older Commander save classified a horse-equipped infantry actor as cavalry.
    // Only the same-gate defender union may admit that historical receipt, without rewriting it.
    const currentSector = { gateId: 'north' as const, wallActorIds: ['north:cavalry:1', 'north:wall:2'], cavalryActorIds: [] }
    expect(townSiegeSectorReceiptsMatch(currentSector, oldReceipt)).toBe(false)
    expect(townSiegeSectorReceiptsMatch(currentSector, oldReceipt, true)).toBe(true)
    expect(townSiegeSectorReceiptsMatch({ ...currentSector, gateId: 'east' }, oldReceipt, true)).toBe(false)
    expect(townSiegeSectorReceiptsMatch({ ...currentSector, wallActorIds: ['north:other'] }, oldReceipt, true)).toBe(false)
    const issued: string[] = []
    const actors = currentSector.wallActorIds.map(combatantId => ({ combatantId, dead: false,
      tacticalOrder: 'defend', hasFormationTarget: false, releaseOutpostRampartGarrison() {},
      setMissionCombatTarget() {}, setTacticalOrder() { issued.push(combatantId) } }))
    const owner = Object.assign(Object.create(TownFourGateSiege.prototype) as {
      dispatch(event: { gateId: 'north'; kind: 'wall' }): string[]; policy?: TownGateBreachPolicy
    }, { restoring: false, departedActors: new Map(), playerCommands: new Set(),
      actorsById: new Map(actors.map(actor => [actor.combatantId, actor])), sectorById: new Map([['north', currentSector]]),
      options: { historicalSectorReceipts: true, acceptsOrders: () => true } })
    const restored = new TownGateBreachPolicy(event => {
      if (event.gateId !== 'north' || event.kind !== 'wall') throw new Error('replayed breach')
      return owner.dispatch({ gateId: 'north', kind: 'wall' })
    }, policy.snapshot())
    owner.policy = restored
    restored.gate('north', 'destroyed')
    expect(restored.snapshot()).toEqual(policy.snapshot())
    expect(restored.gates.get('north')).toMatchObject({ wallEventHandled: false, cavalryEventHandled: true, dockedRampIds: [], releasedCavalryActorIds: ['north:cavalry:1'] })
    expect(restored.gates.get('east')?.cavalryEventHandled).toBe(false)
    expect(restored.gates.get('south')?.cavalryEventHandled).toBe(false)
    expect(restored.gates.get('west')?.cavalryEventHandled).toBe(false)
    restored.ramp('north', -1, true)
    expect(issued).toEqual(['north:wall:2'])
    expect(restored.gates.get('north')).toMatchObject({ releasedWallActorIds: ['north:wall:2'], releasedCavalryActorIds: ['north:cavalry:1'] })
  })

  it('keeps an actual sector dispatch inside its roster and preserves HR, follow, formation and explicit player orders', () => {
    const orders: string[] = [], targets = new Map<string, unknown>()
    const actor = (id: string, overrides: Partial<Pick<NPC, 'combatOwnership' | 'tacticalOrder' | 'hasFormationTarget'>> = {}) => ({
      combatantId: id, dead: false, tacticalOrder: 'defend', hasFormationTarget: false,
      releaseOutpostRampartGarrison() {}, setMissionCombatTarget(target: unknown) { targets.set(id, target) },
      setTacticalOrder() { orders.push(id) }, ...overrides,
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
    expect([...targets]).toEqual([['east:auto', undefined]])
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

  it('keeps opt-in cavalry on its gate while ranged and air actors retain their own combat policy after a dock', () => {
    const entries = new AvailableBreachEntrances()
    entries.set({ id: 'town-siege-ramp:east:left', gateId: 'east', type: 'siege-ramp', position: new Vector3(190, 8, 62),
      approach: new Vector3(200, 0, 62), exit: new Vector3(145, 8, 62), mounted: true, walkable: true, faction: null, connectionId: 'east-ramp' })
    entries.set({ id: 'town-siege-gate:north', gateId: 'north', type: 'gate', position: new Vector3(199, 0, 62),
      approach: new Vector3(199, 0, 62), exit: new Vector3(195, 0, 62), mounted: true, walkable: true, faction: null, connectionId: 'north-gate' })
    const gate = { state: 'closed', siegeObstacle: { id: 'east-gate-collider' } }
    const actor = (role: TownSiegeAttackerRole) => ({
      role, combatantId: `east:${role}`, dead: false, siegeTransport: null, tacticalOrder: 'attack', hasFormationTarget: false,
      campaignBreachCompleted: false, campaignEntranceId: null as string | null, characterFaction: 'viking',
      aiType: role === 'gate-cavalry' ? AIType.MELEE : AIType.RANGED, isMounted: role === 'gate-cavalry',
      combatPosition: new Vector3(200, 0, 62), siegeTarget: null as unknown, orders: [] as string[],
      assignSiegeObstacle(target: unknown) { this.siegeTarget = target }, setTacticalOrder(order: string) { this.orders.push(order) },
    })
    const cavalry = actor('gate-cavalry'), archer = actor('ranged'), flyer = actor('air'), actors = [cavalry, archer, flyer]
    const owner = Object.assign(Object.create(TownFourGateSiege.prototype) as { route(npc: ReturnType<typeof actor>): void }, {
      attackerIds: new Set(actors.map(npc => npc.combatantId)), actorSectors: new Map(actors.map(npc => [npc.combatantId, 'east'])),
      playerCommands: new Set(), departedActors: new Map(), options: { acceptsOrders: () => true,
        attackerRole: (npc: ReturnType<typeof actor>) => npc.role, world: { gates: new Map([['east', gate]]) },
        navigation: { townNav: { siegeEntrances: entries, isElevated: () => false }, areConnected: () => true } },
    })
    for (const npc of actors) owner.route(npc)
    expect(actors.map(npc => npc.campaignEntranceId)).toEqual([null, null, null])
    expect(actors.map(npc => npc.siegeTarget)).toEqual([gate.siegeObstacle, null, null])
    expect(actors.map(npc => npc.orders)).toEqual([[], [], []])
    gate.state = 'destroyed'
    entries.set({ id: 'town-siege-gate:east', gateId: 'east', type: 'gate', position: new Vector3(180, 0, 62),
      approach: new Vector3(180, 0, 62), exit: new Vector3(176, 0, 62), mounted: true, walkable: true, faction: null, connectionId: 'east-gate' })
    for (const npc of actors) owner.route(npc)
    expect(actors.map(npc => npc.campaignEntranceId)).toEqual(['town-siege-gate:east', null, null])
    expect(actors.map(npc => npc.siegeTarget)).toEqual([null, null, null])
    expect(actors.map(npc => npc.orders)).toEqual([['charge'], [], []])
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
        actors: () => [npc, defender, ambient, personal], acceptsOrders: () => true,
        attackerRole: undefined as (() => TownSiegeAttackerRole) | undefined },
    })
    owner.update(.1)
    expect(npc.siegeBypassTarget).toEqual(new Vector3(6.5, 20, -5))
    expect([defender.siegeBypassTarget, ambient.siegeBypassTarget, personal.siegeBypassTarget]).toEqual([null, null, null])
    npc.mount = { isFlyingMount: true }
    owner.update(.1); expect(npc.siegeBypassTarget).toBeNull()
    owner.update(.1); expect(npc.siegeBypassTarget).toBeNull()
    npc.mount = null
    owner.update(.1); expect(npc.siegeBypassTarget).toEqual(new Vector3(6.5, 20, -5))
    owner.options.attackerRole = () => 'air'
    owner.update(.1); expect(npc.siegeBypassTarget).toBeNull()
    convoy.dispose(); expect(npc.siegeBypassTarget).toBeNull()
  })

})
