import * as THREE from 'three'
import type { EquipmentGripFrame } from './EquipmentAttachmentContract'
import type { HandGripFrame } from './BowAttachmentContract'
import { buildAnatomicalBowFingerShape } from './AnatomicalBowFingers'
import { buildAnatomicalBowThumbShape } from './AnatomicalBowThumb'

/** Static digit deformation only; the geometry samplers never own bone poses. */
export function prepareEquipmentHandShape(scene: THREE.Object3D, frame: EquipmentGripFrame, side: 'l' | 'r', name: 'lanceRight' | 'lanceLeft' | 'shieldLeft'): void {
  const hand = scene.getObjectByName(`hand_${side}`) as THREE.Bone
  const normal = new THREE.Vector3(...frame.palmNormalLocal)
  const anatomy: HandGripFrame = {
    palmContactCenter: new THREE.Vector3(...frame.gripCenterLocal).addScaledVector(normal, -frame.gripRadius),
    palmNormal: normal, thumbDirection: new THREE.Vector3(...frame.gripAxisLocal), thumbDir: 1,
    fingerDirection: new THREE.Vector3(...frame.fingerDirection),
    wristCenter: new THREE.Vector3(...frame.wristCenter),
    thumbBaseCenter: new THREE.Vector3(...frame.thumbBaseCenter), fingerBase: frame.fingerBase,
  }
  scene.traverse(object => {
    if (!(object instanceof THREE.SkinnedMesh)) return
    const fingers = buildAnatomicalBowFingerShape(object, hand, anatomy, frame.gripRadius)
    if (fingers.digits.length !== 4) return
    const shape = buildAnatomicalBowThumbShape(object, hand, anatomy, fingers, frame.gripRadius)
    const geometry = object.geometry, offsets = shape.offsets
    const bent = geometry.clone(), position = geometry.attributes.position.clone()
    for (let i = 0; i < position.count; i++) position.setXYZ(i,
      position.getX(i) + offsets[i * 3], position.getY(i) + offsets[i * 3 + 1], position.getZ(i) + offsets[i * 3 + 2])
    bent.setAttribute('position', position); bent.computeVertexNormals()
    const normals = new Float32Array(offsets.length)
    for (let i = 0; i < position.count; i++) {
      if (offsets[i * 3] === 0 && offsets[i * 3 + 1] === 0 && offsets[i * 3 + 2] === 0) continue
      for (let k = 0; k < 3; k++) normals[i * 3 + k] = bent.attributes.normal.getComponent(i, k) - geometry.attributes.normal.getComponent(i, k)
    }
    bent.dispose()
    const morph = new THREE.Float32BufferAttribute(offsets, 3); morph.name = name
    geometry.morphTargetsRelative = true
    geometry.morphAttributes.normal = [
      ...(geometry.morphAttributes.normal ?? (geometry.morphAttributes.position ?? []).map(() => new THREE.Float32BufferAttribute(new Float32Array(offsets.length), 3))),
      new THREE.Float32BufferAttribute(normals, 3),
    ]
    geometry.morphAttributes.position = [...(geometry.morphAttributes.position ?? []), morph]
    object.updateMorphTargets()
    object.userData[`${name}Diagnostics`] = { digits: fingers.digits.length, thumbClearance: shape.clearance }
  })
}
