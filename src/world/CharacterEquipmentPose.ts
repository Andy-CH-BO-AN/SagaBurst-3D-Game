import * as THREE from 'three'
import type { ArmRig, CharacterRig, MountedPoseKind } from './CharacterVisuals'
import { applyCharacterMountedPose } from './CharacterVisuals'
import { COMBAT_ANIMATION_PROFILES } from './CharacterCombatAnimator'
import { swordHandMatrix } from './SwordAttachmentContract'
import { equipmentWeaponFrame, type EquipmentGripFrame, type EquipmentGripFrames } from './EquipmentAttachmentContract'
const smooth = (x: number): number => { const t = THREE.MathUtils.clamp(x, 0, 1); return t * t * (3 - 2 * t) }
const SHIELD_POSE = { side: 0.36, height: 0.12, forward: 0.26 }

export interface EquipmentPoseState {
  shield: boolean
  lance: boolean
  mounted: boolean
  mountKind: MountedPoseKind
  action: string
  elapsed: number
  alive: boolean
}
export const createEquipmentPoseState = (): EquipmentPoseState => ({ shield: false, lance: false, mounted: false, mountKind: 'HORSE', action: 'idle', elapsed: 0, alive: true })

/** 只旋轉骨骼的兩節 IK；明確肘平面避免手臂翻面。 */
class ArmSolver {
  private readonly neutralShoulder = new THREE.Quaternion()
  private readonly neutralElbow = new THREE.Quaternion()
  private readonly lowerRotation = new THREE.Quaternion()
  private readonly upperRotation = new THREE.Quaternion()
  private readonly upperAxis = new THREE.Vector3()
  private readonly neutralWrist = new THREE.Quaternion()
  private readonly lowerAxis = new THREE.Vector3()
  private readonly swing = new THREE.Quaternion()
  private readonly inverseRoot = new THREE.Matrix4()
  private readonly rootQ = new THREE.Quaternion()
  private readonly parentQ = new THREE.Quaternion()
  private readonly q = new THREE.Quaternion()
  private readonly shoulder = new THREE.Vector3()
  private readonly elbow = new THREE.Vector3()
  private readonly wrist = new THREE.Vector3()
  private readonly axis = new THREE.Vector3()
  private readonly bend = new THREE.Vector3()
  private readonly x = new THREE.Vector3()
  private readonly y = new THREE.Vector3()
  private readonly upperLength: number
  private readonly lowerLength: number

  constructor(private readonly root: THREE.Object3D, private readonly arm: ArmRig, private readonly side: number) {
    root.updateMatrixWorld(true)
    this.neutralWrist.copy(arm.wrist.quaternion).invert()
    this.neutralElbow.copy(arm.elbow.quaternion).invert()
    this.neutralShoulder.copy(root.getWorldQuaternion(new THREE.Quaternion()).invert()).multiply(arm.shoulder.getWorldQuaternion(new THREE.Quaternion()))
    this.upperAxis.copy(arm.elbow.position).normalize()
    this.lowerAxis.copy(arm.wrist.position).normalize()
    this.upperLength = arm.elbow.position.length()
    this.lowerLength = arm.wrist.position.length()
  }

