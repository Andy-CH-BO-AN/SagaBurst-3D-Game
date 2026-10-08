import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { assignUnitsToSlots, FORMATION_ALL_MAX_COLUMNS, FORMATION_MAX_COLUMNS, formationRowAxis, getFormationBoundaryShift, generateFormationSlots, generateLineFormationSlots } from '../../src/battle/FormationMath'

describe('Formation geometry and deterministic assignment', () => {
  it('generates a centered single row and rotates its row axis with facing', () => {
    const center = new THREE.Vector3(10, 0, 20)
    const slots = generateLineFormationSlots(center, new THREE.Vector3(0, 0, 1), 5, 2)
    expect(slots.map(slot => [slot.x, slot.z])).toEqual([
      [6, 20], [8, 20], [10, 20], [12, 20], [14, 20],
    ])
    expect(formationRowAxis(new THREE.Vector3(0, 0, 1)).x).toBe(1)
    expect(formationRowAxis(new THREE.Vector3(0, 0, 1)).y).toBe(0)
    expect(formationRowAxis(new THREE.Vector3(0, 0, 1)).z).toBeCloseTo(0)
    expect(generateLineFormationSlots(center, new THREE.Vector3(1, 0, 0), 1, 2)[0]).toEqual(center)
  })

  it('assigns shuffled units left-to-right by projection with a stable tie-break', () => {
    const center = new THREE.Vector3()
    const slots = generateLineFormationSlots(center, new THREE.Vector3(0, 0, 1), 3, 2)
    const units = [
      { id: 'right', position: new THREE.Vector3(4, 0, 0) },
      { id: 'left', position: new THREE.Vector3(-4, 0, 0) },
      { id: 'middle', position: new THREE.Vector3(0, 0, 0) },
    ]
    const assignments = assignUnitsToSlots(units, slots, formationRowAxis(new THREE.Vector3(0, 0, 1)), center)
    expect(assignments.map(entry => entry.unit.id)).toEqual(['left', 'middle', 'right'])
    expect(assignments.map(entry => entry.slot.x)).toEqual([-2, 0, 2])
  })

  it('uses centered rows of at most ten and preserves spacing at the boundary', () => {
    const center = new THREE.Vector3(0, 0, 0)
    expect(generateFormationSlots(center, new THREE.Vector3(0, 0, 1), 10)).toHaveLength(10)
    const eleven = generateFormationSlots(center, new THREE.Vector3(0, 0, 1), 11)
    expect(eleven.slice(0, 10).every(slot => slot.z > 0)).toBe(true)
    expect(eleven[10].x).toBe(0)
    expect(eleven[10].z).toBeLessThan(0)
    expect(generateFormationSlots(center, new THREE.Vector3(0, 0, 1), 25)).toHaveLength(25)
    expect(generateFormationSlots(center, new THREE.Vector3(0, 0, 1), 200)).toHaveLength(200)
    expect(FORMATION_MAX_COLUMNS).toBe(10)

    const boundarySlots = generateFormationSlots(new THREE.Vector3(179, 0, 0), new THREE.Vector3(0, 0, 1), 5)
    const shift = getFormationBoundaryShift(boundarySlots, 180)
    const shifted = boundarySlots.map(slot => slot.clone().add(shift))
    expect(Math.max(...shifted.map(slot => slot.x))).toBe(180)
    expect(new Set(shifted.map(slot => slot.x)).size).toBe(5)
    expect(shifted[1].distanceTo(shifted[0])).toBeCloseTo(2)
  })

  it('uses fifty columns only for ALL formations and centers each final row', () => {
    const center = new THREE.Vector3()
    const forward = new THREE.Vector3(0, 0, 1)
    const rowCounts = (slots: readonly THREE.Vector3[]) => [...slots.reduce((rows, slot) => {
      const row = Math.round(slot.z * 100) / 100
      rows.set(row, (rows.get(row) ?? 0) + 1)
      return rows
    }, new Map<number, number>()).values()]

    expect(rowCounts(generateFormationSlots(center, forward, 25))).toEqual([10, 10, 5])
    expect(rowCounts(generateFormationSlots(center, forward, 51, FORMATION_ALL_MAX_COLUMNS))).toEqual([50, 1])
    expect(rowCounts(generateFormationSlots(center, forward, 120, FORMATION_ALL_MAX_COLUMNS))).toEqual([50, 50, 20])
    expect(rowCounts(generateFormationSlots(center, forward, 200, FORMATION_ALL_MAX_COLUMNS))).toEqual([50, 50, 50, 50])

    const all51 = generateFormationSlots(center, forward, 51, FORMATION_ALL_MAX_COLUMNS)
    expect(all51[50].x).toBe(0)
    const nearBoundary = generateFormationSlots(new THREE.Vector3(179, 0, 0), forward, 120, FORMATION_ALL_MAX_COLUMNS)
    const shift = getFormationBoundaryShift(nearBoundary, 180)
    const shifted = nearBoundary.map(slot => slot.clone().add(shift))
    expect(Math.max(...shifted.map(slot => slot.x))).toBe(180)
    expect(new Set(shifted.map(slot => `${slot.x},${slot.z}`)).size).toBe(120)
    expect(shifted[1].distanceTo(shifted[0])).toBeCloseTo(2)
  })

  it('assigns shuffled multi-row units deterministically by rank then row side', () => {
    const center = new THREE.Vector3()
    const forward = new THREE.Vector3(0, 0, 1)
    const slots = generateFormationSlots(center, forward, 11)
    const rowAxis = formationRowAxis(forward)
    const units = Array.from({ length: 11 }, (_, index) => ({
      id: `unit-${index}`,
      position: new THREE.Vector3(index - 5, 0, index % 2 === 0 ? 4 : -4),
    })).reverse()
    const first = assignUnitsToSlots(units, slots, rowAxis, center, forward)
    const second = assignUnitsToSlots([...units].reverse(), slots, rowAxis, center, forward)
    expect(first.map(entry => entry.unit.id)).toEqual(second.map(entry => entry.unit.id))
    expect(first.slice(0, 10)).toHaveLength(10)
    expect(first[10].slot.x).toBe(0)
  })
})
