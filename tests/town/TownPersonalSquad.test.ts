import { advanceUntil } from '../helpers/simulation'
import { personalTownDeployment, personalTownEagleDeployment } from '../../src/career/PersonalSquadDeployment'
import { createAssaultRoster } from '../../src/career/EnemyTownAssault'
import { siegeMuster } from '../../src/career/TownSiege'
import { eagleLandingFootprint, isEagleLandingClear } from '../../src/world/EagleLanding'
import { eagleTrainerSpec } from '../../src/town/TownEagleTrainingGround'
import { townEagleRoster } from '../../src/town/TownEagleGarrison'
import { townPatrolRoute } from '../../src/town/TownPatrolRoute'
import { EagleFlightController } from '../../src/movement/EagleFlightController'
import { completeNpcDeployment, drainNpcSpawns, gameplayNpcSpawnDriver } from '../helpers/npcSpawnFrames'
import { parseCareerProfile } from '../../src/career/CareerProfileStore'
import { CareerMountController } from '../../src/career/CareerMountController'
import { careerEaglePadOwners, EaglePadReservations } from '../../src/career/EaglePadReservations'
import { initialPersonalEquipment } from '../../src/career/CareerInventory'
import * as THREE from 'three'
import { OBB } from 'three/examples/jsm/math/OBB.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { claimCareerMission, cloneCareerProfile, createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { TownWorld } from '../../src/town/TownWorld'
import { resolveTownHRLayout, hrOfficerSpec, townConquestRoster } from '../../src/town/TownHRLayout'
import { TownPersonalSquadController } from '../../src/town/TownPersonalSquadController'
import { TOWN_CITY } from '../../src/town/TownLayout'
import { TOWN_SITES, TownEvent, townMilitaryEquipment, isTownMilitary, townActorHeroProfile, townAssaultObjectiveRoster, settleTown } from '../../src/town/TownRules'
import { NPC, AIState, AIType, Faction } from '../../src/world/NPC'
import { MountType, mountTypeFromId } from '../../src/world/Mount'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { TOWN_NAVIGATION_BOUNDS } from '../../src/town/TownBounds'
import { getTerrainHeight, isObstaclePathClear, type ObstacleData } from '../../src/world/Terrain'
import { townWartimeHostile } from '../../src/town/TownWartime'
import type { Player } from '../../src/player/Player'
import { combatActor, combatFixture } from '../helpers/townMissionCombat'
import { createTownCombatFixture } from '../helpers/townCombatFixture'
import { careerMissionCommandMeritPolicy, createActiveCareerMission } from '../../src/career/CareerMissionState'
import { PersonalSquadRuntime } from '../../src/career/PersonalSquadRuntime'
import { parsePersonalMission, snapshotPersonalMission } from '../../src/career/CareerPersonalSquadMission'
import { BattleStatsTracker } from '../../src/combat/BattleStatsTracker'
import { CombatEventStream } from '../../src/combat/CombatAttribution'

vi.mock('../../src/world/PaladinEquipment', () => ({ createPaladinEquipment: () => new THREE.Group() }))

