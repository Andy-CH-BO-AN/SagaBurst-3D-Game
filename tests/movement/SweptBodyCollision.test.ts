import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { intersectsSweptPart } from '../../src/movement/SweptBodyCollision'
import { siegeRampFrontSkirtBox, siegeRampSideSkirtBox, siegeRampUnderfillBounds } from '../../src/campaign/MobileSiegeRampPolicy'
import { MobileSiegeRamp } from '../../src/campaign/MobileSiegeRamp'
import { getWalkRampHeight, resolveObstacleCollision, findBlockingProjectileObstacleAlongPath, TERRAIN_MIN_HEIGHT, type EntityCollisionBody, type ObstacleData } from '../../src/world/Terrain'

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

  it('recovers a saved actor from the ramp/deck seam outside the full hull without lifting them onto its roof', () => {
    const surface = { startX: 0, startZ: 0, startY: .04, topY: 8.04, dirX: 0, dirZ: 1,
      length: 20, landing: 6, halfWidth: 2.5, mounted: true }
    const deck = new THREE.Box3(new THREE.Vector3(-2.5, 7.79, 20), new THREE.Vector3(2.5, 8.04, 26))
    const underfill = siegeRampUnderfillBounds(new THREE.Box3(new THREE.Vector3(-2.5, -.21, 0),
      new THREE.Vector3(2.5, 8.04, 20)), deck, surface)
    const frame = new THREE.Vector3(0, 8.04, 26)
    const obstacles: ObstacleData[] = [
      { box: underfill, walkSurface: surface, solidBelow: TERRAIN_MIN_HEIGHT - .15, dynamic: true, isBarricade: true },
      { box: deck, walkSurface: surface, dynamic: true, isBarricade: true },
      ...[-1, 1].map(side => ({ box: siegeRampSideSkirtBox(new THREE.Box3(), surface, 0, 26, side, () => 0).translate(frame),
        dynamic: true, isBarricade: true })),
    ]
    const position = new THREE.Vector3(0, 0, 19.8)
    resolveObstacleCollision(position, position.clone(), 0, true, .5, 2.3, 0, obstacles, { walkSurfaces: true })
    expect(position.toArray()).toEqual([3.2, 0, 19.8])
    resolveObstacleCollision(position, position.clone(), 0, true, .5, 2.3, 0, obstacles, { walkSurfaces: true })
    expect(position.toArray()).toEqual([3.2, 0, 19.8])
    // Once recovered, an adjacent opponent has an unobstructed attack segment;
    // combat obstruction rules remain unchanged and the hull stays intact.
    expect(findBlockingProjectileObstacleAlongPath(new THREE.Vector3(4.5, 1, 19.8),
      new THREE.Vector3(position.x, 1, position.z), obstacles)).toBeNull()
    position.set(0, 8.04, 23)
    const previous = position.clone()
    resolveObstacleCollision(position, previous, 0, true, 1, 2.6, 0, obstacles, { mountedSurfaces: true })
    expect(position).toEqual(previous)
    // Flight has no walk-surface admission. Only the real wedge is solid, not
    // the taller front/deck AABB above this low tail section.
    previous.set(0, 4, 3)
    position.set(0, 4, 4)
    resolveObstacleCollision(position, previous, 0, false, .5, 2.3, 0, obstacles)
    expect(position.toArray()).toEqual([0, 4, 4])
  })

  it('stops the actual carrier for a body wholly inside its undercroft even when no shell part touches it', () => {
    const surface = { startX: 0, startZ: 0, startY: .04, topY: 8.04, dirX: 0, dirZ: 1,
      length: 20, landing: 6, halfWidth: 2.5 }
    const box = new THREE.Box3(new THREE.Vector3(-2.5, -.21, 0), new THREE.Vector3(2.5, 8.04, 26))
    interface MovementEntry { canMove(dt: number, actors: readonly never[], blockers: readonly EntityCollisionBody[]): boolean }
    // Numeric shell boundaries only: the real movement gate executes without
    // creating a renderer, scene, actor or vehicle model.
    const owner = Object.assign(Object.create(MobileSiegeRamp.prototype) as MovementEntry, {
      surface, position: new THREE.Vector3(0, 8.04, 26), placement: { dirZ: 1 },
      deck: { obstacle: { box } }, run: { obstacle: { box } }, scratch: new THREE.Vector3(),
      parts: [], wheelBodies: [], shared: [], obstacles: [], crew: new Map(),
    })
    const body = { position: new THREE.Vector3(0, 0, 23), radius: .5, height: 2.3, bottomOffset: 0 }
    expect(owner.canMove(.1, [], [body])).toBe(false)
    body.position.set(0, 8.04, 23)
    expect(owner.canMove(.1, [], [body])).toBe(true)
    body.position.set(-1, 0, -1.6)
    expect(owner.canMove(.1, [], [body])).toBe(true)
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
