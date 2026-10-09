import * as THREE from 'three'
import { findBlockingProjectileObstacleAlongPath, getTerrainHeight, TERRAIN_MIN_HEIGHT, type ObstacleData } from '../world/Terrain'

/** Shared by flight prediction and the actual projectile integrator, in m/s². */
export const PROJECTILE_GRAVITY = 9.8
export const MAX_BALLISTIC_FLIGHT_SECONDS = 24
export const MAX_TRAJECTORY_SEGMENTS = 192
const MAX_ARC_CHORD_ERROR = 0.025
const MAX_ARC_SEGMENT_METRES = 3

export interface ProjectileFlightBudget {
  readonly maxLifetimeSeconds: number
  readonly maxTravelDistance: number
}

/** Only a verified aerial shot opts into a longer scene lifetime. */
export function createProjectileFlightBudget(speed: number, flightTime: number): ProjectileFlightBudget {
  const maxLifetimeSeconds = Math.min(MAX_BALLISTIC_FLIGHT_SECONDS + 4, Math.max(5, flightTime * 1.2 + 1))
  return {
    maxLifetimeSeconds,
    // Triangle-inequality bound on the entire curved path, not endpoint distance.
    maxTravelDistance: speed * maxLifetimeSeconds + 0.5 * PROJECTILE_GRAVITY * maxLifetimeSeconds ** 2 + 2,
  }
}

/** Free-aim Player shots receive a lifetime, never an aim or speed adjustment. */
export function playerEagleProjectileBudget(origin: THREE.Vector3, direction: THREE.Vector3, speed: number): ProjectileFlightBudget {
  const length = direction.length()
  if (!Number.isFinite(origin.y + length + speed) || length <= 0 || speed <= 0) return { maxLifetimeSeconds: 0, maxTravelDistance: 0 }
  const velocityY = direction.y / length * speed
  const height = Math.max(0, origin.y - TERRAIN_MIN_HEIGHT)
  const groundTime = (velocityY + Math.sqrt(velocityY ** 2 + 2 * PROJECTILE_GRAVITY * height)) / PROJECTILE_GRAVITY
  return createProjectileFlightBudget(speed, Math.min(MAX_BALLISTIC_FLIGHT_SECONDS, groundTime))
}

/** First terrain contact on a frame's swept segment, shared by Game and Town. */
export function projectileTerrainContactTime(from: THREE.Vector3, to: THREE.Vector3): number {
  const steps = Math.min(128, Math.max(1, Math.ceil(from.distanceTo(to) / 2)))
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z
  if (from.y <= getTerrainHeight(from.x, from.z) + .05) return 0
  for (let i = 1; i <= steps; i++) {
    const end = i / steps
    if (from.y + dy * end > getTerrainHeight(from.x + dx * end, from.z + dz * end) + .05) continue
    let low = (i - 1) / steps, high = end
    for (let iteration = 0; iteration < 10; iteration++) {
      const middle = (low + high) / 2
      if (from.y + dy * middle > getTerrainHeight(from.x + dx * middle, from.z + dz * middle) + .05) low = middle
      else high = middle
    }
    return high
  }
  return Infinity
}

/** Number of swept chords, bounded in both spatial length and parabolic error. */
export function ballisticTrajectorySegments(speed: number, flightTime: number): number {
  const byLength = Math.ceil(speed * flightTime / MAX_ARC_SEGMENT_METRES)
  const maxStepSeconds = Math.sqrt(8 * MAX_ARC_CHORD_ERROR / PROJECTILE_GRAVITY)
  return Math.min(MAX_TRAJECTORY_SEGMENTS, Math.max(1, byLength, Math.ceil(flightTime / maxStepSeconds)))
}

/**
 * Reusable constant-velocity intercept solver. It chooses the first positive
 * root of |target-origin + targetVelocity*t + gravityCompensation| = speed*t.
 * Quartic extrema are isolated using the derivative's monotone intervals, so
 * near-maximum-range roots cannot fall between coarse time samples. All loops
 * have fixed bounds; the arrows themselves never steer after release.
 */
