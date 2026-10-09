import { MountType } from '../../src/world/Mount'
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TownScene } from '../../src/town/TownScene'
import { TownOutskirtsWarfareController } from '../../src/town/TownOutskirtsWarfareController'
import { outskirtsSquadSpecs } from '../../src/town/TownOutskirtsRules'
import { BanditMissionController } from '../../src/career/BanditMissionController'
import { PersonalSquadRuntime, spawnPersonalSquadActor } from '../../src/career/PersonalSquadRuntime'
import { EaglePadReservations } from '../../src/career/EaglePadReservations'
import { snapshotPersonalMission } from '../../src/career/CareerPersonalSquadMission'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { createActiveCareerMission } from '../../src/career/CareerMissionState'
import { careerTownSceneRoster, resolveCareerTownSceneContext } from '../../src/career/CareerFieldSceneContext'
import { createEmptyArmyConfig } from '../../src/battle/BattleConfig'
import { BattleSpawner } from '../../src/battle/BattleSpawner'
import { createDefenseCampaignWaveConfig } from '../../src/campaign/DefenseCampaignLaunch'
import { createCareerOutpostLaunch } from '../../src/career/CareerOutpostLaunch'
import { acceptCareerOutpost } from '../../src/career/CareerOutpostMission'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { AIType, Faction, NPC } from '../../src/world/NPC'
import type { Player } from '../../src/player/Player'
import { gameplayNpcSpawns } from '../../src/world/NpcSpawnScheduler'
import { TownEvent } from '../../src/town/TownRules'
import { resolveTownHRLayout, townConquestRoster } from '../../src/town/TownHRLayout'
import { advanceNpcFrame, gameplayNpcSpawnDriver } from '../helpers/npcSpawnFrames'
import { createGameTestFixture } from '../helpers/gameFixture'

import { recording, resetSpawnRecording } from '../helpers/npcSpawnRecording'

vi.mock('../../src/world/NPC', async original => ({
  ...(await original<typeof import('../../src/world/NPC')>()),
  NPC: (await import('../helpers/npcSpawnRecording')).RecordingNpc,
}))
vi.mock('../../src/world/Mount', async original => ({
  ...(await original<typeof import('../../src/world/Mount')>()),
  Mount: (await import('../helpers/npcSpawnRecording')).RecordingMount,
}))
vi.mock('../../src/world/WeaponPickup', () => ({ WeaponPickup: class { dispose() {} } }))
vi.mock('../../src/career/MissionGuide', () => ({ MissionGuide: class { hide() {} dispose() {} } }))
const dispose: (() => void)[] = []
afterEach(() => {
  dispose.splice(0).reverse().forEach(fn => fn())
  expect(gameplayNpcSpawns.pending).toBe(0)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  resetSpawnRecording()
})

function gameFixture() {
  const game = createGameTestFixture({
    spawnBatches: [] as Array<import('../../src/world/NpcSpawnScheduler').NpcSpawnBatch>, scene: new THREE.Scene(), npcs: [] as NPC[], mounts: [] as unknown[], pickups: [] as unknown[],
    combatEvents: { emit: vi.fn() }, _showNotify: vi.fn(), battleStats: { registerNpc: vi.fn() },
    _aimTargetRegistry: { registerNpc: vi.fn(), registerMount: vi.fn(), unregisterNpc: vi.fn(), unregisterMount: vi.fn() },
    careerVeteranActorMounts: new Map(), defenseCampaignConfig: null,
  })
  dispose.push(() => game._disposeCareerOutpostBattleActors())
  return game
}
function smallArmyPlan() {
  return BattleSpawner.createSpawnPlan({
    viking: { ...createEmptyArmyConfig(), infantry: { 1: 1, 2: 0, 3: 0 } },
    roman: { ...createEmptyArmyConfig(), cavalry: { 1: 0, 2: 2, 3: 0 } },
    playerFaction: 'roman', rules: { includeCamps: false, respawnEnabled: false },
  })
}
function playerFixture() {
  const group = new THREE.Group()
  return { group, dead: false, get combatPosition() { return group.position } } as Player
}
function missionWorld(spawnPoints: THREE.Vector3[]): ConstructorParameters<typeof BanditMissionController>[1] {
  // Enqueue-only world boundary: these callers consume camp spawn points and obstacles, not Town geometry.
  return { camps: spawnPoints.map(point => ({ spawnPoints: [point] })), obstacles: [] } as unknown as
    ConstructorParameters<typeof BanditMissionController>[1]
}
function loadingFrames(verifySharedBudget = false) {
  const callbacks: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.push(callback); return callbacks.length })
  return async () => {
    const before = recording.npcs.length, frame = advanceNpcFrame(gameplayNpcSpawnDriver)
    for (const callback of callbacks.splice(0)) callback(frame)
    await Promise.resolve(); await Promise.resolve()
    gameplayNpcSpawns.tick(frame)
    if (verifySharedBudget) expect(recording.npcs.length - before).toBeLessThanOrEqual(1)
    return frame
  }
}

