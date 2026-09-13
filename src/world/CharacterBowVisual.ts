import * as THREE from 'three'
import { polishWeaponMaterials } from './CharacterVisuals'
import { WeaponMeshFactory } from './WeaponMeshFactory'
import { BOW_STRING_CONTACT, BOW_ARROW_REST } from './BowDrawHand'
import {
  applyBowAttachment,
  updateBowOrientation,
  DEFAULT_BOW_GRIP_PROFILE,
} from './BowAttachmentContract'

const ARROW_LOCAL_FORWARD = new THREE.Vector3(0, 0, -1)
const ARROW_CENTER_FROM_NOCK = 0.45

export const positionArrowCenterFromNock = (
  target: THREE.Vector3,
  nock: THREE.Vector3,
  direction: THREE.Vector3,
): THREE.Vector3 => target.copy(nock).addScaledVector(direction, ARROW_CENTER_FROM_NOCK)

export const sampleBowBodyLocal = (
  target: THREE.Vector3,
  bottomTip: THREE.Vector3,
  topTip: THREE.Vector3,
  progress: number,
): THREE.Vector3 => {
  const t = THREE.MathUtils.clamp(progress, 0, 1)
  const signed = t * 2 - 1
  const limb = Math.abs(signed)
  const tip = signed < 0 ? bottomTip : topTip
  const curve = limb === 0 || limb === 1 ? 0 : -Math.sin(limb * Math.PI) * 0.14
  target.set(0, tip.y * limb, tip.z * limb + curve)
  return target
}

/** Shared bow mesh, socket alignment, string, and nocked-arrow presentation. */
export class CharacterBowVisual {
  private readonly topTip = new THREE.Vector3(0, 0.82, -0.04)
  private readonly bottomTip = new THREE.Vector3(0, -0.82, -0.04)
  private stringLength = 0.85
  private stringTop!: THREE.Mesh
  private stringBottom!: THREE.Mesh
  private nockedArrow!: THREE.Group
  private readonly nockPosition = new THREE.Vector3(0, 0, 0.12)

  private readonly tmpBodyPoint = new THREE.Vector3()
  private readonly tmpWorldNock = new THREE.Vector3()
  private readonly tmpLocalDirection = new THREE.Vector3()
  private readonly tmpWorldQuaternion = new THREE.Quaternion()
  private drawContact?: THREE.Object3D
  private arrowRest?: THREE.Object3D

  constructor(
    private readonly actionPivot: THREE.Group,
    private readonly gripPivot: THREE.Group,
  ) {}

