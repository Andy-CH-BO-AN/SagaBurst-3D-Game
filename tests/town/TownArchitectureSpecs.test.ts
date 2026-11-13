import * as THREE from 'three'
import { Box3, Matrix4, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { NavigationPathFollower } from '../../src/navigation/NavigationPathFollower'
import {
  NavigationWorld,
} from '../../src/navigation/NavigationWorld'
import {
  architectureRuinCorridors,
  architectureSpec,
  CIVIC_BUILDING_KINDS,
  expandedHrCenter,
  hrFloorNavigationEdges,
  type ArchitectureCollider, type ArchitectureFaction, type BuildingSpec, type LocalRect,
} from '../../src/town/architecture/ArchitectureSpecs'
import { resolveTownHRLayout, townHrLocalMuster } from '../../src/town/TownHRLayout'
import { TOWN_CITY_ROADS, TOWN_LOCAL_ROADS, townRoadIntersectsBox } from '../../src/town/TownLayout'
import { rampNavigationSides, surfaceBox } from '../../src/town/TownRamparts'
import { stableHorsePositions, TOWN_SITES } from '../../src/town/TownRules'
import { MOUNT_MOVEMENT_RADIUS } from '../../src/world/Mount'
import { findBlockingObstacleAlongPath, resolveObstacleCollision, type ObstacleData } from '../../src/world/Terrain'

const FACTIONS: readonly ArchitectureFaction[] = ['roman', 'viking']
const SPECS: readonly BuildingSpec[] = FACTIONS.flatMap(faction => CIVIC_BUILDING_KINDS.map(kind => architectureSpec(faction, kind)))
/** Everything an on-foot or mounted body can hit (overhead roof volumes start above riders). */
const blocking = (spec: BuildingSpec): ArchitectureCollider[] => spec.colliders.filter(c => c.role !== 'roof' && c.role !== 'overhead')
const overlaps = (c: ArchitectureCollider, r: LocalRect, margin = 0): boolean =>
  c.box[0] < r.maxX + margin && c.box[3] > r.minX - margin && c.box[2] < r.maxZ + margin && c.box[5] > r.minZ - margin
const label = (spec: BuildingSpec) => `${spec.faction}/${spec.kind}`

describe('Town architecture plans', () => {
  it('廢墟淨空涵蓋第二入口、完整坡道與門內轉向，並遵循入口朝向', () => {
    const plan = architectureSpec('roman', 'hr-center')
    const corridors = architectureRuinCorridors({ ...plan,
      interior: { minX: -8, maxX: 30, minZ: -10, maxZ: 12 },
      entrance: { x: 0, z: 12, yaw: 0, width: 8.4, doorWidth: 6.4, height: 6.2, approach: 5 },
      additionalEntrances: [{ x: 30, z: 0, yaw: Math.PI / 2, width: 8.4, doorWidth: 6.4, height: 6.2, approach: 7 }],
    })
    const inside = (r: LocalRect, x: number, z: number) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ
    expect(inside(corridors[0], 4.1, 17.9)).toBe(true)
    expect(inside(corridors[1], 37.9, -4.1)).toBe(true)
    expect(inside(corridors[1], -7.9, 4.1)).toBe(true)
    // Side rubble away from both required corridors remains physical.
    expect(corridors.some(r => inside(r, 15, 9))).toBe(false)
  })

  it('keep collider and floor inside their authored plan and match the public entrance to its floor edge', () => {
    for (const spec of SPECS) {
      const e = spec.envelope
      if (spec.kind === 'weapons') {
        const publicFloorFront = Math.max(...spec.floor.filter(r => spec.entrance.x > r.minX && spec.entrance.x < r.maxX).map(r => r.maxZ))
        expect(spec.entrance.z, label(spec)).toBe(publicFloorFront)
      }
      for (const c of [...spec.colliders.map(c => ({ minX: c.box[0], maxX: c.box[3], minZ: c.box[2], maxZ: c.box[5] })), ...spec.floor]) {
        expect(c.minX, label(spec)).toBeGreaterThanOrEqual(e.minX - 1e-6)
        expect(c.maxX, label(spec)).toBeLessThanOrEqual(e.maxX + 1e-6)
        expect(c.minZ, label(spec)).toBeGreaterThanOrEqual(e.minZ - 1e-6)
        expect(c.maxZ, label(spec)).toBeLessThanOrEqual(e.maxZ + 1e-6)
      }
    }
  })

  it('give enterable halls an open doorway, a clear aisle and NPC anchors on free floor', () => {
    const halls = SPECS.filter(spec => spec.interior)
    expect(halls.map(label).sort()).toEqual(['roman/hr-center', 'roman/town-center', 'viking/hr-center', 'viking/town-center'])
    for (const spec of halls) {
      const e = spec.entrance, solid = blocking(spec)
      expect(e.doorWidth, label(spec)).toBeGreaterThanOrEqual(3.6)
      expect(e.height, label(spec)).toBeGreaterThanOrEqual(3.2)
      // Door passage from the foot of the steps through the threshold into the aisle (entrances face local +Z).
      const doorway: LocalRect = { minX: e.x - e.doorWidth / 2 + .05, maxX: e.x + e.doorWidth / 2 - .05, minZ: e.z - 1.5, maxZ: e.z + e.approach }
      for (const corridor of [doorway, spec.aisle!]) {
        expect(solid.filter(c => overlaps(c, corridor)).map(c => c.box), label(spec)).toEqual([])
      }
      const npcs = spec.anchors.filter(a => a.role !== 'merchant' && a.role !== 'horse')
      expect(npcs.filter(a => a.role === 'recruit' || a.role === 'npc').length, label(spec)).toBeGreaterThanOrEqual(12)
      for (const anchor of npcs) {
        const spot: LocalRect = { minX: anchor.x, maxX: anchor.x, minZ: anchor.z, maxZ: anchor.z }
        expect(spec.floor.some(r => anchor.x > r.minX && anchor.x < r.maxX && anchor.z > r.minZ && anchor.z < r.maxZ), `${label(spec)} ${anchor.id}`).toBe(true)
        expect(solid.filter(c => overlaps(c, spot, .45)).map(c => c.box), `${label(spec)} ${anchor.id}`).toEqual([])
      }
    }
  })

  it('keep the five stable stalls on the Town horse spawns with clear exits', () => {
    const { x: sx, z: sz, yaw } = TOWN_SITES.stable
    const expected = stableHorsePositions().map(p => ({ x: Math.cos(yaw) * (p.x - sx) - Math.sin(yaw) * (p.z - sz), z: Math.sin(yaw) * (p.x - sx) + Math.cos(yaw) * (p.z - sz) }))
    expect(stableHorsePositions('roman').map(p => p.type)).toEqual(['ORANGE_CAT', 'HORSE', 'ARMORED_HORSE', 'CORGI', 'BLACK_CAT'])
    expect(stableHorsePositions('viking').map(p => p.type)).toEqual(['SNOW_LEOPARD', 'ORANGE_CAT', 'WHITE_CAT', 'SERVAL', 'CARACAL'])
    for (const faction of FACTIONS) {
      const spec = architectureSpec(faction, 'stable'), stalls = spec.anchors.filter(a => a.role === 'horse')
      expect(stalls.map(a => [a.x, a.z]), faction).toEqual(expected.map(p => [expect.closeTo(p.x, 6), expect.closeTo(p.z, 6)]))
      for (let i = 1; i < stalls.length; i++) expect(stalls[i].x - stalls[i - 1].x).toBeGreaterThan(MOUNT_MOVEMENT_RADIUS * 2)
      for (const stall of stalls) {
        // Static movement footprint only; combat radius is not the movement radius. Live mounting remains browser QA.
        const lane: LocalRect = { minX: stall.x - MOUNT_MOVEMENT_RADIUS, maxX: stall.x + MOUNT_MOVEMENT_RADIUS, minZ: stall.z - MOUNT_MOVEMENT_RADIUS, maxZ: spec.envelope.maxZ + 1 }
        expect(blocking(spec).filter(c => overlaps(c, lane)).map(c => c.box), `${faction} ${stall.id}`).toEqual([])
      }
    }
  })

})

it('從高入口兩側返回時經坡腳走入，避開樓板側緣而不增加實體牆', () => {
    const ramp = { startX: 0, startZ: 6, dirX: 0, dirZ: -1, startY: 0, topY: 2,
      length: 6, landing: 0, halfWidth: 4.2, mounted: true }
    const floor = { ...ramp, startZ: -10, dirZ: 1, startY: 2, length: 10, halfWidth: 12 }
    const sides = rampNavigationSides(ramp)
    const perimeter = hrFloorNavigationEdges({ body: { minX: -12, maxX: 12, minZ: -10, maxZ: 0 },
      portals: [{ x: 0, z: 0, yaw: 0, width: 8.4, doorWidth: 6.4, height: 6.2, approach: 6 }] })
      .map(e => ({ box: new THREE.Box3(new THREE.Vector3(e.minX - .02, -.4, e.minZ - .02),
        new THREE.Vector3(e.maxX + .02, 2.75, e.maxZ + .02)), isBarricade: false, physicalPassable: true }))
    const obstacles: ObstacleData[] = [
      ...[ramp, floor].map(walkSurface => ({ box: surfaceBox(walkSurface), walkSurface,
        solidBelow: -.4, navigationPassable: true, isBarricade: false })),
      ...sides, ...perimeter,
    ]
    const world = new NavigationWorld({ minX: -16, maxX: 16, minZ: -14, maxZ: 14 })
    world.sync(obstacles)
    const goal = new THREE.Vector3(0, 2, -6), out = new THREE.Vector3()
    for (const side of [-1, 1]) {
      const p = new THREE.Vector3(side * 6, 0, 1), follower = new NavigationPathFollower()
      let velocityY = 0, onGround = true
      for (const target of [goal, p.clone()]) {
        for (let frame = 0; frame < 600 && p.distanceTo(target) > .25; frame++) {
          world.beginFrame()
          const route = follower.resolveMoveTarget(p, target, world,
            findBlockingObstacleAlongPath(p, target, 1, 2.6, 0, obstacles) !== null, out)
          const previous = p.clone(), direction = out.clone().sub(p).setY(0), distance = direction.length()
          if (route === 'direct' || route === 'path') p.addScaledVector(direction.normalize(), Math.min(.12, distance))
          velocityY -= 22 / 60; p.y = Math.max(0, p.y + velocityY / 60)
          const hit = resolveObstacleCollision(p, previous, velocityY, onGround, 1, 2.6, 0, obstacles, { mountedSurfaces: true })
          velocityY = hit.velocityY; onGround = hit.onGround
        }
        expect(p.distanceTo(target), `入口 ${side < 0 ? '左' : '右'}側`).toBeLessThan(.25)
      }
      // Navigation guidance cannot become invisible body/projectile geometry.
      const crossing = new THREE.Vector3(side * 3.9, 0, 3), before = new THREE.Vector3(side * 4.5, 0, 3)
      resolveObstacleCollision(crossing, before, 0, true, 1, 2.6, 0, sides, { mountedSurfaces: true })
      expect(crossing.toArray()).toEqual([side * 3.9, 0, 3])
    }
    expect(sides.every(side => side.projectilePassable)).toBe(true)
  })

it('fits mounted HR reserves under the roof and leaves its public approach clear', () => {
  // Population exclusion is owned by TownResidentLayout; the interior plan needs no residents.
  const roads = [...TOWN_CITY_ROADS, ...TOWN_LOCAL_ROADS]
  for (const faction of ['roman', 'viking'] as const) {
    const service = resolveTownHRLayout(faction, [], roads)
    const slots = townHrLocalMuster(service), { spec, hall } = expandedHrCenter(faction, slots)
    const worldHall = new Box3(new Vector3(hall.body.minX, -100, hall.body.minZ), new Vector3(hall.body.maxX, 100, hall.body.maxZ))
      .applyMatrix4(new Matrix4().makeRotationY(service.site.yaw)).translate(new Vector3(service.site.x, 0, service.site.z))
    expect(roads.some(road => townRoadIntersectsBox(road, worldHall, 1))).toBe(false)
    const failures = slots.flatMap((p, i) => {
      const inner = spec.interior!
      const outside = p.x - 2.2 < inner.minX || p.x + 2.2 > inner.maxX || p.z - 2.2 < inner.minZ || p.z + 2.2 > inner.maxZ
      const blocked = spec.colliders.some(c => c.role !== 'roof' && c.role !== 'overhead'
        && p.x + 2.2 > c.box[0] && p.x - 2.2 < c.box[3] && p.z + 2.2 > c.box[2] && p.z - 2.2 < c.box[5])
      const roof = spec.colliders.some(c => c.role === 'roof' && p.x >= c.box[0] && p.x <= c.box[3] && p.z >= c.box[2] && p.z <= c.box[5] && c.box[1] - spec.floorY >= 5.5)
      return outside || blocked || !roof ? [i] : []
    })
    expect(failures).toEqual([])
    // Mounted HR officer must leave a 6m-wide central approach open.
    const dx = service.officer.x - service.site.x, dz = service.officer.z - service.site.z
    const localSide = Math.cos(service.site.yaw) * dx - Math.sin(service.site.yaw) * dz
    expect(Math.abs(localSide) - 1.25).toBeGreaterThanOrEqual(3)

  }
})
