import { Vector3, type Scene } from 'three'
import { describe, expect, it, vi, onTestFinished } from 'vitest'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { TownCavalryPatrolController, type PatrolResident } from '../../src/town/TownCavalryPatrolController'
import { townRoster } from '../../src/town/TownRules'
import type { NPC } from '../../src/world/NPC'
import { parseTownPatrolCheckpoint } from '../../src/town/TownPatrolCheckpoint'
import { SpatialGrid } from '../../src/world/SpatialGrid'
import type { Mount } from '../../src/world/Mount'
import { townPatrolRefitPoint } from '../../src/town/TownRules'
import { TownOutskirtsWarfareController, parseTownOutskirtsCheckpoint } from '../../src/town/TownOutskirtsWarfareController'
import { NpcSpawnScheduler } from '../../src/world/NpcSpawnScheduler'
import type { Player } from '../../src/player/Player'
import { Faction } from '../../src/combat/CombatFaction'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { MemoryStorage } from '../helpers/memoryStorage'

/** Spawn jobs remain queued: this fixture never constructs actors, mounts or a render scene. */
function outskirts(townFaction: 'roman' | 'viking') {
  const scheduler = new NpcSpawnScheduler()
  const navigation = new NavigationWorld({ minX: -350, maxX: 350, minZ: -350, maxZ: 350, cellSize: 20 })
  const controller = new TownOutskirtsWarfareController(null as unknown as Scene, townFaction,
    () => ({ rank: 'commander', faction: 'roman' }), [], navigation, undefined, [], scheduler, [], true)
  onTestFinished(() => controller.dispose())
  return controller
}

