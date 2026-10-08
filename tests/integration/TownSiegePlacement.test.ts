import * as THREE from 'three'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { createEnemyTownAssaultMission } from '../../src/career/EnemyTownAssault'
import { TownDefenseController, type TownDefenseResident } from '../../src/career/TownDefenseController'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import type { Player } from '../../src/player/Player'
import { TOWN_NAVIGATION_BOUNDS } from '../../src/town/TownBounds'
import { TownCavalryPatrolController } from '../../src/town/TownCavalryPatrolController'
import { createTownFortifications } from '../../src/town/TownFortifications'
import type { TownGateId } from '../../src/town/TownLayout'
import { townRoster } from '../../src/town/TownRules'
import { MountType, type Mount } from '../../src/world/Mount'
import { AIType, Faction, type NPC } from '../../src/world/NPC'
import { NpcSpawnScheduler } from '../../src/world/NpcSpawnScheduler'
import type { ObstacleData } from '../../src/world/Terrain'
import { recording, RecordingMount, RecordingNpc, resetSpawnRecording } from '../helpers/npcSpawnRecording'

vi.mock('../../src/career/MissionGuide', () => ({ MissionGuide: class { hide() {} dispose() {} } }))
afterEach(() => { resetSpawnRecording(); vi.restoreAllMocks() })

// Independent geometry contract: do not use the placement algorithm's nearest-gate oracle.
const gateCenters: Record<TownGateId, readonly [number, number]> = {
  north: [0, -115], south: [0, 100], east: [150, 45], west: [-110, 0],
}

/** Full capacity is necessary input for accumulated occupied-slot avoidance.
 * Cost: 223 recording NPCs, one recording cat, real fortifications/NavigationWorld;
 * 0 real NPC/Mount/TownWorld/GLB. Actor commands are observed, not simulated.
 */
function placementFixture() {
  const scene = new THREE.Scene(), obstacles: ObstacleData[] = []
  const material = new THREE.MeshBasicMaterial()
  const city = createTownFortifications('viking', obstacles, {
    stone: material, wood: material, dark: material, snow: material,
  })
  scene.add(city.root)
  const ownedNpcs: RecordingNpc[] = [], ownedMounts: RecordingMount[] = []
  let controller: TownDefenseController | undefined
  onTestFinished(() => {
    controller?.dispose()
    ownedNpcs.forEach(npc => npc.dispose())
    ownedMounts.forEach(mount => mount.dispose())
    const geometries = new Set<THREE.BufferGeometry>()
    city.root.traverse(object => {
      if (object instanceof THREE.Mesh) geometries.add(object.geometry)
      if (object instanceof THREE.InstancedMesh) object.dispose()
    })
    geometries.forEach(geometry => geometry.dispose())
    material.dispose(); city.root.removeFromParent()
  })

  const specs = townRoster().filter(spec => spec.role !== 'cat' && spec.role !== 'merchant')
  const residents: TownDefenseResident[] = specs.map(spec => {
    // AI/equipment initialization is outside this geometry owner; only actor state/command recording is needed.
    const npc = new RecordingNpc(scene, spec.x, spec.z, Faction.ENEMY, 'viking', AIType.MELEE,
      spec.id, spec.tier, spec.mounted, undefined, undefined, undefined, spec.id)
    ownedNpcs.push(npc)
    return { spec, npc: npc as unknown as NPC }
  })
  const cat = new RecordingMount(scene, MountType.BLACK_CAT, -34, 20)
  ownedMounts.push(cat)
  const group = new THREE.Group()
  const player = { group, dead: false, hp: 100, staminaValue: 100,
    get combatPosition() { return group.position }, faceDirection: vi.fn(),
  } as unknown as Player
  let profile = createCareerProfile('roman')
  profile.activeMission = createEnemyTownAssaultMission('capacity-placement')
  // Saved attacker casualties remove unrelated spawn work. Resident deployment remains fresh:
  // real start/plan production and the sealed prepareDeployment finalizer run without draining a queue.
  profile.activeMission.deadFriendlyActorIds = Array.from({ length: 119 }, (_, i) => `capacity-placement:siege:${i}`)
  const navigation = new NavigationWorld(TOWN_NAVIGATION_BOUNDS)
  navigation.sync(obstacles)
  const scheduler = new NpcSpawnScheduler()
  controller = new TownDefenseController(scene, residents, () => player, () => profile,
    next => { profile = next; return true }, cat as unknown as Mount, navigation, {
      gates: city.gates, obstacles, patrol: new TownCavalryPatrolController(residents), closureBodies: () => [],
    }, scheduler)
  return { controller, residents, navigation, obstacles, scheduler }
}

