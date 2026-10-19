import type { Vector3 } from 'three'
import type { ObstacleData } from '../world/Terrain'

/** Town live shots only. Read the current source and bounds on every arrow,
 * including changes made by the preceding hit. No array/topology cache: ballistic
 * LOS callers may refill their own scratch arrays without changing their length.
 */
export class TownProjectileObstacles {
  private readonly candidates: ObstacleData[] = []

  /** Ephemeral buffer: consume immediately with the shared exact trace, before
   * applying hit effects or making another query. Source order/duplicates survive.
   */
  query(from: Vector3, to: Vector3, obstacles: readonly ObstacleData[]): readonly ObstacleData[] {
    this.candidates.length = 0
    const minX = Math.min(from.x, to.x), maxX = Math.max(from.x, to.x)
    const minY = Math.min(from.y, to.y), maxY = Math.max(from.y, to.y)
    const minZ = Math.min(from.z, to.z), maxZ = Math.max(from.z, to.z)
    // A second traversal is unhelpful for tiny sources or very broad sweeps.
    // Non-finite segments retain the exact function's original behavior as well.
    if (obstacles.length <= 4 || !Number.isFinite(minX + maxX + minY + maxY + minZ + maxZ)
      || maxX - minX > 64 || maxY - minY > 64 || maxZ - minZ > 64) return obstacles

    // Match the exact trace's world-space transform-rounding tolerance.
    const lowX = minX - 1e-6, highX = maxX + 1e-6
    const lowY = minY - 1e-6, highY = maxY + 1e-6
    const lowZ = minZ - 1e-6, highZ = maxZ + 1e-6
    for (const obstacle of obstacles) {
      if (obstacle.projectilePassable) continue
      // A transformed slab can protrude beyond its body/navigation box. Only
      // an explicit complete projectile bound may exclude it. Dynamic records
      // use these same live reads; physical collisionGroup bounds are not used.
      const bounds = obstacle.projectileBounds ?? (obstacle.projectileWorldToLocal ? null : obstacle.box)
      if (bounds && (highX < bounds.min.x || lowX > bounds.max.x
        || highY < bounds.min.y || lowY > bounds.max.y
        || highZ < bounds.min.z || lowZ > bounds.max.z)) continue
      this.candidates.push(obstacle)
    }
    return this.candidates
  }

  clear(): void { this.candidates.length = 0 }
}
