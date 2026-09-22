import * as THREE from 'three'

export const DEFAULT_NAV_CELL_SIZE = 2

const SQRT2 = Math.SQRT2
const COST_EPSILON = 1e-6

export interface NavigationGridOptions {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  cellSize?: number
}

export interface NavigationCell {
  x: number
  z: number
}

export type NavigationGridSearchResult =
  | { status: 'path'; path: NavigationCell[]; expandedNodes: number }
  | { status: 'pending'; expandedNodes: number }
  | { status: 'unreachable'; expandedNodes: number }

class MinHeap {
  private readonly indices: number[] = []
  private readonly gScores: number[] = []
  private readonly fScores: number[] = []
  private _size = 0
  private _lastPoppedG = 0

  get size(): number {
    return this._size
  }

  get lastPoppedG(): number {
    return this._lastPoppedG
  }

  clear(): void {
    this._size = 0
  }

  push(indexValue: number, gValue: number, fValue: number): void {
    let index = this._size++

    while (index > 0) {
      const parent = (index - 1) >> 1
      if (this.fScores[parent] <= fValue) break

      this.indices[index] = this.indices[parent]
      this.gScores[index] = this.gScores[parent]
      this.fScores[index] = this.fScores[parent]
      index = parent
    }

    this.indices[index] = indexValue
    this.gScores[index] = gValue
    this.fScores[index] = fValue
  }

  popIndex(): number {
    if (this._size === 0) return -1

    const rootIndex = this.indices[0]
    this._lastPoppedG = this.gScores[0]
    this._size--

    if (this._size === 0) return rootIndex

    const lastIndex = this.indices[this._size]
    const lastG = this.gScores[this._size]
    const lastF = this.fScores[this._size]

    let index = 0
    while (true) {
      const left = index * 2 + 1
      if (left >= this._size) break

      const right = left + 1
      const smaller = right < this._size && this.fScores[right] < this.fScores[left]
        ? right
        : left
      if (this.fScores[smaller] >= lastF) break

      this.indices[index] = this.indices[smaller]
      this.gScores[index] = this.gScores[smaller]
      this.fScores[index] = this.fScores[smaller]
      index = smaller
    }

    this.indices[index] = lastIndex
    this.gScores[index] = lastG
    this.fScores[index] = lastF
    return rootIndex
  }
}

const NEIGHBORS: readonly [dx: number, dz: number, cost: number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
]

export class NavigationGrid {
  readonly minX: number
  readonly maxX: number
  readonly minZ: number
  readonly maxZ: number
  readonly cellSize: number
  readonly width: number
  readonly height: number

  private readonly blocked: Uint8Array
  private readonly gScore: Float64Array
  private readonly cameFrom: Int32Array
  private readonly seenRun: Uint32Array
  private readonly closedRun: Uint32Array
  private readonly open = new MinHeap()
  private searchRunId = 0
  private activeSearchRunId = 0
  private activeGoalIndex = -1
  private activeGoalX = -1
  private activeGoalZ = -1

  constructor(options: NavigationGridOptions) {
    const cellSize = options.cellSize ?? DEFAULT_NAV_CELL_SIZE
    if (!Number.isFinite(cellSize) || cellSize <= 0) {
      throw new Error(`NavigationGrid cellSize must be > 0, got ${cellSize}`)
    }
    if (!(options.maxX > options.minX) || !(options.maxZ > options.minZ)) {
      throw new Error('NavigationGrid bounds must have positive width and height')
    }

    this.minX = options.minX
    this.maxX = options.maxX
    this.minZ = options.minZ
    this.maxZ = options.maxZ
    this.cellSize = cellSize
    this.width = Math.ceil((this.maxX - this.minX) / this.cellSize)
    this.height = Math.ceil((this.maxZ - this.minZ) / this.cellSize)

    const cellCount = this.width * this.height
    this.blocked = new Uint8Array(cellCount)
    this.gScore = new Float64Array(cellCount)
    this.cameFrom = new Int32Array(cellCount)
    this.seenRun = new Uint32Array(cellCount)
    this.closedRun = new Uint32Array(cellCount)
  }

  get cellCount(): number {
    return this.blocked.length
  }

  clear(): void {
    this.blocked.fill(0)
  }

  isInside(cell: NavigationCell): boolean {
    return (
      cell.x >= 0
      && cell.x < this.width
      && cell.z >= 0
      && cell.z < this.height
    )
  }

  worldToCell(position: Pick<THREE.Vector3, 'x' | 'z'>): NavigationCell | null {
    const x = Math.floor((position.x - this.minX) / this.cellSize)
    const z = Math.floor((position.z - this.minZ) / this.cellSize)
    const cell = { x, z }
    return this.isInside(cell) ? cell : null
  }

  cellToWorld(cell: NavigationCell, y = 0): THREE.Vector3 {
    return this.cellToWorldInto(cell, new THREE.Vector3(), y)
  }

