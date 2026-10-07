import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { resolveFormationSlots } from '../../src/battle/FormationPlacement'

describe('Formation local slot resolution', () => {
  it('finds the nearest deterministic free position in formation-local axes', () => {
    const ideal = [new THREE.Vector3(0, 0, 0)]
    const checked: Array<[number, number]> = []
    const resolve = () => resolveFormationSlots(
      ideal, new THREE.Vector3(1, 0, 0), [false], () => 0.5,
      slot => {
        checked.push([slot.x, slot.z])
        return slot.z === 2
      },
      () => 0, 180,
    )

    expect(resolve()?.[0]).toEqual(new THREE.Vector3(0, 0, 2))
    expect(checked).toEqual([[0, 0], [0, 2]])
    expect(resolve()?.[0]).toEqual(new THREE.Vector3(0, 0, 2))
  })

  it('rejects only after checking the full local radius for a blocked slot', () => {
    const slot = new THREE.Vector3()
    const checked: number[] = []
    const placement = resolveFormationSlots(
      [slot], new THREE.Vector3(0, 0, 1), [false], () => 0.5,
      candidate => { checked.push(candidate.distanceToSquared(slot)); return false },
      () => 0, 180,
    )

    expect(placement).toBeNull()
    expect(checked[0]).toBe(0)
    expect(checked.at(-1)).toBe(400)
    expect(checked.every(distance => distance <= 400)).toBe(true)
  })
})
