import * as THREE from 'three'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { resolveCameraDistance } from '../../src/camera/ThirdPersonCamera'
import { FallingRider, riderFallDamage } from '../../src/movement/FallingRider'
import { getTownRampartLayout, townRampFoundation } from '../../src/town/TownRamparts'
import { ObstacleCollisionSpatialIndex } from '../../src/world/ObstacleCollisionSpatialIndex'
import { PLAYER_FOOT_OFFSET, standingPlayerY, stepPlayerFootBody } from '../../src/player/PlayerFootBody'
import {
  findBlockingObstacleAlongPath,
  getObstacleAvoidanceDirection,
  getTerrainHeight,
  getWalkRampHeight,
  resolveEntityCollision,
  resolveObstacleCollision,
  setObstaclePathQuerySource,
  type ObstacleData
} from '../../src/world/Terrain'

function deck(y: number): ObstacleData {
  return {
    isBarricade: false,
    box: new THREE.Box3(new THREE.Vector3(-2, y - .35, 0), new THREE.Vector3(2, y, 10)),
    walkSurface: {
      startX: 0, startZ: 0, startY: y, topY: y,
      dirX: 0, dirZ: 1, length: 10, landing: 0, halfWidth: 2, mounted: true,
    },
  }
}

describe('obstacle walk-surface collision', () => {
  it('sweeps a thin railing from the approach side, slides along it and exits through the opening', () => {
    const rail: ObstacleData = { isBarricade: false,
      box: new THREE.Box3(new THREE.Vector3(0, 10, -4), new THREE.Vector3(.2, 11.4, 4)) }
    const position = new THREE.Vector3(18, 10, 1)
    const previous = new THREE.Vector3(-2, 10, 0)
    resolveObstacleCollision(position, previous, 0, true, .5, 2.3, 0, [rail])
    expect(position.toArray()).toEqual([-.5, 10, 1])
    previous.copy(position)
    position.set(.1, 10, 3)
    resolveObstacleCollision(position, previous, 0, true, .5, 2.3, 0, [rail])
    expect(position.toArray()).toEqual([-.5, 10, 3])
    previous.copy(position)
    position.z = 5
    resolveObstacleCollision(position, previous, 0, true, .5, 2.3, 0, [rail])
    expect(position.toArray()).toEqual([-.5, 10, 5])
    previous.copy(position)
    position.x = 2
    resolveObstacleCollision(position, previous, 0, true, .5, 2.3, 0, [rail])
    expect(position.toArray()).toEqual([2, 10, 5])
  })

  it('finds the nearest clear side or corner across a spatial cell boundary, regardless of collider order', () => {
    const obstacles = [
      { isBarricade: false, box: new THREE.Box3(new THREE.Vector3(5, -1, -2), new THREE.Vector3(7.8, 4, 2)) },
      { isBarricade: false, box: new THREE.Box3(new THREE.Vector3(8, -1, -1), new THREE.Vector3(10, 4, 1)) },
    ]
    const origin = new THREE.Vector3(6.8, 0, 0)
    for (const layout of [obstacles, [...obstacles].reverse()]) {
      const position = origin.clone()
      resolveObstacleCollision(position, origin, 0, true, .5, 2.3, 0, layout, { groundHeight: () => 0 })
      const body = new THREE.Box3(
        new THREE.Vector3(position.x - .499999, .001, position.z - .499999),
        new THREE.Vector3(position.x + .499999, 2.299, position.z + .499999),
      )
      expect(layout.some(obstacle => obstacle.box.intersectsBox(body))).toBe(false)
      // Reaching the opposite side of the first box is legal but farther away.
      expect(position.distanceTo(origin)).toBeLessThan(2.25)
      const recovered = position.clone()
      resolveObstacleCollision(position, recovered, 0, true, .5, 2.3, 0, layout, { groundHeight: () => 0 })
      expect(position).toEqual(recovered)
    }
  })

  it('exits a solid cluster even when internal faces fill the nearest candidate list', () => {
    const outer = { isBarricade: false,
      box: new THREE.Box3(new THREE.Vector3(-7, -2, -9), new THREE.Vector3(7, 9, 9)) }
    const inner = Array.from({ length: 20 }, (_, i) => {
      const edge = .3 + .15 * i
      return { isBarricade: false,
        box: new THREE.Box3(new THREE.Vector3(-edge, -2, -edge), new THREE.Vector3(edge, 9, edge)) }
    })
    const origin = new THREE.Vector3(0, getTerrainHeight(0, 0), 0)
    const position = origin.clone()
    resolveObstacleCollision(position, origin, 0, true, .5, 2.3, 0, [outer, ...inner])
    const body = new THREE.Box3(
      new THREE.Vector3(position.x - .499999, position.y + .001, position.z - .499999),
      new THREE.Vector3(position.x + .499999, position.y + 2.299, position.z + .499999),
    )
    expect([outer, ...inner].some(obstacle => obstacle.box.intersectsBox(body))).toBe(false)
    expect(position.distanceTo(origin)).toBeLessThan(12)
  })

  it('keeps recovered feet clear of rising terrain and resumes falling above lower ground', () => {
    const wall = { isBarricade: false,
      box: new THREE.Box3(new THREE.Vector3(-.3, -2, -3), new THREE.Vector3(.3, 6, 3)) }
    const ground = (x: number) => x > .5 ? 1.5 : x < -.5 ? -.6 : 0
    const position = new THREE.Vector3(.14, PLAYER_FOOT_OFFSET, 0)
    const dt = 1 / 60
    let state = stepPlayerFootBody(position, position.clone(), { velocityY: 0, onGround: true }, dt, [wall], ground)
    expect(position.y - PLAYER_FOOT_OFFSET).toBeGreaterThan(ground(position.x))
    expect(state.onGround).toBe(false)
    const recovered = position.clone()
    state = stepPlayerFootBody(position, recovered, state, dt, [wall], ground)
    expect(position.x).toBe(recovered.x)
    expect(position.y).toBeLessThan(recovered.y)
    expect(state.onGround).toBe(false)
  })

  it('rejects an embedded previous pose when a broad foundation has no local side exit', () => {
    const foundation = { isBarricade: false,
      box: new THREE.Box3(new THREE.Vector3(-30, -2, -30), new THREE.Vector3(30, 1.4, 30)) }
    const position = new THREE.Vector3(0, .2, 0), previous = new THREE.Vector3(-.1, 0, 0)
    const collision = resolveObstacleCollision(position, previous, 0, true, .5, 2.3, 0,
      [foundation], { recoverOnly: true })
    expect(position.y).toBeGreaterThanOrEqual(foundation.box.max.y)
    expect(position.distanceTo(previous)).toBeLessThan(3)
    expect(collision).toEqual({ velocityY: 0, onGround: true, recovered: true })
  })

  it('keeps a supported actor on the platform when a closer horizontal exit would drop it', () => {
    const platform = deck(6)
    const wall = { isBarricade: false,
      box: new THREE.Box3(new THREE.Vector3(-2, 6, 4), new THREE.Vector3(2.1, 10, 6)) }
    const position = new THREE.Vector3(1.95, 6, 5)
    const collision = resolveObstacleCollision(position, position.clone(), 0, true, .5, 2.3, 0,
      [wall, platform], { walkSurfaces: true })
    expect(collision).toEqual({ velocityY: 0, onGround: true, recovered: true })
    expect(getWalkRampHeight(platform.walkSurface!, position.x, position.z)).toBe(position.y)
    expect(wall.box.clone().expandByScalar(.499999).containsPoint(position)).toBe(false)
  })

  it('does not let a crowded mount separate a ground body through a thin railing', () => {
    const rail: ObstacleData = { isBarricade: false,
      box: new THREE.Box3(new THREE.Vector3(0, 10, -4), new THREE.Vector3(.2, 11.4, 4)) }
    const first = { position: new THREE.Vector3(-.6, 10, 0), radius: 1, height: 2.6, bottomOffset: 0, anchored: true }
    const second = { position: new THREE.Vector3(-.5, 10, 0), radius: .5, height: 2.3, bottomOffset: 0 }
    resolveEntityCollision(first, second, [rail])
    expect(second.position.toArray()).toEqual([-.5, 10, 0])
    // Recover an existing penetration toward its nearby clear side.
    first.position.x = .3
    second.position.x = -.3
    resolveEntityCollision(first, second, [rail])
    expect(second.position.x).toBeCloseTo(-1.2)
  })

  it('tests railing clearance at contact instead of allowing a rising body through before it clears the top', () => {
    const rail: ObstacleData = { isBarricade: false,
      box: new THREE.Box3(new THREE.Vector3(0, 10, -4), new THREE.Vector3(.2, 11.4, 4)) }
    const previous = new THREE.Vector3(-1, 10.95, 0)
    const position = new THREE.Vector3(3, 13, 0)
    resolveObstacleCollision(position, previous, 8, false, .38, 1.9, .95, [rail])
    expect(position.x).toBeCloseTo(-.38)
    // On the next part of the jump the feet really are above the rail.
    previous.copy(position)
    position.x = 3
    resolveObstacleCollision(position, previous, 4, false, .38, 1.9, .95, [rail])
    expect(position.x).toBe(3)
    // The same elevated railing also leaves a ground mount's underpass clear.
    previous.set(-2, 0, 0)
    position.set(3, 0, 0)
    resolveObstacleCollision(position, previous, 0, true, 1, 2.6, 0, [rail], { mountedSurfaces: true })
    expect(position.toArray()).toEqual([3, 0, 0])
  })

  it('keeps an uphill mount clear of the solid ramp foundation while the safety rail blocks the edge', () => {
    const surface = { startX: 0, startZ: 0, startY: 10, topY: 18,
      dirX: 0, dirZ: 1, length: 20, landing: 8, halfWidth: 3, mounted: true }
    const obstacles: ObstacleData[] = [
      townRampFoundation(surface),
      { isBarricade: false, box: new THREE.Box3(new THREE.Vector3(2.99, 10, 0), new THREE.Vector3(3.31, 19, 28)) },
    ]
    const previous = new THREE.Vector3(1.8, 11.92, 4.8)
    const position = new THREE.Vector3(1.8, 11.9, 5.2)
    resolveObstacleCollision(position, previous, -1, false, 1, 2.6, 0, obstacles, { mountedSurfaces: true })
    expect(position.toArray()).toEqual([1.8, 12.08, 5.2])
    position.x = 2.2
    resolveObstacleCollision(position, previous, 0, true, 1, 2.6, 0, obstacles, { mountedSurfaces: true })
    expect(position.x).toBeCloseTo(1.99)
  })

  it('seals each whole rampart foundation while retaining mounted travel and recovering embedded bodies', () => {
    for (const ramp of getTownRampartLayout().ramps) {
      const s = ramp.surface
      const obstacles = [townRampFoundation(s)]
      const point = (along: number, lateral: number, upper: boolean) => {
        const x = s.startX + s.dirX * along - s.dirZ * lateral
        const z = s.startZ + s.dirZ * along + s.dirX * lateral
        return new THREE.Vector3(x, upper ? getWalkRampHeight(s, x, z)! : getTerrainHeight(x, z), z)
      }
      // A radius touches the grounded front lip before its centre reaches the
      // walk plane; preserve the original small step at that first contact.
      const entrance = point(.1, 0, false), entranceExpected = point(.1, 0, true)
      resolveObstacleCollision(entrance, point(-1.2, 0, false), 0, true, 1, 2.6, 0, obstacles, { mountedSurfaces: true })
      expect(entrance.toArray()).toEqual(entranceExpected.toArray())
      const under = point(6, 0, false), outside = point(6, 5, false)
      resolveObstacleCollision(under, outside, 0, true, 1, 2.6, 0, obstacles, { mountedSurfaces: true })
      expect(Math.abs((under.x - s.startX) * -s.dirZ + (under.z - s.startZ) * s.dirX)).toBeCloseTo(s.halfWidth + 1.32)
      // The same support boxes cannot snag the uphill part of a mount's radius.
      const upper = point(6.4, 0, true), expected = upper.clone()
      resolveObstacleCollision(upper, point(6, 0, true), 0, true, 1, 2.6, 0, obstacles, { mountedSurfaces: true })
      expect(upper.toArray()).toEqual(expected.toArray())
      const embedded = point(s.length - 2, 0, false), groundY = embedded.y
      resolveObstacleCollision(embedded, embedded.clone(), 0, true, 1, 2.6, 0, obstacles, { mountedSurfaces: true })
      expect(Math.abs((embedded.x - s.startX) * -s.dirZ + (embedded.z - s.startZ) * s.dirX)).toBeCloseTo(s.halfWidth + 1.32)
      expect(embedded.y).toBeCloseTo(Math.max(groundY, getTerrainHeight(embedded.x, embedded.z)))
      const anchored = { position: point(6, 5, false), radius: 1, height: 2.6, bottomOffset: 0, anchored: true }
      const other = { position: point(6, 4.32, false), radius: 1, height: 2.6, bottomOffset: 0 }
      const before = other.position.clone()
      resolveEntityCollision(anchored, other, obstacles)
      expect(other.position).toEqual(before)
    }
  })

  it('camera rays use slab slices rather than the empty space inside a sloped envelope', () => {
    const obstacle = deck(6)
    obstacle.box.min.y = 0
    obstacle.projectileBoxes = [new THREE.Box3(new THREE.Vector3(-2, 5.65, 0), new THREE.Vector3(2, 6, 10))]
    expect(resolveCameraDistance(new THREE.Vector3(0, 2, -2), new THREE.Vector3(0, 0, 1), 6, [obstacle])).toBe(6)
    expect(resolveCameraDistance(new THREE.Vector3(0, 5.8, -2), new THREE.Vector3(0, 0, 1), 6, [obstacle])).toBeCloseTo(1.72)
    expect(resolveCameraDistance(new THREE.Vector3(4, 5.8, -2), new THREE.Vector3(0, 0, 1), 6, [obstacle])).toBe(6)
  })

  it('limits overlapping support to one step from the original feet, independent of obstacle order', () => {
    const surfaces = [deck(.6), deck(1.2), deck(6)]
    for (const obstacles of [surfaces, [...surfaces].reverse()]) {
      // Use a short body that fits between the synthetic overlapping decks.
      const position = new THREE.Vector3(0, .08, 5)
      const collision = resolveObstacleCollision(position, new THREE.Vector3(0, .1, 5), -1, false,
        .5, .2, .1, obstacles, { walkSurfaces: true })
      expect(position.y).toBeCloseTo(.7)
      expect(collision).toEqual({ velocityY: 0, onGround: true })
    }
  })

  it('handles vertical falling and rising across deck walk surfaces', () => {
    // Catches fast mounted fall only on crossed deck footprint
    const fallPos = new THREE.Vector3(0, 4, 5)
    const fallCollision = resolveObstacleCollision(fallPos, new THREE.Vector3(-10, 15, 5), -30, false,
      1, 2.6, 0, [deck(12), deck(6)], { mountedSurfaces: true })
    expect(fallPos.toArray()).toEqual([0, 6, 5])
    expect(fallCollision).toEqual({ velocityY: 0, onGround: true })

    // Stops a rising body at underside without promoting to higher level
    const risePos = new THREE.Vector3(0, 5, 5)
    const riseCollision = resolveObstacleCollision(risePos, new THREE.Vector3(0, 3, 5), 8, false,
      .5, 2, 0, [deck(6), deck(12)], { walkSurfaces: true })
    expect(risePos.y).toBeCloseTo(3.65)
    expect(riseCollision).toEqual({ velocityY: 0, onGround: false })
  })

  it('discards ramp support when a later wall push moves the body off its edge', () => {
    const wall: ObstacleData = { isBarricade: false,
      box: new THREE.Box3(new THREE.Vector3(-2, 0, 0), new THREE.Vector3(2, 10, 10)) }
    const position = new THREE.Vector3(1.8, 5.98, 5)
    const collision = resolveObstacleCollision(position, new THREE.Vector3(1.8, 6, 5), -1, false,
      .5, 2, 0, [wall, deck(6)], { walkSurfaces: true })
    expect(position.toArray()).toEqual([2.5, 5.98, 5])
    expect(collision).toEqual({ velocityY: -1, onGround: false, recovered: true })
  })

  it('keeps a player stood on a raised hall floor on that floor through a long first foot step', () => {
    // Town hall slab: solid plinth from the ground up to a floor well above one step.
    const floor: ObstacleData = { isBarricade: false, navigationPassable: true, solidBelow: -.2,
      box: new THREE.Box3(new THREE.Vector3(-10, -.2, -10), new THREE.Vector3(10, 1.4, 10)),
      walkSurface: { startX: 0, startZ: -10, startY: 1.4, topY: 1.4, dirX: 0, dirZ: 1, length: 20, landing: 0, halfWidth: 10, mounted: true } }
    const position = new THREE.Vector3(2, standingPlayerY(1.4), 3)
    // Scene load advances the first frame with the clamped 0.2s step.
    const step = stepPlayerFootBody(position, position.clone(), { velocityY: 0, onGround: true }, .2, [floor], () => 0)
    expect(step).toEqual({ velocityY: 0, onGround: true })
    expect(position.x).toBe(2)
    expect(position.z).toBe(3)
    expect(position.y).toBeCloseTo(1.4 + PLAYER_FOOT_OFFSET)
  })

  it('lands an existing falling rider on the actual slope and preserves height-based damage', () => {
    const slope = deck(12)
    slope.walkSurface!.startY = 0
    slope.box.min.y = -.35
    const feet = new THREE.Vector3(0, 10, 5)
    const rider = new FallingRider()
    rider.begin(feet, new THREE.Vector3())
    const height = rider.update(feet, 1, [slope], 500, () => -100)
    expect(feet.toArray()).toEqual([0, 6, 5])
    expect(height).toBe(4)
    expect(riderFallDamage(90, height!)).toBe(24)
    expect(rider.active).toBe(false)
    expect(rider.update(feet, 1, [slope], 500, () => -100)).toBeNull()
  })

})

