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
  DEEP,
  expandedHrCenter,
  SERVICE_ANCHOR_CLEARANCE,
  SERVICE_MOUNT_TURN_RADIUS,
  TOWN_CENTER_SERVICE_ROLES,
  architectureLocalToWorld,
  hrFloorNavigationEdges,
  type ArchitectureCollider, type ArchitectureFaction, type BuildingSpec, type LocalRect,
} from '../../src/town/architecture/ArchitectureSpecs'
import { resolveTownHRLayout, townHrLocalMuster } from '../../src/town/TownHRLayout'
import { TOWN_CENTER, TOWN_CENTER_FRAME, TOWN_CITY_ROADS, TOWN_LOCAL_ROADS, TOWN_PLAZA, townRoadIntersectsBox } from '../../src/town/TownLayout'
import { rampNavigationSides, surfaceBox } from '../../src/town/TownRamparts'
import { stableHorsePositions, TOWN_SITES } from '../../src/town/TownRules'
import { MOUNT_MOVEMENT_RADIUS } from '../../src/world/Mount'
import { findBlockingObstacleAlongPath, resolveObstacleCollision, type ObstacleData } from '../../src/world/Terrain'
import { PLAYER_RADIUS } from '../../src/movement/MovementBalance'
import { standingPlayerY, stepPlayerFootBody } from '../../src/player/PlayerFootBody'

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
    const service = resolveTownHRLayout(faction, [], roads, [])
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
    // ...and stand inside the hall clear of its walls, racks and desk (the Viking hall is narrower).
    const localDepth = Math.sin(service.site.yaw) * dx + Math.cos(service.site.yaw) * dz
    const officer = { minX: localSide - 1.25, maxX: localSide + 1.25, minZ: localDepth - 1.25, maxZ: localDepth + 1.25 }
    expect(officer.minX >= spec.interior!.minX && officer.maxX <= spec.interior!.maxX).toBe(true)
    expect(spec.colliders.filter(c => c.role !== 'roof' && c.role !== 'overhead'
      && officer.maxX > c.box[0] && officer.minX < c.box[3] && officer.maxZ > c.box[2] && officer.minZ < c.box[5])).toEqual([])

  }
})

it('fits both Town Centers in the 40 × 36m frame with a centred 6m door, long front walls and a high clear walkway', () => {
  const frame = TOWN_CENTER_FRAME
  const frameBox = new Box3(new Vector3(frame.minX, -100, frame.minZ), new Vector3(frame.maxX, 100, frame.maxZ))
  // The frame grows the hall left, right and back without touching any street or the plaza.
  expect([...TOWN_CITY_ROADS, ...TOWN_LOCAL_ROADS].filter(road => townRoadIntersectsBox(road, frameBox))).toEqual([])
  expect(frame.maxZ).toBeLessThanOrEqual(TOWN_PLAZA.minZ)
  for (const faction of FACTIONS) {
    const spec = architectureSpec(faction, 'town-center'), F = spec.floorY, e = spec.entrance, env = spec.envelope
    const name = faction
    for (const [x, z] of [[env.minX, env.minZ], [env.maxX, env.maxZ]]) {
      const p = architectureLocalToWorld(TOWN_CENTER, x, z)
      expect(p.x >= frame.minX - 1e-6 && p.x <= frame.maxX + 1e-6 && p.z >= frame.minZ - 1e-6 && p.z <= frame.maxZ + 1e-6, name).toBe(true)
    }
    expect(e.z + e.approach, name).toBeLessThanOrEqual(env.maxZ + 1e-6)
    expect([e.x, e.doorWidth, e.height], name).toEqual([0, 6, faction === 'roman' ? 6.5 : 5.5])
    // The door head is the only overhead piece in the doorway; its wall plane anchors the long front.
    const head = spec.colliders.filter(c => c.role === 'overhead' && c.box[0] <= -e.doorWidth / 2 && c.box[3] >= e.doorWidth / 2 && c.box[1] - F === e.height)
    expect(head, name).toHaveLength(1)
    const plane = head[0].box[5]
    for (const side of [-1, 1]) {
      // Tall walls on this side, no more than 3.5m behind the door plane, run unbroken from the jamb out past ±15m.
      const spans = spec.colliders.filter(c => c.role === 'wall' && c.box[5] >= plane - 3.5 && c.box[4] - F >= e.height && Math.sign(c.box[0] + c.box[3]) === side)
        .map(c => [Math.min(Math.abs(c.box[0]), Math.abs(c.box[3])), Math.max(Math.abs(c.box[0]), Math.abs(c.box[3]))]).sort((a, b) => a[0] - b[0])
      let reach = e.doorWidth / 2
      for (const [from, to] of spans) if (from <= reach + 1e-6) reach = Math.max(reach, to)
      expect(reach, `${name} ${side < 0 ? 'left' : 'right'} wall`).toBeGreaterThanOrEqual(15)
    }
    // One continuous ≥6m walkway from the ramp foot through the door deep into the hall.
    const aisle = spec.aisle!
    expect(aisle.maxX - aisle.minX, name).toBeGreaterThanOrEqual(6)
    expect(aisle.maxZ, name).toBeGreaterThanOrEqual(e.z + e.approach)
    expect(aisle.minZ, name).toBeLessThan(spec.interior!.maxZ - 10)
    // Beams, roof bands and lamps over it clear the hall height; only the door head itself is lower.
    const headroom = faction === 'roman' ? 10 : 7.5
    const low = spec.colliders.filter(c => (c.role === 'overhead' || c.role === 'roof') && overlaps(c, aisle) && c.box[1] - F < headroom)
    expect(low, name).toEqual(head)
  }
})

