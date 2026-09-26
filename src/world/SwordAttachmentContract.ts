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

/** Equipment owns two fixed transforms; mounting selects the forward grip. */
export function applySwordAttachment(socket: THREE.Object3D, pivot: THREE.Object3D, model: THREE.Object3D, frame: SwordGripFrame, mountedRotation?: [number, number, number, number]): void {
  const center = model.userData.gripCenterLocal as number[] | undefined
  if (!center) throw new Error('劍模型缺少 gripCenterLocal')
  const weaponFrame = new THREE.Matrix4().makeTranslation(center[0], center[1], center[2])
  socket.updateMatrix(); model.updateMatrix()
  const matrix = socket.matrix.clone().invert().multiply(swordHandMatrix(frame))
    .multiply(weaponFrame.invert()).multiply(model.matrix.clone().invert())
  pivot.userData.swordFootAttachment = matrix.clone()
  pivot.userData.axeVisual = model.getObjectByName('dane-axe-visual')
  pivot.userData.axeCarryWeight = undefined
  pivot.userData.swordMountedAttachment = mountedRotation
    ? socket.matrix.clone().invert().multiply(new THREE.Matrix4().compose(
      new THREE.Vector3(...frame.gripCenterLocal), new THREE.Quaternion(...mountedRotation), new THREE.Vector3(1, 1, 1),
    )).multiply(weaponFrame).multiply(model.matrix.clone().invert())
    : matrix.clone()
  if (pivot.userData.axeVisual) {
    pivot.userData.axeFootRotation = new THREE.Quaternion()
    pivot.userData.axeMountedRotation = new THREE.Quaternion()
    const position = new THREE.Vector3(), scale = new THREE.Vector3()
    matrix.decompose(position, pivot.userData.axeFootRotation, scale)
    pivot.userData.swordMountedAttachment.decompose(position, pivot.userData.axeMountedRotation, scale)
    pivot.userData.axePivotGrip = new THREE.Vector3().fromArray(center).applyMatrix4(model.matrix)
    pivot.userData.axeSocketGrip = new THREE.Vector3(...frame.gripCenterLocal).applyMatrix4(socket.matrix.clone().invert())
  }
  pivot.userData.swordMounted = false
  matrix.decompose(pivot.position, pivot.quaternion, pivot.scale)
  pivot.userData.swordAttachmentOwned = true
  pivot.updateMatrix()
}

export function weaponGripWorld(model: THREE.Object3D, target: THREE.Vector3): THREE.Vector3 {
  return model.localToWorld(target.fromArray(model.userData.gripCenterLocal ?? [0, 0, 0]))
}

/** Select only on context changes; both transforms retain the model grip. */
const axeAttackRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), .45)
const axeCarryRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), .55)
  .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2))
const axeGripOffset = new THREE.Vector3()

/** Keep carry adjustments outside the source contact/support-hand interval. */
export function axeCarryWeight(action: string, elapsed: number): number {
  if (action === 'idle') return 1
  if (action !== 'axeAttack1H' && action !== 'axeAttack2H') return 0
  const smooth = (x: number) => { const t = THREE.MathUtils.clamp(x, 0, 1); return t * t * (3 - 2 * t) }
  return 1 - smooth(elapsed / .08) + smooth((elapsed - .42) / .06)
}

export function setSwordMountedAttachment(pivot: THREE.Object3D, mounted: boolean, carryWeight = mounted ? 1 : 0): void {
  const axeVisual = pivot.userData.axeVisual as THREE.Object3D | undefined
  if (!pivot.userData.swordAttachmentOwned || (pivot.userData.swordMounted === mounted
    && (!axeVisual || pivot.userData.axeCarryWeight === carryWeight))) return
  // Keep the lance's carry wrist untouched. Blend the axe attachment about its
  // fixed palm contact, then roll only the visual cutting edge toward the floor.
  const matrix = pivot.userData[mounted && !axeVisual ? 'swordMountedAttachment' : 'swordFootAttachment'] as THREE.Matrix4 | undefined
  if (!matrix) return
  matrix.decompose(pivot.position, pivot.quaternion, pivot.scale)
  if (axeVisual) {
    if (carryWeight > 0) {
      pivot.quaternion.copy(pivot.userData.axeFootRotation).slerp(pivot.userData.axeMountedRotation, carryWeight)
      axeGripOffset.copy(pivot.userData.axePivotGrip).multiply(pivot.scale).applyQuaternion(pivot.quaternion)
      pivot.position.copy(pivot.userData.axeSocketGrip).sub(axeGripOffset)
    }
    axeVisual.quaternion.copy(axeAttackRotation).slerp(axeCarryRotation, carryWeight)
  }
  pivot.userData.axeCarryWeight = carryWeight
  pivot.userData.swordMounted = mounted
  pivot.updateMatrix()
}
