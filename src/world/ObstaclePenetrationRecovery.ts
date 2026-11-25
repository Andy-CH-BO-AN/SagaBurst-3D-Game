import type { Vector3 } from 'three'
import type { ObstacleData } from './Terrain'

/** Keep both the spatial query and recovery displacement local. */
export const OBSTACLE_RECOVERY_REACH = 12
const MAX_FACES_PER_AXIS = 32

/**
 * For a union of expanded rectangles, a nearest exit lies on one face or at
 * the intersection of two faces, projected from the original pose. Consider
 * both axes together so an overlapping neighbor can never undo a push.
 */
export function recoverHorizontalPosition(
  position: Vector3,
  radius: number,
  bottomY: number,
  topY: number,
  candidates: readonly ObstacleData[],
  worldBound: number,
  preferSupport: boolean,
  placement: (x: number, z: number) => 'supported' | 'clear' | 'blocked',
): boolean {
  const { x, z } = position
  const xFaces = new Set([x]), zFaces = new Set([z])
  for (const obstacle of candidates) {
    if (obstacle.physicalPassable || bottomY >= obstacle.box.max.y - .001 ||
      topY <= obstacle.box.min.y + .001) continue
    const bounds = obstacle.solidRecoveryBounds ?? obstacle.box
    xFaces.add(bounds.min.x - radius).add(bounds.max.x + radius)
    zFaces.add(bounds.min.z - radius).add(bounds.max.z + radius)
  }
  const nearestFaces = (faces: Set<number>, origin: number) => [...faces]
    .filter(face => Math.abs(face) <= worldBound && Math.abs(face - origin) <= OBSTACLE_RECOVERY_REACH)
    .sort((a, b) => Math.abs(a - origin) - Math.abs(b - origin) || b - a)
    .slice(0, MAX_FACES_PER_AXIS)
  const xs = nearestFaces(xFaces, x)
  const zs = nearestFaces(zFaces, z)

  let bestX = x, bestZ = z
  let bestDistance = Infinity, bestSupported = false
  const maxDistance = OBSTACLE_RECOVERY_REACH ** 2
  for (const candidateX of xs) {
    const dxSquared = (candidateX - x) ** 2
    for (const candidateZ of zs) {
      const distance = dxSquared + (candidateZ - z) ** 2
      if (distance > maxDistance || (!preferSupport || bestSupported) && distance >= bestDistance) break
      const result = placement(candidateX, candidateZ)
      if (result === 'blocked') continue
      const supported = result === 'supported'
      if ((supported && !bestSupported) || (supported === bestSupported && distance < bestDistance)) {
        bestX = candidateX
        bestZ = candidateZ
        bestDistance = distance
        bestSupported = supported
      }
    }
  }
  if (!Number.isFinite(bestDistance)) return false
  position.x = bestX
  position.z = bestZ
  return true
}
