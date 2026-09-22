import * as THREE from 'three'

// 鴨子型別：只要有 combatPosition 的物件都能放進 Grid
export interface SpatialEntity {
  get combatPosition(): THREE.Vector3
}

export class SpatialGrid<T extends SpatialEntity> {
  private cellSize: number
  private grid: Map<string, T[]> = new Map()
  private insertionOrder = new WeakMap<T, number>()
  private nextInsertionOrder = 0
  private minCellX = Infinity
  private maxCellX = -Infinity
  private minCellZ = Infinity
  private maxCellZ = -Infinity

  constructor(cellSize: number = 40) {
    this.cellSize = cellSize
  }

  clear() {
    this.grid.clear()
    this.insertionOrder = new WeakMap<T, number>()
    this.nextInsertionOrder = 0
    this.minCellX = Infinity
    this.maxCellX = -Infinity
    this.minCellZ = Infinity
    this.maxCellZ = -Infinity
  }

  insert(entity: T) {
    const pos = entity.combatPosition
    const cellX = Math.floor(pos.x / this.cellSize)
    const cellZ = Math.floor(pos.z / this.cellSize)
    const cellKey = `${cellX},${cellZ}`
    if (!this.grid.has(cellKey)) {
      this.grid.set(cellKey, [])
    }
    this.grid.get(cellKey)!.push(entity)
    this.insertionOrder.set(entity, this.nextInsertionOrder++)
    this.minCellX = Math.min(this.minCellX, cellX)
    this.maxCellX = Math.max(this.maxCellX, cellX)
    this.minCellZ = Math.min(this.minCellZ, cellZ)
    this.maxCellZ = Math.max(this.maxCellZ, cellZ)
  }

  getNearby(pos: THREE.Vector3, radius: number): T[] {
    return this.getNearbyInto(pos, radius, [])
  }

  getNearbyInto(pos: THREE.Vector3, radius: number, out: T[]): T[] {
    out.length = 0
    const minX = Math.floor((pos.x - radius) / this.cellSize)
    const maxX = Math.floor((pos.x + radius) / this.cellSize)
    const minZ = Math.floor((pos.z - radius) / this.cellSize)
    const maxZ = Math.floor((pos.z + radius) / this.cellSize)
    const rSq = radius * radius

    for (let x = minX; x <= maxX; x++) {
      for (let z = minZ; z <= maxZ; z++) {
        const key = `${x},${z}`
        const cell = this.grid.get(key)
        if (cell) {
          for (let i = 0; i < cell.length; i++) {
            const ent = cell[i]
            if (ent.combatPosition.distanceToSquared(pos) <= rSq) {
              out.push(ent)
            }
          }
        }
      }
    }
    return out
  }

  /**
   * Finds the nearest matching entity by expanding cell rings from the query position.
   * Once the closest candidate is nearer than every still-unvisited cell, the search
   * terminates without scanning the rest of the grid.
   *
   * Equal-distance ties preserve insertion order so callers that migrate from a
   * linear nearest-neighbour scan keep deterministic target selection.
   */
  findNearest(pos: THREE.Vector3, predicate?: (entity: T) => boolean): T | null {
    if (this.grid.size === 0) return null

    const originCellX = Math.floor(pos.x / this.cellSize)
    const originCellZ = Math.floor(pos.z / this.cellSize)
    const maxRing = Math.max(
      Math.abs(originCellX - this.minCellX),
      Math.abs(originCellX - this.maxCellX),
      Math.abs(originCellZ - this.minCellZ),
      Math.abs(originCellZ - this.maxCellZ),
    )

    let closest: T | null = null
    let closestDistSq = Infinity
    let closestOrder = Infinity

    const scanCell = (cellX: number, cellZ: number): void => {
      const cell = this.grid.get(`${cellX},${cellZ}`)
      if (!cell) return

      for (let i = 0; i < cell.length; i++) {
        const entity = cell[i]
        if (predicate && !predicate(entity)) continue

        const distanceSq = entity.combatPosition.distanceToSquared(pos)
        const order = this.insertionOrder.get(entity) ?? Infinity
        if (
          distanceSq < closestDistSq
          || (distanceSq === closestDistSq && order < closestOrder)
        ) {
          closest = entity
          closestDistSq = distanceSq
          closestOrder = order
        }
      }
    }

    for (let ring = 0; ring <= maxRing; ring++) {
      if (ring === 0) {
        scanCell(originCellX, originCellZ)
      } else {
        const minX = originCellX - ring
        const maxX = originCellX + ring
        const minZ = originCellZ - ring
        const maxZ = originCellZ + ring

        for (let x = minX; x <= maxX; x++) {
          scanCell(x, minZ)
          scanCell(x, maxZ)
        }
        for (let z = minZ + 1; z < maxZ; z++) {
          scanCell(minX, z)
          scanCell(maxX, z)
        }
      }

      if (closest !== null && ring >= 1) {
        const leftBoundary = (originCellX - ring) * this.cellSize
        const rightBoundary = (originCellX + ring + 1) * this.cellSize
        const bottomBoundary = (originCellZ - ring) * this.cellSize
        const topBoundary = (originCellZ + ring + 1) * this.cellSize
        const nearestUnvisitedDistance = Math.min(
          pos.x - leftBoundary,
          rightBoundary - pos.x,
          pos.z - bottomBoundary,
          topBoundary - pos.z,
        )

        // Strict > keeps equal-distance candidates eligible for insertion-order tie-breaking.
        // Always scan at least one neighboring ring so a grid rebuilt at frame start remains
        // robust when a fast entity crossed a cell boundary earlier in the same frame.
        if (nearestUnvisitedDistance * nearestUnvisitedDistance > closestDistSq) break
      }
    }

    return closest
  }

  private _getCellKey(x: number, z: number): string {
    const cx = Math.floor(x / this.cellSize)
    const cz = Math.floor(z / this.cellSize)
    return `${cx},${cz}`
  }
}
