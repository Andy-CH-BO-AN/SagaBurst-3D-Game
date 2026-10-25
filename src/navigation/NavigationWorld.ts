import { TownLayeredNavigation } from './TownLayeredNavigation'
import type { TownRampartLayout } from '../town/TownRamparts'
import { obstacleTopologyRevision } from '../world/ObstacleTopology'
import {
  NavigationGrid,
  type NavigationCell,
  type NavigationGridOptions,
} from './NavigationGrid'
import {
  PLAYABLE_WORLD_BOUND,
  type ObstacleData,
} from '../world/Terrain'
import { OutpostLayeredNavigation } from './OutpostLayeredNavigation'
import type { OutpostWalkwayLayout } from '../campaign/CampaignOutpostWalkways'

export type NavigationPathQueryResult =
  | { status: 'path'; path: NavigationCell[] }
  | { status: 'pending' }
  | { status: 'unreachable' }

export const NAV_PATH_REQUESTS_PER_FRAME = 10
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
  private obstacleRevision = -1
  private obstacleSource: readonly ObstacleData[] | undefined
  private readonly dynamicFootprints = new Map<ObstacleData, string>()
  private componentIds: Int32Array
  private pathRequestsThisFrame = 0
  private pathSearchesDeferred = false
  /** A production default with a per-world override for tests and platform profiles. */
  private readonly pathRequestsPerFrame: number
  private readonly sharedPathCache = new Map<string, NavigationCell[] | null>()
  private readonly pendingPathOwners = new Map<object, { start: { x: number; z: number }; goal: { x: number; z: number } }>()
  townNav: TownLayeredNavigation | null = null
  setTownRamparts(layout: TownRampartLayout): void { this.townNav = new TownLayeredNavigation(layout, (a, b) => this.areConnected(a, b)) }

  private _outpostNav: OutpostLayeredNavigation | null = null

  get outpostNav(): OutpostLayeredNavigation | null {
    return this._outpostNav
  }

  setOutpostWalkways(layout: OutpostWalkwayLayout | null): void {
    this._outpostNav = layout ? new OutpostLayeredNavigation(layout) : null
  }

  constructor(bounds: NavigationGridOptions = {
    minX: -PLAYABLE_WORLD_BOUND,
    maxX: PLAYABLE_WORLD_BOUND,
    minZ: -PLAYABLE_WORLD_BOUND,
    maxZ: PLAYABLE_WORLD_BOUND,
  }, pathRequestsPerFrame = NAV_PATH_REQUESTS_PER_FRAME) {
    if (!Number.isInteger(pathRequestsPerFrame) || pathRequestsPerFrame < 1) throw new RangeError('pathRequestsPerFrame must be a positive integer')
    this.pathRequestsPerFrame = pathRequestsPerFrame
    this.grid = new NavigationGrid(bounds)
    this.componentIds = new Int32Array(this.grid.cellCount)
    this.componentIds.fill(-1)
  }

  get revision(): number {
    return this._revision
  }

  beginFrame(deferSearches = false): void {
    this.pathRequestsThisFrame = 0
    this.pathSearchesDeferred = deferSearches
    if (!deferSearches) this.drainWaitingOwners()
  }

  /** Moving Town carriers finish their topology update before spending this
   * frame's existing budget. Cached paths remain usable during early updates. */
  resumePathSearches(): void {
    if (!this.pathSearchesDeferred) return
    this.pathSearchesDeferred = false
    this.drainWaitingOwners()
  }

  private drainWaitingOwners(): void {
    // Admit deferred followers before earlier actors can consume this frame's
    // budget again. Map insertion order gives each waiting owner a turn;
    // repeated requests update its destination without moving it to the rear.
    const waiting = this.pendingPathOwners.size
    for (let index = 0; index < waiting && this.pathRequestsThisFrame < this.pathRequestsPerFrame; index++) {
      const next = this.pendingPathOwners.entries().next().value
      if (!next) break
      const [owner, request] = next
      this.pendingPathOwners.delete(owner)
      this.computePath(request.start, request.goal)
    }
  }

  /**
   * Obstacle creation/destruction and gate open/close all change the shared
   * obstacle collection revision or length. Rebuild only when topology changes.
   */
  sync(obstacles: readonly ObstacleData[]): boolean {
    let movingFootprint = false
    if (obstacles === this.obstacleSource && obstacles.length === this.obstacleCount
      && obstacleTopologyRevision(obstacles) === this.obstacleRevision) {
      // Only blocking dynamic bodies need observation. Sub-cell motion and
      // height changes do not alter ground topology or invalidate every route.
      let changed = false
      for (const [obstacle, footprint] of this.dynamicFootprints) {
        if (obstacle.navigationPassable || this.grid.boxCellRange(obstacle.navigationBox ?? obstacle.box).join(',') !== footprint) {
          changed = true; break
        }
      }
      if (!changed) return false
      movingFootprint = true
    }
    this.rebuild(obstacles, movingFootprint)
    return true
  }

  rebuild(obstacles: readonly ObstacleData[], preserveWaitingOwners = false): void {
    this.grid.clear()
    this.dynamicFootprints.clear()
    for (const obstacle of obstacles) {
      if (obstacle.navigationPassable) continue
      this.grid.setBlockedBox(obstacle.navigationBox ?? obstacle.box, true)
      if (obstacle.dynamic) this.dynamicFootprints.set(obstacle,
        this.grid.boxCellRange(obstacle.navigationBox ?? obstacle.box).join(','))
    }
    this._rebuildComponents()
    this.sharedPathCache.clear()
    // Waiting work stores coordinates, never a path through old topology.
    // Moving vehicles must not repeatedly send later actors to the queue's end.
    if (!preserveWaitingOwners) this.pendingPathOwners.clear()
    this.obstacleCount = obstacles.length
    this.obstacleSource = obstacles
    this.obstacleRevision = obstacleTopologyRevision(obstacles)
    this._revision++
  }

  queryPath(
    startPosition: { x: number; z: number },
    goalPosition: { x: number; z: number },
    owner?: object,
  ): NavigationPathQueryResult {
    const result = this.computePath(startPosition, goalPosition)
    if (owner) {
      if (result.status === 'pending') this.pendingPathOwners.set(owner,
        { start: { ...startPosition }, goal: { ...goalPosition } })
      else this.pendingPathOwners.delete(owner)
    }
    return result
  }

  private computePath(startPosition: { x: number; z: number }, goalPosition: { x: number; z: number }): NavigationPathQueryResult {
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

    if (this.pathSearchesDeferred || this.pathRequestsThisFrame >= this.pathRequestsPerFrame) {
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

  /** Component of a walkable position; blocked NPC spawn points may snap nearby. */
  componentAt(position: { x: number; z: number }): number {
    const cell = this.grid.findNearestWalkableCell(position, 2)
    return cell ? this._componentId(cell) : -1
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
