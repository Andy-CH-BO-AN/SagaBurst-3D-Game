import { FittedHumanoidCloth, type FittedHumanoidClothRig } from './FittedHumanoidCloth'
import * as THREE from 'three'
import type { ArmRig, CharacterRig, MountedPoseKind } from './CharacterVisuals'
import { applyCharacterMountedPose, setRigRotation } from './CharacterVisuals'
import { AXE_HIT_TIMES, COMBAT_ANIMATION_PROFILES } from './CharacterCombatAnimator'
import { axeRecoveryWeight, naturalAxeHandMatrix, swordHandMatrix, type WeaponGripSections } from './SwordAttachmentContract'
import { equipmentWeaponFrame, type EquipmentGripFrame, type EquipmentGripFrames } from './EquipmentAttachmentContract'
import { XONGKORO_VISUAL } from '../movement/XongkoroConfig'
import { SelectedMountedSkirt, type SelectedHumanoidSource } from './SelectedHumanoidSource'
const smooth = (x: number): number => { const t = THREE.MathUtils.clamp(x, 0, 1); return t * t * (3 - 2 * t) }
const SHIELD_POSE = { side: 0.36, height: 0.12, forward: 0.26 }

export interface EquipmentPoseState {
  shield: boolean
  carryWeapon?: 'sword' | 'axe'
  /** Actual sword kind; a mace also uses the legacy sword attachment owner. */
  actualSword?: boolean
  /** Measured selected handle cross-section, sampled once on attachment. */
  swordGripSections?: WeaponGripSections
  shieldRaised?: boolean
  lance: boolean
  mounted: boolean
  moving?: boolean
  flightLean?: number
  /** Mixer-owned: a bow clip still contributes, including its return-to-idle fade. */
  sampledBowPose?: boolean
  /** Actual upper-body locomotion contribution, excluding bow leg-only layers. */
  relaxedHandWeight?: number
  mountKind: MountedPoseKind
  action: string
  elapsed: number
  /** Only measured, trimmed 2H actions opt into continuous pose corrections. */
  continuousAxeAction?: boolean
  alive: boolean
}
export interface SwordCarryGripProfile {
  palmRadius: number
  fingerRadius: number
  /** Measured palm skin thickness beyond the legacy mathematical contact plane. */
  palmSurfaceOffset: number
  /** Along-finger placement of the natural curled contact area. */
  palmFingerOffset: number
  digits: Record<string, [number, number, number, number]>
}
export const createEquipmentPoseState = (): EquipmentPoseState => ({ shield: false, lance: false, mounted: false, mountKind: 'HORSE', action: 'idle', elapsed: 0, alive: true })

