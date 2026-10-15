import * as THREE from 'three'
import { DEFAULT_BOW_GRIP_PROFILE, getBowHandGripFrame, getBowWeaponGripFrame, type HandGripFrame } from './BowAttachmentContract'

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

/** Contact metadata for source-authored fingers: no morphs or animation edits.
 * Roman's index joint follows its delivered finger curl; the rigid Viking hand
 * uses the calibrated hook in the wrist frame. Both are actor-owned on clone.
 */
export function prepareAuthoredBowContacts(scene: THREE.Object3D, frame: HandGripFrame): void {
  const left = scene.getObjectByName('hand_l')!, right = scene.getObjectByName('hand_r')!
  const draw = deriveDrawHandFrame(scene, frame)
  const contact = new THREE.Object3D()
  contact.name = BOW_STRING_CONTACT
  contact.position.copy(drawStringContact(draw))
  right.add(contact)
  // Keep the calibrated point, but let the source index chain carry it when
  // present. attach preserves its bind-space location rather than copying axes.
  const index = scene.getObjectByName('Index02R')
  if (index) { scene.updateMatrixWorld(true); index.attach(contact) }
  const rest = new THREE.Object3D()
  rest.name = BOW_ARROW_REST
  rest.position.set(DEFAULT_BOW_GRIP_PROFILE.gripRadius + .007, DEFAULT_BOW_GRIP_PROFILE.gripLength / 2 + .015, 0)
    .applyMatrix4(getBowHandGripFrame(frame).multiply(getBowWeaponGripFrame().invert()))
  left.add(rest)
}