describe('production spawn callers with recorded constructor boundaries', () => {
  it('registers a small initial army and its mounts before resolving loading', async () => {
    const game = gameFixture(), step = loadingFrames()
    const plan = smallArmyPlan()
    let ready = false
    const loading = game._executeBattleSpawnPlan(plan).then((actors: NPC[]) => { ready = true; return actors })
    expect(recording.npcs.map(npc => npc.combatantId)).toHaveLength(0); expect(ready).toBe(false)
    expect(plan.npcSpecs).toHaveLength(3)
    expect(game.spawnBatches[0].actors.size).toBe(3)
    await step(); await step()
    expect(game.npcs).toHaveLength(2)
    expect(ready).toBe(false)
    await step()
    const actors = await loading
    expect(actors).toBeDefined(); expect(actors).toHaveLength(plan.npcSpecs.length)
    expect(game.npcs).toEqual(actors); expect(game.battleStats.registerNpc).toHaveBeenCalledTimes(actors.length)
    expect(game._aimTargetRegistry.registerNpc).toHaveBeenCalledTimes(3)
    expect(game._aimTargetRegistry.registerMount).toHaveBeenCalledTimes(2)
    expect(recording.npcs.filter(npc => npc.mountedInput)).toHaveLength(2)
    for (const npc of recording.npcs.filter(npc => npc.mountedInput)) {
      expect(npc.mountVehicle).toHaveBeenCalledWith(npc.mount)
      expect(game.mounts).toContain(npc.mount)
    }
  })

  it('wires a Campaign initial plan to its army, rider/mount registration and loading readiness', async () => {
    const game = gameFixture(), step = loadingFrames()
    const launch = createCareerOutpostLaunch(acceptCareerOutpost({ ...createCareerProfile('roman'), rank: 'soldier', totalMerit: 300, availableMerit: 300 }, 1, 'initial-campaign')!)
    const plan = BattleSpawner.createSpawnPlan(createDefenseCampaignWaveConfig(launch, 'defenders'))
    let ready = false
    const loading = game._executeBattleSpawnPlan(plan).then((actors: NPC[]) => { ready = true; return actors })
    expect(recording.npcs.map(npc => npc.combatantId)).toHaveLength(0)
    expect(ready).toBe(false)
    await step()
    expect(game.npcs).toHaveLength(1)
    expect(ready).toBe(false)
    // Same _executeBattleSpawnPlan protocol as custom; retain this plan's first/final readiness boundaries.
    for (let frame = 1; frame < plan.npcSpecs.length - 1; frame++) await step()
    expect(game.npcs).toHaveLength(plan.npcSpecs.length - 1)
    expect(ready).toBe(false)
    await step()
    const actors = await loading
    expect(ready).toBe(true)
    expect(recording.npcs.map(npc => npc.combatantId)).toHaveLength(plan.npcSpecs.length)
    expect(actors).toBeDefined()
    expect(actors).toHaveLength(plan.npcSpecs.length)
    expect(game.npcs).toEqual(actors)
    expect(game.battleStats.registerNpc).toHaveBeenCalledTimes(actors.length)
    actors.forEach((npc, index) => {
      const spec = plan.npcSpecs[index]
      expect(npc.faction).toBe(Faction.PLAYER)
      expect(npc.characterFaction).toBe('roman')
      expect(npc.name).toBe(spec.name)
      expect(npc.tier).toBe(spec.tier)
      expect(npc.isMounted).toBe(spec.cavalry)
      if (npc.isMounted && npc.mount) expect(npc.mount.riderNpc).toBe(npc)
    })
  })

  it('queues Town resident identities and completes registration before its loading promise resolves', async () => {
    const step = loadingFrames(), profile = createCareerProfile('roman')
    const population = townConquestRoster(resolveTownHRLayout(profile.faction, [], []))
    const roster = careerTownSceneRoster(profile, population), event = new TownEvent(population)
    event.hostile = true
    event.register('cat', { dead: true })
    const town = Object.assign(Object.create(TownScene.prototype), {
      scene: new THREE.Scene(), residents: [], mounts: [], cat: {}, serviceMarkers: new Map(),
      event, world: { addServiceMarker: vi.fn(), addTarget: () => new THREE.Vector3() },
    }) as any
    dispose.push(() => { town.residentSpawnBatch?.cancel(); town.residents.forEach((r: any) => r.npc.dispose()); town.mounts.forEach((mount: any) => mount.dispose()) })
    const progress = vi.fn(); let ready = false
    const loading = town.initializeResidents(roster, resolveCareerTownSceneContext(profile), progress).then(() => { ready = true })
    expect(recording.npcs.map(npc => npc.combatantId)).toHaveLength(0)
    await step()
    expect(recording.npcs.map(npc => npc.combatantId)).toHaveLength(1)
    expect(town.residents).toHaveLength(1)
    expect(ready).toBe(false)
    for (let frame = 1; frame < roster.length - 1; frame++) await step()
    expect(town.residents).toHaveLength(roster.length - 1)
    town.residents.forEach((resident: any) => { resident.npc.dead = true })
    expect(event.evaluate(false)).toBeNull()
    expect(ready).toBe(false)
    await step()
    await loading
    expect(ready).toBe(true)
    expect(recording.npcs.map(npc => npc.combatantId)).toHaveLength(roster.length)
    town.residents.forEach((resident: any) => { resident.npc.dead = true })
    expect(town.residents).toHaveLength(roster.length)
    expect(progress).toHaveBeenLastCalledWith(`建立駐軍與居民 ${roster.length} / ${roster.length}…`)
    expect(event.actors.size).toBe(population.length)
    expect(event.actors.get('hr-officer')).toBe(town.residents.find((resident: any) => resident.spec.id === 'hr-officer').npc)
    const eagleRiders = recording.npcs.filter(npc => npc.combatantId.startsWith('town-eagle-rider:'))
    const eagles = recording.mounts.filter(mount => mount.type === MountType.XONGKORO)
    expect(eagleRiders.map(npc => npc.combatantId)).toEqual([1, 2, 3, 4, 5].map(slot => `town-eagle-rider:${slot}`))
    expect(eagles.map(mount => mount.group.name)).toEqual([1, 2, 3, 4, 5].map(slot => `town-eagle-mount:${slot}`))
    for (const npc of eagleRiders) {
      expect(npc).toMatchObject({ tier: 3, presetId: 'roman_archer', loadout: { rangedWeaponId: 'elven_runebow' } })
      expect(npc.mountVehicle).not.toHaveBeenCalled()
    }
    event.complete(); expect(event.evaluate(false)).toBe('town_defeated')
  })

  it('rejects an HR registration failure without opening conquest settlement', async () => {
    const step = loadingFrames(), profile = createCareerProfile('roman')
    const population = townConquestRoster(resolveTownHRLayout(profile.faction, [], []))
    const roster = careerTownSceneRoster(profile, population), event = new TownEvent(population)
    event.hostile = true; event.register('cat', { dead: true })
    const register = event.register.bind(event)
    vi.spyOn(event, 'register').mockImplementation((id, actor) => {
      if (id === 'hr-officer') throw new Error('HR registration failed')
      register(id, actor)
    })
    const town = Object.assign(Object.create(TownScene.prototype), {
      scene: new THREE.Scene(), residents: [], mounts: [], cat: {}, serviceMarkers: new Map(),
      event, world: { addServiceMarker: vi.fn(), addTarget: () => new THREE.Vector3() },
    }) as any
    dispose.push(() => { town.residentSpawnBatch?.cancel(); town.residents.forEach((r: any) => r.npc.dispose()); town.mounts.forEach((mount: any) => mount.dispose()) })
    const loading = town.initializeResidents(roster, resolveCareerTownSceneContext(profile), () => {})
    const rejected = expect(loading).rejects.toThrow('HR registration failed')
    for (let i = 0; i < roster.length; i++) await step()
    await rejected
    town.residents.forEach((resident: any) => { resident.npc.dead = true })
    expect(town.residentSpawnBatch.status).toBe('failed')
    expect(town.residents).toHaveLength(0); expect(town.mounts).toHaveLength(0)
    expect(recording.npcs.every(npc => npc.dispose.mock.calls.length === 1)).toBe(true)
    expect(recording.mounts.every(mount => mount.dispose.mock.calls.length === 1)).toBe(true)
    expect(event.registrationComplete).toBe(false); expect(event.evaluate(false)).toBeNull()
    expect(() => event.complete()).toThrow('hr-officer')
  })

  it('cancels an in-flight loading owner before another owner can materialize and rolls back failed registrations', async () => {
    const step = loadingFrames(), game = gameFixture()
    game._aimTargetRegistry.unregisterNpc = vi.fn(); game._aimTargetRegistry.unregisterMount = vi.fn()
    const plan = smallArmyPlan()
    const loading = game._executeBattleSpawnPlan(plan)
    await step(); expect(game.npcs).toHaveLength(1)
    game._disposeCareerOutpostBattleActors()
    await step(); await expect(loading).rejects.toThrow('cancelled')
    expect(recording.npcs.map(npc => npc.combatantId)).toHaveLength(1)
    expect(game.npcs).toHaveLength(0); expect(game._aimTargetRegistry.unregisterNpc).toHaveBeenCalledOnce()
    const failed = gameFixture()
    failed._aimTargetRegistry.unregisterNpc = vi.fn()
    failed._aimTargetRegistry.registerNpc.mockImplementation(() => { throw new Error('registration') })
    const failing = failed._executeBattleSpawnPlan(plan)
    await step(); await expect(failing).rejects.toThrow('registration')
    expect(failed.spawnBatches[0].status).toBe('failed'); expect(failed.npcs).toHaveLength(0)
    expect(failed.scene.children).toHaveLength(0)
    expect(failed._aimTargetRegistry.unregisterNpc).toHaveBeenCalledOnce()
    const before = recording.npcs.length; await step(); expect(recording.npcs.map(npc => npc.combatantId)).toHaveLength(before)
  })

  it('shares the production default frame budget across Bandit, Personal, Outskirts and Game loading', async () => {
    const templateId = 'recruit-bandits-01', enemyCount = 3
    const scene = new THREE.Scene(), navigation = new NavigationWorld(), player = playerFixture(), step = loadingFrames(true)
    const profile = { ...createCareerProfile('roman'), rank: 'captain' as const,
      personalSquad: { members: Array.from({ length: 2 }, (_, i) => ({ id: `personal:shared-${i}`, type: 'soldier' as const })) } }
    const personal = new PersonalSquadRuntime(scene, Array.from({ length: 2 }, (_, i) => ({ x: i * 5, z: -30, yaw: 0 })), () => profile, () => player)
    personal.follow()
    const missionProfile = { ...createCareerProfile('roman'), activeMission: createActiveCareerMission(templateId, 0, enemyCount, 0, 'shared-mission') }
    const world = missionWorld([new THREE.Vector3(120, 0, 120)])
    const mission = new BanditMissionController(scene, world, navigation, {} as NPC, [], () => player, () => missionProfile, () => true)
    expect(mission.startActiveMission()).toBe(true)
    const outskirts = new TownOutskirtsWarfareController(scene, 'roman', () => profile, [], navigation)
    const game = gameFixture(), loading = game._executeBattleSpawnPlan({ npcSpecs: [{ x: 0, z: 0, faction: Faction.PLAYER, characterFaction: 'roman', aiType: AIType.MELEE, name: 'loading', tier: 1, cavalry: false, respawnEnabled: false }], pickupSpecs: [], horseSpecs: [], playerSpawn: { x: 0, z: 0 } })
    dispose.push(() => personal.cleanup(), () => mission.dispose(), () => outskirts.dispose())
    expect(recording.npcs.map(npc => npc.combatantId)).toHaveLength(0); expect(mission.ready).toBe(false)
    expect(mission.evaluate(true)).toBeNull()
    for (let frame = 0; frame < 110 && gameplayNpcSpawns.pending; frame++) await step()
    await loading
    expect(personal.actors).toHaveLength(2); expect(mission.missionBandits).toHaveLength(enemyCount)
    expect(outskirts.actors).toHaveLength(60); expect(game.npcs).toHaveLength(1)
    expect(new Set(recording.npcs.map(npc => npc.combatantId)).size).toBe(recording.npcs.length)
  })

  it('publishes Personal members and their mounts before readiness, and cancels pending owner work on cleanup', async () => {
    const scene = new THREE.Scene(), step = loadingFrames(), player = playerFixture()
    const profile = { ...createCareerProfile('roman'), rank: 'captain' as const,
      personalSquad: { members: [
        { id: 'personal:captain', type: 'captain' as const },
        { id: 'personal:soldier', type: 'soldier' as const },
      ] } }
    const registered = vi.fn(), unregistered = vi.fn()
    const runtime = new PersonalSquadRuntime(scene, [{ x: 0, z: 0, yaw: 0 }, { x: 5, z: 0, yaw: 0 }],
      () => profile, () => player, spawnPersonalSquadActor, { onSpawn: registered, onDispose: unregistered })
    dispose.push(() => runtime.cleanup())
    expect(runtime.follow()).toBe(true); expect(runtime.follow()).toBe(true)
    expect(recording.npcs).toHaveLength(0); expect(runtime.ready).toBe(false)
    await step()
    expect(runtime.actors.map(npc => npc.combatantId)).toEqual(['personal:captain'])
    expect(runtime.owns(runtime.actors[0])).toBe(true)
    expect(registered).toHaveBeenLastCalledWith(runtime.actors[0], runtime.mounts[0])
    expect(recording.npcs[0].mountVehicle).toHaveBeenCalledWith(runtime.mounts[0])
    expect(runtime.ready).toBe(false)
    await step()
    expect(runtime.ready).toBe(true)
    expect(runtime.actors.map(npc => npc.combatantId)).toEqual(['personal:captain', 'personal:soldier'])
    expect(registered).toHaveBeenCalledTimes(2)
    runtime.cleanup()
    expect(unregistered).toHaveBeenCalledTimes(2)
    expect(recording.npcs.every(npc => npc.dispose.mock.calls.length === 1)).toBe(true)
    expect(recording.mounts.every(mount => mount.dispose.mock.calls.length === 1)).toBe(true)
    expect(runtime.follow()).toBe(true)
    runtime.cleanup(); await step()
    expect(recording.npcs).toHaveLength(2)
    expect(runtime.actors).toHaveLength(0)
  })

  it('allocates the 21st member an actual private eagle pad without sharing the Player reservation, and releases canceled deployments', async () => {
    // Twenty data-only reserves and one recorded rider/mount; no real actors or TownWorld.
    const scene = new THREE.Scene(), step = loadingFrames(), player = playerFixture()
    const members = Array.from({ length: 20 }, (_, index) => ({ id: `personal:reserve-${index}`, type: 'soldier' as const }))
    const owner = { id: 'personal:eagle-last', type: 'ranger' as const,
      equipment: { melee: null, ranged: null, shield: null, mount: 'xongkoro' as const } }
    const profile = { ...createCareerProfile('roman'), selectedMountId: 'xongkoro' as const,
      personalSquad: { members: [...members, owner] } }
    const pads = new EaglePadReservations([
      { id: 'private-eagle-pad:1', x: 50, z: 50, yaw: 0 },
      { id: 'private-eagle-pad:2', x: 80, z: 50, yaw: 0 },
      { id: 'private-eagle-pad:3', x: 110, z: 50, yaw: 0 },
    ])
    const saved = snapshotPersonalMission(profile, 'town-home')!
    saved.members[owner.id] = { status: 'reserve', order: 'follow' }; saved.pendingMemberIds = [owner.id]
    const runtime = new PersonalSquadRuntime(scene, Array.from({ length: 21 }, (_, i) => ({ x: i * 5, z: -30, yaw: 0 })),
      () => profile, () => player, spawnPersonalSquadActor, { eaglePads: pads })
    dispose.push(() => runtime.cleanup())
    runtime.restoreMission(saved)
    await step()
    expect(runtime.actors.map(actor => actor.combatantId)).toEqual([owner.id])
    expect(pads.get('player')?.id).toBe('private-eagle-pad:1')
    expect(pads.get(owner.id)?.id).toBe('private-eagle-pad:2')
    expect(runtime.actors[0].mount).toBeNull()
    expect(runtime.mounts[0].group.position).toMatchObject({ x: 80, z: 50 })
    expect(runtime.checkpoint()?.members[owner.id].eaglePadId).toBe('private-eagle-pad:2')
    runtime.cleanup()
    expect(pads.get(owner.id)).toBeUndefined(); expect(pads.get('player')?.id).toBe('private-eagle-pad:1')
    runtime.restoreMission(saved); expect(runtime.spawning).toBe(true)
    runtime.cancelPendingSpawns(); await step()
    expect(pads.get(owner.id)).toBeUndefined(); expect(runtime.actors).toHaveLength(0)
  })

  it('fails Personal publication without reporting readiness or retaining a partially registered rider', async () => {
    const scene = new THREE.Scene(), step = loadingFrames(), player = playerFixture()
    const profile = { ...createCareerProfile('roman'), personalSquad: { members: [{ id: 'personal:failed', type: 'captain' as const }] } }
    const runtime = new PersonalSquadRuntime(scene, [{ x: 0, z: 0, yaw: 0 }], () => profile, () => player,
      spawnPersonalSquadActor, { onSpawn: () => { throw new Error('Personal publication failed') } })
    dispose.push(() => runtime.cleanup())
    runtime.follow(); await step()
    expect(runtime.ready).toBe(false)
    expect(runtime.error).toEqual(new Error('Personal publication failed'))
    await expect(runtime.waitForSpawns()).rejects.toThrow('Personal publication failed')
    expect(runtime.actors).toHaveLength(0); expect(runtime.mounts).toHaveLength(0)
    expect(recording.npcs[0].dispose).toHaveBeenCalledOnce()
    expect(recording.mounts[0].dispose).toHaveBeenCalledOnce()
  })

  it('registers an Outskirts replacement squad before its finalizer opens patrol and cancels it on owner disposal', async () => {
    const scene = new THREE.Scene(), step = loadingFrames(), player = playerFixture()
    const profile = { ...createCareerProfile('roman'), rank: 'captain' as const }
    // Legitimate Siege ownership filtering leaves one production cavalry squad to replace.
    const claimed = outskirtsSquadSpecs().filter(spec => spec.id !== 'outskirts:cavalry:a').map(spec => spec.id)
    const runtime = new TownOutskirtsWarfareController(scene, 'roman', () => profile, [], new NavigationWorld(), undefined, claimed)
    dispose.push(() => runtime.dispose())
    const squad = runtime.squads.find(candidate => candidate.id === 'outskirts:cavalry:a')!
    expect([...runtime.batches[0].actors.keys()]).toEqual(Array.from({ length: 10 }, (_, i) => `outskirts:cavalry:a:${i}`))
    expect(recording.npcs).toHaveLength(0); expect(squad.state).toBe('SPAWNING')
    await step()
    runtime.prepareFrame(1000, runtime.actors, player)
    expect(squad.state).toBe('SPAWNING'); expect(squad.generation).toBe(0); expect(squad.leader).toBeNull()
    for (let frame = 1; frame < 9; frame++) await step()
    expect(squad.members).toHaveLength(9); expect(squad.leader).toBeNull(); expect(squad.state).toBe('SPAWNING')
    await step()
    expect(squad.state).toBe('PATROLLING'); expect(squad.leader).toBe(squad.members[0])
    expect(squad.members.every(npc => runtime.owns(npc))).toBe(true)
    expect(recording.npcs.every(npc => npc.mountVehicle.mock.calls.length === 1)).toBe(true)
    recording.npcs.forEach(npc => { npc.dead = true })
    runtime.prepareFrame(0, runtime.actors, player)
    expect(squad.state).toBe('SPAWNING')
    expect([...runtime.batches[0].actors.keys()]).toEqual(Array.from({ length: 10 }, (_, i) => `outskirts:cavalry:a:${i}:wave:1`))
    await step()
    expect(squad.members).toHaveLength(1)
    runtime.dispose(); await step()
    expect(recording.npcs).toHaveLength(11)
    expect(runtime.actors).toHaveLength(0)
    expect(recording.npcs.every(npc => npc.dispose.mock.calls.length === 1)).toBe(true)
    expect(recording.mounts.every(mount => mount.dispose.mock.calls.length === 1)).toBe(true)
  })

  it('queues Patrol target identities at its route encounter and waits for the final target before readiness', async () => {
    const scene = new THREE.Scene(), navigation = new NavigationWorld(), player = playerFixture(), step = loadingFrames()
    const active = createActiveCareerMission('recruit-patrol-01', 0, 4, 0, 'shared-mission')
    const profile = { ...createCareerProfile('roman'), activeMission: active }
    // Only the active camp is needed for this caller's different patrolEncounterPoint input.
    const world = missionWorld([new THREE.Vector3(120, 0, 120)])
    const mission = new BanditMissionController(scene, world, navigation, {} as NPC, [], () => player, () => profile, () => true)
    dispose.push(() => mission.dispose())
    expect(mission.startActiveMission()).toBe(true)
    const batch = mission.spawnBatches.find(candidate => candidate.actors.has('shared-mission:bandit:0'))!
    expect([...batch.actors.keys()]).toEqual([
      'shared-mission:bandit:0', 'shared-mission:bandit:1',
      'shared-mission:bandit:2', 'shared-mission:bandit:3',
    ])
    expect(recording.npcs.map(npc => npc.combatantId)).toHaveLength(0)
    expect(mission.ready).toBe(false)
    expect(mission.evaluate(true)).toBeNull()
    await step()
    expect(mission.missionBandits).toHaveLength(1)
    expect(mission.ready).toBe(false)
    for (let frame = 1; frame < 3; frame++) await step()
    expect(mission.missionBandits).toHaveLength(3)
    expect(mission.ready).toBe(false)
    expect(mission.evaluate(true)).toBeNull()
    await step()
    expect(mission.ready).toBe(true)
    expect(mission.missionBandits.map(npc => npc.combatantId)).toEqual(active.targetActorIds)
    expect(recording.npcs.map(npc => npc.combatantId)).toEqual(active.targetActorIds)
    expect(new Set(recording.npcs.map(npc => npc.combatantId)).size).toBe(4)
    // 'shared-mission' chooses the first South road encounter (15, -75), rather than the camp (120, 120).
    expect(mission.missionBandits[0].combatPosition.x).toBe(15)
    expect(mission.missionBandits[0].combatPosition.z).toBe(-71)
    for (const npc of mission.missionBandits) {
      expect(npc.faction).toBe(Faction.BANDIT)
      expect(npc.characterFaction).toBe('viking')
      expect(Math.hypot(npc.combatPosition.x - 15, npc.combatPosition.z + 75)).toBeLessThanOrEqual(7.4)
    }
  })
})
