import { completeNpcDeployment, gameplayNpcSpawnDriver } from '../helpers/npcSpawnFrames'
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BanditMissionController, VETERAN_FIELD_LAYOUT } from '../../src/career/BanditMissionController'
import { CAVALRY_SWEEP_ID } from '../../src/career/CavalrySweep'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { parseCareerProfile } from '../../src/career/CareerProfileStore'
import { createVeteranRoster, createVeteranSpawnSpec, VETERAN_MISSION_IDS } from '../../src/career/VeteranMission'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import type { Player } from '../../src/player/Player'
import { TownCavalryPatrolController } from '../../src/town/TownCavalryPatrolController'
import { TownMissionSettlement } from '../../src/town/TownMissionSettlement'
import { townMilitaryEquipment, townRoster } from '../../src/town/TownRules'
import { TownScene } from '../../src/town/TownScene'
import { TownWorld } from '../../src/town/TownWorld'
import { Mount, MountType } from '../../src/world/Mount'
import { AIType, Faction, NPC } from '../../src/world/NPC'
import { isObstaclePathClear } from '../../src/world/Terrain'
import { combatFixture } from '../helpers/townMissionCombat'

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

function fixture(options: { initial?: CareerProfile; unavailableTraining?: number; reserveCaptainA?: boolean; world?: boolean; patrolIds?: readonly ('A' | 'B')[]; trainingCount?: number } = {}) {
  const scene = new THREE.Scene(), navigation = new NavigationWorld()
  const context = new Proxy({ measureText: () => ({ width: 100 }) }, { get: (target, key) => (target as any)[key] ?? (() => {}) })
  vi.stubGlobal('ImageData', class { constructor(public data: unknown, public width: number, public height: number) {} })
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => context }) })
  const world = options.world ? new TownWorld('roman', scene) : { camps: [], obstacles: [] } as unknown as TownWorld
  if (options.world) cleanup.push(() => world.dispose())
  navigation.sync(world.obstacles)
  const baseline = createVeteranRoster('veteran-scout-hunters', 'roman')
  const rangerSpec = createVeteranSpawnSpec(baseline.friendly.find(unit => unit.actorId === 'ranger')!, 'roman')
  const selectedPatrols = options.patrolIds ?? ['A', 'B']
  const trainingIds = new Set(townRoster().filter(spec => spec.duty === 'training' && spec.mounted)
    .slice(0, options.trainingCount ?? 60).map(spec => spec.id))
  const residents = townRoster().filter(spec => spec.duty === 'patrol'
    ? selectedPatrols.includes(spec.patrolId!)
    : spec.duty === 'training' ? trainingIds.has(spec.id) : spec.mounted || spec.role === 'ranger').map(spec => {
    const equipment = townMilitaryEquipment('roman', spec), ranger = spec.role === 'ranger'
    const npc = new NPC(scene, spec.x, spec.z, Faction.TOWN, 'roman', ranger ? AIType.RANGED : AIType.MELEE,
      spec.id, ranger ? 4 : equipment.level, true, ranger ? rangerSpec.loadout : equipment.loadout,
      ranger ? rangerSpec.presetId : equipment.presetId, undefined, spec.id, undefined,
      ranger ? rangerSpec.visualAssetId : undefined, ranger ? rangerSpec.combatProfileId : undefined,
      ranger ? rangerSpec.specialCombatProfile : undefined)
    cleanup.push(() => npc.dispose())
    const homeMount = new Mount(scene, ranger ? MountType.BLACK_CAT : MountType.HORSE, spec.x, spec.z)
    cleanup.push(() => homeMount.dispose())
    homeMount.group.rotation.y = spec.yaw ?? 0
    npc.mountVehicle(homeMount); npc.setTownPeaceful()
    return { spec, npc, homeMount, cycle: -1, walkTime: 0 }
  })
  const patrol = new TownCavalryPatrolController(residents)
  let profile: CareerProfile = options.initial ?? {
    ...createCareerProfile('roman'), rank: 'veteran', totalMerit: 900, availableMerit: 900,
    ownedMounts: ['horse'], completedCareerMissionTemplateIds: [...VETERAN_MISSION_IDS],
  }
  const player = { group: new THREE.Group(), dead: false, hp: 100, staminaValue: 100,
    get combatPosition() { return this.group.position } }
  const town = Object.create(TownScene.prototype) as any
  const commit = (next: CareerProfile) => { profile = next; town.profile = next; return true }
  const mission = new BanditMissionController(scene, world, navigation,
    residents.find(resident => resident.spec.id === 'captain')!.npc, residents,
    () => player as unknown as Player, () => profile, commit)
  cleanup.push(() => mission.dispose())
  const borrow = vi.fn((actorId: string) => { patrol.relinquish(actorId) })
  mission.onBorrowMountedActor = borrow
  Object.assign(town, { profile, residents, patrol, mission, player, event: { hostile: false },
    store: { load: () => profile, loadChecked: () => ({ profile }) }, commit,
    careerMounts: { activate: vi.fn() }, inventory: { prepareForCombat: vi.fn(), sheathAll: vi.fn() },
    closePanel: vi.fn(), playMissionVoice: vi.fn(), openPanel: vi.fn(), dispose: vi.fn(), onRestart: vi.fn(),
  })
  const camera = new THREE.Vector3(0, 0, 100)
  const stepPatrol = (frames = 1) => {
    for (let frame = 0; frame < frames; frame++) {
      navigation.beginFrame(); patrol.beginFrame(new Set(mission.friendlies))
      for (const resident of residents) patrol.updateResident(resident, .1, camera, world.obstacles, navigation)
    }
  }
  // Put the standing Patrol into motion before borrowing, to distinguish current positions from startup points.
  stepPatrol(20)
  for (const resident of residents.filter(r => r.spec.duty === 'training').slice(0, options.unavailableTraining ?? 0)) {
    resident.npc.takeDamage(999999)
  }
  if (options.reserveCaptainA) patrol.relinquish('town-patrol:a:captain')
  const accept = () => completeNpcDeployment(() => town.acceptVeteranCareerMission('veteran-scout-hunters'), gameplayNpcSpawnDriver)
  return { scene, world, navigation, residents, patrol, mission, player, town, borrow, commit, stepPatrol, accept,
    profile: () => profile }
}

