import { obstacleTopologyRevision } from './ObstacleTopology'
import type { ObstacleCollisionGroup, ObstacleData } from './Terrain'

export const OBSTACLE_COLLISION_GRID_CELL_SIZE = 8

/**
 * Static spatial index for local obstacle collision queries.
 *
 * Static records occupy the grid; grouped dynamic parts first test their live
 * owner envelope, while ungrouped dynamic records retain direct bounds checks.
 * Gate/wall destruction and gate open/close mutate the
 * shared revision or length, so sync() only rebuilds when topology changes.
 *
 * queryNear() returns an ephemeral internal buffer. Callers must consume it
 * immediately and must not retain or mutate it.
 */
export class ObstacleCollisionSpatialIndex {
  private readonly dynamicIndices: number[] = []
  private readonly dynamicGroups: (ObstacleCollisionGroup & { indices: number[] })[] = []
  private readonly cells = new Map<string, number[]>()
  private readonly queryBuffer: ObstacleData[] = []
  private readonly queryIndices: number[] = []
  private obstacles: readonly ObstacleData[] = []
  private seenStamp = new Uint32Array(0)
  private queryStamp = 0
  private obstacleCount = -1
  private obstacleRevision = -1

  sync(obstacles: readonly ObstacleData[]): void {
    if (this.obstacles === obstacles && this.obstacleCount === obstacles.length && this.obstacleRevision === obstacleTopologyRevision(obstacles)) {
      return
    }

    this.obstacles = obstacles
    this.obstacleCount = obstacles.length
    this.obstacleRevision = obstacleTopologyRevision(obstacles)
    this.cells.clear()
    this.dynamicIndices.length = 0
    this.dynamicGroups.length = 0
    this.seenStamp = new Uint32Array(obstacles.length)
    const groups = new Map<ObstacleCollisionGroup, number[]>()

    for (let index = 0; index < obstacles.length; index++) {
      const obstacle = obstacles[index]
      if (obstacle.dynamic) {
        const group = obstacle.collisionGroup
        if (!group) this.dynamicIndices.push(index)
        else {
          let indices = groups.get(group)
          if (!indices) {
            indices = []
            groups.set(group, indices)
            this.dynamicGroups.push({ bounds: group.bounds, indices })
          }
          // Retain every source index, including repeated obstacle records.
          indices.push(index)
        }
        continue
      }
      const box = obstacle.box
      const minCellX = Math.floor(box.min.x / OBSTACLE_COLLISION_GRID_CELL_SIZE)
      const maxCellX = Math.floor(box.max.x / OBSTACLE_COLLISION_GRID_CELL_SIZE)
      const minCellZ = Math.floor(box.min.z / OBSTACLE_COLLISION_GRID_CELL_SIZE)
      const maxCellZ = Math.floor(box.max.z / OBSTACLE_COLLISION_GRID_CELL_SIZE)

      for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
        for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
          const key = this._cellKey(cellX, cellZ)
          let cell = this.cells.get(key)
          if (!cell) {
            cell = []
            this.cells.set(key, cell)
          }
          cell.push(index)
        }
      }
    }
  }

  queryNear(
    x: number,
    z: number,
    radius: number,
  ): readonly ObstacleData[] {
    this.queryBuffer.length = 0
    this.queryIndices.length = 0
    if (this.obstacles.length === 0) return this.queryBuffer

    const minCellX = Math.floor(
      (x - radius) / OBSTACLE_COLLISION_GRID_CELL_SIZE,
    )
    const maxCellX = Math.floor(
      (x + radius) / OBSTACLE_COLLISION_GRID_CELL_SIZE,
    )
    const minCellZ = Math.floor(
      (z - radius) / OBSTACLE_COLLISION_GRID_CELL_SIZE,
    )
    const maxCellZ = Math.floor(
      (z + radius) / OBSTACLE_COLLISION_GRID_CELL_SIZE,
    )

    const stamp = this._nextQueryStamp()

    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
      for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
        const cell = this.cells.get(this._cellKey(cellX, cellZ))
        if (!cell) continue

        for (let i = 0; i < cell.length; i++) {
          const obstacleIndex = cell[i]
          if (this.seenStamp[obstacleIndex] === stamp) continue
          this.seenStamp[obstacleIndex] = stamp
          this.queryIndices.push(obstacleIndex)
        }
      }
    }

    // Read owner bounds live: movement and bridge rotation do not change
    // topology. Only nearby owners need their original per-part broad phase.
    for (const group of this.dynamicGroups) {
      const bounds = group.bounds
      if (x + radius < bounds.min.x || x - radius > bounds.max.x
        || z + radius < bounds.min.z || z - radius > bounds.max.z) continue
      for (const index of group.indices) {
        const box = this.obstacles[index].box
        if (x + radius >= box.min.x && x - radius <= box.max.x
          && z + radius >= box.min.z && z - radius <= box.max.z) this.queryIndices.push(index)
      }
    }

    // General dynamic records without a complete owner envelope keep the
    // existing direct-bounds fallback.
    for (const index of this.dynamicIndices) {
      const box = this.obstacles[index].box
      if (x + radius >= box.min.x && x - radius <= box.max.x
        && z + radius >= box.min.z && z - radius <= box.max.z) this.queryIndices.push(index)
    }

    // Preserve the original shared obstacle-array order. Collision push-out can
    // be order-sensitive when an actor touches two adjacent boxes, so the broad
    // phase must only remove impossible obstacles, never reorder candidates.
    for (let i = 1; i < this.queryIndices.length; i++) {
      const value = this.queryIndices[i]
      let j = i - 1
      while (j >= 0 && this.queryIndices[j] > value) {
        this.queryIndices[j + 1] = this.queryIndices[j]
        j--
      }
      this.queryIndices[j + 1] = value
    }

    for (let i = 0; i < this.queryIndices.length; i++) {
      this.queryBuffer.push(this.obstacles[this.queryIndices[i]])
    }

    return this.queryBuffer
  }

  private _nextQueryStamp(): number {
    if (this.queryStamp === 0xffffffff) {
      this.seenStamp.fill(0)
      this.queryStamp = 1
    } else {
      this.queryStamp++
    }
    return this.queryStamp
  }

  private _cellKey(cellX: number, cellZ: number): string {
    return `${cellX},${cellZ}`
  }
}
