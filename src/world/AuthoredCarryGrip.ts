import type { Vector3 } from 'three'

/** Minimum clavicle swing that puts the fixed wrist target inside the original
 * two-bone arm's reach. The shoulder stays on its original clavicle-length
 * sphere: no translated/dislocated joint, bone stretch or weapon movement.
 * Returns null for genuinely unreachable or invalid geometry. */
export function minimumReachableShoulderSwing(shoulderFromClavicle: Vector3, wristFromClavicle: Vector3, maxArmReach: number): number | null {
  const shoulderRadius = shoulderFromClavicle.length(), targetDistance = wristFromClavicle.length()
  if (!Number.isFinite(shoulderRadius + targetDistance + maxArmReach) || maxArmReach <= 0 || shoulderRadius < 1e-9) return null
  if (targetDistance < 1e-9) return shoulderRadius <= maxArmReach ? 0 : null
  if (Math.abs(targetDistance - shoulderRadius) > maxArmReach + 1e-10) return null
  const limitCos = (targetDistance ** 2 + shoulderRadius ** 2 - maxArmReach ** 2) / (2 * targetDistance * shoulderRadius)
  if (!Number.isFinite(limitCos)) return null
  const allowedAngle = Math.acos(Math.max(-1, Math.min(1, limitCos)))
  return Math.max(0, shoulderFromClavicle.angleTo(wristFromClavicle) - allowedAngle)
}