  cellToWorldInto(cell: NavigationCell, out: THREE.Vector3, y = 0): THREE.Vector3 {
    if (!this.isInside(cell)) {
      throw new Error(`NavigationGrid cell out of bounds: ${cell.x},${cell.z}`)
    }
    return out.set(
      this.minX + (cell.x + 0.5) * this.cellSize,
      y,
      this.minZ + (cell.z + 0.5) * this.cellSize,
    )
  }

  isBlocked(cell: NavigationCell): boolean {
    return this.isBlockedXZ(cell.x, cell.z)
  }

  isBlockedXZ(x: number, z: number): boolean {
    if (x < 0 || x >= this.width || z < 0 || z >= this.height) return true
    return this.blocked[this._index(x, z)] !== 0
  }

  findNearestWalkableCell(
    position: Pick<THREE.Vector3, 'x' | 'z'>,
    maxRadiusCells = 3,
  ): NavigationCell | null {
    const origin = this.worldToCell(position)
    if (!origin) return null
    if (!this.isBlocked(origin)) return origin

    let best: NavigationCell | null = null
    let bestDistSq = Infinity
    const maxRadius = Math.max(1, Math.floor(maxRadiusCells))

    for (let radius = 1; radius <= maxRadius; radius++) {
      const minX = Math.max(0, origin.x - radius)
      const maxX = Math.min(this.width - 1, origin.x + radius)
      const minZ = Math.max(0, origin.z - radius)
      const maxZ = Math.min(this.height - 1, origin.z + radius)

      for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
          if (
            x !== minX
            && x !== maxX
            && z !== minZ
            && z !== maxZ
          ) continue

          const candidate = { x, z }
          if (this.isBlocked(candidate)) continue

          const centerX = this.minX + (x + 0.5) * this.cellSize
          const centerZ = this.minZ + (z + 0.5) * this.cellSize
          const dx = centerX - position.x
          const dz = centerZ - position.z
          const distSq = dx * dx + dz * dz
          if (distSq < bestDistSq) {
            bestDistSq = distSq
            best = candidate
          }
        }
      }

