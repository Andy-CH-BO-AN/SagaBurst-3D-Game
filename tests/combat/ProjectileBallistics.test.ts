import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { BallisticIntercept, ballisticTrajectorySegments, createProjectileFlightBudget, playerEagleProjectileBudget, projectileTerrainContactTime } from '../../src/combat/ProjectileBallistics'
import { getTerrainHeight, type ObstacleData } from '../../src/world/Terrain'

/** Pure kinematics and swept-path policy: no actors, mounts, assets or scene fixture. */
describe('bounded projectile interception and arc clearance', () => {
  it.each([[200, 45], [300, 55], [400, 65], [500, 110]])('solves a real %dm shot with unchanged %dm/s launch speed', (range, speed) => {
    const arc = new BallisticIntercept(), origin = new THREE.Vector3(0, 1.4, -250)
    const target = new THREE.Vector3(0, 1.4, range - 250)
    expect(arc.solve(origin, target, new THREE.Vector3(), speed)).toBe(true)
    const hit = origin.clone().addScaledVector(arc.direction, speed * arc.flightTime)
    hit.y -= 4.9 * arc.flightTime ** 2
    expect(hit.distanceTo(target)).toBeLessThan(1e-6)
    expect(arc.direction.length()).toBeCloseTo(1, 10)
    expect(arc.isPathClear(origin, speed, [], () => 0)).toBe(true)
    expect(createProjectileFlightBudget(speed, arc.flightTime).maxLifetimeSeconds).toBeGreaterThan(arc.flightTime)
  })

  it('refuses an unreachable elevated target even inside the 200m engagement sphere', () => {
    const origin = new THREE.Vector3(), target = new THREE.Vector3(0, 90, 170)
    expect(origin.distanceTo(target)).toBeLessThan(200)
    const arc = new BallisticIntercept()
    expect(arc.solve(origin, target, new THREE.Vector3(), 45)).toBe(false)
    expect(arc.flightTime).toBe(0)
  })

  it('leads a moving aerial target with real gravity and refuses a target escaping faster than the arrow', () => {
    const origin = new THREE.Vector3(0, 30, 0), target = new THREE.Vector3(0, 40, 280)
    const velocity = new THREE.Vector3(20, 3, 0), arc = new BallisticIntercept()
    expect(arc.solve(origin, target, velocity, 65)).toBe(true)
    expect(arc.direction.x).toBeGreaterThan(0)
    const hit = origin.clone().addScaledVector(arc.direction, 65 * arc.flightTime)
    hit.y -= 4.9 * arc.flightTime ** 2
    expect(hit.distanceTo(target.clone().addScaledVector(velocity, arc.flightTime))).toBeLessThan(1e-6)
    expect(arc.solve(origin, target, new THREE.Vector3(0, 0, 70), 65)).toBe(false)
  })

  it('resolves a tangent maximum-range solution without depending on coarse time samples', () => {
    const arc = new BallisticIntercept()
    expect(arc.solve(new THREE.Vector3(), new THREE.Vector3(0, 0, 45 ** 2 / 9.8), new THREE.Vector3(), 45)).toBe(true)
    expect(arc.direction.y).toBeCloseTo(Math.SQRT1_2, 6)
    expect(arc.solve(new THREE.Vector3(), new THREE.Vector3(0, 0, 207), new THREE.Vector3(), 45)).toBe(false)
  })

  it('sweeps a thin wall between arc samples and blocks terrain without unbounded subdivisions', () => {
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
    expect(arc.isPathClear(origin, 65, [], (_x, z) => Math.abs(z) < 10 ? 150 : 0)).toBe(false)
    expect(arc.isPathClear(origin, 65, [], () => 0)).toBe(true)
    expect(ballisticTrajectorySegments(65, arc.flightTime)).toBeGreaterThan(16)
    expect(ballisticTrajectorySegments(110, 24)).toBeLessThanOrEqual(192)
  })
})


describe('free-aim Player eagle flight budgets', () => {
  it.each([[40, 30, -1], [45, 30, 0], [65, 120, .5], [110, 125, 1]])(
    'bounds speed=%dm/s from height=%dm and vertical aim=%d without changing the shot', (speed, height, aimY) => {
      const origin = new THREE.Vector3(20, height, 30), direction = new THREE.Vector3(0, aimY, aimY === 0 ? 1 : 0)
      const original = direction.clone()
      const budget = playerEagleProjectileBudget(origin, direction, speed)
      const verticalSpeed = direction.y / direction.length() * speed
      const contactTime = (verticalSpeed + Math.sqrt(verticalSpeed ** 2 + 19.6 * (height + 3.7))) / 9.8
      expect(budget.maxLifetimeSeconds).toBeGreaterThan(contactTime)
      expect(budget.maxLifetimeSeconds).toBeLessThanOrEqual(28)
      expect(budget.maxTravelDistance).toBeGreaterThan(speed * contactTime)
      expect(direction.equals(original)).toBe(true)
    })
  it('returns an immediately exhausted budget for invalid launch data', () => {
    expect(playerEagleProjectileBudget(new THREE.Vector3(), new THREE.Vector3(), 110).maxLifetimeSeconds).toBe(0)
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
    expect(projectileTerrainContactTime(new THREE.Vector3(-100, 10, 0), new THREE.Vector3(100, 10, 0))).toBe(Infinity)
  })
})
