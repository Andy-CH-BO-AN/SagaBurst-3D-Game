/** Ground mounted archery steering; +Z is forward and yaw = atan2(x, z). */
import type { TacticalOrder } from '../battle/TacticalOrder'
export type OrbitSide = -1 | 1
export interface OrbitPoint { x: number; z: number }
export const ORBIT_MAX_TURN_RATE = 0.9
const LATERAL_ACCELERATION = 6
// Target-relative aim supports the full 360° around the forward-moving mount.
// No yaw or physical shaft gate may block a valid ballistic shot.
export const MOUNTED_BOW_MAX_PITCH = Math.PI / 6
/** Maximum weapon range is unchanged; only the entry into circling is closer. */
export const MOUNTED_BOW_ORBIT_ENTRY_RATIO = 0.9

export function isWithinMountedBowOrbitRange(distanceSquared: number, maxRange: number): boolean {
  const entry = maxRange * MOUNTED_BOW_ORBIT_ENTRY_RATIO
  return distanceSquared <= entry * entry
}

export const angleDifference = (to: number, from: number): number => Math.atan2(Math.sin(to - from), Math.cos(to - from))
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))

/** Called only after reaching combat; the march command must not select strafe. */
export function canUseMountedBowOrbit(order: TacticalOrder, groundBow: boolean, holdingPosition: boolean): boolean {
  return groundBow && !holdingPosition && order !== 'defend'
}

export function orbitTurnRate(speed: number, radius = Infinity): number {
  // Tight enough to hold a fast mount's selected forward curve at full
  // existing travel speed; this changes heading only, never speed multipliers.
  const geometryRate = speed / Math.max(1, radius)
  return Math.min(ORBIT_MAX_TURN_RATE, Math.max(LATERAL_ACCELERATION / Math.max(1, speed), geometryRate))
}

export function orbitRadius(range: number, speed: number, phase: number): number {
  // Leave range for a moving target and spread riders over concentric lanes.
  const turningRadius = speed / orbitTurnRate(speed)
  return Math.min(range * .78, Math.max(range * (.52 + phase * .12), turningRadius * 1.15))
}

/** Borrowed output avoids per-frame vectors. The centre is refreshed each frame. */
export function writeOrbitDirection(
  out: OrbitPoint, position: OrbitPoint, target: OrbitPoint,
  side: OrbitSide, radius: number,
): void {
  const dx = position.x - target.x, dz = position.z - target.z
  const distance = Math.hypot(dx, dz)
  if (distance < .001) { out.x = side; out.z = 0; return }
  const radial = clamp((radius - distance) / Math.max(1, radius * .5), -.75, .75)
  const length = Math.hypot(1, radial)
  out.x = (side * dz + radial * dx) / distance / length
  out.z = (-side * dx + radial * dz) / distance / length
}

/** Avoidance supplies a desired bearing, never a lateral displacement. */
export function orbitHeading(yaw: number, desiredYaw: number, speed: number, dt: number, radius = Infinity): number {
  const step = orbitTurnRate(speed, radius) * clamp(dt, 0, .1)
  return yaw + clamp(angleDifference(desiredYaw, yaw), -step, step)
}

/** The same bounded heading owns both the visible facing and actual travel. */
export function steerOrbitForward(out: OrbitPoint, yaw: number, desiredYaw: number, speed: number, dt: number, radius = Infinity): number {
  const heading = orbitHeading(yaw, desiredYaw, speed, dt, radius)
  out.x = Math.sin(heading)
  out.z = Math.cos(heading)
  return heading
}

/** Pose budget only: arms absorb the remaining aim, including rearward shots.
 * This must never be used as a projectile-release eligibility check.
 */
export function mountedBowTorsoTurn(chestYaw: number, aimCorrection: number): number {
  const maxTwist = Math.PI * 5 / 9
  return clamp(chestYaw + aimCorrection, -maxTwist, maxTwist) - chestYaw
}