vi.mock('../../src/world/XongkoroVisual', async () => ({ XongkoroVisual: (await import('../helpers/gameplayEagleVisual')).GameplayEagleVisualDouble }))
vi.mock('../../src/world/HorseAssetRegistry', async importOriginal => ({ ...(await importOriginal<typeof import('../../src/world/HorseAssetRegistry')>()), HorseAssetRegistry: {
  ready: true, createInstance: () => {
    const root = new THREE.Group(), saddleSeat = new THREE.Object3D(); saddleSeat.position.y = 1.7; root.add(saddleSeat)
    return { root, saddleSeat, lod: new THREE.LOD(), skeleton: null, setLocomotion() {}, setAppearanceVariant() {}, playOnce() {}, playStudioClip() {}, playDeath() {}, update() {}, dispose() {} }
  },
} }))
vi.mock('../../src/world/MakiRangerEquipment', async importOriginal => ({ ...(await importOriginal<typeof import('../../src/world/MakiRangerEquipment')>()), createMakiRangerBowInstance: () => ({
  model: new THREE.Group(), topTip: new THREE.Vector3(0, .8, 0), bottomTip: new THREE.Vector3(0, -.8, 0),
  profile: { id: 'maki-ranger-bow', gripRadius: .02, gripLength: .2, visualScale: 1,
    gripCenterLocal: new THREE.Vector3(), shootingAxis: new THREE.Vector3(0, 0, -1),
    longitudinalAxis: new THREE.Vector3(0, 1, 0), contactNormal: new THREE.Vector3(1, 0, 0) },
}) }))
const cleanups: (() => void)[] = []
afterEach(() => { cleanups.splice(0).reverse().forEach(fn => fn()); vi.unstubAllGlobals() })
function renderingScene() {
  const context = new Proxy<Record<string, unknown>>({ measureText: () => ({ width: 100 }) }, {
    get: (target, key) => typeof key === 'string' ? target[key] ?? (() => {}) : undefined,
  })
  vi.stubGlobal('ImageData', class { constructor(public data: unknown, public width: number, public height: number) {} })
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => context }) })
  return new THREE.Scene()
}
function harness(faction: 'roman' | 'viking' = 'roman', count = 3) {
  const scene = renderingScene(), hr = resolveTownHRLayout(faction, [], [])
  const obstacles: ObstacleData[] = []
  const profile = { ...createCareerProfile(faction), rank: 'captain' as const,
    personalSquad: { members: Array.from({ length: count }, (_, i) => ({ id: `personal:${i}`, type: (['soldier', 'captain', 'ranger'] as const)[i % 3] })) } }
  const player = { group: new THREE.Group(), get combatPosition() { return this.group.position }, dead: false } as Player
  player.group.position.set(35, getTerrainHeight(35, 60), 60)
  const controller = new TownPersonalSquadController(scene, hr, () => profile, () => player)
  cleanups.push(() => controller.cleanup())
  const navigation = new NavigationWorld(TOWN_NAVIGATION_BOUNDS); navigation.sync(obstacles)
  const step = (frames: number) => {
    for (let i = 0; i < frames; i++) {
      navigation.sync(obstacles); navigation.beginFrame()
      for (const actor of controller.actors) actor.updateTownTravel(.05, 30, controller.actors, obstacles, navigation)
      controller.updateLifecycle()
    }
  }
  return { scene, hr, profile, player, controller, navigation, step }
}
// Geometry owns the built Town; runtime cases below need only an HR layout and real actors.
function townGeometry(faction: 'roman' | 'viking') {
  const world = new TownWorld(faction, renderingScene())
  let disposed = false
  const dispose = () => { if (!disposed) { disposed = true; world.dispose() } }
  cleanups.push(dispose)
  const navigation = new NavigationWorld(TOWN_NAVIGATION_BOUNDS)
  navigation.sync(world.obstacles)
  return { world, navigation, dispose }
}
/** Intersect the complete finite travel segment, rather than sampling a few waypoints. */
function crossesPadCorridor(footprint: THREE.Box3, start: THREE.Vector3, end: THREE.Vector3, halfWidth: number): boolean {
  const corridor = footprint.clone().expandByVector(new THREE.Vector3(halfWidth, 0, halfWidth))
  if (corridor.containsPoint(start)) return true
  const direction = end.clone().sub(start), length = direction.length()
  if (length === 0) return false
  const contact = new THREE.Ray(start, direction.divideScalar(length)).intersectBox(corridor, new THREE.Vector3())
  return contact !== null && start.distanceTo(contact) <= length
}
describe('HR Center and personal runtime', () => {
  it('HR refit persists first, revives soldiers and mounts, replenishes equipment and keeps Follow', () => {
    // Two real members and one owned mount exercise the shared revival lifecycle without a TownWorld.
    const { controller, profile } = harness('roman', 2)
    completeNpcDeployment(() => controller.follow(), gameplayNpcSpawnDriver)
    const [soldier, captain] = controller.actors, mount = captain.mount!
    soldier.takeDamage(99999); mount.takeDamage(99999)
    captain.restoreCombatAmmo(0); captain.shield.shieldImpactRemaining = 0
    expect(controller.refit(() => false)).toBe(false)
    expect(soldier.dead).toBe(true); expect(mount.dead).toBe(true)
    expect(controller.refit(next => { Object.assign(profile, next); return true })).toBe(true)
    expect(soldier.dead).toBe(false); expect(soldier.hp).toBe(soldier.maxHp)
    expect(mount.dead).toBe(false); expect(mount.currentHp).toBe(mount.maxHp)
    expect(captain.mount).toBe(mount); expect(mount.riderNpc).toBe(captain)
    expect(captain.isFalling).toBe(false)
    expect(captain.shield.shieldImpactRemaining).toBe(captain.shield.shieldImpactMax)
    expect(controller.actors.every(actor => actor.tacticalOrder === 'follow')).toBe(true)
    const restored = parseCareerProfile(JSON.parse(JSON.stringify(profile)))!
    expect(restored.personalSquadRuntime?.members[soldier.combatantId]).toMatchObject({ status: 'deployed', hp: soldier.maxHp, order: 'follow' })
    controller.resumeCommand('charge'); captain.setTacticalOrder('charge')
    const save = vi.fn(() => true)
    expect(controller.refit(save)).toBe(false); expect(save).not.toHaveBeenCalled()
  })

  it('keeps shared Player and actual eagle-owner pad identities across roster reordering and releases reassigned owners', () => {
    const profile = { ...createCareerProfile('roman'), selectedMountId: 'xongkoro' as const, personalSquad: { members: [
      { id: 'personal:foot', type: 'soldier' as const },
      { id: 'personal:ranger', type: 'ranger' as const, equipment: { melee: null, ranged: null, shield: null, mount: 'xongkoro' as const } },
      { id: 'personal:captain', type: 'captain' as const, equipment: { melee: 'centurion_blade', ranged: null, shield: null, mount: 'xongkoro' as const } },
    ] } }
    const pads = new EaglePadReservations([1, 2, 3].map(index => ({ id: `private-eagle-pad:${index}`, x: index * 30, z: 0, yaw: 0 })))
    pads.syncOwners(careerEaglePadOwners(profile))
    expect(pads.get('player')?.id).toBe('private-eagle-pad:1')
    expect(pads.get('personal:captain')?.id).toBe('private-eagle-pad:2')
    expect(pads.get('personal:ranger')?.id).toBe('private-eagle-pad:3')
    expect(pads.get('personal:foot')).toBeUndefined(); expect(pads.reserve('legacy-fourth')).toBeUndefined()
    profile.personalSquad.members.reverse(); pads.syncOwners(careerEaglePadOwners(profile))
    expect(pads.get('personal:captain')?.id).toBe('private-eagle-pad:2')
    expect(pads.get('personal:ranger')?.id).toBe('private-eagle-pad:3')
    pads.syncOwners(['player', 'personal:ranger'])
    expect(pads.get('personal:captain')).toBeUndefined()
    expect(pads.reserve('personal:replacement')?.id).toBe('private-eagle-pad:2')
    expect(pads.get('personal:ranger')?.id).toBe('private-eagle-pad:3')
  })

  it('rolls back a failed Player eagle activation reservation and preserves nearby summon after a successful retry', () => {
    // At most one real Mount at a time and a Player boundary; no NPC, TownWorld or asset loading.
    const scene = renderingScene(), group = new THREE.Group()
    group.position.set(0, getTerrainHeight(0, 0), 0)
    const mountVehicle = vi.fn(), player = { group, get combatPosition() { return group.position }, facingYaw: 0,
      isFalling: false, isMounted: false, currentMount: null, mountVehicle } as unknown as Player
    let profile: CareerProfile = { ...createCareerProfile('roman'), rank: 'captain' as const, ownedMounts: ['xongkoro' as const],
      inventory: { version: 1 as const, quantities: { xongkoro: 1 } } }
    const pads = new EaglePadReservations([1, 2, 3].map(index => ({ id: `private-eagle-pad:${index}`, x: 150 + index * 30, z: 100, yaw: 0 })))
    let save = false
    const controller = new CareerMountController(scene, () => player, () => profile, next => { if (!save) return false; profile = next; return true },
      () => [], () => [], () => 'town-home', { eaglePads: pads })
    cleanups.push(() => controller.dispose())
    const before = structuredClone(profile)
    expect(controller.activate('xongkoro')).toBe(false)
    expect(profile).toEqual(before); expect(controller.activeMount).toBeNull()
    expect(pads.get('player')).toBeUndefined(); expect(scene.children).toHaveLength(0)
    expect(mountVehicle).not.toHaveBeenCalled()
    save = true
    expect(controller.activate('xongkoro')).toBe(true)
    expect(pads.get('player')?.id).toBe('private-eagle-pad:1')
    expect(controller.activeMount!.group.position.distanceTo(group.position)).toBeLessThan(46)
    expect(mountVehicle).toHaveBeenCalledOnce()
    controller.release('xongkoro')
    expect(pads.get('player')).toBeUndefined(); expect(controller.activeMount).toBeNull()
  })

  it('carries unmaterialized private casualties and wounded eagle reserves into a new mission without refitting them', () => {
    // No NPC, Mount, world or assets: both checkpoints deliberately remain unmaterialized.
    const profile: CareerProfile = { ...createCareerProfile('roman'), rank: 'captain', personalSquad: { members: [
      { id: 'personal:dead', type: 'soldier' }, { id: 'personal:reserve', type: 'captain',
        equipment: { melee: 'centurion_blade', ranged: null, shield: null, mount: 'xongkoro' } },
    ] } }
    const saved = snapshotPersonalMission(profile)!
    saved.members['personal:dead'] = { status: 'dead', hp: 0, ammo: 0 }
    saved.members['personal:reserve'] = { status: 'reserve', hp: 37, eaglePadId: 'private-eagle-pad:2',
      mount: { hp: 0, mounted: false, position: { x: 60, z: 60, yaw: .4 } } }
    const player = { group: new THREE.Group(), combatPosition: new THREE.Vector3(), dead: false } as unknown as Player
    const runtime = new PersonalSquadRuntime(new THREE.Scene(), [], () => profile, () => player)
    cleanups.push(() => runtime.cleanup())
    runtime.restoreMission(saved)
    const before = runtime.checkpoint()!
    const captured = runtime.captureForMission(snapshotPersonalMission(profile)!)
    expect(captured.memberIds).toEqual(['personal:dead', 'personal:reserve'])
    expect(captured.members).toEqual(before.members)
    expect(runtime.actors).toHaveLength(0); expect(runtime.mounts).toHaveLength(0)
    expect(runtime.checkpoint()).toEqual(before)
    expect(parsePersonalMission(JSON.parse(JSON.stringify(captured)))?.members).toEqual(before.members)
  })

  it('restores an already-saved legacy Player eagle when three squad home pads are reserved', () => {
    // One real Mount with a Player boundary and three data-only squad owners.
    const scene = renderingScene(), group = new THREE.Group()
    const player = { group, get combatPosition() { return group.position }, facingYaw: 0, currentMount: null,
      mountVehicle: vi.fn() } as unknown as Player
    const profile: CareerProfile = { ...createCareerProfile('roman'), rank: 'captain', selectedMountId: 'xongkoro', ownedMounts: ['xongkoro'],
      inventory: { version: 1, quantities: { xongkoro: 4 } }, personalSquad: { members: ['a', 'b', 'c'].map(id => ({
        id: `personal:${id}`, type: 'ranger', equipment: { melee: null, ranged: null, shield: null, mount: 'xongkoro' } })) } }
    profile.personalSquadRuntime = snapshotPersonalMission(profile)!
    for (const [index, member] of profile.personalSquad!.members.entries()) profile.personalSquadRuntime.members[member.id].eaglePadId = `private-eagle-pad:${index + 1}`
    profile.playerAerialState = { sceneKey: 'town-home', hp: 100, dead: false, position: { x: 20, y: 34, z: 30, yaw: 0 },
      mount: { hp: 100, position: { x: 20, y: 30, z: 30, yaw: 0 }, flight: { phase: 'cruise', yaw: 0, pitch: 0, bank: 0, speed: 15, velocity: { x: 0, y: 0, z: 15 } } } }
    const pads = new EaglePadReservations([1, 2, 3].map(index => ({ id: `private-eagle-pad:${index}`, x: index * 30, z: 60, yaw: 0 })))
    const controller = new CareerMountController(scene, () => player, () => profile, () => false, () => [], () => [], () => 'town-home', { eaglePads: pads })
    cleanups.push(() => controller.dispose())
    expect(pads.get('player')).toBeUndefined()
    expect(controller.restoreActiveMount()).toBe(true)
    expect(controller.activeMount!.group.position).toMatchObject({ x: 20, y: 30, z: 30 })
    expect(pads.get('player')).toBeUndefined(); expect(pads.pads).toHaveLength(3)
    expect(profile.inventory?.quantities.xongkoro).toBe(4)
  })

  it.each(['roman', 'viking'] as const)('places %s hall, isolated eagle pads and terrain-anchored signs with a plaza-facing walk-through training board', faction => {
    const { world, navigation, dispose } = townGeometry(faction)
    const hr = world.buildings.find(building => building.id === 'hr-center')!
    expect(hr).toBeDefined()
    expect([world.hr.width, world.hr.depth]).toEqual(faction === 'roman' ? [16, 13] : [13, 22])
    expect(hr.hp.maxHp).toBe(world.buildings.find(building => building.id === 'hall')!.hp.maxHp)
    expect((world.hr.site.x - TOWN_SITES.stable.x) * Math.sin(TOWN_SITES.stable.yaw)
      + (world.hr.site.z - TOWN_SITES.stable.z) * Math.cos(TOWN_SITES.stable.yaw)).toBeLessThan(0)
    expect(world.hr.site.x).toBeGreaterThan(TOWN_CITY.minX)
    for (const building of world.buildings.filter(building => building !== hr)) for (const obstacle of building.obstacles) {
      expect(obstacle.box.intersectsBox(hr.obstacles[0].box), building.id).toBe(false)
    }
    const eagle = world.eagleTraining
    expect(eagle.pads.map(pad => pad.id)).toEqual(['private-eagle-pad:1', 'private-eagle-pad:2', 'private-eagle-pad:3'])
    expect(eagle.candidatePads).toHaveLength(30)
    const trainer = eagleTrainerSpec(eagle)
    expect(trainer).toMatchObject({ id: 'eagle-trainer', role: 'eagle-trainer', tier: 4, mounted: false })
    expect(townConquestRoster(world.hr, undefined, eagle).filter(spec => spec.id === 'eagle-trainer')).toHaveLength(1)
    expect(townAssaultObjectiveRoster([trainer]).map(spec => spec.id)).toEqual(['eagle-trainer'])
    expect(navigation.areConnected(eagle.trainer, world.hr.officer)).toBe(true)
    // Reuse this geometry owner: one TownWorld and NavigationWorld per faction, no NPCs/Mounts/GLBs.
    expect(world.eagleGarrison.pads).toHaveLength(5)
    const pads = [...eagle.pads, ...world.eagleGarrison.pads], patrol = townPatrolRoute()
    const footprints = pads.map(pad => eagleLandingFootprint(pad))
    const ownedSignResources = new Set<THREE.BufferGeometry | THREE.Material | THREE.Texture>()
    const borrowedSignMaterials = new Set<THREE.Material>()
    // Reuse the built-world owner to check the actual supports and collider registration,
    // including different terrain heights at the two feet, rather than cosmetic mesh names.
    for (const center of [{ name: 'eagle training', x: trainer.x - 4.5, z: trainer.z + 3.5, bilingual: true, walkThrough: true },
      { name: 'eagle garrison', x: world.eagleGarrison.pads[0].x, z: world.eagleGarrison.pads[0].z - 10, bilingual: true, walkThrough: false },
      ...[47, 82, 117].map(x => ({ name: `cavalry ${x}`, x, z: -101, bilingual: false, walkThrough: false }))]) {
      const board = world.root.children.find(child => child instanceof THREE.Group
        && Math.abs(child.position.x - center.x) < 1e-6 && Math.abs(child.position.z - center.z) < 1e-6)
      expect(board, `grounded board at ${center.x}, ${center.z}`).toBeDefined()
      board!.updateWorldMatrix(true, true)
      const label = board!.children.find((child): child is THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> =>
        child instanceof THREE.Mesh && child.geometry instanceof THREE.PlaneGeometry
          && child.material instanceof THREE.MeshBasicMaterial && child.material.map !== null)
      expect(label, `${center.name} textured label`).toBeDefined()
      const { width, height } = label!.geometry.parameters
      const front = new THREE.Vector3(0, 0, 1).transformDirection(label!.matrixWorld)
      const up = new THREE.Vector3(0, 1, 0).transformDirection(label!.matrixWorld)
      if (center.walkThrough) {
        // The actual paved square spans x=-17..18, z=-10..10; do not compare to a yaw constant.
        expect(world.roads).toContainEqual({ ax: -17, az: 0, bx: 18, bz: 0, width: 2.1 })
        const towardPlaza = new THREE.Vector3(.5 - center.x, 0, -center.z).normalize()
        expect(front.dot(towardPlaza), `${faction} training label faces the paved plaza`).toBeCloseTo(1, 6)
        const eye = new THREE.Vector3(.5, getTerrainHeight(.5, -10) + 1.7, -10)
        world.root.updateWorldMatrix(true, true)
        for (const pixelY of [48, 108]) {
          const target = label!.localToWorld(new THREE.Vector3(0, (.5 - pixelY / 160) * height, 0))
          const ray = new THREE.Raycaster(eye, target.clone().sub(eye).normalize(), 0, eye.distanceTo(target) + .5)
          expect(ray.intersectObject(world.root, true)[0]?.object === label,
            `${faction} plaza edge at z=-10 first sees text band ${pixelY} in the complete Town`).toBe(true)
        }
      } else {
        expect(front.toArray(), `${center.name} retains its existing direction`).toEqual([0, 0, 1])
      }
      // Sample across each text band on the 1024 x 160 canvas. Intersect real batched geometry,
      // so drawing the label over wood with depth/render-order tricks cannot satisfy this check.
      const textRows = center.bilingual
        ? [{ name: 'English title', pixels: [32, 48, 62] }, { name: 'Chinese subtitle', pixels: [92, 108, 124] }]
        : [{ name: 'cavalry title', pixels: [48, 80, 108] }]
      for (const row of textRows) for (const pixelY of row.pixels) for (const u of [.1, .3, .5, .7, .9]) {
        const target = label!.localToWorld(new THREE.Vector3((u - .5) * width, (.5 - pixelY / 160) * height, 0))
        for (const drop of [0, 1.5]) {
          const eye = target.clone().addScaledVector(front, 8).addScaledVector(up, -drop)
          const ray = new THREE.Raycaster(eye, target.clone().sub(eye).normalize(), 0, eye.distanceTo(target) + .5)
          expect(ray.intersectObject(board!, true)[0]?.object === label,
            `${faction} ${center.name} ${row.name} (${u}, ${pixelY}) first sees the label from ${drop ? 'slightly below' : 'front'}`).toBe(true)
        }
      }
      const vertices: THREE.Vector3[] = []
      board!.traverse(child => {
        if (!(child instanceof THREE.Mesh)) return
        ownedSignResources.add(child.geometry)
        for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
          if (material.name.startsWith('procedural-')) borrowedSignMaterials.add(material)
          else ownedSignResources.add(material)
          if (material instanceof THREE.MeshBasicMaterial && material.map) ownedSignResources.add(material.map)
        }
        const positions = child.geometry.getAttribute('position')
        for (let index = 0; index < positions.count; index++) {
          vertices.push(new THREE.Vector3().fromBufferAttribute(positions, index).applyMatrix4(child.matrixWorld))
        }
      })
      const feet = [-1, 1].map(side => board!.localToWorld(new THREE.Vector3(side * width / 2, 0, 0)))
      const supports = world.obstacles.filter(obstacle => feet.some(foot =>
        Math.abs(obstacle.box.getCenter(new THREE.Vector3()).x - foot.x) < 1e-6
          && Math.abs(obstacle.box.getCenter(new THREE.Vector3()).z - foot.z) < 1e-6))
      expect(supports).toHaveLength(2)
      const postFootVertices = new Set<THREE.Vector3>()
      for (const support of supports) {
        const foot = support.box.getCenter(new THREE.Vector3()); foot.y = getTerrainHeight(foot.x, foot.z)
        const postVertices = vertices.filter(vertex => vertex.x >= support.box.min.x && vertex.x <= support.box.max.x
          && vertex.z >= support.box.min.z && vertex.z <= support.box.max.z)
        expect(Math.min(...postVertices.map(vertex => vertex.y)), 'each timber reaches its own ground height').toBeCloseTo(foot.y, 5)
        const postFoot = vertices.filter(vertex => Math.abs(vertex.y - foot.y) < 1e-5
          && Math.hypot(vertex.x - foot.x, vertex.z - foot.z) < .2)
        expect(postFoot.length, 'rotated post foot exists at the collider center').toBeGreaterThan(0)
        for (const vertex of postFoot) {
          postFootVertices.add(vertex)
          expect(support.box.containsPoint(vertex), 'collider encloses the rotated timber foot').toBe(true)
        }
        const footBounds = new THREE.Box3().setFromPoints(postFoot), footprintSize = footBounds.getSize(new THREE.Vector3())
        const colliderSize = support.box.getSize(new THREE.Vector3())
        expect(colliderSize.x, 'rotated X collision padding remains proportional').toBeCloseTo(footprintSize.x * 1.25, 5)
        expect(colliderSize.z, 'rotated Z collision padding remains proportional').toBeCloseTo(footprintSize.z * 1.25, 5)
        expect(isObstaclePathClear(foot.clone().add(new THREE.Vector3(0, 0, 1)),
          foot.clone().add(new THREE.Vector3(0, 0, -1)), .45, 1.8, 0, world.obstacles), 'support blocks walking').toBe(false)
      }
      if (center.walkThrough) {
        // Remove only the two grounded feet. The backing's lower corners lie outside the posts,
        // so filtering by horizontal span would accidentally omit the lowest overhead geometry.
        const overheadVertices = vertices.filter(vertex => !postFootVertices.has(vertex))
        expect(overheadVertices.length, 'physical overhead geometry exists').toBeGreaterThan(0)
        const lowestOverhead = Math.min(...overheadVertices.map(vertex => vertex.y))
        for (const side of [-4, -2, 0, 2, 4]) for (const front of [-.125, .125, .305]) {
          const sample = board!.localToWorld(new THREE.Vector3(side, 0, front))
          expect(lowestOverhead - getTerrainHeight(sample.x, sample.z), 'backing and crossbar clear an on-foot body plus headroom').toBeGreaterThanOrEqual(2.5)
        }
        for (const side of [-2, 0, 2]) {
          const start = board!.localToWorld(new THREE.Vector3(side, 0, -1.5))
          const end = board!.localToWorld(new THREE.Vector3(side, 0, 1.5))
          start.y = getTerrainHeight(start.x, start.z); end.y = getTerrainHeight(end.x, end.z)
          for (const fraction of [0, .25, .5, .75, 1]) {
            const sample = start.clone().lerp(end, fraction)
            expect(lowestOverhead - getTerrainHeight(sample.x, sample.z), 'raised board clears an on-foot body plus headroom').toBeGreaterThanOrEqual(2.5)
          }
          expect(isObstaclePathClear(start, end, .45, 2.3, 0, world.obstacles), 'central walking passage remains physically open').toBe(true)
          expect(navigation.areConnected(start, end), 'both sides remain connected through Town navigation').toBe(true)
          for (const point of [start, end]) {
            const cell = navigation.grid.worldToCell(point)
            expect(cell).not.toBeNull()
            expect(navigation.grid.isBlocked(cell!), 'passage is walkable without snapping').toBe(false)
          }
        }
        const orientedBounds = new OBB().fromBox3(new THREE.Box3().setFromPoints(vertices.map(vertex => board!.worldToLocal(vertex.clone())))).applyMatrix4(board!.matrixWorld)
        for (const building of world.buildings) for (const obstacle of building.obstacles) {
          expect(orientedBounds.intersectsBox3(obstacle.box), `${building.id} stays clear of the rotated training sign`).toBe(false)
        }
        for (const footprint of footprints) expect(orientedBounds.intersectsBox3(footprint), 'training sign clears every eagle landing footprint').toBe(false)
        for (const support of supports) {
          const footprint = support.box.clone(); footprint.min.y = -100; footprint.max.y = 100
          for (const road of world.roads) {
            const transform = new THREE.Matrix4().makeRotationY(Math.atan2(road.bx - road.ax, road.bz - road.az))
            transform.setPosition((road.ax + road.bx) / 2, 0, (road.az + road.bz) / 2)
            const roadFootprint = new OBB(new THREE.Vector3(), new THREE.Vector3(road.width / 2, 100,
              Math.hypot(road.bx - road.ax, road.bz - road.az) / 2)).applyMatrix4(transform)
            expect(roadFootprint.intersectsBox3(footprint), 'rotated supports stay outside paved roads').toBe(false)
          }
        }
      } else {
        const highestGround = Math.max(getTerrainHeight(center.x, center.z), ...feet.map(foot => getTerrainHeight(foot.x, foot.z)))
        expect(label!.getWorldPosition(new THREE.Vector3()).y, `${center.name} retains its existing height`).toBeCloseTo(highestGround + 3, 6)
      }
    }
    for (const [index, pad] of pads.entries()) {
      const footprint = footprints[index]
      expect(world.obstacles.some(obstacle => obstacle.box.intersectsBox(footprint)), pad.id).toBe(false)
      expect(navigation.areConnected(pad, world.hr.officer), pad.id).toBe(true)
      const cell = navigation.grid.worldToCell(pad)
      expect(cell, `${pad.id} inside walkable bounds`).not.toBeNull()
      expect(navigation.grid.isBlocked(cell!), `${pad.id} walkable without snapping`).toBe(false)
      expect(footprint.min.x, pad.id).toBeGreaterThanOrEqual(-350)
      expect(footprint.max.x, pad.id).toBeLessThanOrEqual(350)
      expect(footprint.min.z, pad.id).toBeGreaterThanOrEqual(-350)
      expect(footprint.max.z, pad.id).toBeLessThanOrEqual(350)
      for (let other = index + 1; other < pads.length; other++) {
        expect(footprint.clone().expandByVector(new THREE.Vector3(3, 0, 3)).intersectsBox(footprints[other]),
          `${pad.id} / ${pads[other].id}: three-metre landing separation`).toBe(false)
      }
      for (const [roadIndex, road] of world.roads.entries()) {
        expect(crossesPadCorridor(footprint, new THREE.Vector3(road.ax, 0, road.az),
          new THREE.Vector3(road.bx, 0, road.bz), road.width / 2 + 2), `${pad.id} / road ${roadIndex}`).toBe(false)
      }
      for (const [id, gate] of world.gates) {
        expect(footprint.intersectsBox(gate.collisionBox.clone().expandByVector(new THREE.Vector3(2, 100, 2))),
          `${pad.id} / ${id} gate clearance`).toBe(false)
      }
      for (let segment = 0; segment < patrol.length; segment++) {
        // Six metres covers the outer mounted follow column and the horse body, including loop closure.
        expect(crossesPadCorridor(footprint, patrol[segment], patrol[(segment + 1) % patrol.length], 6),
          `${pad.id} / patrol segment ${segment}`).toBe(false)
      }
      const position = new THREE.Vector3(pad.x, getTerrainHeight(pad.x, pad.z), pad.z), ground = position.y
      const flight = new EagleFlightController()
      flight.setIntent({ yaw: pad.yaw, pitch: .32, takeoff: true })
      flight.update(position, new THREE.Euler(0, pad.yaw, 0), .05, world.obstacles, 350)
      expect(flight.phase, `${pad.id} accepts takeoff with built terrain and obstacles`).toBe('takeoff')
      expect(position.y, `${pad.id} lifts from the ground`).toBeGreaterThan(ground)
    }
    // Reuse this geometry owner to check field deployment against the actual Town,
    // with production army positions and thirty private slots but no spawned actors.
    const assaultAnchor = { ...siegeMuster('north', 1), yaw: 0 }, official = createAssaultRoster(faction)
    const fieldPads = personalTownEagleDeployment(assaultAnchor, official, 3, TOWN_NAVIGATION_BOUNDS, world.obstacles, navigation)
    const fieldSlots = personalTownDeployment(assaultAnchor, official, 30, TOWN_NAVIGATION_BOUNDS,
      [...world.obstacles, ...fieldPads.map(pad => ({ box: eagleLandingFootprint(pad), isBarricade: false }))], navigation)
    expect(fieldSlots).toHaveLength(30)
    for (const pad of fieldPads) {
      expect(Math.hypot(pad.x - assaultAnchor.x, pad.z - assaultAnchor.z)).toBeLessThanOrEqual(96)
      expect(navigation.areConnected(assaultAnchor, pad), `${pad.id} reachable beside the assault muster`).toBe(true)
      expect(isEagleLandingClear(pad, world.obstacles, [...official, ...fieldPads.filter(other => other !== pad)], 350)).toBe(true)
      const footprint = eagleLandingFootprint(pad)
      expect(fieldSlots.every(slot => !footprint.containsPoint(new THREE.Vector3(slot.x, 0, slot.z)))).toBe(true)
      const position = new THREE.Vector3(pad.x, getTerrainHeight(pad.x, pad.z), pad.z), ground = position.y
      const flight = new EagleFlightController()
      flight.setIntent({ yaw: pad.yaw, pitch: .32, takeoff: true })
      flight.update(position, new THREE.Euler(0, pad.yaw, 0), .05, world.obstacles, 350)
      expect(flight.phase, `${pad.id} accepts field takeoff with built Town terrain and obstacles`).toBe('takeoff')
      expect(position.y).toBeGreaterThan(ground)
    }
    for (const rider of townEagleRoster(world.eagleGarrison)) {
      const standby = new THREE.Vector3(rider.x, getTerrainHeight(rider.x, rider.z), rider.z), home = rider.eagle!.home
      const landing = new THREE.Vector3(home.x, getTerrainHeight(home.x, home.z), home.z)
      const cell = navigation.grid.worldToCell(standby)
      expect(cell, `${rider.id} standby inside walkable bounds`).not.toBeNull()
      expect(navigation.grid.isBlocked(cell!), `${rider.id} standby walkable without snapping`).toBe(false)
      expect(navigation.areConnected(standby, landing), `${rider.id} walking access to own eagle`).toBe(true)
      expect(isObstaclePathClear(standby, landing, .45, 1.8, 0, world.obstacles), `${rider.id} clear boarding walk`).toBe(true)
    }
    const actor = hrOfficerSpec(world.hr)
    expect(actor).toMatchObject({ id: 'hr-officer', duty: 'service', tier: 4, mounted: true, assaultObjective: false })
    expect(isTownMilitary(actor)).toBe(false); expect(townAssaultObjectiveRoster([actor])).toHaveLength(0)
    expect(townConquestRoster(world.hr).find(spec => spec.id === actor.id)).toEqual(actor)
    expect(mountTypeFromId(townActorHeroProfile(faction, actor)!.mountOverride)).toBe(faction === 'roman' ? MountType.CORGI : MountType.BLACK_CAT)
    for (const slot of [world.hr.officer, ...world.hr.muster]) {
      const box = new THREE.Box3(new THREE.Vector3(slot.x - 1.8, -50, slot.z - 1.8), new THREE.Vector3(slot.x + 1.8, 50, slot.z + 1.8))
      expect(world.obstacles.some(obstacle => obstacle.box.intersectsBox(box))).toBe(false)
      expect(navigation.areConnected(slot, { x: 0, z: 0 })).toBe(true)
    }
    for (let i = 0; i < 30; i++) for (let j = i + 1; j < 30; j++) expect(Math.hypot(world.hr.muster[i].x - world.hr.muster[j].x, world.hr.muster[i].z - world.hr.muster[j].z)).toBeGreaterThanOrEqual(4.4)
    expect(() => resolveTownHRLayout(faction, [{ box: new THREE.Box3(new THREE.Vector3(-500, -100, -500), new THREE.Vector3(500, 100, 500)), isBarricade: false }], world.roads)).toThrow()
    const disposalCounts = new Map<THREE.BufferGeometry | THREE.Material | THREE.Texture, number>()
    for (const resource of [...ownedSignResources, ...borrowedSignMaterials]) {
      const onDispose = () => disposalCounts.set(resource, (disposalCounts.get(resource) ?? 0) + 1)
      const events: THREE.EventDispatcher<{ dispose: {} }> = resource
      events.addEventListener('dispose', onDispose)
      cleanups.push(() => events.removeEventListener('dispose', onDispose))
    }
    dispose()
    for (const resource of ownedSignResources) expect(disposalCounts.get(resource), 'owned sign resource disposed once').toBe(1)
    for (const material of borrowedSignMaterials) expect(disposalCounts.has(material), 'shared wood remains usable').toBe(false)
  })
  it.each(['ACTIVE', 'RETURNING'] as const)('restores a %s legacy fourth eagle without a fourth pad or a deleted checkpoint', state => {
    // Three data-only reserve owners plus one real rider/mount; no full legacy squad spawn.
    const scene = renderingScene(), hr = resolveTownHRLayout('roman', [], [])
    const members = ['a', 'b', 'c', 'z'].map(id => ({ id: `personal:${id}`, type: 'captain' as const,
      equipment: { melee: 'centurion_blade', ranged: null, shield: 'scutum_t3', mount: 'xongkoro' as const } }))
    const profile: CareerProfile = { ...createCareerProfile('roman'), rank: 'captain', personalSquad: { members },
      inventory: { version: 1, quantities: { xongkoro: 4, centurion_blade: 4, scutum_t3: 4 } }, ownedMounts: ['xongkoro'] }
    const pads = new EaglePadReservations([1, 2, 3].map(index => ({ id: `private-eagle-pad:${index}`, x: index * 30, z: 60, yaw: 0 })))
    const saved = snapshotPersonalMission(profile)!, flight = { phase: 'cruise' as const, yaw: 0, pitch: 0, bank: 0, speed: 15, velocity: { x: 0, y: 0, z: 15 } }
    saved.state = state
    saved.members['personal:z'] = { status: 'deployed', hp: 90, order: 'follow', position: { x: 15, y: 34, z: 30, yaw: 0 },
      mount: { hp: 110, mounted: true, position: { x: 15, y: 30, z: 30, yaw: 0 }, flight } }
    const player = { group: new THREE.Group(), get combatPosition() { return this.group.position }, dead: false } as Player
    const controller = new TownPersonalSquadController(scene, hr, () => profile, () => player, undefined, { eaglePads: pads })
    cleanups.push(() => controller.cleanup())
    completeNpcDeployment(() => controller.restoreMission(saved), gameplayNpcSpawnDriver)
    expect(controller.actors.map(actor => actor.combatantId)).toEqual(['personal:z'])
    expect(controller.mounts[0].group.position).toMatchObject({ x: 15, y: 30, z: 30 })
    expect(controller.mounts[0].isAirborne).toBe(true)
    if (state === 'ACTIVE') expect(pads.get('personal:z')).toBeUndefined()
    expect(pads.pads).toHaveLength(3)
    expect(controller.checkpoint()!.members['personal:z']).toMatchObject({ status: 'deployed', hp: 90, mount: { hp: 110, mounted: true, flight } })
    expect(profile.inventory?.quantities.xongkoro).toBe(4)
    if (state === 'ACTIVE') expect(controller.dismiss()).toBe(true)
    expect(pads.get('personal:z')?.id).toBe('private-eagle-pad:1')
  })

  it.each(['normal landing', 'shot down during return'] as const)('walks one Captain from HR to the outdoor eagle, then returns on foot before refit after %s', returnKind => {
    // Real actors: one NPC + one Mount, render-only visual double, zero TownWorld/GLBs.
    const scene = renderingScene(), hr = resolveTownHRLayout('roman', [], [])
    const pad = { x: hr.muster[0].x + 28, z: hr.muster[0].z, yaw: 0 }
    const profile = { ...createCareerProfile('roman'), rank: 'captain' as const, personalSquad: { members: [{ id: 'personal:eagle', type: 'captain' as const,
      equipment: { melee: 'centurion_blade', ranged: null, shield: 'scutum_t3', mount: 'xongkoro' as const } }] } }
    const player = { group: new THREE.Group(), get combatPosition() { return this.group.position }, dead: false } as Player
    player.group.position.set(pad.x + 30, 20, pad.z + 30)
    const controller = new TownPersonalSquadController(scene, hr, () => profile, () => player, undefined, { eagleMuster: [pad] })
    cleanups.push(() => controller.cleanup())
    const navigation = new NavigationWorld(TOWN_NAVIGATION_BOUNDS); navigation.sync([])
    const step = () => { navigation.beginFrame(); for (const actor of controller.actors) actor.updateTownTravel(.05, 30, controller.actors, [], navigation); controller.updateLifecycle() }
    completeNpcDeployment(() => controller.follow(), gameplayNpcSpawnDriver)
    const actor = controller.actors[0], eagle = controller.mounts[0]
    expect(actor.mount).toBeNull(); expect(eagle.group.position.x).toBe(pad.x)
    expect(eagle.group.rotation.y).toBe(pad.yaw)
    expect(actor.group.position.x).toBe(hr.muster[0].x)
    advanceUntil(() => actor.mount === eagle, step, { maxSimulationSeconds: 60, secondsPerStep: .05, failureMessage: 'Captain walking from HR to xongkoro boarding pad' })
    actor.takeDamage(10); const woundedHp = actor.hp
    advanceUntil(() => eagle.isAirborne, step, { maxSimulationSeconds: 10, secondsPerStep: .05, failureMessage: 'xongkoro follows Player after boarding' })
    expect(controller.dismiss()).toBe(true)
    expect(actor.hp).toBe(woundedHp); expect(controller.state).toBe('RETURNING')
    if (returnKind === 'shot down during return') {
      eagle.takeDamage(200)
      expect(actor.isFalling).toBe(true)
      controller.updateLifecycle()
      expect(controller.state).toBe('RETURNING')
      expect(actor.hp).toBe(woundedHp)
    }
    advanceUntil(() => controller.state === 'RESERVE', step, { maxSimulationSeconds: 180, secondsPerStep: .05, failureMessage: 'xongkoro lands before Captain walks to HR' })
    expect(controller.actors).toHaveLength(0); expect(controller.mounts).toHaveLength(0)
  })

  it('spawns actual Roman T2/T4 NPCs at HR and walks to a distant Player', () => {
    const { controller, hr, player, step } = harness('roman')
    expect(controller.actors).toHaveLength(0); expect(controller.state).toBe('RESERVE')
    completeNpcDeployment(() => controller.follow(), gameplayNpcSpawnDriver); expect(controller.state).toBe('DEPLOYING')
    const original = [...controller.actors]
    for (const [index, npc] of original.entries()) {
      expect(npc.characterFaction).toBe('roman')
      expect(npc.combatantId).toBe(`personal:${index}`); expect(npc.combatOwnership).toBe('player-personal')
      expect(npc.combatPosition.x).toBeCloseTo(hr.muster[index].x)
      expect(npc.combatPosition.distanceTo(player.combatPosition)).toBeGreaterThan(40)
      expect(npc.activeFollowTarget).toBe(player); expect(npc.respawnEnabled).toBe(false)
      expect(npc.tier).toBe(index === 0 ? 2 : 4)
      expect(npc.mount?.type ?? null).toBe(index === 0 ? null : MountType.HORSE)
    }
    expect(original[2]).toMatchObject({ aiType: AIType.RANGED, specialCombatProfile: 'maki-ranger', combatProfileId: 'ranger', visualAssetId: 'maki-archer-t4' })
    completeNpcDeployment(() => controller.follow(), gameplayNpcSpawnDriver); expect(controller.actors).toEqual(original)
    step(1000)
    expect(controller.state).toBe('ACTIVE')
    for (const actor of controller.actors) expect(actor.combatPosition.distanceTo(player.combatPosition)).toBeLessThan(23)
    expect(controller.dismiss()).toBe(true); expect(controller.state).toBe('RETURNING')
    const commandIds = controller.actors.map(actor => actor.formationCommandId)
    expect(controller.dismiss()).toBe(false); expect(controller.actors.map(actor => actor.formationCommandId)).toEqual(commandIds)
    step(30); completeNpcDeployment(() => controller.follow(), gameplayNpcSpawnDriver); expect(controller.state).toBe('ACTIVE'); expect(controller.actors).toEqual(original)
    expect(controller.actors.every(actor => actor.activeFollowTarget === player)).toBe(true)
    controller.dismiss(); step(1200)
    expect(controller.state).toBe('RESERVE'); expect(controller.actors).toHaveLength(0)
    expect(controller.mounts).toHaveLength(0); expect(controller.owns(original[0])).toBe(false)
  })
  it('preserves dead members until a full new deployment and refills HP, shield, arrows and horse', () => {
    const { controller, profile, step } = harness()
    completeNpcDeployment(() => controller.follow(), gameplayNpcSpawnDriver)
    const dead = controller.actors[0], captain = controller.actors[1], ranger = controller.actors[2]
    const shieldCapacity = captain.shield.shieldImpactRemaining
    dead.takeDamage(99999); captain.takeDamage(20); captain.mount!.takeDamage(20)
    captain.shield.absorb(100, 4); ranger.restoreCombatAmmo(0)
    completeNpcDeployment(() => controller.follow(), gameplayNpcSpawnDriver); step(10)
    expect(dead.dead).toBe(true); expect(controller.actors[0]).toBe(dead)
    expect(profile.personalSquad.members).toHaveLength(3)
    controller.dismiss(); step(1200); expect(controller.state).toBe('RESERVE')
    completeNpcDeployment(() => controller.follow(), gameplayNpcSpawnDriver)
    for (const actor of controller.actors) { expect(actor.dead).toBe(false); expect(actor.hpRatio).toBe(1); if (actor.mount) expect(actor.mount.currentHp).toBe(actor.mount.maxHp) }
    expect(controller.actors[1].shield.shieldImpactRemaining).toBe(shieldCapacity)
    expect(controller.actors[2].combatAmmo).toBe(30)
    controller.actors.forEach(actor => actor.takeDamage(99999)); controller.updateLifecycle()
    expect(controller.state).toBe('RESERVE'); expect(controller.actors).toHaveLength(0)
    expect(profile.personalSquad.members).toHaveLength(3)
    completeNpcDeployment(() => controller.follow(), gameplayNpcSpawnDriver); expect(controller.actors).toHaveLength(3)
  })
  it('holds Roman personal Attack away from HR until Dismiss, including a targetless chase', () => {
    const { controller, hr, player, navigation, step } = harness('roman')
    completeNpcDeployment(() => controller.follow(), gameplayNpcSpawnDriver); step(1000)
    const held = controller.actors.map(actor => actor.combatPosition.clone())
    for (const [index, actor] of controller.actors.entries()) {
      expect(held[index].distanceTo(new THREE.Vector3(hr.muster[index].x, held[index].y, hr.muster[index].z))).toBeGreaterThan(50)
      actor.setTacticalOrder('attack')
      // An ended chase must take the same no-target path as a fresh Attack order.
      actor.state = AIState.CHASE
    }
    const patrol = controller.actors.map(actor => vi.spyOn(actor as any, '_updatePatrol'))
    for (let frame = 0; frame < 300; frame++) {
      navigation.beginFrame()
      for (const actor of controller.actors) actor.update(.05, player, controller.actors, controller.actors, [],
        {} as any, () => {}, () => {}, true, 30, null, null, navigation)
      controller.updateLifecycle()
    }
    for (const [index, actor] of controller.actors.entries()) {
      expect(patrol[index].mock.calls.length).toBe(0)
      expect(Math.hypot(actor.combatPosition.x - held[index].x, actor.combatPosition.z - held[index].z)).toBeLessThan(.05)
      expect(actor.tacticalOrder).toBe('attack')
    }
    expect(controller.state).toBe('ACTIVE')
    controller.dismiss(); step(1200); expect(controller.state).toBe('RESERVE')
  })
  it('preserves member IDs through Roman to Viking Town faction switch and rebuilds native gear', () => {
    const faction = 'roman'
    const { controller, profile, scene, hr, player } = harness(faction)
    completeNpcDeployment(() => controller.follow(), gameplayNpcSpawnDriver)
    const previousActors = [...controller.actors]
    const current = { ...profile, townEvent: { id: 'switch', state: 'hostile' as const } }
    const switched = settleTown(current, 'switch', 'town_defeated')
    const opposite = 'viking'
    expect(switched.faction).toBe(opposite); expect(switched.rank).toBe('recruit')
    expect(switched.personalSquad).toEqual(profile.personalSquad)
    const rebuilt = new TownPersonalSquadController(scene, hr, () => switched, () => player)
    cleanups.push(() => rebuilt.cleanup())
    controller.cleanup()
    expect(previousActors.every(actor => actor.group.parent === null)).toBe(true)
    completeNpcDeployment(() => rebuilt.follow(), gameplayNpcSpawnDriver)
    expect(rebuilt.actors.every(actor => !previousActors.includes(actor))).toBe(true)
    expect(rebuilt.actors.map(actor => actor.combatantId)).toEqual(profile.personalSquad.members.map(member => member.id))
    expect(rebuilt.actors.every(actor => actor.characterFaction === opposite && actor.faction === Faction.PLAYER)).toBe(true)
    expect(rebuilt.actors[0].presetId).toBe('viking_berserker')
    expect(rebuilt.actors.slice(1).every(actor => actor.mount?.type === MountType.HORSE)).toBe(true)
  })
  it('redeploys real configured weapons after death, dismissal, reload and faction change without changing totals', () => {
    const { profile, scene, hr, player } = harness()
    const parsed = parseCareerProfile({ ...profile, totalMerit: 6000 })!
    parsed.inventory!.quantities.heavy_lance = 1
    parsed.personalSquad!.members[0].equipment!.melee = 'heavy_lance'
    parsed.personalSquad!.members[1].equipment!.mount = null
    const snapshot = JSON.stringify(parsed.inventory)
    const runtime = new TownPersonalSquadController(scene, hr, () => parsed, () => player)
    cleanups.push(() => runtime.cleanup()); completeNpcDeployment(() => runtime.follow(), gameplayNpcSpawnDriver)
    expect(runtime.actors[0]).toMatchObject({ tier: 2, meleeWeaponId: 'heavy_lance', isUsingLance: true })
    expect(runtime.actors[1]).toMatchObject({ tier: 4, combatProfileId: 'praetorian', isMounted: false })
    runtime.actors.forEach(actor => actor.takeDamage(99999)); runtime.updateLifecycle(); expect(runtime.state).toBe('RESERVE')
    expect(JSON.stringify(parsed.inventory)).toBe(snapshot)
    completeNpcDeployment(() => runtime.follow(), gameplayNpcSpawnDriver); runtime.dismiss(); runtime.cleanup(); expect(JSON.stringify(parsed.inventory)).toBe(snapshot)
    const loaded = parseCareerProfile(parsed)!; loaded.faction = 'viking'
    const reloaded = new TownPersonalSquadController(scene, hr, () => loaded, () => player)
    cleanups.push(() => reloaded.cleanup()); completeNpcDeployment(() => reloaded.follow(), gameplayNpcSpawnDriver)
    expect(reloaded.actors[0].meleeWeaponId).toBe('heavy_lance'); expect(reloaded.actors[0].tier).toBe(2)
    expect(JSON.stringify(loaded.inventory)).toBe(snapshot)
    reloaded.cleanup(); loaded.personalSquad!.members = []; expect(completeNpcDeployment(() => reloaded.follow(), gameplayNpcSpawnDriver)).toBe(false)
  })
  it('uses a real melee backup with a bow and stops ranged-only attacks close up or out of ammo', () => {
    const { scene, hr, player } = harness()
    const make = (melee: string | null) => new TownPersonalSquadController(scene, hr, () => ({ ...createCareerProfile('roman'),
      personalSquad: { members: [{ id: 'personal:bow', type: 'soldier', equipment: { ...initialPersonalEquipment('soldier', 'roman'), melee, ranged: 'recurve_longbow', shield: null } }] } }), () => player)
    const backup = make('gladius_standard'), onlyBow = make(null); cleanups.push(() => backup.cleanup(), () => onlyBow.cleanup())
    completeNpcDeployment(() => backup.follow(), gameplayNpcSpawnDriver); completeNpcDeployment(() => onlyBow.follow(), gameplayNpcSpawnDriver)
    const enemy = new NPC(scene, 0, 3, Faction.BANDIT, 'viking', AIType.MELEE, 'enemy', 2); cleanups.push(() => enemy.dispose())
    for (const actor of [backup.actors[0], onlyBow.actors[0]]) {
      actor.group.position.set(0, getTerrainHeight(0, 0), 0); actor.setTacticalOrder('attack'); actor.state = AIState.CHASE
      const hit = vi.fn(), fire = vi.fn()
      for (let i = 0; i < 20; i++) actor.update(.05, player, [enemy], [enemy], [], {} as any, hit, fire, true, 30)
      expect(fire).not.toHaveBeenCalled()
      if (actor === onlyBow.actors[0]) { expect(hit).not.toHaveBeenCalled(); expect(actor.meleeWeaponId).toBeNull(); expect(actor.combatAmmo).toBe(30) }
      else expect(actor.hasActiveRangedWeapon).toBe(false)
    }
    const actor = onlyBow.actors[0]; actor.restoreCombatAmmo(0); actor.state = AIState.CHASE; enemy.group.position.z = 12
    const hit = vi.fn(), fire = vi.fn()
    for (let i = 0; i < 20; i++) actor.update(.05, player, [enemy], [enemy], [], {} as any, hit, fire, true, 30)
    expect(hit).not.toHaveBeenCalled(); expect(fire).not.toHaveBeenCalled()
    expect(onlyBow.dismiss()).toBe(true); expect(actor.tacticalOrder).toBe('formation')
  })
  it('keeps constructor patrol behavior for ordinary NPC Attack and still acquires hostiles for personal Attack', () => {
    const { controller, scene, player } = harness(); completeNpcDeployment(() => controller.follow(), gameplayNpcSpawnDriver)
    const ordinary = new NPC(scene, 0, 0, Faction.PLAYER, 'roman', AIType.MELEE, 'ordinary', 2)
    const enemy = new NPC(scene, 0, 3, Faction.BANDIT, 'viking', AIType.MELEE, 'enemy', 2)
    cleanups.push(() => ordinary.dispose(), () => enemy.dispose())
    const patrol = vi.spyOn(ordinary as any, '_updatePatrol')
    ordinary.update(.05, player, [], [], [], {} as any, () => {}, () => {}, true, 30)
    expect(patrol.mock.calls.length).toBe(1)
    const personal = controller.actors[0]
    personal.group.position.copy(ordinary.combatPosition); personal.setTacticalOrder('attack')
    personal.update(.05, player, [enemy], [enemy], [], {} as any, () => {}, () => {}, true, 30)
    expect(personal.state).toBe(AIState.ALERT)
  })
  it('reload resets three representative owned identities to reserve and mission start excludes deployment', () => {
    const { controller, hr, scene, player, profile } = harness('roman', 3)
    completeNpcDeployment(() => controller.follow(), gameplayNpcSpawnDriver); expect(controller.actors).toHaveLength(3)
    const originalIds = controller.actors.map(actor => actor.combatantId)
    controller.cleanup()
    const reloaded = new TownPersonalSquadController(scene, hr, () => profile, () => player)
    cleanups.push(() => reloaded.cleanup())
    expect(reloaded.state).toBe('RESERVE'); expect(reloaded.actors).toHaveLength(0)
    completeNpcDeployment(() => reloaded.follow(), gameplayNpcSpawnDriver); expect(reloaded.actors.map(actor => actor.combatantId)).toEqual(originalIds)
    reloaded.cleanup(); Object.assign(profile, { activeMission: { id: 'formal' } })
    expect(completeNpcDeployment(() => reloaded.follow(), gameplayNpcSpawnDriver)).toBe(false); expect(reloaded.actors).toHaveLength(0)
  })
  it('uses actual NPC target selection for Town peace and Player-side hostility', () => {
    const { scene, controller, player } = harness()
    completeNpcDeployment(() => controller.follow(), gameplayNpcSpawnDriver)
    const personal = controller.actors[1], resident = new NPC(scene, 0, 0, Faction.TOWN, 'roman', AIType.MELEE, 'resident', 2)
    resident.setTownPeaceful(); cleanups.push(() => resident.dispose())
    expect(townWartimeHostile(personal, resident)).toBe(false); expect(townWartimeHostile(resident, personal)).toBe(false)
    expect((personal as any)._findTarget(player, [resident])).toBeNull()
    expect((resident as any)._findTarget({ ...player, dead: true }, [personal])).toBeNull()
    resident.beginTownHostility()
    expect(townWartimeHostile(personal, resident)).toBe(true); expect(townWartimeHostile(resident, personal)).toBe(true)
    expect((personal as any)._findTarget(player, [resident])?.npc).toBe(resident)
    expect((resident as any)._findTarget({ ...player, dead: true }, [personal])?.npc).toBe(personal)
    expect(personal.hostileToPlayer).toBe(false)
  })
  it('integrates personal NPCs once into free-play combat and actual return travel, not mission roster', () => {
    const { controller } = harness(); completeNpcDeployment(() => controller.follow(), gameplayNpcSpawnDriver)
    for (const npc of controller.actors) { vi.spyOn(npc, 'update').mockImplementation(() => {}); vi.spyOn(npc, 'updateTownTravel').mockImplementation(() => {}) }
    const enemy = combatActor('bandit', Faction.BANDIT)
    const fixture = combatFixture({ simulation: { personalSquad: () => controller } })
    fixture.field.ambientBandits.push(enemy)
    fixture.combat.update(.1, 0, 0)
    expect(fixture.field.friendlies).toHaveLength(0)
    expect(fixture.combat.runtimeParticipants).toContain(controller.actors[0])
    for (const npc of controller.actors) expect(npc.update).toHaveBeenCalledTimes(1)
    controller.dismiss(); fixture.combat.update(.1, 0, .1)
    for (const npc of controller.actors) expect(npc.updateTownTravel).toHaveBeenCalledTimes(1)
  })
  it('routes real HR and personal actor damage in both directions, and a personal kill completes conquest', () => {
    const { scene, controller, player, hr, profile } = harness('roman', 1)
    completeNpcDeployment(() => controller.follow(), gameplayNpcSpawnDriver)
    const spec = hrOfficerSpec(hr), equipment = townMilitaryEquipment('roman', spec)
    const officer = new NPC(scene, 0, 0, Faction.TOWN, 'roman', AIType.MELEE, 'HR Officer', equipment.level,
      false, equipment.loadout, equipment.presetId, undefined, spec.id)
    officer.setTownPeaceful(); cleanups.push(() => officer.dispose())
    const personal = controller.actors[0], population = townConquestRoster(hr), event = new TownEvent(population)
    population.forEach(actor => event.register(actor.id, actor.id === spec.id ? officer : { dead: true }))
    event.complete(); event.hostile = true
    const stream = new CombatEventStream()
    const town = Object.assign(createTownCombatFixture(), {
      profile: { ...profile, townEvent: { id: 'hr-conquest', state: 'hostile' } }, player, residents: [{ spec, npc: officer }],
      event, personalSquad: controller, defense: { active: false }, mission: { events: stream },
      persistCasualties: vi.fn(),
    })
    const hp = officer.hp, personalHp = personal.hp
    town.hitFieldNpc(officer, 10, 'projectile', personal)
    town.hitFieldNpc(personal, 10, 'projectile', officer)
    expect(officer.hp).toBe(hp); expect(personal.hp).toBe(personalHp)
    officer.assignFollowTarget(player, 0)
    officer.setMissionCombatTarget(null); officer.missionMovement = true
    officer.beginTownHostility()
    expect(officer.activeFollowTarget).toBeNull(); expect(officer.missionMovement).toBe(false)
    expect((officer as any)._findTarget({ ...player, dead: true }, [personal])?.npc).toBe(personal)
    town.hitFieldNpc(personal, 10, 'projectile', officer)
    expect(personal.hp).toBeLessThan(personalHp)
    expect(event.evaluate(false)).toBeNull()
    town.hitFieldNpc(officer, 999999, 'projectile', personal)
    expect(officer.dead).toBe(true); expect(personal.dead).toBe(false)
    expect(personal.faction).toBe(Faction.PLAYER); expect(personal.hostileToPlayer).toBe(false)
    expect(event.evaluate(false)).toBe('town_defeated')
    expect(town.persistCasualties).toHaveBeenCalledOnce()
  })
  it('regroups after saved victory, preserving casualties, reserves and later player commands', () => {
    const { controller, profile, player, scene, hr } = harness()
    completeNpcDeployment(() => controller.follow(), gameplayNpcSpawnDriver)
    const [dead, captain, ranger] = controller.actors
    dead.takeDamage(99999); captain.takeDamage(20); captain.mount!.takeDamage(20); ranger.restoreCombatAmmo(3)
    captain.setTacticalOrder('charge')
    ranger.assignFormationTarget(42, new THREE.Vector3(100, 0, 100), new THREE.Vector3(0, 0, 1))
    controller.resumeCommand('charge')
    const mission = createActiveCareerMission('recruit-bandits-01', 0, 3, 0)
    mission.phase = 'ENGAGING'
    mission.personalSquad = controller.captureForMission(snapshotPersonalMission(profile)!)!
    mission.personalSquad.memberIds.push('personal:reserve')
    mission.personalSquad.members['personal:reserve'] = { status: 'reserve' }
    Object.assign(profile, { activeMission: mission })
    controller.bindMission(mission.personalSquad)
    const values = new Map<string, string>()
    const store = new CareerProfileStore({ getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) } } as Storage)
    const town = Object.assign(createTownCombatFixture(), {
      profile, player, personalSquad: controller, skills: { skillState: profile.skills }, store: { save: vi.fn(() => false) },
      clearCareerSkillSaveTimer: vi.fn(),
    })
    const original = [...controller.actors], wounded = controller.checkpoint()!.members['personal:1']
    const stats = { damageDealt: 200, damageTaken: 20, kills: 2, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: true }
    const claimed = claimCareerMission(profile, mission.id, 'victory', stats).profile
    expect(town.commit(claimed)).toBe(false)
    expect(town.profile).toBe(profile)
    expect(captain.tacticalOrder).toBe('charge'); expect(ranger.tacticalOrder).toBe('formation')
    town.store.save.mockImplementation((next: any) => store.save(next))
    expect(town.commit(claimed)).toBe(true)
    expect(controller.actors).toEqual(original); expect(controller.spawning).toBe(false)
    expect(dead.dead).toBe(true)
    for (const actor of [captain, ranger]) {
      expect(actor.tacticalOrder).toBe('follow'); expect(actor.activeFollowTarget).toBe(player)
      expect(actor.state).toBe(AIState.IDLE)
    }
    const saved = store.load()!.activeMission!.personalSquad!
    expect(saved.members['personal:1']).toMatchObject({ hp: wounded.hp, mount: wounded.mount, order: 'follow' })
    expect(saved.members['personal:1'].formation).toBeUndefined()
    expect(saved.members['personal:2']).toMatchObject({ ammo: 3, order: 'follow' })
    expect(saved.members['personal:2'].formation).toBeUndefined()
    expect(saved.members['personal:0'].status).toBe('dead')
    expect(saved.members['personal:reserve']).toEqual({ status: 'reserve' })
    controller.cleanup()
    const reloaded = new TownPersonalSquadController(scene, hr, () => town.profile, () => player)
    cleanups.push(() => reloaded.cleanup())
    completeNpcDeployment(() => reloaded.restoreMission(saved), gameplayNpcSpawnDriver)
    expect(reloaded.actors).toHaveLength(2)
    expect(reloaded.actors.every(actor => actor.tacticalOrder === 'follow' && actor.activeFollowTarget === player)).toBe(true)
    town.personalSquad = reloaded
    reloaded.actors.forEach(actor => actor.setTacticalOrder('attack'))
    reloaded.resumeCommand('attack')
    expect(town.commit(cloneCareerProfile(town.profile))).toBe(true)
    expect(reloaded.actors.every(actor => actor.tacticalOrder === 'attack')).toBe(true)
    expect(store.load()!.activeMission!.personalSquad!.members['personal:1'].order).toBe('attack')
  })

  it('regroups queued mission actors without deploying untouched reserves', () => {
    const { controller, profile } = harness()
    const saved = snapshotPersonalMission(profile)!
    saved.state = 'ACTIVE'; saved.pendingMemberIds = ['personal:0']
    saved.members['personal:0'] = { status: 'reserve', order: 'charge' }
    controller.restoreMission(saved)
    expect(controller.spawning).toBe(true)
    controller.regroupAfterMission()
    expect(controller.checkpoint()!.members['personal:0'].order).toBe('follow')
    drainNpcSpawns(gameplayNpcSpawnDriver)
    expect(controller.actors).toHaveLength(1)
    expect(controller.actors[0].tacticalOrder).toBe('follow')
    expect(controller.checkpoint()!.members['personal:1'].status).toBe('reserve')
    controller.cleanup(); controller.regroupAfterMission()
    expect(controller.actors).toHaveLength(0); expect(controller.spawning).toBe(false)
  })

  it('updates private actors exactly once in formal Defense without applying official civilian orders', () => {
    const { controller } = harness(); completeNpcDeployment(() => controller.follow(), gameplayNpcSpawnDriver)
    for (const npc of controller.actors) vi.spyOn(npc, 'update').mockImplementation(() => {})
    const f = combatFixture({ simulation: { personalSquad: () => controller } })
    f.defense.active = { kind: 'town-defense', phase: 'ATTACKING' } as any; f.defense.phase = 'ATTACKING'
    f.combat.update(.1, 0, 0)
    expect(f.defense.fieldNpcs).toHaveLength(0)
    for (const npc of controller.actors) expect(npc.update).toHaveBeenCalledTimes(1)
    for (const call of f.defense.updateCivilianOrder.mock.calls) expect(controller.actors).not.toContain(call[0])
  })
  it('binds an existing wounded party only after saving, preserving instances and clearing old Follow', () => {
    const { controller, profile, player } = harness(); completeNpcDeployment(() => controller.follow(), gameplayNpcSpawnDriver)
    const town = Object.assign(createTownCombatFixture(), {
      profile, player, personalSquad: controller, personalCommands: { close: vi.fn() },
      personalCommandUI: { setEnabled: vi.fn() }, skills: { skillState: profile.skills },
      store: { save: vi.fn(() => false) }, clearCareerSkillSaveTimer: vi.fn(),
    })
    const next = { ...profile, activeMission: createActiveCareerMission('recruit-bandits-01', 0, 3, 0) }
    const original = [...controller.actors]
    original[0].takeDamage(20); original[2].restoreCombatAmmo(3)
    const position = original[0].combatPosition.clone(), hp = original[0].hp
    expect(town.commit(next)).toBe(false); expect(controller.actors).toHaveLength(3)
    expect(original.every(actor => actor.activeFollowTarget === player)).toBe(true)
    town.store.save.mockReturnValue(true)
    expect(town.commit(next)).toBe(true); expect(controller.state).toBe('DEPLOYING')
    expect(controller.actors).toEqual(original); expect(original[0].combatPosition).toEqual(position)
    expect(original[0].hp).toBe(hp); expect(original[2].combatAmmo).toBe(3)
    expect(original.every(actor => actor.squadId === 'personal' && actor.activeFollowTarget === null && actor.tacticalOrder === 'defend')).toBe(true)
    expect(town.profile.activeMission.personalSquad.memberIds).toEqual(original.map(actor => actor.combatantId))
    expect(town.profile.personalSquad).toEqual(profile.personalSquad)
    expect(town.personalCommands.close).toHaveBeenCalledOnce()
  })
  it('does not award Player XP for personal melee damage or kills', () => {
    const { controller, profile, player, scene } = harness(); completeNpcDeployment(() => controller.follow(), gameplayNpcSpawnDriver)
    const enemy = new NPC(scene, 0, 0, Faction.BANDIT, 'viking', AIType.MELEE, 'bandit', 2)
    cleanups.push(() => enemy.dispose())
    const town = Object.assign(createTownCombatFixture(), {
      profile, player, personalSquad: controller, event: { hostile: false }, residents: [],
      defense: { active: false }, mission: { events: { emit: vi.fn() }, alertGroupFor: vi.fn() },
      awardCareerSkillXp: vi.fn(), inventory: {},
    })
    const source = controller.actors[1]
    expect(source.combatOwnership).toBe('player-personal')
    const hp = enemy.hpRatio
    town.hitFieldNpc(enemy, 10, 'melee', source, { kind: 'body', time: .5 })
    expect(enemy.hpRatio).toBeLessThan(hp)
    town.hitFieldNpc(enemy, 99999, 'melee', source, { kind: 'body', time: .5 })
    expect(enemy.dead).toBe(true); expect(town.awardCareerSkillXp).not.toHaveBeenCalled()
    for (const type of ['damage_applied', 'actor_killed']) {
      expect(town.mission.events.emit).toHaveBeenCalledWith(expect.objectContaining({
        type, source: expect.objectContaining({ actorType: 'npc', actorId: 'personal:1', ownership: 'player-personal' }),
      }))
    }
  })
  it('retains actual private projectile attribution after the shooter dies and its runtime is disposed', () => {
    const { controller, profile, player, scene } = harness(); completeNpcDeployment(() => controller.follow(), gameplayNpcSpawnDriver)
    const mission = createActiveCareerMission('recruit-bandits-01', 0, 3, 0)
    mission.phase = 'ENGAGING'; mission.personalSquad = controller.captureForMission(snapshotPersonalMission(profile)!)
    const events = new CombatEventStream(), observed: unknown[] = []
    events.subscribe(event => observed.push(event))
    const tracker = new BattleStatsTracker(events, true, undefined, {}, careerMissionCommandMeritPolicy(mission))
    cleanups.push(() => tracker.dispose())
    const enemy = new NPC(scene, 0, 0, Faction.BANDIT, 'viking', AIType.MELEE, 'bandit', 2,
      false, { meleeWeaponId: 'viking_axe_t1', shieldId: null }, 'viking_berserker', undefined, mission.targetActorIds[0])
    enemy.restoreCombatHealth(17); cleanups.push(() => enemy.dispose())
    const town = Object.assign(createTownCombatFixture(), {
      scene, profile, player, personalSquad: controller, event: { hostile: false }, residents: [], shots: [],
      world: { obstacles: [], targets: [], buildings: [] }, defense: { active: false },
      mission: { events, friendlies: [], ambientBandits: [], missionBandits: [enemy], combatPeersFor: () => [enemy], alertGroupFor: vi.fn() },
      awardCareerSkillXp: vi.fn(), inventory: {},
    })
    const shooter = controller.actors[2], origin = enemy.combatPosition.clone().add(new THREE.Vector3(-2, 1, 0))
    town.fire(origin, new THREE.Vector3(1, 0, 0), 40, 100, false, false, 'arrow', shooter)
    expect(town.shots[0].sourceRef).toMatchObject({ actorType: 'npc', actorId: 'personal:2', squadId: 'personal', ownership: 'player-personal' })
    shooter.takeDamage(99999); controller.cleanup()
    shooter.combatOwnership = undefined
    town.updateShots(.1)
    expect(enemy.dead).toBe(true); expect(town.shots).toHaveLength(0)
    expect(observed).toHaveLength(2)
    expect(observed[0]).toMatchObject({ source: { actorType: 'npc', actorId: 'personal:2', squadId: 'personal', ownership: 'player-personal' }, appliedDamage: 17 })
    expect(tracker.commandCheckpoint()).toMatchObject({ damageDealt: 17, kills: 1 })
    expect(tracker.checkpoint()).toMatchObject({ damageDealt: 0, kills: 0 })
    expect(town.awardCareerSkillXp).not.toHaveBeenCalled()
  })
})