  rebuild(weaponId: string): void {
    this.gripPivot.clear()
    const parts = WeaponMeshFactory.buildRanged(weaponId, this.gripPivot)
    this.topTip.copy(parts.topTip)
    this.bottomTip.copy(parts.botTip)
    this.stringLength = parts.stringLength

    const stringMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
    this.stringTop = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, this.stringLength, 4), stringMat)
    this.stringBottom = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, this.stringLength, 4), stringMat)
    this.gripPivot.add(this.stringTop, this.stringBottom)

    this.nockedArrow = new THREE.Group()
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.004, 0.004, 0.95, 6),
      new THREE.MeshLambertMaterial({ color: 0x5c3a1e }),
    )
    shaft.rotation.x = Math.PI / 2
    this.nockedArrow.add(shaft)

    const elven = weaponId === 'elven_runebow'
    const tip = new THREE.Mesh(
      new THREE.ConeGeometry(0.014, 0.09, 6),
      new THREE.MeshStandardMaterial({ color: elven ? 0x00f0ff : 0xaaaaaa, metalness: 0.9 }),
    )
    tip.rotation.x = -Math.PI / 2
    tip.position.z = -0.52
    this.nockedArrow.add(tip)

    const fin = new THREE.Mesh(
      new THREE.BoxGeometry(0.003, 0.035, 0.09),
      new THREE.MeshBasicMaterial({ color: elven ? 0x00d2ff : 0xdddddd }),
    )
    fin.position.z = 0.4
    this.nockedArrow.add(fin)
    this.gripPivot.add(this.nockedArrow)

    polishWeaponMaterials(this.actionPivot)
    if (this.actionPivot.parent) {
      applyBowAttachment(this.actionPivot.parent, this.actionPivot, DEFAULT_BOW_GRIP_PROFILE)
    }
  }

  update(drawRatio: number, targetWorld: THREE.Vector3 | undefined, arrowVisible: boolean, targetYOffset = 0): void {
    if (!this.nockedArrow) return
    if (this.actionPivot.parent) {
      if (!this.actionPivot.parent.userData.handGripFrame) {
        applyBowAttachment(this.actionPivot.parent, this.actionPivot, DEFAULT_BOW_GRIP_PROFILE)
      }
      if (!this.actionPivot.parent.userData.handGripFrame) updateBowOrientation(this.actionPivot.parent, this.actionPivot, targetWorld, DEFAULT_BOW_GRIP_PROFILE, targetYOffset)
    }

    // The bow body curves toward local -Z (the target), while the string nock
    // stays on the archer side at +Z and moves farther back as it is drawn.
    this.nockPosition.set(DEFAULT_BOW_GRIP_PROFILE.gripRadius + 0.007, DEFAULT_BOW_GRIP_PROFILE.gripLength / 2 + 0.015, 0.12 + THREE.MathUtils.clamp(drawRatio, 0, 1) * 0.45)
    if (this.actionPivot.parent?.userData.handGripFrame) {
      if (!this.drawContact) {
        let ancestor: THREE.Object3D | null = this.actionPivot.parent
        while (ancestor && !this.drawContact) {
          this.drawContact = ancestor.getObjectByName(BOW_STRING_CONTACT)
          this.arrowRest = ancestor.getObjectByName(BOW_ARROW_REST)
          ancestor = ancestor.parent
        }
      }
      if (arrowVisible && this.drawContact) {
        this.drawContact.getWorldPosition(this.tmpWorldNock)
        this.gripPivot.worldToLocal(this.nockPosition.copy(this.tmpWorldNock))
      } else this.nockPosition.z = .12
    }
    this.gripPivot.localToWorld(this.tmpWorldNock.copy(this.nockPosition))
    this.updateString(this.stringTop, this.topTip)
    this.updateString(this.stringBottom, this.bottomTip)

    this.nockedArrow.visible = arrowVisible
    if (!arrowVisible) return
    if (this.arrowRest) {
      // The nocked shaft is supported by the bow hand. A distant aim target
      // must not pull its front away from that physical rest.
      this.arrowRest.getWorldPosition(this.tmpLocalDirection)
      this.gripPivot.worldToLocal(this.tmpLocalDirection).sub(this.nockPosition).normalize()
    } else if (targetWorld) {
      this.gripPivot.getWorldQuaternion(this.tmpWorldQuaternion).invert()
      this.tmpLocalDirection.copy(targetWorld)
      this.tmpLocalDirection.y += targetYOffset
      this.tmpLocalDirection.sub(this.tmpWorldNock).normalize().applyQuaternion(this.tmpWorldQuaternion)
    } else {
      this.tmpLocalDirection.copy(ARROW_LOCAL_FORWARD)
    }
    positionArrowCenterFromNock(this.nockedArrow.position, this.nockPosition, this.tmpLocalDirection)
    this.nockedArrow.quaternion.setFromUnitVectors(ARROW_LOCAL_FORWARD, this.tmpLocalDirection)
  }

  hideArrow(): void {
    if (this.nockedArrow) this.nockedArrow.visible = false
  }

  getGripPosition(target: THREE.Vector3): THREE.Vector3 {
    return this.gripPivot.getWorldPosition(target)
  }

  getNockPosition(target: THREE.Vector3): THREE.Vector3 {
    return this.gripPivot.localToWorld(target.copy(this.nockPosition))
  }

  getTopTipPosition(target: THREE.Vector3): THREE.Vector3 {
    return this.gripPivot.localToWorld(target.copy(this.topTip))
  }

  getBottomTipPosition(target: THREE.Vector3): THREE.Vector3 {
    return this.gripPivot.localToWorld(target.copy(this.bottomTip))
  }

  getArrowTipPosition(target: THREE.Vector3): THREE.Vector3 {
    return this.nockedArrow.localToWorld(target.set(0, 0, -0.52))
  }

  writeLaunch(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    targetWorld: THREE.Vector3,
    targetYOffset = 0,
  ): void {
    this.getNockPosition(origin)
    direction.copy(targetWorld)
    direction.y += targetYOffset
    direction.sub(origin).normalize()
    if (this.arrowRest) this.nockedArrow.getWorldPosition(origin)
    else positionArrowCenterFromNock(origin, origin, direction)
  }

  writeBodyProfile(target: Float32Array, pointCount = 9): number {
    const count = Math.min(pointCount, Math.floor(target.length / 3))
    for (let i = 0; i < count; i++) {
      sampleBowBodyLocal(
        this.tmpBodyPoint,
        this.bottomTip,
        this.topTip,
        count <= 1 ? 0.5 : i / (count - 1),
      )
      this.gripPivot.localToWorld(this.tmpBodyPoint)
      const offset = i * 3
      target[offset] = this.tmpBodyPoint.x
      target[offset + 1] = this.tmpBodyPoint.y
      target[offset + 2] = this.tmpBodyPoint.z
    }
    return count
  }

  private updateString(mesh: THREE.Mesh, tip: THREE.Vector3): void {
    mesh.position.copy(tip).add(this.nockPosition).multiplyScalar(0.5)
    mesh.lookAt(this.tmpWorldNock)
    mesh.rotateX(Math.PI / 2)
    mesh.scale.set(1, tip.distanceTo(this.nockPosition) / this.stringLength, 1)
  }
}
