import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  DEFAULT_NAV_CELL_SIZE,
  NavigationGrid,
} from './NavigationGrid'

function createGrid(): NavigationGrid {
  return new NavigationGrid({
    minX: 0,
    maxX: 20,
    minZ: 0,
    maxZ: 20,
    cellSize: 2,
  })
}

describe('NavigationGrid', () => {
  it('uses a 2m default cell size and converts world positions to cell centers', () => {
    const grid = new NavigationGrid({
      minX: -10,
      maxX: 10,
      minZ: -10,
      maxZ: 10,
    })

    expect(grid.cellSize).toBe(DEFAULT_NAV_CELL_SIZE)
    expect(grid.width).toBe(10)
    expect(grid.height).toBe(10)

    const cell = grid.worldToCell(new THREE.Vector3(-7.5, 3, 6.5))
    expect(cell).toEqual({ x: 1, z: 8 })
    expect(grid.cellToWorld(cell!, 3)).toEqual(new THREE.Vector3(-7, 3, 7))
  })

  it('rasterizes an obstacle box into blocked cells', () => {
    const grid = createGrid()

    grid.setBlockedBox(
      new THREE.Box3(
        new THREE.Vector3(4, 0, 6),
        new THREE.Vector3(8, 3, 10),
      ),
      true,
    )

    expect(grid.isBlocked({ x: 2, z: 3 })).toBe(true)
    expect(grid.isBlocked({ x: 3, z: 4 })).toBe(true)
    expect(grid.isBlocked({ x: 1, z: 3 })).toBe(false)
    expect(grid.isBlocked({ x: 4, z: 5 })).toBe(false)
  })

  it('uses diagonal movement for the shortest unobstructed route', () => {
    const grid = createGrid()

    const path = grid.findPathCells(
      { x: 1, z: 1 },
      { x: 4, z: 4 },
    )

    expect(path).toEqual([
      { x: 1, z: 1 },
      { x: 2, z: 2 },
      { x: 3, z: 3 },
      { x: 4, z: 4 },
    ])
  })

  it('finds a shortest walkable route around a wall through its gap', () => {
    const grid = createGrid()

    // Vertical wall at x=4 with one gap at z=5.
    for (let z = 0; z < grid.height; z++) {
      if (z === 5) continue
      grid.setBlocked({ x: 4, z }, true)
    }

    const path = grid.findPathCells(
      { x: 1, z: 2 },
      { x: 8, z: 2 },
    )

    expect(path).not.toBeNull()
    expect(path![0]).toEqual({ x: 1, z: 2 })
    expect(path!.at(-1)).toEqual({ x: 8, z: 2 })
    expect(path).toContainEqual({ x: 4, z: 5 })
    expect(path!.every(cell => !grid.isBlocked(cell))).toBe(true)
  })

  it('can escape a blocked coarse start cell when a walkable route exists', () => {
    const grid = createGrid()
    grid.setBlocked({ x: 1, z: 1 }, true)

    const path = grid.findPathCells(
      { x: 1, z: 1 },
      { x: 4, z: 1 },
    )

    expect(path).not.toBeNull()
    expect(path![0]).toEqual({ x: 1, z: 1 })
    expect(path!.at(-1)).toEqual({ x: 4, z: 1 })
  })

  it('returns null when a full barrier makes the target unreachable', () => {
    const grid = createGrid()

    for (let z = 0; z < grid.height; z++) {
      grid.setBlocked({ x: 4, z }, true)
    }

    expect(
      grid.findPathCells(
        { x: 1, z: 5 },
        { x: 8, z: 5 },
      ),
    ).toBeNull()
  })

  it('does not cut diagonally through touching blocked cells', () => {
    const grid = new NavigationGrid({
      minX: 0,
      maxX: 6,
      minZ: 0,
      maxZ: 6,
      cellSize: 2,
    })

    grid.setBlocked({ x: 1, z: 0 }, true)
    grid.setBlocked({ x: 0, z: 1 }, true)

    expect(
      grid.findPathCells(
        { x: 0, z: 0 },
        { x: 1, z: 1 },
      ),
    ).toBeNull()
  })

  it('supports clearing a dynamic obstacle and finding the newly opened route', () => {
    const grid = createGrid()

    for (let z = 0; z < grid.height; z++) {
      grid.setBlocked({ x: 4, z }, true)
    }

    expect(
      grid.findPathCells(
        { x: 1, z: 5 },
        { x: 8, z: 5 },
      ),
    ).toBeNull()

    grid.setBlocked({ x: 4, z: 5 }, false)

    const reopened = grid.findPathCells(
      { x: 1, z: 5 },
      { x: 8, z: 5 },
    )
    expect(reopened).not.toBeNull()
    expect(reopened).toContainEqual({ x: 4, z: 5 })
  })

  it('returns null for world positions outside the navigation bounds', () => {
    const grid = createGrid()

    expect(
      grid.findPath(
        new THREE.Vector3(-1, 0, 5),
        new THREE.Vector3(10, 0, 10),
      ),
    ).toBeNull()
  })
})
