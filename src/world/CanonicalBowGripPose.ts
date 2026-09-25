import * as THREE from 'three'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { DEFAULT_BOW_GRIP_PROFILE, getBowHandGripFrame, getBowWeaponGripFrame, type HandGripFrame } from './BowAttachmentContract'
import { deriveDrawHandFrame, drawHookFrame, drawStringContact, BOW_STRING_CONTACT, BOW_ARROW_REST, DRAW_HOOK_RADIUS } from './BowDrawHand'
import { buildAnatomicalBowFingerShape } from './AnatomicalBowFingers'
import { buildAnatomicalBowThumbShape } from './AnatomicalBowThumb'
import { preserveBowHandTopology } from './BowGripLOD'

/**
 * Add bow finger-shape channels without rewriting imported arm or hand tracks.
 * Grip geometry is handled separately; clip trajectories remain authoritative.
 */
export function normalizeBowHandClips(scene: THREE.Object3D, clips: THREE.AnimationClip[]): THREE.AnimationClip[] {
  const root = clone(scene)
  return clips.map(clip => {
    if (!/^bow(Load|Hold|Release)$/.test(clip.name)) return clip
    const fingerTracks: THREE.KeyframeTrack[] = []
    root.traverse(object => {
      if (!(object instanceof THREE.SkinnedMesh) || object.morphTargetDictionary?.bowDraw === undefined) return
      const release = clip.name === 'bowRelease'
      fingerTracks.push(new THREE.NumberKeyframeTrack(`${object.name}.morphTargetInfluences[bowDraw]`,
        release ? [0, clip.duration * .18, clip.duration * .45, clip.duration] : [0, clip.duration], release ? [1, 1, 0, 0] : [1, 1]))
    })
    return new THREE.AnimationClip(clip.name, clip.duration, [
      ...clip.tracks.filter(track => !fingerTracks.some(finger => finger.name === track.name)), ...fingerTracks,
    ])
  })
}

