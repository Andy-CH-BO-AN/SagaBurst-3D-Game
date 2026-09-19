import * as THREE from 'three'

export const MATERIAL_TEXTURE_SLOTS = [
  'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap',
  'bumpMap', 'displacementMap', 'lightMap', 'envMap',
] as const

export const MATERIAL_SCALAR_CONTROLS = [
  'opacity', 'alphaTest', 'metalness', 'roughness', 'normalScaleX', 'normalScaleY',
  'aoMapIntensity', 'emissiveIntensity', 'bumpScale', 'displacementScale', 'displacementBias',
  'lightMapIntensity', 'envMapIntensity',
] as const

export type MaterialTextureSlot = typeof MATERIAL_TEXTURE_SLOTS[number]
export type MaterialScalarControl = typeof MATERIAL_SCALAR_CONTROLS[number]

export interface MaterialRenderContract<TTexture = unknown> {
  type: string
  flags: Record<string, boolean | number | null>
  scalars: Record<MaterialScalarControl, number>
  colors: { color: [number, number, number], emissive: [number, number, number] }
  textures: Record<MaterialTextureSlot, TTexture | null>
  extensions: Record<string, unknown>
}

export interface RuntimeTextureRenderContract {
  mapping: number
  wrapS: number
  wrapT: number
  magFilter: number
  minFilter: number
  anisotropy: number
  flipY: boolean
  generateMipmaps: boolean
  colorSpace: string
  channel: number
  matrixAutoUpdate: boolean
  offset: [number, number]
  repeat: [number, number]
  center: [number, number]
  rotation: number
  matrix: number[]
}

export interface GltfTextureInfo {
  index: number
  texCoord?: number
  scale?: number
  strength?: number
  extensions?: { KHR_texture_transform?: { offset?: number[], rotation?: number, scale?: number[], texCoord?: number } }
}

export interface GltfMaterialLike {
  pbrMetallicRoughness?: {
    baseColorFactor?: number[]
    baseColorTexture?: GltfTextureInfo
    metallicFactor?: number
    roughnessFactor?: number
    metallicRoughnessTexture?: GltfTextureInfo
  }
  normalTexture?: GltfTextureInfo
  occlusionTexture?: GltfTextureInfo
  emissiveTexture?: GltfTextureInfo
  emissiveFactor?: number[]
  alphaMode?: string
  alphaCutoff?: number
  doubleSided?: boolean
  extensions?: Record<string, unknown>
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback
}

function colorValue(value: unknown): [number, number, number] {
  const color = value as THREE.Color | undefined
  return [numberValue(color?.r, 0), numberValue(color?.g, 0), numberValue(color?.b, 0)]
}

function vectorValue(value: unknown, fallback: [number, number] = [1, 1]): [number, number] {
  const vector = value as THREE.Vector2 | undefined
  return [numberValue(vector?.x, fallback[0]), numberValue(vector?.y, fallback[1])]
}

export function textureRenderContract(texture: THREE.Texture | null | undefined): RuntimeTextureRenderContract | null {
  if (!texture) return null
  return {
    mapping: texture.mapping,
    wrapS: texture.wrapS,
    wrapT: texture.wrapT,
    magFilter: texture.magFilter,
    minFilter: texture.minFilter,
    anisotropy: texture.anisotropy,
    flipY: texture.flipY,
    generateMipmaps: texture.generateMipmaps,
    colorSpace: texture.colorSpace,
    channel: texture.channel,
    matrixAutoUpdate: texture.matrixAutoUpdate,
    offset: [texture.offset.x, texture.offset.y],
    repeat: [texture.repeat.x, texture.repeat.y],
    center: [texture.center.x, texture.center.y],
    rotation: texture.rotation,
    matrix: texture.matrix.toArray(),
  }
}

/**
 * Normalized render-affecting StandardMaterial state. It intentionally omits
 * material UUID, name, texture object identity and image identity: those do not
 * define a draw's render state. The shipped GLB asset test supplies image bytes
 * in its texture contract, while runtime checks sampler/transform state.
 */
