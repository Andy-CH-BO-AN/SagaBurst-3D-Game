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
export const NAV_SHARED_PATH_CACHE_LIMIT = 2048

export class NavigationWorld {
  readonly grid: NavigationGrid

  private _revision = 0
  private obstacleCount = -1
  private obstacleRevision = -1
  private obstacleSource: readonly ObstacleData[] | undefined
  private readonly dynamicFootprints = new Map<ObstacleData, Int32Array>()
  private readonly scratchFootprint = new Int32Array(4)
  private componentIds: Int32Array
  private readonly componentQueue: Int32Array
  private pathRequestsThisFrame = 0
  private pathSearchesDeferred = false
  /** A production default with a per-world override for tests and platform profiles. */
  private readonly pathRequestsPerFrame: number
  private readonly sharedPathCache = new Map<number | string, NavigationCell[] | null>()
  private readonly pendingPathOwners = new Map<object, { start: { x: number; z: number }; goal: { x: number; z: number } }>()
  townNav: TownLayeredNavigation | null = null
  setTownRamparts(layout: TownRampartLayout): void { this.townNav = new TownLayeredNavigation(layout, (a, b) => this.areConnected(a, b)) }

  private _outpostNav: OutpostLayeredNavigation | null = null

  get outpostNav(): OutpostLayeredNavigation | null {
    return this._outpostNav
  }

  setOutpostWalkways(layout: OutpostWalkwayLayout | null): void {
    this._outpostNav = layout ? new OutpostLayeredNavigation(layout, (a, b) => this.areConnected(a, b)) : null
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
    this.componentQueue = new Int32Array(this.grid.cellCount)
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
        if (obstacle.navigationPassable) {
          changed = true; break
        }
        this.grid.writeBoxCellRange(obstacle.navigationBox ?? obstacle.box, this.scratchFootprint)
        if (
          this.scratchFootprint[0] !== footprint[0]
          || this.scratchFootprint[1] !== footprint[1]
          || this.scratchFootprint[2] !== footprint[2]
          || this.scratchFootprint[3] !== footprint[3]
        ) {
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
      const box = obstacle.navigationBox ?? obstacle.box
      this.grid.setBlockedBox(box, true)
      if (obstacle.dynamic) {
        const footprint = new Int32Array(4)
        this.grid.writeBoxCellRange(box, footprint)
        this.dynamicFootprints.set(obstacle, footprint)
      }
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
    if (!this.sharedPathCache.has(cacheKey) && this.sharedPathCache.size >= NAV_SHARED_PATH_CACHE_LIMIT) {
      const oldest = this.sharedPathCache.keys().next().value
      if (oldest !== undefined) this.sharedPathCache.delete(oldest)
    }
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
  ): number | string {
    const startGroupX = Math.floor(start.x / NAV_PATH_GROUP_CELLS)
    const startGroupZ = Math.floor(start.z / NAV_PATH_GROUP_CELLS)
    const goalGroupX = Math.floor(goal.x / NAV_PATH_GROUP_CELLS)
    const goalGroupZ = Math.floor(goal.z / NAV_PATH_GROUP_CELLS)
    const groupWidth = Math.ceil(this.grid.width / NAV_PATH_GROUP_CELLS)
    const groupHeight = Math.ceil(this.grid.height / NAV_PATH_GROUP_CELLS)
    const groupCount = groupWidth * groupHeight
    if (startComponent === goalComponent && startComponent >= 0 && startComponent < 1048576 && groupCount <= 65536) {
      const startGroupIdx = startGroupZ * groupWidth + startGroupX
      const goalGroupIdx = goalGroupZ * groupWidth + goalGroupX
      return (startComponent * 65536 + startGroupIdx) * 65536 + goalGroupIdx
    }
    return `${startComponent}:${startGroupX},${startGroupZ}>${goalComponent}:${goalGroupX},${goalGroupZ}`
  }

  private _rebuildComponents(): void {
    this.grid.labelComponents(this.componentIds, this.componentQueue)
  }
}
