import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { intersectsSweptPart } from '../../src/movement/SweptBodyCollision'

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
