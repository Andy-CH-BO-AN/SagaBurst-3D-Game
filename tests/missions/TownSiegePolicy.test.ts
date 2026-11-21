import { SpatialGrid } from '../../src/world/SpatialGrid'
import type { Player } from '../../src/player/Player'
import { TownLayeredNavigation } from '../../src/navigation/TownLayeredNavigation'
import { gateBreachLane } from '../../src/navigation/GateBreachPortal'
import { describe, expect, it, onTestFinished } from 'vitest'

import { type TownSiegeAttackerRole } from '../../src/career/TownFourGateSiege'
import { planCommanderFourGateDefenseDeployment } from '../../src/career/CommanderFourGateDefenseDeployment'
import { AIType, NPC, Faction } from '../../src/world/NPC'
import { RampartDuty, type RampartDutyActor } from '../../src/battle/RampartDuty'
import { parseCommandActorCheckpoint } from '../../src/career/CareerCommandAuthority'
import { Vector3 } from 'three'
import { AvailableBreachEntrances } from '../../src/navigation/AvailableBreachEntrances'
import { TownGateBreachPolicy } from '../../src/career/TownGateBreachPolicy'
import { townAuthoredRoster, type TownActorSpec } from '../../src/town/TownRules'
import { getTownRampartLayout, townRampartHeight } from '../../src/town/TownRamparts'

import { getTerrainHeight } from '../../src/world/Terrain'
import { SiegeConvoy } from '../../src/campaign/SiegeConvoy'
import { ActorDouble, asNpc, MountDouble } from '../helpers/careerActorDoubles'
import { preparedTownSiege, townSiege } from '../helpers/townSiegeDoubles'
import { PursuitBlockList } from '../../src/navigation/PursuitBlockList'

const EMPTY_LAYOUT = { decks: [], ramps: [], corners: [], lengths: [], perimeter: 1, wallSpans: [] }
/** An attacker body with its fixed sector role; cavalry rides a ground mount. */
function attacker(id: string, role: TownSiegeAttackerRole, x = 200, z = 62): ActorDouble {
  const actor = new ActorDouble(id, { faction: Faction.ENEMY, characterFaction: 'viking',
    aiType: role === 'gate-cavalry' ? AIType.MELEE : AIType.RANGED, x, z })
  if (role === 'gate-cavalry') actor.mountVehicle(new MountDouble('horse', x, z))
  actor.tacticalOrder = 'attack'
  return actor
}

// Exercise the full authored identity/capacity contract without allocating normal-Town
// daily garrison or civilian homes. CaptainMissionPolicy keeps exact slot/order parity
// with the positioned townRoster; TownResidentLayout owns those placement invariants.

