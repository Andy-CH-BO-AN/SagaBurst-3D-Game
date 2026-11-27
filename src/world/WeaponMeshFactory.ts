import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { CharacterFaction } from './CharacterVisuals'
import { proceduralMaterial } from './ProceduralMaterials'
import { DEFAULT_BOW_GRIP_PROFILE } from './BowAttachmentContract'
import { equipmentDetail, equipmentLod2Proxy, equipmentShadowUntil } from './EquipmentVisualLODController'
import { shareEquipmentGeometry } from './EquipmentGeometryRegistry'
import { LANCE_RADIUS } from './EquipmentAttachmentContract'
import { WEAPONS } from '../rpg/WeaponDatabase'
import { createPaladinEquipment } from './PaladinEquipment'
import { createByzantineEquipment, createT4Polearm, createT5BowBody, createT5Melee, createT5Shield, createFactionShield, requestByzantineEquipment, type ByzantineEquipmentId } from './HighTierEquipment'

function profiledBladeGeometry(length: number, widths: number[], thickness: number): THREE.BufferGeometry {
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const stationCount = widths.length
  for (let station = 0; station < stationCount; station++) {
    const y = length * station / (stationCount - 1)
    const halfWidth = widths[station] / 2
    positions.push(
      halfWidth, y, 0,
      0, y, thickness / 2,
      -halfWidth, y, 0,
      0, y, -thickness / 2,
    )
    const v = station / (stationCount - 1)
    uvs.push(1, v, 0.5, v, 0, v, 0.5, v)
  }
  for (let station = 0; station < stationCount - 1; station++) {
    const base = station * 4
    const next = (station + 1) * 4
    for (let face = 0; face < 4; face++) {
      const adjacent = (face + 1) % 4
      indices.push(base + face, next + face, next + adjacent, base + face, next + adjacent, base + adjacent)
    }
  }
  indices.push(0, 3, 2, 0, 2, 1)
  const tip = (stationCount - 1) * 4
  indices.push(tip, tip + 1, tip + 2, tip, tip + 2, tip + 3)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  return geometry
}

function mergePartGeometries(parts: readonly THREE.Mesh[]): THREE.BufferGeometry {
  const geometries = parts.map(part => {
    part.updateMatrix()
    const geometry = part.geometry.clone().applyMatrix4(part.matrix)
    // OctahedronGeometry is non-indexed; keep every original vertex and triangle.
    if (!geometry.index) geometry.setIndex(Array.from({ length: geometry.getAttribute('position').count }, (_, i) => i))
    return geometry
  })
  let geometry: THREE.BufferGeometry | null
  try {
    geometry = mergeGeometries(geometries, false)
  } finally {
    for (const temporary of geometries) temporary.dispose()
  }
  if (!geometry) throw new Error('Incompatible rigid equipment geometry attributes')
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

/** Only builder-owned, rigid siblings with identical material/render state belong here. */
function mergeRigidGeometryParts(parts: THREE.Mesh[], material: THREE.Material, name: string): THREE.Mesh {
  const first = parts[0]
  if (!first || parts.some(part => part.material !== material
    || part.parent !== first.parent || part.children.length > 0
    || part instanceof THREE.SkinnedMesh || Object.keys(part.geometry.morphAttributes).length > 0
    || part.castShadow !== first.castShadow || part.receiveShadow !== first.receiveShadow
    || part.visible !== first.visible || part.layers.mask !== first.layers.mask
    || part.renderOrder !== first.renderOrder || part.frustumCulled !== first.frustumCulled)) {
    throw new Error('Rigid equipment parts must share material, parent and render state')
  }
  const merged = new THREE.Mesh(mergePartGeometries(parts), material)
  merged.name = name
  merged.castShadow = first.castShadow
  merged.receiveShadow = first.receiveShadow
  merged.visible = first.visible
  merged.layers.mask = first.layers.mask
  merged.renderOrder = first.renderOrder
  merged.frustumCulled = first.frustumCulled
  // These explicitly supplied parts are discarded, never cached or runtime-moving.
  for (const part of parts) part.removeFromParent()
  for (const source of new Set(parts.map(part => part.geometry))) source.dispose()
  return merged
}

/** Non-destructive single-material proxy for NPC LOD2 (> 30m); keeps LOD0/1 parts intact. */
function createLod2MergedProxy(parts: THREE.Mesh[], material: THREE.Material, name: string): THREE.Mesh {
  const merged = new THREE.Mesh(mergePartGeometries(parts), material)
  merged.name = name
  merged.receiveShadow = true
  return equipmentLod2Proxy(equipmentShadowUntil(merged, -1))
}

function addWrappedGrip(pivot: THREE.Group, length: number, radius: number, y: number, leather: THREE.Material, metal: THREE.Material): THREE.Mesh[] {
  const handle = equipmentDetail(equipmentShadowUntil(new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.94, length, 12), leather), -1), 1)
  handle.position.y = y
  pivot.add(handle)
  const wraps: THREE.Mesh[] = []
  for (let ring = 0; ring < 7; ring++) {
    const wrap = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.02, radius * 0.1, 6, 16), metal)
    wrap.rotation.x = Math.PI / 2
    wrap.position.y = y - length / 2 + (ring + 0.5) * length / 7
    pivot.add(wrap)
    wraps.push(wrap)
  }
  return wraps
}


function curvedLimb(points: THREE.Vector3[], radius: number, material: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 20, radius, 8, false), material)
}

/** Small raised inlays; callers merge them into a single rigid detail draw. */
function diamondInlay(x: number, y: number, z: number, width: number, height: number, material: THREE.Material, subdivisions = 1): THREE.Mesh {
  // Subdivision lets shield inlays follow the curved face between vertices too.
  const geometry = new THREE.BoxGeometry(1, 1, 0.004, subdivisions, subdivisions, 1)
  geometry.rotateZ(Math.PI / 4)
  geometry.scale(width / Math.SQRT2, height / Math.SQRT2, 1)
  geometry.translate(0, 0, 0.002)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(x, y, z)
  return mesh
}

function bendShieldGeometry<T extends THREE.BufferGeometry>(geometry: T, width: number, curve: number): T {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  for (let index = 0; index < position.count; index++) {
    const x = position.getX(index)
    const normalized = x / (width / 2)
    position.setZ(index, position.getZ(index) + curve * (1 - normalized * normalized))
  }
  position.needsUpdate = true
  geometry.computeVertexNormals()
  return geometry
}

function curvedRectangleRim(width: number, height: number, curve: number, frontZ: number, radius: number, material: THREE.Material): THREE.Mesh {
  const points: THREE.Vector3[] = []
  const steps = 8
  const addEdge = (from: THREE.Vector2, to: THREE.Vector2) => {
    for (let step = 0; step < steps; step++) {
      const t = step / steps
      const x = THREE.MathUtils.lerp(from.x, to.x, t)
      const y = THREE.MathUtils.lerp(from.y, to.y, t)
      const z = frontZ + curve * (1 - (x / (width / 2)) ** 2)
      points.push(new THREE.Vector3(x, y, z))
    }
  }
  addEdge(new THREE.Vector2(-width / 2, height / 2), new THREE.Vector2(width / 2, height / 2))
  addEdge(new THREE.Vector2(width / 2, height / 2), new THREE.Vector2(width / 2, -height / 2))
  addEdge(new THREE.Vector2(width / 2, -height / 2), new THREE.Vector2(-width / 2, -height / 2))
  addEdge(new THREE.Vector2(-width / 2, -height / 2), new THREE.Vector2(-width / 2, height / 2))
  return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, true), 56, radius, 8, true), material)
}

export interface NpcRangedMeshParts {
  stringTop?: THREE.Mesh
  stringBottom?: THREE.Mesh
  nockedArrow?: THREE.Group
}

// Shared immutable grip resources; cloned shield instances own only transforms.
let paladinGripGeometry: THREE.CapsuleGeometry | undefined
let paladinGripMountGeometry: THREE.BoxGeometry | undefined
const lod2ProxyGeometryCache = new Map<string, THREE.BufferGeometry>()
let highTierWoodMat: THREE.Material | undefined
let highTierSteelMat: THREE.Material | undefined
let highTierBronzeMat: THREE.Material | undefined
let highTierBlueMat: THREE.Material | undefined

