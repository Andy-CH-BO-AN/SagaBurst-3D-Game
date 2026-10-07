import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TownScene } from '../../src/town/TownScene'
import { TownOutskirtsWarfareController } from '../../src/town/TownOutskirtsWarfareController'
import { BanditMissionController } from '../../src/career/BanditMissionController'
import { PersonalSquadRuntime } from '../../src/career/PersonalSquadRuntime'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { createActiveCareerMission } from '../../src/career/CareerMissionState'
import { careerTownSceneRoster, resolveCareerTownSceneContext } from '../../src/career/CareerFieldSceneContext'
import { PRESET_50V50 } from '../../src/battle/BattleConfig'
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

// Constructor doubles record the NPC/mount boundary; these are not real actors or locomotion.
// Game/TownScene/mission enqueue, readiness, registration and rollback methods remain production code.
const observed = vi.hoisted(() => ({ constructors: [] as string[] }))
vi.mock('../../src/world/NPC', async original => {
  const actual = await original<typeof import('../../src/world/NPC')>()
  return { ...actual, NPC: class {
    readonly group = new THREE.Group()
    maxHp = 100; hp = 100; encounterState = 'peaceful'; dead = false; respawnEnabled = false; mount: any = null; tacticalOrder = 'defend'
    shield = { shieldImpactRemaining: 100, shieldImpactMax: 100 }
    combatAmmo = 30
    constructor(scene: THREE.Scene, x: number, z: number, readonly faction: Faction,
      readonly characterFaction: string, readonly aiType: AIType, readonly name: string,
      readonly tier: number, _mounted: boolean, _loadout: unknown, readonly presetId?: string,
      readonly squadId?: string | number, readonly combatantId = name) {
      observed.constructors.push(combatantId); this.group.position.set(x, 0, z); scene.add(this.group)
    }
    get combatPosition() { return this.mount?.group.position ?? this.group.position }
    get isMounted() { return Boolean(this.mount) }
    setTownPeaceful() {} configureBanditEncounter() {} clearEncounter() {} triggerEncounterAlert() {}
    setTacticalOrder(order: string) { this.tacticalOrder = order }
    assignFollowTarget() { this.tacticalOrder = 'follow' }
    assignFormationTarget() { this.tacticalOrder = 'formation' }
    mountVehicle(mount: any) { this.mount = mount; mount.riderNpc = this }
    dismountFromMount() { if (this.mount) this.mount.riderNpc = null; this.mount = null }
    restoreCombatHealth(hp: number) { this.hp = hp; this.dead = hp === 0 }
    restoreCombatAmmo(ammo: number) { this.combatAmmo = ammo }
    dispose() { this.dismountFromMount(); this.group.removeFromParent() }
  } }
})
vi.mock('../../src/world/Mount', async original => {
  const actual = await original<typeof import('../../src/world/Mount')>()
  return { ...actual, Mount: class {
    readonly group = new THREE.Group(); riderNpc: unknown; currentHp = 100; maxHp = 100; dead = false
    constructor(scene: THREE.Scene, _type: unknown, x: number, z: number) { this.group.position.set(x, 0, z); scene.add(this.group) }
    dispose() { this.group.removeFromParent() }
  } }
})
vi.mock('../../src/world/WeaponPickup', () => ({ WeaponPickup: class { dispose() {} } }))
vi.mock('../../src/career/MissionGuide', () => ({ MissionGuide: class { hide() {} dispose() {} } }))
const dispose: (() => void)[] = []
afterEach(() => {
  dispose.splice(0).reverse().forEach(fn => fn())
  expect(gameplayNpcSpawns.pending).toBe(0)
  vi.unstubAllGlobals()
  observed.constructors.length = 0
})

