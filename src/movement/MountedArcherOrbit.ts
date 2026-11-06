/** Ground mounted archery steering; +Z is forward and yaw = atan2(x, z). */
import type { TacticalOrder } from '../battle/TacticalOrder'
export type OrbitSide = -1 | 1
export interface OrbitPoint { x: number; z: number }
export const ORBIT_MAX_TURN_RATE = 0.9
const LATERAL_ACCELERATION = 6
export const MOUNTED_BOW_MAX_YAW = Math.PI * 0.61
export const MOUNTED_BOW_MAX_PITCH = Math.PI / 6
export const BOW_ALIGNMENT_COS = Math.cos(Math.PI / 36)
export const MOUNTED_BOW_MAX_TORSO_YAW = Math.PI * 5 / 9

export const angleDifference = (to: number, from: number): number => Math.atan2(Math.sin(to - from), Math.cos(to - from))
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))

/** Called only after reaching combat; the march command must not select strafe. */
export function canUseMountedBowOrbit(order: TacticalOrder, groundBow: boolean, holdingPosition: boolean): boolean {
  return groundBow && !holdingPosition && order !== 'defend'
}

export function orbitTurnRate(speed: number): number {
  return Math.min(ORBIT_MAX_TURN_RATE, LATERAL_ACCELERATION / Math.max(1, speed))
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
export function orbitHeading(yaw: number, desiredYaw: number, speed: number, dt: number): number {
  const step = orbitTurnRate(speed) * clamp(dt, 0, .1)
  return yaw + clamp(angleDifference(desiredYaw, yaw), -step, step)
}

/** The same bounded heading owns both the visible facing and actual travel. */
export function steerOrbitForward(out: OrbitPoint, yaw: number, desiredYaw: number, speed: number, dt: number): number {
  const heading = orbitHeading(yaw, desiredYaw, speed, dt)
  out.x = Math.sin(heading)
  out.z = Math.cos(heading)
  return heading
}

/** Keep moving during acquisition, but slow a tight turn to its feasible radius. */
export function orbitSpeed(baseSpeed: number, range: number, yawError: number): number {
  return Math.min(baseSpeed, Math.sqrt(LATERAL_ACCELERATION * range * .62))
    * (.45 + .55 * Math.max(0, Math.cos(yawError)))
}

export function canAimMountedBow(yaw: number, pitch: number): boolean {
  return Math.abs(yaw) <= MOUNTED_BOW_MAX_YAW && Math.abs(pitch) <= MOUNTED_BOW_MAX_PITCH
}

/** The authored bow already turns the chest; limit the total, not just the added yaw. */
export function mountedBowTorsoTurn(chestYaw: number, aimCorrection: number): number {
  return clamp(chestYaw + aimCorrection, -MOUNTED_BOW_MAX_TORSO_YAW, MOUNTED_BOW_MAX_TORSO_YAW) - chestYaw
}

/** The event may release only when both the body arc and the real shaft agree. */
export function canReleaseMountedBow(yaw: number, pitch: number, shaftDot: number): boolean {
  return canAimMountedBow(yaw, pitch) && shaftDot >= BOW_ALIGNMENT_COS
}
