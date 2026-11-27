import * as THREE from 'three'
import { currentWorldQuaternion, refreshWorldChains } from './AnchoredWorldMatrix'
import { polishWeaponMaterials } from './CharacterVisuals'
import { T4_RANGER_BOW_RANGED_ID } from '../rpg/WeaponDatabase'
import { createMakiRangerBowInstance } from './MakiRangerEquipment'
import { createT5Bow } from './HighTierEquipment'
import { WeaponMeshFactory } from './WeaponMeshFactory'
import { shareEquipmentGeometry } from './EquipmentGeometryRegistry'
import { equipmentDetail, equipmentLod2Proxy, equipmentShadowUntil } from './EquipmentVisualLODController'
import { BOW_STRING_CONTACT, BOW_ARROW_REST } from './BowDrawHand'
import {
  applyBowAttachment,
  updateBowOrientation,
  DEFAULT_BOW_GRIP_PROFILE,
  type BowGripProfile,
} from './BowAttachmentContract'

const ARROW_LOCAL_FORWARD = new THREE.Vector3(0, 0, -1)
const ARROW_CENTER_FROM_NOCK = 0.45

type ArrowStyle = 'normal' | 'elven'
/** Constant presentation materials shared by every bow instance (created on first bow, never
 * mutated or disposed per bow). */
let sharedBowMaterials: {
  string: THREE.MeshBasicMaterial
  shaft: THREE.MeshLambertMaterial
  tip: Record<ArrowStyle, THREE.MeshStandardMaterial>
  fin: Record<ArrowStyle, THREE.MeshBasicMaterial>
} | undefined
const bowMaterials = () => sharedBowMaterials ??= {
  string: new THREE.MeshBasicMaterial({ color: 0xffffff }),
  shaft: new THREE.MeshLambertMaterial({ color: 0x5c3a1e }),
  tip: {
    normal: new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.9 }),
    elven: new THREE.MeshStandardMaterial({ color: 0x00f0ff, metalness: 0.9 }),
  },
  fin: {
    normal: new THREE.MeshBasicMaterial({ color: 0xdddddd }),
    elven: new THREE.MeshBasicMaterial({ color: 0x00d2ff }),
  },
}

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

const cachedBowAssetLod2Geometries = new Map<string, THREE.BufferGeometry>()
let cachedBowAssetLod2Material: THREE.MeshLambertMaterial | undefined

