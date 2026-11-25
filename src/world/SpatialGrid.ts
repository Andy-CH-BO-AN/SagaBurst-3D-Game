import * as THREE from 'three'

// 鴨子型別：只要有 combatPosition 的物件都能放進 Grid
export interface SpatialEntity {
  get combatPosition(): THREE.Vector3
}

interface SpatialBucket<T> {
  x: number
  z: number
  entities: T[]
  orders: number[]
}

const CELL_KEY_OFFSET = 0x2000000 // 2^25
const CELL_KEY_SPAN = 0x4000000   // 2^26

/** Lossless 52-bit safe integer key for signed integer cell coordinates. */
export function packSpatialCellKey(cellX: number, cellZ: number): number {
  return (cellX + CELL_KEY_OFFSET) * CELL_KEY_SPAN + (cellZ + CELL_KEY_OFFSET)
}

export class SpatialGrid<T extends SpatialEntity> {
  private cellSize: number
  private grid: Map<number, SpatialBucket<T>> = new Map()
  private bucketPool: SpatialBucket<T>[] = []
  private occupiedBuckets: SpatialBucket<T>[] = []
  private bucketOrderDirty = false
  private nearestBuckets: SpatialBucket<T>[] = []
  private nearestBucketsInUse = false
  private nextInsertionOrder = 0
  private minCellX = Infinity
  private maxCellX = -Infinity
  private minCellZ = Infinity
  private maxCellZ = -Infinity

  constructor(cellSize: number = 40) {
    this.cellSize = cellSize
  }

