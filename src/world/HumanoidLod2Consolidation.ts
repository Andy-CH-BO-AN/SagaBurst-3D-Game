import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { materialRenderContract, sameMaterialRenderContract, type MaterialRenderContract } from './MaterialRenderContract'
import { copyMergedSeatSupport, copyMultiMergedSeatSupport } from './SkinnedSeatContact'

interface ConsolidationPair {
  first: string
  second: string
  firstMaterial: string
  secondMaterial: string
}

export const AUDITED_ROMAN_LOD2_SHA256 = 'da0e01209829add4e477699fb34abb6981a178f88e016422c2df5b1db10d9390'
export const ROMAN_LOD2_CULLED_TINY_DETAIL_NAMES = ['New_eye', 'New_eye_2', 'Dangles'] as const

export function isRomanLod2ConsolidationAssetAudited(actualSha256: string | undefined): boolean {
  return actualSha256 === AUDITED_ROMAN_LOD2_SHA256
}

/** Hide only the audited far-LOD details, whether eyes are consolidated or original. */
export function cullRomanLod2TinyDetails(root: THREE.Object3D): void {
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return
    const sourceParts = object.userData.sourceParts
    const isConsolidatedEye = Array.isArray(sourceParts)
      && sourceParts.some(part => part === 'New_eye' || part === 'New_eye_2')
    if (isConsolidatedEye || ROMAN_LOD2_CULLED_TINY_DETAIL_NAMES.includes(object.name as typeof ROMAN_LOD2_CULLED_TINY_DETAIL_NAMES[number])) {
      object.visible = false
    }
  })
}

const ROMAN_LOD2_PAIRS: readonly ConsolidationPair[] = [
  { first: 'Armour_top_1', second: 'Armour_top_2', firstMaterial: 'Armour_top0', secondMaterial: 'Armour_top1' },
  { first: 'Helmet3_1', second: 'Helmet3_2', firstMaterial: 'Helmet30', secondMaterial: 'Helmet31' },
  { first: 'New_eye', second: 'New_eye_2', firstMaterial: 'New_eye0', secondMaterial: 'New_eye_20' },
  { first: 'RomanUndertunic_l', second: 'RomanUndertunic_r', firstMaterial: 'RomanUndertunic', secondMaterial: 'RomanUndertunic' },
]

interface ConsolidationRecord {
  first: THREE.SkinnedMesh
  second: THREE.SkinnedMesh
  merged: THREE.SkinnedMesh
}

interface ConsolidationTemplateRecord {
  pair: ConsolidationPair
  firstGeometry: THREE.BufferGeometry
  secondGeometry: THREE.BufferGeometry
  mergedGeometry: THREE.BufferGeometry
}

/**
 * Immutable geometry cache prepared from the canonical Roman LOD2 template.
 * Every character instance receives fresh SkinnedMesh objects and skeletons,
 * but uses these four shared merged BufferGeometry objects.
 */
export interface RomanLod2ConsolidationTemplate {
  readonly records: readonly ConsolidationTemplateRecord[]
}

export interface HumanoidLod2RepresentationControl {
  setOptimized(enabled: boolean): void
  getOptimized(): boolean
}