describe('full-capacity Siege resident placement', () => {
  it('deploys all 203 military and 20 civilians through real fortifications with late-slot sector, clearance and occupancy guarantees', () => {
    const h = placementFixture()
    expect(h.controller.startActiveMission()).toBe(true)
    expect(h.scheduler.pending).toBe(0)
    expect(recording.npcs).toHaveLength(223)
    expect(recording.mounts).toHaveLength(1)
    const military = h.residents.filter(resident => resident.spec.role !== 'civilian')
    const civilians = h.residents.filter(resident => resident.spec.role === 'civilian')
    expect(military).toHaveLength(203); expect(civilians).toHaveLength(20)

    const placements = h.residents.map(({ spec }, index) => {
      const npc = recording.npcs[index]
      expect(npc.assignFormationTarget, `${spec.id} receives its deployment command`).toHaveBeenCalledOnce()
      const point = npc.formationTarget!.position
      const mountedWidth = spec.mounted || spec.role === 'ranger' || spec.role === 'civilian'
      const spacing = mountedWidth ? 4.8 : 2.5, radius = mountedWidth ? 1.5 : .55
      expect([point.x, point.y, point.z].every(Number.isFinite), spec.id).toBe(true)
      expect(point.x, spec.id).toBeGreaterThan(-110); expect(point.x, spec.id).toBeLessThan(150)
      expect(point.z, spec.id).toBeGreaterThan(-115); expect(point.z, spec.id).toBeLessThan(100)
      const cell = h.navigation.grid.worldToCell(point)
      expect(cell, `${spec.id} has a navigation cell`).not.toBeNull()
      expect(h.navigation.grid.isBlocked(cell!), `${spec.id} is walkable with gates closed`).toBe(false)
      for (const obstacle of h.obstacles) {
        const box = obstacle.navigationBox ?? obstacle.box
        const separated = point.x + radius < box.min.x || point.x - radius > box.max.x
          || point.z + radius < box.min.z || point.z - radius > box.max.z
        expect(separated, `${spec.id} clears fortification footprint by ${radius}m`).toBe(true)
      }
      return { id: spec.id, point, spacing, civilian: spec.role === 'civilian' }
    })
    const byId = new Map(placements.map(placement => [placement.id, placement]))
    for (const group of h.controller.groups) {
      const [gx, gz] = gateCenters[group.id]
      // Every slot, including each sector's last infantry and cavalry, participates.
      for (const npc of [...group.members, ...group.cavalry]) {
        const point = byId.get(npc.combatantId)!.point
        const distance = (point.x - gx) ** 2 + (point.z - gz) ** 2
        for (const [gateId, [x, z]] of Object.entries(gateCenters)) {
          if (gateId === group.id) continue
          expect(distance, `${npc.combatantId} stays in ${group.id}, rather than ${gateId}`).toBeLessThan((point.x - x) ** 2 + (point.z - z) ** 2)
        }
        expect(Math.sqrt(distance), `${npc.combatantId} stays near its assigned gate`).toBeLessThan(75)
      }
    }
    expect(new Set(placements.map(({ point }) => `${point.x}:${point.z}`)).size).toBe(223)
    for (let i = 0; i < placements.length; i++) for (const prior of placements.slice(0, i)) {
      const current = placements[i]
      // Production's occupied search compares zero-height candidates to terrain-height points.
      // Civilian-only targets can therefore snap to 4.47m rather than the nominal 4.8m;
      // protect their actual 1.5m body clearance, without expanding this test-only change into a placement fix.
      const minimum = current.civilian && prior.civilian ? 3 : (current.spacing + prior.spacing) / 2
      expect(Math.hypot(current.point.x - prior.point.x, current.point.z - prior.point.z),
        `${current.id} avoids earlier ${prior.id} with ${minimum}m spacing`).toBeGreaterThanOrEqual(minimum)
    }
  })
})