function sharedHighTierProxyGeometry(key: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let geo = lod2ProxyGeometryCache.get(key)
  if (!geo) {
    geo = build()
    geo.name = `lod2-proxy-${key}`
    geo.computeBoundingBox()
    geo.computeBoundingSphere()
    lod2ProxyGeometryCache.set(key, geo)
  }
  return geo
}

function createSharedLod2ProxyMesh(key: string, build: () => THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(sharedHighTierProxyGeometry(key, build), material)
  mesh.name = `${key}-lod2-proxy`
  mesh.receiveShadow = true
  return equipmentLod2Proxy(equipmentShadowUntil(mesh, -1))
}

function highTierMaterials(): { wood: THREE.Material; steel: THREE.Material; bronze: THREE.Material; blue: THREE.Material } {
  return {
    wood: highTierWoodMat ??= proceduralMaterial({ kind: 'wood', color: 0x5c4033, roughness: 0.78 }),
    steel: highTierSteelMat ??= proceduralMaterial({ kind: 'iron', color: 0xbec4c8, roughness: 0.34, metalness: 0.85 }),
    bronze: highTierBronzeMat ??= proceduralMaterial({ kind: 'bronze', color: 0xa47b42, roughness: 0.42, metalness: 0.72 }),
    blue: highTierBlueMat ??= proceduralMaterial({ kind: 'wood', color: 0x2b4d6d, roughness: 0.75 }),
  }
}

const NON_PROCEDURAL_MELEE_IDS = new Set([
  'spear_t4',
  'spear_t5',
  'byzantine_standard_lance_t5',
  'sword_t5',
  'axe_t5',
  'paladin_mace_t4',
  'paladin_sword_t4',
])

const HIGH_TIER_SHIELD_IDS = new Set([
  'paladin_shield_t4',
  'commander_shield_t5',
  'roman_officer_shield_t4',
  'viking_berserker_shield_t5',
  'byzantine_eagle_shield_t5',
  'centurion_aquila_shield_t4',
  'viking_dragonward_shield_t4',
])

const PROCEDURAL_MELEE_USER_DATA_KEYS = [
  'gripCenterLocal',
  'meleeWeaponId',
  'meleeAnimationKind',
  'supportPointLocal',
  'forwardAxisLocal',
  'tipLocal',
] as const

interface CachedEquipmentTemplate {
  template: THREE.Group
  pivotUserData: Record<string, unknown>
  tipLocal?: THREE.Vector3
}

const npcMeleeTemplateCache = new Map<string, CachedEquipmentTemplate>()
const proceduralShieldTemplateCache = new Map<string, CachedEquipmentTemplate>()

function cloneUserDataValue(value: unknown): unknown {
  return Array.isArray(value) ? value.slice() : value
}

function cloneUserDataRecord(source: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = {}
  for (const key of Object.keys(source)) {
    copy[key] = cloneUserDataValue(source[key])
  }
  return copy
}

function cloneEquipmentNode(source: THREE.Object3D): THREE.Object3D {
  const target = source instanceof THREE.Mesh
    ? new THREE.Mesh(source.geometry, source.material)
    : new THREE.Group()
  target.name = source.name
  target.position.copy(source.position)
  target.quaternion.copy(source.quaternion)
  target.scale.copy(source.scale)
  target.visible = source.visible
  target.castShadow = source.castShadow
  target.receiveShadow = source.receiveShadow
  target.renderOrder = source.renderOrder
  target.frustumCulled = source.frustumCulled
  target.layers.mask = source.layers.mask
  for (const key of Object.keys(source.userData)) {
    target.userData[key] = cloneUserDataValue(source.userData[key])
  }
  for (const child of source.children) {
    target.add(cloneEquipmentNode(child))
  }
  return target
}

function appendClonedEquipmentChildren(template: THREE.Group, pivot: THREE.Group): void {
  for (const child of template.children) {
    pivot.add(cloneEquipmentNode(child))
  }
}

const bannerWorld = new THREE.Quaternion()
const bannerDown = new THREE.Vector3()

/** Banner flies toward model -X. Spin the whole (round) lance about its shaft so the cloth hangs toward the ground.
 * Runs at render time on the final pose: visual only, with no effect on grip, tip or hit traces. */
export function bannerRollAngle(shaftWorld: THREE.Quaternion, down: THREE.Vector3 = bannerDown): number | undefined {
  down.set(0, -1, 0).applyQuaternion(shaftWorld.clone().invert())
  // Too close to vertical for a meaningful "down" around the shaft: keep the last roll.
  if (Math.hypot(down.x, down.z) < .2) return undefined
  return Math.atan2(down.z, -down.x)
}

function hangBannerByGravity(roll: THREE.Group, model: THREE.Object3D): void {
  let angle: number | undefined
  const update = () => {
    if (!roll.parent) return
    const target = bannerRollAngle(roll.parent.getWorldQuaternion(bannerWorld))
    if (target === undefined) return
    angle = angle === undefined ? target : angle + Math.atan2(Math.sin(target - angle), Math.cos(target - angle)) * .35
    roll.rotation.set(0, angle, 0)
    roll.updateMatrixWorld(true)
  }
  model.traverse(object => { if (object instanceof THREE.Mesh) object.onBeforeRender = update })
}

/** Gameplay frames exist at once; the real model joins this holder when loaded, unless the pivot was rebuilt meanwhile.
 * A failure leaves the holder empty, never another model. Actors only reach this once the item is usable. */
function attachByzantineEquipment(id: ByzantineEquipmentId, pivot: THREE.Group, onModel?: (holder: THREE.Group, model: THREE.Group) => void): void {
  const holder = equipmentDetail(new THREE.Group(), 1)
  holder.name = `${id}-holder`
  pivot.add(holder)
  const place = (model: THREE.Group) => { holder.add(model); onModel?.(holder, model) }
  const loaded = createByzantineEquipment(id)
  if (loaded) { place(loaded); return }
  requestByzantineEquipment(id).then(model => { if (holder.parent) place(model) }, () => {})
}

/** Public builders share byte-identical rigid geometry across actors (EquipmentGeometryRegistry). */
export class WeaponMeshFactory {
  /**
   * 建構近戰武器的 3D mesh group，附加到指定 pivot
   */
  static buildMelee(weaponId: string, pivot: THREE.Group): { tipLocal: THREE.Vector3 } {
    const result = this.buildMeleeUnshared(weaponId, pivot)
    shareEquipmentGeometry(pivot)
    return result
  }

