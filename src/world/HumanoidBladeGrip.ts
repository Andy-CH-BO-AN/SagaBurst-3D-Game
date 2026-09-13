import * as THREE from 'three'
import { isLegacyBladeGripBypass } from './HumanoidAttachmentContract'

const THUMB_UP = new THREE.Vector3(0, -1, 0)
const X = new THREE.Vector3(1, 0, 0)
const matrix = new THREE.Matrix4()
const direction = new THREE.Vector3()
const axis = new THREE.Vector3()
const normal = new THREE.Vector3()
const parentRotation = new THREE.Quaternion()
const rotation = new THREE.Quaternion()

/** Author a shared, optional closed-hand shape in the hand's bind coordinates. */
export function prepareBladeGrip(scene: THREE.Object3D, faction: 'viking' | 'roman'): void {
  const hand = scene.getObjectByName('hand_r')!
  const palmZ = faction === 'roman' ? -0.062 : -0.04
  const knuckleY = faction === 'roman' ? 0.065 : 0.10
  const curlSign = faction === 'roman' ? 1 : -1
  const radius = 0.038
  hand.userData.bladeGripCenter = [-0.025, knuckleY, palmZ + curlSign * radius]
  // Calibrated in bind-hand front/back views, not inferred from bone names.
  hand.userData.bladeGripAxis = faction === 'roman' ? -1 : 1
  const leftHand = scene.getObjectByName('hand_l')
  if (leftHand) leftHand.userData.thumbAxis = faction === 'roman' ? 1 : -1
  scene.traverse((object) => {
    if (!(object instanceof THREE.SkinnedMesh)) return
    const handIndex = object.skeleton.bones.indexOf(hand as THREE.Bone)
    if (handIndex < 0) return
    const geometry = object.geometry
    const { position, skinIndex, skinWeight } = geometry.attributes
    const toHand = new THREE.Matrix4().multiplyMatrices(object.skeleton.boneInverses[handIndex], object.bindMatrix)
    const fromHand = toHand.clone().invert()
    const target = new Float32Array(position.count * 3)
    const point = new THREE.Vector3()
    const original = new THREE.Vector3()
    let changed = false
    for (let i = 0; i < position.count; i++) {
      original.fromBufferAttribute(position, i)
      point.copy(original).applyMatrix4(toHand)
      let weight = 0
      for (let k = 0; k < 4; k++) {
        if (skinIndex.getComponent(i, k) === handIndex) weight += skinWeight.getComponent(i, k)
      }
      // Bend the distal fingers around the cylindrical grip, leaving the wrist
      // and palm intact. No finger bones survived the canonical skeleton export.
      const restZ = palmZ - (faction === 'viking' ? Math.max(0, point.y - knuckleY) * 0.85 : 0)
      if (weight > 0.5 && point.y > knuckleY && Math.abs(point.z - restZ) < 0.045) {
        const length = point.y - knuckleY
        const angle = Math.min(length / radius, Math.PI * 0.95)
        const thickness = (point.z - restZ) * curlSign
        point.y = knuckleY + (radius - thickness) * Math.sin(angle)
        point.z = palmZ + curlSign * (radius - (radius - thickness) * Math.cos(angle))
        point.applyMatrix4(fromHand).sub(original)
        target.set(point.toArray(), i * 3)
        changed = true
      }
    }
    if (!changed) return
    geometry.morphTargetsRelative = true
    const morph = new THREE.Float32BufferAttribute(target, 3)
    morph.name = 'bladeGrip'
    geometry.morphAttributes.position = [morph]
    object.updateMorphTargets()
  })
}

/** A weapon-aware upper-body layer; the locomotion clip still owns the legs. */
export class HumanoidBladeGrip {
  private readonly shoulder: THREE.Object3D
  private readonly elbow: THREE.Object3D
  private readonly hand: THREE.Object3D
  private readonly leftHand: THREE.Object3D | undefined
  private readonly leftBase = new THREE.Quaternion()
  private readonly meshes: THREE.SkinnedMesh[] = []
  private readonly base = [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()]
  private applied = false
  private weight = 0

  constructor(private readonly root: THREE.Object3D) {
    this.shoulder = root.getObjectByName('upper_arm_r')!
    this.elbow = root.getObjectByName('lower_arm_r')!
    this.hand = root.getObjectByName('hand_r')!
    this.leftHand = root.getObjectByName('hand_l')
    root.traverse((object) => {
      if (object instanceof THREE.SkinnedMesh && object.morphTargetDictionary?.bladeGrip !== undefined) this.meshes.push(object)
    })
  }

  restore(): void {
    if (!this.applied) return
    ;[this.shoulder, this.elbow, this.hand].forEach((bone, i) => bone.quaternion.copy(this.base[i]))
    if (this.leftHand) this.leftHand.quaternion.copy(this.leftBase)
    this.applied = false
  }

  reset(): void {
    this.restore()
    this.weight = 0
    for (const mesh of this.meshes) mesh.morphTargetInfluences![mesh.morphTargetDictionary!.bladeGrip] = 0
  }

  update(dt: number, holding: boolean, guard: boolean): void {
    if (isLegacyBladeGripBypass()) { this.reset(); return }
    if (!holding) { this.reset(); return }
    const blend = 1 - Math.exp(-dt / 0.08)
    this.weight = THREE.MathUtils.lerp(this.weight, guard ? 1 : 0, blend)
    for (const mesh of this.meshes) {
      const index = mesh.morphTargetDictionary!.bladeGrip
      mesh.morphTargetInfluences![index] = THREE.MathUtils.lerp(mesh.morphTargetInfluences![index], holding ? 1 : 0, blend)
    }
    if (this.weight < 0.001) return
    ;[this.shoulder, this.elbow, this.hand].forEach((bone, i) => this.base[i].copy(bone.quaternion))
    if (this.leftHand) this.leftBase.copy(this.leftHand.quaternion)
    this.root.updateWorldMatrix(true, true)
    // Elbow beside the ribs, forearm forward, palm turned inward. The hand's
    // local X runs across the fist and therefore along the upright sword hilt.
    // Keep the imported shoulder pose and roll: imposing a world-axis roll here
    // twists the shoulder skin and armour away from the chest.
    this.orient(this.elbow, direction.set(-0.08, -0.15, 0.985), X)
    const gripAxis = this.hand.userData.bladeGripAxis ?? -1
    THUMB_UP.set(0, gripAxis, 0)
    this.orient(this.hand, direction.set(0, -0.10, 0.995), THUMB_UP)
    this.applied = true
  }

  private orient(bone: THREE.Object3D, along: THREE.Vector3, across: THREE.Vector3, weight = this.weight): void {
    along.normalize()
    normal.crossVectors(across, along).normalize()
    axis.crossVectors(along, normal).normalize()
    rotation.setFromRotationMatrix(matrix.makeBasis(axis, along, normal))
    this.root.getWorldQuaternion(parentRotation)
    rotation.premultiply(parentRotation)
    bone.parent!.getWorldQuaternion(parentRotation)
    rotation.premultiply(parentRotation.invert())
    bone.quaternion.slerp(rotation, weight)
    bone.updateWorldMatrix(false, true)
  }
}