  clear() {
    for (const bucket of this.grid.values()) {
      bucket.entities.length = 0
      bucket.orders.length = 0
      this.bucketPool.push(bucket)
    }
    this.grid.clear()
    this.occupiedBuckets.length = 0
    this.nearestBuckets.length = 0
    this.bucketOrderDirty = false
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
    const cellKey = packSpatialCellKey(cellX, cellZ)
    let bucket = this.grid.get(cellKey)
    if (!bucket) {
      bucket = this.bucketPool.pop()
      if (bucket) {
        bucket.x = cellX
        bucket.z = cellZ
      } else {
        bucket = { x: cellX, z: cellZ, entities: [], orders: [] }
      }
      this.grid.set(cellKey, bucket)
      // Non-finite cells cannot be visited by finite direct queries.
      if (Number.isFinite(cellX) && Number.isFinite(cellZ)) {
        this.occupiedBuckets.push(bucket)
        this.bucketOrderDirty = true
      }
    }
    bucket.entities.push(entity)
    bucket.orders.push(this.nextInsertionOrder++)
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
    if (this.grid.size === 0) return out

    let minX = Math.floor((pos.x - radius) / this.cellSize)
    let maxX = Math.floor((pos.x + radius) / this.cellSize)
    let minZ = Math.floor((pos.z - radius) / this.cellSize)
    let maxZ = Math.floor((pos.z + radius) / this.cellSize)
    const rSq = radius * radius
    const finiteRange = Number.isFinite(minX) && Number.isFinite(maxX)
      && Number.isFinite(minZ) && Number.isFinite(maxZ)

    // A query still uses insertion-time buckets, even when an entity has moved.
    if (finiteRange && Number.isFinite(this.minCellX) && Number.isFinite(this.maxCellX)
      && Number.isFinite(this.minCellZ) && Number.isFinite(this.maxCellZ)) {
      minX = Math.max(minX, this.minCellX)
      maxX = Math.min(maxX, this.maxCellX)
      minZ = Math.max(minZ, this.minCellZ)
      maxZ = Math.min(maxZ, this.maxCellZ)
    }
    if (minX > maxX || minZ > maxZ) return out

    const cellCount = (maxX - minX + 1) * (maxZ - minZ + 1)
    if (finiteRange && cellCount > this.occupiedBuckets.length) {
      // Sort only after a new bucket appears. Existing-cell inserts share its array.
      if (this.bucketOrderDirty) {
        this.occupiedBuckets.sort((a, b) => a.x - b.x || a.z - b.z)
        this.bucketOrderDirty = false
      }
      for (const bucket of this.occupiedBuckets) {
        if (bucket.x < minX) continue
        if (bucket.x > maxX) break
        if (bucket.z < minZ || bucket.z > maxZ) continue
        for (let i = 0; i < bucket.entities.length; i++) {
          const ent = bucket.entities[i]
          if (ent.combatPosition.distanceToSquared(pos) <= rSq) out.push(ent)
        }
      }
      return out
    }

    for (let x = minX; x <= maxX; x++) {
      for (let z = minZ; z <= maxZ; z++) {
        const cell = this.grid.get(packSpatialCellKey(x, z))?.entities
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
   * Visits entities within `maxRadius` in expanding cell rings around `pos`.
   * Calls `getStopDistance()` after each completed ring >= 1 and stops once every
   * still-unvisited cell is strictly farther than that threshold.
   */
  visitNearbyRings(
    pos: THREE.Vector3,
    maxRadius: number,
    visitEntity: (entity: T) => void,
    getStopDistance?: () => number,
  ): void {
    if (this.grid.size === 0 || !Number.isFinite(maxRadius) || maxRadius < 0) return

    const originCellX = Math.floor(pos.x / this.cellSize)
    const originCellZ = Math.floor(pos.z / this.cellSize)
    if (!Number.isFinite(originCellX) || !Number.isFinite(originCellZ)) return

    let minX = Math.floor((pos.x - maxRadius) / this.cellSize)
    let maxX = Math.floor((pos.x + maxRadius) / this.cellSize)
    let minZ = Math.floor((pos.z - maxRadius) / this.cellSize)
    let maxZ = Math.floor((pos.z + maxRadius) / this.cellSize)
    if (Number.isFinite(this.minCellX) && Number.isFinite(this.maxCellX)
      && Number.isFinite(this.minCellZ) && Number.isFinite(this.maxCellZ)) {
      minX = Math.max(minX, this.minCellX)
      maxX = Math.min(maxX, this.maxCellX)
      minZ = Math.max(minZ, this.minCellZ)
      maxZ = Math.min(maxZ, this.maxCellZ)
    }
    if (minX > maxX || minZ > maxZ) return

    const maxRing = Math.max(
      Math.abs(originCellX - minX),
      Math.abs(originCellX - maxX),
      Math.abs(originCellZ - minZ),
      Math.abs(originCellZ - maxZ),
    )
    const maxRadiusSq = maxRadius * maxRadius

    const visitCell = (cellX: number, cellZ: number): void => {
      const bucket = this.grid.get(packSpatialCellKey(cellX, cellZ))
      if (!bucket) return
      const entities = bucket.entities
      for (let i = 0; i < entities.length; i++) {
        const ent = entities[i]
        if (ent.combatPosition.distanceToSquared(pos) <= maxRadiusSq) {
          visitEntity(ent)
        }
      }
    }

    for (let ring = 0; ring <= maxRing; ring++) {
      if (ring === 0) {
        if (originCellX >= minX && originCellX <= maxX && originCellZ >= minZ && originCellZ <= maxZ) {
          visitCell(originCellX, originCellZ)
        }
      } else {
        const rxMin = originCellX - ring
        const rxMax = originCellX + ring
        const rzMin = originCellZ - ring
        const rzMax = originCellZ + ring
        const clampedXMin = Math.max(minX, rxMin)
        const clampedXMax = Math.min(maxX, rxMax)

        if (rzMin >= minZ && rzMin <= maxZ) {
          for (let x = clampedXMin; x <= clampedXMax; x++) visitCell(x, rzMin)
        }
        if (rzMax >= minZ && rzMax <= maxZ) {
          for (let x = clampedXMin; x <= clampedXMax; x++) visitCell(x, rzMax)
        }
        const sideZMin = Math.max(minZ, rzMin + 1)
        const sideZMax = Math.min(maxZ, rzMax - 1)
        if (rxMin >= minX && rxMin <= maxX) {
          for (let z = sideZMin; z <= sideZMax; z++) visitCell(rxMin, z)
        }
        if (rxMax >= minX && rxMax <= maxX) {
          for (let z = sideZMin; z <= sideZMax; z++) visitCell(rxMax, z)
        }
      }

      if (getStopDistance && ring >= 1) {
        const stopDist = getStopDistance()
        if (Number.isFinite(stopDist)) {
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
          if (nearestUnvisitedDistance > stopDist) break
        }
      }
    }
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

    const scanCell = (
      cellX: number, cellZ: number,
      bucket: SpatialBucket<T> | undefined = this.grid.get(packSpatialCellKey(cellX, cellZ)),
    ): void => {
      if (!bucket) return

      const entities = bucket.entities
      const orders = bucket.orders
      for (let i = 0; i < entities.length; i++) {
        const entity = entities[i]
        if (predicate && !predicate(entity)) continue

        const distanceSq = entity.combatPosition.distanceToSquared(pos)
        const order = orders[i]
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

    let sparseBuckets: SpatialBucket<T>[] | null = null
    let sparseIndex = 0
    try {
      for (let ring = 0; ring <= maxRing; ring++) {
        if (sparseBuckets) {
          while (sparseIndex < sparseBuckets.length) {
            const bucket = sparseBuckets[sparseIndex]
            if (Math.max(Math.abs(bucket.x - originCellX), Math.abs(bucket.z - originCellZ)) !== ring) break
            scanCell(bucket.x, bucket.z, bucket)
            sparseIndex++
          }
        } else if (ring === 0) {
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

        // Amortize a bucket scan/sort only after direct probing has reached that scale.
        // Local matches keep the original cheap path; nested predicates can use it too.
        if (!sparseBuckets && !this.nearestBucketsInUse && ring >= 1 && ring < maxRing
          && Number.isFinite(maxRing) && (2 * ring + 1) ** 2 >= this.occupiedBuckets.length) {
          sparseBuckets = this.nearestBuckets
          this.nearestBucketsInUse = true
          for (const bucket of this.occupiedBuckets) {
            if (Math.max(Math.abs(bucket.x - originCellX), Math.abs(bucket.z - originCellZ)) > ring) {
              sparseBuckets.push(bucket)
            }
          }
          // Keep nearby's shared X/Z ordering intact. Within a ring retain the original
          // top/bottom rows, then left/right sides, including predicate visitation order.
          sparseBuckets.sort((a, b) => {
            const aRing = Math.max(Math.abs(a.x - originCellX), Math.abs(a.z - originCellZ))
            const bRing = Math.max(Math.abs(b.x - originCellX), Math.abs(b.z - originCellZ))
            if (aRing !== bRing) return aRing - bRing
            const aRow = Math.abs(a.z - originCellZ) === aRing
            const bRow = Math.abs(b.z - originCellZ) === bRing
            if (aRow !== bRow) return aRow ? -1 : 1
            return aRow ? a.x - b.x || a.z - b.z : a.z - b.z || a.x - b.x
          })
        }
        if (sparseBuckets) {
          if (sparseIndex === sparseBuckets.length) break
          const next = sparseBuckets[sparseIndex]
          const nextRing = Math.max(Math.abs(next.x - originCellX), Math.abs(next.z - originCellZ))
          // A live position may have left its insertion bucket. Before visiting a more
          // distant occupied ring, test the last skipped empty ring's original bound.
          // Without a candidate there is no early exit to preserve.
          ring = Math.max(ring, nextRing - (closest === null ? 1 : 2))
        }

      }
    } finally {
      if (sparseBuckets) {
        sparseBuckets.length = 0
        this.nearestBucketsInUse = false
      }
    }

    return closest
  }

}
