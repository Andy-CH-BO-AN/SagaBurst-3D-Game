import { completeNpcDeployment, gameplayNpcSpawnDriver } from '../helpers/npcSpawnFrames'
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
import { getRecruitMissionTemplate } from '../../src/career/CareerMissionCatalog'
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
    for (const p of [{ x: 335, z: 0 }, { x: -335, z: 0 }, { x: 0, z: 335 }, { x: 0, z: -335 }, { x: 335, z: 335 }, { x: -335, z: -335 }]) {
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

  it.each(['bandit', 'patrol'] as const)('preserves old %s identities, casualties and phases and reaches every relocated camp before returning', kind => {
    const { scene, world, navigation } = townWorld('roman')
    const spec = townRoster().find(s => s.role === 'captain')!
    const captain = new NPC(scene, spec.x, spec.z, Faction.TOWN, 'roman', AIType.MELEE, 'Captain', 4, false, undefined, undefined, undefined, spec.id)
    const player = new Player(scene, 'roman')
    cleanup.push(() => { captain.dispose(); player.dispose() })
    let profile = createCareerProfile('roman')
    const controller = new BanditMissionController(scene, world, navigation, captain, [{ spec, npc: captain }], () => player,
      () => profile, next => { profile = next; return true })
    cleanup.push(() => controller.dispose())
    const outerCheckpoint = { actorPositions: { [spec.id]: { x: 325, z: 0, yaw: 1 } } }
    expect((controller as any).savedMountedActorPosition(outerCheckpoint, spec.id).position.x).toBe(325)
    const templateId = kind === 'patrol' ? 'recruit-patrol-01' : 'recruit-bandits-01'
    const template = getRecruitMissionTemplate(templateId) as any
    for (let campId = 0; campId < 5; campId++) {
      const mission = createActiveCareerMission(templateId, campId, 3, 0, `legacy-${kind}-${campId}`, kind, spec.id)
      mission.phase = 'MARCHING'; mission.routeStage = 2
      mission.deadTargetActorIds = [mission.targetActorIds[0]]
      profile.activeMission = mission
      profile = parseCareerProfile(JSON.parse(JSON.stringify(profile)))!
      expect(completeNpcDeployment(() => controller.startActiveMission(), gameplayNpcSpawnDriver)).toBe(true)
      expect(profile.activeMission).toMatchObject({ id: mission.id, targetCampId: campId, phase: 'MARCHING', deadTargetActorIds: mission.deadTargetActorIds })
      expect(controller.missionBandits.map(n => n.combatantId)).toEqual(mission.targetActorIds.slice(1))
      const moveLeader = (point: THREE.Vector3) => { captain.group.position.copy(point); player.group.position.copy(point); controller.updateFlow(.1, 0) }
      if (kind === 'patrol') {
        const objectives: THREE.Vector3[] = (controller as any).patrolWaypoints(template, controller.camps[campId].center)
        for (const point of objectives) {
          expect(navigation.areConnected(captain.combatPosition, point)).toBe(true)
          const stage = profile.activeMission?.patrolStage ?? 0
          for (let frame = 0; frame < 4 && (profile.activeMission?.patrolStage ?? 0) === stage; frame++) {
            moveLeader(point)
            if (controller.phase === 'ENGAGING') controller.missionBandits.forEach(n => n.takeDamage(999999))
          }
        }
        expect(profile.activeMission?.patrolStage).toBe(3)
      } else {
        const objective: THREE.Vector3 = (controller as any).marchObjective(controller.camps[campId].center)
        expect(navigation.areConnected(captain.combatPosition, objective)).toBe(true)
        moveLeader(objective); expect(controller.phase).toBe('ENGAGING')
        controller.missionBandits.forEach(n => n.takeDamage(999999)); controller.updateFlow(.1, 0)
      }
      expect(controller.evaluate(false)).toBe('victory')
      expect(controller.startReturning()).toBe(true)
      // Reload RETURNING on the new route without reopening the encounter.
      profile = parseCareerProfile(JSON.parse(JSON.stringify(profile)))!
      expect(completeNpcDeployment(() => controller.startActiveMission(), gameplayNpcSpawnDriver)).toBe(true)
      expect(controller.phase).toBe('RETURNING'); expect(controller.remainingEnemies).toBe(0)
      moveLeader((controller as any).assemblyPoint())
      expect(controller.returnComplete).toBe(true)
      controller.cleanupMission(campId)
    }
  })
})
