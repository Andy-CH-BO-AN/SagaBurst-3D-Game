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

/** Haft follows the thumb web; the cutting edge follows the extended fingers.
 * Source mock-weapon normals are not anatomical palm axes. */
export function naturalAxeHandMatrix(frame: SwordGripFrame): THREE.Matrix4 {
  const y = new THREE.Vector3(...frame.gripAxisLocal).normalize()
  const x = new THREE.Vector3(...frame.fingerDirection)
  x.addScaledVector(y, -x.dot(y)).normalize()
  const z = new THREE.Vector3().crossVectors(x, y).normalize()
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(...frame.gripCenterLocal)
}

/** Equipment owns two fixed transforms; mounting selects the forward grip. */
export function applySwordAttachment(socket: THREE.Object3D, pivot: THREE.Object3D, model: THREE.Object3D, frame: SwordGripFrame, mountedRotation?: [number, number, number, number], axeMountedRotation?: [number, number, number, number]): void {
  const center = model.userData.gripCenterLocal as number[] | undefined
  if (!center) throw new Error('劍模型缺少 gripCenterLocal')
  const weaponFrame = new THREE.Matrix4().makeTranslation(center[0], center[1], center[2])
  socket.updateMatrix(); model.updateMatrix()
  const matrix = socket.matrix.clone().invert().multiply(swordHandMatrix(frame))
    .multiply(weaponFrame.invert()).multiply(model.matrix.clone().invert())
  pivot.userData.swordFootAttachment = matrix.clone()
  if (socket.userData.banditFootAxe) {
    pivot.userData.banditFootAxeAttachment = socket.matrix.clone().invert().multiply(naturalAxeHandMatrix(frame))
      .multiply(new THREE.Matrix4().makeTranslation(-center[0], -center[1], -center[2])).multiply(model.matrix.clone().invert())
    pivot.userData.naturalFootAxeCarry = socket.userData.naturalFootAxeCarry
    pivot.userData.vikingFootAxeCarry = socket.userData.vikingFootAxeCarry
  }
  pivot.userData.axeVisual = model.getObjectByName('dane-axe-visual')
  pivot.userData.axeCarryWeight = undefined
  // The source socket is actor-owned and survives LOD selection via the hand
  // proxy. Its animation curve is evaluated by the same character mixer.
  pivot.userData.authoredAxeSocket = socket.userData.authoredAxeSocket
  pivot.userData.authoredAxe1Socket = socket.userData.authoredAxe1Socket
  pivot.userData.authoredAxeActive = false
  pivot.userData.authoredAxeModelInverse = model.matrix.clone().invert()
  pivot.userData.swordMountedAttachment = mountedRotation
    ? socket.matrix.clone().invert().multiply(new THREE.Matrix4().compose(
      new THREE.Vector3(...frame.gripCenterLocal), new THREE.Quaternion(...mountedRotation), new THREE.Vector3(1, 1, 1),
    )).multiply(weaponFrame).multiply(model.matrix.clone().invert())
    : matrix.clone()
  if (pivot.userData.axeVisual) {
    pivot.userData.axeTwoHandedRotation = axeMountedRotation
      ? new THREE.Quaternion().setFromRotationMatrix(socket.matrix.clone().invert().multiply(
        new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion(...axeMountedRotation)))
        .multiply(model.matrix.clone().invert())) : undefined
    pivot.userData.axeTwoHandedCarry = undefined
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
  const attachment = model.parent?.userData
  if (attachment?.authoredAxeActive) return model.localToWorld(target.set(0, attachment.authoredAxeGripY, 0))
  return model.localToWorld(target.fromArray(model.userData.gripCenterLocal ?? [0, 0, 0]))
}

/** Preserve the configured reach, but follow the axe's visible grip rotation.
 * Legacy clips were authored for the unrotated reference and keep that path. */
export function weaponTipWorld(model: THREE.Object3D, local: THREE.Vector3, target: THREE.Vector3, followVisual = false): THREE.Vector3 {
  const visual = followVisual ? model.getObjectByName('dane-axe-visual') : undefined
  if (visual) return visual.localToWorld(target.copy(local).sub(visual.position))
  return model.localToWorld(target.copy(local))
}

