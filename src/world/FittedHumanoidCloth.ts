import * as THREE from 'three'

/** Asset-measured helper bones. Foot/death motion remains in the baked clips;
 * this layer only follows the runtime's procedural seated legs and torso. */
export interface FittedHumanoidClothRig {
  anchor: string
  cape: readonly { name: string; mountedPitch: number }[]
  skirt: readonly { name: string; thigh: string; follow: number }[]
  apron?: string
}

export class FittedHumanoidCloth {
  readonly nodes: THREE.Object3D[] = []
  private readonly anchor: THREE.Object3D
  private readonly anchorRestInverse = new THREE.Quaternion()
  private readonly cape: Array<{ bone: THREE.Object3D; rest: THREE.Quaternion; pitch: number }> = []
  private readonly skirt: Array<{ bone: THREE.Object3D; thigh: THREE.Object3D; rest: THREE.Quaternion; direction: THREE.Vector3; parentRest: THREE.Quaternion; restFlexion: number; follow: number }> = []
  private readonly apron?: THREE.Object3D
  private readonly apronRest?: THREE.Quaternion
  private readonly apronAxis = new THREE.Vector3(1, 0, 0)
  private readonly rootRotation = new THREE.Quaternion()
  private readonly rootInverse = new THREE.Quaternion()
  private readonly delta = new THREE.Quaternion()
  private readonly yaw = new THREE.Quaternion()
  private readonly pitch = new THREE.Quaternion()
  private readonly parentInverse = new THREE.Quaternion()
  private readonly swing = new THREE.Quaternion()
  private readonly weighted = new THREE.Quaternion()
  private readonly direction = new THREE.Vector3()
  private readonly x = new THREE.Vector3(1, 0, 0)
  private readonly y = new THREE.Vector3(0, 1, 0)

  constructor(private readonly root: THREE.Object3D, rig: FittedHumanoidClothRig) {
    const get = (name: string): THREE.Object3D => {
      const bone = root.getObjectByName(name)
      if (!(bone instanceof THREE.Bone)) throw new Error(`Fitted cloth missing bone ${name}`)
      return bone
    }
    root.updateWorldMatrix(true, true)
    root.getWorldQuaternion(this.rootInverse).invert()
    this.anchor = get(rig.anchor)
    this.anchorRestInverse.copy(this.rootInverse).multiply(this.anchor.getWorldQuaternion(this.delta)).invert()
    for (const item of rig.cape) {
      if (!Number.isFinite(item.mountedPitch)) throw new Error('Invalid fitted cape pitch')
      const bone = get(item.name)
      this.cape.push({ bone, rest: this.rootInverse.clone().multiply(bone.getWorldQuaternion(new THREE.Quaternion())), pitch: item.mountedPitch })
      this.nodes.push(bone)
    }
    for (const item of rig.skirt) {
      if (!Number.isFinite(item.follow) || item.follow < 0 || item.follow > 1) throw new Error('Invalid fitted skirt follow')
      const bone = get(item.name), thigh = get(item.thigh)
      if (bone.parent !== thigh.parent) throw new Error(`Fitted skirt ${item.name} must share its thigh parent`)
      const direction = this.y.clone().applyQuaternion(thigh.quaternion)
      const parentRest = this.rootInverse.clone().multiply(thigh.parent!.getWorldQuaternion(new THREE.Quaternion()))
      this.direction.copy(direction).applyQuaternion(parentRest)
      const restFlexion = Math.atan2(this.direction.z, -this.direction.y)
      this.skirt.push({ bone, thigh, rest: bone.quaternion.clone(), direction, parentRest, restFlexion, follow: item.follow })
      this.nodes.push(bone)
    }
    if (rig.apron) {
      this.apron = get(rig.apron)
      this.apronRest = this.apron.quaternion.clone()
      this.apron.parent!.getWorldQuaternion(this.parentInverse).invert()
      this.root.getWorldQuaternion(this.rootRotation)
      this.apronAxis.copy(this.x).applyQuaternion(this.parentInverse.multiply(this.rootRotation))
      this.nodes.push(this.apron)
    }
  }

  applyMounted(): void {
    this.root.updateWorldMatrix(true, true)
    this.root.getWorldQuaternion(this.rootRotation)
    this.rootInverse.copy(this.rootRotation).invert()
    this.delta.copy(this.rootInverse).multiply(this.anchor.getWorldQuaternion(this.parentInverse)).multiply(this.anchorRestInverse)
    this.direction.set(0, 0, 1).applyQuaternion(this.delta)
    this.yaw.setFromAxisAngle(this.y, Math.atan2(this.direction.x, this.direction.z))
    // Follow chest yaw but compensate its lean in the helper alone. Parent-first
    // ordering is authored in the asset; each child's world rest is independent.
    for (const { bone, rest, pitch } of this.cape) {
      bone.parent!.getWorldQuaternion(this.parentInverse).invert()
      this.pitch.setFromAxisAngle(this.x, pitch)
      bone.quaternion.copy(this.parentInverse).multiply(this.rootRotation).multiply(this.yaw).multiply(this.pitch).multiply(rest)
      bone.updateWorldMatrix(false, true)
    }
    let flexion = 0
    for (const item of this.skirt) {
      this.direction.copy(this.y).applyQuaternion(item.thigh.quaternion)
      this.swing.setFromUnitVectors(item.direction, this.direction)
      item.bone.quaternion.copy(this.weighted.identity().slerp(this.swing, item.follow)).multiply(item.rest)
      // Anatomical forward/down lives in the actor frame, not an arbitrary
      // pelvis bind basis (the fitted pelvis may face 180 degrees in bone space).
      this.direction.applyQuaternion(item.parentRest)
      flexion = Math.max(flexion, Math.atan2(this.direction.z, -this.direction.y) - item.restFlexion)
    }
    if (this.apron && this.apronRest) this.apron.quaternion.copy(this.pitch.setFromAxisAngle(this.apronAxis, -.9 * flexion)).multiply(this.apronRest)
  }
}
