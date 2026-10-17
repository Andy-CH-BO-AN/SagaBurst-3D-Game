import { markObstacleTopologyChanged } from '../world/ObstacleTopology'
import { removeObstacleData, type ObstacleData } from '../world/Terrain'

/** Opt-in siege structural colliders only. Keep the live array captured by flight
 * callers and retain authored roof/crown clearance records owned by TownWorld.
 */
export class TownSiegeAirspace {
  constructor(private readonly obstacles: ObstacleData[]) {}

  add(structures: readonly ObstacleData[]): void {
    let changed = false
    for (const obstacle of structures) {
      if (obstacle.physicalPassable || obstacle.damageable?.destroyed || this.obstacles.includes(obstacle)) continue
      this.obstacles.push(obstacle); changed = true
    }
    if (changed) markObstacleTopologyChanged(this.obstacles)
  }

  remove(structures: readonly ObstacleData[]): void {
    for (const obstacle of structures) removeObstacleData(this.obstacles, obstacle)
  }
}