describe('Siege deployment and shared rule ownership', () => {

  it('keeps horse-equipped native infantry on supported wall slots and dismounted native cavalry at its gate', () => {
    const ids = ['gate:north:0', 'gate:north:1', 'gate:north:7', 'captain', 'town-eagle-rider:1']
    const residents = townAuthoredRoster().filter(actor => ids.includes(actor.id)), original = structuredClone(residents)
    const layout = getTownRampartLayout()
    const equipment = (actor: TownActorSpec) => ({ mounted: actor.id !== 'captain',
      ranged: actor.unitKind === 'archer', flying: actor.duty === 'eagle_garrison' })
    const deployment = planCommanderFourGateDefenseDeployment(residents, layout, [], equipment)
    expect(deployment.sectors[0].wallActorIds).toEqual(['gate:north:0', 'gate:north:1', 'gate:north:7'])
    expect(deployment.sectors.find(sector => sector.gateId === 'east')!.cavalryActorIds).toEqual(['captain'])
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
    // RampartDuty is the duty state NPC delegates to; the actor supplies only its live order and mount.
    const actor: RampartDutyActor = { tacticalOrder: 'defend', isMounted: true }, duty = new RampartDuty()
    duty.activateTown(false)
    expect(duty.isTownActive(actor)).toBe(false)
    expect(duty.holdsPosition(actor)).toBe(false)
    duty.activateTown(true)
    expect(duty.isTownActive(actor)).toBe(true)
    expect(duty.holdsPosition(actor)).toBe(true)
    const saved = parseCommandActorCheckpoint({ status: 'deployed', order: actor.tacticalOrder,
      townRampartGarrison: duty.isTownActive(actor), townRampartMounted: duty.isMountedTownEnabled })!
    expect(saved).toEqual({ status: 'deployed', order: 'defend', townRampartGarrison: true, townRampartMounted: true })
    duty.release()
    expect(duty.isMountedTownEnabled).toBe(false)
    expect(duty.holdsPosition(actor)).toBe(false)
    duty.activateTown(saved.townRampartMounted === true)
    expect(duty.holdsPosition(actor)).toBe(true)
    duty.release(); const dismounted = { ...actor, isMounted: false }; duty.activateTown(false)
    expect(duty.holdsPosition(dismounted)).toBe(true)
    expect(duty.holdsPosition(actor)).toBe(false)
    expect(duty.isMountedTownEnabled).toBe(false)
  })

  it('requires explicit Outpost duty and does not reclaim a ranged melee attacker still standing on the rampart after release', () => {
    const actor: RampartDutyActor = { tacticalOrder: 'attack', isMounted: false }, duty = new RampartDuty()
    expect(duty.holdsPosition(actor)).toBe(false)
    duty.activateOutpost()
    expect(duty.isOutpostActive).toBe(true)
    expect(duty.holdsPosition(actor)).toBe(true)
    // Outpost duty never holds a mounted body, and movement orders always leave the wall.
    expect(duty.holdsPosition({ ...actor, isMounted: true })).toBe(false)
    expect(duty.holdsPosition({ ...actor, tacticalOrder: 'charge' })).toBe(false)
    duty.release()
    expect(duty.isOutpostActive).toBe(false)
    expect(duty.holdsPosition(actor)).toBe(false)
    // Once released, only an explicit Defend order keeps a foot archer's stationary fire on the wall; it never holds position.
    const defender = { tacticalOrder: 'defend' as const, isMounted: false, standsOnOutpostRampart: true }
    expect([duty.holdsPosition(defender), duty.holdsFirePosition(defender)]).toEqual([false, true])
    expect(duty.holdsFirePosition({ ...defender, standsOnOutpostRampart: false })).toBe(false)
    expect(duty.holdsFirePosition({ ...defender, isMounted: true })).toBe(false)
    expect(duty.holdsFirePosition({ ...defender, tacticalOrder: 'attack' })).toBe(false)
    expect(duty.holdsFirePosition({ ...defender, tacticalOrder: 'follow' })).toBe(false)
    duty.activateOutpost()
    const attacking = { ...defender, tacticalOrder: 'attack' as const, standsOnOutpostRampart: false }
    expect([duty.holdsPosition(attacking), duty.holdsFirePosition(attacking)]).toEqual([true, true])
  })

  it('releases wall defenders and gate cavalry on ramp dock or gate destruction without event replay', () => {
    const events: string[] = []
    const policy = new TownGateBreachPolicy(event => { events.push(`${event.gateId}:${event.kind}`); return [`${event.gateId}:1`] })
    policy.ramp('east', -1, true); policy.ramp('east', -1, true)
    expect(events).toEqual(['east:wall'])
    expect(policy.gates.get('east')).toMatchObject({ dockedRampIds: ['town-siege-ramp:east:left'], cavalryEventHandled: false })
    expect(policy.gates.get('north')?.wallEventHandled).toBe(false)

    policy.gate('north', 'destroyed'); policy.gate('north', 'destroyed')
    expect(events).toEqual(['east:wall', 'north:cavalry'])
    expect(policy.gates.get('north')?.cavalryEventHandled).toBe(true)
  })

  it('keeps an actual sector dispatch inside its roster and preserves HR, follow, formation and explicit player orders', () => {
    const ids = ['east:auto', 'east:personal', 'east:follow', 'east:formation', 'east:player']
    const actors = new Map([...ids, 'north:auto'].map(id => [id, Object.assign(new ActorDouble(id), { tacticalOrder: 'defend' as NPC['tacticalOrder'], missionCombatTarget: null })]))
    actors.get('east:personal')!.combatOwnership = 'player-personal'
    actors.get('east:follow')!.assignFollowTarget(null, 0)
    actors.get('east:formation')!.assignFormationTarget(7, new Vector3())
    // Real prepared siege; its east gate falling is the breach event that releases the east cavalry sector.
    const h = preparedTownSiege({ sectors: [{ gateId: 'east', wallActorIds: [], cavalryActorIds: ids }] })
    onTestFinished(() => h.siege.dispose())
    for (const actor of actors.values()) h.siege.register(asNpc(actor))
    h.siege.notifyPlayerOrder(asNpc(actors.get('east:player')!))
    h.world.gates.get('east')!.destroy()
    expect([...actors.values()].filter(actor => actor.tacticalOrder === 'charge').map(actor => actor.combatantId)).toEqual(['east:auto'])
    expect([...actors.values()].filter(actor => actor.missionCombatTarget === undefined).map(actor => actor.combatantId)).toEqual(['east:auto'])
    expect(actors.get('east:follow')!.tacticalOrder).toBe('follow')
    expect(actors.get('east:formation')!.tacticalOrder).toBe('formation')
    expect(actors.get('north:auto')!.tacticalOrder).toBe('defend')
    expect(h.siege.policy.gates.get('east')!.cavalryEventHandled).toBe(true)
  })

  it('routes attacker roles through breach entrances and destroyed gates while preserving orders', () => {
    const nav = new TownLayeredNavigation(EMPTY_LAYOUT, () => true), entries = nav.siegeEntrances
    entries.set({ id: 'town-siege-ramp:east:left', gateId: 'east', type: 'siege-ramp', position: new Vector3(190, 8, 62),
      approach: new Vector3(200, 0, 62), exit: new Vector3(145, 8, 62), mounted: true, walkable: true, faction: null, connectionId: 'east-ramp' })
    entries.set({ id: 'town-siege-gate:north', gateId: 'north', type: 'gate', position: new Vector3(199, 0, 62),
      approach: new Vector3(199, 0, 62), exit: new Vector3(195, 0, 62), mounted: true, walkable: true, faction: null, connectionId: 'north-gate' })
    const roles = new Map<string, TownSiegeAttackerRole>([['east:gate-cavalry', 'gate-cavalry'], ['east:ranged', 'ranged'], ['east:air', 'air']])
    const actors = [...roles].map(([id, role]) => attacker(id, role))
    const h = townSiege({ sectors: [{ gateId: 'east', wallActorIds: [], cavalryActorIds: [], attackerActorIds: [...roles.keys()] }],
      attackerRole: npc => roles.get(npc.combatantId)!, navigation: { townNav: nav, areConnected: () => true, sync: () => false } })
    const gate = h.world.gates.get('east')!
    const route = () => { for (const actor of actors) h.siege.resumeExternalMovement(asNpc(actor)) }
    route()
    expect(actors.map(npc => npc.campaignEntranceId)).toEqual([null, null, null])
    expect(actors.map(npc => npc.siegeObstacle)).toEqual([gate.siegeObstacle, null, null])
    expect(actors.map(npc => npc.tacticalOrder)).toEqual(['attack', 'attack', 'attack'])
    gate.destroy()
    entries.set({ id: 'town-siege-gate:east', gateId: 'east', type: 'gate', position: new Vector3(180, 0, 62),
      approach: new Vector3(180, 0, 62), exit: new Vector3(176, 0, 62), mounted: true, walkable: true, faction: null, connectionId: 'east-gate' })
    route()
    expect(actors.map(npc => npc.campaignEntranceId)).toEqual(['town-siege-gate:east', null, null])
    expect(actors.map(npc => npc.siegeObstacle)).toEqual([null, null, null])
    expect(actors.map(npc => npc.tacticalOrder)).toEqual(['charge', 'attack', 'attack'])
  })

  it('retains actual ranged portal ownership until its body clears despite an inside lateral target', () => {
    const nav = new TownLayeredNavigation(EMPTY_LAYOUT, () => true)
    nav.siegeActive = true
    const gateId = 'town-siege-gate:east', id = 'east:ranged-crossing'
    nav.siegeEntrances.set({ id: gateId, gateId: 'east', type: 'gate', position: new Vector3(150, 0, 45),
      approach: new Vector3(155, 0, 45), exit: new Vector3(145, 0, 45), portal: { halfWidth: 7, halfDepth: 1.2 },
      mounted: true, walkable: true, faction: null, connectionId: 'east' })
    const lane = 45 - gateBreachLane(id, false, 7), goal = new Vector3(130, 0, 90), out = new Vector3()
    const npc = attacker(id, 'ranged', 149, lane)
    npc.siegeObstacle = {}
    const { siege } = townSiege({ sectors: [{ gateId: 'east', wallActorIds: [], cavalryActorIds: [], attackerActorIds: [id] }],
      attackerRole: () => 'ranged', navigation: { townNav: nav, areConnected: () => true, sync: () => false } })
    const route = () => siege.resumeExternalMovement(asNpc(npc))
    // The live ranged caller starts with no preferred entrance, as in the reported bug.
    route()
    expect(npc.campaignEntranceId).toBe(gateId)
    expect(nav.resolveMoveTarget(npc.combatPosition, goal, out, npc.campaignEntranceId, false, 'east', id)).toEqual({ ground: true })
    expect(out.toArray()).toEqual([145, 0, lane])
    // Between topology updates navigation must infer the same physical owner itself.
    expect(nav.resolveMoveTarget(npc.combatPosition, goal, out, null, false, 'east', id)).toEqual({ ground: true })
    expect(out.toArray()).toEqual([145, 0, lane])
    expect(nav.resolveMoveTarget(npc.combatPosition, goal, out, null, false, null, id)).toBeNull()
    expect(nav.resolveMoveTarget(npc.combatPosition, new Vector3(170, 0, 90), out, null, false, 'east', id)).toBeNull()
    expect(npc.tacticalOrder).toBe('attack'); expect(npc.siegeObstacle).toBeNull()
    npc.combatPosition.x = 148.1
    expect(nav.hasClearedSiegeGate(npc.combatPosition, gateId, false)).toBe(true)
    route(); expect(npc.campaignEntranceId).toBeNull()
    expect(nav.resolveMoveTarget(npc.combatPosition, goal, out, null, false, 'east', id)).toBeNull()
    npc.combatPosition.set(149, 0, 90) // Near the wall plane but outside the gate aperture.
    route(); expect(npc.campaignEntranceId).toBeNull()
    expect(nav.resolveMoveTarget(npc.combatPosition, goal, out, null, false, 'east', id)).toBeNull()
    npc.combatPosition.set(130, 0, lane)
    route(); expect(npc.campaignEntranceId).toBeNull()
  })
  it('admits only rostered ground attackers to convoy detours and returns gate movement when vehicle front clears', () => {
    const convoy = new SiegeConvoy()
    onTestFinished(() => convoy.dispose())
    const roles = new Map<string, TownSiegeAttackerRole>()
    const unit = (id: string) => new ActorDouble(id, { faction: Faction.ENEMY, characterFaction: 'viking' })
    const npc = unit('north:attacker'), defender = unit('north:defender'), ambient = unit('ambient')
    const personal = Object.assign(unit('personal'), { combatOwnership: 'player-personal' as const })
    const h = preparedTownSiege({ sectors: [{ gateId: 'north', wallActorIds: [defender.combatantId], cavalryActorIds: [], attackerActorIds: [npc.combatantId] }],
      actors: () => [npc, defender, ambient, personal].map(asNpc), attackerRole: actor => roles.get(actor.combatantId) ?? 'siege-infantry' })
    onTestFinished(() => h.siege.dispose())
    h.siege.register(asNpc(npc)); h.siege.register(asNpc(defender))
    // Every body stands on the north-left vehicle's lane, just behind its moving front.
    const ramp = h.ramps.get('town-siege-ramp:north:left')!, dx = ramp.placement.dirX ?? 0, dz = ramp.placement.dirZ
    const lane = new Vector3(ramp.position.x - dx * 5, 0, ramp.position.z - dz * 5)
    for (const actor of [npc, defender, ambient, personal]) actor.group.position.copy(lane)
    const detour = () => npc.siegeBypassTarget && Math.hypot(npc.siegeBypassTarget.x - lane.x, npc.siegeBypassTarget.z - lane.z)
    h.siege.update(.1)
    expect(detour()).toBeCloseTo(6.5)
    expect([defender.siegeBypassTarget, ambient.siegeBypassTarget, personal.siegeBypassTarget]).toEqual([null, null, null])
    npc.mount = Object.assign(new MountDouble('xongkoro'), { isFlyingMount: true })
    h.siege.update(.1); expect(npc.siegeBypassTarget).toBeNull()
    h.siege.update(.1); expect(npc.siegeBypassTarget).toBeNull()
    npc.mount = null
    h.siege.update(.1); expect(detour()).toBeCloseTo(6.5)
    roles.set(npc.combatantId, 'air')
    h.siege.update(.1); expect(npc.siegeBypassTarget).toBeNull()

    // Mounted attacker clears vehicle front
    const detourRamp = { position: new Vector3(), placement: { dirX: 0, dirZ: 1 }, controller: { state: 'PUSHING' },
      surface: { startX: 0, startZ: -30, halfWidth: 2.5 } }
    // Narrow data adapter for the convoy owner alone; no actor or vehicle constructors.
    const detours = convoy as unknown as { update(actor: { combatPosition: Vector3; isMounted: boolean; siegeBypassTarget: Vector3 | null }, ramps: readonly typeof detourRamp[]): void }
    const mountedNpc = { combatPosition: new Vector3(0, 0, 2), isMounted: true, siegeBypassTarget: null as Vector3 | null }
    detours.update(mountedNpc, [detourRamp])
    expect(mountedNpc.siegeBypassTarget).toBeNull()
    mountedNpc.combatPosition.z = -5
    detours.update(mountedNpc, [detourRamp])
    expect(mountedNpc.siegeBypassTarget).toEqual(new Vector3(6.5, 0, -5))
    mountedNpc.combatPosition.set(6.5, 0, 1.49)
    detours.update(mountedNpc, [detourRamp])
    expect(mountedNpc.siegeBypassTarget).not.toBeNull()
    mountedNpc.combatPosition.z = 1.5
    detours.update(mountedNpc, [detourRamp])
    expect(mountedNpc.siegeBypassTarget).toBeNull()

  })
})