  private static buildMeleeUnshared(weaponId: string, pivot: THREE.Group): { tipLocal: THREE.Vector3 } {
    const tipLocal = new THREE.Vector3(0, 1.2, 0)
    pivot.userData.gripCenterLocal = [0, 0.15, 0]
    pivot.userData.meleeWeaponId = weaponId
    if (WEAPONS[weaponId]?.combatKind === 'sword') pivot.userData.meleeAnimationKind = WEAPONS[weaponId].animationKind
    else delete pivot.userData.meleeAnimationKind

    if (weaponId === 'spear_t4' || weaponId === 'spear_t5') {
      pivot.userData.supportPointLocal = [0, .33, 0]
      pivot.userData.forwardAxisLocal = [0, 1, 0]
      pivot.userData.tipLocal = [0, 2.6, 0]
      pivot.add(equipmentDetail(weaponId === 'spear_t5' ? createT5Melee(weaponId) : createT4Polearm(), 1))
      const mats = highTierMaterials()
      pivot.add(createSharedLod2ProxyMesh('high-tier-spear', () => {
        const shaft = new THREE.CylinderGeometry(LANCE_RADIUS, LANCE_RADIUS, 2.6, 5)
        shaft.translate(0, 0.85, 0)
        const head = new THREE.ConeGeometry(0.055, 0.45, 4)
        head.translate(0, 2.35, 0)
        return mergeGeometries([shaft, head], false)!
      }, weaponId === 'spear_t5' ? mats.steel : mats.wood))
      return { tipLocal: new THREE.Vector3(0, 2.6, 0) }
    }

    if (weaponId === 'byzantine_standard_lance_t5') {
      // Visible shaft is 3.3 m (Y -0.5..2.8) with the same main/support grips as every lance.
      // Gameplay reach is WeaponData.range (3.9 m), not this model length.
      pivot.userData.supportPointLocal = [0, .33, 0]
      pivot.userData.forwardAxisLocal = [0, 1, 0]
      pivot.userData.tipLocal = [0, 2.8, 0]
      attachByzantineEquipment(weaponId, pivot, hangBannerByGravity)
      const mats = highTierMaterials()
      pivot.add(createSharedLod2ProxyMesh('byzantine-lance', () => {
        const shaft = new THREE.CylinderGeometry(LANCE_RADIUS, LANCE_RADIUS, 3.1, 5)
        shaft.translate(0, 1.05, 0)
        const head = new THREE.ConeGeometry(0.06, 0.5, 4)
        head.translate(0, 2.55, 0)
        return mergeGeometries([shaft, head], false)!
      }, mats.steel))
      return { tipLocal: new THREE.Vector3(0, 2.8, 0) }
    }

    if (weaponId === 'sword_t5') {
      pivot.add(equipmentDetail(createT5Melee(weaponId), 1))
      const mats = highTierMaterials()
      pivot.add(createSharedLod2ProxyMesh('high-tier-sword', () => {
        const g = new THREE.BoxGeometry(0.09, 1.25, 0.03)
        g.translate(0, 0.65, 0)
        return g
      }, mats.steel))
      return { tipLocal: new THREE.Vector3(0, 1.3275, 0) }
    }
    if (weaponId === 'axe_t5' || weaponId === 'paladin_mace_t4') {
      // Reuse the existing weapon-only carry/attack transform and Bandit foot-axe pose.
      // The normalized asset has its shaft along +Y and its grip at y=.15.
      const visual = new THREE.Group()
      visual.name = 'dane-axe-visual'
      visual.position.y = .15
      visual.rotation.x = .45
      const model = equipmentDetail(weaponId === 'paladin_mace_t4' ? createPaladinEquipment(weaponId) : createT5Melee(weaponId), 1)
      model.position.y = -.15
      visual.add(model)
      const mats = highTierMaterials()
      visual.add(createSharedLod2ProxyMesh(weaponId, () => {
        const haft = new THREE.CylinderGeometry(0.025, 0.028, weaponId === 'paladin_mace_t4' ? 0.9 : 1.4, 5)
        haft.translate(0, weaponId === 'paladin_mace_t4' ? 0.38 : 0.55, 0)
        const head = new THREE.BoxGeometry(weaponId === 'paladin_mace_t4' ? 0.14 : 0.28, 0.24, 0.05)
        head.translate(weaponId === 'paladin_mace_t4' ? 0 : 0.12, weaponId === 'paladin_mace_t4' ? 0.78 : 1.15, 0)
        return mergeGeometries([haft, head], false)!
      }, mats.steel))
      pivot.add(visual)
      // Preserve each weapon's existing gameplay reach marker independently of its new mesh.
      return { tipLocal: new THREE.Vector3(0, weaponId === 'paladin_mace_t4' ? .99375 : 1.51, 0) }
    }

    if (weaponId === 'paladin_sword_t4') {
      pivot.add(equipmentDetail(createPaladinEquipment(weaponId), 1))
      const mats = highTierMaterials()
      pivot.add(createSharedLod2ProxyMesh('high-tier-sword', () => {
        const g = new THREE.BoxGeometry(0.09, 1.25, 0.03)
        g.translate(0, 0.65, 0)
        return g
      }, mats.steel))
      return { tipLocal: new THREE.Vector3(0, 1.3275, 0) }
    }

    if (weaponId === 'gladius_rusty' || weaponId === 'gladius_standard' || weaponId === 'centurion_blade') {
      const tier = weaponId === 'gladius_rusty' ? 1 : weaponId === 'centurion_blade' ? 3 : 2
      return { tipLocal: this.buildRomanGladius(tier, pivot) }
    }

    if (weaponId === 'steel_lance' || weaponId === 'hunting_spear' || weaponId === 'heavy_lance' || WEAPONS[weaponId]?.combatKind === 'lance') {
      pivot.userData.supportPointLocal = [0, 0.33, 0]
      pivot.userData.forwardAxisLocal = [0, 1, 0]
      pivot.userData.tipLocal = [0, 2.6, 0]
      const tier = WEAPONS[weaponId]?.tier ?? 2
      const poleMat = proceduralMaterial({ kind: 'wood', color: tier === 1 ? 0x635344 : tier === 3 ? 0x302b32 : 0x5c4033, roughness: tier === 1 ? 0.95 : 0.7 })
      const headMat = proceduralMaterial({ kind: 'iron', color: tier === 1 ? 0x756052 : tier === 3 ? 0xd6d8dc : 0xaaaaaa, roughness: tier === 1 ? 0.86 : 0.3, metalness: tier === 1 ? 0.45 : 0.85 })

      // The lance is held near the back. The pole goes from y = -0.5 to y = 2.0
      const pole = equipmentDetail(equipmentShadowUntil(new THREE.Mesh(new THREE.CylinderGeometry(LANCE_RADIUS, LANCE_RADIUS, 2.5, 12), poleMat), 1), 1)
      pole.position.y = 0.75 // Center of pole (2.5/2 = 1.25, minus offset to hold it lower)
      pivot.add(pole)

      // Lance cone head
      const headGeometry = tier === 2 ? new THREE.ConeGeometry(0.06, 0.6, 8)
        : profiledBladeGeometry(0.6, tier === 1 ? [0.045, 0.074, 0.055, 0.028, 0] : [0.06, 0.15, 0.115, 0.055, 0], 0.035)
      if (tier !== 2) headGeometry.translate(0, -0.3, 0)
      const head = equipmentDetail(equipmentShadowUntil(new THREE.Mesh(headGeometry, headMat), 1), 1)
      head.position.y = 2.3 // 0.75 + 1.25 + 0.3
      head.castShadow = true
      pivot.add(head)
      pivot.add(createLod2MergedProxy([pole, head], poleMat, 'lance-lod2-proxy'))
      if (tier !== 2) {
        const trim = proceduralMaterial({ kind: tier === 1 ? 'leather' : 'bronze', color: tier === 1 ? 0x403126 : 0xc49a50, roughness: tier === 1 ? 0.95 : 0.3 })
        const details: THREE.Mesh[] = []
        for (const y of tier === 1 ? [1.82, 1.88, 1.94] : [0.48, 0.54, 1.82, 1.94]) {
          const band = new THREE.Mesh(new THREE.CylinderGeometry(LANCE_RADIUS * 1.3, LANCE_RADIUS * 1.3, 0.035, 10), trim)
          band.position.y = y
          pivot.add(band); details.push(band)
        }
        if (tier === 3) for (const z of [-0.022, 0.018]) {
          const inlay = diamondInlay(0, 2.2, z, 0.065, 0.21, trim)
          pivot.add(inlay); details.push(inlay)
        }
        pivot.add(equipmentShadowUntil(equipmentDetail(mergeRigidGeometryParts(details, trim, 'lance-tier-trim'), 0), -1))
      }
      tipLocal.set(0, 2.6, 0)

    } else if (weaponId === 'viking_axe_t1' || weaponId === 'viking_axe_t2' || weaponId === 'viking_axe_t3') {
      const tier = WEAPONS[weaponId].tier
      const wood = proceduralMaterial({ kind: 'wood', color: tier === 3 ? 0x5b3d29 : 0x65472d, roughness: 0.75 })
      const leather = proceduralMaterial({ kind: 'leather', color: tier === 3 ? 0x302b36 : 0x3c3028, roughness: 0.82 })
      const iron = proceduralMaterial({
        kind: 'iron', color: tier === 1 ? 0x80664e : tier === 2 ? 0xb4bdc0 : 0xc9c5b2,
        roughness: tier === 1 ? 0.88 : 0.34, metalness: tier === 1 ? 0.45 : 0.8,
      })

      // The 1.44 m haft starts below the axe head; the hand stays 0.15 m above its butt.
      const haft = equipmentDetail(equipmentShadowUntil(new THREE.Mesh(new THREE.CylinderGeometry(0.023, 0.03, 1.44, 8), wood), 1), 1)
      haft.position.y = 0.72
      haft.castShadow = true
      haft.name = 'dane-axe-haft'
      pivot.add(haft)

      const grip = equipmentDetail(equipmentShadowUntil(new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.22, 8), leather), 1), 1)
      grip.position.y = 0.15
      grip.name = 'dane-axe-grip'
      pivot.add(grip)

