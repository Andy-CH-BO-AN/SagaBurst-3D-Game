import * as THREE from 'three'
import type { CharacterRig } from './CharacterVisuals'

const left = new THREE.Vector3()
const right = new THREE.Vector3()
const target = new THREE.Vector3()
const parentInverse = new THREE.Matrix4()

/**
 * Call after the character's pose and the mount's animation have been sampled.
 * Translates the visual inside its normal-size actor root so the midpoint of the
 * actual sole sockets meets the standing socket. No pelvis assumption or scale
 * inheritance, and no persistent offset that a second call could accumulate.
 */
export function fitStandingRider(
  visualRoot: THREE.Object3D,
  rig: Pick<CharacterRig, 'leftFootSocket' | 'rightFootSocket'>,
  standingSocket: THREE.Object3D,
): boolean {
  if (!visualRoot.parent || !rig.leftFootSocket || !rig.rightFootSocket) return false
  visualRoot.updateWorldMatrix(true, true)
  standingSocket.updateWorldMatrix(true, false)
  rig.leftFootSocket.getWorldPosition(left)
  rig.rightFootSocket.getWorldPosition(right)
  left.add(right).multiplyScalar(.5)
  standingSocket.getWorldPosition(target)
  parentInverse.copy(visualRoot.parent.matrixWorld).invert()
  left.applyMatrix4(parentInverse)
  target.applyMatrix4(parentInverse)
  visualRoot.position.add(target.sub(left))
  visualRoot.updateWorldMatrix(false, true)
  return true
}
