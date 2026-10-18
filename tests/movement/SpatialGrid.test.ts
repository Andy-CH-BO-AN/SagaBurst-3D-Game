import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { SpatialGrid, type SpatialEntity } from '../../src/world/SpatialGrid'

interface Entity extends SpatialEntity {
  id: string
  combatPosition: Vector3
}

function entity(id: string, x: number, y: number, z: number): Entity {
  return { id, combatPosition: new Vector3(x, y, z) }
}

function expectCandidates(actual: Entity[], expected: Entity[]): void {
  expect(actual).toHaveLength(expected.length)
  for (let i = 0; i < expected.length; i++) expect(actual[i]).toBe(expected[i])
}

describe('SpatialGrid', () => {
  it('preserves ordered bucket candidates and live 3D distance across local and sparse queries', () => {
    const grid = new SpatialGrid<Entity>(10)
    const right = entity('right', 4, 0, 0)
    const negativeZ = entity('negativeZ', -3, 0, 4)
    const negativeBoth = entity('negativeBoth', -3, 0, -4)
    const sameCell = entity('sameCell', 1, 0, 1)
    const tooHigh = entity('tooHigh', 0, 51, 0)
    const movedAway = entity('movedAway', -1, 0, -1)
    const movedFromOutside = entity('movedFromOutside', 900, 0, 0)
    const farLeft = entity('farLeft', -1000, 0, -1000)
    const farRight = entity('farRight', 1000, 0, 1000)
    for (const candidate of [right, negativeZ, negativeBoth, sameCell, tooHigh,
      movedAway, movedFromOutside, farLeft, farRight]) grid.insert(candidate)

    movedAway.combatPosition.set(100, 0, 0)
    movedFromOutside.combatPosition.set(0, 0, 0)
    const center = new Vector3()
    const out = [farLeft]
    const expected = [negativeBoth, negativeZ, right, sameCell]
    expect(grid.getNearbyInto(center, 5, out)).toBe(out)
    expectCandidates(out, expected)
    expect(grid.getNearbyInto(center, 50, out)).toBe(out)
    expectCandidates(out, expected)
  })

  it('refreshes ordered buckets after inserts and drops the previous generation on clear', () => {
    const grid = new SpatialGrid<Entity>(10)
    const center = new Vector3()
    const right = entity('right', 90, 0, 0)
    const left = entity('left', -90, 0, 0)
    grid.insert(right)
    grid.insert(left)
    expectCandidates(grid.getNearby(center, 100), [left, right])

    // Reusing a bucket must expose appends without rebuilding or copying its members.
    grid.insert(left)
    expectCandidates(grid.getNearby(center, 100), [left, left, right])
    const middle = entity('middle', 0, 0, 0)
    grid.insert(middle)
    expectCandidates(grid.getNearby(center, 100), [left, left, middle, right])

    const out = [middle]
    grid.clear()
    expect(grid.getNearbyInto(center, 100, out)).toBe(out)
    expect(out).toEqual([])
    const nextRight = entity('nextRight', 80, 0, 0)
    const nextLeft = entity('nextLeft', -80, 0, 0)
    grid.insert(nextRight)
    grid.insert(nextLeft)
    expectCandidates(grid.getNearbyInto(center, 100, out), [nextLeft, nextRight])
  })
})
