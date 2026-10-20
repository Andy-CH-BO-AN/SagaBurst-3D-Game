import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { intersectsSweptPart } from '../../src/movement/SweptBodyCollision'
import { siegeRampFrontSkirtBox, siegeRampSideSkirtBox } from '../../src/campaign/MobileSiegeRampPolicy'
import { getWalkRampHeight, resolveObstacleCollision, type ObstacleData } from '../../src/world/Terrain'

describe('vehicle part swept body collision (pure geometry)', () => {
  const board = new THREE.Box3(new THREE.Vector3(-2.5, -.25, -3), new THREE.Vector3(2.5, 0, 3))
  const inverse = new THREE.Matrix4().makeTranslation(0, -4, 0)

  it.each([{ radius: .5, x: 2.8 }, { radius: 1, x: 3.2 }])('includes body radius $radius outside the board edge', ({ radius, x }) => {
    const body = { position: new THREE.Vector3(x, 3, 0), radius, height: 1.9, bottomOffset: 0 }
    expect(intersectsSweptPart(body, board, inverse, .2)).toBe(true)
    body.position.x = 2.5 + radius + .01
    expect(intersectsSweptPart(body, board, inverse, .2)).toBe(false)
  })

  it('keeps a sloping board underside instead of blocking the empty space in its world AABB', () => {
    const slopeInverse = new THREE.Matrix4().compose(new THREE.Vector3(0, 4, 0),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -.24), new THREE.Vector3(1, 1, 4)).invert()
    const body = { position: new THREE.Vector3(0, 1, 8), radius: .5, height: 1.9, bottomOffset: 0 }
    expect(intersectsSweptPart(body, board, slopeInverse, .2)).toBe(false)
    body.position.y = 5
    expect(intersectsSweptPart(body, board, slopeInverse, .2)).toBe(true)
  })
  it('seals the moving ramp sides below the slope while keeping the upper lane and rear pushers clear', () => {
    const surface = { startX: 0, startZ: 0, startY: .04, topY: 8.04, dirX: 0, dirZ: 1,
      length: 20, landing: 6, halfWidth: 2.5, mounted: true }
    const frame = new THREE.Vector3(0, surface.topY, 26)
    const skirt = siegeRampSideSkirtBox(new THREE.Box3(), surface, 2, 2, -1, () => 0).translate(frame)
    const obstacles: ObstacleData[] = [{ box: skirt, dynamic: true, isBarricade: true }]
    const previous = new THREE.Vector3(-4, 0, 3), body = new THREE.Vector3(-1, 0, 3)
    resolveObstacleCollision(body, previous, 0, true, 1, 2.6, 0, obstacles, { mountedSurfaces: true })
    expect(body.x).toBeCloseTo(-3.7)
    // A moving chassis still stops for a body against its skirt; no enclosing lane box.
    const collisionBody = { position: new THREE.Vector3(-2.6, 0, 3), radius: .5, height: 2.3, bottomOffset: 0 }
    expect(intersectsSweptPart(collisionBody, skirt, new THREE.Matrix4(), .1)).toBe(true)
    body.set(0, getWalkRampHeight(surface, 0, 3)!, 3)
    previous.copy(body)
    resolveObstacleCollision(body, previous, 0, true, 1, 2.6, 0, obstacles, { mountedSurfaces: true })
    expect(body).toEqual(previous)
    collisionBody.position.set(-1, 0, -1.6)
    expect(intersectsSweptPart(collisionBody, skirt, new THREE.Matrix4(), .1)).toBe(false)
    // The same reused bounds follow terrain and translation on the next geometry update.
    surface.startZ = 5
    siegeRampSideSkirtBox(skirt, surface, 2, 2, -1, (_x, z) => z / 10)
    expect(skirt.min.y + surface.topY).toBeCloseTo(.55)
  })

  it('closes the front under the deck without blocking infantry on its bridge connection', () => {
    const surface = { startX: 0, startZ: 0, startY: .04, topY: 8.04, dirX: 0, dirZ: 1,
      length: 20, landing: 6, halfWidth: 2.5, mounted: true }
    const front = siegeRampFrontSkirtBox(new THREE.Box3(), surface, () => 0)
      .translate(new THREE.Vector3(0, surface.topY, 26))
    const obstacles: ObstacleData[] = [{ box: front, dynamic: true, isBarricade: true }]
    const previous = new THREE.Vector3(0, 0, 28), body = new THREE.Vector3(0, 0, 24)
    resolveObstacleCollision(body, previous, 0, true, .5, 2.3, 0, obstacles, { walkSurfaces: true })
    expect(body.z).toBeCloseTo(26.5)
    previous.set(0, surface.topY, 25)
    body.set(0, surface.topY, 27)
    resolveObstacleCollision(body, previous, 0, true, .5, 2.3, 0, obstacles, { walkSurfaces: true })
    expect(body.toArray()).toEqual([0, 8.04, 27])
  })

  it('sweeps an East/West oriented part along X without treating that travel as Z', () => {
    const part = new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1))
    const inverse = new THREE.Matrix4().makeRotationY(-Math.PI / 2)
    const body = { position: new THREE.Vector3(2, 0, 0), radius: .2, height: 1.8, bottomOffset: 0 }
    expect(intersectsSweptPart(body, part, inverse, 0, 1)).toBe(true)
    expect(intersectsSweptPart(body, part, inverse, 1)).toBe(false)
    body.position.x = -2
    expect(intersectsSweptPart(body, part, inverse, 0, -1)).toBe(true)
    expect(intersectsSweptPart(body, part, inverse, 0, 1)).toBe(false)
  })

})