/** A relaxed finger wrap in anatomical coordinates; never moves the wrist/palm. */
export function prepareBowGripShape(scene: THREE.Object3D, frame: HandGripFrame, reference?: THREE.Object3D): void {
  const hand = scene.getObjectByName('hand_l') as THREE.Bone
  const drawHand = scene.getObjectByName('hand_r') as THREE.Bone
  const drawFrame = deriveDrawHandFrame(scene, frame)
  drawHand.userData.bowHandFrame = { palmNormal: drawFrame.palmNormal.toArray(), thumbDirection: drawFrame.thumbDirection!.toArray() }
  if (!drawHand.getObjectByName(BOW_STRING_CONTACT)) {
    const contact = new THREE.Object3D(); contact.name = BOW_STRING_CONTACT
    contact.position.copy(reference?.getObjectByName(BOW_STRING_CONTACT)?.position ?? drawStringContact(drawFrame)); drawHand.add(contact)
  }
  if (!hand.getObjectByName(BOW_ARROW_REST)) {
    const rest = new THREE.Object3D(); rest.name = BOW_ARROW_REST
    if (reference?.getObjectByName(BOW_ARROW_REST)) rest.position.copy(reference.getObjectByName(BOW_ARROW_REST)!.position)
    hand.add(rest)
  }
  scene.traverse(object => {
    if (!(object instanceof THREE.SkinnedMesh)) return
    const index = object.skeleton.bones.indexOf(hand)
    if (index < 0) return
    const geometry = object.geometry
    const attributes = geometry.attributes
    const source = reference?.getObjectByName(object.name) as THREE.SkinnedMesh | undefined
    let target: Float32Array
    let drawTarget: Float32Array
    if (source?.morphTargetDictionary?.bowGrip !== undefined) { preserveBowHandTopology(source, object); return }
    else {
      const anatomical = buildAnatomicalBowFingerShape(object, hand, frame)
      if (!anatomical.digits.length) return
      target = buildAnatomicalBowThumbShape(object, hand, frame, anatomical).offsets
      const draw = buildAnatomicalBowFingerShape(object, drawHand, drawHookFrame(drawFrame), DRAW_HOOK_RADIUS)
      drawTarget = buildAnatomicalBowThumbShape(object, drawHand, drawHookFrame(drawFrame), draw, DRAW_HOOK_RADIUS, drawStringContact(drawFrame)).offsets
      if (draw.digits.length === 4) {
        const contact = drawHand.getObjectByName(BOW_STRING_CONTACT)!
        const toDraw = object.skeleton.boneInverses[object.skeleton.bones.indexOf(drawHand)].clone().multiply(object.bindMatrix)
        let topIndex = -Infinity
        for (let i = 0; i < attributes.position.count; i++) if (draw.digitMask[i] === 4) {
          const point = new THREE.Vector3().fromBufferAttribute(attributes.position, i).add(new THREE.Vector3().fromArray(drawTarget, i * 3)).applyMatrix4(toDraw)
          topIndex = Math.max(topIndex, point.dot(drawFrame.thumbDirection!))
        }
        // Three-under draw: the arrow sits above the index finger; the string
        // continues through the hook below it, rather than through a finger.
        contact.position.addScaledVector(drawFrame.thumbDirection!, topIndex + .012 - contact.position.dot(drawFrame.thumbDirection!))
      }
    }
    if (!reference) {
      const toHand = object.skeleton.boneInverses[index].clone().multiply(object.bindMatrix)
      let top = -Infinity
      for (let i = 0; i < attributes.position.count; i++) {
        let weight = 0
        for (let k = 0; k < 4; k++) if (attributes.skinIndex.getComponent(i, k) === index) weight += attributes.skinWeight.getComponent(i, k)
        if (weight < .7) continue
        const point = new THREE.Vector3().fromBufferAttribute(attributes.position, i).add(new THREE.Vector3().fromArray(target, i * 3)).applyMatrix4(toHand)
        top = Math.max(top, point.dot(frame.thumbDirection!))
      }
      const attachment = getBowHandGripFrame(frame).multiply(getBowWeaponGripFrame().invert())
      const gripCenter = new THREE.Vector3().setFromMatrixPosition(attachment)
      const rest = hand.getObjectByName(BOW_ARROW_REST)!
      rest.position.set(DEFAULT_BOW_GRIP_PROFILE.gripRadius + .007, top - gripCenter.dot(frame.thumbDirection!) + .018, 0).applyMatrix4(attachment)
    }
    for (const [name, offsets] of [['bowGrip', target], ['bowDraw', drawTarget]] as const) {
      // Keep lighting attached to the deformed fingers as well as their vertices.
      const bent = geometry.clone()
      const bentPosition = attributes.position.clone()
      for (let i = 0; i < bentPosition.count; i++) {
        bentPosition.setXYZ(i, bentPosition.getX(i) + offsets[i * 3], bentPosition.getY(i) + offsets[i * 3 + 1], bentPosition.getZ(i) + offsets[i * 3 + 2])
      }
      bent.setAttribute('position', bentPosition)
      bent.computeVertexNormals()
      const normals = new Float32Array(offsets.length)
      for (let i = 0; i < bentPosition.count; i++) {
        if (offsets[i * 3] === 0 && offsets[i * 3 + 1] === 0 && offsets[i * 3 + 2] === 0) continue
        for (let k = 0; k < 3; k++) normals[i * 3 + k] = bent.attributes.normal.getComponent(i, k) - attributes.normal.getComponent(i, k)
      }
      bent.dispose()
      const priorNormals = geometry.morphAttributes.normal ?? (geometry.morphAttributes.position ?? []).map(() => new THREE.Float32BufferAttribute(new Float32Array(offsets.length), 3))
      geometry.morphTargetsRelative = true
      const morph = new THREE.Float32BufferAttribute(offsets, 3)
      morph.name = name
      geometry.morphAttributes.position = [...(geometry.morphAttributes.position ?? []), morph]
      geometry.morphAttributes.normal = [...priorNormals, new THREE.Float32BufferAttribute(normals, 3)]
      object.updateMorphTargets()
    }
  })
}