  solve(gripTarget: THREE.Vector3, handRotation: THREE.Quaternion, frame: EquipmentGripFrame): void {
    this.root.updateWorldMatrix(true, true)
    this.inverseRoot.copy(this.root.matrixWorld).invert()
    this.root.getWorldQuaternion(this.rootQ)
    this.arm.shoulder.getWorldPosition(this.shoulder).applyMatrix4(this.inverseRoot)
    this.wrist.fromArray(frame.gripCenterLocal).applyQuaternion(handRotation).negate().add(gripTarget)
    this.axis.subVectors(this.wrist, this.shoulder)
    const requested = this.axis.length()
    const distance = THREE.MathUtils.clamp(requested, Math.abs(this.upperLength - this.lowerLength) + 0.001, this.upperLength + this.lowerLength - 0.001)
    this.axis.normalize()
    this.wrist.copy(this.shoulder).addScaledVector(this.axis, distance)
    this.bend.set(this.side < 0 ? -0.15 : 0.65, -1, this.side < 0 ? -0.35 : -0.1)
      .addScaledVector(this.axis, -this.bend.dot(this.axis)).normalize()
    const along = (this.upperLength ** 2 - this.lowerLength ** 2 + distance ** 2) / (2 * distance)
    this.elbow.copy(this.shoulder).addScaledVector(this.axis, along).addScaledVector(this.bend, Math.sqrt(Math.max(0, this.upperLength ** 2 - along ** 2)))
    this.q.copy(handRotation).multiply(this.neutralWrist)
    this.x.copy(this.lowerAxis).applyQuaternion(this.q)
    this.y.subVectors(this.wrist, this.elbow).normalize()
    this.swing.setFromUnitVectors(this.x, this.y)
    this.lowerRotation.copy(this.q).premultiply(this.swing)
    this.q.copy(this.lowerRotation).multiply(this.neutralElbow)
    this.x.copy(this.upperAxis).applyQuaternion(this.q)
    this.y.subVectors(this.elbow, this.shoulder).normalize()
    this.swing.setFromUnitVectors(this.x, this.y)
    this.q.premultiply(this.swing)
    this.upperRotation.copy(this.q)
    this.q.copy(this.neutralShoulder)
    this.x.copy(this.upperAxis).applyQuaternion(this.q)
    this.swing.setFromUnitVectors(this.x, this.y)
    this.q.premultiply(this.swing).slerp(this.upperRotation, 0.35)
    this.arm.shoulder.parent!.getWorldQuaternion(this.parentQ).invert()
    this.arm.shoulder.quaternion.copy(this.parentQ).multiply(this.rootQ).multiply(this.q)
    this.arm.shoulder.updateWorldMatrix(false, true)
    // Match forearm roll to the anatomical hand frame, then swing its long axis
    // to the wrist. This leaves flexion at the wrist without a 180-degree twist.
    this.q.copy(this.lowerRotation)
    this.arm.elbow.parent!.getWorldQuaternion(this.parentQ).invert()
    this.arm.elbow.quaternion.copy(this.parentQ).multiply(this.rootQ).multiply(this.q)
    this.arm.elbow.updateWorldMatrix(false, true)
    this.arm.wrist.parent!.getWorldQuaternion(this.parentQ).invert()
    this.arm.wrist.quaternion.copy(this.parentQ).multiply(this.rootQ).multiply(handRotation)
    this.arm.wrist.updateWorldMatrix(false, true)
  }

}

/** 每個 LOD 一份骨架求值器；不持有或修正武器物件。 */
export class CharacterEquipmentPose {
  private readonly saved: Array<{ node: THREE.Object3D, q: THREE.Quaternion }> = []
  private applied = false
  private readonly left: ArmSolver
  private readonly shieldL: THREE.Quaternion
  private readonly target = new THREE.Vector3()
  private readonly attackAxis = new THREE.Vector3()
  private readonly attackRotation = new THREE.Quaternion()
  private readonly boneWorld = new THREE.Quaternion()
  private readonly parentInverse = new THREE.Quaternion()
  private readonly handWorld = new THREE.Quaternion()
  private readonly rootWorld = new THREE.Quaternion()
  private readonly hipsY: number
  private readonly morphs: Array<{ mesh: THREE.SkinnedMesh, right: number | undefined, left: number | undefined, shield: number | undefined }> = []

  constructor(private readonly root: THREE.Object3D, private readonly rig: CharacterRig, private readonly frames: EquipmentGripFrames) {
    this.left = new ArmSolver(root, rig.left, 1)
    const hand = (frame: EquipmentGripFrame) => new THREE.Quaternion().setFromRotationMatrix(swordHandMatrix(frame)).invert()
    this.shieldL = new THREE.Quaternion().setFromRotationMatrix(equipmentWeaponFrame('shield')).multiply(hand(frames.shieldLeft))
    root.updateMatrixWorld(true)
    this.hipsY = root.worldToLocal((rig.pelvis?.parent ?? rig.rightLeg.hip).getWorldPosition(new THREE.Vector3())).y
    const nodes = [rig.right.shoulder, rig.right.elbow, rig.right.wrist, rig.left.shoulder, rig.left.elbow, rig.left.wrist,
      rig.leftLeg.hip, rig.leftLeg.knee, rig.leftLeg.ankle, rig.rightLeg.hip, rig.rightLeg.knee, rig.rightLeg.ankle]
    for (const node of nodes) this.saved.push({ node, q: node.quaternion.clone() })
    root.traverse(o => { if (o instanceof THREE.SkinnedMesh) this.morphs.push({ mesh: o, right: o.morphTargetDictionary?.lanceRight, left: o.morphTargetDictionary?.lanceLeft, shield: o.morphTargetDictionary?.shieldLeft }) })
  }

  restore(): void {
    if (!this.applied) return
    for (const s of this.saved) s.node.quaternion.copy(s.q)
    this.applied = false
  }

  stop(): void {
    this.restore()
    for (const { mesh, right, left, shield } of this.morphs) {
      for (const index of [right, left, shield]) if (index !== undefined) mesh.morphTargetInfluences![index] = 0
    }
  }

  private rotateArm(node: THREE.Object3D, angle: number): void {
    node.getWorldQuaternion(this.boneWorld)
    node.parent!.getWorldQuaternion(this.parentInverse).invert()
    this.attackRotation.setFromAxisAngle(this.attackAxis, angle)
    node.quaternion.copy(this.parentInverse).multiply(this.attackRotation).multiply(this.boneWorld)
    node.updateWorldMatrix(false, true)
  }

