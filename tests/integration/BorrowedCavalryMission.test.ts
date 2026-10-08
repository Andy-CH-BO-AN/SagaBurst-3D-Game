import { completeNpcDeployment, NpcSpawnTestDriver } from '../helpers/npcSpawnFrames'
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BanditMissionController, VETERAN_FIELD_LAYOUT } from '../../src/career/BanditMissionController'
import { createCavalrySweepMission } from '../../src/career/CavalrySweep'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { createActiveCareerMission } from '../../src/career/CareerMissionState'
import * as veteranMissions from '../../src/career/VeteranMission'
import type { VeteranMissionRoster, VeteranRosterUnit } from '../../src/career/VeteranMission'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { TOWN_NAVIGATION_BOUNDS } from '../../src/town/TownBounds'
import type { Player } from '../../src/player/Player'
import { TownCavalryPatrolController } from '../../src/town/TownCavalryPatrolController'
import { selectTownCavalryReserve } from '../../src/town/TownCavalryReserve'
import { TownMissionSettlement } from '../../src/town/TownMissionSettlement'
import { townMilitaryEquipment, townRoster } from '../../src/town/TownRules'
import { TownScene } from '../../src/town/TownScene'
import { TownWorld } from '../../src/town/TownWorld'
import { Mount, MountType } from '../../src/world/Mount'
import { AIType, Faction, NPC } from '../../src/world/NPC'
import { isObstaclePathClear, type ObstacleData } from '../../src/world/Terrain'
import { combatActor, combatFixture } from '../helpers/townMissionCombat'
import { advanceUntil } from '../helpers/simulation'

vi.mock('../../src/world/BlackCatVisual', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/BlackCatVisual')>()),
  BlackCatVisual: (await import('../helpers/gameplayQuadrupedVisual')).GameplayQuadrupedVisualDouble,
}))
vi.mock('../../src/world/CorgiVisual', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/CorgiVisual')>()),
  CorgiVisual: (await import('../helpers/gameplayQuadrupedVisual')).GameplayQuadrupedVisualDouble,
}))

// Rendering assets are replaced; selection, mission/Patrol ownership, navigation and travel are real.
vi.mock('../../src/world/HorseAssetRegistry', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/HorseAssetRegistry')>()),
  HorseAssetRegistry: { ready: true, createInstance: () => {
    const root = new THREE.Group(), saddleSeat = new THREE.Object3D()
    saddleSeat.position.y = 1.7; root.add(saddleSeat)
    return { root, saddleSeat, lod: new THREE.LOD(), skeleton: null,
      setLocomotion() {}, setAppearanceVariant() {}, playOnce() {}, playDeath() {}, playStudioClip() {}, update() {}, dispose() {} }
  } },
}))
vi.mock('../../src/world/MakiRangerEquipment', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/MakiRangerEquipment')>()),
  createMakiRangerBowInstance: () => ({
    model: new THREE.Group(), topTip: new THREE.Vector3(0, .8, 0), bottomTip: new THREE.Vector3(0, -.8, 0),
    profile: { id: 'maki-ranger-bow', gripRadius: .02, gripLength: .2, visualScale: 1,
      gripCenterLocal: new THREE.Vector3(), shootingAxis: new THREE.Vector3(0, 0, -1),
      longitudinalAxis: new THREE.Vector3(0, 1, 0), contactNormal: new THREE.Vector3(1, 0, 0) },
  }),
}))
vi.mock('../../src/career/MissionGuide', () => ({ MissionGuide: class {
  update() {} hide() {} dispose() {}
} }))

const cleanup: (() => void)[] = []
afterEach(() => { cleanup.splice(0).reverse().forEach(dispose => dispose()); vi.restoreAllMocks(); vi.unstubAllGlobals() })

const patrolCaptain = 'town-patrol:a:captain', patrolRider = 'town-patrol:a:0'
const trainingRider = 'cavalry-training:melee_cavalry:0'

