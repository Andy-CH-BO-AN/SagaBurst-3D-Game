import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import * as THREE from 'three'
import { buildAnatomicalBowThumbShape } from '../../src/world/AnatomicalBowThumb'
import type { HandGripFrame } from '../../src/world/BowAttachmentContract'
import type { SwordGripFrame } from '../../src/world/SwordAttachmentContract'

it('keeps a thin colliding thumb web within hand-scale displacement', () => {
  // Small geometric regression: 55 vertices / 31 triangles, two identity bones,
  // no authored asset loading or actors. The finger prepass is a boundary input;
  // this case owns thumb contact-solver stability, not finger segmentation.
  const data = JSON.parse(readFileSync(new URL('../fixtures/thumb-web.json', import.meta.url), 'utf8')) as {
    frame: SwordGripFrame
    vertices: Array<[number, number, number, number, number, number, number, number]>
    indices: number[]
  }
  const geometry = new THREE.BufferGeometry()
  const material = new THREE.MeshBasicMaterial()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.vertices.flatMap(row => row.slice(0, 3)), 3))
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(data.vertices.flatMap(() => [0, 1, 1, 1]), 4))
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(data.vertices.flatMap(row => [row[3], 1 - row[3], 0, 0]), 4))
  geometry.setIndex(data.indices)
  const hand = new THREE.Bone(), forearm = new THREE.Bone()
  const mesh = new THREE.SkinnedMesh(geometry, material)
  mesh.add(hand, forearm)
  mesh.bind(new THREE.Skeleton([hand, forearm]))
  mesh.updateMatrixWorld(true)
  const normal = new THREE.Vector3(...data.frame.palmNormalLocal)
  const frame: HandGripFrame = {
    palmContactCenter: new THREE.Vector3(...data.frame.gripCenterLocal).addScaledVector(normal, -data.frame.gripRadius),
    palmNormal: normal, thumbDirection: new THREE.Vector3(...data.frame.gripAxisLocal), thumbDir: 1,
    fingerDirection: new THREE.Vector3(...data.frame.fingerDirection),
    wristCenter: new THREE.Vector3(...data.frame.wristCenter),
    thumbBaseCenter: new THREE.Vector3(...data.frame.thumbBaseCenter), fingerBase: data.frame.fingerBase,
  }
  const fingers = {
    offsets: Float32Array.from(data.vertices.flatMap(row => row.slice(4, 7))),
    digitMask: Uint8Array.from(data.vertices.map(row => row[7])),
  }
  const positionsBefore = Array.from(geometry.attributes.position.array)
  const offsetsBefore = Array.from(fingers.offsets)
  try {
    const result = buildAnatomicalBowThumbShape(mesh, hand, frame, fingers, data.frame.gripRadius)
    geometry.computeBoundingBox()
    // A rotation about a point in this hand cannot move a point beyond twice
    // the hand's diagonal (29.5 cm). The regression produced 53.8 cm, while
    // the full character produced 5.36 m and visible flesh-colored sheets.
    const maximumDisplacement = geometry.boundingBox!.getSize(new THREE.Vector3()).length() * 2
    let movedThumbVertices = 0
    for (let vertex = 0; vertex < data.vertices.length; vertex++) {
      const offset = new THREE.Vector3().fromArray(result.offsets, vertex * 3)
      expect(offset.toArray().every(Number.isFinite), `vertex ${vertex} remains finite`).toBe(true)
      expect(offset.length(), `vertex ${vertex} remains within the hand's reach`).toBeLessThanOrEqual(maximumDisplacement)
      if (result.weights[vertex] > .01 && offset.distanceTo(new THREE.Vector3().fromArray(fingers.offsets, vertex * 3)) > 1e-6) movedThumbVertices++
    }
    expect(movedThumbVertices, 'the thumb solver must still articulate the thumb').toBeGreaterThan(0)
    expect(Array.from(geometry.attributes.position.array)).toEqual(positionsBefore)
    expect(Array.from(fingers.offsets)).toEqual(offsetsBefore)
  } finally {
    mesh.skeleton.dispose()
    geometry.dispose()
    material.dispose()
  }
})