  apply(state: EquipmentPoseState): void {
    for (const s of this.saved) s.q.copy(s.node.quaternion)
    this.applied = true
    const live = state.alive && state.action !== 'death'
    if (live && state.mounted) applyCharacterMountedPose(this.rig, true, state.mountKind)
    // Corgi thighs sit wider and higher than the horse's. Carry the right hand
    // forward and outside that thigh, retaining the sampled wrist orientation
    // and fixed weapon grip. This is shared by mounted melee weapons.
    if (live && state.mounted && state.mountKind === 'CORGI'
      && state.action !== 'bowAim' && state.action !== 'bowRelease' && state.action !== 'pilumThrow') {
      this.root.updateWorldMatrix(true, true)
      this.rig.right.wrist.getWorldQuaternion(this.handWorld)
      this.root.getWorldQuaternion(this.rootWorld)
      this.attackAxis.set(0, 0, 1).applyQuaternion(this.rootWorld)
      this.rotateArm(this.rig.right.shoulder, -0.60)
      this.attackAxis.set(1, 0, 0).applyQuaternion(this.rootWorld)
      let carry = 1
      if (state.action === 'swordSlash' || state.action === 'daggerSlash' || state.action === 'greatswordSlash') {
        const { windup, active, recovery } = COMBAT_ANIMATION_PROFILES[state.action]
        carry = state.elapsed < windup ? 1 - smooth(state.elapsed / windup)
          : smooth((state.elapsed - windup - active) / recovery)
      }
      this.rotateArm(this.rig.right.shoulder, -1.05 * carry)
      this.rig.right.wrist.parent!.getWorldQuaternion(this.parentInverse).invert()
      this.rig.right.wrist.quaternion.copy(this.parentInverse).multiply(this.handWorld)
      this.rig.right.wrist.updateWorldMatrix(false, true)
      // Lift the cutting edge over the neck while the authored slash crosses
      // the saddle centreline, then return to its sampled hand direction.
      if (state.action === 'swordSlash') {
        const { windup, active, recovery } = COMBAT_ANIMATION_PROFILES.swordSlash
        const lift = state.elapsed < windup + active * 0.7
          ? smooth((state.elapsed - windup - active * 0.4) / (active * 0.3))
          : 1 - smooth((state.elapsed - windup - active * 0.7) / (active * 0.3 + recovery * 0.5))
        this.rotateArm(this.rig.right.elbow, -1.15 * lift)
        this.rotateArm(this.rig.right.wrist, -0.65 * lift)
      }
    }
    // Lance uses the sampled carry pose; attacks add an FK extension.
    // The grip/weapon attachment never moves relative to the hand.
    if (live && state.lance && (state.action === 'lanceThrust' || state.action === 'mountedLance')) {
      const { windup, active, recovery } = COMBAT_ANIMATION_PROFILES[state.action]
      const peak = windup + active * .9, end = windup + active
      const extension = state.elapsed < windup ? -.18 * smooth(state.elapsed / windup)
        : state.elapsed < peak ? -.18 + 1.18 * smooth((state.elapsed - windup) / (peak - windup))
          : state.elapsed < end ? 1 : 1 - smooth((state.elapsed - end) / recovery)
      this.root.updateWorldMatrix(true, true)
      this.rig.right.wrist.getWorldQuaternion(this.handWorld)
      this.root.getWorldQuaternion(this.rootWorld)
      this.attackAxis.set(1, 0, 0).applyQuaternion(this.rootWorld)
      this.rotateArm(this.rig.right.shoulder, -1.55 * extension)
      this.rotateArm(this.rig.right.elbow, .56 * extension)
      // Keep the original hand direction: the lance translates forward instead
      // of pitching upward with the arm. No roll/supination or IK is added.
      this.rig.right.wrist.parent!.getWorldQuaternion(this.parentInverse).invert()
      this.rig.right.wrist.quaternion.copy(this.parentInverse).multiply(this.handWorld)
    }
    if (live && state.shield) {
      this.target.set(SHIELD_POSE.side, this.hipsY + SHIELD_POSE.height, SHIELD_POSE.forward)
      this.left.solve(this.target, this.shieldL, this.frames.shieldLeft)
    }
    for (const morph of this.morphs) {
      const values = morph.mesh.morphTargetInfluences!
      if (morph.right !== undefined) values[morph.right] = 0
      if (morph.left !== undefined) values[morph.left] = 0
      if (morph.shield !== undefined) values[morph.shield] = Number(live && state.shield)
    }
    this.root.updateWorldMatrix(true, true)
  }
}
