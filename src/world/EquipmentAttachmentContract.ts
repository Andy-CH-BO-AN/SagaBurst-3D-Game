import * as THREE from 'three'
import type { SwordGripFrame } from './SwordAttachmentContract'
import { swordHandMatrix } from './SwordAttachmentContract'

export type EquipmentGripFrame = SwordGripFrame & { modelRotationLocal?: [number, number, number, number] }
export interface EquipmentGripFrames {
  lanceRight: EquipmentGripFrame
  lanceLeft: EquipmentGripFrame
  shieldLeft: EquipmentGripFrame
}
export const LANCE_GRIP = new THREE.Vector3(0, 0.15, 0)
export const LANCE_SUPPORT = new THREE.Vector3(0, 0.33, 0)
export const LANCE_TIP = new THREE.Vector3(0, 2.6, 0)
export const LANCE_RADIUS = 0.022
export const SHIELD_RADIUS = 0.024

export function equipmentWeaponFrame(kind: 'lance' | 'shield', model?: THREE.Object3D): THREE.Matrix4 {
  // Legacy fixtures only. Production Lance uses the Sword Idle calibration.
  if (kind === 'lance') return new THREE.Matrix4().setPosition(LANCE_GRIP)
  // Vertical grasp: thumb web up, left palm inward toward the torso (-X).
  // The board remains upright and faces character-forward (+Z).
  return new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0))
    .setPosition(new THREE.Vector3().fromArray(model?.userData.gripCenterLocal ?? [0, 0, 0.085]))
}

/** 裝備時設定一次；骨架動畫不得修改此矩陣。 */
export function applyEquipmentAttachment(socket: THREE.Object3D, pivot: THREE.Object3D, model: THREE.Object3D, frame: EquipmentGripFrame, kind: 'lance' | 'shield'): void {
  socket.updateMatrix()
  const modelInHand = kind === 'lance' && frame.modelRotationLocal
    ? new THREE.Matrix4().compose(new THREE.Vector3(...frame.gripCenterLocal), new THREE.Quaternion().fromArray(frame.modelRotationLocal), new THREE.Vector3(1, 1, 1))
      .multiply(new THREE.Matrix4().makeTranslation(-LANCE_GRIP.x, -LANCE_GRIP.y, -LANCE_GRIP.z))
    : swordHandMatrix(frame).multiply(equipmentWeaponFrame(kind, model).invert())
  const matrix = socket.matrix.clone().invert().multiply(modelInHand)
  if (pivot !== model) { model.updateMatrix(); matrix.multiply(model.matrix.clone().invert()) }
  matrix.decompose(pivot.position, pivot.quaternion, pivot.scale)
  pivot.userData.equipmentAttachmentOwned = kind
  pivot.updateMatrix()
}

/** Load-time calibration only. Sample the existing Sword Idle skeleton, derive
 * the model rotation in its right hand, then restore every source transform. */
export function calibrateLanceIdleAttachment(root: THREE.Object3D, idle: THREE.AnimationClip, frame: EquipmentGripFrame): void {
  const saved: Array<{ node: THREE.Object3D, p: THREE.Vector3, q: THREE.Quaternion, s: THREE.Vector3 }> = []
  root.traverse(node => saved.push({ node, p: node.position.clone(), q: node.quaternion.clone(), s: node.scale.clone() }))
  const mixer = new THREE.AnimationMixer(root)
  mixer.clipAction(idle).play()
  mixer.setTime(0.25)
  root.updateWorldMatrix(true, true)
  const hand = root.getObjectByName('hand_r')!
  const handInRoot = root.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(hand.getWorldQuaternion(new THREE.Quaternion()))
  // A small outward model yaw clears the horse's mane without moving the hand.
  const forward = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -0.14)
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2))
  frame.modelRotationLocal = handInRoot.invert().multiply(forward).toArray()
  mixer.stopAllAction(); mixer.uncacheRoot(root)
  for (const { node, p, q, s } of saved) { node.position.copy(p); node.quaternion.copy(q); node.scale.copy(s) }
  root.updateWorldMatrix(true, true)
}

export function resizeGrip(frame: EquipmentGripFrame, radius: number): EquipmentGripFrame {
  return { ...frame, gripRadius: radius, gripCenterLocal: new THREE.Vector3(...frame.gripCenterLocal)
    .addScaledVector(new THREE.Vector3(...frame.palmNormalLocal), radius - frame.gripRadius).toArray() }
}

/** 將解剖握點轉換到另一個 LOD 的 bind basis，不複製局部旋轉。 */
export function transferGrip(frame: EquipmentGripFrame, transform: THREE.Matrix4): EquipmentGripFrame {
  const point = (p: number[]) => new THREE.Vector3().fromArray(p).applyMatrix4(transform).toArray()
  const dir = (p: number[]) => new THREE.Vector3().fromArray(p).transformDirection(transform).toArray()
  const finger = new THREE.Vector3(...frame.fingerDirection)
  return { ...frame, gripCenterLocal: point(frame.gripCenterLocal), gripAxisLocal: dir(frame.gripAxisLocal),
    palmNormalLocal: dir(frame.palmNormalLocal), fingerDirection: dir(frame.fingerDirection),
    wristCenter: point(frame.wristCenter), thumbBaseCenter: point(frame.thumbBaseCenter),
    fingerBase: finger.multiplyScalar(frame.fingerBase).applyMatrix4(transform).dot(new THREE.Vector3(...dir(frame.fingerDirection))) }
}

export function calibrateEquipmentFrames(right: EquipmentGripFrame, left: import('./BowAttachmentContract').HandGripFrame, sourceHand: THREE.Object3D, targetHand: THREE.Object3D): EquipmentGripFrames {
  sourceHand.updateWorldMatrix(true, false); targetHand.updateWorldMatrix(true, false)
  const seed: EquipmentGripFrame = {
    gripCenterLocal: left.palmContactCenter.clone().addScaledVector(left.palmNormal, LANCE_RADIUS).toArray(),
    gripAxisLocal: left.thumbDirection!.toArray(), palmNormalLocal: left.palmNormal.toArray(),
    fingerDirection: left.fingerDirection!.toArray(), wristCenter: left.wristCenter!.toArray(),
    thumbBaseCenter: left.thumbBaseCenter!.toArray(), fingerBase: left.fingerBase!, gripRadius: LANCE_RADIUS,
  }
  const lanceLeft = transferGrip(seed, targetHand.matrixWorld.clone().invert().multiply(sourceHand.matrixWorld))
  return { lanceRight: { ...right }, lanceLeft, shieldLeft: resizeGrip(lanceLeft, SHIELD_RADIUS) }
}