it('四門騎兵先攔截本區城外敵人，清除後恢復攻門，突破後才追擊牆上及其他區域', () => {
  const entries = new AvailableBreachEntrances(), town = new TownLayeredNavigation(getTownRampartLayout(), () => true)
  const actor = {
    combatantId: 'east:rider', dead: false, siegeTransport: null, tacticalOrder: 'charge', hasFormationTarget: false,
    campaignBreachCompleted: false, campaignEntranceId: null as string | null, characterFaction: 'viking',
    aiType: AIType.MELEE, combatPosition: new Vector3(180, 0, 62), isMounted: true, mount: { isFlyingMount: false },
    combatTargetPriority: undefined as NPC['combatTargetPriority'], assignedSiegeObstacle: null as unknown,
    faction: Faction.ENEMY, targetsPlayer: false, missionCombatTarget: undefined,
    isTownRampartGarrisonActive: false, holdsRampartPosition: false, hasActiveRangedWeapon: false,
    hasSiegeObstacle: true, _pursuitTargetAllowed: NPC.prototype['_pursuitTargetAllowed'], pursuitBlockedTargets: new PursuitBlockList<NPC>(),
    priorityCombatTarget: null as unknown, get hasTacticalCombatPriority() {
      return Object.getOwnPropertyDescriptor(NPC.prototype, 'hasTacticalCombatPriority')!.get!.call(this)
    }, _isAttackableObstacle: NPC.prototype['_isAttackableObstacle'],
    assignSiegeObstacle(target: unknown) { this.assignedSiegeObstacle = target }, setTacticalOrder() {},
  }
  const roles = { attackerRole: (): TownSiegeAttackerRole => 'gate-cavalry' }
  let connected = true
  const { siege, world } = townSiege({ sectors: [{ gateId: 'east', wallActorIds: [], cavalryActorIds: [], attackerActorIds: [actor.combatantId] }],
    ...roles, navigation: { townNav: town, areConnected: () => connected, sync: () => false } })
  const eastGate = world.gates.get('east')!
  const route = () => siege.resumeExternalMovement(actor as unknown as NPC)
  const target = (x: number, y: number, z: number) => ({ combatPosition: new Vector3(x, y, z), dead: false, faction: Faction.PLAYER }) as NPC
  const ground = target(186, getTerrainHeight(186, 62), 62), wall = target(148, townRampartHeight(town.layout, 148, 62)!, 62), remote = target(-180, 0, 30)
  // A docked same-gate ramp must not replace the closed-gate task.
  entries.set({ id: 'east:ramp', gateId: 'east', type: 'siege-ramp', position: wall.combatPosition,
    approach: ground.combatPosition, exit: wall.combatPosition, walkable: true, mounted: true, faction: null, connectionId: 'east' })
  town.siegeEntrances.set(entries.entries.get('east:ramp')!)
  route()
  expect(actor.campaignEntranceId).toBeNull()
  expect(actor.assignedSiegeObstacle).toBe(eastGate.siegeObstacle)
  expect(actor.combatTargetPriority!(ground)).toBe(0)
  expect(actor.combatTargetPriority!(wall)).toBeNull()
  expect(actor.combatTargetPriority!(remote)).toBeNull()
  const hasObstacle = () => Object.getOwnPropertyDescriptor(NPC.prototype, 'hasSiegeObstacle')!.get!.call(actor)
  actor.priorityCombatTarget = ground
  expect(hasObstacle()).toBe(false)
  const grid = new SpatialGrid<NPC>(20)
  grid.insert(wall); grid.insert(remote); grid.insert(ground)
  const acquire = () => NPC.prototype['_findTarget'].call(actor as unknown as NPC, { dead: true, targetable: false } as Player, [], grid)
  expect(acquire()?.npc).toBe(ground)
  Object.assign(ground, { dead: true })
  expect(acquire()).toBeNull()
  expect(hasObstacle()).toBe(true)
  eastGate.destroy()
  route()
  expect(actor.combatTargetPriority!(wall)).toBe(1)
  expect(actor.combatTargetPriority!(remote)).toBe(2)
  expect(acquire()?.npc).toBe(wall)
  actor.combatPosition.copy(wall.combatPosition)
  expect(actor.combatTargetPriority!(wall)).toBe(0)
  // A target walking down to the ground must remain interceptable. The ground
  // component beneath a wall cannot decide whether its docked descent is legal.
  Object.assign(ground, { dead: false })
  connected = false
  expect(actor.combatTargetPriority!(ground)).toBe(0)
})