export class BallisticIntercept {
  readonly direction = new THREE.Vector3()
  readonly impactPoint = new THREE.Vector3()
  flightTime = 0
  private readonly derivativeIntervals = new Float64Array(4)
  private readonly extrema = new Float64Array(5)
  private readonly previous = new THREE.Vector3()
  private readonly point = new THREE.Vector3()

  solve(origin: THREE.Vector3, target: THREE.Vector3, velocity: THREE.Vector3, speed: number): boolean {
    this.flightTime = 0
    const rx = target.x - origin.x, ry = target.y - origin.y, rz = target.z - origin.z
    const vx = velocity.x, vy = velocity.y, vz = velocity.z
    if (!Number.isFinite(rx + ry + rz + vx + vy + vz + speed) || speed <= 0 || rx * rx + ry * ry + rz * rz < 1e-8) return false
    const a4 = PROJECTILE_GRAVITY ** 2 / 4
    const a3 = PROJECTILE_GRAVITY * vy
    const a2 = vx * vx + vy * vy + vz * vz + PROJECTILE_GRAVITY * ry - speed * speed
    const a1 = 2 * (rx * vx + ry * vy + rz * vz)
    const a0 = rx * rx + ry * ry + rz * rz
    const value = (t: number) => (((a4 * t + a3) * t + a2) * t + a1) * t + a0
    const derivative = (t: number) => ((4 * a4 * t + 3 * a3) * t + 2 * a2) * t + a1
    const limit = MAX_BALLISTIC_FLIGHT_SECONDS
    const intervals = this.derivativeIntervals
    let intervalCount = 1
    intervals[0] = 0
    const discriminant = (6 * a3) ** 2 - 4 * 12 * a4 * 2 * a2
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant)
      const first = (-6 * a3 - root) / (24 * a4)
      const second = (-6 * a3 + root) / (24 * a4)
      if (first > 0 && first < limit) intervals[intervalCount++] = first
      if (second > first && second > 0 && second < limit) intervals[intervalCount++] = second
    }
    intervals[intervalCount++] = limit
    const extrema = this.extrema
    let extremaCount = 1
    extrema[0] = 0
    for (let i = 1; i < intervalCount; i++) {
      let low = intervals[i - 1], high = intervals[i]
      const left = derivative(low), right = derivative(high)
      if (left * right < 0) {
        for (let step = 0; step < 36; step++) {
          const middle = (low + high) * 0.5
          if (derivative(middle) * left > 0) low = middle
          else high = middle
        }
        extrema[extremaCount++] = (low + high) * 0.5
      } else if (Math.abs(right) < 1e-8 && high < limit) extrema[extremaCount++] = high
    }
    extrema[extremaCount++] = limit
    for (let i = 1; i < extremaCount; i++) {
      let low = extrema[i - 1], high = extrema[i]
      if (value(high) > 1e-7) continue
      for (let step = 0; step < 40; step++) {
        const middle = (low + high) * 0.5
        if (value(middle) > 0) low = middle
        else high = middle
      }
      const t = (low + high) * 0.5
      this.flightTime = t
      this.direction.set(rx + vx * t, ry + vy * t + 0.5 * PROJECTILE_GRAVITY * t * t, rz + vz * t).normalize()
      this.impactPoint.copy(target).addScaledVector(velocity, t)
      return true
    }
    return false
  }

  isPathClear(origin: THREE.Vector3, speed: number, obstacles: readonly ObstacleData[],
    terrainHeight: (x: number, z: number) => number = getTerrainHeight): boolean {
    if (this.flightTime <= 0) return false
    const count = ballisticTrajectorySegments(speed, this.flightTime)
    this.previous.copy(origin)
    for (let i = 1; i <= count; i++) {
      const t = this.flightTime * i / count
      this.point.copy(origin).addScaledVector(this.direction, speed * t)
      this.point.y -= 0.5 * PROJECTILE_GRAVITY * t * t
      if (this.point.y <= terrainHeight(this.point.x, this.point.z) + 0.05
        || findBlockingProjectileObstacleAlongPath(this.previous, this.point, obstacles)) return false
      this.previous.copy(this.point)
    }
    return true
  }
}
