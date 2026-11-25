import type { Box3, Vector3 } from 'three'
import type { ObstacleData } from './Terrain'

/** Keep both the spatial query and recovery displacement local. */
export const OBSTACLE_RECOVERY_REACH = 12
const MAX_FACES_PER_AXIS = 32
const MAX_RAY_EXITS = 8
const diagonal = Math.SQRT1_2
const RECOVERY_DIRECTIONS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [diagonal, diagonal], [diagonal, -diagonal], [-diagonal, diagonal], [-diagonal, -diagonal],
] as const

/** Union the projected intervals so buried faces never hide an exterior exit. */
function visitExteriorExits(boxes: readonly Box3[], x: number, z: number, radius: number,
  visit: (x: number, z: number) => void): void {
  const intervals: { start: number; end: number }[] = []
  for (const [dx, dz] of RECOVERY_DIRECTIONS) {
    intervals.length = 0
    for (const box of boxes) {
      const xMin = box.min.x - radius - x, xMax = box.max.x + radius - x
      const zMin = box.min.z - radius - z, zMax = box.max.z + radius - z
      if ((dx === 0 && (xMin >= 0 || xMax <= 0)) || (dz === 0 && (zMin >= 0 || zMax <= 0))) continue
      const start = Math.max(0, dx === 0 ? -Infinity : (dx > 0 ? xMin : xMax) / dx,
        dz === 0 ? -Infinity : (dz > 0 ? zMin : zMax) / dz)
      const end = Math.min(dx === 0 ? Infinity : (dx > 0 ? xMax : xMin) / dx,
        dz === 0 ? Infinity : (dz > 0 ? zMax : zMin) / dz)
      if (start < end && start < OBSTACLE_RECOVERY_REACH) intervals.push({ start, end })
    }
    intervals.sort((a, b) => a.start - b.start)
    let coveredUntil = 0, exits = 0
    for (const interval of intervals) {
      if (coveredUntil >= OBSTACLE_RECOVERY_REACH || exits >= MAX_RAY_EXITS) break
      if (interval.start > coveredUntil && coveredUntil > 0) {
        const distance = Math.min(coveredUntil + 1e-6, (coveredUntil + interval.start) / 2)
        visit(x + dx * distance, z + dz * distance)
        exits++
      }
      coveredUntil = Math.max(coveredUntil, interval.end)
    }
    if (coveredUntil > 0 && coveredUntil <= OBSTACLE_RECOVERY_REACH && exits < MAX_RAY_EXITS) {
      const distance = Math.min(coveredUntil + 1e-6, OBSTACLE_RECOVERY_REACH)
      visit(x + dx * distance, z + dz * distance)
    }
  }
}

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
  const recoveryBounds: Box3[] = []
  for (const obstacle of candidates) {
    if (obstacle.physicalPassable || bottomY >= obstacle.box.max.y - .001 ||
      topY <= obstacle.box.min.y + .001) continue
    const bounds = obstacle.solidRecoveryBounds ?? obstacle.box
    recoveryBounds.push(bounds)
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
  const consider = (candidateX: number, candidateZ: number, distance: number): void => {
    const result = placement(candidateX, candidateZ)
    if (result === 'blocked') return
    const supported = result === 'supported'
    if ((supported && !bestSupported) || (supported === bestSupported && distance < bestDistance)) {
      bestX = candidateX
      bestZ = candidateZ
      bestDistance = distance
      bestSupported = supported
    }
  }
  for (const candidateX of xs) {
    const dxSquared = (candidateX - x) ** 2
    for (const candidateZ of zs) {
      const distance = dxSquared + (candidateZ - z) ** 2
      if (distance > maxDistance || (!preferSupport || bestSupported) && distance >= bestDistance) break
      consider(candidateX, candidateZ, distance)
    }
  }
  if (!Number.isFinite(bestDistance) || preferSupport && !bestSupported) {
    // The face budget may be consumed by overlapping interior boxes. Project
    // whole connected intervals along a fixed set of local directions before
    // falling back to a different height or frame's position.
    visitExteriorExits(recoveryBounds, x, z, radius, (px, pz) => {
      const distance = (px - x) ** 2 + (pz - z) ** 2
      if (Math.abs(px) <= worldBound && Math.abs(pz) <= worldBound && distance <= maxDistance) consider(px, pz, distance)
    })
  }
  if (!Number.isFinite(bestDistance)) return false
  position.x = bestX
  position.z = bestZ
  return true
}
