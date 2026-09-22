import {
  NavigationGrid,
  type NavigationCell,
} from './NavigationGrid'
import {
  PLAYABLE_WORLD_BOUND,
  type ObstacleData,
} from '../world/Terrain'

export type NavigationPathQueryResult =
  | { status: 'path'; path: NavigationCell[] }
  | { status: 'pending' }
  | { status: 'unreachable' }

export const NAV_PATH_REQUESTS_PER_FRAME = 2
export const NAV_PATH_GROUP_CELLS = 2

const COMPONENT_NEIGHBORS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
]

export class NavigationWorld {
  readonly grid: NavigationGrid

  private _revision = 0
  private obstacleCount = -1
  private componentIds: Int32Array
  private pathRequestsThisFrame = 0
  private readonly sharedPathCache = new Map<string, NavigationCell[] | null>()

  constructor() {
    this.grid = new NavigationGrid({
      minX: -PLAYABLE_WORLD_BOUND,
      maxX: PLAYABLE_WORLD_BOUND,
      minZ: -PLAYABLE_WORLD_BOUND,
      maxZ: PLAYABLE_WORLD_BOUND,
    })
    this.componentIds = new Int32Array(this.grid.cellCount)
    this.componentIds.fill(-1)
  }

  get revision(): number {
    return this._revision
  }

  beginFrame(): void {
    this.pathRequestsThisFrame = 0
  }

  /**
   * Obstacle creation/destruction and gate open/close all change the shared
   * obstacle collection length. Rebuild only when that topology changes.
   */
  sync(obstacles: readonly ObstacleData[]): boolean {
    if (obstacles.length === this.obstacleCount) return false
    this.rebuild(obstacles)
    return true
  }

  rebuild(obstacles: readonly ObstacleData[]): void {
    this.grid.clear()
    for (const obstacle of obstacles) {
      this.grid.setBlockedBox(obstacle.box, true)
    }
    this._rebuildComponents()
    this.sharedPathCache.clear()
    this.obstacleCount = obstacles.length
    this._revision++
  }

  queryPath(
    startPosition: { x: number; z: number },
    goalPosition: { x: number; z: number },
  ): NavigationPathQueryResult {
    const startCell = this.grid.findNearestWalkableCell(startPosition, 2)
    const goalCell = this.grid.findNearestWalkableCell(goalPosition, 3)
    if (!startCell || !goalCell) return { status: 'unreachable' }

    const startComponent = this._componentId(startCell)
    const goalComponent = this._componentId(goalCell)
    if (
      startComponent < 0
      || goalComponent < 0
      || startComponent !== goalComponent
    ) {
      // Important performance fast-path: do not run a full A* search when the
      // static topology already proves these positions are disconnected.
      return { status: 'unreachable' }
    }

    const cacheKey = this._sharedPathKey(
      startCell,
      goalCell,
      startComponent,
      goalComponent,
    )
    if (this.sharedPathCache.has(cacheKey)) {
      const cached = this.sharedPathCache.get(cacheKey) ?? null
      return cached
        ? { status: 'path', path: cached }
        : { status: 'unreachable' }
    }

    if (this.pathRequestsThisFrame >= NAV_PATH_REQUESTS_PER_FRAME) {
      return { status: 'pending' }
    }
    this.pathRequestsThisFrame++

    const path = this.grid.findPathCells(startCell, goalCell)
    this.sharedPathCache.set(cacheKey, path)
    return path
      ? { status: 'path', path }
      : { status: 'unreachable' }
  }

  areConnected(
    startPosition: { x: number; z: number },
    goalPosition: { x: number; z: number },
  ): boolean {
    const startCell = this.grid.findNearestWalkableCell(startPosition, 2)
    const goalCell = this.grid.findNearestWalkableCell(goalPosition, 3)
    if (!startCell || !goalCell) return false

    const startComponent = this._componentId(startCell)
    const goalComponent = this._componentId(goalCell)
    return startComponent >= 0 && startComponent === goalComponent
  }

  private _componentId(cell: NavigationCell): number {
    return this.componentIds[cell.z * this.grid.width + cell.x]
  }

  private _sharedPathKey(
    start: NavigationCell,
    goal: NavigationCell,
    startComponent: number,
    goalComponent: number,
  ): string {
    const startGroupX = Math.floor(start.x / NAV_PATH_GROUP_CELLS)
    const startGroupZ = Math.floor(start.z / NAV_PATH_GROUP_CELLS)
    const goalGroupX = Math.floor(goal.x / NAV_PATH_GROUP_CELLS)
    const goalGroupZ = Math.floor(goal.z / NAV_PATH_GROUP_CELLS)
    return `${startComponent}:${startGroupX},${startGroupZ}>${goalComponent}:${goalGroupX},${goalGroupZ}`
  }

  private _rebuildComponents(): void {
    this.componentIds.fill(-1)
    const queue = new Int32Array(this.grid.cellCount)
    let nextComponentId = 0

    for (let z = 0; z < this.grid.height; z++) {
      for (let x = 0; x < this.grid.width; x++) {
        const startIndex = z * this.grid.width + x
        if (this.grid.isBlockedXZ(x, z) || this.componentIds[startIndex] >= 0) continue

        let read = 0
        let write = 0
        queue[write++] = startIndex
        this.componentIds[startIndex] = nextComponentId

        while (read < write) {
          const index = queue[read++]
          const currentX = index % this.grid.width
          const currentZ = Math.floor(index / this.grid.width)

          for (const [dx, dz] of COMPONENT_NEIGHBORS) {
            const nextX = currentX + dx
            const nextZ = currentZ + dz
            if (
              nextX < 0
              || nextX >= this.grid.width
              || nextZ < 0
              || nextZ >= this.grid.height
            ) continue

            if (this.grid.isBlockedXZ(nextX, nextZ)) continue

            if (
              dx !== 0
              && dz !== 0
              && (
                this.grid.isBlockedXZ(currentX + dx, currentZ)
                || this.grid.isBlockedXZ(currentX, currentZ + dz)
              )
            ) {
              continue
            }

            const nextIndex = nextZ * this.grid.width + nextX
            if (this.componentIds[nextIndex] >= 0) continue

            this.componentIds[nextIndex] = nextComponentId
            queue[write++] = nextIndex
          }
        }

        nextComponentId++
      }
    }
  }
}
