import type {
  EntityCollisionBody,
  ObstacleData,
} from './Terrain'
import { resolveEntityCollision } from './Terrain'

export const ENTITY_COLLISION_GRID_CELL_SIZE = 4

export interface EntityCollisionBroadPhaseStats {
  pairChecks: number
}

/**
 * Dynamic spatial-hash broad phase for entity/entity collision.
 *
 * The grid is updated after every resolved pair because resolveEntityCollision()
 * can move either body. Candidate pairs are still processed in the same i/j
 * ordering as the old O(n²) loop, preserving collision semantics while skipping
 * bodies that cannot possibly overlap in X/Z.
 */
export class EntityCollisionBroadPhase {
  private readonly cells = new Map<string, number[]>()
  private readonly cellPool: number[][] = []
  private readonly activeCells: number[][] = []
  private readonly bodyCellKeys: string[] = []
  private maxRadius = 0

  resolve(
    bodies: readonly EntityCollisionBody[],
    obstacles: ObstacleData[],
  ): EntityCollisionBroadPhaseStats {
    this._rebuild(bodies)

    let pairChecks = 0

    for (let i = 0; i < bodies.length; i++) {
      let nextCandidateIndex = i + 1

      while (nextCandidateIndex < bodies.length) {
        const body = bodies[i]
        const candidateIndex = this._findNextCandidate(
          body,
          nextCandidateIndex,
          bodies,
        )
        if (candidateIndex < 0) break

        resolveEntityCollision(body, bodies[candidateIndex], obstacles)
        pairChecks++

        // Collision resolution can push either entity across a spatial cell.
        // Keep the broad phase authoritative before continuing the original
        // ascending-j pair order.
        this._updateBodyCell(i, body)
        this._updateBodyCell(candidateIndex, bodies[candidateIndex])
        nextCandidateIndex = candidateIndex + 1
      }
    }

    return { pairChecks }
  }

  private _rebuild(bodies: readonly EntityCollisionBody[]): void {
    for (const cell of this.activeCells) {
      cell.length = 0
      this.cellPool.push(cell)
    }
    this.activeCells.length = 0
    this.cells.clear()
    this.bodyCellKeys.length = bodies.length
    this.maxRadius = 0

    for (let index = 0; index < bodies.length; index++) {
      const body = bodies[index]
      this.maxRadius = Math.max(this.maxRadius, body.radius)
      const key = this._cellKey(body.position.x, body.position.z)
      this.bodyCellKeys[index] = key
      this._cellForInsert(key).push(index)
    }
  }

  private _findNextCandidate(
    body: EntityCollisionBody,
    minimumIndex: number,
    bodies: readonly EntityCollisionBody[],
  ): number {
    const queryRadius = body.radius + this.maxRadius
    const minCellX = Math.floor(
      (body.position.x - queryRadius) / ENTITY_COLLISION_GRID_CELL_SIZE,
    )
    const maxCellX = Math.floor(
      (body.position.x + queryRadius) / ENTITY_COLLISION_GRID_CELL_SIZE,
    )
    const minCellZ = Math.floor(
      (body.position.z - queryRadius) / ENTITY_COLLISION_GRID_CELL_SIZE,
    )
    const maxCellZ = Math.floor(
      (body.position.z + queryRadius) / ENTITY_COLLISION_GRID_CELL_SIZE,
    )

    let nextIndex = -1

    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
      for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
        const cell = this.cells.get(`${cellX},${cellZ}`)
        if (!cell) continue

        for (let i = 0; i < cell.length; i++) {
          const candidateIndex = cell[i]
          if (candidateIndex < minimumIndex) continue

          const candidate = bodies[candidateIndex]
          const dx = body.position.x - candidate.position.x
          const dz = body.position.z - candidate.position.z
          const minDistance = body.radius + candidate.radius
          if (dx * dx + dz * dz >= minDistance * minDistance) continue

          if (nextIndex < 0 || candidateIndex < nextIndex) {
            nextIndex = candidateIndex
          }
        }
      }
    }

    return nextIndex
  }

  private _updateBodyCell(
    index: number,
    body: EntityCollisionBody,
  ): void {
    const previousKey = this.bodyCellKeys[index]
    const nextKey = this._cellKey(body.position.x, body.position.z)
    if (previousKey === nextKey) return

    const previousCell = this.cells.get(previousKey)
    if (previousCell) {
      const slot = previousCell.indexOf(index)
      if (slot >= 0) previousCell.splice(slot, 1)
    }

    this._cellForInsert(nextKey).push(index)
    this.bodyCellKeys[index] = nextKey
  }

  private _cellForInsert(key: string): number[] {
    const existing = this.cells.get(key)
    if (existing) return existing

    const cell = this.cellPool.pop() ?? []
    this.cells.set(key, cell)
    this.activeCells.push(cell)
    return cell
  }

  private _cellKey(x: number, z: number): string {
    const cellX = Math.floor(x / ENTITY_COLLISION_GRID_CELL_SIZE)
    const cellZ = Math.floor(z / ENTITY_COLLISION_GRID_CELL_SIZE)
    return `${cellX},${cellZ}`
  }
}