describe('Town cavalry mission and Patrol integration', () => {
  it('keeps both engaging Patrols busy and fills a mission shortage with temporary reinforcement', () => {
    const f = fixture({ unavailableTraining: 60 })
    const hostile = new NPC(f.scene, 0, 0, Faction.BANDIT, 'viking', AIType.MELEE, 'roaming', 1, false,
      undefined, undefined, undefined, 'roaming:bandit')
    cleanup.push(() => hostile.dispose())
    for (const squad of f.patrol.squads) expect(f.patrol.noteHostileHit(squad.members[0].npc, hostile)).toBe(true)
    const patrolActors = f.residents.filter(r => r.spec.duty === 'patrol').map(r => r.npc)
    const positions = patrolActors.map(npc => npc.combatPosition.clone())
    f.accept()
    expect(f.town.openPanel).not.toHaveBeenCalled()
    expect(f.profile().activeMission!.borrowedActorIds).toEqual(['captain', 'ranger'])
    expect(f.mission.friendlies.filter(npc => !['captain', 'ranger'].includes(npc.combatantId))).toHaveLength(97)
    expect(patrolActors.every(npc => f.patrol.combatEnabled(npc) && !f.mission.friendlies.includes(npc))).toBe(true)
    expect(patrolActors.map(npc => npc.combatPosition)).toEqual(positions)
    expect(f.borrow.mock.calls.some(([id]) => id.startsWith('town-patrol:'))).toBe(false)
  })

  it('physically assembles the Town Sweep through the full Town obstacles and starts marching with Player far away', () => {
    const f = fixture({ world: true })
    // This owner exercises Town geometry, borrowed cavalry separation and Patrol ownership.
    // Unrelated peaceful residents are not inputs to the mounted assembly decision.
    expect(f.residents).toHaveLength(102)
    f.player.group.position.set(-220, 0, 200)
    completeNpcDeployment(() => f.town.acceptMission(CAVALRY_SWEEP_ID), gameplayNpcSpawnDriver)
    expect(f.town.openPanel).not.toHaveBeenCalled()
    expect(f.mission.friendlies).toHaveLength(59)
    expect(f.profile().activeMission!.borrowedActorIds).toHaveLength(59)
    const marchStarted = vi.fn()
    f.mission.onMarchStarted = marchStarted
    const combat = combatFixture({ controllers: { field: f.mission }, simulation: {
      player: () => f.player as unknown as Player, residents: f.residents, navigation: f.navigation,
      cameraPosition: new THREE.Vector3(20, 30, -82), obstacles: f.world.obstacles,
      preparePeaceResidents: excluded => f.patrol.beginFrame(excluded),
      peaceResident: (resident, dt) => {
        if (!f.patrol.updateResident(resident, dt, f.player.group.position, f.world.obstacles, f.navigation)) {
          resident.npc.updateTownPeace(dt, 100, false, false)
        }
      },
    } }).combat
    let frames = 0
    for (; frames < 1800 && f.mission.phase === 'ASSEMBLING'; frames++) combat.update(.05, 0, frames * .05)
    const stragglers = f.mission.friendlies.filter(npc => !npc.isFormationTargetReached(9000)).map(npc => {
      const target = (npc as any).formationTarget?.position
      return { id: npc.combatantId, x: +npc.combatPosition.x.toFixed(2), z: +npc.combatPosition.z.toFixed(2),
        target: target ? { x: target.x, z: target.z } : null }
    })
    expect(f.mission.phase, JSON.stringify({ seconds: frames * .05, stragglers })).toBe('MARCHING')
    expect(f.mission.friendlies.every(npc => !npc.dead)).toBe(true)
    expect(marchStarted).toHaveBeenCalledOnce()
    expect(f.player.combatPosition.distanceTo(f.mission.missionLeader!.combatPosition)).toBeGreaterThan(200)
  }, 30000)

  it('accepts Scout Hunters with the full reserve policy, borrows actors in place and keeps the remaining Patrol moving', () => {
    const f = fixture(), before = new Map(f.residents.map(r => [r.spec.id, r.npc.combatPosition.clone()]))
    const officer = f.residents.find(r => r.spec.id === 'town-patrol:a:captain')!.npc
    const equipOfficer = vi.spyOn(officer, 'applyTemporaryCombatLoadout')
    f.accept()
    expect(f.town.openPanel).not.toHaveBeenCalled()
    const active = f.profile().activeMission!
    expect(active.friendlyActorIds).toHaveLength(99)
    expect(active.borrowedActorIds).toHaveLength(98)
    expect(active.borrowedActorIds!.filter(id => id.startsWith('cavalry-training:'))).toHaveLength(60)
    expect(active.borrowedActorIds!.filter(id => id.startsWith('town-patrol:a:') && !id.endsWith(':captain'))).toHaveLength(19)
    expect(active.borrowedActorIds!.filter(id => id.startsWith('town-patrol:b:') && !id.endsWith(':captain'))).toHaveLength(16)
    expect(active.borrowedActorIds).toContain('town-patrol:a:captain')
    expect(f.mission.friendlies.filter(npc => npc.tier === 4)).toHaveLength(4)
    expect(f.mission.friendlies.filter(npc => npc.tier === 3)).toHaveLength(95)
    const temporary = f.mission.friendlies.filter(npc => !active.borrowedActorIds!.includes(npc.combatantId))
    expect(temporary).toHaveLength(1)
    expect(temporary[0].name).toBe('Maki / Mounted Ranger')
    expect(f.borrow).toHaveBeenCalledTimes(98)
    const officerBorrow = f.borrow.mock.calls.findIndex(([id]) => id === officer.combatantId)
    expect(f.borrow.mock.invocationCallOrder[officerBorrow]).toBeLessThan(equipOfficer.mock.invocationCallOrder[0])
    for (const id of active.borrowedActorIds!) {
      const resident = f.residents.find(r => r.spec.id === id)!
      expect(f.mission.friendlies).toContain(resident.npc)
      expect(resident.npc.combatPosition.distanceTo(before.get(id)!)).toBeLessThan(.001)
      expect(resident.npc.formationCommandId).toBe(9000)
    }
    const remaining = f.residents.filter(r => r.spec.patrolId === 'B' && !active.borrowedActorIds!.includes(r.spec.id))
    expect(remaining).toHaveLength(4)
    const remainingBefore = remaining[0].npc.combatPosition.clone()
    f.stepPatrol(20)
    expect(f.patrol.squads[0].state).toBe('PAUSED')
    expect(f.patrol.squads[1].activeLeaderActorId).toBe('town-patrol:b:captain')
    expect(remaining[0].npc.combatPosition.distanceTo(remainingBefore)).toBeGreaterThan(1)
    const borrowed = f.residents.find(r => r.spec.id === 'town-patrol:a:0')!.npc
    expect(borrowed.combatPosition.distanceTo(before.get(borrowed.combatantId)!)).toBeLessThan(.001)
    const goal = (borrowed as any).formationTarget.position.clone(), start = borrowed.combatPosition.clone()
    for (let frame = 0; frame < 20; frame++) {
      const previous = borrowed.combatPosition.clone()
      f.navigation.beginFrame()
      borrowed.updateTownTravel(.1, 0, [], f.world.obstacles, f.navigation)
      expect(borrowed.combatPosition.distanceTo(previous)).toBeLessThan(2)
    }
    expect(borrowed.combatPosition.distanceTo(start)).toBeGreaterThan(1)
    expect(borrowed.combatPosition.distanceTo(goal)).toBeLessThan(start.distanceTo(goal))
  })

  it('elects a deputy for the partially borrowed Patrol when its Captain fills an existing T4 mission slot', () => {
    const f = fixture({ reserveCaptainA: true })
    f.accept()
    expect(f.profile().activeMission!.borrowedActorIds).toContain('town-patrol:b:captain')
    f.stepPatrol()
    const remaining = f.residents.filter(r => r.spec.patrolId === 'B'
      && !f.profile().activeMission!.borrowedActorIds!.includes(r.spec.id))
    expect(remaining).toHaveLength(3)
    expect(f.patrol.squads[1].activeLeaderActorId).toBe(remaining[0].spec.id)
    const before = remaining[0].npc.combatPosition.clone()
    f.stepPatrol(20)
    expect(remaining[0].npc.combatPosition.distanceTo(before)).toBeGreaterThan(1)
    expect(remaining.every(r => r.spec.tier === 2 && !r.spec.patrolLeader)).toBe(true)
    expect(f.residents.find(r => r.spec.id === 'town-patrol:b:captain')!.npc.formationCommandId).toBe(9000)
  })

  it('reloads the saved roster, source assignments and positions even when fresh Town availability would fill the old shortage', () => {
    const original = fixture({ unavailableTraining: 10 })
    original.accept()
    const ids = [...original.profile().activeMission!.friendlyActorIds]
    const borrowedIds = [...original.profile().activeMission!.borrowedActorIds!]
    expect(borrowedIds).toHaveLength(91)
    const actors = [original.mission.friendlies.find(npc => npc.combatantId.startsWith('town-patrol:'))!,
      original.mission.friendlies.find(npc => !borrowedIds.includes(npc.combatantId))!]
    actors.forEach((npc, index) => npc.mount!.group.position.set(-140 + index * 70, 0, -70 + index * 25))
    original.mission.persistRuntimeProgress(true)
    const saved = parseCareerProfile(JSON.parse(JSON.stringify(original.profile())))!
    const positions = saved.activeMission!.actorPositions!
    const restored = fixture({ initial: saved })
    expect(restored.residents.filter(r => r.spec.duty === 'training' && !r.npc.dead)).toHaveLength(60)
    expect(completeNpcDeployment(() => restored.mission.startActiveMission(), gameplayNpcSpawnDriver)).toBe(true)
    expect(restored.profile().activeMission!.friendlyActorIds).toEqual(ids)
    expect(restored.profile().activeMission!.borrowedActorIds).toEqual(borrowedIds)
    expect(restored.mission.friendlies).toHaveLength(99)
    expect(restored.mission.friendlies.filter(npc => !borrowedIds.includes(npc.combatantId))).toHaveLength(8)
    expect(restored.borrow).toHaveBeenCalledTimes(91)
    for (const npc of restored.mission.friendlies) {
      expect(npc.combatPosition.x).toBe(positions[npc.combatantId].x)
      expect(npc.combatPosition.z).toBe(positions[npc.combatantId].z)
    }
  })

  it('places a large temporary shortage at safe map-edge slots with connected entry and muster routes', () => {
    const f = fixture({ world: true, patrolIds: [], trainingCount: 0 })
    f.accept()
    expect(f.town.openPanel).not.toHaveBeenCalled()
    const borrowedIds = f.profile().activeMission!.borrowedActorIds!
    expect(borrowedIds).toEqual(['captain', 'ranger'])
    const support = f.mission.friendlies.filter(npc => !borrowedIds.includes(npc.combatantId))
    expect(support).toHaveLength(97)
    for (let index = 0; index < support.length; index++) {
      const npc = support[index], point = npc.combatPosition, entry = (npc as any).formationTarget.position
      expect(point.x).toBeGreaterThanOrEqual(-296)
      expect(point.x).toBeLessThan(-275)
      expect(Math.abs(point.z)).toBeLessThan(296)
      expect(npc.formationCommandId).toBe(9001)
      expect(isObstaclePathClear(point, point, 1, 2.6, 0, f.world.obstacles)).toBe(true)
      expect(f.navigation.areConnected(point, entry)).toBe(true)
      expect(f.navigation.areConnected(entry, VETERAN_FIELD_LAYOUT.rally)).toBe(true)
      for (let other = index + 1; other < support.length; other++) {
        expect(Math.hypot(point.x - support[other].combatPosition.x, point.z - support[other].combatPosition.z)).toBeGreaterThanOrEqual(2.1)
      }
    }
    expect(f.mission.missionBandits).toHaveLength(40)
  })

  it('settles Veteran missions in place, sends Patrol to barracks and keeps only friendly temporary actors alive for departure', () => {
    const f = fixture({ patrolIds: ['A'] })
    const patrolRider = f.residents.find(r => r.spec.id === 'town-patrol:a:0')!
    const originalEquipment = { melee: patrolRider.npc.meleeWeaponId, ranged: patrolRider.npc.rangedWeaponId,
      shield: patrolRider.npc.shieldId, tier: patrolRider.npc.tier }
    const restorePatrol = vi.spyOn(patrolRider.npc, 'restoreForTown')
    f.accept()
    const active = f.profile().activeMission!, borrowedIds = active.borrowedActorIds!
    const temporary = f.mission.friendlies.filter(npc => !borrowedIds.includes(npc.combatantId))
    const enemy = [...f.mission.missionBandits]
    const enemyMounts = enemy.map(npc => npc.mount!)
    for (const npc of f.mission.friendlies) npc.mount!.group.position.set(55, 0, -55)
    patrolRider.npc.takeDamage(30)
    patrolRider.homeMount.takeDamage(15)
    const returnPosition = patrolRider.npc.combatPosition.clone(), returnHp = patrolRider.npc.hp
    const returnHorseHp = patrolRider.homeMount.currentHp
    const settlement = new TownMissionSettlement({ read: f.profile, commit: f.commit }, {
      field: f.mission, duel: { actors: [], cleanupMission: vi.fn(), snapshot: vi.fn() },
      defense: { active: false, cleanupMission: vi.fn(), snapshot: vi.fn(), civilianSurvived: 0, civilianDeaths: 0 },
    } as any, {
      residents: f.residents, player: f.player, cat: f.residents.find(r => r.spec.id === 'ranger')!.homeMount,
      world: f.world, navigation: f.navigation, inventory: f.town.inventory,
      releaseExternalThreat: vi.fn(), beginPatrolMissionReturn: id => f.patrol.beginMissionReturn(id),
      clearCombatShots: vi.fn(), restPlayer: vi.fn(), restart: vi.fn(),
    })
    expect(settlement.finish('victory').status).toBe('saved')
    expect(settlement.returnToTown('direct')).toEqual({ status: 'returned', kind: 'party' })
    expect(f.profile().activeMission).toBeUndefined()
    expect(f.mission.friendlies).toHaveLength(0)
    expect(f.mission.departingNpcs).toEqual(temporary)
    expect(enemy.every(npc => npc.group.parent === null)).toBe(true)
    expect(enemyMounts.every(mount => mount.group.parent === null)).toBe(true)
    expect(temporary.every(npc => npc.group.parent === f.scene && npc.tacticalOrder === 'formation')).toBe(true)
    expect(patrolRider.npc.combatPosition).toEqual(returnPosition)
    expect(patrolRider.npc.hp).toBe(returnHp)
    expect(patrolRider.npc.tier).toBe(3)
    expect(f.patrol.returnStateFor(patrolRider.spec.id)).toBe('RETURN_TO_BARRACKS')
    expect(f.patrol.isReserveAvailable(patrolRider.spec.id)).toBe(false)
    expect(restorePatrol).not.toHaveBeenCalled()
    f.mission.updateDepartingCavalry()
    expect(f.mission.departingNpcs).toHaveLength(17)
    for (const npc of temporary) npc.mount!.group.position.x = -285
    f.mission.updateDepartingCavalry()
    expect(f.mission.departingNpcs).toHaveLength(0)
    expect(temporary.every(npc => npc.group.parent === null)).toBe(true)

    // Follow the actual settlement-issued return, rather than moving this rider to its target.
    // Other returned riders are excluded here so this case isolates the refit/reborrow boundary.
    const excluded = new Set(f.residents.filter(r => r !== patrolRider).map(r => r.npc))
    const stepReturn = () => {
      f.navigation.beginFrame(); f.patrol.beginFrame(excluded)
      f.patrol.updateResident(patrolRider, .1, f.player.group.position, f.world.obstacles, f.navigation)
    }
    stepReturn()
    const goal = (patrolRider.npc as any).formationTarget.position.clone()
    // The Barracks courtyard lies directly south of the real hut at (34, 30).
    // Assert its world bounds independently of the refit-position helper.
    expect(goal.x).toBeGreaterThanOrEqual(33)
    expect(goal.x).toBeLessThanOrEqual(64.5)
    expect(goal.z).toBeGreaterThanOrEqual(38)
    expect(goal.z).toBeLessThanOrEqual(56)
    expect(Math.hypot(goal.x - patrolRider.spec.x, goal.z - patrolRider.spec.z)).toBeGreaterThan(20)
    expect(patrolRider.npc.hp).toBe(returnHp)
    expect(patrolRider.homeMount.currentHp).toBe(returnHorseHp)
    for (let frame = 0; frame < 1200 && f.patrol.returnStateFor(patrolRider.spec.id) === 'RETURN_TO_BARRACKS'; frame++) {
      const previous = patrolRider.npc.combatPosition.clone()
      stepReturn()
      expect(patrolRider.npc.combatPosition.distanceTo(previous)).toBeLessThan(2)
    }
    expect(f.patrol.returnStateFor(patrolRider.spec.id)).toBe('REJOIN_PATROL')
    expect(restorePatrol).toHaveBeenCalledOnce()
    expect(patrolRider.npc.combatPosition.x).toBe(goal.x)
    expect(patrolRider.npc.combatPosition.z).toBe(goal.z)
    expect({ melee: patrolRider.npc.meleeWeaponId, ranged: patrolRider.npc.rangedWeaponId,
      shield: patrolRider.npc.shieldId, tier: patrolRider.npc.tier }).toEqual(originalEquipment)
    expect(patrolRider.npc.hpRatio).toBe(1)
    expect(patrolRider.homeMount.currentHp).toBe(patrolRider.homeMount.maxHp)
    expect(patrolRider.npc.mount).toBe(patrolRider.homeMount)
    expect(f.patrol.isReserveAvailable(patrolRider.spec.id)).toBe(true)

    // Q5 permits borrowing immediately after refit, while this actor is still rejoining.
    f.accept()
    expect(f.profile().activeMission!.borrowedActorIds).toContain(patrolRider.spec.id)
    expect(f.mission.friendlies.find(npc => npc.combatantId === patrolRider.spec.id)).toBe(patrolRider.npc)
    expect(f.patrol.returnStateFor(patrolRider.spec.id)).toBeNull()
    expect(f.patrol.isReserveAvailable(patrolRider.spec.id)).toBe(false)
    const reborrowedPosition = patrolRider.npc.combatPosition.clone()
    f.stepPatrol(10)
    expect(patrolRider.npc.formationCommandId).toBe(9000)
    expect(patrolRider.npc.combatPosition).toEqual(reborrowedPosition)
  })
})