      const socket = equipmentDetail(equipmentShadowUntil(new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.047, 0.24, 8), iron), 1), 1)
      socket.position.y = 1.30
      socket.castShadow = true
      socket.name = 'dane-axe-socket'
      pivot.add(socket)

      // One broad cutting edge on +X and a hooked beard below the socket.
      const outline = new THREE.Shape()
      outline.moveTo(0.025, 1.38)
      outline.lineTo(0.17, 1.42)
      outline.lineTo(0.31, 1.45)
      outline.lineTo(0.33, 1.32)
      outline.lineTo(0.33, 1.11)
      outline.lineTo(0.27, 1.00)
      outline.lineTo(0.16, 0.99)
      outline.lineTo(0.18, 1.13)
      outline.lineTo(0.025, 1.18)
      outline.closePath()
      const blade = equipmentDetail(equipmentShadowUntil(new THREE.Mesh(new THREE.ExtrudeGeometry(outline, { depth: 0.032, bevelEnabled: false }), iron), 1), 1)
      blade.position.z = -0.016
      // Change only the cutting head width; haft, grip and mounted clearance stay fixed.
      blade.scale.x = tier === 1 ? 0.78 : tier === 3 ? 1.14 : 1
      blade.castShadow = true
      blade.name = 'dane-axe-single-bearded-blade'
      pivot.add(blade)
      pivot.add(createLod2MergedProxy([haft, socket, blade], iron, 'axe-lod2-proxy'))

      if (tier === 3) {
        const gold = proceduralMaterial({ kind: 'bronze', color: 0xc49a50, roughness: 0.3 })
        const inlays: THREE.Mesh[] = []
        for (const z of [-0.022, 0.018]) for (const y of [1.17, 1.31]) {
          const inlay = diamondInlay(0.2, y, z, 0.10, 0.09, gold)
          pivot.add(inlay); inlays.push(inlay)
        }
        pivot.add(equipmentShadowUntil(equipmentDetail(mergeRigidGeometryParts(inlays, gold, 'axe-gold-inlays'), 0), -1))
      }

      // Splay only the visible axe outward from the hand so it clears the horse.
      // The sword hit reference remains fixed on the original animation path.
      const visual = new THREE.Group()
      visual.name = 'dane-axe-visual'
      visual.position.y = 0.15
      visual.rotation.x = 0.45
      for (const part of [...pivot.children]) {
        part.position.y -= 0.15
        visual.add(part)
      }
      pivot.add(visual)

      // Keep the sword's hit reference and range even though the visible haft ends at 1.45 m.
      tipLocal.set(0, 1.51, 0)
    } else {
      const tier = weaponId === 'rusty_dagger' ? 1 : weaponId === 'runic_greatsword' ? 3 : 2
      const leather = proceduralMaterial({
        kind: 'leather', color: tier === 1 ? 0x4a3428 : tier === 3 ? 0x252038 : 0x3f2b21,
        roughness: 0.82, repeat: [2, tier + 2],
      })
      const steel = proceduralMaterial({
        kind: 'iron', color: tier === 1 ? 0x80664e : tier === 3 ? 0xd8d3bd : 0xc2c7c9,
        roughness: tier === 1 ? 0.88 : 0.27, metalness: tier === 1 ? 0.45 : 0.92, repeat: [tier + 1, 5],
      })
      const darkSteel = proceduralMaterial({
        kind: tier === 3 ? 'bronze' : 'iron', color: tier === 1 ? 0x47413d : tier === 3 ? 0xb78a42 : 0x555c60,
        roughness: 0.38, metalness: 0.82, repeat: [2, tier + 3],
      })
      const fullerMaterial = tier === 3
        ? proceduralMaterial({ kind: 'iron', color: 0x3e6d86, roughness: 0.24, metalness: 0.9, repeat: [2, 8] })
        : darkSteel
      const wraps = addWrappedGrip(pivot, 0.29, 0.037, 0.15, leather, darkSteel)

      const pommel = new THREE.Mesh(new THREE.OctahedronGeometry(0.064, 1), darkSteel)
      pommel.scale.set(0.92, 1.18, 0.72)
      if (tier === 1) pommel.scale.multiplyScalar(0.8)
      if (tier === 3) pommel.scale.y *= 1.25
      pommel.position.y = -0.035
      pivot.add(pommel)

      const guard = curvedLimb([
        new THREE.Vector3(-0.23, 0, 0.02),
        new THREE.Vector3(-0.1, 0.018, 0),
        new THREE.Vector3(0, 0.025, 0),
        new THREE.Vector3(0.1, 0.018, 0),
        new THREE.Vector3(0.23, 0, 0.02),
      ], 0.027, darkSteel)
      guard.position.y = 0.31
      guard.scale.x = tier === 1 ? 0.72 : tier === 3 ? 1.18 : 1
      pivot.add(guard)

      const widths = tier === 1 ? [0.087, 0.075, 0.069, 0.035, 0.004]
        : tier === 3 ? [0.125, 0.118, 0.099, 0.056, 0.004] : [0.105, 0.102, 0.086, 0.052, 0.004]
      const blade = equipmentDetail(equipmentShadowUntil(new THREE.Mesh(profiledBladeGeometry(1.18, widths, 0.038), steel), 1), 1)
      blade.position.y = 0.33
      blade.name = 'steel-sword-profiled-blade'
      blade.castShadow = true
      pivot.add(blade)
      const fullerFront = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.78, 0.004, 1, 8, 1), fullerMaterial)
      fullerFront.position.set(0, 0.82, 0.021)
      pivot.add(fullerFront)
      const fullerBack = fullerFront.clone()
      fullerBack.position.z = -0.021
      pivot.add(fullerBack)
      const inlays: THREE.Mesh[] = []
      if (tier === 3) for (const z of [-0.026, 0.022]) for (const y of [0.52, 0.7, 0.88, 1.06]) {
        const inlay = diamondInlay(0, y, z, 0.048, 0.095, darkSteel)
        pivot.add(inlay); inlays.push(inlay)
      }
      const gripMetal = equipmentDetail(equipmentShadowUntil(mergeRigidGeometryParts([...wraps, pommel, guard, ...inlays], darkSteel, 'sword-grip-metal'), 1), 1)
      pivot.add(gripMetal)
      pivot.add(createLod2MergedProxy([blade, gripMetal], steel, 'sword-lod2-proxy'))
      pivot.add(equipmentShadowUntil(equipmentDetail(mergeRigidGeometryParts([fullerFront, fullerBack], fullerMaterial, 'sword-fullers'), 0), -1))

      tipLocal.set(0, 1.51, 0)
    }

    pivot.rotation.set(0, 0, 0)

    return { tipLocal }
  }

  /**
   * 建構遠程武器的 3D mesh group
   */
  static buildRanged(weaponId: string, pivot: THREE.Group, consolidateMaterialGroups = false): { topTip: THREE.Vector3, botTip: THREE.Vector3, stringLength: number } {
    const result = this.buildRangedUnshared(weaponId, pivot, consolidateMaterialGroups)
    shareEquipmentGeometry(pivot)
    return result
  }

  private static buildRangedUnshared(weaponId: string, pivot: THREE.Group, consolidateMaterialGroups = false): { topTip: THREE.Vector3, botTip: THREE.Vector3, stringLength: number } {
    if (weaponId === 'bow_t5') {
      pivot.add(createT5BowBody())
      return { topTip: new THREE.Vector3(0, .85, .21), botTip: new THREE.Vector3(0, -.85, .21), stringLength: .85 }
    }
    const profile = DEFAULT_BOW_GRIP_PROFILE
    const tier = WEAPONS[weaponId]?.tier ?? 2
    const halfSpan = weaponId === 'wooden_shortbow' ? 0.62 : weaponId === 'elven_runebow' ? 1.02 : 0.85
    const bowModel = new THREE.Group()
    bowModel.name = 'bow-model'
    pivot.add(bowModel)
    const wood = proceduralMaterial({ kind: 'wood', color: tier === 1 ? 0x71604b : tier === 3 ? 0x344b59 : 0x795331, roughness: tier === 1 ? 0.95 : 0.7 })
    const leather = proceduralMaterial({ kind: 'leather', color: 0x423025, roughness: 0.85 })
    // One connected surface: the central rings form the straight leather grip,
    // and the same rings continue into tapered wood. Separate open cylinders
    // previously exposed jagged triangular overlaps at the grip/limb junction.
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, profile.gripLength / 2, 0),
      new THREE.Vector3(0, profile.gripLength / 2 + 0.045, 0),
      new THREE.Vector3(0, halfSpan * 0.3, -0.045),
      new THREE.Vector3(0, halfSpan * 0.72, -0.13),
      new THREE.Vector3(0, halfSpan, -0.035),
    ])
    const rings: Array<{ center: THREE.Vector3; tangent: THREE.Vector3; radius: number }> = []
    for (const side of [-1, 1]) {
      for (let step = 0; step <= 40; step++) {
        const t = side < 0 ? 1 - step / 40 : step / 40
        const center = curve.getPointAt(t)
        const tangent = t === 0 ? new THREE.Vector3(0, 1, 0) : curve.getTangentAt(t)
        center.y *= side
        tangent.z *= side
        rings.push({ center, tangent, radius: profile.gripRadius * THREE.MathUtils.lerp(1, 0.38, t) })
      }
    }
    const vertices: number[] = [], uvs: number[] = [], indices: number[] = []
    const sides = 16
    for (const ring of rings) {
      const across = new THREE.Vector3().crossVectors(new THREE.Vector3(1, 0, 0), ring.tangent).normalize()
      for (let j = 0; j <= sides; j++) {
        const angle = j / sides * Math.PI * 2
        const point = ring.center.clone().addScaledVector(across, Math.cos(angle) * ring.radius)
        point.x += Math.sin(angle) * ring.radius
        vertices.push(...point.toArray())
        uvs.push(j / sides, (ring.center.y + halfSpan) / (halfSpan * 2))
      }
    }
    const geometry = new THREE.BufferGeometry()
    const appendRing = (ring: number, materialIndex: number) => {
      const start = indices.length
      for (let j = 0; j < sides; j++) {
        const a = ring * (sides + 1) + j, b = a + sides + 1
        indices.push(a, a + 1, b, b, a + 1, b + 1)
      }
      const previous = geometry.groups[geometry.groups.length - 1]
      if (consolidateMaterialGroups && previous?.materialIndex === materialIndex) {
        previous.count += indices.length - start
      } else {
        geometry.addGroup(start, indices.length - start, materialIndex)
      }
    }
    if (consolidateMaterialGroups) {
      // Emit wood limbs contiguously before the leather grip so NPC bows use 2 groups instead of 3.
      for (let ring = 0; ring < rings.length - 1; ring++) if (ring !== 40) appendRing(ring, 0)
      appendRing(40, 1)
    } else {
      for (let ring = 0; ring < rings.length - 1; ring++) appendRing(ring, ring === 40 ? 1 : 0)
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geometry.setIndex(indices)
    geometry.computeVertexNormals()
    // A bow stave is narrower than one battle shadow texel (~8 cm) beyond LOD0.
    const stave = equipmentDetail(equipmentShadowUntil(new THREE.Mesh(geometry, [wood, leather]), 0), 1)
    stave.name = 'bow-stave-and-grip'
    bowModel.add(stave)
    const lod2Geo = geometry.clone()
    lod2Geo.clearGroups()
    const staveLod2 = equipmentLod2Proxy(equipmentShadowUntil(new THREE.Mesh(lod2Geo, wood), -1))
    staveLod2.name = 'bow-stave-lod2-proxy'
    bowModel.add(staveLod2)
    for (const side of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(profile.gripRadius * 0.38, 10, 8), wood)
      cap.position.set(0, side * halfSpan, -0.035)
      bowModel.add(equipmentShadowUntil(equipmentDetail(cap, 0), -1))
    }
    if (tier !== 2) {
      const trim = proceduralMaterial({ kind: tier === 1 ? 'leather' : 'bronze', color: tier === 1 ? 0x3b3025 : 0xd0a457, roughness: tier === 1 ? 0.95 : 0.28 })
      const bands: THREE.Mesh[] = []
      // Follow the existing stave curve; stay clear of the central hand/arrow rest.
      for (const side of [-1, 1]) for (const t of tier === 1 ? [0.3, 0.34, 0.38] : [0.25, 0.3, 0.65, 0.7, 0.9]) {
        const center = curve.getPointAt(t), tangent = curve.getTangentAt(t)
        center.y *= side; tangent.z *= side
        const radius = profile.gripRadius * THREE.MathUtils.lerp(1, 0.38, t) + 0.004
        const band = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, tier === 1 ? 0.016 : 0.026, 10), trim)
        band.position.copy(center)
        band.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent)
        bowModel.add(band); bands.push(band)
      }
      bowModel.add(equipmentShadowUntil(equipmentDetail(mergeRigidGeometryParts(bands, trim, 'bow-tier-bindings'), 0), -1))
    }
    const topTip = new THREE.Vector3(0, halfSpan, -0.035)
    const botTip = new THREE.Vector3(0, -halfSpan, -0.035)
    return { topTip, botTip, stringLength: halfSpan }
  }

  /**
   * 建構地面掉落用的簡化武器模型
   */
  static buildPickupMesh(weaponId: string, isArrowPack: boolean, colorHex: number, pivot: THREE.Group): void {
    this.buildPickupMeshUnshared(weaponId, isArrowPack, colorHex, pivot)
    shareEquipmentGeometry(pivot)
  }

  private static buildPickupMeshUnshared(weaponId: string, isArrowPack: boolean, colorHex: number, pivot: THREE.Group): void {
    if (isArrowPack) {
      const mat = new THREE.MeshStandardMaterial({ color: colorHex, emissive: colorHex, emissiveIntensity: 0.3 })
      for (let i = 0; i < 5; i++) {
        const arrow = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.72, 6), mat)
        arrow.position.set((i - 2) * 0.035, 0.45, 0)
        pivot.add(arrow)
      }
    } else if (WEAPONS[weaponId]?.combatKind === 'javelin') {
      const pilumGroup = new THREE.Group()
      this.buildNpcRanged('roman', WEAPONS[weaponId].tier, pilumGroup)
      pilumGroup.scale.setScalar(0.62)
      pilumGroup.position.y = 0.2
      pivot.add(pilumGroup)
    } else if (weaponId.includes('bow')) {
      const bowGroup = new THREE.Group()
      this.buildRanged(weaponId, bowGroup)
      bowGroup.scale.setScalar(0.62)
      bowGroup.rotation.z = Math.PI / 2
      bowGroup.position.y = 0.45
      pivot.add(bowGroup)
    } else if (weaponId.includes('shield') || weaponId.includes('scutum')) {
      WeaponMeshFactory.buildShield(weaponId, pivot)
      pivot.position.y = 0.5
    } else {
      const swordGroup = new THREE.Group()
      this.buildMelee(weaponId, swordGroup)
      swordGroup.scale.setScalar(0.62)
      swordGroup.position.y = 0.2
      pivot.add(swordGroup)
    }
  }

  /**
   * 建構 NPC 專用近戰武器（含羅馬/維京差異）
   */
  static buildRomanGladius(tier: number, pivot: THREE.Group): THREE.Vector3 {
    const result = this.buildRomanGladiusUnshared(tier, pivot)
    shareEquipmentGeometry(pivot)
    return result
  }

  private static buildRomanGladiusUnshared(tier: number, pivot: THREE.Group): THREE.Vector3 {
    pivot.userData.gripCenterLocal = [0, 0.1, 0]
    let bladeColor = 0x80664e
    const bladeLength = 0.68
    const bladeWidth = 0.105
    let metalness = 0.72

    if (tier === 2) {
      bladeColor = 0xbfc3c3
      metalness = 0.8
    } else if (tier === 3) {
      bladeColor = 0xd6d2b4
      metalness = 1.0
    }

    const bladeMat = proceduralMaterial({ kind: 'iron', color: bladeColor, metalness: tier === 1 ? 0.45 : metalness, roughness: tier === 1 ? 0.88 : 0.3, repeat: [tier + 1, 5] })
    const handleMat = proceduralMaterial({ kind: 'leather', color: tier === 3 ? 0x4d241c : 0x3a2117, roughness: 0.82, repeat: [2, tier + 2] })
    const pommelMat = proceduralMaterial({ kind: tier === 3 ? 'bronze' : 'iron', color: tier === 3 ? 0xb38a4c : 0x575b5d, metalness: 0.8, roughness: 0.38 })

    const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), pommelMat)
    pommel.scale.y = 0.78
    pivot.add(pommel)
    const wraps = addWrappedGrip(pivot, 0.16, 0.028, 0.1, handleMat, pommelMat)
    const guard = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 8), pommelMat)
    guard.scale.set(1.3, 0.38, 0.65)
    if (tier === 1) guard.scale.x *= 0.8
    if (tier === 3) guard.scale.x *= 1.2
    guard.position.y = 0.2
    pivot.add(guard)
    const widths = tier === 1 ? [0.065, 0.083, 0.074, 0.046, 0.004]
      : tier === 3 ? [0.095, 0.135, 0.12, 0.07, 0.004] : [bladeWidth * 0.72, bladeWidth, bladeWidth * 0.92, bladeWidth * 0.58, 0.004]
    const blade = equipmentDetail(equipmentShadowUntil(new THREE.Mesh(profiledBladeGeometry(bladeLength, widths, 0.034), bladeMat), 1), 1)
    blade.position.y = 0.2
    blade.name = 'roman-gladius-profiled-blade'
    pivot.add(blade)
    const inlays: THREE.Mesh[] = []
    if (tier === 3) for (const z of [-0.024, 0.02]) for (const y of [0.34, 0.49, 0.64]) {
      const inlay = diamondInlay(0, y, z, 0.05, 0.09, pommelMat)
      pivot.add(inlay); inlays.push(inlay)
    }
    const gripMetal = equipmentDetail(equipmentShadowUntil(mergeRigidGeometryParts([pommel, ...wraps, guard, ...inlays], pommelMat, 'gladius-grip-metal'), 1), 1)
    pivot.add(gripMetal)
    pivot.add(createLod2MergedProxy([blade, gripMetal], bladeMat, 'gladius-lod2-proxy'))
    return new THREE.Vector3(0, 0.2 + bladeLength, 0)
  }

  static buildNpcMelee(characterFaction: CharacterFaction, tier: number, isLance: boolean, pivot: THREE.Group, weaponId?: string): THREE.Vector3 {
    if (weaponId && NON_PROCEDURAL_MELEE_IDS.has(weaponId)) {
      const result = this.buildNpcMeleeUnshared(characterFaction, tier, isLance, pivot, weaponId)
      shareEquipmentGeometry(pivot)
      return result
    }
    const cacheKey = `${characterFaction}|${tier}|${isLance ? 1 : 0}|${weaponId ?? ''}`
    let entry = npcMeleeTemplateCache.get(cacheKey)
    if (!entry) {
      const template = new THREE.Group()
      const tipLocal = this.buildNpcMeleeUnshared(characterFaction, tier, isLance, template, weaponId)
      shareEquipmentGeometry(template)
      entry = { template, tipLocal, pivotUserData: cloneUserDataRecord(template.userData) }
      npcMeleeTemplateCache.set(cacheKey, entry)
    }
    for (const key of PROCEDURAL_MELEE_USER_DATA_KEYS) delete pivot.userData[key]
    for (const key of Object.keys(entry.pivotUserData)) {
      pivot.userData[key] = cloneUserDataValue(entry.pivotUserData[key])
    }
    pivot.rotation.set(0, 0, 0)
    appendClonedEquipmentChildren(entry.template, pivot)
    return entry.tipLocal!.clone()
  }

  private static buildNpcMeleeUnshared(characterFaction: CharacterFaction, tier: number, isLance: boolean, pivot: THREE.Group, weaponId?: string): THREE.Vector3 {
    if (weaponId && WEAPONS[weaponId]?.combatKind === 'sword') pivot.userData.meleeAnimationKind = WEAPONS[weaponId].animationKind
    else delete pivot.userData.meleeAnimationKind
    if (weaponId) {
      if (weaponId.startsWith('gladius_') || weaponId === 'centurion_blade') {
        const gladiusTier = weaponId === 'gladius_rusty' ? 1 : weaponId === 'gladius_standard' ? 2 : 3
        return this.buildRomanGladiusUnshared(gladiusTier, pivot)
      }
      return this.buildMeleeUnshared(weaponId, pivot).tipLocal
    }
    if (isLance) return this.buildMeleeUnshared(tier === 1 ? 'hunting_spear' : tier === 3 ? 'heavy_lance' : 'steel_lance', pivot).tipLocal

    if (characterFaction === 'viking') {
      const wId = tier === 1 ? 'rusty_dagger' : tier === 2 ? 'steel_sword' : 'runic_greatsword'
      return this.buildMeleeUnshared(wId, pivot).tipLocal
    }
    return this.buildRomanGladiusUnshared(tier, pivot)
  }

  /**
   * 建構 NPC 專用遠程武器（羅馬標槍 vs 維京弓）
   */
  static buildNpcRanged(characterFaction: CharacterFaction, tier: number, pivot: THREE.Group): NpcRangedMeshParts {
    const result = this.buildNpcRangedUnshared(characterFaction, tier, pivot)
    shareEquipmentGeometry(pivot)
    return result
  }

  private static buildNpcRangedUnshared(characterFaction: CharacterFaction, tier: number, pivot: THREE.Group): NpcRangedMeshParts {
    if (characterFaction === 'roman') {
      // Roman Pilum (Javelin)
      const woodMat = proceduralMaterial({ kind: 'wood', color: tier === 1 ? 0x71604b : tier === 3 ? 0x3c2926 : 0x68452c, roughness: tier === 1 ? 0.95 : 0.78, repeat: [2, 7] })
      const ironMat = proceduralMaterial({ kind: 'iron', color: tier === 1 ? 0x80664e : tier === 3 ? 0xd4d4cb : 0x777d7f, roughness: tier === 1 ? 0.88 : 0.36, metalness: tier === 1 ? 0.45 : 0.82 })
      const goldMat = proceduralMaterial({ kind: 'bronze', color: 0xa98248, roughness: 0.4, metalness: 0.74 })

      const shaft = equipmentDetail(equipmentShadowUntil(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.021, 1.2, 10), woodMat), 1), 1)
      shaft.position.y = 0.6
      pivot.add(shaft)

      const socket = equipmentShadowUntil(equipmentDetail(new THREE.Mesh(new THREE.CylinderGeometry(0.027, 0.023, 0.16, 10), ironMat), 1), -1)
      socket.position.y = 1.24
      pivot.add(socket)

      if (tier === 1) {
        const head = equipmentDetail(equipmentShadowUntil(new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.15, 4), ironMat), 1), 1)
        head.position.y = 1.275
        pivot.add(head)
        pivot.add(createLod2MergedProxy([shaft, head], woodMat, 'pilum-lod2-proxy'))
      } else if (tier === 2) {
        const neck = equipmentDetail(equipmentShadowUntil(new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.013, 0.4, 8), ironMat), 1), 1)
        neck.position.y = 1.4
        pivot.add(neck)

        const head = equipmentDetail(equipmentShadowUntil(new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.13, 4), ironMat), 1), 1)
        head.position.y = 1.65
        pivot.add(head)
        pivot.add(createLod2MergedProxy([shaft, neck, head], woodMat, 'pilum-lod2-proxy'))
      } else {
        const neck = equipmentDetail(equipmentShadowUntil(new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.014, 0.5, 8), ironMat), 1), 1)
        neck.position.y = 1.45
        pivot.add(neck)

        const bands: THREE.Mesh[] = []
        for (const y of [0.3, 0.36, 1.10, 1.18]) {
          const band = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.045, 10), goldMat)
          band.position.y = y
          pivot.add(band); bands.push(band)
        }
        pivot.add(equipmentShadowUntil(equipmentDetail(mergeRigidGeometryParts(bands, goldMat, 'pilum-gold-bands'), 0), -1))

        const head = equipmentDetail(equipmentShadowUntil(new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.15, 4), ironMat), 1), 1)
        head.position.y = 1.775
        pivot.add(head)
        pivot.add(createLod2MergedProxy([shaft, neck, head], woodMat, 'pilum-lod2-proxy'))
      }

      return {}
    } else {
      // Viking Bow
      const bowMat = new THREE.MeshLambertMaterial({ color: 0x5c3a21, flatShading: true })

      const upperCurve = equipmentDetail(equipmentShadowUntil(new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.025, 0.5, 6), bowMat), 1), 1)
      upperCurve.position.set(0, 0.25, 0)
      upperCurve.rotation.z = -0.1
      pivot.add(upperCurve)

      const lowerCurve = equipmentDetail(equipmentShadowUntil(new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.015, 0.5, 6), bowMat), 1), 1)
      lowerCurve.position.set(0, -0.25, 0)
      lowerCurve.rotation.z = 0.1
      pivot.add(lowerCurve)
      pivot.add(createLod2MergedProxy([upperCurve, lowerCurve], bowMat, 'viking-bow-lod2-proxy'))

      const stringMat = new THREE.MeshLambertMaterial({ color: 0xdddddd, flatShading: true })
      const stringTop = equipmentDetail(equipmentShadowUntil(new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.5, 4), stringMat), -1), 1)
      const stringBottom = equipmentDetail(equipmentShadowUntil(new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.5, 4), stringMat), -1), 1)
      pivot.add(stringTop, stringBottom)

      const nockedArrow = new THREE.Group()
      equipmentShadowUntil(nockedArrow, -1)
      const shaft = equipmentDetail(equipmentShadowUntil(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.8, 6), bowMat), -1), 1)
      shaft.rotation.x = Math.PI / 2
      nockedArrow.add(shaft)
      const arrowHead = equipmentDetail(equipmentShadowUntil(new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.1, 6), new THREE.MeshLambertMaterial({ color: 0xaaaaaa })), -1), 1)
      arrowHead.rotation.x = -Math.PI / 2
      arrowHead.position.z = -0.45
      nockedArrow.add(arrowHead)
      pivot.add(nockedArrow)
      return { stringTop, stringBottom, nockedArrow }
    }
  }

  /**
   * 建構盾牌的 3D mesh group，附加到指定 pivot
   */
  static buildShield(shieldId: string, pivot: THREE.Group): void {
    if (HIGH_TIER_SHIELD_IDS.has(shieldId)) {
      this.buildShieldUnshared(shieldId, pivot)
      shareEquipmentGeometry(pivot)
      return
    }
    let entry = proceduralShieldTemplateCache.get(shieldId)
    if (!entry) {
      const template = new THREE.Group()
      this.buildShieldUnshared(shieldId, template)
      shareEquipmentGeometry(template)
      entry = { template, pivotUserData: cloneUserDataRecord(template.userData) }
      proceduralShieldTemplateCache.set(shieldId, entry)
    }
    for (const key of Object.keys(entry.pivotUserData)) {
      pivot.userData[key] = cloneUserDataValue(entry.pivotUserData[key])
    }
    appendClonedEquipmentChildren(entry.template, pivot)
  }

  private static buildShieldUnshared(shieldId: string, pivot: THREE.Group): void {
    pivot.userData.gripCenterLocal = [0, 0, 0.085]
    const isRoman = shieldId.startsWith('scutum')
    const tier = parseInt(shieldId.split('_t')[1]) || 1
    const iron = proceduralMaterial({ kind: 'iron', color: tier === 1 ? 0x77604e : tier === 3 ? 0xbfc2bd : 0x686d70, roughness: tier === 1 ? 0.88 : 0.4, metalness: tier === 1 ? 0.45 : 0.82 })
    const bronze = proceduralMaterial({ kind: 'bronze', color: 0xa47b42, roughness: 0.43, metalness: 0.72 })
    const leather = proceduralMaterial({ kind: 'leather', color: 0x3d281d, roughness: 0.86 })

    const factionShield = shieldId === 'roman_officer_shield_t4' || shieldId === 'viking_berserker_shield_t5'
    const eagleShield = shieldId === 'byzantine_eagle_shield_t5' || shieldId === 'centurion_aquila_shield_t4' || shieldId === 'viking_dragonward_shield_t4'
    if (shieldId === 'paladin_shield_t4' || shieldId === 'commander_shield_t5' || factionShield || eagleShield) {
      const commander = shieldId === 'commander_shield_t5'
      if (eagleShield) attachByzantineEquipment(shieldId, pivot)
      else pivot.add(equipmentDetail(factionShield ? createFactionShield(shieldId) : commander ? createT5Shield() : createPaladinEquipment('paladin_shield_t4'), 1))
      const mats = highTierMaterials()
      const isRound = shieldId === 'viking_berserker_shield_t5' || shieldId === 'viking_dragonward_shield_t4' || shieldId === 'byzantine_eagle_shield_t5'
      const proxy = createSharedLod2ProxyMesh(
        isRound ? 'high-tier-round-shield' : 'high-tier-scutum-shield',
        () => isRound
          ? new THREE.CylinderGeometry(0.41, 0.41, 0.052, 8)
          : bendShieldGeometry(new THREE.BoxGeometry(0.56, 0.94, 0.05, 2, 2, 1), 0.56, 0.11),
        shieldId === 'commander_shield_t5' || shieldId === 'paladin_shield_t4' ? mats.steel
          : shieldId === 'byzantine_eagle_shield_t5' || shieldId === 'viking_dragonward_shield_t4' ? mats.blue : mats.bronze,
      )
      if (isRound) {
        proxy.rotation.x = Math.PI / 2
        proxy.position.z = 0.16
      } else {
        proxy.position.z = 0.14
      }
      pivot.add(proxy)
      // Laurelguard's front is +Z, but its central rear is near Z=0 rather than
      // Paladin's +.13. Keep the original GLB axes and move only its rear grip.
      const gripZ = commander ? -.085 : .085
      pivot.userData.gripCenterLocal = [0, 0, gripZ]
      // Same central vertical grip geometry and frame as the existing shields.
      const rearGrip = equipmentShadowUntil(new THREE.Mesh(paladinGripGeometry ??= new THREE.CapsuleGeometry(.024, .2, 4, 8), leather), -1)
      rearGrip.position.set(0, 0, gripZ)
      rearGrip.name = 'shield-rear-grip'
      pivot.add(equipmentDetail(rearGrip, 0))
      for (const y of [-.10, .10]) {
        const mount = new THREE.Mesh(paladinGripMountGeometry ??= new THREE.BoxGeometry(.055, .035, .17), leather)
        mount.name = 'shield-grip-mount'
        mount.position.set(0, y, .16)
        if (commander) {
          // Measured rear surface at Y=-.10 / +.10 is -.0187 / +.0077.
          // The mounts seat ~1cm into that lining, never through the front.
          const rearSeatZ = y < 0 ? -.008 : .018
          mount.position.z = (gripZ + rearSeatZ) / 2
          mount.scale.z = (rearSeatZ - gripZ) / .17
        }
        if (eagleShield) {
          // Measured rear surface behind the boss (builder rearCenterZ): .155 eagle, .255 curved Aquila scutum, .2145 dished Dragonward.
          // Seat the mounts 1 cm into it rather than through the painted face.
          const rearSeatZ = shieldId === 'centurion_aquila_shield_t4' ? .265 : shieldId === 'viking_dragonward_shield_t4' ? .2245 : .165
          mount.position.z = (gripZ + rearSeatZ) / 2
          mount.scale.z = (rearSeatZ - gripZ) / .17
        }
        pivot.add(equipmentDetail(equipmentShadowUntil(mount, -1), 0))
      }
      return
    }

    if (isRoman) {
      const width = 0.58, height = 0.98, depth = 0.055, curve = 0.13, boardZ = 0.02
      const frontZ = boardZ + depth / 2
      const boardMat = proceduralMaterial({ kind: tier === 1 ? 'wood' : 'leather', color: tier === 1 ? 0x75604a : tier === 3 ? 0x491b25 : 0x7f211d, roughness: tier === 1 ? 0.96 : 0.78, repeat: [4, 5] })
      const board = equipmentDetail(equipmentShadowUntil(new THREE.Mesh(bendShieldGeometry(new THREE.BoxGeometry(width, height, depth, 12, 14, 1), width, curve), boardMat), 1), 1)
      board.position.z = boardZ
      board.name = 'curved-scutum-board'
      board.castShadow = true
      board.receiveShadow = true
      pivot.add(board)
      const boardLod2 = equipmentLod2Proxy(equipmentShadowUntil(new THREE.Mesh(bendShieldGeometry(new THREE.BoxGeometry(width, height, depth, 2, 2, 1), width, curve), boardMat), -1))
      boardLod2.position.z = boardZ
      boardLod2.name = 'scutum-lod2-proxy'
      boardLod2.receiveShadow = true
      pivot.add(boardLod2)
      const rim = equipmentDetail(equipmentShadowUntil(curvedRectangleRim(width, height, curve, frontZ, tier === 3 ? 0.03 : 0.022, tier === 3 ? bronze : tier === 2 ? iron : leather), 0), 1)
      rim.name = 'scutum-rim'
      pivot.add(rim)

      const boss = equipmentDetail(equipmentShadowUntil(new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 10), tier === 3 ? bronze : iron), -1), 1)
      boss.position.set(0, 0, frontZ + curve + 0.025)
      boss.scale.z = 0.58
      boss.name = 'shield-boss'
      pivot.add(boss)
      const emblemMat = tier === 1 ? leather : tier === 3 ? bronze : proceduralMaterial({ kind: 'bronze', color: 0x9a7445, roughness: 0.55, metalness: 0.5 })
      const emblems: THREE.Mesh[] = []
      for (const rotation of tier === 1 ? [0, 0.15] : [Math.PI / 4, -Math.PI / 4]) {
        // Bend in shield space after rotating so the whole ornament follows the face.
        const geometry = new THREE.BoxGeometry(0.035, 0.34, 0.012, 1, 5, 1)
        geometry.rotateZ(rotation)
        geometry.translate(tier === 1 ? (rotation === 0 ? -0.18 : 0.16) : 0, tier === 1 ? -0.1 : 0.08, frontZ + 0.003)
        const wing = new THREE.Mesh(bendShieldGeometry(geometry, width, curve), emblemMat)
        wing.name = 'scutum-emblem'
        pivot.add(wing)
        emblems.push(wing)
      }
      if (tier === 3) for (const y of [-0.32, 0.32]) {
        const inlay = diamondInlay(0, y, 0, 0.16, 0.21, emblemMat, 4)
        inlay.geometry.translate(0, 0, frontZ + 0.003)
        bendShieldGeometry(inlay.geometry, width, curve)
        pivot.add(inlay); emblems.push(inlay)
        for (const x of [-0.19, 0.19]) {
          const stud = diamondInlay(0, y, 0, 0.035, 0.06, emblemMat, 4)
          stud.geometry.translate(x, 0, frontZ + 0.003)
          bendShieldGeometry(stud.geometry, width, curve)
          pivot.add(stud); emblems.push(stud)
        }
      }
      pivot.add(equipmentShadowUntil(equipmentDetail(mergeRigidGeometryParts(emblems, emblemMat, 'scutum-emblem'), 1), -1))
      const rearGrip = equipmentShadowUntil(new THREE.Mesh(new THREE.CapsuleGeometry(0.024, 0.2, 4, 8), leather), -1)
      rearGrip.position.set(0, 0, 0.085)
      rearGrip.name = 'shield-rear-grip'
      pivot.add(equipmentDetail(rearGrip, 0))
    } else {
      const wood = proceduralMaterial({ kind: 'wood', color: 0x75604a, roughness: 0.96, repeat: [5, 3] })
      const paint = proceduralMaterial({ kind: 'wood', color: tier === 3 ? 0x294d64 : 0x435443, roughness: 0.82, repeat: [5, 3] })
      const boardMat = tier >= 2 ? paint : wood
      const board = equipmentDetail(equipmentShadowUntil(new THREE.Mesh(new THREE.CylinderGeometry(0.41, 0.41, 0.052, 32), boardMat), 1), 1)
      board.rotation.x = Math.PI / 2
      board.position.z = 0.15
      board.name = 'round-shield-board'
      board.castShadow = true
      pivot.add(board)
      const boardLod2 = equipmentLod2Proxy(equipmentShadowUntil(new THREE.Mesh(new THREE.CylinderGeometry(0.41, 0.41, 0.052, 8), boardMat), -1))
      boardLod2.rotation.x = Math.PI / 2
      boardLod2.position.z = 0.15
      boardLod2.name = 'round-shield-lod2-proxy'
      boardLod2.receiveShadow = true
      pivot.add(boardLod2)
      const leatherDetails: THREE.Mesh[] = []
      for (let seam = -3; seam <= 3; seam++) {
        const line = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.72 - Math.abs(seam) * 0.055, 0.008), leather)
        line.position.set(seam * 0.1, 0, 0.18)
        if (tier === 1) line.rotation.z = seam % 2 * 0.025
        pivot.add(line)
        leatherDetails.push(line)
      }
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.41, tier === 3 ? 0.03 : 0.023, 10, 32), tier === 3 ? bronze : tier === 2 ? iron : leather)
      rim.position.z = 0.18
      pivot.add(equipmentShadowUntil(equipmentDetail(rim, 1), 0))
      const boss = equipmentDetail(equipmentShadowUntil(new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 10), tier === 3 ? bronze : iron), -1), 1)
      boss.position.set(0, 0, 0.205)
      boss.scale.z = 0.58
      boss.name = 'shield-boss'
      pivot.add(boss)
      for (const y of [-0.14, 0.14]) {
        const rearStrap = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.045, 0.025, 4, 1, 1), leather)
        rearStrap.position.set(0, y, 0.11)
        rearStrap.name = 'shield-rear-strap'
        pivot.add(rearStrap)
        leatherDetails.push(rearStrap)
      }
      pivot.add(equipmentShadowUntil(equipmentDetail(mergeRigidGeometryParts(leatherDetails, leather, 'shield-rear-strap'), 0), -1))
      const rearGrip = equipmentShadowUntil(new THREE.Mesh(new THREE.CapsuleGeometry(0.024, 0.2, 4, 8), leather), -1)
      rearGrip.position.set(0, 0, 0.085)
      rearGrip.name = 'shield-rear-grip'
      pivot.add(equipmentDetail(rearGrip, 0))
      if (tier === 3) {
        const bossDetails: THREE.Mesh[] = [boss]
        for (let index = 0; index < 8; index++) {
          const angle = index / 8 * Math.PI * 2
          const inlay = diamondInlay(Math.sin(angle) * 0.25, Math.cos(angle) * 0.25, 0.19, 0.055, 0.18, bronze)
          inlay.rotation.z = -angle
          pivot.add(inlay); bossDetails.push(inlay)
        }
        for (let index = 0; index < 8; index++) {
          const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.018, 7, 5), bronze)
          const angle = index / 8 * Math.PI * 2
          rivet.position.set(Math.cos(angle) * 0.31, Math.sin(angle) * 0.31, 0.202)
          pivot.add(rivet)
          bossDetails.push(rivet)
        }
        pivot.add(equipmentDetail(equipmentShadowUntil(mergeRigidGeometryParts(bossDetails, bronze, 'shield-boss'), -1), 1))
      }
    }
  }
}
