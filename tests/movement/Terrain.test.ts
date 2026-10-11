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
import { ArrowProjectile } from '../../src/world/ArrowProjectile'
import { Faction } from '../../src/world/NPC'
import type { Player } from '../../src/player/Player'

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

  it('blocks actors jumping or walking into the underside of the ramp from beneath', () => {
    // Ramp surface is at y=3.8 at z=9.5. Underside is at 3.8 - 0.35 = 3.45.
    // Actor standing on ground (feet at y=0, head at y=1.9 < 3.45)
    const below = new THREE.Vector3(0, HALF, 9.5)
    const belowResult = resolveObstacleCollision(below, below.clone(), 0, false, RADIUS, HEIGHT, HALF, [rampObstacle], { walkSurfaces: true })
    expect(belowResult.onGround).toBe(false)
    expect(below.y).toBe(HALF)

    // Actor jumping upward from beneath: head reaches underside (y=3.45)
    const jumping = new THREE.Vector3(0, 2.6 + HALF, 9.5) // head is at 2.6 + 1.9 = 4.5 > 3.45
    const jumpResult = resolveObstacleCollision(jumping, below.clone(), 5, false, RADIUS, HEIGHT, HALF, [rampObstacle], { walkSurfaces: true })
    // Head must be capped at undersideY = 3.45 -> feet at 3.45 - 1.9 = 1.55 -> y = 1.55 + 0.95 = 2.5
    expect(jumping.y - HALF + HEIGHT).toBeCloseTo(3.45, 5)
    expect(jumpResult.velocityY).toBe(0)
    expect(jumpResult.onGround).toBe(false)

    // Actor walking horizontally into descending wedge from underneath: pushed back
    const walkingUnderWedge = new THREE.Vector3(0, HALF, 2.0) // surface at 0.8, underside at 0.45 < head 1.9
    const prevUnderWedge = new THREE.Vector3(0, HALF, 4.0)
    resolveObstacleCollision(walkingUnderWedge, prevUnderWedge, 0, false, RADIUS, HEIGHT, HALF, [rampObstacle], { walkSurfaces: true })
    expect(walkingUnderWedge.z).toBe(prevUnderWedge.z)
  })

  it('caps head and zeroes velocity when jumping into elevated slab underside without horizontal push-out', () => {
    const slab: ObstacleData = {
      box: new THREE.Box3(new THREE.Vector3(-5, 3.5, -5), new THREE.Vector3(5, 3.75, 5)),
      isBarricade: false,
    }
    // Actor starts on ground under the slab: head at 1.9 <= 3.5
    const prev = new THREE.Vector3(0, HALF, 0)
    // Upward jump brings head to 3.8 > 3.5, within horizontal bounds
    const jumping = new THREE.Vector3(0, 1.9 + HALF, 0) // head = 1.9 + 1.9 = 3.8
    const result = resolveObstacleCollision(jumping, prev, 6, false, RADIUS, HEIGHT, HALF, [slab])

    // Head must be capped at slab.min.y = 3.5 -> feet at 3.5 - 1.9 = 1.6 -> y = 1.6 + 0.95 = 2.55
    expect(jumping.y - HALF + HEIGHT).toBeCloseTo(3.5, 5)
    expect(result.velocityY).toBe(0)
    expect(result.onGround).toBe(false)
    // Horizontal position must not be pushed out sideways
    expect(jumping.x).toBe(0)
    expect(jumping.z).toBe(0)
  })

  it('distinguishes empty headroom under elevated structures from physical plank blocking', () => {
    // Structure with coarse envelope and individual step/landing projectileBoxes
    const stepBox = new THREE.Box3(new THREE.Vector3(-1, 3.86, 9), new THREE.Vector3(1, 4.0, 11))
    const structure: ObstacleData = {
      box: new THREE.Box3(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(1, 4, 12)),
      isBarricade: false,
      projectileBoxes: [stepBox],
    }

    // Shot 1: passing through empty headroom beneath the elevated step (y=1.5 < 3.86)
    const underStart = new THREE.Vector3(0, 1.5, -2)
    const underEnd = new THREE.Vector3(0, 1.5, 14)
    expect(findBlockingProjectileObstacleAlongPath(underStart, underEnd, [structure])).toBeNull()

    // Shot 2: intersecting the solid step plank directly (at y=3.95)
    const hitStart = new THREE.Vector3(0, 5, 10)
    const hitEnd = new THREE.Vector3(0, 2, 10)
    expect(findBlockingProjectileObstacleAlongPath(hitStart, hitEnd, [structure])).toBe(structure)

    // Deck slab: solid floor planks (y=4.5 to 4.75)
    const deckSlab: ObstacleData = {
      box: new THREE.Box3(new THREE.Vector3(-10, 4.5, -5), new THREE.Vector3(10, 4.75, 5)),
      isBarricade: false,
    }
    // Under-deck fire (y=2.5) remains completely unobstructed
    expect(findBlockingProjectileObstacleAlongPath(new THREE.Vector3(0, 2.5, -10), new THREE.Vector3(0, 2.5, 10), [deckSlab])).toBeNull()
    // Through-plank fire (from above to below through y=4.6) is blocked
    expect(findBlockingProjectileObstacleAlongPath(new THREE.Vector3(0, 6, 0), new THREE.Vector3(0, 3, 0), [deckSlab])).toBe(deckSlab)
  })

  it('consistently evaluates crenel firing gaps vs solid timber between ArrowProjectile and findBlockingProjectileObstacleAlongPath', () => {
    // Parapet along Z = [-108.25, -108] with deck topY = 4.76m.
    // Lower sill: topY to topY + 0.40m (4.76 to 5.16m) across X = [-30, -10].
    // Merlon battlement: topY + 0.40m to topY + 0.90m (5.16 to 5.66m) across X = [-23.7, -22.7].
    // Crenel opening: at X = -24.4, empty space above y = 5.16m.
    const sillBox = new THREE.Box3(new THREE.Vector3(-30, 4.76, -108.25), new THREE.Vector3(-10, 5.16, -108))
    const merlonBox = new THREE.Box3(new THREE.Vector3(-23.7, 5.16, -108.25), new THREE.Vector3(-22.7, 5.66, -108))
    const parapet: ObstacleData = {
      box: new THREE.Box3(new THREE.Vector3(-30, 4.76, -108.25), new THREE.Vector3(-10, 5.66, -108)),
      isBarricade: false,
      projectileBoxes: [sillBox, merlonBox],
    }

    const dummyPlayer = { targetable: false, currentMount: null, characterFaction: 'viking' } as Player
    function testShotWithArrow(origin: THREE.Vector3, target: THREE.Vector3): { stuck: boolean; finalPos: THREE.Vector3 } {
      const scene = new THREE.Scene()
      const direction = target.clone().sub(origin).normalize()
      const arrow = new ArrowProjectile(scene, origin, direction, 40, 25, Faction.PLAYER, false)
      for (let f = 0; f < 10 && arrow.isAlive && !arrow.isStuck; f++) {
        arrow.update(0.02, dummyPlayer, [], [parapet], () => {}, () => ({
          hitSuccess: false,
          requestedDamage: 0,
          appliedDamage: 0,
          blockedImpact: 0,
          targetId: '',
          targetName: '',
          killed: false,
          hpRatio: 1,
          isMountHit: false,
          mountDied: false,
        }))
      }
      const result = { stuck: arrow.isStuck, finalPos: arrow.mesh.position.clone() }
      arrow.destroy()
      return result
    }

    // 1. Arrow fired downward through open crenel (X = -24.4, crosses wall at y = 5.35m > 5.16m sill)
    const crenelOrigin = new THREE.Vector3(-24.4, 5.4, -109.5)
    const crenelTarget = new THREE.Vector3(-24.4, 0, -50)
    // Terrain LOS check
    expect(findBlockingProjectileObstacleAlongPath(crenelOrigin, crenelTarget, [parapet])).toBeNull()
    // Live ArrowProjectile physics check
    const crenelArrow = testShotWithArrow(crenelOrigin, crenelTarget)
    expect(crenelArrow.stuck).toBe(false)
    expect(crenelArrow.finalPos.z).toBeGreaterThan(-108) // passes through wall

    // 2. Arrow fired directly into solid merlon timber (X = -23.2, crosses wall at y = 5.35m in [5.16, 5.66])
    const merlonOrigin = new THREE.Vector3(-23.2, 5.4, -109.5)
    const merlonTarget = new THREE.Vector3(-23.2, 0, -50)
    // Terrain LOS check
    expect(findBlockingProjectileObstacleAlongPath(merlonOrigin, merlonTarget, [parapet])).toBe(parapet)
    // Live ArrowProjectile physics check
    const merlonArrow = testShotWithArrow(merlonOrigin, merlonTarget)
    expect(merlonArrow.stuck).toBe(true) // physically stopped by timber
    expect(merlonArrow.finalPos.z).toBeLessThanOrEqual(-108 + 1e-4)

    // 3. Arrow fired downward into the lower sill (X = -24.4, crosses wall at y = 4.95m < 5.16m sill)
    const sillOrigin = new THREE.Vector3(-24.4, 5.0, -109.0)
    const sillTarget = new THREE.Vector3(-24.4, 0, -50)
    // Terrain LOS check
    expect(findBlockingProjectileObstacleAlongPath(sillOrigin, sillTarget, [parapet])).toBe(parapet)
    // Live ArrowProjectile physics check
    const sillArrow = testShotWithArrow(sillOrigin, sillTarget)
    expect(sillArrow.stuck).toBe(true) // physically stopped by sill
    expect(sillArrow.finalPos.z).toBeLessThanOrEqual(-108 + 1e-4)

    // 4. Arrow fired over the top of the merlon (X = -23.2, crosses wall at y = 5.80m > 5.66m)
    const highOrigin = new THREE.Vector3(-23.2, 5.85, -109.5)
    const highTarget = new THREE.Vector3(-23.2, 5.0, -50)
    // Terrain LOS check
    expect(findBlockingProjectileObstacleAlongPath(highOrigin, highTarget, [parapet])).toBeNull()
    // Live ArrowProjectile physics check
    const highArrow = testShotWithArrow(highOrigin, highTarget)
    expect(highArrow.stuck).toBe(false)
    expect(highArrow.finalPos.z).toBeGreaterThan(-108)

    // 5. Anti-fall boundary: player body collision against parapet envelope
    const playerFeet = 4.76
    const playerCenterY = playerFeet + 0.95
    const walkingToEdge = new THREE.Vector3(-24.4, playerCenterY, -108.3)
    resolveObstacleCollision(
      walkingToEdge,
      new THREE.Vector3(-24.4, playerCenterY, -109.0),
      0,
      false,
      0.45,
      1.9,
      0.95,
      [parapet],
    )
    // Player is blocked and pushed back from the front edge
    expect(walkingToEdge.z).toBeLessThanOrEqual(-108.25 - 0.45 + 0.001)
  })
})
