import { completeNpcDeployment, NpcSpawnTestDriver } from '../helpers/npcSpawnFrames'
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi, onTestFinished } from 'vitest'
import { TownWorld } from '../../src/town/TownWorld'
import { TOWN_BANDIT_CAMP_CENTERS, TOWN_NAVIGATION_BOUNDS } from '../../src/town/TownBounds'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { Player } from '../../src/player/Player'
import { NPC, AIType, Faction } from '../../src/world/NPC'
import { Mount, MountType } from '../../src/world/Mount'
import { getTerrainHeight, PLAYABLE_WORLD_BOUND } from '../../src/world/Terrain'
import { BanditMissionController } from '../../src/career/BanditMissionController'
import { createActiveCareerMission } from '../../src/career/CareerMissionState'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { parseCareerProfile } from '../../src/career/CareerProfileStore'
import { getRecruitMissionTemplate, type RecruitPatrolMissionTemplate } from '../../src/career/CareerMissionCatalog'
import { townRoster } from '../../src/town/TownRules'

vi.mock('../../src/world/CorgiVisual', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/CorgiVisual')>()),
  CorgiVisual: (await import('../helpers/gameplayQuadrupedVisual')).GameplayQuadrupedVisualDouble,
}))

vi.mock('../../src/career/MissionGuide', () => ({ MissionGuide: class { hide() {} dispose() {} update() {} } }))
const cleanup: (() => void)[] = []
afterEach(() => { cleanup.splice(0).reverse().forEach(f => f()); vi.unstubAllGlobals() })

function townWorld(faction: 'roman' | 'viking') {
  const context = new Proxy({ measureText: () => ({ width: 100 }) }, { get: (target, key) => (target as any)[key] ?? (() => {}) })
  vi.stubGlobal('ImageData', class { constructor(public data: unknown, public width: number, public height: number) {} })
  vi.stubGlobal('document', { getElementById: () => null, createElement: () => ({ getContext: () => context }) })
  const scene = new THREE.Scene(), world = new TownWorld(faction, scene)
  cleanup.push(() => world.dispose())
  const navigation = new NavigationWorld(TOWN_NAVIGATION_BOUNDS)
  navigation.sync(world.obstacles)
  return { scene, world, navigation }
}

