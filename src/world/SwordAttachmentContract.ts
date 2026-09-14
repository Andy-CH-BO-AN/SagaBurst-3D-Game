import * as THREE from 'three'

export interface SwordGripFrame {
  gripCenterLocal: [number, number, number]
  gripAxisLocal: [number, number, number]
  palmNormalLocal: [number, number, number]
  fingerDirection: [number, number, number]
  wristCenter: [number, number, number]
  thumbBaseCenter: [number, number, number]
  fingerBase: number
  gripRadius: number
}

export function swordHandMatrix(frame: SwordGripFrame): THREE.Matrix4 {
  const y = new THREE.Vector3(...frame.gripAxisLocal).normalize()
  const z = new THREE.Vector3(...frame.palmNormalLocal).normalize().negate()
  const x = new THREE.Vector3().crossVectors(y, z).normalize()
  z.crossVectors(x, y).normalize()
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(...frame.gripCenterLocal)
}

/** Equipment owns this fixed transform. No animation frame may rewrite it. */
export function applySwordAttachment(socket: THREE.Object3D, pivot: THREE.Object3D, model: THREE.Object3D, frame: SwordGripFrame): void {
  const center = model.userData.gripCenterLocal as number[] | undefined
  if (!center) throw new Error('劍模型缺少 gripCenterLocal')
  const weaponFrame = new THREE.Matrix4().makeTranslation(center[0], center[1], center[2])
  socket.updateMatrix(); model.updateMatrix()
  const matrix = socket.matrix.clone().invert().multiply(swordHandMatrix(frame))
    .multiply(weaponFrame.invert()).multiply(model.matrix.clone().invert())
  matrix.decompose(pivot.position, pivot.quaternion, pivot.scale)
  pivot.userData.swordAttachmentOwned = true
  pivot.updateMatrix()
}

export function weaponGripWorld(model: THREE.Object3D, target: THREE.Vector3): THREE.Vector3 {
  return model.localToWorld(target.fromArray(model.userData.gripCenterLocal ?? [0, 0, 0]))
}
