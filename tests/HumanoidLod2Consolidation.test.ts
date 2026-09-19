import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import {
  consolidateRomanLod2,
  createRomanLod2ConsolidationTemplate,
  tryCreateRomanLod2ConsolidationTemplate,
} from '../src/world/HumanoidLod2Consolidation'
import { gltfMaterialRenderContract, materialRenderContract, sameMaterialRenderContract } from '../src/world/MaterialRenderContract'

const PAIRS = [
  ['Armour_top_1', 'Armour_top_2', 'Armour_top0', 'Armour_top1'],
  ['Helmet3_1', 'Helmet3_2', 'Helmet30', 'Helmet31'],
  ['New_eye', 'New_eye_2', 'New_eye0', 'New_eye_20'],
  ['RomanUndertunic_l', 'RomanUndertunic_r', 'RomanUndertunic', 'RomanUndertunic'],
] as const

function geometry(offset: number): THREE.BufferGeometry {
  const result = new THREE.BufferGeometry()
  result.setAttribute('position', new THREE.Float32BufferAttribute([
    offset, 0, 0, offset + 1, 0, 0, offset, 1, 0,
  ], 3))
  result.setAttribute('normal', new THREE.Float32BufferAttribute([
    0, 0, 1, 0, 0, 1, 0, 0, 1,
  ], 3))
  result.setAttribute('uv', new THREE.Float32BufferAttribute([
    0, 0, 1, 0, 0, 1,
  ], 2))
  result.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ], 4))
  result.setAttribute('skinWeight', new THREE.Float32BufferAttribute([
    1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0,
  ], 4))
  result.setIndex([0, 1, 2])
  return result
}

function material(name: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ name, color: 0x9e8873, roughness: 0.58, metalness: 0.55, side: THREE.DoubleSide })
}

function skinned(name: string, materialName: string, skeleton: THREE.Skeleton, offset: number): THREE.SkinnedMesh {
  const mesh = new THREE.SkinnedMesh(geometry(offset), material(materialName))
  mesh.name = name
  mesh.castShadow = false
  mesh.receiveShadow = true
  mesh.bind(skeleton)
  return mesh
}

function sourceValues(mesh: THREE.SkinnedMesh): Record<string, number[]> {
  return Object.fromEntries(Object.entries(mesh.geometry.attributes).map(([name, attribute]) =>
    [name, Array.from(attribute.array as ArrayLike<number>)]))
}

function makeLod2(): { root: THREE.Group, skeleton: THREE.Skeleton, sources: THREE.SkinnedMesh[] } {
  const root = new THREE.Group()
  const bone = new THREE.Bone()
  const skeleton = new THREE.Skeleton([bone])
  root.add(bone)
  const sources: THREE.SkinnedMesh[] = []
  PAIRS.forEach(([first, second, firstMaterial, secondMaterial], index) => {
    const a = skinned(first, firstMaterial, skeleton, index * 10)
    const independentSkeletonWrapper = new THREE.Skeleton(skeleton.bones, skeleton.boneInverses.map(inverse => inverse.clone()))
    const b = skinned(second, secondMaterial, independentSkeletonWrapper, index * 10 + 3)
    root.add(a, b)
    sources.push(a, b)
  })
  return { root, skeleton, sources }
}

function readRomanLod2() {
  const bytes = readFileSync(new URL('../public/models/characters/v2/roman/lod2.glb', import.meta.url))
  const jsonLength = bytes.readUInt32LE(12)
  const document = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength)) as any
  const binaryStart = 20 + jsonLength + 8
  const imageHash = (imageIndex: number) => {
    const image = document.images[imageIndex]
    const view = document.bufferViews[image.bufferView]
    const start = binaryStart + (view.byteOffset ?? 0)
    return createHash('sha256').update(bytes.subarray(start, start + view.byteLength)).digest('hex')
  }
  const textureSignature = (info: { index: number, texCoord?: number, extensions?: { KHR_texture_transform?: { offset?: number[], rotation?: number, scale?: number[], texCoord?: number } } }) => {
    const texture = document.textures[info.index]
    const transform = info.extensions?.KHR_texture_transform
    return {
      image: imageHash(texture.source), sampler: document.samplers?.[texture.sampler] ?? {},
      texCoord: transform?.texCoord ?? info.texCoord ?? 0,
      offset: transform?.offset ?? [0, 0], rotation: transform?.rotation ?? 0, scale: transform?.scale ?? [1, 1],
    }
  }
  const materialContract = (materialIndex: number) => gltfMaterialRenderContract(document.materials[materialIndex], textureSignature)
  return { document, materialContract }
}

