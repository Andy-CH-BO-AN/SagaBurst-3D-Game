import * as THREE from 'three'

export const FOLLOW_THRESHOLDS = {
  holdDistance: 1.5,
  runDistance: 6,
  regroupDistance: 12,
  infantrySpacing: 2.8,
  mountedSpacing: 4.4,
} as const

/** Stable, deterministic slots. Mounted units use a wider outer/rear envelope. */
export function followLocalOffset(slotIndex: number, mounted = false): THREE.Vector3 {
  const spacing = mounted ? FOLLOW_THRESHOLDS.mountedSpacing : FOLLOW_THRESHOLDS.infantrySpacing
  const row = Math.floor(Math.max(0, slotIndex) / 2) + 1
  const side = slotIndex % 2 === 0 ? -1 : 1
  const lateral = side * spacing * (.55 + Math.min(row, 3) * .18)
  return new THREE.Vector3(lateral, 0, -row * spacing)
}

export function followSlotWorldPosition(
  leaderPosition: THREE.Vector3,
  leaderYaw: number,
  localOffset: THREE.Vector3,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  const rightX = Math.cos(leaderYaw)
  const rightZ = -Math.sin(leaderYaw)
  const forwardX = Math.sin(leaderYaw)
  const forwardZ = Math.cos(leaderYaw)
  return out.set(
    leaderPosition.x + rightX * localOffset.x + forwardX * localOffset.z,
    leaderPosition.y + localOffset.y,
    leaderPosition.z + rightZ * localOffset.x + forwardZ * localOffset.z,
  )
}

