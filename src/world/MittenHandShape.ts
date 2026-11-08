import * as THREE from 'three'

export const MITTEN_MORPHS = { gripRight: 'mittenGripR', gripLeft: 'mittenGripL', hollowRight: 'mittenHollowR', hollowLeft: 'mittenHollowL' } as const

/** Hand-local anatomy: fingers bend at the knuckle around an axis across the palm through `center`. */
export interface MittenFrame {
  finger: readonly number[]
  thumb: readonly number[]
  palm: readonly number[]
  center: readonly number[]
}
interface CurlShape { radius: number; maxAngle: number; thumbAngle: number }
/** Fingers wrap a shaft / a loose, empty grip at rest. */
export const MITTEN_GRIP: CurlShape = { radius: 0, maxAngle: 3.5, thumbAngle: 1.3 }
export const MITTEN_HOLLOW: CurlShape = { radius: .1, maxAngle: 1.5, thumbAngle: .55 }
/** The thumb starts this far across the palm from the finger axis. */
const THUMB_ACROSS = .042

/** Pure bend in the hand's (along, across, palm) coordinates; returns the moved point and the bend rotation. */
export function curlHandPoint(along: number, across: number, height: number, knuckle: number, curlHeight: number, shape: CurlShape): { along: number; across: number; height: number; bend: number; thumb: number } {
  if (across > THUMB_ACROSS) {
    // Thumb rolls toward the palm about the finger axis.
    const c = Math.cos(shape.thumbAngle), s = Math.sin(shape.thumbAngle), offset = across - THUMB_ACROSS
    return { along, across: THUMB_ACROSS + offset * c - height * s, height: offset * s + height * c, bend: 0, thumb: shape.thumbAngle }
  }
  if (along <= knuckle) return { along, across, height, bend: 0, thumb: 0 }
  const radius = shape.radius || curlHeight
  const bend = Math.min(shape.maxAngle, (along - knuckle) / radius)
  const reach = radius - height
  return { along: knuckle + reach * Math.sin(bend), across, height: radius - reach * Math.cos(bend), bend, thumb: 0 }
}

/** Adds four relative morph targets to a mitten-handed mesh. The source rig has no finger bones, so this is the
 * only way its hand can close; poses and weapon frames stay independent. Shared geometry, computed once at load. */
export function prepareMittenHandShape(mesh: THREE.SkinnedMesh, hands: Array<{ bone: THREE.Object3D; frame: MittenFrame; grip: string; hollow: string }>): void {
  const geometry = mesh.geometry, position = geometry.attributes.position, normal = geometry.attributes.normal
  const skinIndex = geometry.attributes.skinIndex, skinWeight = geometry.attributes.skinWeight
  const targets: THREE.Float32BufferAttribute[] = [], normals: THREE.Float32BufferAttribute[] = [], names: string[] = []
  const point = new THREE.Vector3(), local = new THREE.Vector3(), out = new THREE.Vector3(), n = new THREE.Vector3()
  for (const hand of hands) {
    const joint = mesh.skeleton.bones.indexOf(hand.bone as THREE.Bone)
    if (joint < 0) throw new Error(`Mitten hand is not skinned: ${hand.bone.name}`)
    const inverse = mesh.skeleton.boneInverses[joint]
    const rotation = new THREE.Quaternion().setFromRotationMatrix(inverse), back = rotation.clone().invert()
    const finger = new THREE.Vector3(...hand.frame.finger), thumb = new THREE.Vector3(...hand.frame.thumb), palm = new THREE.Vector3(...hand.frame.palm)
    const center = new THREE.Vector3(...hand.frame.center)
    const knuckle = center.dot(finger), curlHeight = center.dot(palm)
    for (const [name, shape] of [[hand.grip, MITTEN_GRIP], [hand.hollow, MITTEN_HOLLOW]] as const) {
      const offsets = new Float32Array(position.count * 3), normalOffsets = new Float32Array(position.count * 3)
      for (let i = 0; i < position.count; i++) {
        let weight = 0
        for (let c = 0; c < 4; c++) if (skinIndex.getComponent(i, c) === joint) weight += skinWeight.getComponent(i, c)
        if (weight < .5) continue
        local.copy(point.fromBufferAttribute(position, i)).applyMatrix4(mesh.bindMatrix).applyMatrix4(inverse)
        const along = local.dot(finger), across = local.dot(thumb), height = local.dot(palm)
        const moved = curlHandPoint(along, across, height, knuckle, curlHeight, shape)
        if (moved.bend === 0 && moved.thumb === 0) continue
        out.copy(finger).multiplyScalar(moved.along - along).addScaledVector(thumb, moved.across - across).addScaledVector(palm, moved.height - height).applyQuaternion(back)
        offsets.set([out.x, out.y, out.z], i * 3)
        n.fromBufferAttribute(normal, i).applyQuaternion(rotation)
        const bent = moved.thumb ? n.clone().applyAxisAngle(finger, moved.thumb) : n.clone().applyAxisAngle(thumb, -moved.bend)
        bent.sub(n).applyQuaternion(back)
        normalOffsets.set([bent.x, bent.y, bent.z], i * 3)
      }
      targets.push(new THREE.Float32BufferAttribute(offsets, 3)); normals.push(new THREE.Float32BufferAttribute(normalOffsets, 3)); names.push(name)
    }
  }
  targets.forEach((target, index) => { target.name = names[index] })
  geometry.morphTargetsRelative = true
  geometry.morphAttributes.position = targets
  geometry.morphAttributes.normal = normals
  mesh.updateMorphTargets()
}
