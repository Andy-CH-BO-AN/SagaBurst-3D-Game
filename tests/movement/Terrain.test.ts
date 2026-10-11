import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  clampToPlayableWorld,
  findBlockingProjectileObstacleAlongPath,
  getWalkRampHeight,
  obstacleContainsProjectilePoint,
  PLAYABLE_WORLD_BOUND,
  resolveObstacleCollision,
  type WalkRampSurface,
  TERRAIN_SIZE,
  type ObstacleData,
} from '../../src/world/Terrain'

describe('projectile obstacle geometry', () => {
  const obstacle: ObstacleData = {
    box: new THREE.Box3(
      new THREE.Vector3(-1.2, 0, -0.5),
      new THREE.Vector3(1.2, 3, 0.5),
    ),
    isBarricade: true,
    projectileBoxes: [
      new THREE.Box3(
        new THREE.Vector3(-1.0, 0, -0.25),
        new THREE.Vector3(-0.65, 3, 0.25),
      ),
      new THREE.Box3(
        new THREE.Vector3(0.65, 0, -0.25),
        new THREE.Vector3(1.0, 3, 0.25),
      ),
    ],
  }

  it('keeps navigation collision continuous while allowing projectiles through visual gaps', () => {
    expect(obstacle.box.containsPoint(new THREE.Vector3(0, 1.2, 0))).toBe(true)
    expect(obstacleContainsProjectilePoint(obstacle, new THREE.Vector3(0, 1.2, 0))).toBe(false)
    expect(obstacleContainsProjectilePoint(obstacle, new THREE.Vector3(0.8, 1.2, 0))).toBe(true)
  })

  it('uses the projectile solids for ranged line of sight', () => {
    const throughGap = findBlockingProjectileObstacleAlongPath(
      new THREE.Vector3(0, 1.2, -5),
      new THREE.Vector3(0, 1.2, 5),
      [obstacle],
    )
    const throughStake = findBlockingProjectileObstacleAlongPath(
      new THREE.Vector3(0.8, 1.2, -5),
      new THREE.Vector3(0.8, 1.2, 5),
      [obstacle],
    )

    expect(throughGap).toBeNull()
    expect(throughStake).toBe(obstacle)
  })
})


describe('playable world bounds', () => {
  it('uses the shared 300m actor bound on a 640m terrain', () => {
    expect(PLAYABLE_WORLD_BOUND).toBe(300)
    expect(TERRAIN_SIZE).toBe(640)

    const position = new THREE.Vector3(450, 0, -410)
    clampToPlayableWorld(position)
    expect(position.x).toBe(300)
    expect(position.z).toBe(-300)
  })
})