describe('Roman LOD2 duplicate-material consolidation', () => {
  it('preserves source attributes, index coverage, skeleton binding, triangles and render policy while reducing eight skins to four', () => {
    const { root, skeleton, sources } = makeLod2()
    const before = new Map(sources.map(mesh => [mesh.name, {
      attributes: sourceValues(mesh), index: Array.from(mesh.geometry.index!.array), bind: mesh.bindMatrix.clone(),
    }]))
    expect(sources[0].skeleton).not.toBe(sources[1].skeleton) // GLTFLoader-like wrapper split; bones/inverses remain shared.
    consolidateRomanLod2(root, createRomanLod2ConsolidationTemplate(root))

    const merged = root.children.filter((object): object is THREE.SkinnedMesh => object instanceof THREE.SkinnedMesh)
    expect(merged).toHaveLength(4)
    expect(root.children.some(object => object instanceof THREE.SkinnedMesh && !object.userData.humanoidLod2Consolidated)).toBe(false)
    for (const mesh of merged) {
      expect(mesh.skeleton).toBe(skeleton)
      expect(mesh.bindMatrix.equals(before.get(mesh.userData.sourceParts[0])!.bind)).toBe(true)
      expect(mesh.castShadow).toBe(false)
      expect(mesh.receiveShadow).toBe(true)
      expect(mesh.geometry.index!.count).toBe(6)
      expect(mesh.geometry.getAttribute('position').count).toBe(6)
      expect(mesh.geometry.getAttribute('normal').count).toBe(6)
      expect(mesh.geometry.getAttribute('uv').count).toBe(6)
      expect(mesh.geometry.getAttribute('skinIndex').count).toBe(6)
      expect(mesh.geometry.getAttribute('skinWeight').count).toBe(6)
      for (const attribute of ['position', 'normal', 'uv', 'skinIndex', 'skinWeight']) {
        const expected = mesh.userData.sourceParts.flatMap((name: string) => before.get(name)!.attributes[attribute])
        expect(Array.from(mesh.geometry.getAttribute(attribute).array)).toEqual(expected)
      }
      let vertexOffset = 0
      const expectedIndices = mesh.userData.sourceParts.flatMap((name: string) => {
        const source = before.get(name)!
        const indices = source.index.map(index => index + vertexOffset)
        vertexOffset += source.attributes.position.length / 3
        return indices
      })
      expect(Array.from(mesh.geometry.index!.array)).toEqual(expectedIndices)
      expect((mesh.material as THREE.Material).name).toBe(mesh.userData.sourceParts[0].startsWith('Armour_top') ? 'Armour_top0'
        : mesh.userData.sourceParts[0].startsWith('Helmet3') ? 'Helmet30'
          : mesh.userData.sourceParts[0] === 'New_eye' ? 'New_eye0' : 'RomanUndertunic')
    }
  })

  it('does not touch LOD0 or LOD1 when the caller limits the operation to the LOD2 root', () => {
    const lod0 = new THREE.Group(), lod1 = new THREE.Group()
    const { root: lod2 } = makeLod2()
    const lod = new THREE.LOD()
    lod.addLevel(lod0, 0); lod.addLevel(lod1, 28); lod.addLevel(lod2, 60)
    consolidateRomanLod2(lod2, createRomanLod2ConsolidationTemplate(lod2))
    expect(lod.levels[0].object).toBe(lod0)
    expect(lod.levels[1].object).toBe(lod1)
    expect(lod0.children).toHaveLength(0)
    expect(lod1.children).toHaveLength(0)
  })

  it('shares each cached merged geometry across instances while preserving a distinct skeleton per instance', () => {
    const { root: canonical } = makeLod2()
    const consolidation = createRomanLod2ConsolidationTemplate(canonical)
    const firstInstance = cloneSkeleton(canonical) as THREE.Group
    const secondInstance = cloneSkeleton(canonical) as THREE.Group
    consolidateRomanLod2(firstInstance, consolidation)
    consolidateRomanLod2(secondInstance, consolidation)

    const firstMerged = firstInstance.children.filter((object): object is THREE.SkinnedMesh =>
      object instanceof THREE.SkinnedMesh && object.userData.humanoidLod2Consolidated)
    const secondMerged = secondInstance.children.filter((object): object is THREE.SkinnedMesh =>
      object instanceof THREE.SkinnedMesh && object.userData.humanoidLod2Consolidated)
    expect(firstMerged).toHaveLength(4)
    expect(secondMerged).toHaveLength(4)
    for (let index = 0; index < firstMerged.length; index++) {
      expect(firstMerged[index]).not.toBe(secondMerged[index])
      expect(firstMerged[index].geometry).toBe(secondMerged[index].geometry)
      expect(firstMerged[index].skeleton).not.toBe(secondMerged[index].skeleton)
      expect(firstMerged[index].skeleton.bones[0]).not.toBe(secondMerged[index].skeleton.bones[0])
    }
  })

  it('fails open when an updated asset no longer matches a consolidation pair', () => {
    const { root } = makeLod2()
    root.remove(root.getObjectByName('Armour_top_2')!)
    const diagnostics: Array<{ message: string, error: unknown }> = []

    expect(tryCreateRomanLod2ConsolidationTemplate(root, (message, error) => diagnostics.push({ message, error }))).toBeUndefined()
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].message).toBe('Roman LOD2 consolidation unavailable; using original render structure')
    expect(diagnostics[0].error).toBeInstanceOf(Error)
    expect(root.getObjectByName('Armour_top_1')).toBeInstanceOf(THREE.SkinnedMesh)
  })

  it.each([
    ['normalScale', (material: THREE.MeshStandardMaterial) => material.normalScale.set(0.3, 0.3)],
    ['normalMap', (material: THREE.MeshStandardMaterial) => { material.normalMap = new THREE.Texture() }],
    ['roughness', (material: THREE.MeshStandardMaterial) => { material.roughness = 0.3 }],
    ['metalness', (material: THREE.MeshStandardMaterial) => { material.metalness = 0.1 }],
    ['metallicRoughnessTexture', (material: THREE.MeshStandardMaterial) => {
      const texture = new THREE.Texture()
      material.roughnessMap = texture
      material.metalnessMap = texture
    }],
    ['occlusionTexture', (material: THREE.MeshStandardMaterial) => { material.aoMap = new THREE.Texture() }],
    ['aoMapIntensity', (material: THREE.MeshStandardMaterial) => { material.aoMapIntensity = 0.2 }],
    ['emissiveTexture', (material: THREE.MeshStandardMaterial) => { material.emissiveMap = new THREE.Texture() }],
    ['emissiveFactor', (material: THREE.MeshStandardMaterial) => { material.emissive.setRGB(0.2, 0.1, 0.3) }],
    ['emissiveIntensity', (material: THREE.MeshStandardMaterial) => { material.emissiveIntensity = 0.2 }],
    ['alphaTest', (material: THREE.MeshStandardMaterial) => { material.alphaTest = 0.2 }],
  ])('rejects consolidation and fails open when %s differs', (_field, mutate) => {
    const { root } = makeLod2()
    const second = root.getObjectByName('Armour_top_2') as THREE.SkinnedMesh
    mutate(second.material as THREE.MeshStandardMaterial)

    expect(() => createRomanLod2ConsolidationTemplate(root)).toThrow('material render state differs')
    expect(tryCreateRomanLod2ConsolidationTemplate(root, () => undefined)).toBeUndefined()
    expect(root.children.filter(object => object instanceof THREE.SkinnedMesh)).toHaveLength(8)
  })

  it('allows equivalent materials with different object and texture identities', () => {
    const { root } = makeLod2()
    const first = root.getObjectByName('Armour_top_1') as THREE.SkinnedMesh
    const second = root.getObjectByName('Armour_top_2') as THREE.SkinnedMesh
    for (const slot of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap'] as const) {
      ;(first.material as THREE.MeshStandardMaterial)[slot] = new THREE.Texture()
      ;(second.material as THREE.MeshStandardMaterial)[slot] = new THREE.Texture()
    }
    expect(first.material).not.toBe(second.material)
    expect((first.material as THREE.MeshStandardMaterial).normalMap).not.toBe((second.material as THREE.MeshStandardMaterial).normalMap)
    expect(() => createRomanLod2ConsolidationTemplate(root)).not.toThrow()
  })

  it('treats equivalent MeshPhysicalMaterial defaults with infinite attenuation distance as compatible', () => {
    const first = new THREE.MeshPhysicalMaterial()
    const second = new THREE.MeshPhysicalMaterial()
    expect(first.attenuationDistance).toBe(Infinity)
    expect(second.attenuationDistance).toBe(Infinity)
    expect(sameMaterialRenderContract(materialRenderContract(first), materialRenderContract(second))).toBe(true)
  })

  it('rejects MeshPhysicalMaterial when attenuation distance differs from infinity', () => {
    const first = new THREE.MeshPhysicalMaterial()
    const second = new THREE.MeshPhysicalMaterial()
    second.attenuationDistance = 10
    expect(sameMaterialRenderContract(materialRenderContract(first), materialRenderContract(second))).toBe(false)
  })

  it.each([
    ['normalTexture scale', (material: any) => { material.normalTexture.scale = 0.3 }],
    ['metallicRoughnessTexture', (material: any) => { material.pbrMetallicRoughness.metallicRoughnessTexture = { index: 1 } }],
    ['occlusionTexture strength', (material: any) => { material.occlusionTexture.strength = 0.3 }],
    ['emissiveTexture', (material: any) => { material.emissiveTexture = { index: 1 } }],
    ['emissive factor', (material: any) => { material.emissiveFactor = [0.3, 0, 0] }],
    ['emissive strength', (material: any) => { material.extensions.KHR_materials_emissive_strength.emissiveStrength = 0.3 }],
  ])('uses the same GLTF material contract to reject changed %s', (_field, mutate) => {
    const texture = (info: { index: number }) => ({ image: `hash-${info.index}`, sampler: {}, texCoord: 0 })
    const base = {
      pbrMetallicRoughness: {
        baseColorFactor: [1, 1, 1, 1], metallicFactor: 0.5, roughnessFactor: 0.5,
        metallicRoughnessTexture: { index: 0 },
      },
      normalTexture: { index: 0, scale: 0.65 },
      occlusionTexture: { index: 0, strength: 0.8 },
      emissiveTexture: { index: 0 },
      emissiveFactor: [0.1, 0, 0],
      extensions: { KHR_materials_emissive_strength: { emissiveStrength: 1.2 } },
    }
    const changed = structuredClone(base)
    mutate(changed)
    expect(sameMaterialRenderContract(gltfMaterialRenderContract(base, texture), gltfMaterialRenderContract(changed, texture))).toBe(false)
  })

  it('verifies the shipped LOD2 pairs have the same skeleton, no morph targets, matching vertex formats and byte-identical texture material signatures', () => {
    const { document, materialContract } = readRomanLod2()
    const nodeByName = new Map(document.nodes.map((node: any) => [node.name, node]))
    const primitiveByNode = (name: string) => document.meshes[nodeByName.get(name)!.mesh].primitives
    const runtimeNames = new Map([
      ['Armour_top_1', ['Armour_top', 0]], ['Armour_top_2', ['Armour_top', 1]],
      ['Helmet3_1', ['Helmet3', 0]], ['Helmet3_2', ['Helmet3', 1]],
      ['New_eye', ['New_eye', 0]], ['New_eye_2', ['New_eye_2', 0]],
      ['RomanUndertunic_l', ['RomanUndertunic_l', 0]], ['RomanUndertunic_r', ['RomanUndertunic_r', 0]],
    ])
    for (const [first, second, firstMaterial, secondMaterial] of PAIRS) {
      const [firstNode, firstPrimitiveIndex] = runtimeNames.get(first)!
      const [secondNode, secondPrimitiveIndex] = runtimeNames.get(second)!
      const firstNodeDef = nodeByName.get(firstNode)!, secondNodeDef = nodeByName.get(secondNode)!
      expect(firstNodeDef.skin).toBe(0)
      expect(secondNodeDef.skin).toBe(0)
      const a = primitiveByNode(firstNode)[firstPrimitiveIndex]
      const b = primitiveByNode(secondNode)[secondPrimitiveIndex]
      expect(a.targets).toBeUndefined()
      expect(b.targets).toBeUndefined()
      expect(Object.keys(a.attributes).sort()).toEqual(Object.keys(b.attributes).sort())
      for (const key of Object.keys(a.attributes)) {
        const aa = document.accessors[a.attributes[key]], bb = document.accessors[b.attributes[key]]
        expect([aa.componentType, aa.type, aa.normalized ?? false]).toEqual([bb.componentType, bb.type, bb.normalized ?? false])
      }
      expect(sameMaterialRenderContract(
        materialContract(document.materials.findIndex((material: any) => material.name === firstMaterial)),
        materialContract(document.materials.findIndex((material: any) => material.name === secondMaterial)),
      )).toBe(true)
    }
  })
})