/** The only private seam is the existing Town entry point. All methods still run on its real prototype. */
interface TownMissionEntry {
  acceptVeteranCareerMission(templateId: string): void
  unavailableTownCavalryActorIds(): ReadonlySet<string>
}

function fixture(residentIds: readonly string[], options: { world?: boolean; obstacles?: ObstacleData[] } = {}) {
  const scene = new THREE.Scene(), navigation = new NavigationWorld(TOWN_NAVIGATION_BOUNDS)
  const context = new Proxy<Record<string, unknown>>({ measureText: () => ({ width: 100 }) }, {
    get: (target, key) => typeof key === 'string' ? target[key] ?? (() => {}) : undefined,
  })
  vi.stubGlobal('ImageData', class { constructor(public data: unknown, public width: number, public height: number) {} })
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => context }) })
  const builtWorld = options.world ? new TownWorld('roman', scene) : undefined
  if (builtWorld) cleanup.push(() => builtWorld.dispose())
  // Physical Sweep needs one camp and actual Town geometry, not unrelated ambient camps.
  const worldData = { camps: builtWorld ? builtWorld.camps.slice(0, 1) : [],
    obstacles: builtWorld?.obstacles ?? options.obstacles ?? [], restoreTownDamage() {} }
  navigation.sync(worldData.obstacles)
  const ids = new Set(residentIds)
  for (const spec of townRoster()) if (ids.has(spec.id) && spec.duty === 'patrol') ids.add(`town-patrol:${spec.patrolId!.toLowerCase()}:captain`)
  const residents = townRoster().filter(spec => ids.has(spec.id)).map(spec => {
    const equipment = townMilitaryEquipment('roman', spec), ranger = spec.role === 'ranger'
    const rangerSpec = ranger ? veteranMissions.createVeteranSpawnSpec({ actorId: spec.id, source: 'town',
      presetId: 'roman_horse_archer', tier: 4, squadId: 1, leader: true, heroRole: 'ranger', mounted: true }, 'roman') : undefined
    const npc = new NPC(scene, spec.x, spec.z, Faction.TOWN, 'roman', ranger ? AIType.RANGED : AIType.MELEE,
      spec.id, ranger ? 4 : equipment.level, true, rangerSpec?.loadout ?? equipment.loadout,
      rangerSpec?.presetId ?? equipment.presetId, undefined, spec.id, undefined,
      rangerSpec?.visualAssetId, rangerSpec?.combatProfileId, rangerSpec?.specialCombatProfile)
    cleanup.push(() => npc.dispose())
    const homeMount = new Mount(scene, ranger ? MountType.BLACK_CAT : MountType.HORSE, spec.x, spec.z)
    cleanup.push(() => homeMount.dispose())
    homeMount.group.rotation.y = spec.yaw ?? 0
    npc.mountVehicle(homeMount); npc.setTownPeaceful()
    return { spec, npc, homeMount, cycle: -1, walkTime: 0 }
  })
  const patrol = new TownCavalryPatrolController(residents)
  let profile: CareerProfile = {
    ...createCareerProfile('roman'), rank: 'veteran', totalMerit: 900, availableMerit: 900,
    ownedMounts: ['horse'], completedCareerMissionTemplateIds: [...veteranMissions.VETERAN_MISSION_IDS],
  }
  const player = { group: new THREE.Group(), dead: false, hp: 100, staminaValue: 100,
    get combatPosition() { return this.group.position } }
  const commit = (next: CareerProfile) => { profile = next; town.profile = next; return true }
  const driver = new NpcSpawnTestDriver()
  // Veteran startup reads the roster's leader; it never uses the unrelated recruit mission Captain.
  const missionCaptain = residents[0]?.npc ?? combatActor('unused-recruit-captain')
  const mission = new BanditMissionController(scene, worldData as unknown as TownWorld, navigation,
    missionCaptain, residents, () => player as unknown as Player, () => profile, commit, {}, driver.scheduler)
  cleanup.push(() => mission.dispose())
  const borrow = vi.fn((actorId: string) => { patrol.relinquish(actorId) })
  mission.onBorrowMountedActor = borrow
  const town = Object.assign(Object.create(TownScene.prototype) as TownMissionEntry, {
    profile, residents, patrol, mission, player, event: { hostile: false },
    store: { load: () => profile, loadChecked: () => ({ profile }) }, commit,
    careerMounts: { activate: vi.fn() }, inventory: { prepareForCombat: vi.fn(), sheathAll: vi.fn() },
    closePanel: vi.fn(), playMissionVoice: vi.fn(), openPanel: vi.fn(), dispose: vi.fn(), onRestart: vi.fn(),
  })
  const stepPatrol = () => {
    navigation.beginFrame(); patrol.beginFrame(new Set(mission.friendlies))
    for (const resident of residents) patrol.updateResident(resident, .1, player.group.position, worldData.obstacles, navigation)
  }
  return { scene, world: worldData, navigation, residents, patrol, mission, player, town, borrow, commit, stepPatrol,
    profile: () => profile, deploy: () => completeNpcDeployment(() => mission.startActiveMission(), driver),
    acceptOfficial: () => completeNpcDeployment(() => town.acceptVeteranCareerMission('veteran-scout-hunters'), driver) }
}