/** Position/ownership data and recorded commands only: no locomotion or render objects. */
function patrol(count = 2, patrolId: 'A' | 'B' = 'A') {
  const specs = townRoster().filter(spec => spec.patrolId === patrolId)
  const selected = [specs.find(spec => spec.patrolLeader)!, ...specs.filter(spec => !spec.patrolLeader)].slice(0, count)
  const actors = selected.map(spec => {
    const position = new Vector3(spec.x, 0, spec.z)
    const actor = {
      combatantId: spec.id, combatPosition: position, group: { position, rotation: { y: 0 } },
      dead: false, combatOwnership: undefined as NPC['combatOwnership'],
      hp: 100, combatAmmo: 20, shield: { shieldImpactRemaining: 100, shieldImpactMax: 100 },
      tacticalOrder: 'attack' as NPC['tacticalOrder'], isMounted: true,
      mount: null as Mount | null, formationCommandId: null as number | null,
      clearEncounter: vi.fn(), setTownPeaceful: vi.fn(), setTacticalOrder: vi.fn(),
      configureBanditEncounter: vi.fn(), triggerEncounterAlert: vi.fn(),
      assignFormationTarget: vi.fn(), updateTownTravel: vi.fn(),
      updateTownPeace: vi.fn(), setMissionCombatTarget: vi.fn(),
      restoreCombatAmmo: vi.fn(), releaseOutpostRampartGarrison: vi.fn(),
      restoreCombatHealth(hp: number) { this.hp = hp; this.dead = hp === 0 },
      dismountFromMount() { this.mount = null },
      mountVehicle(mount: Mount) { this.mount = mount; mount.riderNpc = this as unknown as NPC },
      restoreForTown: vi.fn(function (this: { dead: boolean; hp: number; combatPosition: Vector3 }, p: { x: number; z: number }) {
        this.dead = false; this.hp = 100; this.combatPosition.set(p.x, 0, p.z)
      }),
    }
    actor.mount = { dead: false, currentHp: 100, maxHp: 100, group: { position, rotation: { y: 0 } }, riderNpc: actor,
      restoreForTown: vi.fn() } as unknown as Mount
    return actor
  })
  // The production interface also has rendering/combat methods this decision never reads.
  const residents: PatrolResident[] = selected.map((spec, i) => ({ spec, npc: actors[i] as unknown as NPC, homeMount: actors[i].mount! }))
  return { actors, residents, controller: new TownCavalryPatrolController(residents) }
}
describe('Town patrol travel and ownership decisions', () => {
  it('advances the final route waypoint to the first when its leader reaches it', () => {
    const { actors, residents, controller } = patrol(1), squad = controller.squads[0]
    squad.state = 'PATROLLING'; squad.waypoint = controller.route.length - 1
    actors[0].combatPosition.copy(controller.route[squad.waypoint])
    controller.beginFrame(new Set())
    controller.updateResident(residents[0], 0, new Vector3(), [], {} as NavigationWorld)
    expect(squad.waypoint).toBe(0)
    expect(actors[0].assignFormationTarget).toHaveBeenCalledWith(-3, controller.route[0], expect.any(Vector3), expect.any(Number))
  })
  it('elects the living mounted deputy after the active captain dies', () => {
    const { actors, controller } = patrol()
    controller.beginFrame(new Set())
    expect(controller.squads[0].activeLeaderActorId).toBe(actors[0].combatantId)
    actors[0].dead = true; controller.beginFrame(new Set())
    expect(controller.squads[0].activeLeaderActorId).toBe(actors[1].combatantId)
  })
  it('keeps a returning resident unavailable until its saved refit enters rejoin', () => {
    const { actors, controller } = patrol(1), id = actors[0].combatantId
    expect(controller.beginMissionReturn(id)).toBe(true)
    expect(controller.returnStateFor(id)).toBe('RETURN_TO_BARRACKS')
    expect(controller.canClaimTownCommand(id)).toBe(false)
    expect(controller.isReserveAvailable(id)).toBe(false)
    controller.restoreMissionReturn(id, 'REJOIN_PATROL')
    expect(controller.canClaimTownCommand(id)).toBe(true)
    expect(controller.isReserveAvailable(id)).toBe(true)
  })
  it('rejects an incomplete takeover without releasing any permanent patrol identity', () => {
    const { actors, controller } = patrol(20)
    expect(controller.relinquishSquad(actors.slice(0, 19).map(actor => actor.combatantId))).toBe(false)
    expect(actors.every(actor => controller.owns(actor as unknown as NPC))).toBe(true)
    for (const actor of actors) expect(actor.clearEncounter).not.toHaveBeenCalled()
  })
  it('releases the complete accepted roster and excludes it from autonomous ownership', () => {
    const { actors, controller } = patrol(20), ids = actors.map(actor => actor.combatantId)
    expect(controller.selectAvailableSquad()?.actorIds).toEqual(ids)
    expect(controller.relinquishSquad(ids)).toBe(true)
    expect(controller.selectAvailableSquad()).toBeNull()
    expect(actors.every(actor => !controller.owns(actor as unknown as NPC))).toBe(true)
    for (const actor of actors) expect(actor.clearEncounter).toHaveBeenCalledOnce()
  })

  it('holds a wiped A for 60 seconds while B remains available, then restarts A only once', () => {
    const a = patrol(20), b = patrol(20, 'B')
    const controller = new TownCavalryPatrolController([...a.residents, ...b.residents])
    for (const actor of a.actors) actor.dead = true
    controller.beginFrame(new Set(), 0)
    expect(controller.squads[0].respawnRemaining).toBe(60)
    expect(controller.selectAvailableSquad()?.patrolId).toBe('B')
    controller.beginFrame(new Set(), 59)
    controller.updateResident(a.residents[0], 0, new Vector3(), [], {} as NavigationWorld)
    expect(a.actors[0].restoreForTown).not.toHaveBeenCalled()
    controller.beginFrame(new Set(), 1)
    controller.beginFrame(new Set(), 1)
    expect(controller.squads[0].generation).toBe(1)
    expect(controller.squads[0].state).toBe('BARRACKS')
    for (const actor of a.actors) expect(actor.restoreForTown).toHaveBeenCalledOnce()
  })

  it('defers an expired wiped squad while the Player rides a surviving native mount, then refits once after release', () => {
    const { actors, residents, controller } = patrol(20), mount = residents[0].homeMount!
    for (const actor of actors) { actor.dead = true; actor.hp = 0 }
    controller.beginFrame(new Set(), 0)
    const player = { dead: false } as Player
    mount.riderNpc = null; mount.riderPlayer = player
    mount.group.position.set(250, 0, -230)
    const borrowedPosition = mount.group.position.clone()
    controller.beginFrame(new Set(), 60)
    controller.beginFrame(new Set(), 1)
    expect(controller.squads[0].respawnRemaining).toBe(0)
    expect(controller.squads[0].generation).toBe(0)
    expect(mount.group.position).toEqual(borrowedPosition)
    expect(mount.riderPlayer).toBe(player)
    expect(mount.restoreForTown).not.toHaveBeenCalled()
    expect(actors.every(actor => actor.dead)).toBe(true)
    mount.riderPlayer = null
    controller.beginFrame(new Set(), 0)
    controller.beginFrame(new Set(), 0)
    expect(controller.squads[0].generation).toBe(1)
    expect(mount.riderNpc).toBe(residents[0].npc)
    expect(mount.restoreForTown).toHaveBeenCalledOnce()
    for (const actor of actors) expect(actor.restoreForTown).toHaveBeenCalledOnce()
  })

  it.each(['PATROLLING', 'MOVING_TO_ROUTE'] as const)('resumes %s at its saved authored waypoint after profile reload', state => {
    const source = patrol(1), squad = source.controller.squads[0]
    squad.state = state; squad.waypoint = 6
    squad.departureIndex = state === 'PATROLLING' ? squad.departure.waypoints.length : 2
    const destination = state === 'PATROLLING' ? source.controller.route[6] : squad.departure.waypoints[2]
    source.actors[0].combatPosition.copy(destination).add(new Vector3(0, 0, -4))
    source.controller.beginFrame(new Set())
    const profile = createCareerProfile('roman')
    profile.townPatrols = { roman: source.controller.checkpoint() }
    const store = new CareerProfileStore(new MemoryStorage())
    expect(store.save(profile)).toBe(true)
    const reload = patrol(1)
    reload.controller.restoreCheckpoint(store.load()!.townPatrols!.roman)
    reload.controller.beginFrame(new Set())
    reload.controller.updateResident(reload.residents[0], 0, new Vector3(), [], {} as NavigationWorld)
    expect(reload.controller.squads[0].state).toBe(state)
    expect(reload.controller.squads[0].waypoint).toBe(6)
    expect(reload.controller.squads[0].departureIndex).toBe(squad.departureIndex)
    expect(reload.actors[0].assignFormationTarget).toHaveBeenCalledWith(-3, destination, expect.any(Vector3), expect.any(Number))
  })

  it('uses a legacy patrol position to resume the nearest route leg without restarting the barracks departure', () => {
    const source = patrol(1)
    source.actors[0].combatPosition.copy(source.controller.route[6])
    const saved = parseTownPatrolCheckpoint(JSON.parse(JSON.stringify(source.controller.checkpoint())))!
    expect(saved.squads[0].travel).toBeUndefined()
    const reload = patrol(1)
    reload.controller.restoreCheckpoint(saved)
    expect(reload.controller.squads[0].state).toBe('PATROLLING')
    expect(reload.controller.squads[0].waypoint).toBe(6)
    expect(reload.controller.squads[0].departureIndex).toBe(reload.controller.squads[0].departure.waypoints.length)
  })

  it('detects the Player at 35m and retains that encounter through the 58m origin leash', () => {
    const { actors, controller } = patrol(1), squad = controller.squads[0]
    Object.assign(actors[0], { hostileToPlayer: true })
    actors[0].combatPosition.set(0, 0, 0)
    const position = new Vector3(36, 0, 0), player = { dead: false, combatPosition: position } as Player
    const grid = new SpatialGrid<NPC>(8), threats = { owns: () => false, player }
    controller.beginFrame(new Set())
    controller.prepareCombatFrame(1, grid, threats)
    expect(squad.state).toBe('BARRACKS')
    position.x = 35
    controller.prepareCombatFrame(1, grid, threats)
    expect(squad.state).toBe('ENGAGING')
    position.x = 45
    actors[0].combatPosition.x = -20 // The fixed origin, rather than the moving rider, owns the leash.
    controller.prepareCombatFrame(1, grid, threats)
    expect(squad.state).toBe('ENGAGING')
    position.x = 58
    controller.prepareCombatFrame(1, grid, threats)
    expect(squad.state).toBe('ENGAGING')
    position.x = 58.01
    controller.prepareCombatFrame(1, grid, threats)
    expect(squad.state).toBe('RETURN_TO_BARRACKS')
  })

  it('preserves the remaining native cooldown across checkpoint JSON and sanitizes invalid timers', () => {
    const original = patrol(20)
    for (const actor of original.actors) { actor.dead = true; actor.hp = 0 }
    original.controller.beginFrame(new Set(), 0)
    original.controller.beginFrame(new Set(), 25)
    const profile = createCareerProfile('roman')
    profile.townPatrols = { roman: original.controller.checkpoint() }
    const store = new CareerProfileStore(new MemoryStorage())
    expect(store.save(profile)).toBe(true)
    const saved = store.load()!.townPatrols!.roman!
    const reload = patrol(20)
    reload.controller.restoreCheckpoint(saved)
    reload.controller.beginFrame(new Set(), 34)
    expect(reload.actors.every(actor => actor.dead)).toBe(true)
    expect(reload.controller.squads[0].respawnRemaining).toBe(1)
    reload.controller.beginFrame(new Set(), 1)
    expect(reload.actors.every(actor => !actor.dead)).toBe(true)
    expect(reload.controller.squads[0].generation).toBe(1)
    expect(parseTownPatrolCheckpoint({ squads: [{ id: 'A', generation: 0, respawnRemaining: 'bad' }] })?.squads[0].respawnRemaining).toBe(60)
  })

  it('holds partial casualties until a survivor actually returns to barracks', () => {
    const { actors, residents, controller } = patrol()
    actors[0].dead = true; actors[0].hp = 0
    const squad = controller.squads[0]
    squad.state = 'ENGAGING'; squad.participants = new Set(actors.map(actor => actor.combatantId))
    squad.engagementOrigin = actors[1].combatPosition.clone()
    controller.beginFrame(new Set(), 0)
    controller.prepareCombatFrame(1, new SpatialGrid<NPC>(8), { owns: () => false })
    controller.updateResident(residents[0], 0, new Vector3(), [], {} as NavigationWorld)
    expect(actors[0].restoreForTown).not.toHaveBeenCalled()
    Object.assign(actors[1], { isFormationTargetReached: () => true })
    controller.updateResident(residents[1], 0, new Vector3(), [], {} as NavigationWorld)
    controller.updateResident(residents[0], 0, new Vector3(), [], {} as NavigationWorld)
    expect(actors[0].restoreForTown).toHaveBeenCalledWith(townPatrolRefitPoint(residents[0].spec))
    expect(squad.respawnRemaining).toBeUndefined()
  })

  it('keeps borrowed casualties under mission ownership and permits explicit mission return', () => {
    const { actors, controller } = patrol(20)
    expect(controller.relinquishSquad(actors.map(actor => actor.combatantId))).toBe(true)
    for (const actor of actors) { actor.dead = true; actor.hp = 0 }
    controller.beginFrame(new Set(), 60)
    expect(controller.squads[0].respawnRemaining).toBeUndefined()
    expect(controller.returnSquad(actors.map(actor => actor.combatantId))).toBe(true)
    for (const actor of actors) expect(actor.restoreForTown).toHaveBeenCalledOnce()
  })

  it('persists friendly outskirts extinction and waits 60 seconds before enqueuing one new edge generation', () => {
    let controller = outskirts('viking')
    controller.restoreCheckpoint({ squads: controller.squads.map(s => ({ id: s.id, generation: 3,
      state: 'RESPAWN_COOLDOWN', respawnRemaining: 60, waypoint: s.waypoint, members: {} })) })
    let cavalry = controller.squads.find(s => s.spec.kind === 'cavalry')!
    cavalry.state = 'PATROLLING'; cavalry.respawnRemaining = undefined
    const survivor = { dead: false, faction: Faction.TOWN, combatPosition: cavalry.route[cavalry.waypoint].clone(),
      group: { rotation: { y: 0 } } }
    cavalry.members = [{ dead: true }, survivor] as NPC[]
    const player = { dead: true } as Player
    controller.prepareFrame(0, [], player)
    expect(cavalry.state).toBe('PATROLLING')
    survivor.dead = true
    controller.prepareFrame(0, [], player)
    controller.prepareFrame(25, [], player)
    const saved = parseTownOutskirtsCheckpoint(JSON.parse(JSON.stringify(controller.cooldownCheckpoint())))!
    expect(saved.squads.find(s => s.id === cavalry.id)?.respawnRemaining).toBe(35)
    controller = outskirts('viking')
    controller.restoreCheckpoint(saved)
    cavalry = controller.squads.find(s => s.id === cavalry.id)!
    controller.prepareFrame(34, [], player)
    expect(cavalry.state).toBe('RESPAWN_COOLDOWN')
    controller.prepareFrame(1, [], player)
    controller.prepareFrame(60, [], player) // Pending jobs cannot be mistaken for an extinct squad.
    expect(cavalry.generation).toBe(4)
    expect(cavalry.state).toBe('SPAWNING')
    const queued = controller.batches.flatMap(batch => [...batch.actors.keys()].filter(id => id.startsWith(cavalry.id)))
    expect(new Set(queued).size).toBe(10)
    expect(queued).toHaveLength(10)
    expect(cavalry.spawnArrivalState).toBe('ENTERING')
  })

  it('leaves unclaimed enemy outskirts generations active during a formal siege', () => {
    const controller = outskirts('roman')
    expect(controller.squads.filter(s => s.spec.kind === 'cavalry').map(s => s.state))
      .toEqual(['SPAWNING', 'SPAWNING', 'SPAWNING'])
    expect(controller.batches.every(batch => batch.status === 'pending')).toBe(true)
  })
})