it('posts the Captain left, Sergeant centre and Commander right inside each Town Center, clear for a mounted officer', () => {
  for (const faction of ['roman', 'viking'] as const) {
    const spec = architectureSpec(faction, 'town-center'), solid = blocking(spec)
    const posts = TOWN_CENTER_SERVICE_ROLES.map(role => spec.anchors.find(a => a.id === `service:${role}`)!)
    const [captain, sergeant, commander] = posts
    // Walking in through the +Z door the player faces -Z, so the left hand is -X.
    expect(captain.x, faction).toBeLessThan(sergeant.x)
    expect(commander.x, faction).toBeGreaterThan(sergeant.x)
    for (const post of posts) {
      const name = `${faction} ${post.id}`
      expect(spec.floor.some(r => post.x > r.minX && post.x < r.maxX && post.z > r.minZ && post.z < r.maxZ), name).toBe(true)
      const body: LocalRect = { minX: post.x, maxX: post.x, minZ: post.z, maxZ: post.z }
      expect(solid.filter(c => overlaps(c, body, SERVICE_ANCHOR_CLEARANCE)).map(c => c.box), name).toEqual([])
      // The door-to-Sergeant aisle stays open for players and private soldiers.
      expect(overlaps({ box: [post.x, 0, post.z, post.x, 0, post.z], role: 'prop' }, spec.aisle!, SERVICE_ANCHOR_CLEARANCE), name).toBe(false)
      for (const other of spec.anchors) if (other !== post) {
        expect(Math.hypot(other.x - post.x, other.z - post.z), `${name}/${other.id}`).toBeGreaterThanOrEqual(other.role === 'service' ? SERVICE_ANCHOR_CLEARANCE * 2 : 1.5)
      }
    }
    // The Sergeant is near the centre but off the door axis.
    expect(Math.abs(sergeant.x), faction).toBeGreaterThanOrEqual(1.5)
    expect(Math.abs(sergeant.x), faction).toBeLessThan(spec.aisle!.maxX)
    // Mounted Captain/Commander can turn on the post and ride across to the door axis.
    for (const post of [captain, commander]) {
      const R = SERVICE_MOUNT_TURN_RADIUS
      const lane: LocalRect = { minX: Math.min(post.x - R, 0), maxX: Math.max(post.x + R, 0), minZ: post.z - R, maxZ: post.z + R }
      const name = `${faction} ${post.id}`
      expect(solid.filter(c => overlaps(c, lane)).map(c => c.box), name).toEqual([])
      expect(spec.anchors.filter(a => a !== post && overlaps({ box: [a.x, 0, a.z, a.x, 0, a.z], role: 'prop' }, lane, .45)).map(a => a.id), name).toEqual([])
    }
  }
})