export function materialRenderContract(material: THREE.Material): MaterialRenderContract<RuntimeTextureRenderContract> {
  const standard = material as THREE.MeshStandardMaterial
  const raw = material as THREE.Material & Record<string, unknown>
  const normalScale = standard.normalScale
  return {
    type: material.type,
    flags: {
      side: material.side,
      transparent: material.transparent,
      depthWrite: material.depthWrite,
      depthTest: material.depthTest,
      blending: material.blending,
      blendSrc: material.blendSrc,
      blendDst: material.blendDst,
      blendEquation: material.blendEquation,
      blendSrcAlpha: material.blendSrcAlpha,
      blendDstAlpha: material.blendDstAlpha,
      blendEquationAlpha: material.blendEquationAlpha,
      vertexColors: material.vertexColors,
      premultipliedAlpha: material.premultipliedAlpha,
      dithering: material.dithering,
      colorWrite: material.colorWrite,
      polygonOffset: material.polygonOffset,
      polygonOffsetFactor: material.polygonOffsetFactor,
      polygonOffsetUnits: material.polygonOffsetUnits,
      fog: Boolean(raw.fog),
      toneMapped: material.toneMapped,
      flatShading: Boolean(raw.flatShading),
      normalMapType: numberValue(raw.normalMapType, THREE.TangentSpaceNormalMap),
    },
    scalars: {
      opacity: material.opacity,
      alphaTest: material.alphaTest,
      metalness: numberValue(standard.metalness, 0),
      roughness: numberValue(standard.roughness, 1),
      normalScaleX: numberValue(normalScale?.x, 1),
      normalScaleY: numberValue(normalScale?.y, 1),
      aoMapIntensity: numberValue(standard.aoMapIntensity, 1),
      emissiveIntensity: numberValue(standard.emissiveIntensity, 1),
      bumpScale: numberValue(standard.bumpScale, 1),
      displacementScale: numberValue(standard.displacementScale, 1),
      displacementBias: numberValue(standard.displacementBias, 0),
      lightMapIntensity: numberValue(standard.lightMapIntensity, 1),
      envMapIntensity: numberValue(standard.envMapIntensity, 1),
    },
    colors: { color: colorValue(standard.color), emissive: colorValue(standard.emissive) },
    textures: Object.fromEntries(MATERIAL_TEXTURE_SLOTS.map(slot =>
      [slot, textureRenderContract(raw[slot] as THREE.Texture | null | undefined)])) as Record<MaterialTextureSlot, RuntimeTextureRenderContract | null>,
    extensions: material.type === 'MeshPhysicalMaterial' ? {
      physical: {
        scalars: Object.fromEntries([
          'clearcoat', 'clearcoatRoughness', 'dispersion', 'ior', 'iridescence', 'iridescenceIOR',
          'sheen', 'sheenRoughness', 'specularIntensity', 'transmission', 'thickness',
          'attenuationDistance', 'anisotropy', 'anisotropyRotation',
        ].map(key => [key, numberValue(raw[key], key === 'ior' ? 1.5 : 0)])),
        colors: {
          attenuationColor: colorValue(raw.attenuationColor),
          sheenColor: colorValue(raw.sheenColor),
          specularColor: colorValue(raw.specularColor),
        },
        vectors: {
          clearcoatNormalScale: vectorValue(raw.clearcoatNormalScale),
          iridescenceThicknessRange: vectorValue(raw.iridescenceThicknessRange, [100, 400]),
        },
        textures: Object.fromEntries([
          'clearcoatMap', 'clearcoatRoughnessMap', 'clearcoatNormalMap', 'iridescenceMap',
          'iridescenceThicknessMap', 'sheenColorMap', 'sheenRoughnessMap', 'specularColorMap',
          'specularIntensityMap', 'transmissionMap', 'thicknessMap', 'anisotropyMap',
        ].map(slot => [slot, textureRenderContract(raw[slot] as THREE.Texture | null | undefined)])),
      },
    } : {},
  }
}

function gltfColor(value: number[] | undefined, fallback: [number, number, number]): [number, number, number] {
  return [numberValue(value?.[0], fallback[0]), numberValue(value?.[1], fallback[1]), numberValue(value?.[2], fallback[2])]
}

function gltfExtensionContract<TTexture>(value: unknown, texture: (info: GltfTextureInfo) => TTexture): unknown {
  if (Array.isArray(value)) return value.map(item => gltfExtensionContract(item, texture))
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  const normalized = Object.fromEntries(Object.keys(record).sort().map(key =>
    [key, gltfExtensionContract(record[key], texture)]))
  if (typeof record.index !== 'number') return normalized
  const { index: _index, ...withoutIndex } = normalized
  return { ...withoutIndex, texture: texture(record as unknown as GltfTextureInfo) }
}

/**
 * GLB-side adapter for the same semantic contract used at runtime. `texture`
 * should include source-image identity (for example a byte hash) plus sampler,
 * UV-set and transform state.
 */