function getAssetBowLod2Proxy(topTip: THREE.Vector3, botTip: THREE.Vector3): THREE.Mesh {
  const key = `${topTip.y.toFixed(3)}:${topTip.z.toFixed(3)}:${botTip.y.toFixed(3)}:${botTip.z.toFixed(3)}`
  let geometry = cachedBowAssetLod2Geometries.get(key)
  if (!geometry) {
    const midY = (topTip.y + botTip.y) * 0.5
    const curve = new THREE.CatmullRomCurve3([
      botTip.clone(),
      new THREE.Vector3(0, THREE.MathUtils.lerp(botTip.y, midY, 0.45), botTip.z * 0.55 - 0.12),
      new THREE.Vector3(0, midY, 0),
      new THREE.Vector3(0, THREE.MathUtils.lerp(topTip.y, midY, 0.45), topTip.z * 0.55 - 0.12),
      topTip.clone(),
    ])
    geometry = new THREE.TubeGeometry(curve, 6, 0.016, 4, false)
    geometry.name = 'bow-asset-lod2-proxy'
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    cachedBowAssetLod2Geometries.set(key, geometry)
  }
  const material = cachedBowAssetLod2Material ??= new THREE.MeshLambertMaterial({ color: 0x5c3a21 })
  const mesh = equipmentLod2Proxy(equipmentShadowUntil(new THREE.Mesh(geometry, material), -1))
  mesh.name = 'bow-asset-lod2-proxy'
  mesh.receiveShadow = true
  return mesh
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
  private readonly worldChain: (THREE.Object3D | undefined)[] = [undefined, undefined, undefined]
  private readonly gripInverse = new THREE.Matrix4()
  private readonly gripWorldRotationInverse = new THREE.Quaternion()
  private readonly stringRotation = new THREE.Matrix4()
  private readonly stringPosition = new THREE.Vector3()
  private drawContact?: THREE.Object3D
  private arrowRest?: THREE.Object3D
  private profile: BowGripProfile = DEFAULT_BOW_GRIP_PROFILE
  private animatedAsset?: ReturnType<typeof createT5Bow>

  constructor(
    private readonly actionPivot: THREE.Group,
    private readonly gripPivot: THREE.Group,
    private readonly ownerRoot: THREE.Group,
  ) {}

  rebuild(weaponId: string, consolidateMaterialGroups = false): void {
    this.dispose()
    if (weaponId === 'bow_t5') {
      const bow = createT5Bow()
      this.rebuildFromAsset(bow.model, bow.profile, bow.topTip, bow.bottomTip)
      this.animatedAsset = bow
      return
    }
    if (weaponId === T4_RANGER_BOW_RANGED_ID) {
      const bow = createMakiRangerBowInstance()
      this.rebuildFromAsset(bow.model, bow.profile, bow.topTip, bow.bottomTip)
      return
    }
    this.profile = DEFAULT_BOW_GRIP_PROFILE
    this.gripPivot.clear()
    const parts = WeaponMeshFactory.buildRanged(weaponId, this.gripPivot, consolidateMaterialGroups)
    this.configure(parts, weaponId)
  }

  /** Asset-owned body, same string/nock/arrow and launch path as ordinary bows. */
  rebuildFromAsset(model: THREE.Object3D, profile: BowGripProfile, topTip: THREE.Vector3, botTip: THREE.Vector3): void {
    this.profile = profile
    this.gripPivot.clear()
    // A 3 cm stave is narrower than one battle shadow texel (~8 cm) beyond LOD0.
    this.gripPivot.add(equipmentDetail(equipmentShadowUntil(model, 0), 1))
    this.gripPivot.add(getAssetBowLod2Proxy(topTip, botTip))
    // Authored string halves keep the source PBR surface and triangle detail.
    // Their unit-height geometry uses the same endpoint transforms as cylinders.
    const top = model.getObjectByName('bow-string-top')
    const bottom = model.getObjectByName('bow-string-bottom')
    const strings = top instanceof THREE.Mesh && bottom instanceof THREE.Mesh ? { top, bottom } : undefined
    this.configure({ topTip, botTip, stringLength: topTip.distanceTo(botTip) / 2 }, profile.id, strings)
  }

  private configure(parts: { topTip: THREE.Vector3, botTip: THREE.Vector3, stringLength: number }, weaponId: string, strings?: { top: THREE.Mesh; bottom: THREE.Mesh }): void {
    // Rebuild can follow pilum, an animated attachment or another bow instance.
    this.gripPivot.position.set(0, 0, 0)
    this.gripPivot.quaternion.identity()
    this.gripPivot.scale.set(1, 1, 1)
    this.drawContact = this.arrowRest = undefined
    this.topTip.copy(parts.topTip)
    this.bottomTip.copy(parts.botTip)
    this.stringLength = strings ? 1 : parts.stringLength

    const materials = bowMaterials()
    const stringMat = strings ? undefined : materials.string
    this.stringTop = equipmentShadowUntil(strings?.top ?? new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, this.stringLength, 4), stringMat), -1)
    this.stringBottom = equipmentShadowUntil(strings?.bottom ?? new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, this.stringLength, 4), stringMat), -1)
    this.stringTop.name = 'bow-string-top'
    this.stringBottom.name = 'bow-string-bottom'
    // 1.5 mm strings are sub-pixel at LOD2; NPC equipment LOD hides them there (two draws per bow).
    equipmentDetail(this.stringTop, 1)
    equipmentDetail(this.stringBottom, 1)
    this.gripPivot.add(this.stringTop, this.stringBottom)

    this.nockedArrow = new THREE.Group()
    equipmentShadowUntil(this.nockedArrow, -1)
    const shaft = equipmentDetail(equipmentShadowUntil(new THREE.Mesh(
      new THREE.CylinderGeometry(0.004, 0.004, 0.95, 6),
      materials.shaft,
    ), -1), 1)
    shaft.rotation.x = Math.PI / 2
    this.nockedArrow.add(shaft)

    const arrowStyle: ArrowStyle = weaponId === 'elven_runebow' ? 'elven' : 'normal'
    // The 9 cm tip and 3.5 cm fletching are sub-pixel at LOD2 like the strings; the shaft stays.
    const tip = equipmentDetail(equipmentShadowUntil(new THREE.Mesh(
      new THREE.ConeGeometry(0.014, 0.09, 6),
      materials.tip[arrowStyle],
    ), -1), 1)
    tip.rotation.x = -Math.PI / 2
    tip.position.z = -0.52
    this.nockedArrow.add(tip)

    const fin = equipmentDetail(equipmentShadowUntil(new THREE.Mesh(
      new THREE.BoxGeometry(0.003, 0.035, 0.09),
      materials.fin[arrowStyle],
    ), -1), 1)
    fin.position.z = 0.4
    this.nockedArrow.add(fin)
    this.gripPivot.add(this.nockedArrow)
    // Strings and the nocked arrow are rigid (moved by transforms only); share their geometry.
    shareEquipmentGeometry(this.gripPivot)

    polishWeaponMaterials(this.actionPivot)
    if (this.actionPivot.parent) {
      applyBowAttachment(this.actionPivot.parent, this.actionPivot, this.profile)
    }
  }

  update(drawRatio: number, targetWorld: THREE.Vector3 | undefined, arrowVisible: boolean, targetYOffset = 0): void {
    if (!this.nockedArrow) return
    if (this.actionPivot.parent) {
      if (!this.actionPivot.parent.userData.handGripFrame) {
        applyBowAttachment(this.actionPivot.parent, this.actionPivot, this.profile)
      }
      if (!this.actionPivot.parent.userData.handGripFrame) updateBowOrientation(this.actionPivot.parent, this.actionPivot, targetWorld, this.profile, targetYOffset)
    }

    // A stable actor root owns both hands, across equipment and rig rebuilds.
    // Never search an ancestor: Scene lookup can borrow another archer's pose.
    const handGrip = !!this.actionPivot.parent?.userData.handGripFrame
    if (handGrip) {
      if (!this.isOwnerContact(this.drawContact)) this.drawContact = this.ownerRoot.getObjectByName(BOW_STRING_CONTACT)
      if (!this.isOwnerContact(this.arrowRest)) this.arrowRest = this.ownerRoot.getObjectByName(BOW_ARROW_REST)
    }
    // Nothing below moves the grip pivot or the archer's hands, only their children
    // (bow body, strings, nocked arrow). Refresh those chains once, as the separate
    // world reads each did, and read the current matrices afterwards.
    const drawContact = handGrip && arrowVisible ? this.drawContact : undefined
    const arrowRest = arrowVisible ? this.arrowRest : undefined
    let chainCount = 0
    this.worldChain[chainCount++] = this.gripPivot
    if (drawContact) this.worldChain[chainCount++] = drawContact
    if (arrowRest) this.worldChain[chainCount++] = arrowRest
    refreshWorldChains(this.worldChain as THREE.Object3D[], chainCount)
    this.worldChain[1] = this.worldChain[2] = undefined
    this.gripInverse.copy(this.gripPivot.matrixWorld).invert()
    // The bow body curves toward local -Z (the target), while the string nock
    // stays on the archer side at +Z and moves farther back as it is drawn.
    const ratio = THREE.MathUtils.clamp(drawRatio, 0, 1)
    if (this.animatedAsset) {
      this.animatedAsset.sampleDraw(arrowVisible ? ratio : 0)
      this.topTip.copy(this.animatedAsset.topTip)
      this.bottomTip.copy(this.animatedAsset.bottomTip)
    }
    this.nockPosition.set(this.profile.gripRadius + 0.007, this.profile.gripLength / 2 + 0.015, 0.12 + ratio * 0.45)
    if (handGrip) {
      if (drawContact) {
        this.tmpWorldNock.setFromMatrixPosition(drawContact.matrixWorld).applyMatrix4(this.gripInverse)
        // This contact is part of the sampled humanoid pose and already moves
        // with bowLoad progress. Applying the charge ratio again would lag the
        // nock behind the draw hand (for example, half of a half-draw at 50%).
        if (Number.isFinite(this.tmpWorldNock.x + this.tmpWorldNock.y + this.tmpWorldNock.z)) this.nockPosition.copy(this.tmpWorldNock)
      } else if (!arrowVisible) this.nockPosition.z = .12
    }
    this.tmpWorldNock.copy(this.nockPosition).applyMatrix4(this.gripPivot.matrixWorld)
    this.gripWorldRotationInverse.setFromRotationMatrix(this.stringRotation.extractRotation(this.gripPivot.matrixWorld)).invert()
    this.updateString(this.stringTop, this.topTip)
    this.updateString(this.stringBottom, this.bottomTip)

    this.nockedArrow.visible = arrowVisible
    if (!arrowVisible) return
    if (arrowRest) {
      // The nocked shaft is supported by the bow hand. A distant aim target
      // must not pull its front away from that physical rest.
      this.tmpLocalDirection.setFromMatrixPosition(arrowRest.matrixWorld).applyMatrix4(this.gripInverse).sub(this.nockPosition).normalize()
    } else if (targetWorld) {
      currentWorldQuaternion(this.gripPivot, this.tmpWorldQuaternion).invert()
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

  /** Physical nock-to-rest bearing, also used by the visible shaft. */
  writeShaftDirection(target: THREE.Vector3): boolean {
    if (!this.arrowRest || !this.drawContact) return false
    this.arrowRest.getWorldPosition(target)
    this.getNockPosition(this.tmpWorldNock)
    target.sub(this.tmpWorldNock)
    if (target.lengthSq() < 1e-8) return false
    target.normalize()
    return Number.isFinite(target.x + target.y + target.z)
  }

  dispose(): void {
    this.animatedAsset?.dispose()
    this.animatedAsset = undefined
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

  private isOwnerContact(contact: THREE.Object3D | undefined): boolean {
    for (let node = contact; node; node = node.parent ?? undefined) {
      if (node === this.ownerRoot) return true
    }
    return false
  }

  private updateString(mesh: THREE.Mesh, tip: THREE.Vector3): void {
    mesh.position.copy(tip).add(this.nockPosition).multiplyScalar(0.5)
    // Object3D.lookAt(tmpWorldNock) with the grip pivot (its parent) already current:
    // same steps without re-walking the archer's ancestor chain.
    mesh.updateWorldMatrix(false, false)
    this.stringPosition.setFromMatrixPosition(mesh.matrixWorld)
    this.stringRotation.lookAt(this.tmpWorldNock, this.stringPosition, mesh.up)
    mesh.quaternion.setFromRotationMatrix(this.stringRotation).premultiply(this.gripWorldRotationInverse)
    mesh.rotateX(Math.PI / 2)
    mesh.scale.set(1, tip.distanceTo(this.nockPosition) / this.stringLength, 1)
  }
}