/** Select only on context changes; both transforms retain the model grip. */
const axeAttackRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), .45)
const axeCarryRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), .55)
  .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2))
const axeGripOffset = new THREE.Vector3()
const authoredAxeMatrix = new THREE.Matrix4()
const carryShaft = new THREE.Vector3(), carryEdge = new THREE.Vector3(), carryDown = new THREE.Vector3(), carryCross = new THREE.Vector3()
const carryRoll = new THREE.Quaternion(), carryWorld = new THREE.Quaternion()
const carryLocalY = new THREE.Vector3(0, 1, 0)
const footAttackVisual = new THREE.Quaternion(), footCarryVisual = new THREE.Quaternion()
const footNaturalWorld = new THREE.Quaternion()
// Delivered ordinary-roman socket uses +Z along the haft. The formal weapon
// uses +Y. Grip at 0.35m leaves actual wood below the lower supporting hand.
const authoredAxe1ModelFrame = new THREE.Matrix4().makeRotationX(Math.PI / 2)
  .multiply(new THREE.Matrix4().makeTranslation(0, -.15, 0))
const authoredAxeModelFrame = new THREE.Matrix4().makeRotationX(Math.PI / 2)
  .multiply(new THREE.Matrix4().makeTranslation(0, -.35, 0))


/** Keep carry adjustments outside the source contact/support-hand interval. */
export function axeCarryWeight(action: string, elapsed: number): number {
  if (action === 'idle') return 1
  if (action !== 'axeAttack1H' && action !== 'axeAttack2H') return 0
  const smooth = (x: number) => { const t = THREE.MathUtils.clamp(x, 0, 1); return t * t * (3 - 2 * t) }
  return 1 - smooth(elapsed / .08) + smooth((elapsed - .42) / .06)
}