it('攔截相鄰 sector 眼前可達的地面敵人，超出固定分界帶後恢復原北門任務', () => {
  let connected = true
  const town = new TownLayeredNavigation(EMPTY_LAYOUT, () => true)
  town.siegeEntrances.set({ id: 'east:open', gateId: 'east', type: 'gate', position: new Vector3(150, 0, 45),
    approach: new Vector3(162, 0, 45), exit: new Vector3(138, 0, 45), mounted: true, walkable: true, faction: null, connectionId: 'east' })
  const rider = {
    combatantId: 'north:rider', dead: false, siegeTransport: null, tacticalOrder: 'charge', hasFormationTarget: false,
    campaignBreachCompleted: false, campaignEntranceId: null as string | null, townSiegeGateId: 'north',
    characterFaction: 'viking', aiType: AIType.MELEE, isMounted: true, mount: { isFlyingMount: false },
    combatPosition: new Vector3(184, getTerrainHeight(184, -140), -140),
    combatTargetPriority: undefined as NPC['combatTargetPriority'], priorityCombatTarget: null as NPC | null,
    assignedSiegeObstacle: null as unknown, _isAttackableObstacle: NPC.prototype['_isAttackableObstacle'],
    get hasTacticalCombatPriority() { return Object.getOwnPropertyDescriptor(NPC.prototype, 'hasTacticalCombatPriority')!.get!.call(this) },
    assignSiegeObstacle(obstacle: unknown) { this.assignedSiegeObstacle = obstacle }, setTacticalOrder() {},
  }
  const { siege, world } = townSiege({ sectors: [{ gateId: 'north', wallActorIds: [], cavalryActorIds: [], attackerActorIds: [rider.combatantId] }],
    attackerRole: () => 'gate-cavalry', navigation: { townNav: town, areConnected: () => connected, sync: () => false } })
  const gate = world.gates.get('north')!
  const target = { dead: false, combatPosition: new Vector3(190, getTerrainHeight(190, -140), -140) } as NPC
  siege.resumeExternalMovement(rider as unknown as NPC)
  expect(rider.combatTargetPriority!(target)).toBe(0)
  rider.priorityCombatTarget = target
  const hasGateTask = () => Object.getOwnPropertyDescriptor(NPC.prototype, 'hasSiegeObstacle')!.get!.call(rider)
  expect(hasGateTask()).toBe(false)
  connected = false
  expect(rider.combatTargetPriority!(target)).toBeNull()
  connected = true
  // Still only 12m away, but the target has left the fixed 24m sector overlap.
  rider.combatPosition.set(218, getTerrainHeight(218, -140), -140)
  target.combatPosition.set(230, getTerrainHeight(230, -140), -140)
  expect(rider.combatTargetPriority!(target)).toBeNull()
  expect(hasGateTask()).toBe(true)
  expect(rider.assignedSiegeObstacle).toBe(gate.siegeObstacle)
  expect(rider.campaignEntranceId).toBeNull()
  expect(rider.townSiegeGateId).toBe('north')
})
