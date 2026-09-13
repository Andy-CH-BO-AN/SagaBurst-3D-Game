import * as THREE from 'three'
import { type HandGripFrame } from './BowAttachmentContract'

export const BOW_STRING_CONTACT = 'bow_string_contact'
export const BOW_ARROW_REST = 'bow_arrow_rest'
export const DRAW_HOOK_RADIUS = 0.01

/** Mirror anatomical landmarks through the character's sagittal bind plane. */
export function deriveDrawHandFrame(scene: THREE.Object3D, left: HandGripFrame): HandGripFrame {
  scene.updateMatrixWorld(true)
  const l = scene.getObjectByName('hand_l')!, r = scene.getObjectByName('hand_r')!
  const mirror = scene.matrixWorld.clone().multiply(new THREE.Matrix4().makeScale(-1, 1, 1)).multiply(scene.matrixWorld.clone().invert())
  const transform = r.matrixWorld.clone().invert().multiply(mirror).multiply(l.matrixWorld)
  const finger = left.fingerDirection!.clone().transformDirection(transform)
  const basePoint = left.fingerDirection!.clone().multiplyScalar(left.fingerBase!).applyMatrix4(transform)
  return {
    palmContactCenter: left.palmContactCenter.clone().applyMatrix4(transform),
    palmNormal: left.palmNormal.clone().transformDirection(transform),
    thumbDirection: left.thumbDirection!.clone().transformDirection(transform),
    fingerDirection: finger,
    wristCenter: left.wristCenter!.clone().applyMatrix4(transform),
    thumbBaseCenter: left.thumbBaseCenter!.clone().applyMatrix4(transform),
    fingerBase: basePoint.dot(finger), thumbDir: -left.thumbDir,
  }
}

/** String lies in the distal finger hook, beyond the metacarpals. */
export function drawHookFrame(frame: HandGripFrame): HandGripFrame {
  const center = frame.palmContactCenter.clone()
    .addScaledVector(frame.fingerDirection!, frame.fingerBase! + DRAW_HOOK_RADIUS - frame.palmContactCenter.dot(frame.fingerDirection!))
  return { ...frame, palmContactCenter: center }
}

export function drawStringContact(frame: HandGripFrame): THREE.Vector3 {
  return drawHookFrame(frame).palmContactCenter.clone().addScaledVector(frame.palmNormal, DRAW_HOOK_RADIUS)
    .addScaledVector(frame.fingerDirection!, -DRAW_HOOK_RADIUS)
}
