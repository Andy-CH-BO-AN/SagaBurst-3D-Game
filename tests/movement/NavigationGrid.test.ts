import { describe, expect, it } from 'vitest'
import {
  NavigationGrid
} from '../../src/navigation/NavigationGrid'

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
})
