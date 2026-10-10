import type { Mount } from './Mount'
import { isEagleLandingClear, type EagleLandingPoint } from './EagleLanding'
import { getTerrainHeight, type ObstacleData } from './Terrain'

export type EagleLandingOccupant = Pick<Mount, 'group' | 'aimCollider' | 'isFlyingMount' | 'dead' | 'disposed'>

/** Eagles reserve wing clearance; ground mounts occupy only their actual collision body. */
export function isEagleLandingClearOfMounts(point: EagleLandingPoint, obstacles: readonly ObstacleData[],
  occupied: readonly EagleLandingOccupant[], ownMount?: EagleLandingOccupant, bound = 300,
  terrainHeight: (x: number, z: number) => number = getTerrainHeight): boolean {
  const eagles: EagleLandingPoint[] = [], bodies: ObstacleData[] = []
  const ground = terrainHeight(point.x, point.z)
  for (const mount of occupied) {
    if (mount === ownMount || mount.dead || mount.disposed) continue
    if (mount.isFlyingMount) {
      if (Math.abs(mount.group.position.y - ground) < 15) {
        eagles.push({ x: mount.group.position.x, z: mount.group.position.z, yaw: mount.group.rotation.y })
      }
      continue
    }
    const collider = mount.aimCollider
    collider.updateWorldMatrix(true, false)
    if (!collider.geometry.boundingBox) collider.geometry.computeBoundingBox()
    bodies.push({ box: collider.geometry.boundingBox!.clone().applyMatrix4(collider.matrixWorld), isBarricade: false })
  }
  return isEagleLandingClear(point, bodies.length ? [...obstacles, ...bodies] : obstacles, eagles, bound, terrainHeight)
}