/** The plan's own colliders and floor slabs as building-local collision data (terrain at 0 under the plinth). */
function localBuildingObstacles(spec: BuildingSpec): ObstacleData[] {
  return [
    ...spec.colliders.map(c => ({ isBarricade: false,
      box: new Box3(new Vector3(c.box[0], c.box[1] <= DEEP ? DEEP : c.box[1], c.box[2]), new Vector3(c.box[3], c.box[4], c.box[5])) })),
    ...spec.floor.map(r => ({ isBarricade: false, navigationPassable: true, solidBelow: DEEP,
      box: new Box3(new Vector3(r.minX, DEEP, r.minZ), new Vector3(r.maxX, spec.floorY, r.maxZ)),
      walkSurface: { startX: (r.minX + r.maxX) / 2, startZ: r.minZ, startY: spec.floorY, topY: spec.floorY, dirX: 0, dirZ: 1,
        length: r.maxZ - r.minZ, landing: 0, halfWidth: (r.maxX - r.minX) / 2, mounted: true } })),
  ]
}
/** Walks the real on-foot body toward each point at 8 m/s; returns the farthest miss and the feet's largest drift off the floor. */
function walkOnFoot(position: Vector3, route: readonly (readonly [number, number])[], obstacles: ObstacleData[], floorY: number) {
  let state = { velocityY: 0, onGround: true }, miss = 0, drift = 0
  for (const [x, z] of route) {
    for (let frame = 0; frame < 240 && Math.hypot(x - position.x, z - position.z) > .05; frame++) {
      const previous = position.clone(), d = Math.hypot(x - position.x, z - position.z), step = Math.min(d, 8 / 30)
      position.x += (x - position.x) / d * step; position.z += (z - position.z) / d * step
      state = stepPlayerFootBody(position, previous, state, 1 / 30, obstacles, () => 0)
      drift = Math.max(drift, Math.abs(position.y - standingPlayerY(floorY)))
    }
    miss = Math.max(miss, Math.hypot(x - position.x, z - position.z))
  }
  return { miss, drift }
}

it('walks from the Roman Town Center door through each wing arch to the back of both wing rooms and out again on one floor', () => {
  const spec = architectureSpec('roman', 'town-center'), obstacles = localBuildingObstacles(spec), F = spec.floorY
  for (const side of [-1, 1]) {
    const into = [[0, 7.5], [0, 1], [side * 7.4, 0], [side * 10.6, 0], [side * 10.6, -11.8], [side * 16.6, -11.8]] as const
    const position = new Vector3(0, standingPlayerY(F), 7.5)
    const walk = walkOnFoot(position, [...into, ...[...into].reverse()], obstacles, F)
    const name = side < 0 ? 'left council room' : 'right trophy hall'
    expect(walk.miss, name).toBeLessThan(.06)
    expect(walk.drift, name).toBeLessThan(1e-6)
  }
})

it('keeps the Roman wing rooms sealed by their outer, back and front walls and the nave wall beside the arch', () => {
  const spec = architectureSpec('roman', 'town-center'), obstacles = localBuildingObstacles(spec), F = spec.floorY
  for (const side of [-1, 1]) {
    // [start, push target, axis, limit]: the body stays on the room side of each wall face.
    const probes = [
      [[side * 16.6, -11.8], [side * 22, -11.8], 'x', 17.9 - PLAYER_RADIUS],
      [[side * 10.6, -11.8], [side * 10.6, -18], 'z', 13.4 - PLAYER_RADIUS],
      [[side * 10.6, 0], [side * 10.6, 8], 'z', 3 - PLAYER_RADIUS],
      [[side * 10.6, -7], [side * 4, -7], 'x', -(9 + PLAYER_RADIUS)],
    ] as const
    for (const [[x, z], target, axis, limit] of probes) {
      const position = new Vector3(x, standingPlayerY(F), z)
      walkOnFoot(position, [target], obstacles, F)
      const reach = axis === 'x' ? Math.abs(position.x) : Math.abs(position.z)
      const name = `${side < 0 ? 'left' : 'right'} wing toward ${target}`
      if (limit > 0) expect(reach, name).toBeLessThanOrEqual(limit + 1e-3)
      else expect(reach, name).toBeGreaterThanOrEqual(-limit - 1e-3)
    }
  }
})
