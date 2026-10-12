import { expect, it } from 'vitest'
import * as THREE from 'three'
import { buildAnatomicalBowFingerShape } from '../../src/world/AnatomicalBowFingers'

it('keeps a cupped thumb beside the index knuckle out of the four finger regions', () => {
  // Five small mesh branches, 60 vertices; no character assets or actors. The
  // thumb root is spatially beside the index, but connected to its own tip.
  const positions: number[] = [], indices: number[] = []
  function branch(centers: Array<[number, number]>) {
    const first = positions.length / 3
    for (const [across, forward] of centers) for (let side = 0; side < 4; side++) {
      const angle = side * Math.PI / 2
      positions.push(across + .002 * Math.cos(angle), forward, .002 * Math.sin(angle))
    }
    for (let ring = 0; ring < 2; ring++) for (let side = 0; side < 4; side++) {
      const a = first + ring * 4 + side, b = first + ring * 4 + (side + 1) % 4
      indices.push(a, b, a + 4, b, b + 4, a + 4)
    }
    return first
  }
  for (const across of [-.06, -.04, -.02, 0]) branch([[across, .096], [across, .12], [across, .15]])
  const thumbRoot = branch([[.003, .099], [.020, .104], [.028, .11]])
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(Array(60 * 4).fill(0), 4))
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(Array.from({ length: 60 }, () => [1, 0, 0, 0]).flat(), 4))
  geometry.setIndex(indices)
  const material = new THREE.MeshBasicMaterial(), hand = new THREE.Bone()
  const mesh = new THREE.SkinnedMesh(geometry, material)
  mesh.add(hand); mesh.bind(new THREE.Skeleton([hand]))
  try {
    const result = buildAnatomicalBowFingerShape(mesh, hand, {
      palmContactCenter: new THREE.Vector3(-.027, .07, 0),
      palmNormal: new THREE.Vector3(0, 0, 1), thumbDirection: new THREE.Vector3(1, 0, 0), thumbDir: 1,
      fingerDirection: new THREE.Vector3(0, 1, 0), wristCenter: new THREE.Vector3(),
      thumbBaseCenter: new THREE.Vector3(.015, .04, 0), fingerBase: .1,
    })
    expect(result.digits).toHaveLength(4)
    for (let vertex = thumbRoot; vertex < 60; vertex++) {
      expect(result.digitMask[vertex], `thumb vertex ${vertex} must retain thumb ownership`).toBe(0)
      expect(Array.from(result.offsets.slice(vertex * 3, vertex * 3 + 3))).toEqual([0, 0, 0])
    }
    for (const digit of [1, 2, 3, 4]) expect(result.digitMask).toContain(digit)
    expect(Array.from(result.offsets).some(value => Math.abs(value) > .001)).toBe(true)
  } finally {
    mesh.skeleton.dispose(); geometry.dispose(); material.dispose()
  }
})