export function setSwordMountedAttachment(pivot: THREE.Object3D, mounted: boolean, carryWeight = mounted ? 1 : 0, twoHandedCarry = false, action = 'idle', footCarryWeight = action === 'idle' ? 1 : 0): void {
  const axeVisual = pivot.userData.axeVisual as THREE.Object3D | undefined
  if (pivot.userData.swordAttachmentOwned && axeVisual && !mounted && action === 'idle' && pivot.userData.vikingFootAxeCarry) {
    // Weapon-only roll about its existing palm station. Do not alter the
    // authored Viking arm/wrist, the hand socket, attacks or mounted poses.
    pivot.userData.swordFootAttachment.decompose(pivot.position, pivot.quaternion, pivot.scale)
    pivot.updateMatrix()
    axeVisual.quaternion.copy(axeAttackRotation)
    axeVisual.updateWorldMatrix(true, false)
    axeVisual.getWorldQuaternion(carryWorld)
    carryShaft.set(0, 1, 0).applyQuaternion(carryWorld)
    carryEdge.set(1, 0, 0).applyQuaternion(carryWorld)
    carryDown.set(0, -1, 0).addScaledVector(carryShaft, carryShaft.y)
    if (carryDown.lengthSq() > 1e-6) {
      carryDown.normalize()
      const angle = Math.atan2(carryShaft.dot(carryCross.crossVectors(carryEdge, carryDown)), carryEdge.dot(carryDown))
      axeVisual.quaternion.multiply(carryRoll.setFromAxisAngle(carryLocalY, angle))
    }
    pivot.userData.authoredAxeActive = false
    pivot.userData.swordMounted = undefined
    return
  }
  if (pivot.userData.swordAttachmentOwned && axeVisual && !mounted && pivot.userData.banditFootAxeAttachment
    && (action === 'axeAttack1H' || action === 'idle' && pivot.userData.naturalFootAxeCarry)) {
    // Blend the weapon about the same palm as the source arms enter/leave
    // the Bandit clip. This avoids an attachment jump at start/completion.
    if (footCarryWeight > 0 && !pivot.userData.naturalFootAxeCarry) {
      pivot.userData.swordFootAttachment.decompose(pivot.position, pivot.quaternion, pivot.scale)
      pivot.updateMatrix()
      axeVisual.quaternion.copy(axeAttackRotation)
      axeVisual.updateWorldMatrix(true, false)
      axeVisual.getWorldQuaternion(footCarryVisual)
      if (pivot.userData.vikingFootAxeCarry) {
        carryShaft.set(0, 1, 0).applyQuaternion(footCarryVisual)
        carryEdge.set(1, 0, 0).applyQuaternion(footCarryVisual)
        carryDown.set(0, -1, 0).addScaledVector(carryShaft, carryShaft.y)
        if (carryDown.lengthSq() > 1e-6) {
          carryDown.normalize()
          const angle = Math.atan2(carryShaft.dot(carryCross.crossVectors(carryEdge, carryDown)), carryEdge.dot(carryDown))
          footCarryVisual.multiply(carryRoll.setFromAxisAngle(carryLocalY, angle))
        }
      }
    }
    pivot.userData.banditFootAxeAttachment.decompose(pivot.position, pivot.quaternion, pivot.scale)
    pivot.updateMatrix()
    axeVisual.quaternion.identity()
    if (footCarryWeight > 0 && !pivot.userData.naturalFootAxeCarry) {
      axeVisual.updateWorldMatrix(true, false)
      axeVisual.getWorldQuaternion(footNaturalWorld).invert()
      footAttackVisual.copy(footNaturalWorld).multiply(footCarryVisual)
      axeVisual.quaternion.slerp(footAttackVisual, footCarryWeight)
    }
    pivot.userData.authoredAxeActive = false
    pivot.userData.swordMounted = undefined
    pivot.updateMatrix()
    return
  }
  const authored = pivot.userData[action === 'axeAttack1H' ? 'authoredAxe1Socket' : 'authoredAxeSocket'] as THREE.Object3D | undefined
  if (pivot.userData.swordAttachmentOwned && axeVisual && authored && (action === 'axeAttack1H' || action === 'axeAttack2H')) {
    authored.updateWorldMatrix(true, false)
    pivot.parent!.updateWorldMatrix(true, false)
    authoredAxeMatrix.copy(pivot.parent!.matrixWorld).invert().multiply(authored.matrixWorld)
      .multiply(action === 'axeAttack1H' ? authoredAxe1ModelFrame : authoredAxeModelFrame).multiply(pivot.userData.authoredAxeModelInverse)
    authoredAxeMatrix.decompose(pivot.position, pivot.quaternion, pivot.scale)
    axeVisual.quaternion.identity()
    pivot.userData.authoredAxeGripY = action === 'axeAttack1H' ? .15 : .35
    pivot.userData.authoredAxeActive = true
    pivot.updateMatrix()
    return
  }
  const restoreAuthored = pivot.userData.authoredAxeActive === true
  pivot.userData.authoredAxeActive = false
  if (!pivot.userData.swordAttachmentOwned || (!restoreAuthored && pivot.userData.swordMounted === mounted
    && (!axeVisual || pivot.userData.axeCarryWeight === carryWeight && pivot.userData.axeTwoHandedCarry === twoHandedCarry))) return
  // Keep the lance's carry wrist untouched. Blend the axe attachment about its
  // fixed palm contact, then roll only the visual cutting edge toward the floor.
  const matrix = pivot.userData[mounted && !axeVisual ? 'swordMountedAttachment' : 'swordFootAttachment'] as THREE.Matrix4 | undefined
  if (!matrix) return
  matrix.decompose(pivot.position, pivot.quaternion, pivot.scale)
  if (axeVisual) {
    if (carryWeight > 0) {
      pivot.quaternion.copy(pivot.userData.axeFootRotation).slerp((twoHandedCarry && pivot.userData.axeTwoHandedRotation) || pivot.userData.axeMountedRotation, carryWeight)
      axeGripOffset.copy(pivot.userData.axePivotGrip).multiply(pivot.scale).applyQuaternion(pivot.quaternion)
      pivot.position.copy(pivot.userData.axeSocketGrip).sub(axeGripOffset)
    }
    axeVisual.quaternion.copy(axeAttackRotation).slerp(axeCarryRotation, carryWeight)
  }
  pivot.userData.axeTwoHandedCarry = twoHandedCarry
  pivot.userData.axeCarryWeight = carryWeight
  pivot.userData.swordMounted = mounted
  pivot.updateMatrix()
}
