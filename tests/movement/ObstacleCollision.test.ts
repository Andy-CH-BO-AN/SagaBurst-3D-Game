import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { resolveCameraDistance } from '../../src/camera/ThirdPersonCamera'
import { FallingRider, riderFallDamage } from '../../src/movement/FallingRider'
import { resolveObstacleCollision, type ObstacleData } from '../../src/world/Terrain'

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
      const position = new THREE.Vector3(0, .98, 5)
      const collision = resolveObstacleCollision(position, new THREE.Vector3(0, 1, 5), -1, false,
        .5, 2, 1, obstacles, { walkSurfaces: true })
      expect(position.y).toBeCloseTo(1.6)
      expect(collision).toEqual({ velocityY: 0, onGround: true })
    }
  })

  it('catches a fast mounted fall only on the deck whose footprint the descent actually crosses', () => {
    const position = new THREE.Vector3(0, 4, 5)
    // The crossing of y=12 is outside the upper deck; y=6 is inside the lower deck.
    const collision = resolveObstacleCollision(position, new THREE.Vector3(-10, 15, 5), -30, false,
      1, 2.6, 0, [deck(12), deck(6)], { mountedSurfaces: true })
    expect(position.toArray()).toEqual([0, 6, 5])
    expect(collision).toEqual({ velocityY: 0, onGround: true })
  })

  it('stops a rising body at the underside without promoting it onto a higher level', () => {
    const position = new THREE.Vector3(0, 5, 5)
    const collision = resolveObstacleCollision(position, new THREE.Vector3(0, 3, 5), 8, false,
      .5, 2, 0, [deck(6), deck(12)], { walkSurfaces: true })
    expect(position.y).toBeCloseTo(3.65)
    expect(collision).toEqual({ velocityY: 0, onGround: false })
  })

  it('discards ramp support when a later wall push moves the body off its edge', () => {
    const wall: ObstacleData = { isBarricade: false,
      box: new THREE.Box3(new THREE.Vector3(-2, 0, 0), new THREE.Vector3(2, 10, 10)) }
    const position = new THREE.Vector3(1.8, 5.98, 5)
    const collision = resolveObstacleCollision(position, new THREE.Vector3(1.8, 6, 5), -1, false,
      .5, 2, 0, [wall, deck(6)], { walkSurfaces: true })
    expect(position.toArray()).toEqual([2.5, 5.98, 5])
    expect(collision).toEqual({ velocityY: -1, onGround: false })
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
