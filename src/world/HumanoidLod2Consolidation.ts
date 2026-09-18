import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

interface ConsolidationPair {
  first: string
  second: string
  firstMaterial: string
  secondMaterial: string
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

function equalNumber(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-7
}

function sameColor(a: THREE.Color | undefined, b: THREE.Color | undefined): boolean {
  return a === b || Boolean(a && b && equalNumber(a.r, b.r) && equalNumber(a.g, b.g) && equalNumber(a.b, b.b))
}

function sameTextureSettings(a: THREE.Texture | null | undefined, b: THREE.Texture | null | undefined): boolean {
  if (!a || !b) return a === b
  return a.mapping === b.mapping && a.wrapS === b.wrapS && a.wrapT === b.wrapT
    && a.magFilter === b.magFilter && a.minFilter === b.minFilter && a.anisotropy === b.anisotropy
    && a.flipY === b.flipY && a.generateMipmaps === b.generateMipmaps && a.colorSpace === b.colorSpace
    && a.channel === b.channel && a.matrix.equals(b.matrix)
}

/** The source GLB keeps these pairs as duplicate material records. Runtime image
 * identity may differ because GLTFLoader decodes equivalent embedded bytes twice,
 * so the byte-level equivalence is guarded in the asset-contract test. */
function assertEquivalentMaterials(a: THREE.Material, b: THREE.Material, expected: ConsolidationPair): void {
  assert(a.name === expected.firstMaterial && b.name === expected.secondMaterial,
    `unexpected materials for ${expected.first}/${expected.second}`)
  const left = a as THREE.MeshStandardMaterial
  const right = b as THREE.MeshStandardMaterial
  assert(a.type === b.type && a.side === b.side && a.transparent === b.transparent
    && a.alphaTest === b.alphaTest && a.depthWrite === b.depthWrite && a.depthTest === b.depthTest
    && a.blending === b.blending && a.vertexColors === b.vertexColors && a.opacity === b.opacity
    && a.premultipliedAlpha === b.premultipliedAlpha && a.dithering === b.dithering
    && a.colorWrite === b.colorWrite && a.polygonOffset === b.polygonOffset
    && a.polygonOffsetFactor === b.polygonOffsetFactor && a.polygonOffsetUnits === b.polygonOffsetUnits
    && equalNumber(left.metalness, right.metalness) && equalNumber(left.roughness, right.roughness)
    && sameColor(left.color, right.color) && sameColor(left.emissive, right.emissive)
    && sameTextureSettings(left.map, right.map) && sameTextureSettings(left.normalMap, right.normalMap)
    && sameTextureSettings(left.roughnessMap, right.roughnessMap) && sameTextureSettings(left.metalnessMap, right.metalnessMap)
    && sameTextureSettings(left.aoMap, right.aoMap) && sameTextureSettings(left.emissiveMap, right.emissiveMap)
    && sameTextureSettings(left.alphaMap, right.alphaMap),
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

function mergePair(root: THREE.Object3D, expected: ConsolidationPair): ConsolidationRecord {
  const first = findSkinnedMesh(root, expected.first)
  const second = findSkinnedMesh(root, expected.second)
  assertMergeCompatible(first, second, expected)
  const geometry = mergeGeometries([first.geometry, second.geometry], false)
  assert(geometry, `failed to merge ${expected.first}/${expected.second}`)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  const merged = new THREE.SkinnedMesh(geometry, first.material)
  merged.bind(first.skeleton, first.bindMatrix)
  copyRenderableState(first, merged, [expected.first, expected.second])
  first.parent!.add(merged)
  return { first, second, merged }
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
export function consolidateRomanLod2(root: THREE.Object3D): HumanoidLod2RepresentationControl | undefined {
  const records = ROMAN_LOD2_PAIRS.map(pair => mergePair(root, pair))
  const allowControl = devControlEnabled()
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
