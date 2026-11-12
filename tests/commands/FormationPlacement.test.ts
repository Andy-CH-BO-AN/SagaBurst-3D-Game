import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { resolveFormationSlots } from '../../src/battle/FormationPlacement'

describe('Formation local slot resolution', () => {
  it('finds a free position when accessible and rejects when all candidates are blocked', () => {
    const ideal = [new THREE.Vector3(0, 0, 0)]
    const resolveFree = resolveFormationSlots(
      ideal, new THREE.Vector3(1, 0, 0), [false], () => 0.5,
      slot => slot.z === 2,
      () => 0, 180,
    )
    expect(resolveFree?.[0]).toEqual(new THREE.Vector3(0, 0, 2))

    const slot = new THREE.Vector3()
    const resolveBlocked = resolveFormationSlots(
      [slot], new THREE.Vector3(0, 0, 1), [false], () => 0.5,
      () => false,
      () => 0, 180,
    )
    expect(resolveBlocked).toBeNull()
  })
})