function findSkinnedMesh(root: THREE.Object3D, name: string): THREE.SkinnedMesh {
  let found: THREE.SkinnedMesh | undefined
  root.traverse(object => {
    if (!found && object instanceof THREE.SkinnedMesh && object.name === name) found = object
  })
  if (!found) throw new Error(`Roman LOD2 consolidation is missing ${name}`)
  return found
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Roman LOD2 consolidation: ${message}`)
}

/** The source GLB keeps these pairs as duplicate material records. Runtime image
 * identity may differ because GLTFLoader decodes equivalent embedded bytes twice,
 * so the byte-level equivalence is guarded in the asset-contract test. */
function assertEquivalentMaterials(a: THREE.Material, b: THREE.Material, expected: ConsolidationPair): void {
  assert(a.name === expected.firstMaterial && b.name === expected.secondMaterial,
    `unexpected materials for ${expected.first}/${expected.second}`)
  assert(sameMaterialRenderContract(materialRenderContract(a), materialRenderContract(b)),
  `material render state differs for ${expected.first}/${expected.second}`)
}

function assertMergeCompatible(first: THREE.SkinnedMesh, second: THREE.SkinnedMesh, expected: ConsolidationPair): void {
  assert(first.parent && first.parent === second.parent, `${expected.first}/${expected.second} do not share a parent`)
  assert(first.skeleton.bones.length === second.skeleton.bones.length
    && first.skeleton.bones.every((bone, index) => bone === second.skeleton.bones[index])
    && first.skeleton.boneInverses.length === second.skeleton.boneInverses.length
    && first.skeleton.boneInverses.every((inverse, index) => inverse.equals(second.skeleton.boneInverses[index])),
  `${expected.first}/${expected.second} skeleton bones or inverses differ`)
  assert(first.bindMode === second.bindMode && first.bindMatrix.equals(second.bindMatrix)
    && first.bindMatrixInverse.equals(second.bindMatrixInverse),
  `${expected.first}/${expected.second} bind matrices differ`)
  assert(!first.morphTargetInfluences && !second.morphTargetInfluences,
    `${expected.first}/${expected.second} unexpectedly has morph targets`)
  assert(first.matrix.equals(second.matrix) && first.matrixAutoUpdate === second.matrixAutoUpdate,
    `${expected.first}/${expected.second} local transforms differ`)
  assert(!Array.isArray(first.material) && !Array.isArray(second.material),
    `${expected.first}/${expected.second} unexpectedly has material groups`)
  assertEquivalentMaterials(first.material, second.material, expected)
  const a = Object.keys(first.geometry.attributes).sort()
  const b = Object.keys(second.geometry.attributes).sort()
  assert(JSON.stringify(a) === JSON.stringify(b), `${expected.first}/${expected.second} geometry attributes differ`)
  for (const name of a) {
    const firstAttribute = first.geometry.getAttribute(name)
    const secondAttribute = second.geometry.getAttribute(name)
    assert(firstAttribute.itemSize === secondAttribute.itemSize
      && firstAttribute.normalized === secondAttribute.normalized
      && firstAttribute.array.constructor === secondAttribute.array.constructor,
    `${expected.first}/${expected.second} ${name} attribute format differs`)
  }
  assert(Boolean(first.geometry.index) === Boolean(second.geometry.index),
    `${expected.first}/${expected.second} index coverage differs`)
}

function copyRenderableState(source: THREE.SkinnedMesh, target: THREE.SkinnedMesh, names: readonly string[], prefix = 'roman'): void {
  target.name = `${prefix}-lod2-consolidated-${names.join('-')}`
  target.castShadow = source.castShadow
  target.receiveShadow = source.receiveShadow
  target.frustumCulled = source.frustumCulled
  target.renderOrder = source.renderOrder
  target.visible = source.visible
  target.layers.mask = source.layers.mask
  target.matrixAutoUpdate = source.matrixAutoUpdate
  target.matrix.copy(source.matrix)
  target.matrixWorld.copy(source.matrixWorld)
  target.userData = { ...source.userData, humanoidLod2Consolidated: true, sourceParts: [...names] }
}

function createTemplateRecord(root: THREE.Object3D, pair: ConsolidationPair): ConsolidationTemplateRecord {
  const first = findSkinnedMesh(root, pair.first)
  const second = findSkinnedMesh(root, pair.second)
  assertMergeCompatible(first, second, pair)
  const mergedGeometry = mergeGeometries([first.geometry, second.geometry], false)
  assert(mergedGeometry, `failed to merge ${pair.first}/${pair.second}`)
  mergedGeometry.computeBoundingBox()
  mergedGeometry.computeBoundingSphere()
  return { pair, firstGeometry: first.geometry, secondGeometry: second.geometry, mergedGeometry }
}

function mergeInstancePair(root: THREE.Object3D, template: ConsolidationTemplateRecord, prefix = 'roman'): ConsolidationRecord {
  const { pair } = template
  const first = findSkinnedMesh(root, pair.first)
  const second = findSkinnedMesh(root, pair.second)
  assert(first.parent && first.parent === second.parent, `${pair.first}/${pair.second} do not share a parent`)
  assert(first.geometry === template.firstGeometry && second.geometry === template.secondGeometry,
    `${pair.first}/${pair.second} instance geometry does not match the canonical template`)
  assert(first.skeleton.bones.length === second.skeleton.bones.length
    && first.skeleton.bones.every((bone, index) => bone === second.skeleton.bones[index])
    && first.skeleton.boneInverses.length === second.skeleton.boneInverses.length
    && first.skeleton.boneInverses.every((inverse, index) => inverse.equals(second.skeleton.boneInverses[index])),
  `${pair.first}/${pair.second} instance skeleton bones or inverses differ`)
  assert(first.bindMode === second.bindMode && first.bindMatrix.equals(second.bindMatrix)
    && first.bindMatrixInverse.equals(second.bindMatrixInverse),
  `${pair.first}/${pair.second} instance bind matrices differ`)
  assert(!Array.isArray(first.material), `${pair.first} unexpectedly has material groups`)
  const merged = new THREE.SkinnedMesh(template.mergedGeometry, first.material)
  merged.bind(first.skeleton, first.bindMatrix)
  // Keep the inherited template bounds so the first frustum test never CPU-skins the merge.
  if (first.boundingSphere && second.boundingSphere) merged.boundingSphere = first.boundingSphere.clone().union(second.boundingSphere)
  copyRenderableState(first, merged, [pair.first, pair.second], prefix)
  // Mounted riders seat on these landmarks; the Varangian body is its pair's second mesh.
  copyMergedSeatSupport(first, second, merged)
  first.parent.add(merged)
  return { first, second, merged }
}

/** Validates and merges the four candidate pairs once for the canonical loaded GLB. */
export function createRomanLod2ConsolidationTemplate(root: THREE.Object3D): RomanLod2ConsolidationTemplate {
  return { records: ROMAN_LOD2_PAIRS.map(pair => createTemplateRecord(root, pair)) }
}

/**
 * Consolidation is an optional render optimization, never an asset-load contract.
 * An updated but otherwise valid Roman GLB can keep its original LOD2 structure
 * until its pair definitions are re-audited.
 */
export function tryCreateRomanLod2ConsolidationTemplate(
  root: THREE.Object3D,
  onUnavailable: (message: string, error: unknown) => void = (message, error) => console.warn(message, error),
): RomanLod2ConsolidationTemplate | undefined {
  try {
    return createRomanLod2ConsolidationTemplate(root)
  } catch (error) {
    onUnavailable('Roman LOD2 consolidation unavailable; using original render structure', error)
    return undefined
  }
}

function devControlEnabled(): boolean {
  return import.meta.env.DEV && typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).has('humanoidLod2Control')
}

/**
 * Replaces four verified duplicate-material SkinnedMesh pairs in Roman LOD2.
 * It preserves every vertex attribute, index, skeleton, bind matrix and triangle;
 * only equivalent material records are made into one skinned renderable.
 */
export function consolidateRomanLod2(
  root: THREE.Object3D,
  template: RomanLod2ConsolidationTemplate,
  options: { allowDevControl?: boolean } = {},
): HumanoidLod2RepresentationControl | undefined {
  const records = template.records.map(record => mergeInstancePair(root, record))
  const allowControl = options.allowDevControl !== false && devControlEnabled()
  let optimized = true
  const setOptimized = (enabled: boolean) => {
    optimized = enabled
    for (const { first, second, merged } of records) {
      first.visible = !enabled
      second.visible = !enabled
      merged.visible = enabled
    }
  }
  setOptimized(true)
  if (!allowControl) {
    for (const { first, second } of records) {
      first.parent!.remove(first)
      second.parent!.remove(second)
    }
    return undefined
  }
  return { setOptimized, getOptimized: () => optimized }
}

/* ── Blue-Cloaked Varangian Captain (viking-hero-t4) ──────────────────────────
 * Its LOD2 keeps the source's 7 skinned primitives (5 materials) at every
 * distance. Two same-material pairs become one renderable each, and three
 * sub-100-triangle fill parts are hidden at LOD2 (>30 m), like Roman eyes. */
// Re-audited after the runtime budget pass: accessor data and scene/skin/animation JSON are identical
// to the previously audited 89d39636…; only embedded images became KTX2.
export const AUDITED_VIKING_CAPTAIN_LOD2_SHA256 = 'ee0397320f276c25a981bd63720ac7f3e725af88aa6ab406fbb8a737dda8a3cd'
export const VIKING_CAPTAIN_LOD2_CULLED_TINY_DETAIL_NAMES = ['Restored_hidden_torso', 'Restored_neck', 'Tailored_inner_neckline'] as const
const VIKING_CAPTAIN_PALM_MATERIAL = 'Original atlas skin patch, new digit normals'
const VIKING_CAPTAIN_LOD2_PAIRS: readonly ConsolidationPair[] = [
  { first: 'Coherent_Skirt_Support', second: 'Varangian_Captain', firstMaterial: 'BakedMaterial.001', secondMaterial: 'BakedMaterial.001' },
  { first: 'Rebuilt_Hand_l', second: 'Rebuilt_Hand_r', firstMaterial: VIKING_CAPTAIN_PALM_MATERIAL, secondMaterial: VIKING_CAPTAIN_PALM_MATERIAL },
]

export function isVikingCaptainLod2AssetAudited(actualSha256: string | undefined): boolean {
  return actualSha256 === AUDITED_VIKING_CAPTAIN_LOD2_SHA256
}

/** Each pair is optional: one that fails validation (for example a hand that gained
 * morph targets) keeps its original meshes while the others still merge. */
export function tryCreateVikingCaptainLod2ConsolidationTemplate(
  root: THREE.Object3D,
  onUnavailable: (message: string, error: unknown) => void = (message, error) => console.warn(message, error),
): RomanLod2ConsolidationTemplate {
  const records: ConsolidationTemplateRecord[] = []
  for (const pair of VIKING_CAPTAIN_LOD2_PAIRS) {
    try { records.push(createTemplateRecord(root, pair)) }
    catch (error) { onUnavailable(`Viking captain LOD2 pair ${pair.first}/${pair.second} kept separate`, error) }
  }
  return { records }
}

/** Instance side: merge the validated pairs, drop their originals and hide the fill parts. */
export function consolidateVikingCaptainLod2(root: THREE.Object3D, template: RomanLod2ConsolidationTemplate): void {
  for (const record of template.records) {
    const { first, second } = mergeInstancePair(root, record, 'viking-captain')
    first.parent!.remove(first)
    second.parent!.remove(second)
  }
  root.traverse(object => {
    if (object instanceof THREE.Mesh && VIKING_CAPTAIN_LOD2_CULLED_TINY_DETAIL_NAMES.includes(object.name as typeof VIKING_CAPTAIN_LOD2_CULLED_TINY_DETAIL_NAMES[number])) {
      object.visible = false
    }
  })
}

/* ── Generic Runtime LOD2 Auto-Consolidation ───────────────────────────────── */

export interface GenericLod2ConsolidationGroup {
  readonly names: readonly string[]
  readonly sourceGeometries: readonly THREE.BufferGeometry[]
  readonly mergedGeometry: THREE.BufferGeometry
}

export interface GenericLod2ConsolidationTemplate {
  readonly groups: readonly GenericLod2ConsolidationGroup[]
  readonly culledDetailNames: readonly string[]
}

function matrixAlmostEqual(a: THREE.Matrix4, b: THREE.Matrix4, epsilon = 1e-4): boolean {
  const ae = a.elements
  const be = b.elements
  for (let i = 0; i < 16; i++) {
    if (Math.abs(ae[i] - be[i]) > epsilon) return false
  }
  return true
}

function skeletonsCompatibleForMerge(a: THREE.Skeleton, b: THREE.Skeleton): boolean {
  if (a === b) return true
  if (a.bones.length !== b.bones.length || a.boneInverses.length !== b.boneInverses.length) return false
  for (let i = 0; i < a.bones.length; i++) {
    if (a.bones[i]?.name !== b.bones[i]?.name) return false
    if (!matrixAlmostEqual(a.boneInverses[i], b.boneInverses[i])) return false
  }
  return true
}

const SECONDARY_SKIN_ATTRIBUTES = new Set(['joints_1', 'weights_1'])

function sameContractFieldValue(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    if (a === b) return true
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-7
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length
      && a.every((v, idx) => sameContractFieldValue(v, b[idx]))
  }
  const ra = a as Record<string, unknown>
  const rb = b as Record<string, unknown>
  const ka = Object.keys(ra).sort()
  const kb = Object.keys(rb).sort()
  return ka.length === kb.length && ka.every((k, idx) => k === kb[idx] && sameContractFieldValue(ra[k], rb[k]))
}

/**
 * Checks if a small sub-pixel `Repair_*` atlas patch material shares the primary
 * PBR material's render contract (`map`, `side`, transparency, alphaTest, color)
 * and may safely merge into the primary LOD2 mesh at > 30m.
 */
export function canMergeRepairLod2Patch(a: THREE.Material, b: THREE.Material): boolean {
  const cA: MaterialRenderContract = materialRenderContract(a)
  const cB: MaterialRenderContract = materialRenderContract(b)
  if (sameMaterialRenderContract(cA, cB)) return true
  const aRepair = a.name.startsWith('Repair_')
  const bRepair = b.name.startsWith('Repair_')
  if (aRepair === bRepair) return false
  if (cA.type !== cB.type) return false
  if (!cA.textures.map || !cB.textures.map) return false
  if (!sameContractFieldValue(cA.textures.map, cB.textures.map)) return false
  return cA.flags.side === cB.flags.side
    && cA.flags.transparent === cB.flags.transparent
    && cA.flags.depthWrite === cB.flags.depthWrite
    && cA.flags.depthTest === cB.flags.depthTest
    && cA.flags.blending === cB.flags.blending
    && sameContractFieldValue(cA.scalars.opacity, cB.scalars.opacity)
    && sameContractFieldValue(cA.scalars.alphaTest, cB.scalars.alphaTest)
    && sameContractFieldValue(cA.colors.color, cB.colors.color)
}

function attributeLayoutMatches(a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, b: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): boolean {
  return a.itemSize === b.itemSize
    && a.normalized === b.normalized
    && a.array.constructor === b.array.constructor
}

function geometriesCompatibleForMerge(a: THREE.BufferGeometry, b: THREE.BufferGeometry): boolean {
  if (Boolean(a.index) !== Boolean(b.index)) return false
  if (Object.keys(a.morphAttributes).length > 0 || Object.keys(b.morphAttributes).length > 0) return false
  const keysA = new Set(Object.keys(a.attributes))
  const keysB = new Set(Object.keys(b.attributes))
  const allKeys = new Set([...keysA, ...keysB])
  for (const name of allKeys) {
    const inA = keysA.has(name)
    const inB = keysB.has(name)
    if (inA && inB) {
      if (!attributeLayoutMatches(a.getAttribute(name), b.getAttribute(name))) return false
      continue
    }
    if (!SECONDARY_SKIN_ATTRIBUTES.has(name)) return false
  }
  return true
}

function alignSkinningGeometriesForMerge(geometries: readonly THREE.BufferGeometry[]): THREE.BufferGeometry[] | null {
  const donorByAttr = new Map<string, THREE.BufferAttribute | THREE.InterleavedBufferAttribute>()
  for (const geom of geometries) {
    for (const name of SECONDARY_SKIN_ATTRIBUTES) {
      const attr = geom.getAttribute(name)
      if (!attr) continue
      const existing = donorByAttr.get(name)
      if (!existing) {
        donorByAttr.set(name, attr)
      } else if (!attributeLayoutMatches(existing, attr)) {
        return null
      }
    }
  }
  if (donorByAttr.size === 0) return [...geometries]
  const out: THREE.BufferGeometry[] = []
  for (const geom of geometries) {
    let needsClone = false
    for (const name of donorByAttr.keys()) {
      if (!geom.getAttribute(name)) {
        needsClone = true
        break
      }
    }
    if (!needsClone) {
      out.push(geom)
      continue
    }
    const clone = geom.clone()
    const posCount = clone.getAttribute('position')?.count ?? 0
    for (const [name, donor] of donorByAttr) {
      if (clone.getAttribute(name)) continue
      const Ctor = donor.array.constructor as new (len: number) => THREE.TypedArray
      clone.setAttribute(name, new THREE.BufferAttribute(new Ctor(posCount * donor.itemSize), donor.itemSize, donor.normalized))
    }
    out.push(clone)
  }
  return out
}

function canPairGenericLod2Meshes(a: THREE.SkinnedMesh, b: THREE.SkinnedMesh): boolean {
  if (!a.parent || a.parent !== b.parent) return false
  if (!a.skeleton || !b.skeleton) return false
  if (a.bindMode !== b.bindMode || !matrixAlmostEqual(a.bindMatrix, b.bindMatrix)) return false
  if (!skeletonsCompatibleForMerge(a.skeleton, b.skeleton)) return false
  if (a.morphTargetInfluences?.length || b.morphTargetInfluences?.length) return false
  if (!a.matrix.equals(b.matrix) || a.matrixAutoUpdate !== b.matrixAutoUpdate) return false
  if (Array.isArray(a.material) || Array.isArray(b.material)) return false
  if (!canMergeRepairLod2Patch(a.material, b.material)) return false
  return geometriesCompatibleForMerge(a.geometry, b.geometry)
}

/**
 * Inspects any LOD2 subtree (character or mount) once at template load and merges
 * groups of 2+ SkinnedMeshes that share parent, compatible skeleton, transform,
 * attribute layout, and equivalent material render state.
 */
export function tryCreateGenericLod2ConsolidationTemplate(
  root: THREE.Object3D,
  options: {
    culledDetailNames?: readonly string[]
    skipMesh?: (mesh: THREE.SkinnedMesh) => boolean
  } = {},
): GenericLod2ConsolidationTemplate | undefined {
  const culledDetailNames = options.culledDetailNames ?? []
  const culledSet = new Set(culledDetailNames)
  const candidatesByParent = new Map<THREE.Object3D, THREE.SkinnedMesh[]>()
  const nameCountsByParent = new Map<THREE.Object3D, Map<string, number>>()

  root.traverse(object => {
    if (!(object instanceof THREE.SkinnedMesh) || !object.parent) return
    let counts = nameCountsByParent.get(object.parent)
    if (!counts) {
      counts = new Map()
      nameCountsByParent.set(object.parent, counts)
    }
    counts.set(object.name, (counts.get(object.name) ?? 0) + 1)
    if (!object.visible || !object.name || culledSet.has(object.name)) return
    if (options.skipMesh?.(object)) return
    if (Array.isArray(object.material) || !(object.material instanceof THREE.MeshStandardMaterial)) return
    if (object.morphTargetInfluences?.length || Object.keys(object.geometry.morphAttributes).length > 0) return
    let list = candidatesByParent.get(object.parent)
    if (!list) {
      list = []
      candidatesByParent.set(object.parent, list)
    }
    list.push(object)
  })

  const groups: GenericLod2ConsolidationGroup[] = []
  for (const [parent, list] of candidatesByParent) {
    const counts = nameCountsByParent.get(parent)!
    const unique = list.filter(mesh => counts.get(mesh.name) === 1)
    const visited = new Set<THREE.SkinnedMesh>()
    for (let i = 0; i < unique.length; i++) {
      const seed = unique[i]
      if (visited.has(seed)) continue
      const group: THREE.SkinnedMesh[] = [seed]
      visited.add(seed)
      for (let j = i + 1; j < unique.length; j++) {
        const candidate = unique[j]
        if (visited.has(candidate)) continue
        if (canPairGenericLod2Meshes(seed, candidate)) {
          group.push(candidate)
          visited.add(candidate)
        }
      }
      if (group.length < 2) continue
      // Place non-Repair_ primary mesh first so its full PBR material and vertex ids lead.
      group.sort((a, b) => {
        const aRepair = !Array.isArray(a.material) && a.material.name.startsWith('Repair_') ? 1 : 0
        const bRepair = !Array.isArray(b.material) && b.material.name.startsWith('Repair_') ? 1 : 0
        return aRepair - bRepair
      })
      const sourceGeometries = group.map(mesh => mesh.geometry)
      const alignedGeometries = alignSkinningGeometriesForMerge(sourceGeometries)
      if (!alignedGeometries) continue
      const mergedGeometry = mergeGeometries(alignedGeometries, false)
      if (!mergedGeometry) continue
      mergedGeometry.computeBoundingBox()
      mergedGeometry.computeBoundingSphere()
      groups.push({
        names: group.map(mesh => mesh.name),
        sourceGeometries,
        mergedGeometry,
      })
    }
  }

  if (groups.length === 0 && culledDetailNames.length === 0) return undefined
  return { groups, culledDetailNames }
}

/**
 * Applies a pre-validated generic LOD2 consolidation template to a cloned instance.
 * Returns how many redundant draw-call meshes were consolidated away.
 */
export function consolidateGenericLod2(
  root: THREE.Object3D,
  template: GenericLod2ConsolidationTemplate,
  prefix = 'generic',
): number {
  let removed = 0
  if (template.groups.length > 0) {
    const byName = new Map<string, THREE.SkinnedMesh | null>()
    root.traverse(object => {
      if (!(object instanceof THREE.SkinnedMesh) || !object.name) return
      byName.set(object.name, byName.has(object.name) ? null : object)
    })
    for (const group of template.groups) {
      const meshes: THREE.SkinnedMesh[] = []
      let valid = true
      for (let i = 0; i < group.names.length; i++) {
        const mesh = byName.get(group.names[i])
        if (!mesh || !mesh.parent || mesh.geometry !== group.sourceGeometries[i]) {
          valid = false
          break
        }
        meshes.push(mesh)
      }
      if (!valid || meshes.length < 2) continue
      const first = meshes[0]
      let compatible = !Array.isArray(first.material) && Boolean(first.skeleton)
      for (let i = 1; i < meshes.length && compatible; i++) {
        const other = meshes[i]
        compatible = other.parent === first.parent
          && !Array.isArray(other.material)
          && Boolean(other.skeleton)
          && skeletonsCompatibleForMerge(first.skeleton, other.skeleton)
          && first.bindMode === other.bindMode
          && matrixAlmostEqual(first.bindMatrix, other.bindMatrix)
      }
      if (!compatible) continue
      const merged = new THREE.SkinnedMesh(group.mergedGeometry, first.material)
      merged.bind(first.skeleton, first.bindMatrix)
      if (first.boundingSphere) {
        const sphere = first.boundingSphere.clone()
        for (let i = 1; i < meshes.length; i++) {
          if (meshes[i].boundingSphere) sphere.union(meshes[i].boundingSphere!)
        }
        merged.boundingSphere = sphere
      }
      copyRenderableState(first, merged, group.names, prefix)
      copyMultiMergedSeatSupport(meshes, merged)
      first.parent!.add(merged)
      for (const mesh of meshes) {
        mesh.parent!.remove(mesh)
      }
      removed += meshes.length - 1
    }
  }
  if (template.culledDetailNames.length > 0) {
    const culledSet = new Set(template.culledDetailNames)
    root.traverse(object => {
      if (object instanceof THREE.Mesh && culledSet.has(object.name)) {
        object.visible = false
      }
    })
  }
  return removed
}