interface ArmBendContinuity {
  ready: boolean
  axis: THREE.Vector3
  bend: THREE.Vector3
  twist: number
  upperReady: boolean
  upperX: THREE.Vector3
  upperY: THREE.Vector3
  upperTransported: THREE.Quaternion
  upperTwist: number
}

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
  private readonly sampledElbow = new THREE.Vector3()
  private readonly sampledWrist = new THREE.Vector3()
  private readonly sampledUpper = new THREE.Quaternion()
  private readonly sampledLower = new THREE.Quaternion()
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

  solve(gripTarget: THREE.Vector3, handRotation: THREE.Quaternion, frame: EquipmentGripFrame, bodyRotation?: THREE.Quaternion, followSampledPose = false, alignForearmRoll = false, continuity?: ArmBendContinuity): void {
    // Refresh root before reading matrixWorld; bone getters refresh their own
    // ancestor paths. Keep the solved arm subtree updates below for callers.
    this.root.updateWorldMatrix(true, false)
    this.inverseRoot.copy(this.root.matrixWorld).invert()
    this.root.getWorldQuaternion(this.rootQ)
    this.arm.shoulder.getWorldPosition(this.shoulder).applyMatrix4(this.inverseRoot)
    if (followSampledPose) {
      this.arm.elbow.getWorldPosition(this.sampledElbow).applyMatrix4(this.inverseRoot)
      this.arm.wrist.getWorldPosition(this.sampledWrist).applyMatrix4(this.inverseRoot)
      this.parentQ.copy(this.rootQ).invert()
      this.arm.shoulder.getWorldQuaternion(this.sampledUpper).premultiply(this.parentQ)
      this.arm.elbow.getWorldQuaternion(this.sampledLower).premultiply(this.parentQ)
    }
    this.wrist.fromArray(frame.gripCenterLocal).applyQuaternion(handRotation).negate().add(gripTarget)
    this.axis.subVectors(this.wrist, this.shoulder)
    const requested = this.axis.length()
    const distance = THREE.MathUtils.clamp(requested, Math.abs(this.upperLength - this.lowerLength) + 0.001, this.upperLength + this.lowerLength - 0.001)
    this.axis.normalize()
    this.wrist.copy(this.shoulder).addScaledVector(this.axis, distance)
    this.bend.set(this.side < 0 ? -0.15 : 0.65, -1, this.side < 0 ? -0.35 : -0.1)
    if (bodyRotation) this.bend.applyQuaternion(bodyRotation)
    if (followSampledPose) this.bend.subVectors(this.sampledElbow, this.shoulder)
    this.bend.addScaledVector(this.axis, -this.bend.dot(this.axis))
    const poleRatio = continuity ? this.bend.length() / this.upperLength : 1
    const conditionedPole = continuity?.ready && poleRatio < .25
    if (conditionedPole) {
      // Only opted-in 2H conditions the poorly defined sampled elbow plane.
      // Below sin(angle)=.25, transport a root-space reference and smoothly
      // recover the sampled plane's unwrapped angle. Outside this cone
      // use the original solution exactly; no grip target is moved.
      this.y.copy(continuity.bend).applyQuaternion(this.swing.setFromUnitVectors(continuity.axis, this.axis))
      this.y.addScaledVector(this.axis, -this.y.dot(this.axis)).normalize()
      if (this.bend.lengthSq() >= 1e-12) {
        this.bend.normalize()
        const angle = Math.atan2(this.x.crossVectors(this.y, this.bend).dot(this.axis), this.y.dot(this.bend))
        continuity.twist += Math.atan2(Math.sin(angle - continuity.twist), Math.cos(angle - continuity.twist))
      }
      this.bend.copy(this.y).applyQuaternion(this.swing.setFromAxisAngle(this.axis, continuity.twist * smooth(poleRatio / .25)))
      continuity.bend.copy(this.y)
    } else {
      if (continuity && this.bend.lengthSq() < 1e-12) {
        this.bend.set(Math.abs(this.axis.y) < .9 ? 0 : 1, Math.abs(this.axis.y) < .9 ? 1 : 0, 0)
        this.bend.addScaledVector(this.axis, -this.bend.dot(this.axis))
      }
      this.bend.normalize()
    }
    if (continuity) {
      if (!conditionedPole) { continuity.bend.copy(this.bend); continuity.twist = 0 }
      continuity.axis.copy(this.axis); continuity.ready = true
    }
    const along = (this.upperLength ** 2 - this.lowerLength ** 2 + distance ** 2) / (2 * distance)
    this.elbow.copy(this.shoulder).addScaledVector(this.axis, along).addScaledVector(this.bend, Math.sqrt(Math.max(0, this.upperLength ** 2 - along ** 2)))
    if (followSampledPose) {
      // Move the sampled elbow plane to the new grasp with shortest swings.
      // Palm pronation must not be propagated backwards into the shoulder.
      this.x.subVectors(this.sampledWrist, this.sampledElbow).normalize()
      this.y.subVectors(this.wrist, this.elbow).normalize()
      this.lowerRotation.copy(this.sampledLower).premultiply(this.swing.setFromUnitVectors(this.x, this.y))
      if (alignForearmRoll) {
        // The selected rigs have no separate forearm-twist joints. Keep the
        // sampled elbow plane, but put grasp pronation in the forearm rather
        // than concentrating a full axial twist at the wrist/cuff seam.
        this.lowerRotation.copy(handRotation).multiply(this.neutralWrist)
        this.x.copy(this.lowerAxis).applyQuaternion(this.lowerRotation)
        this.lowerRotation.premultiply(this.swing.setFromUnitVectors(this.x, this.y))
      }
      this.x.subVectors(this.sampledElbow, this.shoulder).normalize()
      this.y.subVectors(this.elbow, this.shoulder).normalize()
      this.swing.setFromUnitVectors(this.x, this.y)
      if (continuity) {
        const upperDot = this.x.dot(this.y)
        if (!continuity.upperReady || upperDot >= -.8) {
          continuity.upperTransported.copy(this.swing)
          continuity.upperTwist = 0
        } else {
          // Near antiparallel upper-arm directions, transport the swing from
          // both endpoint increments so it still maps x -> y exactly, then
          // smoothly recover the shortest-arc axial twist as upperDot -> -0.8.
          this.upperRotation.setFromUnitVectors(continuity.upperY, this.y)
          this.parentQ.setFromUnitVectors(this.x, continuity.upperX)
          continuity.upperTransported.premultiply(this.upperRotation).multiply(this.parentQ).normalize()
          this.upperRotation.copy(this.swing).multiply(this.parentQ.copy(continuity.upperTransported).invert()).normalize()
          const twist = 2 * Math.atan2(this.upperRotation.x * this.y.x + this.upperRotation.y * this.y.y + this.upperRotation.z * this.y.z, this.upperRotation.w)
          continuity.upperTwist += Math.atan2(Math.sin(twist - continuity.upperTwist), Math.cos(twist - continuity.upperTwist))
          this.swing.setFromAxisAngle(this.y, continuity.upperTwist * smooth((upperDot + 1) / .2)).multiply(continuity.upperTransported).normalize()
        }
        continuity.upperX.copy(this.x)
        continuity.upperY.copy(this.y)
        continuity.upperReady = true
      }
      this.q.copy(this.sampledUpper).premultiply(this.swing)
    } else {
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
      if (bodyRotation) this.q.premultiply(bodyRotation)
      this.x.copy(this.upperAxis).applyQuaternion(this.q)
      this.swing.setFromUnitVectors(this.x, this.y)
      this.q.premultiply(this.swing).slerp(this.upperRotation, 0.35)
    }
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
export function blendContinuousLocalQuaternion(
  saved: THREE.Quaternion,
  target: THREE.Quaternion,
  weight: number,
  prevDelta?: THREE.Quaternion,
  deltaScratch = new THREE.Quaternion(),
  axisScratch = new THREE.Vector3(),
): THREE.Quaternion {
  deltaScratch.copy(saved).invert().multiply(target).normalize()
  if (prevDelta ? deltaScratch.dot(prevDelta) < 0 : deltaScratch.w < 0) {
    deltaScratch.set(-deltaScratch.x, -deltaScratch.y, -deltaScratch.z, -deltaScratch.w)
  }
  prevDelta?.copy(deltaScratch)
  if (weight <= 0) target.copy(saved)
  else if (weight < 1) {
    axisScratch.set(deltaScratch.x, deltaScratch.y, deltaScratch.z)
    const sinHalf = axisScratch.length()
    if (sinHalf > 1e-8) {
      const angle = 2 * Math.atan2(sinHalf, deltaScratch.w)
      axisScratch.multiplyScalar(1 / sinHalf)
      target.setFromAxisAngle(axisScratch, angle * weight).premultiply(saved).normalize()
    } else target.copy(saved)
  }
  return deltaScratch
}

export class CharacterEquipmentPose {
  private continuousAxeClearanceYaw: number | undefined
  private continuousAxeLeftElapsed: number | undefined
  private hasContinuousAxeLeftOffset = false
  private readonly continuousAxeLeftOffset = [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()]
  private hasContinuousRelaxedDelta = false
  private readonly continuousRelaxedDelta = [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()]
  private readonly continuousAxeLeftPole: ArmBendContinuity = {
    ready: false, axis: new THREE.Vector3(), bend: new THREE.Vector3(), twist: 0,
    upperReady: false, upperX: new THREE.Vector3(), upperY: new THREE.Vector3(), upperTransported: new THREE.Quaternion(), upperTwist: 0,
  }
  private readonly continuousAxePalm = {
    ready: false, source: new THREE.Quaternion(), shaft: new THREE.Vector3(),
    transported: new THREE.Quaternion(), result: new THREE.Quaternion(), twist: 0,
  }
  private readonly fittedCloth?: FittedHumanoidCloth
  private readonly mountedSkirt?: SelectedMountedSkirt
  private readonly saved: Array<{ node: THREE.Object3D, q: THREE.Quaternion }> = []
  private applied = false
  private readonly left: ArmSolver
  private readonly axeRight: ArmSolver
  private readonly swordCarry: THREE.Quaternion
  private readonly axeCarry: THREE.Quaternion
  private readonly axe1Carry: THREE.Quaternion
  private readonly carrySaved = [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()]
  private readonly carryBones: THREE.Object3D[]
  private readonly shieldL: THREE.Quaternion
  private readonly shieldBody: THREE.Object3D
  private readonly shieldBindInverse = new THREE.Matrix4()
  private readonly shieldBodyDelta = new THREE.Matrix4()
  private readonly shieldBodyRotation = new THREE.Quaternion()
  private readonly shieldHandRotation = new THREE.Quaternion()
  private readonly target = new THREE.Vector3()
  private readonly attackAxis = new THREE.Vector3()
  private readonly attackRotation = new THREE.Quaternion()
  private readonly boneWorld = new THREE.Quaternion()
  private readonly parentInverse = new THREE.Quaternion()
  private readonly handWorld = new THREE.Quaternion()
  private readonly rootWorld = new THREE.Quaternion()
  private readonly axeGripInHand: THREE.Matrix4
  private readonly axeLeftPalmFrame: THREE.Quaternion
  private readonly axeLeftPalmInverse: THREE.Quaternion
  private readonly supportPalm = new THREE.Quaternion()
  private hasSupportPalm = false
  private readonly axeMatrix = new THREE.Matrix4()
  private readonly axeInverseRoot = new THREE.Matrix4()
  private readonly axeRightGrip = new THREE.Vector3()
  private readonly axeLeftOffset = new THREE.Vector3()
  private readonly axeWristOffset = new THREE.Vector3()
  private readonly axeShoulder = new THREE.Vector3()
  private readonly axeReach = new THREE.Vector3()
  private readonly axeRightRotation = new THREE.Quaternion()
  private readonly axeSavedLeft = [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()]
  private readonly axeLeftBones: THREE.Object3D[]
  private readonly hipsY: number
  private readonly seatedHips: THREE.Object3D
  private readonly seatedSpine: THREE.Object3D | undefined
  private readonly seatedTorso: THREE.Object3D[]
  private readonly hipsBindPosition: THREE.Vector3
  private readonly hipsSamplePosition = new THREE.Vector3()
  private readonly seatedRotation = new THREE.Quaternion()
  private readonly bowSpine: THREE.Object3D | undefined
  private readonly bowHipsWorld = new THREE.Quaternion()
  private readonly bowSpineWorld = new THREE.Quaternion()
  private readonly bowChestWorld = new THREE.Quaternion()
  private readonly bowHalfTurnInverse = new THREE.Quaternion()

  private readonly mountedSwordShaftLocal?: THREE.Vector3
  private readonly swordCarryDigits: Array<{ node: THREE.Object3D, targets: THREE.Quaternion[] }> = []
  private readonly swordCarryFrame?: EquipmentGripFrame
  private readonly swordCarryCenter = new THREE.Vector3()
  private readonly swordCarryNormal = new THREE.Vector3()
  private readonly swordCarryTarget = new THREE.Quaternion()
  private readonly swordEquipmentCorrection = new THREE.Matrix4()
  private hasSwordEquipmentCorrection = false

  /** Hand-local compensation follows later actor movement and saddle fitting. */
  get rightEquipmentHandCorrection(): THREE.Matrix4 | undefined {
    return this.hasSwordEquipmentCorrection ? this.swordEquipmentCorrection : undefined
  }

  private readonly morphs: Array<{ mesh: THREE.SkinnedMesh, right: number | undefined, left: number | undefined, shield: number | undefined }> = []

  constructor(private readonly root: THREE.Object3D, private readonly rig: CharacterRig, private readonly frames: EquipmentGripFrames, private readonly bakedActions: readonly string[] = [], private readonly bowFullBodyStance = false, private readonly selectedSource?: SelectedHumanoidSource, clothRig?: FittedHumanoidClothRig, private readonly relaxedLeftThumbForward = false, private readonly swordCarryGrips?: readonly SwordCarryGripProfile[]) {
    if (swordCarryGrips?.length && frames.lanceRight.modelRotationLocal) this.mountedSwordShaftLocal = new THREE.Vector3(0, 1, 0)
      .applyQuaternion(new THREE.Quaternion().fromArray(frames.lanceRight.modelRotationLocal))
    if (swordCarryGrips?.length && rig.swordGripFrame) {
      this.swordCarryFrame = { ...frames.lanceRight, ...rig.swordGripFrame, gripCenterLocal: [...rig.swordGripFrame.gripCenterLocal] }
      for (const name of Object.keys(swordCarryGrips[0].digits)) {
        const node = root.getObjectByName(name)
        if (node && /^(thumb|index|middle|ring|pinky)_0[123]_r$/.test(name)) this.swordCarryDigits.push({ node,
          targets: swordCarryGrips.map(profile => new THREE.Quaternion().fromArray(profile.digits[name])),
        })
      }
    }
    if (clothRig) this.fittedCloth = new FittedHumanoidCloth(root, clothRig)
    if (selectedSource?.rig === 'steppe37') this.mountedSkirt = new SelectedMountedSkirt(root)
    if (selectedSource?.rig === 'varangian63') this.mountedSkirt = new SelectedMountedSkirt(root, 'skirt_front_center')
    this.left = new ArmSolver(root, rig.left, 1)
    this.axeRight = new ArmSolver(root, rig.right, -1)
    this.axeLeftBones = [rig.left.shoulder, rig.left.elbow, rig.left.wrist]
    const hand = (frame: EquipmentGripFrame) => new THREE.Quaternion().setFromRotationMatrix(swordHandMatrix(frame)).invert()
    const forwardCarry = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0)))
    this.swordCarry = forwardCarry.clone().multiply(hand(frames.lanceRight))
    const axeHand = selectedSource?.rig === 'roman54' ? naturalAxeHandMatrix(frames.lanceRight)
      : swordHandMatrix(frames.lanceRight).multiply(new THREE.Matrix4().makeRotationX(.45))
    this.axeCarry = forwardCarry.clone().multiply(new THREE.Quaternion().setFromRotationMatrix(axeHand).invert())
    this.carryBones = [rig.right.shoulder, rig.right.elbow, rig.right.wrist]
    this.axe1Carry = this.axeCarry
    this.shieldL = new THREE.Quaternion().setFromRotationMatrix(equipmentWeaponFrame('shield')).multiply(hand(frames.shieldLeft))
    // The existing axe visual tilts 0.45 radians about its grip. Attacks use
    // the foot attachment on both foot and horse; never edit the axe model.
    this.axeGripInHand = swordHandMatrix(frames.lanceRight).multiply(new THREE.Matrix4().makeRotationX(.45))
    this.axeLeftPalmFrame = new THREE.Quaternion().setFromRotationMatrix(swordHandMatrix(frames.lanceLeft))
    this.axeLeftPalmInverse = this.axeLeftPalmFrame.clone().invert()
    root.updateMatrixWorld(true)
    this.hipsY = root.worldToLocal((rig.pelvis?.parent ?? rig.rightLeg.hip).getWorldPosition(new THREE.Vector3())).y
    // Carry the guard in the animated chest frame, including torso translation
    // and lean. Capturing the bind basis also handles different LOD bone axes.
    this.shieldBody = rig.upperChest ?? rig.left.shoulder.parent!
    this.shieldBindInverse.copy(this.shieldBody.matrixWorld).invert().multiply(root.matrixWorld)
    this.seatedHips = rig.pelvis?.parent ?? rig.rightLeg.hip.parent!
    this.seatedSpine = selectedSource ? root.getObjectByName('spine') : rig.upperChest ?? root.getObjectByName('spine')
    this.seatedTorso = selectedSource
      ? ['spine', 'chest', 'upper_chest'].map(name => root.getObjectByName(name)).filter((node): node is THREE.Object3D => !!node)
      : []
    this.bowSpine = root.getObjectByName('spine')
    this.hipsBindPosition = this.seatedHips.position.clone()
    const nodes = [rig.right.shoulder, rig.right.elbow, rig.right.wrist, rig.left.shoulder, rig.left.elbow, rig.left.wrist,
      rig.leftLeg.hip, rig.leftLeg.knee, rig.leftLeg.ankle, rig.rightLeg.hip, rig.rightLeg.knee, rig.rightLeg.ankle]
    nodes.push(this.seatedHips)
    nodes.push(...this.swordCarryDigits.map(digit => digit.node))
    if (this.mountedSkirt) nodes.push(...this.mountedSkirt.nodes)
    if (this.fittedCloth) nodes.push(...this.fittedCloth.nodes)
    if (this.seatedSpine) nodes.push(this.seatedSpine)
    nodes.push(...this.seatedTorso.filter(node => node !== this.seatedSpine))
    if (this.bowFullBodyStance && this.bowSpine && this.bowSpine !== this.seatedSpine) nodes.push(this.bowSpine)
    for (const node of nodes) this.saved.push({ node, q: node.quaternion.clone() })
    root.traverse(o => { if (o instanceof THREE.SkinnedMesh) this.morphs.push({ mesh: o, right: o.morphTargetDictionary?.lanceRight, left: o.morphTargetDictionary?.lanceLeft, shield: o.morphTargetDictionary?.shieldLeft }) })
  }

  restore(): void {
    this.hasSwordEquipmentCorrection = false
    if (!this.applied) return
    for (const s of this.saved) s.node.quaternion.copy(s.q)
    this.seatedHips.position.copy(this.hipsSamplePosition)
    this.applied = false
  }

  stop(): void {
    this.restore()
    this.continuousAxeClearanceYaw = undefined
    this.continuousAxeLeftElapsed = undefined
    this.hasContinuousAxeLeftOffset = false
    this.hasContinuousRelaxedDelta = false
    this.continuousAxeLeftPole.ready = this.continuousAxeLeftPole.upperReady = this.continuousAxePalm.ready = false
    for (const { mesh, right, left, shield } of this.morphs) {
      for (const index of [right, left, shield]) if (index !== undefined) mesh.morphTargetInfluences![index] = 0
    }
  }

  private blendContinuousLocal(saved: THREE.Quaternion, target: THREE.Quaternion, weight: number, prevDelta?: THREE.Quaternion): void {
    blendContinuousLocalQuaternion(saved, target, weight, prevDelta, this.boneWorld, this.attackAxis)
  }

  private rotateArm(node: THREE.Object3D, angle: number): void {
    node.getWorldQuaternion(this.boneWorld)
    node.parent!.getWorldQuaternion(this.parentInverse).invert()
    this.attackRotation.setFromAxisAngle(this.attackAxis, angle)
    node.quaternion.copy(this.parentInverse).multiply(this.attackRotation).multiply(this.boneWorld)
    node.updateWorldMatrix(false, true)
  }

  /** Borrowed root-space physical palm frame, shared by the authority's LODs. */
  get axeSupportPalm(): THREE.Quaternion | undefined { return this.hasSupportPalm ? this.supportPalm : undefined }

  apply(state: EquipmentPoseState, authorityPalm?: THREE.Quaternion): void {
    this.hasSupportPalm = false
    this.hasSwordEquipmentCorrection = false
    for (const s of this.saved) s.q.copy(s.node.quaternion)
    this.hipsSamplePosition.copy(this.seatedHips.position)
    this.applied = true
    const live = state.alive && state.action !== 'death'
    if (!live || !state.continuousAxeAction || state.action !== 'axeAttack2H' || !state.mounted || state.mountKind !== 'CORGI' || state.elapsed <= 0) this.continuousAxeClearanceYaw = undefined
    const continuousLeftAcquisition = live && state.continuousAxeAction && !state.shield
      && state.action === 'axeAttack2H' && !this.bakedActions.includes(state.action)
    if (!continuousLeftAcquisition || state.elapsed <= 0 || (this.continuousAxeLeftElapsed !== undefined && state.elapsed < this.continuousAxeLeftElapsed)) {
      this.hasContinuousAxeLeftOffset = false
      this.hasContinuousRelaxedDelta = false
      this.continuousAxeLeftPole.ready = this.continuousAxeLeftPole.upperReady = this.continuousAxePalm.ready = false
    } else if (this.continuousAxeLeftElapsed !== undefined && this.continuousAxeLeftElapsed < .42 && state.elapsed >= .42) {
      this.hasContinuousAxeLeftOffset = false
    }
    this.continuousAxeLeftElapsed = continuousLeftAcquisition ? state.elapsed : undefined
    const selectedMountedBow = live && state.mounted && !!this.selectedSource
      && (state.action === 'bowAim' || state.action === 'bowRelease' || (state.action === 'idle' && !!state.sampledBowPose))
    if (live && this.bowFullBodyStance && (state.moving || state.mounted)
      && (state.action === 'bowAim' || state.action === 'bowRelease') && this.bowSpine && this.seatedSpine) {
      // Standing keeps the authored whole-body side-on stance. Moving/seated
      // legs face their travel direction; transfer the same turn above the
      // pelvis without re-solving either arm or rotating the weapon grip.
      this.seatedHips.getWorldQuaternion(this.bowHipsWorld)
      this.bowSpine.getWorldQuaternion(this.bowSpineWorld)
      this.seatedSpine.getWorldQuaternion(this.bowChestWorld)
      setRigRotation(this.seatedHips, 0, 0, 0)
      this.seatedHips.getWorldQuaternion(this.parentInverse).invert()
      this.bowHipsWorld.multiply(this.parentInverse).invert()
      this.bowHalfTurnInverse.identity().slerp(this.bowHipsWorld, .5)
      this.bowSpineWorld.premultiply(this.bowHalfTurnInverse)
      this.bowSpine.parent!.getWorldQuaternion(this.parentInverse).invert()
      this.bowSpine.quaternion.copy(this.parentInverse).multiply(this.bowSpineWorld)
      this.bowSpine.updateWorldMatrix(false, true)
      this.seatedSpine.parent!.getWorldQuaternion(this.parentInverse).invert()
      this.seatedSpine.quaternion.copy(this.parentInverse).multiply(this.bowChestWorld)
    }
    if (live && state.mounted && (this.selectedSource || state.mountKind === 'CORGI' || state.mountKind === 'xongkoro') && this.seatedSpine) {
      // Selected foot clips turn the pelvis by over 100 degrees. Mask the
      // seated pelvis; a sword swing may carry at most 45 degrees of its yaw
      // through the whole torso, never through a single lumbar joint.
      if (!this.selectedSource) this.seatedSpine.getWorldQuaternion(this.seatedRotation)
      else this.seatedHips.getWorldQuaternion(this.seatedRotation)
      setRigRotation(this.seatedHips, 0, 0, 0)
      this.seatedHips.position.x = this.hipsBindPosition.x
      this.seatedHips.position.z = this.hipsBindPosition.z
      if (state.mountKind === 'xongkoro') this.seatedHips.position.y = this.hipsBindPosition.y
      if (!this.selectedSource) {
        this.seatedSpine.parent!.getWorldQuaternion(this.parentInverse).invert()
        this.seatedSpine.quaternion.copy(this.parentInverse).multiply(this.seatedRotation)
      } else if (selectedMountedBow && this.seatedTorso.length) {
        // Preserve the sampled bow's world-facing direction when seating removes
        // the source pelvis turn. Transfer that measured world-space delta above
        // the saddle, split across the torso rather than twisting one lumbar joint.
        // Arms, hand attachment, actor heading and projectile aim stay untouched.
        this.seatedHips.getWorldQuaternion(this.parentInverse).invert()
        this.seatedRotation.multiply(this.parentInverse).normalize()
        if (this.seatedRotation.w < 0) this.seatedRotation.set(-this.seatedRotation.x, -this.seatedRotation.y, -this.seatedRotation.z, -this.seatedRotation.w)
        this.attackAxis.set(this.seatedRotation.x, this.seatedRotation.y, this.seatedRotation.z)
        if (this.attackAxis.lengthSq() > 1e-12) {
          const angle = 2 * Math.acos(THREE.MathUtils.clamp(this.seatedRotation.w, -1, 1))
          this.attackAxis.normalize()
          for (const joint of this.seatedTorso) this.rotateArm(joint, angle / this.seatedTorso.length)
        }
      } else if (state.action === 'axeAttack2H' && this.seatedTorso.length) {
        // Seating removes the foot clip's pelvis rotation. Carry that rotation
        // through the torso so the authored right-high / left-low axe arc keeps
        // its world direction, with the saddle and legs remaining planted.
        this.seatedHips.getWorldQuaternion(this.parentInverse).invert()
        this.seatedRotation.multiply(this.parentInverse).normalize()
        if (this.seatedRotation.w < 0) this.seatedRotation.set(-this.seatedRotation.x, -this.seatedRotation.y, -this.seatedRotation.z, -this.seatedRotation.w)
        this.attackAxis.set(this.seatedRotation.x, this.seatedRotation.y, this.seatedRotation.z)
        const angle = 2 * Math.acos(THREE.MathUtils.clamp(this.seatedRotation.w, -1, 1))
        const blend = smooth(state.elapsed / .08) * (1 - smooth((state.elapsed - .42) / .06))
        if (this.attackAxis.lengthSq() > 1e-12) {
          this.attackAxis.normalize()
          for (const joint of this.seatedTorso) this.rotateArm(joint, angle * blend / this.seatedTorso.length)
        }
      } else if (state.action === 'swordSlash' && this.seatedTorso.length) {
        this.seatedHips.getWorldQuaternion(this.parentInverse).invert()
        this.seatedRotation.multiply(this.parentInverse)
        this.root.getWorldQuaternion(this.rootWorld)
        this.parentInverse.copy(this.rootWorld).invert()
        this.seatedRotation.premultiply(this.parentInverse).multiply(this.rootWorld)
        const yaw = THREE.MathUtils.euclideanModulo(2 * Math.atan2(this.seatedRotation.y, this.seatedRotation.w) + Math.PI, 2 * Math.PI) - Math.PI
        const { windup, active, recovery } = COMBAT_ANIMATION_PROFILES.swordSlash
        const release = 1 - smooth((state.elapsed - windup - active) / recovery)
        const turn = THREE.MathUtils.clamp(yaw, -Math.PI / 4, Math.PI / 4) * release
        this.attackAxis.set(0, 1, 0).applyQuaternion(this.rootWorld)
        for (const joint of this.seatedTorso) this.rotateArm(joint, turn / this.seatedTorso.length)
      }
    }
    if (live && state.mounted) applyCharacterMountedPose(this.rig, true, state.mountKind)
    if (live && state.mounted) this.mountedSkirt?.apply()
    if (live && state.mounted && state.mountKind === 'xongkoro' && this.seatedSpine && state.flightLean) {
      // Flight still leans the lower torso, but must not tilt a selected bow's
      // already aligned shoulder/hand frame away from the aim during sprint.
      const bowChest = selectedMountedBow ? this.seatedTorso[this.seatedTorso.length - 1] : undefined
      bowChest?.getWorldQuaternion(this.bowChestWorld)
      this.seatedRotation.setFromAxisAngle(this.attackAxis.set(1, 0, 0), THREE.MathUtils.clamp(state.flightLean, 0, 1) * XONGKORO_VISUAL.sprintRiderLean)
      this.seatedSpine.quaternion.multiply(this.seatedRotation)
      if (bowChest) {
        bowChest.parent!.getWorldQuaternion(this.parentInverse).invert()
        bowChest.quaternion.copy(this.parentInverse).multiply(this.bowChestWorld)
      }
    }
    // Fitted free hands keep their sampled wrist and elbow plane. Rotate the
    // anatomical thumb web toward +Z, distributing pronation into the forearm.
    // The mixer weight releases this correction before bow/2H contacts take over.
    const relaxedHandWeight = state.relaxedHandWeight ?? 0
    if (live && this.relaxedLeftThumbForward && !state.shield && !state.lance && !state.sampledBowPose
      && !this.bakedActions.includes(state.action) && state.action !== 'greatswordSlash' && relaxedHandWeight > 0) {
      this.root.updateWorldMatrix(true, true)
      this.root.getWorldQuaternion(this.rootWorld).invert()
      this.rig.left.wrist.getWorldQuaternion(this.handWorld).premultiply(this.rootWorld)
      this.attackAxis.fromArray(this.frames.lanceLeft.fingerDirection).applyQuaternion(this.handWorld).normalize()
      this.target.set(0, 0, 1).addScaledVector(this.attackAxis, -this.attackAxis.z)
      if (this.target.lengthSq() > 1e-6) {
        this.target.normalize()
        this.axeReach.fromArray(this.frames.lanceLeft.gripAxisLocal).applyQuaternion(this.handWorld).normalize()
        this.attackRotation.setFromUnitVectors(this.axeReach, this.target)
        this.handWorld.premultiply(this.attackRotation)
        this.target.fromArray(this.frames.lanceLeft.gripCenterLocal).applyQuaternion(this.handWorld)
        this.rig.left.wrist.getWorldPosition(this.axeReach)
        this.root.worldToLocal(this.axeReach)
        this.target.add(this.axeReach)
        this.axeLeftBones.forEach((bone, index) => this.axeSavedLeft[index].copy(bone.quaternion))
        this.left.solve(this.target, this.handWorld, this.frames.lanceLeft, undefined, true, true)
        if (continuousLeftAcquisition) {
          for (let i = 0; i < 3; i++) {
            const prev = this.hasContinuousRelaxedDelta ? this.continuousRelaxedDelta[i] : undefined
            this.blendContinuousLocal(this.axeSavedLeft[i], this.axeLeftBones[i].quaternion, relaxedHandWeight, prev)
            if (!prev) this.continuousRelaxedDelta[i].copy(this.boneWorld)
          }
          this.hasContinuousRelaxedDelta = true
        } else this.axeLeftBones.forEach((bone, index) => bone.quaternion.copy(this.axeSavedLeft[index].slerp(bone.quaternion, relaxedHandWeight)))
      }
    }
    // Free Roman wrist: mirror the sampled opposite hand in character space,
    // distribute pronation through the forearm and retain the sampled elbow.
    // Trimmed 2H releases this source-owned hand only during recovery.
    const authoredRecovery = axeRecoveryWeight(state.action, state.elapsed, state.continuousAxeAction)
    if (live && this.selectedSource?.rig === 'roman54' && !state.shield && !state.sampledBowPose && (state.action === 'idle' || authoredRecovery > 0)) {
      this.root.updateWorldMatrix(true, true)
      this.root.getWorldQuaternion(this.rootWorld).invert()
      this.rig.right.wrist.getWorldQuaternion(this.handWorld).premultiply(this.rootWorld)
      this.handWorld.set(this.handWorld.x, -this.handWorld.y, -this.handWorld.z, this.handWorld.w)
      this.target.fromArray(this.frames.lanceLeft.gripCenterLocal).applyQuaternion(this.handWorld)
      this.rig.left.wrist.getWorldPosition(this.axeReach)
      this.root.worldToLocal(this.axeReach)
      this.target.add(this.axeReach)
      if (authoredRecovery > 0) for (let i = 0; i < 3; i++) this.axeSavedLeft[i].copy(this.axeLeftBones[i].quaternion)
      this.left.solve(this.target, this.handWorld, this.frames.lanceLeft, undefined, true, true)
      if (authoredRecovery > 0) for (let i = 0; i < 3; i++) this.axeLeftBones[i].quaternion.copy(this.axeSavedLeft[i].slerp(this.axeLeftBones[i].quaternion, authoredRecovery))
    }
    // Shared sword/axe foot carry: +Y shaft points toward gameplay +Z and the axe's
    // +X cutting edge points down. Solve the arm around its existing palm,
    // preserving the fixed weapon attachment and source finger animation.
    const carryBlend = state.action === 'idle' ? 1 : authoredRecovery > 0 ? authoredRecovery : state.action === 'axeAttack1H' || state.action === 'swordSlash'
      ? 1 - smooth(state.elapsed / .08) + smooth((state.elapsed - .42) / .06) : 0
    if (live && !state.mounted && !state.lance && !state.sampledBowPose && carryBlend > 0
      && state.carryWeapon && (this.selectedSource?.rig === 'roman54' || state.carryWeapon === 'axe')) {
      // localToWorld below refreshes the wrist's ancestor chain. No other
      // subtree is read before the arm solve and the final pose refresh.
      this.target.fromArray(this.frames.lanceRight.gripCenterLocal)
      this.rig.right.wrist.localToWorld(this.target); this.root.worldToLocal(this.target)
      this.handWorld.copy(state.carryWeapon === 'axe' ? state.action === 'axeAttack1H' ? this.axe1Carry : this.axeCarry : this.swordCarry)
      this.carryBones.forEach((bone, index) => this.carrySaved[index].copy(bone.quaternion))
      this.axeRight.solve(this.target, this.handWorld, this.frames.lanceRight, undefined, true, true)
      this.carryBones.forEach((bone, index) => bone.quaternion.copy(this.carrySaved[index].slerp(bone.quaternion, carryBlend)))
    }
    // Source 2H cutting edges strike right of +Z: ordinary Viking 0.609802
    // radians at source 1.058333s; Varangian 0.748852 at 1.066667s. These
    // are measured hips-to-mock-edge bearings, not collision tolerances.
    // Turn the whole authored pose toward gameplay-forward, never the weapon
    // alone. Both palms and their socket retain the delivered relative motion.
    if (live && (this.selectedSource?.rig === 'ordinary22' || this.selectedSource?.rig === 'varangian63') && state.action === 'axeAttack2H') {
      const facing = this.selectedSource.rig === 'ordinary22' ? -.6098016643687594 : -.7488516894154653
      const weight = smooth(state.elapsed / .08) * (1 - smooth((state.elapsed - .38) / .1))
      this.root.updateWorldMatrix(true, true)
      this.root.getWorldQuaternion(this.rootWorld)
      this.attackAxis.set(0, 1, 0).applyQuaternion(this.rootWorld)
      if (state.mounted && this.seatedTorso.length) {
        for (const joint of this.seatedTorso) this.rotateArm(joint, facing * weight / this.seatedTorso.length)
      } else this.rotateArm(this.seatedHips, facing * weight)
    }
    // Corgi thighs sit wider and higher than the horse's. Carry the right hand
    // forward and outside that thigh, retaining the sampled wrist orientation
    // and fixed weapon grip. This is shared by mounted melee weapons.
    if (live && state.mounted && state.mountKind === 'CORGI'
      && !this.selectedSource
      && state.action !== 'bowAim' && state.action !== 'bowRelease' && state.action !== 'pilumThrow') {
      this.root.updateWorldMatrix(true, true)
      this.rig.right.wrist.getWorldQuaternion(this.handWorld)
      this.root.getWorldQuaternion(this.rootWorld)
      this.attackAxis.set(0, 0, 1).applyQuaternion(this.rootWorld)
      this.rotateArm(this.rig.right.shoulder, -0.60)
      this.attackAxis.set(1, 0, 0).applyQuaternion(this.rootWorld)
      let carry = 1
      if (state.action === 'axeAttack1H') carry = 1 - smooth(state.elapsed / .08) + smooth((state.elapsed - .38) / .1)
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
    if (live && state.mounted && (state.action === 'axeAttack1H' || state.action === 'axeAttack2H')) {
      // Adapt the source arm as a whole so its fixed palm/haft contact survives.
      const lift = smooth(state.elapsed / .06) * (1 - smooth((state.elapsed - .38) / .1))
      this.root.updateWorldMatrix(true, true)
      this.root.getWorldQuaternion(this.rootWorld)
      this.attackAxis.set(1, 0, 0).applyQuaternion(this.rootWorld)
      if (state.action === 'axeAttack1H') {
        // Raise during preparation, then descend through the original contact
        // time toward infantry height. A permanent upward lift missed targets.
        const swing = smooth((state.elapsed - .06) / (AXE_HIT_TIMES.axeAttack1H + .04 - .06))
        const weight = smooth(state.elapsed / .06) * (1 - smooth((state.elapsed - .32) / .16))
        this.rotateArm(this.rig.right.shoulder, (-.65 + .85 * swing) * weight)
        this.attackAxis.set(0, 1, 0).applyQuaternion(this.rootWorld)
        this.rotateArm(this.rig.right.shoulder, -.55 * weight)
      } else if (!this.selectedSource) this.rotateArm(this.rig.right.shoulder, -.35 * lift)
      if (!this.selectedSource && state.mountKind === 'CORGI' && state.action === 'axeAttack2H') {
        // Keep the descending two-handed arc on the rider's right flank;
        // the Corgi's ears stand above the horse-neck clearance envelope.
        this.axeInverseRoot.copy(this.root.matrixWorld).invert()
        this.axeMatrix.copy(this.axeInverseRoot).multiply(this.rig.right.wrist.matrixWorld).multiply(this.axeGripInHand)
        this.target.set(0, 1, 0).transformDirection(this.axeMatrix)
        const horizontal = Math.hypot(this.target.x, this.target.z)
        this.axeReach.set(-Math.sin(.9) * horizontal, this.target.y, Math.cos(.9) * horizontal)
        const clearance = smooth(state.elapsed / .08) * (1 - smooth((state.elapsed - .38) / .1))
        if (state.continuousAxeAction) {
          // The target keeps the same height and horizontal length. A root-up
          // yaw reaches it without a near-antipodal 3D cross-product axis flip.
          let yaw = -.9 - Math.atan2(this.target.x, this.target.z)
          yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw))
          if (this.continuousAxeClearanceYaw !== undefined) yaw = this.continuousAxeClearanceYaw + Math.atan2(Math.sin(yaw - this.continuousAxeClearanceYaw), Math.cos(yaw - this.continuousAxeClearanceYaw))
          this.continuousAxeClearanceYaw = clearance > 0 ? yaw : undefined
          this.attackAxis.set(0, 1, 0).applyQuaternion(this.rootWorld)
          this.rotateArm(this.rig.right.shoulder, yaw * clearance)
        } else {
          const angle = this.target.angleTo(this.axeReach)
          this.attackAxis.crossVectors(this.target, this.axeReach).normalize().applyQuaternion(this.rootWorld)
          if (angle > 1e-6) this.rotateArm(this.rig.right.shoulder, angle * clearance)
        }
      }
    }
    // Keep the existing attack/equipment grip solve; only idle/moving gets raised stance.
    if (live && state.shield) {
      // The guard delta only reads the chest and root. Refresh that chain;
      // ArmSolver refreshes the arm, and the final refresh publishes all bones.
      this.shieldBody.updateWorldMatrix(true, false)
      this.shieldBodyDelta.copy(this.root.matrixWorld).invert().multiply(this.shieldBody.matrixWorld).multiply(this.shieldBindInverse)
      this.shieldBodyRotation.setFromRotationMatrix(this.shieldBodyDelta)
      if (state.shieldRaised && state.action === 'idle') {
        this.target.set(.12, this.hipsY + .38, this.selectedSource?.rig === 'varangian63' ? .52 : .46).applyMatrix4(this.shieldBodyDelta)
        this.shieldHandRotation.copy(this.shieldBodyRotation).multiply(this.shieldL)
        this.left.solve(this.target, this.shieldHandRotation, this.frames.shieldLeft, this.shieldBodyRotation)
      } else if (state.mounted && state.mountKind === 'CORGI') {
        // Hold the tall scutum outside the saddle during torso rotation.
        // The shield remains attached to the same palm grip.
        this.target.set(.55, this.hipsY + .26, .22)
        if (this.selectedSource) {
          this.target.applyMatrix4(this.shieldBodyDelta)
          this.shieldHandRotation.copy(this.shieldBodyRotation).multiply(this.shieldL)
          this.left.solve(this.target, this.shieldHandRotation, this.frames.shieldLeft, this.shieldBodyRotation)
        } else this.left.solve(this.target, this.shieldL, this.frames.shieldLeft)
      } else {
        const varangian = this.selectedSource?.rig === 'varangian63'
        this.target.set(SHIELD_POSE.side + (varangian ? .04 : 0),
          this.hipsY + SHIELD_POSE.height,
          SHIELD_POSE.forward + (varangian ? .10 : 0)).applyMatrix4(this.shieldBodyDelta)
        this.shieldHandRotation.copy(this.shieldBodyRotation).multiply(this.shieldL)
        this.left.solve(this.target, this.shieldHandRotation, this.frames.shieldLeft, this.shieldBodyRotation)
      }
    }
    // Baked asset-specific contacts must not receive the generic axe-haft solve.
    const twoHandedAxe = live && !state.shield && state.action === 'axeAttack2H' && !this.bakedActions.includes(state.action)
    if (twoHandedAxe) {
      // Source 2H has the left hand below the right hand. Constrain its grasp
      // to the actual haft (5cm above the butt), retaining the source torso,
      // right arm and weapon arc. Blend acquisition/release, not the strike.
      const blend = smooth(state.elapsed / .08) * (1 - smooth((state.elapsed - .42) / .06))
      const blendRight = state.continuousAxeAction && state.elapsed >= .42 && blend < 1
      for (let i = 0; i < 3; i++) this.axeSavedLeft[i].copy(this.axeLeftBones[i].quaternion)
      if (blendRight) for (let i = 0; i < 3; i++) this.carrySaved[i].copy(this.carryBones[i].quaternion)
      this.root.updateWorldMatrix(true, true)
      this.axeInverseRoot.copy(this.root.matrixWorld).invert()
      this.axeMatrix.copy(this.axeInverseRoot).multiply(this.rig.right.wrist.matrixWorld).multiply(this.axeGripInHand)
      this.axeRightGrip.setFromMatrixPosition(this.axeMatrix)
      this.axeLeftOffset.set(0, -.1, 0).transformDirection(this.axeMatrix).multiplyScalar(.1)
      this.root.getWorldQuaternion(this.rootWorld).invert()
      if (authorityPalm) this.handWorld.copy(authorityPalm).multiply(this.axeLeftPalmInverse)
      else {
        this.rig.left.wrist.getWorldQuaternion(this.handWorld).premultiply(this.rootWorld)
        this.attackAxis.fromArray(this.frames.lanceLeft.gripAxisLocal).applyQuaternion(this.handWorld).normalize()
        this.target.set(0, 1, 0).transformDirection(this.axeMatrix)
        if (continuousLeftAcquisition) {
          const palm = this.continuousAxePalm, alignment = this.attackAxis.dot(this.target)
          // Repeated update(0) is exact, but changed inputs at the same action
          // time (for example a new mount/LOD) still get aligned to their shaft.
          if (palm.ready && palm.source.equals(this.handWorld) && palm.shaft.equals(this.target)) this.handWorld.copy(palm.result)
          else {
            this.boneWorld.copy(this.handWorld)
            this.parentInverse.copy(this.handWorld).premultiply(this.attackRotation.setFromUnitVectors(this.attackAxis, this.target))
            if (!palm.ready || (alignment >= -.85 && state.elapsed < .42)) {
              this.handWorld.copy(this.parentInverse)
              palm.transported.copy(this.handWorld); palm.twist = 0
            } else {
              // Near antiparallel axes or during release, preserve source angular
              // increments in a transported palm and align the grasp axis to the haft.
              this.attackRotation.copy(palm.source).invert().premultiply(this.boneWorld)
              palm.transported.premultiply(this.attackRotation)
              this.attackAxis.fromArray(this.frames.lanceLeft.gripAxisLocal).applyQuaternion(palm.transported).normalize()
              palm.transported.premultiply(this.attackRotation.setFromUnitVectors(this.attackAxis, this.target)).normalize()
              if (state.elapsed >= .42) {
                this.handWorld.copy(palm.transported)
                palm.twist = 0
              } else {
                this.attackRotation.copy(palm.transported).invert().premultiply(this.parentInverse).normalize()
                const twist = 2 * Math.atan2(this.attackRotation.x * this.target.x + this.attackRotation.y * this.target.y + this.attackRotation.z * this.target.z, this.attackRotation.w)
                palm.twist += Math.atan2(Math.sin(twist - palm.twist), Math.cos(twist - palm.twist))
                this.handWorld.copy(palm.transported).premultiply(this.attackRotation.setFromAxisAngle(this.target, palm.twist * smooth((alignment + 1) / .15))).normalize()
              }
            }
            palm.source.copy(this.boneWorld); palm.shaft.copy(this.target); palm.result.copy(this.handWorld); palm.ready = true
          }
        } else this.handWorld.premultiply(this.attackRotation.setFromUnitVectors(this.attackAxis, this.target))
      }
      this.supportPalm.copy(this.handWorld).multiply(this.axeLeftPalmFrame)
      this.hasSupportPalm = true
      this.rig.right.wrist.getWorldQuaternion(this.axeRightRotation).premultiply(this.rootWorld)
      // Different shoulder widths can put the retargeted grasp beyond the
      // opposite arm's reach. Project the shared haft into both reach spheres,
      // moving both hands together while retaining its authored orientation.
      for (let iteration = 0; iteration < 6; iteration++) {
        for (let side = 0; side < 2; side++) {
          const right = side === 0
          const limb = right ? this.rig.right : this.rig.left
          const frame = right ? this.frames.lanceRight : this.frames.lanceLeft
          const rotation = right ? this.axeRightRotation : this.handWorld
          limb.shoulder.getWorldPosition(this.axeShoulder).applyMatrix4(this.axeInverseRoot)
          this.axeWristOffset.fromArray(frame.gripCenterLocal).applyQuaternion(rotation)
          this.axeReach.copy(this.axeRightGrip).sub(this.axeWristOffset).sub(this.axeShoulder)
          if (!right) this.axeReach.add(this.axeLeftOffset)
          const distance = this.axeReach.length(), limit = limb.elbow.position.length() + limb.wrist.position.length() - .005
          if (distance > limit) this.axeRightGrip.addScaledVector(this.axeReach, (limit - distance) / distance)
        }
      }
      this.axeRight.solve(this.axeRightGrip, this.axeRightRotation, this.frames.lanceRight, undefined, true)
      if (blendRight) {
        // The shared reach projection moves the right hand too. Release both
        // arms together so the shortened clip does not drop that correction
        // abruptly at completion; acquisition and the strike remain unchanged.
        for (let i = 0; i < 3; i++) this.carryBones[i].quaternion.copy(this.carrySaved[i].slerp(this.carryBones[i].quaternion, blend))
        this.rig.right.shoulder.updateWorldMatrix(true, true)
        // Follow the actual, partially released haft rather than the fully
        // projected target. Carry its palm rotation into the support solve.
        this.rig.right.wrist.getWorldQuaternion(this.boneWorld).premultiply(this.rootWorld)
        this.attackRotation.copy(this.axeRightRotation).invert().premultiply(this.boneWorld)
        this.handWorld.premultiply(this.attackRotation)
        this.supportPalm.copy(this.handWorld).multiply(this.axeLeftPalmFrame)
        this.axeMatrix.copy(this.axeInverseRoot).multiply(this.rig.right.wrist.matrixWorld).multiply(this.axeGripInHand)
        this.axeRightGrip.setFromMatrixPosition(this.axeMatrix)
        this.axeLeftOffset.set(0, -.1, 0).transformDirection(this.axeMatrix).multiplyScalar(.1)
      }
      this.target.copy(this.axeRightGrip).add(this.axeLeftOffset)
      this.left.solve(this.target, this.handWorld, this.frames.lanceLeft, undefined, true, !!this.selectedSource, continuousLeftAcquisition ? this.continuousAxeLeftPole : undefined)
      if (continuousLeftAcquisition && state.elapsed < .08 && !state.mounted) {
        // Qsolve(t) * offset(0) starts at the sampled local pose. Decay this
        // fixed right-local offset, not a newly chosen sampled-to-IK short arc:
        // that moving arc can cross 180 degrees and flip during acquisition.
        if (!this.hasContinuousAxeLeftOffset) {
          for (let i = 0; i < 3; i++) {
            const offset = this.continuousAxeLeftOffset[i].copy(this.axeLeftBones[i].quaternion).invert().multiply(this.axeSavedLeft[i]).normalize()
            if (offset.w < 0) offset.set(-offset.x, -offset.y, -offset.z, -offset.w)
          }
          this.hasContinuousAxeLeftOffset = true
        }
        for (let i = 0; i < 3; i++) {
          this.attackRotation.identity().slerp(this.continuousAxeLeftOffset[i], 1 - smooth(state.elapsed / .08))
          if (state.elapsed <= 0) this.axeLeftBones[i].quaternion.copy(this.axeSavedLeft[i])
          else this.axeLeftBones[i].quaternion.multiply(this.attackRotation).normalize()
        }
        if (state.elapsed > 0) this.hasContinuousAxeLeftOffset = true
      } else if (continuousLeftAcquisition && (state.elapsed >= .42 || (state.mounted && state.elapsed < .08))) {
        for (let i = 0; i < 3; i++) {
          const prev = this.hasContinuousAxeLeftOffset ? this.continuousAxeLeftOffset[i] : undefined
          this.blendContinuousLocal(this.axeSavedLeft[i], this.axeLeftBones[i].quaternion, blend, prev)
          if (!prev) this.continuousAxeLeftOffset[i].copy(this.boneWorld)
        }
        this.hasContinuousAxeLeftOffset = true
      } else for (let i = 0; i < 3; i++) this.axeLeftBones[i].quaternion.copy(this.axeSavedLeft[i].slerp(this.axeLeftBones[i].quaternion, blend))
    }
    // Fitted sword grasp owns only the right arm/digits. Keep the sampled
    // source blade orientation, including attacks; shift only its grasp station.
    if (live && this.mountedSwordShaftLocal && this.swordCarryFrame && this.swordCarryGrips && this.rig.swordGripFrame && state.actualSword
      && !state.lance && !state.sampledBowPose && state.action !== 'pilumThrow') {
      const swordFrame = this.rig.swordGripFrame
      const section = state.swordGripSections?.[state.mounted ? 'mounted' : 'foot']
      const first = this.swordCarryGrips[0]
      let lower = 0, upper = 0, nearest = Infinity, second = Infinity
      const measuredPalm = Number.isFinite(section?.palmRadius) ? section!.palmRadius : first.palmRadius
      const measuredFinger = Number.isFinite(section?.fingerRadius) ? section!.fingerRadius : first.fingerRadius
      const radius = THREE.MathUtils.clamp(measuredPalm, .005, .06), fingerRadius = THREE.MathUtils.clamp(measuredFinger, .005, .06)
      for (let i = 0; i < this.swordCarryGrips.length; i++) {
        const profile = this.swordCarryGrips[i]
        const distance = (profile.palmRadius - radius) ** 2 + (profile.fingerRadius - fingerRadius) ** 2
        if (distance < nearest) { upper = lower; second = nearest; lower = i; nearest = distance }
        else if (distance < second) { upper = i; second = distance }
      }
      const blend = nearest < 1e-10 || !Number.isFinite(second) ? 0 : nearest / (nearest + second)
      const surfaceOffset = THREE.MathUtils.lerp(this.swordCarryGrips[lower].palmSurfaceOffset, this.swordCarryGrips[upper].palmSurfaceOffset, blend)
      this.root.updateWorldMatrix(true, true)
      this.swordEquipmentCorrection.copy(this.rig.right.wrist.matrixWorld)
      this.root.getWorldQuaternion(this.rootWorld).invert()
      this.rig.right.wrist.getWorldQuaternion(this.handWorld).premultiply(this.rootWorld)
      if (state.mounted) {
        this.attackAxis.fromArray(swordFrame.gripAxisLocal).applyQuaternion(this.handWorld).normalize()
        this.axeReach.copy(this.mountedSwordShaftLocal).applyQuaternion(this.handWorld).normalize()
        this.handWorld.premultiply(this.attackRotation.setFromUnitVectors(this.attackAxis, this.axeReach))
      }
      // Keep the sampled wrist station. Only the mounted shaft orientation
      // needs an arm solve; the equipment moves into the natural curled palm.
      if (state.mounted) {
        this.rig.right.wrist.getWorldPosition(this.target); this.root.worldToLocal(this.target)
        this.target.add(this.swordCarryCenter.fromArray(swordFrame.gripCenterLocal).applyQuaternion(this.handWorld))
        this.axeRight.solve(this.target, this.handWorld, this.swordCarryFrame, undefined, true, true)
      }
      const fingerOffset = THREE.MathUtils.lerp(this.swordCarryGrips[lower].palmFingerOffset, this.swordCarryGrips[upper].palmFingerOffset, blend)
      this.swordCarryCenter.fromArray(swordFrame.gripCenterLocal)
        .addScaledVector(this.swordCarryNormal.fromArray(swordFrame.palmNormalLocal), radius - swordFrame.gripRadius + surfaceOffset - (section?.palmOffset ?? 0))
        .addScaledVector(this.axeReach.fromArray(swordFrame.fingerDirection), fingerOffset - (section?.fingerOffset ?? 0))
      // Foot carry has no intervening bone writes; mounted solve already
      // synchronizes the wrist subtree before returning.
      this.swordCarryCenter.applyMatrix4(this.rig.right.wrist.matrixWorld)
      this.target.fromArray(swordFrame.gripCenterLocal).applyMatrix4(this.swordEquipmentCorrection)
      this.swordCarryCenter.sub(this.target)
      this.swordEquipmentCorrection.elements[12] += this.swordCarryCenter.x
      this.swordEquipmentCorrection.elements[13] += this.swordCarryCenter.y
      this.swordEquipmentCorrection.elements[14] += this.swordCarryCenter.z
      this.axeMatrix.copy(this.rig.right.wrist.matrixWorld).invert()
      this.swordEquipmentCorrection.premultiply(this.axeMatrix)
      this.hasSwordEquipmentCorrection = true
      for (const { node, targets } of this.swordCarryDigits) {
        this.swordCarryTarget.copy(targets[lower]).slerp(targets[upper], blend)
        node.quaternion.copy(this.swordCarryTarget)
      }
    }
    for (const morph of this.morphs) {
      const values = morph.mesh.morphTargetInfluences!
      if (morph.right !== undefined) values[morph.right] = 0
      if (morph.left !== undefined) values[morph.left] = twoHandedAxe ? smooth(state.elapsed / .08) * (1 - smooth((state.elapsed - .42) / .06)) : 0
      if (morph.shield !== undefined) values[morph.shield] = Number(live && state.shield)
    }
    if (live && state.mounted) this.fittedCloth?.applyMounted()
    this.root.updateWorldMatrix(true, true)
  }
}