function gameFixture() {
  const game = createGameTestFixture({
    spawnBatches: [] as Array<{ status: string }>, scene: new THREE.Scene(), npcs: [] as NPC[], mounts: [] as unknown[], pickups: [] as unknown[],
    combatEvents: { emit: vi.fn() }, _showNotify: vi.fn(), battleStats: { registerNpc: vi.fn() },
    _aimTargetRegistry: { registerNpc: vi.fn(), registerMount: vi.fn(), unregisterNpc: vi.fn(), unregisterMount: vi.fn() },
    careerVeteranActorMounts: new Map(), defenseCampaignConfig: null,
  })
  dispose.push(() => game._disposeCareerOutpostBattleActors())
  return game
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
    const before = observed.constructors.length, frame = advanceNpcFrame(gameplayNpcSpawnDriver)
    for (const callback of callbacks.splice(0)) callback(frame)
    await Promise.resolve(); await Promise.resolve()
    gameplayNpcSpawns.tick(frame)
    if (verifySharedBudget) expect(observed.constructors.length - before).toBeLessThanOrEqual(1)
    return frame
  }
}

describe('production spawn callers with recorded constructor boundaries', () => {
  it('materializes the initial custom army one NPC per frame before its loading promise completes', async () => {
    const game = gameFixture(), step = loadingFrames(true)
    const plan = BattleSpawner.createSpawnPlan(PRESET_50V50)
    let ready = false
    const loading = game._executeBattleSpawnPlan(plan).then((actors: NPC[]) => { ready = true; return actors })
    expect(observed.constructors).toHaveLength(0); expect(ready).toBe(false)
    for (let frame = 1; frame <= plan.npcSpecs.length; frame++) {
      await step(); expect(observed.constructors).toHaveLength(frame)
      expect(game.npcs).toHaveLength(frame)
      for (const npc of game.npcs) if (npc.isMounted && npc.mount) expect(npc.mount.riderNpc).toBe(npc)
      if (frame < plan.npcSpecs.length) expect(ready).toBe(false)
    }
    const actors = await loading
    expect(actors).toBeDefined(); expect(actors).toHaveLength(plan.npcSpecs.length)
    expect(game.npcs).toEqual(actors); expect(game.battleStats.registerNpc).toHaveBeenCalledTimes(actors.length)
  })

  it('wires a Campaign initial plan to its army, rider/mount registration and loading readiness', async () => {
    const game = gameFixture(), step = loadingFrames()
    const launch = createCareerOutpostLaunch(acceptCareerOutpost({ ...createCareerProfile('roman'), rank: 'soldier', totalMerit: 300, availableMerit: 300 }, 1, 'initial-campaign')!)
    const plan = BattleSpawner.createSpawnPlan(createDefenseCampaignWaveConfig(launch, 'defenders'))
    let ready = false
    const loading = game._executeBattleSpawnPlan(plan).then((actors: NPC[]) => { ready = true; return actors })
    expect(observed.constructors).toHaveLength(0)
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
    expect(observed.constructors).toHaveLength(plan.npcSpecs.length)
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
    expect(observed.constructors).toHaveLength(0)
    await step()
    expect(observed.constructors).toHaveLength(1)
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
    expect(observed.constructors).toHaveLength(roster.length)
    town.residents.forEach((resident: any) => { resident.npc.dead = true })
    expect(town.residents).toHaveLength(roster.length)
    expect(progress).toHaveBeenLastCalledWith(`建立駐軍與居民 ${roster.length} / ${roster.length}…`)
    expect(event.actors.size).toBe(population.length)
    expect(event.actors.get('hr-officer')).toBe(town.residents.find((resident: any) => resident.spec.id === 'hr-officer').npc)
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
    expect(event.registrationComplete).toBe(false); expect(event.evaluate(false)).toBeNull()
    expect(() => event.complete()).toThrow('hr-officer')
  })

  it('cancels an in-flight loading owner before another owner can materialize and rolls back failed registrations', async () => {
    const step = loadingFrames(), game = gameFixture()
    game._aimTargetRegistry.unregisterNpc = vi.fn(); game._aimTargetRegistry.unregisterMount = vi.fn()
    const plan = BattleSpawner.createSpawnPlan(PRESET_50V50)
    const loading = game._executeBattleSpawnPlan(plan)
    await step(); expect(game.npcs).toHaveLength(1)
    game._disposeCareerOutpostBattleActors()
    await step(); await expect(loading).rejects.toThrow('cancelled')
    expect(observed.constructors).toHaveLength(1)
    expect(game.npcs).toHaveLength(0); expect(game._aimTargetRegistry.unregisterNpc).toHaveBeenCalledOnce()
    const failed = gameFixture()
    failed._aimTargetRegistry.unregisterNpc = vi.fn()
    failed._aimTargetRegistry.registerNpc.mockImplementation(() => { throw new Error('registration') })
    const failing = failed._executeBattleSpawnPlan(plan)
    await step(); await expect(failing).rejects.toThrow('registration')
    expect(failed.spawnBatches[0].status).toBe('failed'); expect(failed.npcs).toHaveLength(0)
    expect(failed.scene.children).toHaveLength(0)
    expect(failed._aimTargetRegistry.unregisterNpc).toHaveBeenCalledOnce()
    const before = observed.constructors.length; await step(); expect(observed.constructors).toHaveLength(before)
  })

  it('limits concurrent Bandit enemies, thirty private members, outskirts replacements and a loading driver to one constructor globally', async () => {
    const templateId = 'recruit-bandits-01', enemyCount = 3
    const scene = new THREE.Scene(), navigation = new NavigationWorld(), player = playerFixture(), step = loadingFrames(true)
    const profile = { ...createCareerProfile('roman'), rank: 'captain' as const,
      personalSquad: { members: Array.from({ length: 30 }, (_, i) => ({ id: `personal:shared-${i}`, type: 'soldier' as const })) } }
    const personal = new PersonalSquadRuntime(scene, Array.from({ length: 30 }, (_, i) => ({ x: i * 5, z: -30, yaw: 0 })), () => profile, () => player)
    personal.follow()
    const missionProfile = { ...createCareerProfile('roman'), activeMission: createActiveCareerMission(templateId, 0, enemyCount, 0, 'shared-mission') }
    const world = missionWorld(Array.from({ length: 5 }, (_, i) => new THREE.Vector3(120 + i * 10, 0, 120)))
    const mission = new BanditMissionController(scene, world, navigation, {} as NPC, [], () => player, () => missionProfile, () => true)
    expect(mission.startActiveMission()).toBe(true)
    const outskirts = new TownOutskirtsWarfareController(scene, 'roman', () => profile, [], navigation)
    const game = gameFixture(), loading = game._executeBattleSpawnPlan({ npcSpecs: [{ x: 0, z: 0, faction: Faction.PLAYER, characterFaction: 'roman', aiType: AIType.MELEE, name: 'loading', tier: 1, cavalry: false, respawnEnabled: false }], pickupSpecs: [], horseSpecs: [], playerSpawn: { x: 0, z: 0 } })
    dispose.push(() => personal.cleanup(), () => mission.dispose(), () => outskirts.dispose())
    expect(observed.constructors).toHaveLength(0); expect(mission.ready).toBe(false)
    expect(mission.evaluate(true)).toBeNull()
    for (let frame = 0; frame < 110 && gameplayNpcSpawns.pending; frame++) await step()
    await loading
    expect(personal.actors).toHaveLength(30); expect(mission.missionBandits).toHaveLength(enemyCount)
    expect(outskirts.actors).toHaveLength(60); expect(game.npcs).toHaveLength(1)
    expect(new Set(observed.constructors).size).toBe(observed.constructors.length)
    const before = observed.constructors.length
    const cavalry = outskirts.squads.find(squad => squad.spec.kind === 'cavalry')!
    cavalry.members.forEach(npc => { (npc as any).dead = true })
    outskirts.prepareFrame(0, outskirts.actors, player)
    personal.cleanup(); personal.follow(); mission.cleanupMission(0)
    expect(observed.constructors).toHaveLength(before)
    for (let frame = 0; frame < 45 && gameplayNpcSpawns.pending; frame++) await step()
    expect(cavalry.members).toHaveLength(10); expect(mission.ambientBandits.filter(npc => npc.combatantId.startsWith('ambient:0:'))).toHaveLength(2)
    expect(personal.actors).toHaveLength(30)
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
    expect(observed.constructors).toHaveLength(0)
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
    expect(observed.constructors).toEqual(active.targetActorIds)
    expect(new Set(observed.constructors).size).toBe(4)
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