// Named adapter to production geometry methods: no mission startup or actors.
interface OutskirtsGeometry {
  assemblyPoint(): THREE.Vector3
  marchObjective(camp: THREE.Vector3): THREE.Vector3
  patrolWaypoints(template: RecruitPatrolMissionTemplate, camp: THREE.Vector3): THREE.Vector3[]
  buildRoute(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[]
  savedMountedActorPosition(active: { actorPositions: Record<string, { x: number; z: number; yaw: number }> }, id: string): { position: THREE.Vector3 }
  route: THREE.Vector3[]
}
function geometryOf(controller: BanditMissionController): OutskirtsGeometry {
  return controller as unknown as OutskirtsGeometry
}

describe('Career Town outskirts', () => {
  it.each(['roman', 'viking'] as const)('%s ground, camps and outer wilderness are navigable with the existing scenery budget', faction => {
    const { scene, world, navigation } = townWorld(faction)
    const ground = world.root.children.find(o => o instanceof THREE.Mesh && o.geometry instanceof THREE.PlaneGeometry) as THREE.Mesh<THREE.PlaneGeometry>
    expect(ground.geometry.parameters.width).toBe(700)
    expect(ground.geometry.parameters.height).toBe(700)
    expect((scene.fog as THREE.Fog).far).toBe(350)
    expect(world.camps).toHaveLength(5)
    const home = { x: 0, z: 9 }
    world.camps.forEach((camp, id) => {
      const center = camp.spawnPoints.reduce((sum, p) => sum.add(p), new THREE.Vector3()).multiplyScalar(1 / camp.spawnPoints.length)
      expect(center.x).toBeCloseTo(TOWN_BANDIT_CAMP_CENTERS[id][0])
      expect(center.z).toBeCloseTo(TOWN_BANDIT_CAMP_CENTERS[id][1])
      expect(Math.max(Math.abs(center.x), Math.abs(center.z))).toBeGreaterThanOrEqual(260)
      expect(world.buildings.filter(b => b.campId === id)).toHaveLength(5)
      for (const spawn of camp.spawnPoints) {
        expect(Math.abs(spawn.x)).toBeLessThan(350); expect(Math.abs(spawn.z)).toBeLessThan(350)
        expect(navigation.areConnected(home, spawn), `camp ${id}`).toBe(true)
        navigation.beginFrame()
        expect(navigation.queryPath(home, spawn).status).toBe('path')
      }
    })
    // Basic via-point connectivity complements the complete real-scenery
    // objective/route matrix below.
    for (const p of [{ x: 15, z: -75 }, { x: 95, z: -105 }, { x: 18, z: 16 }, { x: 335, z: 0 }, { x: -335, z: 0 }, { x: 0, z: 335 }, { x: 0, z: -335 }, { x: 335, z: 335 }, { x: -335, z: -335 }]) {
      expect(navigation.areConnected(home, p)).toBe(true)
    }
    // Scenery collision footprints survive static render batching.
    const trees = world.obstacles.filter(o => Math.abs(o.box.max.x - o.box.min.x - .6) < 1e-6 && o.box.max.y - o.box.min.y === 7)
    const rocks = world.obstacles.filter(o => Math.abs(o.box.max.x - o.box.min.x - 3.3) < 1e-6 && o.box.max.y - o.box.min.y === 5)
    expect(trees.length).toBeLessThanOrEqual(90); expect(rocks.length).toBeLessThanOrEqual(36)
    expect(trees.filter(o => Math.max(Math.abs(o.box.min.x), Math.abs(o.box.min.z)) > 300).length).toBeGreaterThan(10)
    expect(rocks.filter(o => Math.max(Math.abs(o.box.min.x), Math.abs(o.box.min.z)) > 300).length).toBeGreaterThan(3)
    for (const b of world.buildings.filter(b => b.campId !== undefined)) for (const o of b.obstacles) {
      expect(Math.max(Math.abs(o.box.min.x), Math.abs(o.box.max.x), Math.abs(o.box.min.z), Math.abs(o.box.max.z))).toBeLessThan(350)
    }
  })

  it('Player, foot NPC and controlled/roaming mounts use Town limits while a simultaneous battlefield stays at 300m', () => {
    const { scene } = townWorld('roman')
    for (const [actorScene, bound] of [[scene, 350], [new THREE.Scene(), 300]] as const) {
      const player = new Player(actorScene, 'roman'), mount = new Mount(actorScene, MountType.CORGI, 299, 0)
      onTestFinished(() => mount.dispose())
      const npc = new NPC(actorScene, 299, 0, Faction.TOWN, 'roman', AIType.MELEE, 'walker', 1, false)
      cleanup.push(() => { player.dispose(); mount.dispose(); npc.dispose() })
      const input = { keys: { KeyD: true }, consumeLeftClick: () => false, consumeLeftClickRelease: () => false, consumeRightClick: () => false }
      player.group.position.set(299, getTerrainHeight(299, 0) + .9, 0)
      for (let frame = 0; frame < 100; frame++) player.update(.1, input as any, 0, new THREE.Vector3(), [], { setFill() {} } as any, { setChargeRatio() {}, setAiming() {} } as any, {} as any)
      expect(player.position.x).toBe(bound)
      mount.beginControlledFrame(); mount.addControlledMovement(new THREE.Vector3(1, 0, 0), 100, 1); mount.finishControlledFrame(.1, [])
      expect(mount.group.position.x).toBe(bound)
      const navigation = actorScene === scene ? new NavigationWorld(TOWN_NAVIGATION_BOUNDS) : new NavigationWorld()
      navigation.sync([])
      npc.setTownPeaceful(); npc.assignFormationTarget(10, new THREE.Vector3(330, 0, 0), new THREE.Vector3(1, 0, 0), 5)
      for (let frame = 0; frame < 120; frame++) { navigation.beginFrame(); npc.updateTownTravel(.1, 100, [], [], navigation) }
      expect(npc.combatPosition.x).toBeLessThanOrEqual(bound)
      if (actorScene === scene) expect(npc.combatPosition.x).toBeGreaterThan(325)
      mount.group.position.set(299, getTerrainHeight(299, 0), 0); npc.mountVehicle(mount)
      npc.assignFormationTarget(11, new THREE.Vector3(330, 0, 0), new THREE.Vector3(1, 0, 0), 5)
      for (let frame = 0; frame < 120; frame++) { navigation.beginFrame(); npc.updateTownTravel(.1, 100, [], [], navigation) }
      expect(npc.combatPosition.x).toBeLessThanOrEqual(bound)
      if (actorScene === scene) expect(npc.combatPosition.x).toBeGreaterThan(325)
      npc.dismountFromMount()
      // Free wandering also clamps its destination against this scene, not the global default.
      mount.group.position.set(340, getTerrainHeight(340, 0), 0)
      mount.update(.1, [])
      expect(mount.group.position.x).toBeLessThanOrEqual(bound)
      expect(navigation.grid.maxX).toBe(bound)
    }
    expect(PLAYABLE_WORLD_BOUND).toBe(300)
  })

  it('legacy Bandit and Patrol data and routes reach all five relocated camps through real scenery without actors', () => {
    // One real TownWorld + NavigationWorld owns all ten kind/camp rows.
    // Geometry needs its obstacles, but no NPC, Mount or mission startup.
    const { world, navigation } = townWorld('roman')
    const geometry = Object.assign(Object.create(BanditMissionController.prototype), { world, navigation }) as OutskirtsGeometry
    const assertWalkablePath = (from: THREE.Vector3, to: THREE.Vector3, label: string) => {
      navigation.beginFrame()
      const result = navigation.queryPath(from, to)
      expect(result.status, label).toBe('path')
      if (result.status !== 'path') return // assertion above fails; narrow the result type
      expect(result.path.length, label).toBeGreaterThan(0)
      expect(result.path.every(cell => !navigation.grid.isBlocked(cell)), `${label} path avoids blocked cells`).toBe(true)
      const arrival = navigation.grid.cellToWorld(result.path.at(-1)!)
      expect(Math.hypot(arrival.x - to.x, arrival.z - to.z), `${label} arrival reaches objective`).toBeLessThan(5)
    }
    for (const kind of ['bandit', 'patrol'] as const) {
      const templateId = kind === 'patrol' ? 'recruit-patrol-01' : 'recruit-bandits-01'
      const template = getRecruitMissionTemplate(templateId)!
      const centers = [[-260, -230], [260, -240], [-270, 230], [275, 240], [20, 295]]
      expect(TOWN_BANDIT_CAMP_CENTERS).toEqual(centers)
      for (const [campId, [x, z]] of centers.entries()) {
        const mission = createActiveCareerMission(templateId, campId, 3, 0, `legacy-${kind}-${campId}`, kind, 'captain')
        mission.phase = 'MARCHING'; mission.routeStage = 2
        mission.deadTargetActorIds = [`legacy-${kind}-${campId}:bandit:0`]
        const profile = createCareerProfile('roman'); profile.activeMission = mission
        const restored = parseCareerProfile(JSON.parse(JSON.stringify(profile)))!.activeMission!
        expect(restored).toMatchObject({ id: `legacy-${kind}-${campId}`, targetCampId: campId, phase: 'MARCHING', routeStage: 2,
          targetActorIds: [0, 1, 2].map(index => `legacy-${kind}-${campId}:bandit:${index}`),
          deadTargetActorIds: [`legacy-${kind}-${campId}:bandit:0`], friendlyActorIds: ['captain'] })
        const [actualX, actualZ] = TOWN_BANDIT_CAMP_CENTERS[campId]
        const center = new THREE.Vector3(actualX, 0, actualZ)
        expect(center.x).toBeCloseTo(x); expect(center.z).toBeCloseTo(z)
        const objectives = template.kind === 'patrol' ? geometry.patrolWaypoints(template, center) : [geometry.marchObjective(center)]
        if (template.kind === 'patrol') {
          expect(objectives.map(point => [point.x, point.z])).toEqual([[15, -75], [95, -105], [x, z]])
        } else {
          expect(objectives[0].distanceTo(center)).toBeLessThan(55)
          const cell = navigation.grid.worldToCell(objectives[0])
          expect(cell, `bandit camp ${campId} snapped objective inside bounds`).not.toBeNull()
          expect(navigation.grid.isBlocked(cell!), `bandit camp ${campId} snapped objective walkable`).toBe(false)
        }
        let from = geometry.assemblyPoint()
        for (const objective of [...objectives, geometry.assemblyPoint()]) {
          const label = `${kind} camp ${campId}: ${from.x},${from.z} → ${objective.x},${objective.z}`
          expect(navigation.areConnected(from, objective), label).toBe(true)
          assertWalkablePath(from, objective, label)
          const route = geometry.buildRoute(from, objective)
          expect(route.length, label).toBeGreaterThan(1)
          expect(route.at(-1)!.distanceTo(objective), label).toBeLessThan(5)
          let previous = from
          for (const [index, waypoint] of route.entries()) {
            const cell = navigation.grid.worldToCell(waypoint)
            expect(cell, `${label} waypoint ${index} inside bounds`).not.toBeNull()
            // buildRoute may append the literal Patrol camp goal; NavigationWorld
            // projects such coarse blocked goal cells to nearby walkable arrivals.
            // Every computed intermediate waypoint itself must be walkable.
            if (index < route.length - 1) expect(navigation.grid.isBlocked(cell!), `${label} waypoint ${index} walkable`).toBe(false)
            // Controller routes are sparse waypoints; real locomotion navigates
            // each leg. Require a walkable path, not just connected endpoints.
            assertWalkablePath(previous, waypoint, `${label} leg ${index}`)
            previous = waypoint
          }
          from = objective
        }
      }
    }
    expect(geometry.savedMountedActorPosition({ actorPositions: { captain: { x: 325, z: 0, yaw: 1 } } }, 'captain').position.x).toBe(325)
  })

  it.each(['bandit', 'patrol'] as const)('restores one legacy %s camp with stable casualties and route position, then completes its return', kind => {
    const { scene, world, navigation } = townWorld('roman')
    const spec = townRoster().find(s => s.role === 'captain')!
    const captain = new NPC(scene, spec.x, spec.z, Faction.TOWN, 'roman', AIType.MELEE, 'Captain', 4, false, undefined, undefined, undefined, spec.id)
    const player = new Player(scene, 'roman')
    cleanup.push(() => { captain.dispose(); player.dispose() })
    let profile = createCareerProfile('roman')
    const driver = new NpcSpawnTestDriver()
    const controller = new BanditMissionController(scene, world, navigation, captain, [{ spec, npc: captain }], () => player,
      () => profile, next => { profile = next; return true }, {}, driver.scheduler)
    cleanup.push(() => controller.dispose())
    // Ambient encounters have their own owners. Cancel their queued jobs before
    // materialization so this checkpoint owns only a leader and one live target.
    controller.spawnBatches.forEach(batch => batch.cancel())
    const geometry = geometryOf(controller)
    const templateId = kind === 'patrol' ? 'recruit-patrol-01' : 'recruit-bandits-01'
    const template = getRecruitMissionTemplate(templateId)!
    const campId = 4, id = `legacy-${kind}-4`
    const mission = createActiveCareerMission(templateId, campId, 2, 0, id, kind, spec.id)
    mission.phase = 'MARCHING'; mission.routeStage = 2
    mission.deadTargetActorIds = [`${id}:bandit:0`]
    profile.activeMission = mission
    const reload = () => {
      profile = parseCareerProfile(JSON.parse(JSON.stringify(profile)))!
      controller.dispose()
      expect(completeNpcDeployment(() => controller.startActiveMission(), driver)).toBe(true)
    }
    const assertCheckpoint = (phase: 'MARCHING' | 'RETURNING', dead: string[]) => {
      expect(controller.phase).toBe(phase)
      expect(profile.activeMission).toMatchObject({ id, targetCampId: 4, phase, deadTargetActorIds: dead,
        targetActorIds: [`${id}:bandit:0`, `${id}:bandit:1`], friendlyActorIds: ['captain'] })
    }
    reload()
    assertCheckpoint('MARCHING', [`${id}:bandit:0`])
    expect(controller.missionBandits.map(n => n.combatantId)).toEqual([`${id}:bandit:1`])
    expect(controller.missionBandits[0].dead).toBe(false)
    expect(controller.persistRuntimeProgress(true)).toBe(true)
    const marchPosition = captain.combatPosition.clone()
    captain.group.position.set(0, 0, 0)
    reload()
    assertCheckpoint('MARCHING', [`${id}:bandit:0`])
    expect(captain.combatPosition.distanceTo(marchPosition)).toBeLessThan(.01)
    expect(controller.missionBandits.map(n => n.combatantId)).toEqual([`${id}:bandit:1`])
    const moveLeader = (point: THREE.Vector3) => { captain.group.position.copy(point); player.group.position.copy(point); controller.updateFlow(.1, 0) }
    if (template.kind === 'patrol') {
      for (const point of geometry.patrolWaypoints(template, controller.camps[campId].center)) {
        const stage = profile.activeMission?.patrolStage ?? 0
        for (let frame = 0; frame < 4 && (profile.activeMission?.patrolStage ?? 0) === stage; frame++) {
          moveLeader(point)
          if (controller.phase === 'ENGAGING') controller.missionBandits.forEach(n => n.takeDamage(999999))
        }
      }
      expect(profile.activeMission?.patrolStage).toBe(3)
    } else {
      moveLeader(geometry.marchObjective(controller.camps[campId].center))
      expect(controller.phase).toBe('ENGAGING')
      controller.missionBandits[0].takeDamage(999999); controller.updateFlow(.1, 0)
    }
    expect(controller.evaluate(false)).toBe('victory')
    expect(controller.startReturning()).toBe(true)
    // Production checkpoints every third waypoint. Advance actual flow to that
    // boundary, rather than assigning a saved route index in the fixture.
    expect(geometry.route.length).toBeGreaterThan(3)
    for (const point of geometry.route.slice(0, 3)) moveLeader(point)
    controller.persistRuntimeProgress(true)
    const returnStage = profile.activeMission!.routeStage!
    expect(returnStage).toBeGreaterThan(0)
    const returnAnchor = geometry.route[returnStage].clone()
    const patrolStage = profile.activeMission!.patrolStage
    captain.group.position.set(0, 0, 0)
    reload()
    assertCheckpoint('RETURNING', [`${id}:bandit:0`, `${id}:bandit:1`])
    expect(profile.activeMission!.routeStage).toBe(returnStage)
    expect(profile.activeMission!.patrolStage).toBe(patrolStage)
    expect(captain.combatPosition.distanceTo(returnAnchor)).toBeLessThan(.01)
    expect(controller.missionBandits).toHaveLength(0)
    expect(controller.returnComplete).toBe(false)
    moveLeader(geometry.assemblyPoint())
    expect(controller.returnComplete).toBe(true)
  })
})
