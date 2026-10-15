import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { BallisticIntercept, projectileTerrainContactTime } from '../../src/combat/ProjectileBallistics'
import { getTerrainHeight, type ObstacleData } from '../../src/world/Terrain'

/** Pure kinematics and swept-path policy: no actors, mounts, assets or scene fixture. */
describe('bounded projectile interception and arc clearance', () => {

  it('refuses an unreachable elevated target even inside the 200m engagement sphere', () => {
    const origin = new THREE.Vector3(), target = new THREE.Vector3(0, 90, 170)
    expect(origin.distanceTo(target)).toBeLessThan(200)
    const arc = new BallisticIntercept()
    expect(arc.solve(origin, target, new THREE.Vector3(), 45)).toBe(false)
    expect(arc.flightTime).toBe(0)
  })

  it('leads a moving aerial target with unchanged launch speed and gravity', () => {
    const origin = new THREE.Vector3(0, 30, 0), target = new THREE.Vector3(0, 40, 280)
    const velocity = new THREE.Vector3(20, 3, 0), arc = new BallisticIntercept()
    expect(arc.solve(origin, target, velocity, 65)).toBe(true)
    expect(arc.direction.x).toBeGreaterThan(0)
    const hit = origin.clone().addScaledVector(arc.direction, 65 * arc.flightTime)
    hit.y -= 4.9 * arc.flightTime ** 2
    expect(hit.distanceTo(target.clone().addScaledVector(velocity, arc.flightTime))).toBeLessThan(1e-6)
  })

  it('sweeps a thin wall between trajectory samples', () => {
    const origin = new THREE.Vector3(0, 31.4, -200), arc = new BallisticIntercept()
    expect(arc.solve(origin, new THREE.Vector3(0, 1.4, 200), new THREE.Vector3(), 65)).toBe(true)
    const t = arc.flightTime * .513
    const wallPoint = origin.clone().addScaledVector(arc.direction, 65 * t)
    wallPoint.y -= 4.9 * t * t
    const wall: ObstacleData = { isBarricade: true, box: new THREE.Box3(
      new THREE.Vector3(-5, wallPoint.y - .08, wallPoint.z - .005),
      new THREE.Vector3(5, wallPoint.y + .08, wallPoint.z + .005),
    ) }
    expect(arc.isPathClear(origin, 65, [wall], () => 0)).toBe(false)
    expect(arc.isPathClear(origin, 65, [], () => 0)).toBe(true)
  })
  it('blocks a terrain ridge between trajectory samples', () => {
    const origin = new THREE.Vector3(0, 31.4, -200), arc = new BallisticIntercept()
    expect(arc.solve(origin, new THREE.Vector3(0, 1.4, 200), new THREE.Vector3(), 65)).toBe(true)
    expect(arc.isPathClear(origin, 65, [], (_x, z) => Math.abs(z) < 10 ? 150 : 0)).toBe(false)
  })

})


describe('shared terrain first contact', () => {
  it('blocks a ridge between two above-ground frame endpoints', () => {
    const from = new THREE.Vector3(-100, 1.5, 0), to = new THREE.Vector3(100, 1.5, 0)
    expect(from.y).toBeGreaterThan(getTerrainHeight(from.x, from.z))
    expect(to.y).toBeGreaterThan(getTerrainHeight(to.x, to.z))
    const time = projectileTerrainContactTime(from, to)
    expect(time).toBeGreaterThan(0)
    expect(time).toBeLessThan(1)
    const contact = from.clone().lerp(to, time)
    expect(contact.y).toBeCloseTo(getTerrainHeight(contact.x, contact.z) + .05, 2)
  })
})