describe('walk surfaces', () => {
  // Ramp climbing +Z from y=0 at z=0 to y=4 at z=10, then a flat 2m landing.
  const ramp: WalkRampSurface = {
    startX: 0, startZ: 0, dirX: 0, dirZ: 1, halfWidth: 1, length: 10, landing: 2, startY: 0, topY: 4,
  }
  const rampObstacle: ObstacleData = {
    box: new THREE.Box3(new THREE.Vector3(-1, -1, 0), new THREE.Vector3(1, 4, 12)),
    isBarricade: false,
    walkSurface: ramp,
  }
  const RADIUS = 0.38
  const HEIGHT = 1.9
  const HALF = 0.95

  /** One Player-style step: move horizontally, apply gravity, then resolve obstacles. */
  function step(position: THREE.Vector3, velocityY: number, dx: number, dz: number, walkSurfaces: boolean) {
    const previous = position.clone()
    position.x += dx
    position.z += dz
    velocityY += -25 / 60
    position.y += velocityY / 60
    return resolveObstacleCollision(position, previous, velocityY, true, RADIUS, HEIGHT, HALF, [rampObstacle], { walkSurfaces })
  }

  it('reports the surface height along the slope, on the landing, and null off the ramp', () => {
    expect(getWalkRampHeight(ramp, 0, 5)).toBeCloseTo(2)
    expect(getWalkRampHeight(ramp, 0.9, 10)).toBeCloseTo(4)
    expect(getWalkRampHeight(ramp, 0, 11.5)).toBeCloseTo(4)
    expect(getWalkRampHeight(ramp, 1.2, 5)).toBeNull()
    expect(getWalkRampHeight(ramp, 0, -0.1)).toBeNull()
    expect(getWalkRampHeight(ramp, 0, 12.1)).toBeNull()
  })

  it('lets an opted-in walker climb and descend without ever leaving the surface', () => {
    const position = new THREE.Vector3(0, HALF, -0.5)
    let velocityY = 0
    for (let i = 0; i < 200; i++) {
      const result = step(position, velocityY, 0, 0.1, true)
      velocityY = result.velocityY
      const surfaceY = getWalkRampHeight(ramp, position.x, position.z)
      if (surfaceY !== null) expect(position.y - HALF).toBeCloseTo(surfaceY, 5)
      if (position.z > 11) break
    }
    expect(position.y - HALF).toBeCloseTo(4, 5)

    for (let i = 0; i < 200 && position.z > 0.2; i++) {
      const before = position.y
      const result = step(position, velocityY, 0, -0.1, true)
      velocityY = result.velocityY
      expect(result.onGround).toBe(true)
      expect(position.y).toBeLessThanOrEqual(before + 1e-9)
      expect(before - position.y).toBeLessThan(0.1)
    }
    expect(position.y - HALF).toBeCloseTo(getWalkRampHeight(ramp, 0, position.z)!, 5)
  })

  it('treats the same ramp as a solid box for callers that did not opt in', () => {
    const position = new THREE.Vector3(0, HALF, -0.3)
    step(position, 0, 0, 0.3, false)
    expect(position.z).toBeLessThanOrEqual(-RADIUS + 1e-9)
    expect(position.y - HALF).toBeCloseTo(0, 1)
  })

  it('never lifts a rising walker, so jumps keep their own velocity', () => {
    const position = new THREE.Vector3(0, HALF + 2, 5)
    const result = resolveObstacleCollision(position, position.clone(), 7, false, RADIUS, HEIGHT, HALF, [rampObstacle], { walkSurfaces: true })
    expect(result).toEqual({ velocityY: 7, onGround: false })
    expect(position.y).toBe(HALF + 2)
  })

  it('does not snap a walker that is far above the surface or far underneath it', () => {
    const above = new THREE.Vector3(0, HALF + 3.5, 5)
    const aboveResult = resolveObstacleCollision(above, above.clone(), -1, false, RADIUS, HEIGHT, HALF, [rampObstacle], { walkSurfaces: true })
    expect(aboveResult.onGround).toBe(false)
    expect(above.y).toBe(HALF + 3.5)

    const below = new THREE.Vector3(0, HALF, 9.5)
    const belowResult = resolveObstacleCollision(below, below.clone(), 0, false, RADIUS, HEIGHT, HALF, [rampObstacle], { walkSurfaces: true })
    expect(belowResult.onGround).toBe(false)
    expect(below.y).toBe(HALF)
  })

  it('lets arrows pass obstacles flagged projectilePassable', () => {
    const planking: ObstacleData = {
      box: new THREE.Box3(new THREE.Vector3(-5, 3, -5), new THREE.Vector3(5, 3.25, 5)),
      isBarricade: false,
      projectilePassable: true,
    }
    const start = new THREE.Vector3(0, 1, 0)
    const end = new THREE.Vector3(0, 6, 0)
    expect(findBlockingProjectileObstacleAlongPath(start, end, [planking])).toBeNull()
    expect(findBlockingProjectileObstacleAlongPath(start, end, [{ ...planking, projectilePassable: false }]))
      .not.toBeNull()
  })
})
