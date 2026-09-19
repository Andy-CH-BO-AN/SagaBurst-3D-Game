import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { materialRenderContract, sameMaterialRenderContract } from './MaterialRenderContract'

interface ConsolidationPair {
  first: string
  second: string
  firstMaterial: string
  secondMaterial: string
}

export const AUDITED_ROMAN_LOD2_SHA256 = '0c759f1d056fc2bce8bac50cde26e9d4e2de631987d0f7fac7dee1131e4a8b14'

export function isRomanLod2ConsolidationAssetAudited(actualSha256: string | undefined): boolean {
  return actualSha256 === AUDITED_ROMAN_LOD2_SHA256
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

function copyRenderableState(source: THREE.SkinnedMesh, target: THREE.SkinnedMesh, names: readonly string[]): void {
  target.name = `roman-lod2-consolidated-${names.join('-')}`
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

function mergeInstancePair(root: THREE.Object3D, template: ConsolidationTemplateRecord): ConsolidationRecord {
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
  copyRenderableState(first, merged, [pair.first, pair.second])
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
