import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TownScene } from '../../src/town/TownScene'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { createCaptainGateDefenseMission } from '../../src/career/CaptainMissionCatalog'
import { TownDefenseController, type TownDefenseResident } from '../../src/career/TownDefenseController'
import { resolveCareerTownSceneContext, type CareerTownSceneRosterEntry } from '../../src/career/CareerFieldSceneContext'
import { townRoster, townAssaultObjectiveRoster, townMilitaryEquipment } from '../../src/town/TownRules'
import { townCommanderSpec } from '../../src/town/TownCommander'
import { resolveTownHRLayout, townConquestRoster } from '../../src/town/TownHRLayout'
import { resolveTownEagleTrainingGround } from '../../src/town/TownEagleTrainingGround'
import { resolveTownEagleGarrison } from '../../src/town/TownEagleGarrison'
import { TownEagleGarrisonController } from '../../src/town/TownEagleGarrisonController'
import type { TownEagleGarrisonState } from '../../src/town/TownEagleGarrisonState'
import { TOWN_LAYOUT_VERSION } from '../../src/town/TownLayout'
import { getTerrainHeight } from '../../src/world/Terrain'
import { TownCavalryPatrolController } from '../../src/town/TownCavalryPatrolController'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { TOWN_NAVIGATION_BOUNDS } from '../../src/town/TownBounds'
import { NpcSpawnScheduler, gameplayNpcSpawns } from '../../src/world/NpcSpawnScheduler'
import { MountType, type Mount } from '../../src/world/Mount'
import type { Player } from '../../src/player/Player'
import { recording, resetSpawnRecording } from '../helpers/npcSpawnRecording'
import { MemoryStorage } from '../helpers/memoryStorage'
import { addCareerItem } from '../../src/career/CareerInventory'
import { changeTownEquipment, resolveTownActorEquipment } from '../../src/career/CareerTownEquipment'
import { NpcSpawnTestDriver, installNpcLoadingFrames, gameplayNpcSpawnDriver } from '../helpers/npcSpawnFrames'

vi.mock('../../src/world/NPC', async original => ({ ...(await original<typeof import('../../src/world/NPC')>()),
  NPC: (await import('../helpers/npcSpawnRecording')).RecordingNpc }))
vi.mock('../../src/world/Mount', async original => ({ ...(await original<typeof import('../../src/world/Mount')>()),
  Mount: (await import('../helpers/npcSpawnRecording')).RecordingMount }))
vi.mock('../../src/audio/SoundManager', () => ({ SoundManager: class {
  cancelCareerAudio() {} updateHorseGallopLoops() {} updateEagleWingbeats() {}
} }))
// Geometry/rendering boundary only. Production TownScene constructs and filters the actual roster.
vi.mock('../../src/town/TownWorld', () => ({ TownWorld: class {
  obstacles = []; roads = []
  hr; eagleTraining; eagleGarrison
  constructor(public faction: 'roman' | 'viking') {
    this.hr = resolveTownHRLayout(faction, [], [])
    this.eagleTraining = resolveTownEagleTrainingGround([], [], this.hr)
    this.eagleGarrison = resolveTownEagleGarrison(this.eagleTraining)
  }
  addServiceMarker() { return new THREE.Sprite() }
  dispose() {}
} }))