describe('opt-in obstacle path candidates', () => {
  it('manages obstacle path query corridor and observes array replacements', () => {
    const box = (x: number, minY: number, maxY: number, z: number): ObstacleData => ({
      isBarricade: false,
      box: new THREE.Box3(new THREE.Vector3(x, minY, z), new THREE.Vector3(x + 1, maxY, z + 1)),
    })
    const farther = box(2.5, 1, 3, 0)
    const below = box(.1, 0, 1.001, 0), above = box(.1, 2.999, 4, 0)
    const first = box(1.5, 1, 3, .5), tied = box(1.5, 1, 3, .5)
    const remote = box(1000, 1, 3, 1000)
    const obstacles = [farther, below, above, first, tied, first, ...Array<ObstacleData>(58).fill(remote)]
    const start = new THREE.Vector3(0, 2, 0), target = new THREE.Vector3(100, 200, 0)
    expect(findBlockingObstacleAlongPath(start, target, .5, 2, 1, obstacles, 3)).toBe(first)
    const query = vi.spyOn(ObstacleCollisionSpatialIndex.prototype, 'queryBounds')
    onTestFinished(() => { query.mockRestore(); setObstaclePathQuerySource(obstacles, false) })
    setObstaclePathQuerySource(obstacles, true)
    expect(findBlockingObstacleAlongPath(start, target, .5, 2, 1, obstacles, 3)).toBe(first)
    expect(query.mock.results[0].value).toEqual([farther, below, above, first, tied, first])
    expect(findBlockingObstacleAlongPath(start, target, .5, 2, 1, obstacles, .5)).toBeNull()

    // Observes fresh filtered arrays and same-length replacement
    const fresh = obstacles.filter(obstacle => !obstacle.navigationPassable)
    query.mockClear()
    expect(findBlockingObstacleAlongPath(start, target, .5, 2, 1, fresh, 3)).toBe(first)
    fresh[3] = remote
    expect(findBlockingObstacleAlongPath(start, target, .5, 2, 1, fresh, .5)).toBeNull()
  })

  it('steers around blockers at the edge of avoidance reach and follows moved dynamic obstacles', () => {
    const box = (minX: number, minZ: number, maxX: number, maxZ: number, dynamic = false): ObstacleData => ({
      isBarricade: false, dynamic, box: new THREE.Box3(new THREE.Vector3(minX, 0, minZ), new THREE.Vector3(maxX, 2, maxZ)),
    })
    // Reach is the 1.75 look-ahead plus the .5 radius: x = 2.2 blocks only the straight sample.
    const edge = box(2.2, -.3, 3, .3), cart = box(-.3, 2.2, .3, 3, true)
    const remote = box(1000, 1000, 1001, 1001)
    const obstacles = [edge, cart, ...Array<ObstacleData>(62).fill(remote)]
    onTestFinished(() => setObstaclePathQuerySource(obstacles, false))
    setObstaclePathQuerySource(obstacles, true)
    const at = new THREE.Vector3(0, 0, 0)
    const steer = (direction: THREE.Vector3) => getObstacleAvoidanceDirection(at, direction, .5, 2, 0, obstacles).toArray().map(v => +v.toFixed(6))
    expect(steer(new THREE.Vector3(1, 0, 0))).toEqual([+Math.SQRT1_2.toFixed(6), 0, -Math.SQRT1_2.toFixed(6)])
    // The dynamic cart blocks +Z until it moves away after the index was built.
    expect(steer(new THREE.Vector3(0, 0, 1))).not.toEqual([0, 0, 1])
    cart.box.translate(new THREE.Vector3(0, 0, 50))
    expect(steer(new THREE.Vector3(0, 0, 1))).toEqual([0, 0, 1])
  })
})
