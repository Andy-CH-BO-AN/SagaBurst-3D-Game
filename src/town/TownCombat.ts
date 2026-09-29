import * as THREE from 'three'

/** Large structures use their nearest surface, not their distant center or one blade snapshot. */
export function townMeleeBuildingContact(origin: THREE.Vector3, yaw: number, grip: THREE.Vector3, tip: THREE.Vector3, previousTip: THREE.Vector3, box: THREE.Box3, range: number, lance: boolean): boolean {
  const surface = box.clampPoint(origin, new THREE.Vector3())
  return townMeleeContact(origin, yaw, grip, tip, previousTip, surface, range, lance)
}

/** Evaluate the authored hit event against a front-facing actor capsule, including the swept blade. */
export function townMeleeContact(origin: THREE.Vector3, yaw: number, grip: THREE.Vector3, tip: THREE.Vector3, previousTip: THREE.Vector3, center: THREE.Vector3, range: number, lance: boolean): boolean {
  const delta = center.clone().sub(origin), distance = Math.hypot(delta.x, delta.z)
  if (distance > range + .55 || Math.abs(delta.y) > 1.7) return false
  const forward = delta.x * Math.sin(yaw) + delta.z * Math.cos(yaw)
  if (forward <= 0 || forward / Math.max(.001, distance) < (lance ? .75 : .2)) return false
  const closest = new THREE.Vector3()
  const bladeDistance = new THREE.Line3(grip, tip).closestPointToPoint(center, true, closest).distanceTo(center)
  const sweepDistance = new THREE.Line3(previousTip, tip).closestPointToPoint(center, true, closest).distanceTo(center)
  // A sword's single authored hit event may arrive after its blade crossed the capsule.
  // Its finite forward arc keeps the first hit independent of last frame's renderer matrices.
  return Math.min(bladeDistance, sweepDistance) <= .8 || (!lance && distance <= range && Math.abs(delta.y) < 1.3)
}