const cleanup: (() => void)[] = []
afterEach(() => {
  cleanup.splice(0).reverse().forEach(dispose => dispose())
  expect(gameplayNpcSpawns.pending).toBe(0)
  resetSpawnRecording(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})

function savedDefense(faction: 'roman' | 'viking'): CareerProfile {
  const profile = createCareerProfile(faction); profile.rank = 'commander'; profile.totalMerit = 20000
  const layout = resolveTownHRLayout(faction, [], [])
  const population = townConquestRoster(layout, townRoster(), resolveTownEagleTrainingGround([], [], layout))
  population.push(townCommanderSpec({ x: 20, z: 5, yaw: 0 }))
  profile.activeMission = createCaptainGateDefenseMission(profile, townAssaultObjectiveRoster(population).map(spec => spec.id), [], population, 'commander-defense')
  const store = new CareerProfileStore(new MemoryStorage()); expect(store.save(profile)).toBe(true)
  return store.load()!
}

function domBoundary() {
  const element = () => ({ textContent: '', style: {}, classList: { add() {}, remove() {} },
    querySelectorAll: () => [], setAttribute() {}, prepend() {}, append() {}, appendChild() {}, remove() {} })
  vi.stubGlobal('document', { pointerLockElement: null, getElementById: element, createElement: element,
    body: element(), addEventListener() {} })
  vi.stubGlobal('window', { location: { search: '' }, addEventListener() {} })
  vi.stubGlobal('innerWidth', 800); vi.stubGlobal('innerHeight', 600); vi.stubGlobal('devicePixelRatio', 1)
  vi.stubGlobal('localStorage', new MemoryStorage()); vi.stubGlobal('cancelAnimationFrame', () => {})
  return { container: element(), renderer: { setPixelRatio() {}, setSize() {}, shadowMap: {}, domElement: element(), dispose() {} } }
}

interface ConstructorTown {
  profile: CareerProfile
  garrisonRestored: boolean
  commit(profile: CareerProfile): boolean
  restoreEagleCommandState(): void
  residentRoster: CareerTownSceneRosterEntry[]
  residents: TownDefenseResident[]
  mounts: Mount[]
  scene: THREE.Scene
  initializeResidents(roster: CareerTownSceneRosterEntry[], context: ReturnType<typeof resolveCareerTownSceneContext>, progress: () => void): Promise<void>
  dispose(): void
}
function constructTown(profile: CareerProfile): ConstructorTown {
  const { container, renderer } = domBoundary()
  // The sole private-constructor seam; no caller, roster producer, gate or scheduler is mocked.
  const town = Reflect.construct(TownScene, [container, renderer, profile, () => {}, () => {}, () => {}]) as ConstructorTown
  cleanup.push(() => town.dispose())
  return town
}

describe('saved Town equipment materialization wiring', () => {
  function configuredProfile(actorId: string, slot: 'melee' | 'ranged', itemId: string): CareerProfile {
    let profile = createCareerProfile('roman'); profile.rank = 'commander'; profile.totalMerit = 60000; profile.availableMerit = 60000
    addCareerItem(profile, itemId, 1)
    const store = new CareerProfileStore(new MemoryStorage())
    const result = changeTownEquipment(() => profile, { townFaction: 'roman', peaceful: true,
      personalState: 'RESERVE', safeActorIds: new Set([actorId]) }, actorId, slot, itemId, next => {
        if (!store.save(next)) return false; profile = store.load()!; return true
      })
    expect(result.changed).toBe(true)
    return profile
  }
  async function materialize(town: ConstructorTown, actorId: string) {
    installNpcLoadingFrames(gameplayNpcSpawnDriver)
    await town.initializeResidents(town.residentRoster.filter(entry => entry.spec.id === actorId),
      resolveCareerTownSceneContext(town.profile), () => {})
    expect(recording.npcs).toHaveLength(1)
    expect(recording.mounts).toHaveLength(0)
    return recording.npcs[0]
  }
  it('restores a purchased weapon from serialized profile at the real peaceful Town spawn caller', async () => {
    // One recorded constructor, zero real NPC/Mount/TownWorld: actual NPC combat is owned by permanent equipment tests.
    const town = constructTown(configuredProfile('gate:north:0', 'melee', 'paladin_mace_t4'))
    const npc = await materialize(town, 'gate:north:0')
    expect(npc.loadout?.meleeWeaponId).toBe('paladin_mace_t4')
    expect(npc.tier).toBe(4)
    expect(npc.combatProfileId).toBeUndefined()
    expect(npc.characterFaction).toBe('roman')
  })
  it('uses the same persisted allocation in Commander Town Defense and after settlement returns to Town', async () => {
    const profile = configuredProfile('gate:north:0', 'melee', 'paladin_sword_t4')
    profile.activeMission = savedDefense('roman').activeMission
    const store = new CareerProfileStore(new MemoryStorage())
    expect(store.save(profile)).toBe(true)
    const battle = constructTown(store.load()!)
    expect((await materialize(battle, 'gate:north:0')).loadout?.meleeWeaponId).toBe('paladin_sword_t4')
    battle.dispose(); resetSpawnRecording()
    delete profile.activeMission
    expect(store.save(profile)).toBe(true)
    const returned = constructTown(store.load()!)
    expect((await materialize(returned, 'gate:north:0')).loadout?.meleeWeaponId).toBe('paladin_sword_t4')
    expect(returned.profile.inventory?.quantities.paladin_sword_t4).toBe(1)
  })
  it('does not recreate a native mount at its origin when a sparse saved holder moves it to another member', async () => {
    const profile = createCareerProfile('roman'); profile.rank = 'commander'; profile.totalMerit = 60000
    const commander = resolveTownActorEquipment(profile, 'roman', 'commander')
    const captainMount = resolveTownActorEquipment(profile, 'roman', 'captain').refs.mount
    profile.townEquipment = { roman: { version: 1,
      actors: { commander: { ...commander.refs, mount: captainMount } }, nativeReserve: ['roman/commander/mount'] } }
    const store = new CareerProfileStore(new MemoryStorage()); expect(store.save(profile)).toBe(true)
    const town = constructTown(store.load()!)
    installNpcLoadingFrames(gameplayNpcSpawnDriver)
    await town.initializeResidents(town.residentRoster.filter(entry => ['captain', 'commander'].includes(entry.spec.id)),
      resolveCareerTownSceneContext(town.profile), () => {})
    expect(recording.npcs).toHaveLength(2); expect(recording.mounts).toHaveLength(1)
    const origin = town.residents.find(resident => resident.spec.id === 'captain')!
    const recipient = town.residents.find(resident => resident.spec.id === 'commander')!
    expect(origin.homeMount).toBeUndefined(); expect(origin.npc.loadout?.mountId).toBeNull()
    expect(recipient.homeMount).toBe(recording.mounts[0]); expect(recipient.npc.mount).toBe(recipient.homeMount)
    expect(resolveTownActorEquipment(town.profile, 'roman', 'commander').refs.mount?.nativeId).toBe('roman/captain/mount')
  })
  it('initializes a configured civilian as native ranged AI while retaining civilian category and fixed census identity', async () => {
    const town = constructTown(configuredProfile('civilian-0', 'ranged', 'maki-ranger-bow-ranged'))
    const npc = await materialize(town, 'civilian-0')
    expect(npc.loadout).toMatchObject({ rangedWeaponId: 'maki-ranger-bow-ranged', shieldId: null })
    expect(npc.aiType).toBe('RANGED')
    expect(npc.combatantId).toBe('civilian-0')
    expect(npc.combatProfileId).toBeUndefined()
  })
})

describe('saved Commander Defense TownScene materialization and consumer wiring', () => {
  it.each(['roman', 'viking'] as const)('%s constructor creates exactly the authorized original T5 with faction equipment and service mount, then Defense checkpoints it', async faction => {
    let profile = savedDefense(faction)
    const town = constructTown(profile)
    expect(town.residentRoster.filter(entry => entry.spec.id === 'commander')).toHaveLength(1)
    expect(profile.activeMission!.friendlyActorIds).toHaveLength(210)
    // Full roster identity coverage belongs to policy/spawn suites; this protocol needs one recorded rider and mount.
    const commanderRoster = town.residentRoster.filter(entry => entry.spec.id === 'commander')
    installNpcLoadingFrames(gameplayNpcSpawnDriver)
    await town.initializeResidents(commanderRoster, resolveCareerTownSceneContext(profile), () => {})
    expect(recording.npcs).toHaveLength(1); expect(recording.mounts).toHaveLength(1)
    const npc = recording.npcs[0], mount = recording.mounts[0]
    expect(npc).toMatchObject({ combatantId: 'commander', visualAssetId: `${faction}-hero-t5`, combatProfileId: `${faction}-commander`,
      loadout: townMilitaryEquipment(faction, 'commander').loadout, tier: 4 })
    expect(mount.type).toBe(faction === 'roman' ? MountType.CORGI : MountType.BLACK_CAT)
    expect(npc.mount).toBe(mount); expect(town.residents[0].homeMount).toBe(mount)
    const mission = profile.activeMission!
    // Saved casualties keep the enemy producer real but require no enemy actor construction here.
    mission.targetActorIds = Array.from({ length: 120 }, (_, index) => `${mission.id}:siege:${index}`)
    mission.deadTargetActorIds = [...mission.targetActorIds]
    mission.officialSquad!.members = { commander: { status: 'deployed', hp: 73, ammo: 7, shieldImpact: 12,
      mount: { hp: 61, mounted: false, position: { x: 20, z: 5, yaw: 0 } } } }
    const storage = new MemoryStorage(), store = new CareerProfileStore(storage); expect(store.save(profile)).toBe(true); profile = store.load()!
    const group = new THREE.Group(), player = { group, dead: false, hp: 100, staminaValue: 100,
      combatPosition: group.position, setHp: vi.fn(), setStamina: vi.fn(), dispose: vi.fn() } as unknown as Player
    const scheduler = new NpcSpawnScheduler(), driver = new NpcSpawnTestDriver(scheduler)
    const defenseFor = (owner: ConstructorTown) => new TownDefenseController(owner.scene, owner.residents, () => player, () => profile,
      next => { if (!store.save(next)) return false; profile = store.load()!; return true }, { dead: false } as Mount,
      new NavigationWorld(TOWN_NAVIGATION_BOUNDS), {
        gates: new Map(), obstacles: [], closureBodies: () => [], patrol: new TownCavalryPatrolController(owner.residents),
      }, scheduler)
    const controller = defenseFor(town)
    cleanup.push(() => controller.dispose())
    expect(controller.startActiveMission()).toBe(true)
    driver.drain()
    expect(controller.defenders).toEqual([npc])
    expect(controller.fieldNpcs).toEqual([npc])
    expect(npc.squadId).toBe(2)
    expect(npc).toMatchObject({ hp: 73, combatAmmo: 7, shield: { shieldImpactRemaining: 12 }, mount: null })
    expect(mount.currentHp).toBe(61)
    expect(profile.activeMission!.siege!.defensePlans.find(plan => plan.gateId === 'north')!.cavalry).toContain('commander')
    npc.hp = 42; npc.combatAmmo = 3; mount.currentHp = 21
    storage.failWrites = true; controller.persistRuntimeProgress(true)
    expect(store.load()!.activeMission!.officialSquad!.members!.commander.hp).toBe(73)
    storage.failWrites = false; controller.persistRuntimeProgress(true)
    expect(store.load()!.activeMission!.officialSquad!.members!.commander).toMatchObject({ hp: 42, ammo: 3, mount: { hp: 21, mounted: false } })
    npc.restoreCombatHealth(0); mount.currentHp = 0
    controller.persistRuntimeProgress(true)
    expect(store.load()!.activeMission!.deadFriendlyActorIds).toContain('commander')
    expect(store.load()!.activeMission!.actorHealth!.commander).toEqual({ hp: 0, mountHp: 0 })
    expect(recording.npcs).toHaveLength(1); expect(recording.mounts).toHaveLength(1)
    controller.dispose()
    const resumedTown = constructTown(store.load()!)
    await resumedTown.initializeResidents(resumedTown.residentRoster.filter(entry => entry.spec.id === 'commander'), resolveCareerTownSceneContext(profile), () => {})
    const resumed = recording.npcs[1], resumedMount = recording.mounts[1]
    // Constructor double only records the damage protocol; real Mount death has its lifecycle suite.
    Object.assign(resumedMount, { takeDamage: vi.fn(() => { resumedMount.dead = true; resumedMount.currentHp = 0 }) })
    const resumedDefense = defenseFor(resumedTown); cleanup.push(() => resumedDefense.dispose())
    expect(resumedDefense.startActiveMission()).toBe(true); driver.drain()
    expect(resumed).toMatchObject({ combatantId: 'commander', hp: 0, dead: true, mount: null })
    expect(resumedMount).toMatchObject({ currentHp: 0, dead: true, riderNpc: null })
    expect(resumedDefense.defenders.map(actor => actor.combatantId)).toEqual(['commander'])
    expect(recording.npcs).toHaveLength(2); expect(recording.mounts).toHaveLength(2)
  })

  it.each(['captain', 'legacy', 'accepted-commander', 'enemy', 'foreign-field'] as const)('%s constructor never adds the service Commander to a formal battle', kind => {
    const profile = savedDefense('roman')
    if (kind === 'captain') profile.rank = 'captain'
    if (kind === 'legacy') {
      delete profile.activeMission!.officialSquad
      profile.activeMission!.friendlyActorIds = profile.activeMission!.friendlyActorIds.filter(id => id !== 'commander')
    }
    if (kind === 'accepted-commander') {
      const mission = profile.activeMission!, authority = mission.officialSquad!
      mission.friendlyActorIds = mission.friendlyActorIds.filter(id => id !== 'commander')
      authority.actorIds = authority.actorIds.filter(id => id !== 'commander')
      authority.squads = authority.squads!.map(squad => ({ ...squad, actorIds: squad.actorIds.filter(id => id !== 'commander') }))
    }
    if (kind === 'enemy') profile.activeMission!.kind = 'enemy-town-assault'
    if (kind === 'foreign-field') { profile.activeMission!.kind = 'veteran-field'; profile.activeMission!.templateId = 'veteran-tragedy-of-the-scouts' }
    const town = constructTown(profile)
    expect(town.residentRoster.some(entry => entry.spec.id === 'commander' || entry.spec.id === 'enemy-town:commander')).toBe(false)
    expect(recording.npcs).toHaveLength(0); expect(recording.mounts).toHaveLength(0)
  })
})


describe('native Eagle restoration after Defense checkpoint loading', () => {
  it.each(['captain', 'legacy-commander'] as const)('%s retains saved cruise altitude through early Defense saves and restores native flight without claiming it', rank => {
    // One recorded resident/eagle; no enemy, real actor, TownWorld or GLB constructors.
    const profile = createCareerProfile('roman'); profile.rank = rank === 'captain' ? 'captain' : 'commander'; profile.totalMerit = 20000
    const spec = townRoster().find(actor => actor.id === 'town-eagle-rider:1')!
    const mission = profile.activeMission = createCaptainGateDefenseMission(profile, [spec.id], [], [spec], 'native-air-reload')
    if (rank === 'legacy-commander') delete mission.officialSquad
    mission.targetActorIds = Array.from({ length: 120 }, (_, index) => `${mission.id}:siege:${index}`)
    mission.deadTargetActorIds = [...mission.targetActorIds]
    mission.siege!.rosterCreated = true; mission.siege!.attackerIds = [...mission.targetActorIds]
    mission.actorPositions = { [spec.id]: { x: 12, z: 24, yaw: .4 } }
    const aerial: TownEagleGarrisonState = { version: 1, sceneKey: 'town:roman', layoutVersion: TOWN_LAYOUT_VERSION,
      pairs: [{ riderId: spec.id, mountId: 'town-eagle-mount:1', homePadId: 'town-eagle-pad:1',
        duty: 'patrolling', hp: 73, ammo: 9, position: { x: 12, y: 32, z: 24, yaw: .4 }, mounted: true, refitAllowed: false,
        patrol: { active: true, waypoint: 1, elapsed: 20 },
        mount: { hp: 61, position: { x: 12, y: 30, z: 24, yaw: .4 },
          flight: { phase: 'cruise', yaw: .4, pitch: 0, bank: 0, speed: 20, velocity: { x: 0, y: 0, z: 20 } } } }],
    }
    profile.townEagleGarrisons = { roman: aerial }
    const store = new CareerProfileStore(new MemoryStorage()); expect(store.save(profile)).toBe(true)
    const town = constructTown(store.load()!)
    installNpcLoadingFrames(gameplayNpcSpawnDriver)
    return town.initializeResidents(town.residentRoster.filter(entry => entry.spec.id === spec.id), resolveCareerTownSceneContext(town.profile), () => {}).then(() => {
      const npc = recording.npcs[0], mount = recording.mounts[0], resident = town.residents[0]
      Object.assign(npc, { setEagleCruiseAltitude: vi.fn() })
      const garrison = new TownEagleGarrisonController(town.residents)
      const snapshot = vi.spyOn(garrison, 'snapshot'), claim = vi.spyOn(garrison, 'claimPlayerCommand')
      const group = new THREE.Group(), player = { group, dead: false, hp: 100, staminaValue: 100,
        combatPosition: group.position, setHp: vi.fn(), setStamina: vi.fn(), dispose: vi.fn() } as unknown as Player
      const scheduler = new NpcSpawnScheduler(), driver = new NpcSpawnTestDriver(scheduler)
      const defense = new TownDefenseController(town.scene, town.residents, () => player, () => town.profile,
        next => town.commit(next), { dead: false } as Mount, new NavigationWorld(TOWN_NAVIGATION_BOUNDS), {
          gates: new Map(), obstacles: [], closureBodies: () => [], patrol: new TownCavalryPatrolController(town.residents),
        }, scheduler)
      cleanup.push(() => defense.dispose())
      Object.assign(town, { store, player, eagleGarrison: garrison, defense })
      expect(town.garrisonRestored).toBe(false)
      expect(defense.startActiveMission()).toBe(true); driver.drain()
      expect(defense.ready).toBe(true)
      expect(npc.group.position.y).toBe(getTerrainHeight(12, 24))
      expect(mount.group.position.y).not.toBe(30)
      expect(snapshot).not.toHaveBeenCalled()
      expect(store.load()!.townEagleGarrisons!.roman!.pairs[0].mount).toMatchObject({
        position: { y: 30 }, flight: { phase: 'cruise' },
      })
      // This production helper is called at the late native restore point, after mission loading/warmup.
      town.restoreEagleCommandState()
      expect(town.garrisonRestored).toBe(true)
      expect(mount.group.position).toEqual(new THREE.Vector3(12, 30, 24))
      expect(mount.flight!.snapshot().phase).toBe('cruise')
      expect(npc.mount).toBe(mount)
      expect(garrison.dutyFor(resident.npc)).toBe('patrolling')
      expect(garrison.isPlayerCommandOwned(resident.npc)).toBe(false)
      expect(claim).not.toHaveBeenCalled()
      expect(npc.setEagleFlightOrder).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'patrol' }))
      expect(town.commit(town.profile)).toBe(true)
      expect(store.load()!.townEagleGarrisons!.roman!.pairs[0].mount.position.y).toBe(30)
      expect(recording.npcs).toHaveLength(1); expect(recording.mounts).toHaveLength(1)
    })
  })
})