      if (best) return best
    }

    return null
  }

  setBlocked(cell: NavigationCell, blocked: boolean): void {
    if (!this.isInside(cell)) return
    this.blocked[this._index(cell.x, cell.z)] = blocked ? 1 : 0
  }

  /**
   * Marks every grid cell whose X/Z footprint overlaps the box.
   * Optional padding lets a caller bake actor clearance into the grid later.
   */
  setBlockedBox(box: THREE.Box3, blocked: boolean, padding = 0): void {
    const minX = box.min.x - padding
    const maxX = box.max.x + padding
    const minZ = box.min.z - padding
    const maxZ = box.max.z + padding

    const firstX = Math.max(0, Math.floor((minX - this.minX) / this.cellSize))
    const lastX = Math.min(
      this.width - 1,
      Math.floor((maxX - this.minX - COST_EPSILON) / this.cellSize),
    )
    const firstZ = Math.max(0, Math.floor((minZ - this.minZ) / this.cellSize))
    const lastZ = Math.min(
      this.height - 1,
      Math.floor((maxZ - this.minZ - COST_EPSILON) / this.cellSize),
    )

    if (lastX < firstX || lastZ < firstZ) return

    for (let z = firstZ; z <= lastZ; z++) {
      for (let x = firstX; x <= lastX; x++) {
        this.blocked[this._index(x, z)] = blocked ? 1 : 0
      }
    }
  }

  findPath(
    start: Pick<THREE.Vector3, 'x' | 'z'>,
    goal: Pick<THREE.Vector3, 'x' | 'z'>,
  ): NavigationCell[] | null {
    const startCell = this.worldToCell(start)
    const goalCell = this.worldToCell(goal)
    if (!startCell || !goalCell) return null
    return this.findPathCells(startCell, goalCell)
  }

  findPathCells(start: NavigationCell, goal: NavigationCell): NavigationCell[] | null {
    let result = this.startPathSearchCells(start, goal)
    while (result.status === 'pending') {
      result = this.stepPathSearch(Number.MAX_SAFE_INTEGER)
    }
    return result.status === 'path' ? result.path : null
  }

  startPathSearchCells(
    start: NavigationCell,
    goal: NavigationCell,
  ): NavigationGridSearchResult {
    this.cancelPathSearch()

    if (!this.isInside(start) || !this.isInside(goal)) {
      return { status: 'unreachable', expandedNodes: 0 }
    }

    // The world-space actor may be physically outside an obstacle while its
    // coarse 2m cell overlaps that obstacle. Allow A* to escape the start cell;
    // the goal must still be genuinely walkable.
    if (this.isBlocked(goal)) {
      return { status: 'unreachable', expandedNodes: 0 }
    }

    const startIndex = this._index(start.x, start.z)
    const goalIndex = this._index(goal.x, goal.z)
    if (startIndex === goalIndex) {
      return {
        status: 'path',
        path: [{ ...start }],
        expandedNodes: 0,
      }
    }

    const runId = this._beginSearchRun()
    this.activeSearchRunId = runId
    this.activeGoalIndex = goalIndex
    this.activeGoalX = goal.x
    this.activeGoalZ = goal.z
    this.seenRun[startIndex] = runId
    this.gScore[startIndex] = 0
    this.cameFrom[startIndex] = -1
    this.open.push(
      startIndex,
      0,
      this._heuristic(start.x, start.z, goal.x, goal.z),
    )

    return { status: 'pending', expandedNodes: 0 }
  }

  stepPathSearch(maxExpandedNodes: number): NavigationGridSearchResult {
    const runId = this.activeSearchRunId
    if (runId === 0 || this.activeGoalIndex < 0) {
      return { status: 'unreachable', expandedNodes: 0 }
    }

    const maxNodes = Math.max(1, Math.floor(maxExpandedNodes))
    let expandedNodes = 0

    while (this.open.size > 0 && expandedNodes < maxNodes) {
      const currentIndex = this.open.popIndex()
      const currentG = this.open.lastPoppedG
      expandedNodes++

      if (this.closedRun[currentIndex] === runId) continue
      if (
        this.seenRun[currentIndex] !== runId
        || currentG > this.gScore[currentIndex] + COST_EPSILON
      ) continue

      if (currentIndex === this.activeGoalIndex) {
        const path = this._reconstructPath(currentIndex)
        this.cancelPathSearch()
        return { status: 'path', path, expandedNodes }
      }

      this.closedRun[currentIndex] = runId
      const currentX = currentIndex % this.width
      const currentZ = Math.floor(currentIndex / this.width)

      for (const [dx, dz, moveCost] of NEIGHBORS) {
        const nextX = currentX + dx
        const nextZ = currentZ + dz
        if (!this._inside(nextX, nextZ)) continue

        const nextIndex = this._index(nextX, nextZ)
        if (this.closedRun[nextIndex] === runId || this.blocked[nextIndex]) continue

        // Do not let a diagonal step squeeze through two touching blocked cells.
        if (
          dx !== 0
          && dz !== 0
          && (
            this.blocked[this._index(currentX + dx, currentZ)]
            || this.blocked[this._index(currentX, currentZ + dz)]
          )
        ) {
          continue
        }

        const tentativeG = currentG + moveCost
        if (
          this.seenRun[nextIndex] === runId
          && tentativeG + COST_EPSILON >= this.gScore[nextIndex]
        ) continue

        this.seenRun[nextIndex] = runId
        this.cameFrom[nextIndex] = currentIndex
        this.gScore[nextIndex] = tentativeG
        this.open.push(
          nextIndex,
          tentativeG,
          tentativeG + this._heuristic(nextX, nextZ, this.activeGoalX, this.activeGoalZ),
        )
      }
    }

    if (this.open.size === 0) {
      this.cancelPathSearch()
      return { status: 'unreachable', expandedNodes }
    }

    return { status: 'pending', expandedNodes }
  }

  cancelPathSearch(): void {
    this.activeSearchRunId = 0
    this.activeGoalIndex = -1
    this.activeGoalX = -1
    this.activeGoalZ = -1
    this.open.clear()
  }

  pathToWorld(cells: readonly NavigationCell[], y = 0): THREE.Vector3[] {
    return cells.map(cell => this.cellToWorld(cell, y))
  }

  private _beginSearchRun(): number {
    // Uint32 stamps avoid O(cellCount) clears for gScore/cameFrom/closed on every
    // A* request. The full stamp arrays are cleared only after ~4.29B searches.
    if (this.searchRunId === 0xffffffff) {
      this.seenRun.fill(0)
      this.closedRun.fill(0)
      this.searchRunId = 1
    } else {
      this.searchRunId++
    }

    this.open.clear()
    return this.searchRunId
  }

  private _reconstructPath(goalIndex: number): NavigationCell[] {
    const reversed: NavigationCell[] = []
    let current = goalIndex

    while (current >= 0) {
      reversed.push(this._cellFromIndex(current))
      current = this.cameFrom[current]
    }

    reversed.reverse()
    return reversed
  }

  private _heuristic(x: number, z: number, goalX: number, goalZ: number): number {
    const dx = Math.abs(goalX - x)
    const dz = Math.abs(goalZ - z)
    const diagonal = Math.min(dx, dz)
    const straight = Math.max(dx, dz) - diagonal
    return diagonal * SQRT2 + straight
  }

  private _inside(x: number, z: number): boolean {
    return x >= 0 && x < this.width && z >= 0 && z < this.height
  }

  private _index(x: number, z: number): number {
    return z * this.width + x
  }

  private _cellFromIndex(index: number): NavigationCell {
    return {
      x: index % this.width,
      z: Math.floor(index / this.width),
    }
  }
}
