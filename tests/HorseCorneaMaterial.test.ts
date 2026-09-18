import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { inspectHorseCorneaMaterials, setHorseCorneaTransmission } from '../src/world/HorseCorneaMaterial'

describe('HorseCorneaMaterial', () => {
  it('changes only the named physical cornea material and preserves its authored appearance settings', () => {
    const root = new THREE.Group()
    const cornea = new THREE.MeshPhysicalMaterial({
      transparent: true,
      opacity: 0.06,
      roughness: 0.07,
      metalness: 0,
      transmission: 1,
      ior: 1.376,
      clearcoat: 1,
      clearcoatRoughness: 0.045,
    })
    cornea.name = 'runtime_horse_cornea'
    const eye = new THREE.MeshStandardMaterial({ roughness: 0.43, metalness: 0 })
    eye.name = 'runtime_horse_eyes'
    root.add(new THREE.Mesh(new THREE.SphereGeometry(), cornea))
    root.add(new THREE.Mesh(new THREE.SphereGeometry(), eye))

    expect(setHorseCorneaTransmission(root, false)).toBe(1)
    expect(cornea.transmission).toBe(0)
    expect(eye).toMatchObject({ roughness: 0.43, metalness: 0 })
    expect(inspectHorseCorneaMaterials(root)).toEqual([expect.objectContaining({
      materialType: 'MeshPhysicalMaterial', transmission: 0, opacity: 0.06,
      transparent: true, roughness: 0.07, metalness: 0, ior: 1.376,
      clearcoat: 1, clearcoatRoughness: 0.045,
    })])

    expect(setHorseCorneaTransmission(root, true)).toBe(1)
    expect(cornea.transmission).toBe(1)
  })
})
