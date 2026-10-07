import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TownScene } from '../src/town/TownScene'
import { TownOutskirtsWarfareController } from '../src/town/TownOutskirtsWarfareController'
import { BanditMissionController } from '../src/career/BanditMissionController'
import { PersonalSquadRuntime } from '../src/career/PersonalSquadRuntime'
import { createCareerProfile } from '../src/career/CareerProfile'
import { createActiveCareerMission } from '../src/career/CareerMissionState'
import { careerTownSceneRoster, resolveCareerTownSceneContext } from '../src/career/CareerFieldSceneContext'
import { PRESET_50V50 } from '../src/battle/BattleConfig'
import { BattleSpawner } from '../src/battle/BattleSpawner'
import { createDefenseCampaignWaveConfig } from '../src/campaign/DefenseCampaignLaunch'
import { createCareerOutpostLaunch } from '../src/career/CareerOutpostLaunch'
import { acceptCareerOutpost } from '../src/career/CareerOutpostMission'
import { NavigationWorld } from '../src/navigation/NavigationWorld'
import { AIType, Faction, NPC } from '../src/world/NPC'
import type { Player } from '../src/player/Player'
import { gameplayNpcSpawns } from '../src/world/NpcSpawnScheduler'
import { TownEvent } from '../src/town/TownRules'
import { resolveTownHRLayout, townConquestRoster } from '../src/town/TownHRLayout'
import { advanceNpcFrame, gameplayNpcSpawnDriver } from './helpers/npcSpawnFrames'
import { createGameTestFixture } from './helpers/gameFixture'

const observed = vi.hoisted(() => ({ constructors: [] as string[] }))
vi.mock('../src/world/NPC', async original => {
  const actual = await original<typeof import('../src/world/NPC')>()
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
vi.mock('../src/world/Mount', async original => {
  const actual = await original<typeof import('../src/world/Mount')>()
  return { ...actual, Mount: class {
    readonly group = new THREE.Group(); riderNpc: unknown; currentHp = 100; maxHp = 100; dead = false
    constructor(scene: THREE.Scene, _type: unknown, x: number, z: number) { this.group.position.set(x, 0, z); scene.add(this.group) }
    dispose() { this.group.removeFromParent() }
  } }
})
vi.mock('../src/world/WeaponPickup', () => ({ WeaponPickup: class { dispose() {} } }))
vi.mock('../src/career/MissionGuide', () => ({ MissionGuide: class { hide() {} dispose() {} } }))
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
function loadingFrames() {
  const callbacks: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.push(callback); return callbacks.length })
  return async () => {
    const before = observed.constructors.length, frame = advanceNpcFrame(gameplayNpcSpawnDriver)
    for (const callback of callbacks.splice(0)) callback(frame)
    await Promise.resolve(); await Promise.resolve()
    gameplayNpcSpawns.tick(frame)
    expect(observed.constructors.length - before).toBeLessThanOrEqual(1)
    return frame
  }
}

describe('actual NPC constructor paths share the frame budget', () => {
  it.each(['custom', 'campaign'] as const)('materializes the %s initial army and full rider/mount pairs before its loading promise completes', async mode => {
    const game = gameFixture(), step = loadingFrames()
    const launch = createCareerOutpostLaunch(acceptCareerOutpost({ ...createCareerProfile('roman'), rank: 'soldier', totalMerit: 300, availableMerit: 300 }, 1, `initial-${mode}`)!)
    const plan = BattleSpawner.createSpawnPlan(mode === 'custom' ? PRESET_50V50 : createDefenseCampaignWaveConfig(launch, 'defenders'))
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

  it('creates actual Town resident constructors one per frame before completing its resident initialization stage', async () => {
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
    for (let frame = 1; frame <= roster.length; frame++) {
      await step(); expect(observed.constructors).toHaveLength(frame)
      town.residents.forEach((resident: any) => { resident.npc.dead = true })
      expect(event.evaluate(false)).toBeNull()
      if (frame < roster.length) expect(ready).toBe(false)
    }
    await loading
    expect(town.residents).toHaveLength(roster.length)
    expect(progress).toHaveBeenLastCalledWith(`建立駐軍與居民 ${roster.length} / ${roster.length}…`)
    expect(event.actors.size).toBe(population.length)
    expect(event.actors.get('hr-officer')).toBe(town.residents.find((resident: any) => resident.spec.id === 'hr-officer').npc)
    event.complete(); expect(event.evaluate(false)).toBe('town_defeated')
  })

  it('rejects an actual HR registration failure without opening conquest settlement', async () => {
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

  it.each([['recruit-bandits-01', 3], ['recruit-patrol-01', 4]] as const)('limits concurrent %s enemies, thirty private members, outskirts replacements and a loading driver to one constructor globally', async (templateId, enemyCount) => {
    const scene = new THREE.Scene(), navigation = new NavigationWorld(), player = playerFixture(), step = loadingFrames()
    const profile = { ...createCareerProfile('roman'), rank: 'captain' as const,
      personalSquad: { members: Array.from({ length: 30 }, (_, i) => ({ id: `personal:shared-${i}`, type: 'soldier' as const })) } }
    const personal = new PersonalSquadRuntime(scene, Array.from({ length: 30 }, (_, i) => ({ x: i * 5, z: -30, yaw: 0 })), () => profile, () => player)
    personal.follow()
    const missionProfile = { ...createCareerProfile('roman'), activeMission: createActiveCareerMission(templateId, 0, enemyCount, 0, 'shared-mission') }
    const world = { camps: Array.from({ length: 5 }, (_, i) => ({ spawnPoints: [new THREE.Vector3(120 + i * 10, 0, 120)] })), obstacles: [] } as any
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
})
