import * as THREE from 'three'

// 鴨子型別：只要有 combatPosition 的物件都能放進 Grid
export interface SpatialEntity {
  get combatPosition(): THREE.Vector3
}

export class SpatialGrid<T extends SpatialEntity> {
  private cellSize: number
  private grid: Map<string, T[]> = new Map()

  constructor(cellSize: number = 40) {
    this.cellSize = cellSize
  }

  clear() {
    this.grid.clear()
  }

  insert(entity: T) {
    const pos = entity.combatPosition
    const cellKey = this._getCellKey(pos.x, pos.z)
    if (!this.grid.has(cellKey)) {
      this.grid.set(cellKey, [])
    }
    this.grid.get(cellKey)!.push(entity)
  }

  getNearby(pos: THREE.Vector3, radius: number): T[] {
    const result: T[] = []
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
              result.push(ent)
            }
          }
        }
      }
    }
    return result
  }

  private _getCellKey(x: number, z: number): string {
    const cx = Math.floor(x / this.cellSize)
    const cz = Math.floor(z / this.cellSize)
    return `${cx},${cz}`
  }
}
