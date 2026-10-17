import { Vector3, type Scene } from 'three'
import { describe, expect, it, vi, onTestFinished } from 'vitest'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { TownCavalryPatrolController, type PatrolResident } from '../../src/town/TownCavalryPatrolController'
import { townRoster } from '../../src/town/TownRules'
import type { NPC } from '../../src/world/NPC'
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
import { TownMissionCombat } from '../../src/town/TownMissionCombat'
import { damageNpc } from '../../src/combat/DamageRouter'
import { createPlayerCombatActorRef, type DamageAppliedEvent } from '../../src/combat/CombatAttribution'

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
      hp: 100, get hpRatio() { return this.hp / 100 },
      takeDamage(amount: number) { if (this.dead) return false; this.hp = Math.max(0, this.hp - amount); this.dead = this.hp === 0; return true },
      combatAmmo: 20, shield: { shieldImpactRemaining: 100, shieldImpactMax: 100 },
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
/** Only participant selection/contact inputs; no scene, navigation or actor simulation is constructed. */
function patrolCombat(controller: TownCavalryPatrolController, player: Player, privateActors: NPC[] = []) {
  type Inputs = ConstructorParameters<typeof TownMissionCombat>
  const field = { fieldNpcs: [], ambientBandits: [], friendlies: [], veteranEnemySquads: [] }
  const defense: { phase: Inputs[0]['defense']['phase']; active: undefined; fieldNpcs: NPC[] } = { phase: 'ENGAGING', active: undefined, fieldNpcs: [] }
  const personal: NonNullable<ReturnType<NonNullable<Inputs[1]['personalSquad']>>> = {
    actors: privateActors, mounts: [], state: 'ACTIVE', owns: actor => privateActors.includes(actor),
  }
  // The two exercised owner methods never read the unrelated combat/render ports.
  const combat = new TownMissionCombat({ field, defense } as unknown as Inputs[0], {
    patrol: () => controller, player: () => player, personalSquad: () => personal,
  } as unknown as Inputs[1])
  return { combat, defense, personal, prepare: () => combat['preparePatrolCombatFrame'](1, undefined) }
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
  it('keeps the complete borrowed roster under mission ownership until explicit return', () => {
    const { actors, controller } = patrol(20), ids = actors.map(actor => actor.combatantId)
    expect(controller.selectAvailableSquad()?.actorIds).toEqual(ids)
    expect(controller.relinquishSquad(ids)).toBe(true)
    expect(controller.selectAvailableSquad()).toBeNull()
    expect(actors.every(actor => !controller.owns(actor as unknown as NPC))).toBe(true)
    for (const actor of actors) expect(actor.clearEncounter).toHaveBeenCalledOnce()
    for (const actor of actors) { actor.dead = true; actor.hp = 0 }
    controller.beginFrame(new Set(), 60)
    expect(controller.squads[0].respawnRemaining).toBeUndefined()
    expect(controller.returnSquad(ids)).toBe(true)
    for (const actor of actors) expect(actor.restoreForTown).toHaveBeenCalledOnce()
  })

  it('resumes A’s remaining wipe cooldown after reload, leaves B available and restarts A once at 60 seconds', () => {
    const a = patrol(20), b = patrol(20, 'B')
    const controller = new TownCavalryPatrolController([...a.residents, ...b.residents])
    for (const actor of a.actors) { actor.dead = true; actor.hp = 0 }
    controller.beginFrame(new Set(), 0)
    expect(controller.squads[0].respawnRemaining).toBe(60)
    expect(controller.selectAvailableSquad()?.patrolId).toBe('B')
    controller.beginFrame(new Set(), 25)
    const profile = createCareerProfile('roman')
    profile.townPatrols = { roman: controller.checkpoint() }
    const store = new CareerProfileStore(new MemoryStorage())
    expect(store.save(profile)).toBe(true)
    const saved = store.load()!.townPatrols!.roman!
    expect(saved.squads.find(squad => squad.id === 'A')?.respawnRemaining).toBe(35)

    const restoredA = patrol(20), restoredB = patrol(20, 'B')
    const reload = new TownCavalryPatrolController([...restoredA.residents, ...restoredB.residents])
    reload.restoreCheckpoint(saved)
    reload.beginFrame(new Set(), 34)
    reload.updateResident(restoredA.residents[0], 0, new Vector3(), [], {} as NavigationWorld)
    expect(reload.squads[0].respawnRemaining).toBe(1)
    expect(restoredA.actors.every(actor => actor.dead)).toBe(true)
    expect(restoredA.actors[0].restoreForTown).not.toHaveBeenCalled()
    expect(reload.selectAvailableSquad()?.patrolId).toBe('B')
    reload.beginFrame(new Set(), 1)
    reload.beginFrame(new Set(), 1)
    expect(reload.squads[0].generation).toBe(1)
    expect(reload.squads[0].state).toBe('BARRACKS')
    for (const actor of restoredA.actors) expect(actor.restoreForTown).toHaveBeenCalledOnce()
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

  it('resumes patrol travel at its saved authored waypoint after profile reload', () => {
    const source = patrol(1), squad = source.controller.squads[0]
    squad.state = 'PATROLLING'; squad.waypoint = 6
    squad.departureIndex = squad.departure.waypoints.length
    const destination = source.controller.route[6]
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
    expect(reload.controller.squads[0].state).toBe('PATROLLING')
    expect(reload.controller.squads[0].waypoint).toBe(6)
    expect(reload.controller.squads[0].departureIndex).toBe(squad.departureIndex)
    expect(reload.actors[0].assignFormationTarget).toHaveBeenCalledWith(-3, destination, expect.any(Vector3), expect.any(Number))
  })

  it('wakes only the hit patrol on real Player contact outside 35m and returns beyond the fixed 58m leash', () => {
    const a = patrol(), b = patrol(1, 'B')
    const controller = new TownCavalryPatrolController([...a.residents, ...b.residents]), squad = controller.squads[0]
    for (const actor of [...a.actors, ...b.actors]) Object.assign(actor, { hostileToPlayer: true, faction: Faction.ENEMY })
    for (const actor of a.actors) actor.combatPosition.set(0, 0, 0)
    b.actors[0].combatPosition.set(-200, 0, 0)
    const position = new Vector3(45, 0, 0), player = { dead: false, combatPosition: position, characterFaction: 'roman', isMounted: false } as Player
    const target = a.residents[0].npc, f = patrolCombat(controller, player)
    controller.beginFrame(new Set())
    f.prepare()
    expect(squad.state).toBe('BARRACKS')
    const event: DamageAppliedEvent = { type: 'damage_applied', source: createPlayerCombatActorRef(player),
      target: { targetId: target.combatantId, targetType: 'npc', name: 'patrol' }, method: 'projectile', requestedDamage: 1, appliedDamage: 0 }
    expect(f.combat.notePlayerContact(target, event)).toBe(false)
    expect(f.combat.notePlayerContact(target, { ...event, method: 'fall', appliedDamage: 1 })).toBe(false)
    f.combat.noteExternalHit(target) // A source-less notification alone is not proof of a Player hit.
    expect(squad.state).toBe('BARRACKS')
    damageNpc(target, 1, { source: event.source, method: 'projectile', emit: contact => f.combat.notePlayerContact(target, contact) })
    expect(squad.state).toBe('ENGAGING')
    expect(f.combat.notePlayerContact(target, { type: 'hit_blocked', source: event.source, target: event.target,
      method: 'projectile', blockedImpact: 1 })).toBe(true)
    expect(controller.squads[1].state).toBe('BARRACKS')
    for (const actor of a.actors) actor.combatPosition.x = -20
    f.prepare()
    expect(squad.state).toBe('ENGAGING')
    position.x = 58
    f.prepare()
    expect(squad.state).toBe('ENGAGING')
    position.x = 58.01
    f.prepare()
    expect(squad.state).toBe('RETURN_TO_BARRACKS')
  })

  it('detects actual HR actors within 35m only after mission preparation permits combat', () => {
    const { actors, controller } = patrol(1), target = actors[0]
    Object.assign(target, { hostileToPlayer: true, faction: Faction.ENEMY })
    target.combatPosition.set(0, 0, 0)
    const hr = { combatantId: 'personal:hr', combatPosition: new Vector3(35, 0, 0), dead: false,
      faction: Faction.PLAYER, combatOwnership: 'player-personal' } as NPC
    const player = { dead: false, combatPosition: new Vector3(200, 0, 0) } as Player
    const f = patrolCombat(controller, player, [hr])
    controller.beginFrame(new Set())
    f.defense.phase = 'PREPARING'; f.prepare()
    expect(controller.squads[0].state).toBe('BARRACKS')
    f.defense.phase = 'ENGAGING'; hr.combatPosition.x = 36; f.prepare()
    expect(controller.squads[0].state).toBe('BARRACKS')
    hr.combatPosition.x = 35; f.prepare()
    expect(controller.squads[0].state).toBe('ENGAGING')
    expect(controller.combatActors).toEqual([target])
  })

  it('wakes the native squad hit by HR outside sensing range and retains it only within its leash', () => {
    const { actors, residents, controller } = patrol(1), target = actors[0]
    Object.assign(target, { hostileToPlayer: true, faction: Faction.ENEMY })
    target.combatPosition.set(0, 0, 0)
    const hr = { combatantId: 'personal:hr', combatPosition: new Vector3(45, 0, 0), dead: false,
      faction: Faction.PLAYER, combatOwnership: 'player-personal' } as NPC
    const player = { dead: false, combatPosition: new Vector3(200, 0, 0) } as Player
    const f = patrolCombat(controller, player, [hr])
    controller.beginFrame(new Set())
    f.combat.noteExternalHit(residents[0].npc, hr)
    expect(controller.squads[0].state).toBe('ENGAGING')
    f.prepare()
    expect(controller.squads[0].state).toBe('ENGAGING')
    hr.combatPosition.x = 58.01; f.prepare()
    expect(controller.squads[0].state).toBe('RETURN_TO_BARRACKS')
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
