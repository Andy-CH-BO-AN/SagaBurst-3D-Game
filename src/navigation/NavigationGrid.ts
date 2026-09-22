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

interface OpenNode {
  index: number
  g: number
  f: number
}

class MinHeap {
  private readonly data: OpenNode[] = []

  get size(): number {
    return this.data.length
  }

  push(node: OpenNode): void {
    this.data.push(node)
    let index = this.data.length - 1

    while (index > 0) {
      const parent = (index - 1) >> 1
      if (this.data[parent].f <= node.f) break
      this.data[index] = this.data[parent]
      index = parent
    }
    this.data[index] = node
  }

  pop(): OpenNode | null {
    if (this.data.length === 0) return null

    const root = this.data[0]
    const last = this.data.pop()!
    if (this.data.length === 0) return root

    let index = 0
    while (true) {
      const left = index * 2 + 1
      if (left >= this.data.length) break
      const right = left + 1
      const smaller = right < this.data.length && this.data[right].f < this.data[left].f
        ? right
        : left
      if (this.data[smaller].f >= last.f) break
      this.data[index] = this.data[smaller]
      index = smaller
    }
    this.data[index] = last
    return root
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
    this.blocked = new Uint8Array(this.width * this.height)
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
    if (!this.isInside(cell)) {
      throw new Error(`NavigationGrid cell out of bounds: ${cell.x},${cell.z}`)
    }
    return new THREE.Vector3(
      this.minX + (cell.x + 0.5) * this.cellSize,
      y,
      this.minZ + (cell.z + 0.5) * this.cellSize,
    )
  }

  isBlocked(cell: NavigationCell): boolean {
    if (!this.isInside(cell)) return true
    return this.blocked[this._index(cell.x, cell.z)] !== 0
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
    if (!this.isInside(start) || !this.isInside(goal)) return null
    if (this.isBlocked(start) || this.isBlocked(goal)) return null

    const startIndex = this._index(start.x, start.z)
    const goalIndex = this._index(goal.x, goal.z)
    if (startIndex === goalIndex) return [{ ...start }]

    const gScore = new Float64Array(this.cellCount)
    gScore.fill(Infinity)
    const cameFrom = new Int32Array(this.cellCount)
    cameFrom.fill(-1)
    const closed = new Uint8Array(this.cellCount)
    const open = new MinHeap()

    gScore[startIndex] = 0
    open.push({
      index: startIndex,
      g: 0,
      f: this._heuristic(start.x, start.z, goal.x, goal.z),
    })

    while (open.size > 0) {
      const current = open.pop()!
      if (closed[current.index]) continue
      if (current.g > gScore[current.index] + COST_EPSILON) continue

      if (current.index === goalIndex) {
        return this._reconstructPath(cameFrom, current.index)
      }

      closed[current.index] = 1
      const currentCell = this._cellFromIndex(current.index)

      for (const [dx, dz, moveCost] of NEIGHBORS) {
        const nextX = currentCell.x + dx
        const nextZ = currentCell.z + dz
        if (!this._inside(nextX, nextZ)) continue

        const nextIndex = this._index(nextX, nextZ)
        if (closed[nextIndex] || this.blocked[nextIndex]) continue

        // Do not let a diagonal step squeeze through two touching blocked cells.
        if (
          dx !== 0
          && dz !== 0
          && (
            this.blocked[this._index(currentCell.x + dx, currentCell.z)]
            || this.blocked[this._index(currentCell.x, currentCell.z + dz)]
          )
        ) {
          continue
        }

        const tentativeG = current.g + moveCost
        if (tentativeG + COST_EPSILON >= gScore[nextIndex]) continue

        cameFrom[nextIndex] = current.index
        gScore[nextIndex] = tentativeG
        open.push({
          index: nextIndex,
          g: tentativeG,
          f: tentativeG + this._heuristic(nextX, nextZ, goal.x, goal.z),
        })
      }
    }

    return null
  }

  pathToWorld(cells: readonly NavigationCell[], y = 0): THREE.Vector3[] {
    return cells.map(cell => this.cellToWorld(cell, y))
  }

  private _reconstructPath(cameFrom: Int32Array, goalIndex: number): NavigationCell[] {
    const reversed: NavigationCell[] = []
    let current = goalIndex

    while (current >= 0) {
      reversed.push(this._cellFromIndex(current))
      current = cameFrom[current]
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
