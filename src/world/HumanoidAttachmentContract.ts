import * as THREE from 'three'

/**
 * Hand Grip Frame:
 * Defines the canonical anatomical grasp frame inside the palm cavity of a humanoid hand.
 * - Origin: Center of the palm grasp cavity.
 * - Y axis: Axis along which a cylindrical handle passes through the fist,
 *           with the working end (blade/top tip) pointing toward the thumb side:
 *           Right hand: (-1, 0, 0) (thumb is -X)
 *           Left hand: (+1, 0, 0) (thumb is +X)
 * - Z axis: Normal pointing into the palm surface: (0, 0, -1)
 * - X axis: Y x Z (orthogonal direction across knuckles)
 */
export function getHandGripFrame(side: 'l' | 'r'): THREE.Matrix4 {
  const thumbDir = side === 'r' ? -1 : 1
  const palmZ = -0.055
  const knuckleY = 0.070
  const palmX = thumbDir * 0.020

  const origin = new THREE.Vector3(palmX, knuckleY, palmZ)
  const yAxis = new THREE.Vector3(thumbDir, 0, 0)
  const zAxis = new THREE.Vector3(0, 0, -1)
  const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis)

  const rotMatrix = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis)
  return new THREE.Matrix4().makeTranslation(origin.x, origin.y, origin.z).multiply(rotMatrix)
}

/**
 * Weapon Grip Frame:
 * Authored local frame of the weapon model.
 * - Origin: (0, gripY, 0), the grip center along the weapon handle.
 * - Y axis: (0, 1, 0), the longitudinal axis toward blade tip or bow top tip.
 * - Z axis: (0, 0, 1), the rear surface that contacts the palm.
 * - X axis: (1, 0, 0).
 */
export function getWeaponGripFrame(_weaponType: 'melee' | 'ranged', gripY = 0): THREE.Matrix4 {
  const origin = new THREE.Vector3(0, gripY, 0)
  const yAxis = new THREE.Vector3(0, 1, 0)
  const zAxis = new THREE.Vector3(0, 0, 1)
  const xAxis = new THREE.Vector3(1, 0, 0)

  const rotMatrix = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis)
  return new THREE.Matrix4().makeTranslation(origin.x, origin.y, origin.z).multiply(rotMatrix)
}

/**
 * Computes the attachment transform for a weapon attached to a hand socket:
 *   attachmentTransform = inv(socketLocal) * handGripFrame * inv(weaponGripFrame)
 */
export function computeSocketAttachment(
  socket: THREE.Object3D,
  side: 'l' | 'r',
  weaponType: 'melee' | 'ranged',
  gripY = 0,
): { position: THREE.Vector3, quaternion: THREE.Quaternion, scale: THREE.Vector3 } {
  const fHand = getHandGripFrame(side)
  const fWeapon = getWeaponGripFrame(weaponType, gripY)

  const invW = new THREE.Matrix4().copy(fWeapon).invert()
  const attachInHand = new THREE.Matrix4().multiplyMatrices(fHand, invW)

  socket.updateMatrix()
  const invSocket = new THREE.Matrix4().copy(socket.matrix).invert()
  const attachInSocket = new THREE.Matrix4().multiplyMatrices(invSocket, attachInHand)

  const position = new THREE.Vector3()
  const quaternion = new THREE.Quaternion()
  const scale = new THREE.Vector3()
  attachInSocket.decompose(position, quaternion, scale)

  return { position, quaternion, scale }
}

export function applyAttachmentContract(
  socket: THREE.Object3D,
  side: 'l' | 'r',
  weaponPivot: THREE.Object3D,
  weaponType: 'melee' | 'ranged',
  gripY = 0,
): void {
  const { position, quaternion, scale } = computeSocketAttachment(socket, side, weaponType, gripY)
  weaponPivot.position.copy(position)
  weaponPivot.quaternion.copy(quaternion)
  weaponPivot.scale.copy(scale)
  weaponPivot.updateMatrix()
}