function unit(actorId: string, source: VeteranRosterUnit['source'], overrides: Partial<VeteranRosterUnit> = {}): VeteranRosterUnit {
  return { actorId, source, presetId: 'roman_sword_cavalry', tier: 3, squadId: 1, leader: false, mounted: true, ...overrides }
}

/** Substitute mission configuration only, at the existing roster/definition data seam.
 * Selection/assignment is tested in the pure reserve suites. The real controller still
 * restores sources, spawns, borrows, positions, equips and cleans up this small actor graph.
 * The official smoke below uses the untouched production roster and definition.
 */
function smallMission(f: ReturnType<typeof fixture>, friendly: VeteranRosterUnit[], enemy: VeteranRosterUnit[] = []) {
  const definition = veteranMissions.getVeteranMissionDefinition('veteran-scout-hunters')!
  const roster: VeteranMissionRoster = { playerIncluded: true, friendlyTotal: friendly.length + 1,
    enemyTotal: enemy.length, reinforcementTotal: 0, squadSizes: [friendly.length + 1], friendly, enemy, reinforcements: [] }
  vi.spyOn(veteranMissions, 'createVeteranRoster').mockImplementation(() => structuredClone(roster))
  vi.spyOn(veteranMissions, 'getVeteranMissionDefinition').mockReturnValue({ ...definition,
    friendlyCombatants: roster.friendlyTotal, enemyCombatants: roster.enemyTotal, squadSizes: roster.squadSizes })
  f.commit({ ...f.profile(), activeMission: { ...createActiveCareerMission('veteran-scout-hunters', 0, 0, 0, 'thin-field'),
    kind: 'veteran-field', friendlyActorIds: friendly.map(actor => actor.actorId), targetActorIds: enemy.map(actor => actor.actorId),
    borrowedActorIds: friendly.filter(actor => actor.source === 'town').map(actor => actor.actorId) } })
}

