import * as THREE from 'three'
import { type NavigationCell } from './NavigationGrid'
import { NAV_PATH_GROUP_CELLS, type NavigationWorld } from './NavigationWorld'

export type NavigationRouteKind = 'direct' | 'path' | 'pending' | 'unreachable'

export class NavigationPathFollower {
  private path: NavigationCell[] | null = null
  private pathIndex = 0
  private goalGroupX = -1
  private goalGroupZ = -1
  private revision = -1
  private computed = false

  clear(): void {
    this.path = null
    this.pathIndex = 0
    this.goalGroupX = -1
    this.goalGroupZ = -1
    this.revision = -1
    this.computed = false
  }

  resolveMoveTarget(
    start: THREE.Vector3,
    goal: THREE.Vector3,
    navigationWorld: NavigationWorld,
    directPathBlocked: boolean,
    out: THREE.Vector3,
  ): NavigationRouteKind {
    if (!directPathBlocked) {
      this.clear()
      out.copy(goal)
      return 'direct'
    }

    const grid = navigationWorld?.grid
    if (!grid) {
      // Defensive fallback for stale DEV/HMR callers while navigation APIs are
      // being migrated. Production callers should always pass NavigationWorld.
      this.clear()
      out.copy(goal)
      return 'unreachable'
    }

    const goalCell = grid.worldToCell(goal)
    if (!goalCell) {
      this.clear()
      return 'unreachable'
    }

    const goalGroupX = Math.floor(goalCell.x / NAV_PATH_GROUP_CELLS)
    const goalGroupZ = Math.floor(goalCell.z / NAV_PATH_GROUP_CELLS)
    const goalChanged = (
      goalGroupX !== this.goalGroupX
      || goalGroupZ !== this.goalGroupZ
    )
    const topologyChanged = navigationWorld.revision !== this.revision
    const needsReplan = !this.computed || goalChanged || topologyChanged

    if (needsReplan) {
      const result = navigationWorld.queryPath(start, goal)

      if (result.status === 'pending') {
        // Topology changes invalidate old routes immediately. Goal movement on
        // unchanged topology may continue following the previous safe route.
        if (!topologyChanged && this._writePathTarget(start, grid, out)) {
          return 'path'
        }
        out.copy(goal)
        return 'pending'
      }

      if (result.status === 'unreachable') {
        this.path = null
        this.pathIndex = 0
        this.goalGroupX = goalGroupX
        this.goalGroupZ = goalGroupZ
        this.revision = navigationWorld.revision
        this.computed = true
        return 'unreachable'
      }

      this.path = result.path
      this.pathIndex = this.path.length > 1 ? 1 : 0
      this.goalGroupX = goalGroupX
      this.goalGroupZ = goalGroupZ
      this.revision = navigationWorld.revision
      this.computed = true
    }

    if (!this.path || this.path.length <= 1) return 'unreachable'
    if (this._writePathTarget(start, grid, out)) return 'path'

    out.copy(goal)
    return 'path'
  }

  private _writePathTarget(
    start: THREE.Vector3,
    grid: NavigationWorld['grid'],
    out: THREE.Vector3,
  ): boolean {
    if (!this.path || this.path.length <= 1) return false

    const arrivalDistance = grid.cellSize * 0.45
    const arrivalDistanceSq = arrivalDistance * arrivalDistance

    while (this.pathIndex < this.path.length) {
      grid.cellToWorldInto(this.path[this.pathIndex], out, start.y)
      const dx = out.x - start.x
      const dz = out.z - start.z
      if (dx * dx + dz * dz > arrivalDistanceSq) return true
      this.pathIndex++
    }

    return false
  }
}