export function gltfMaterialRenderContract<TTexture>(
  material: GltfMaterialLike,
  texture: (info: GltfTextureInfo) => TTexture,
): MaterialRenderContract<TTexture> {
  const pbr = material.pbrMetallicRoughness ?? {}
  const alphaMode = material.alphaMode ?? 'OPAQUE'
  const textureOrNull = (info: GltfTextureInfo | undefined) => info ? texture(info) : null
  return {
    // Extension identity and values are part of eligibility even when their
    // runtime shader type happens to remain MeshStandardMaterial.
    type: `gltf-pbr:${Object.keys(material.extensions ?? {}).sort().join(',')}`,
    flags: {
      side: material.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
      transparent: alphaMode === 'BLEND',
      depthWrite: true,
      depthTest: true,
      blending: THREE.NormalBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendEquation: THREE.AddEquation,
      blendSrcAlpha: null,
      blendDstAlpha: null,
      blendEquationAlpha: null,
      vertexColors: false,
      premultipliedAlpha: false,
      dithering: false,
      colorWrite: true,
      polygonOffset: false,
      polygonOffsetFactor: 0,
      polygonOffsetUnits: 0,
      fog: true,
      toneMapped: true,
      flatShading: false,
      normalMapType: THREE.TangentSpaceNormalMap,
    },
    scalars: {
      opacity: numberValue(pbr.baseColorFactor?.[3], 1),
      alphaTest: alphaMode === 'MASK' ? numberValue(material.alphaCutoff, 0.5) : 0,
      metalness: numberValue(pbr.metallicFactor, 1),
      roughness: numberValue(pbr.roughnessFactor, 1),
      normalScaleX: numberValue(material.normalTexture?.scale, 1),
      normalScaleY: numberValue(material.normalTexture?.scale, 1),
      aoMapIntensity: numberValue(material.occlusionTexture?.strength, 1),
      emissiveIntensity: numberValue((material.extensions?.KHR_materials_emissive_strength as { emissiveStrength?: number } | undefined)?.emissiveStrength, 1),
      bumpScale: 1,
      displacementScale: 1,
      displacementBias: 0,
      lightMapIntensity: 1,
      envMapIntensity: 1,
    },
    colors: { color: gltfColor(pbr.baseColorFactor, [1, 1, 1]), emissive: gltfColor(material.emissiveFactor, [0, 0, 0]) },
    textures: {
      map: textureOrNull(pbr.baseColorTexture),
      normalMap: textureOrNull(material.normalTexture),
      roughnessMap: textureOrNull(pbr.metallicRoughnessTexture),
      metalnessMap: textureOrNull(pbr.metallicRoughnessTexture),
      aoMap: textureOrNull(material.occlusionTexture),
      emissiveMap: textureOrNull(material.emissiveTexture),
      alphaMap: null,
      bumpMap: null,
      displacementMap: null,
      lightMap: null,
      envMap: null,
    },
    extensions: gltfExtensionContract(material.extensions ?? {}, texture) as Record<string, unknown>,
  }
}

function sameNumber(first: number, second: number): boolean {
  return Math.abs(first - second) < 1e-7
}

function sameValue(first: unknown, second: unknown): boolean {
  if (typeof first === 'number' && typeof second === 'number') return sameNumber(first, second)
  if (first === null || second === null || typeof first !== 'object' || typeof second !== 'object') return first === second
  if (Array.isArray(first) || Array.isArray(second)) {
    return Array.isArray(first) && Array.isArray(second) && first.length === second.length
      && first.every((value, index) => sameValue(value, second[index]))
  }
  const firstRecord = first as Record<string, unknown>, secondRecord = second as Record<string, unknown>
  const firstKeys = Object.keys(firstRecord).sort(), secondKeys = Object.keys(secondRecord).sort()
  return firstKeys.length === secondKeys.length && firstKeys.every((key, index) =>
    key === secondKeys[index] && sameValue(firstRecord[key], secondRecord[key]))
}

/** One equality predicate for runtime and shipped-asset material contracts. */
export function sameMaterialRenderContract<TTexture>(
  first: MaterialRenderContract<TTexture>,
  second: MaterialRenderContract<TTexture>,
): boolean {
  return first.type === second.type
    && sameValue(first.flags, second.flags)
    && sameValue(first.scalars, second.scalars)
    && sameValue(first.colors, second.colors)
    && sameValue(first.textures, second.textures)
    && sameValue(first.extensions, second.extensions)
}