describe('Town cavalry mission and Patrol integration', () => {
  it('excludes both engaging Patrols from two reserve slots while retaining one available Town rider', () => {
    const f = fixture([patrolCaptain, patrolRider, 'town-patrol:b:captain', 'town-patrol:b:0', trainingRider])
    const members = f.residents.filter(resident => resident.spec.duty === 'patrol')
    const hostile = combatActor('ambient-threat', Faction.BANDIT)
    for (const captain of members.filter(r => r.spec.patrolLeader)) expect(f.patrol.noteHostileHit(captain.npc, hostile)).toBe(true)
    const positions = members.map(resident => resident.npc.combatPosition.clone())
    const unavailable = f.town.unavailableTownCavalryActorIds()
    expect(unavailable).toEqual(new Set([patrolCaptain, patrolRider, 'town-patrol:b:captain', 'town-patrol:b:0']))
    expect(selectTownCavalryReserve(f.residents, [{ unitType: 'sword_cavalry' }, { unitType: 'sword_cavalry' }], unavailable))
      .toEqual([trainingRider, undefined])
    expect(members.every(resident => f.patrol.combatEnabled(resident.npc))).toBe(true)
    expect(members.map(resident => resident.npc.combatPosition)).toEqual(positions)
    expect(f.borrow).not.toHaveBeenCalled()
  })

  it('hands a borrowed Captain to the mission before changing equipment, leaving its ordinary member with Patrol', () => {
    const f = fixture([patrolCaptain, patrolRider])
    const captain = f.residents.find(resident => resident.spec.id === patrolCaptain)!.npc
    const rider = f.residents.find(resident => resident.spec.id === patrolRider)!.npc
    f.stepPatrol()
    const position = captain.combatPosition.clone(), equip = vi.spyOn(captain, 'applyTemporaryCombatLoadout')
    smallMission(f, [unit(patrolCaptain, 'town', { tier: 4, heroRole: 'captain', leader: true })])
    expect(f.deploy()).toBe(true)
    expect(f.borrow).toHaveBeenCalledExactlyOnceWith(patrolCaptain)
    expect(f.borrow.mock.invocationCallOrder[0]).toBeLessThan(equip.mock.invocationCallOrder[0])
    expect(f.patrol.owns(captain)).toBe(false); expect(f.patrol.owns(rider)).toBe(true)
    expect(f.mission.friendlies).toEqual([captain])
    expect(captain.combatPosition).toEqual(position)
    expect(captain.formationCommandId).toBe(9000)
    f.stepPatrol()
    expect(captain.combatPosition).toEqual(position); expect(captain.formationCommandId).toBe(9000)
    // Deputy election and physical handover are owned by TownPatrolLifecycle.
  })

  it('restores positions for one borrowed actor and one temporary actor from a serialized checkpoint', () => {
    const f = fixture(['captain']), temporaryId = 'thin-field:temporary'
    smallMission(f, [unit('captain', 'town', { leader: true }), unit(temporaryId, 'temporary')])
    const saved = f.profile()
    saved.activeMission!.actorPositions = { captain: { x: -140, z: -70, yaw: .4 }, [temporaryId]: { x: -70, z: -45, yaw: .9 } }
    f.commit(JSON.parse(JSON.stringify(saved)) as CareerProfile)
    expect(f.deploy()).toBe(true)
    expect(f.mission.friendlies).toHaveLength(2); expect(f.mission.missionBandits).toHaveLength(0)
    expect(f.mission.friendlies[0]).toBe(f.residents[0].npc)
    expect(f.mission.friendlies.map(npc => npc.combatantId)).toEqual(['captain', temporaryId])
    expect(f.profile().activeMission!.borrowedActorIds).toEqual(['captain'])
    for (const [index, npc] of f.mission.friendlies.entries()) {
      expect(npc.combatPosition.x).toBe(index === 0 ? -140 : -70)
      expect(npc.combatPosition.z).toBe(index === 0 ? -70 : -45)
      expect(npc.group.rotation.y).toBe(index === 0 ? .4 : .9)
      expect(npc.mount!.group.position).toEqual(npc.group.position)
    }
    expect(f.borrow).toHaveBeenCalledExactlyOnceWith('captain')
  })

  it('places seven temporary friendlies across the first row boundary and obstacle fallback without spawning enemies', () => {
    // Blocks local searches and leaves a narrow strip at the western world bound.
    // The outer-ring fallback must reject clear but out-of-bounds candidates.
    const obstacle: ObstacleData = { box: new THREE.Box3(new THREE.Vector3(-294, -2, -20), new THREE.Vector3(-283, 15, 20)), isBarricade: false }
    const f = fixture([], { obstacles: [obstacle] })
    smallMission(f, Array.from({ length: 7 }, (_, index) => unit(`placement:${index}`, 'temporary', { leader: index === 0 })))
    expect(f.deploy()).toBe(true)
    const support = f.mission.friendlies
    expect(support).toHaveLength(7); expect(f.mission.missionBandits).toHaveLength(0)
    expect(support[0].combatPosition.distanceTo(VETERAN_FIELD_LAYOUT.supportApproach)).toBeGreaterThan(5.6)
    // Obstacle/occupied-slot fallback may relocate nominal row positions; their data contract
    // is checked without actors in VeteranFieldFormation. Here every placed rider must be safe.
    const entry = VETERAN_FIELD_LAYOUT.townEntry
    for (const [index, npc] of support.entries()) {
      const point = npc.combatPosition
      expect(point.x).toBeGreaterThanOrEqual(-296); expect(point.x).toBeLessThan(-275)
      expect(Math.abs(point.z)).toBeLessThan(296)
      expect(npc.formationCommandId).toBe(9001)
      expect(isObstaclePathClear(point, point, 1, 2.6, 0, f.world.obstacles)).toBe(true)
      expect(f.navigation.areConnected(point, entry)).toBe(true)
      expect(f.navigation.areConnected(entry, VETERAN_FIELD_LAYOUT.rally)).toBe(true)
      for (const other of support.slice(index + 1)) expect(Math.hypot(point.x - other.combatPosition.x, point.z - other.combatPosition.z)).toBeGreaterThanOrEqual(2.1)
    }
  })

  it('physically assembles two surviving Sweep riders through Town geometry with the Player far away', () => {
    const f = fixture(['captain', patrolRider], { world: true })
    const active = createCavalrySweepMission('small-sweep', ['captain', patrolRider])
    active.deadFriendlyActorIds = active.friendlyActorIds.slice(2)
    active.deadTargetActorIds = [...active.targetActorIds]
    f.commit({ ...f.profile(), activeMission: active })
    expect(f.deploy()).toBe(true)
    expect(f.mission.friendlies).toHaveLength(2); expect(f.mission.missionBandits).toHaveLength(0)
    f.player.group.position.set(-220, 0, 200)
    const marchStarted = vi.fn(); f.mission.onMarchStarted = marchStarted
    const combat = combatFixture({ controllers: { field: f.mission }, simulation: {
      player: () => f.player as unknown as Player, residents: f.residents, navigation: f.navigation,
      cameraPosition: new THREE.Vector3(20, 30, -82), obstacles: f.world.obstacles,
      preparePeaceResidents: excluded => f.patrol.beginFrame(excluded),
      peaceResident: (resident, dt) => {
        if (!f.patrol.updateResident(resident, dt, f.player.group.position, f.world.obstacles, f.navigation)) resident.npc.updateTownPeace(dt, 100, false, false)
      },
    } }).combat
    const starts = f.mission.friendlies.map(npc => npc.combatPosition.clone())
    let elapsed = 0
    advanceUntil(() => f.mission.phase === 'MARCHING', () => { combat.update(.05, 0, elapsed); elapsed += .05 }, {
      maxSimulationSeconds: 90, secondsPerStep: .05, failureMessage: 'two surviving Sweep riders must navigate the built Town to muster',
    })
    expect(f.mission.friendlies.every((npc, index) => !npc.dead && npc.combatPosition.distanceTo(starts[index]) > 20)).toBe(true)
    expect(marchStarted).toHaveBeenCalledOnce()
    expect(f.player.combatPosition.distanceTo(f.mission.missionLeader!.combatPosition)).toBeGreaterThan(200)
  })

  it('wires the official Scout roster once with native officers, full borrowed composition and one temporary Ranger', () => {
    // Full 99/40 materialization is the input: catches runtime truncation that all small graphs miss.
    const f = fixture(townRoster().filter(spec => spec.mounted || spec.role === 'ranger').map(spec => spec.id))
    const before = new Map(f.residents.map(resident => [resident.spec.id, resident.npc.combatPosition.clone()]))
    f.acceptOfficial()
    expect(f.town.openPanel).not.toHaveBeenCalled()
    const active = f.profile().activeMission!
    expect(f.mission.friendlies).toHaveLength(99); expect(f.mission.missionBandits).toHaveLength(40)
    expect(active.friendlyActorIds).toEqual(f.mission.friendlies.map(npc => npc.combatantId))
    expect(active.targetActorIds).toEqual(f.mission.missionBandits.map(npc => npc.combatantId))
    expect(active.borrowedActorIds).toHaveLength(98)
    expect(active.borrowedActorIds!.filter(id => id.startsWith('cavalry-training:'))).toHaveLength(60)
    expect(active.borrowedActorIds!.filter(id => id.startsWith('town-patrol:a:') && !id.endsWith(':captain'))).toHaveLength(19)
    expect(active.borrowedActorIds!.filter(id => id.startsWith('town-patrol:b:') && !id.endsWith(':captain'))).toHaveLength(16)
    expect(active.borrowedActorIds).toEqual(expect.arrayContaining(['captain', 'ranger', patrolCaptain]))
    expect(f.mission.friendlies.filter(npc => npc.tier === 4)).toHaveLength(4)
    expect(f.mission.friendlies.filter(npc => npc.tier === 3)).toHaveLength(95)
    const temporary = f.mission.friendlies.filter(npc => !active.borrowedActorIds!.includes(npc.combatantId))
    expect(temporary).toHaveLength(1)
    expect(temporary[0]).toMatchObject({ name: 'Maki / Mounted Ranger', combatProfileId: 'ranger', specialCombatProfile: 'maki-ranger' })
    expect(f.borrow).toHaveBeenCalledTimes(98)
    for (const id of active.borrowedActorIds!) {
      const npc = f.residents.find(resident => resident.spec.id === id)!.npc
      expect(f.mission.friendlies).toContain(npc)
      expect(npc.combatPosition).toEqual(before.get(id))
      expect(npc.formationCommandId).toBe(9000)
    }
  })

  it('settles one borrowed Patrol rider, one temporary friendly and one enemy through real return and cleanup', () => {
    const f = fixture([patrolRider])
    const resident = f.residents.find(resident => resident.spec.id === patrolRider)!
    const originalEquipment = { melee: resident.npc.meleeWeaponId, ranged: resident.npc.rangedWeaponId, shield: resident.npc.shieldId, tier: resident.npc.tier }
    const restore = vi.spyOn(resident.npc, 'restoreForTown'), dispose = vi.spyOn(resident.npc, 'dispose')
    smallMission(f, [unit(patrolRider, 'town', { leader: true }), unit('thin-field:temporary', 'temporary')],
      [unit('thin-field:enemy', 'mission', { presetId: 'viking_sword_cavalry', leader: true })])
    expect(f.deploy()).toBe(true)
    const temporary = f.mission.friendlies[1], enemy = f.mission.missionBandits[0], enemyMount = enemy.mount!
    for (const npc of f.mission.friendlies) npc.mount!.group.position.set(55, 0, -55)
    resident.npc.takeDamage(30); resident.homeMount.takeDamage(15)
    const position = resident.npc.combatPosition.clone(), hp = resident.npc.hp, mountHp = resident.homeMount.currentHp
    const settlement = new TownMissionSettlement({ read: f.profile, commit: f.commit }, {
      field: f.mission, duel: { actors: [], cleanupMission: vi.fn(), snapshot: () => f.mission.snapshot() },
      defense: { active: undefined, cleanupMission: vi.fn(), snapshot: () => f.mission.snapshot(), civilianSurvived: 0, civilianDeaths: 0 },
    }, {
      residents: f.residents, player: f.player, cat: { restoreForTown: vi.fn(), catVisual: null },
      world: f.world, navigation: f.navigation, inventory: f.town.inventory,
      releaseExternalThreat: vi.fn(), beginPatrolMissionReturn: id => { f.patrol.beginMissionReturn(id) },
      clearCombatShots: vi.fn(), restPlayer: vi.fn(), restart: vi.fn(),
    })
    expect(settlement.finish('victory').status).toBe('saved')
    expect(settlement.returnToTown('direct')).toEqual({ status: 'returned', kind: 'party' })
    expect(f.profile().activeMission).toBeUndefined(); expect(f.mission.friendlies).toHaveLength(0)
    expect(dispose).not.toHaveBeenCalled(); expect(resident.npc.group.parent).toBe(f.scene)
    expect(f.mission.departingNpcs).toEqual([temporary]); expect(temporary.tacticalOrder).toBe('formation')
    expect(enemy.group.parent).toBeNull(); expect(enemyMount.group.parent).toBeNull()
    expect(resident.npc.combatPosition).toEqual(position); expect(resident.npc.hp).toBe(hp)
    expect(resident.homeMount.currentHp).toBe(mountHp); expect(resident.npc.tier).toBe(3)
    expect(f.patrol.returnStateFor(patrolRider)).toBe('RETURN_TO_BARRACKS')
    expect(f.patrol.isReserveAvailable(patrolRider)).toBe(false); expect(restore).not.toHaveBeenCalled()
    f.mission.updateDepartingCavalry(); expect(f.mission.departingNpcs).toEqual([temporary])
    const temporaryMount = temporary.mount!
    temporaryMount.group.position.x = -285
    f.mission.updateDepartingCavalry()
    expect(f.mission.departingNpcs).toHaveLength(0)
    expect(temporary.group.parent).toBeNull(); expect(temporaryMount.group.parent).toBeNull()
    // Keep the canonical Captain in the graph, but isolate this rider's real travel to barracks.
    const stepReturn = () => {
      f.navigation.beginFrame(); f.patrol.beginFrame(new Set(f.residents.filter(r => r !== resident).map(r => r.npc)))
      f.patrol.updateResident(resident, .1, f.player.group.position, f.world.obstacles, f.navigation)
    }
    for (let frame = 0; frame < 20; frame++) stepReturn()
    expect(resident.npc.combatPosition.distanceTo(position)).toBeGreaterThan(1)
    expect(resident.npc.hp).toBe(hp); expect(resident.homeMount.currentHp).toBe(mountHp); expect(restore).not.toHaveBeenCalled()
    advanceUntil(() => f.patrol.returnStateFor(patrolRider) === 'REJOIN_PATROL', () => {
      const previous = resident.npc.combatPosition.clone(); stepReturn()
      expect(resident.npc.combatPosition.distanceTo(previous)).toBeLessThan(2)
    }, { maxSimulationSeconds: 120, secondsPerStep: .1, failureMessage: 'settlement rider must physically reach barracks before refit' })
    expect(restore).toHaveBeenCalledOnce()
    expect(resident.npc.combatPosition.x).toBeGreaterThanOrEqual(33); expect(resident.npc.combatPosition.x).toBeLessThanOrEqual(64.5)
    expect(resident.npc.combatPosition.z).toBeGreaterThanOrEqual(38); expect(resident.npc.combatPosition.z).toBeLessThanOrEqual(56)
    expect({ melee: resident.npc.meleeWeaponId, ranged: resident.npc.rangedWeaponId, shield: resident.npc.shieldId, tier: resident.npc.tier }).toEqual(originalEquipment)
    expect(resident.npc.hpRatio).toBe(1); expect(resident.homeMount.currentHp).toBe(resident.homeMount.maxHp)
    expect(resident.npc.mount).toBe(resident.homeMount); expect(f.patrol.isReserveAvailable(patrolRider)).toBe(true)
    expect(selectTownCavalryReserve(f.residents, [{ unitType: 'sword_cavalry' }], f.town.unavailableTownCavalryActorIds())).toEqual([patrolRider])
    // Reborrow through the same real controller callback, with no unrelated mission slots.
    smallMission(f, [unit(patrolRider, 'town', { leader: true })])
    expect(f.deploy()).toBe(true)
    expect(f.mission.friendlies).toEqual([resident.npc]); expect(f.patrol.returnStateFor(patrolRider)).toBeNull()
    expect(f.patrol.isReserveAvailable(patrolRider)).toBe(false); expect(dispose).not.toHaveBeenCalled()
  })
})
