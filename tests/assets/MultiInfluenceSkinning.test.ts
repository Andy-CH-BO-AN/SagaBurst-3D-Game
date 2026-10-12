import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { configureMultiInfluenceSkinning, multiInfluenceSkinningPlugin } from '../../src/world/MultiInfluenceSkinning'

// One vertex influenced by four separate weight sets. Moving the last three
// joints exposes both GLTFLoader's first-set normalization and four-only CPU skinning.
async function loadFourSetFixture() {
  const chunks: Buffer[] = []
  let byteLength = 0
  const views: Array<{ buffer: number; byteOffset: number; byteLength: number }> = []
  const accessors: Array<{ bufferView: number; componentType: number; count: number; type: string; min?: number[]; max?: number[] }> = []
  function add(data: number[], type: string, count: number, componentType = 5126) {
    const array = componentType === 5123 ? new Uint16Array(data) : new Float32Array(data)
    const bytes = Buffer.from(array.buffer)
    views.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length })
    chunks.push(bytes); byteLength += bytes.length
    accessors.push({ bufferView: views.length - 1, componentType, count, type })
    return accessors.length - 1
  }
  const attributes: Record<string, number> = { POSITION: add([0, 0, 0], 'VEC3', 1) }
  accessors[0].min = [0, 0, 0]; accessors[0].max = [0, 0, 0]
  for (let set = 0; set < 4; set++) {
    attributes[`JOINTS_${set}`] = add([set, 0, 0, 0], 'VEC4', 1, 5123)
    attributes[`WEIGHTS_${set}`] = add([.25, 0, 0, 0], 'VEC4', 1)
  }
  const inverse = add(Array.from({ length: 4 }, () => new THREE.Matrix4().toArray()).flat(), 'MAT4', 4)
  const buffer = Buffer.concat(chunks)
  const json = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0, 1, 2, 3, 4] }],
    nodes: [{ mesh: 0, skin: 0 }, ...['a', 'b', 'c', 'd'].map(name => ({ name }))],
    skins: [{ joints: [1, 2, 3, 4], inverseBindMatrices: inverse }],
    meshes: [{ primitives: [{ attributes }] }], accessors, bufferViews: views,
    buffers: [{ byteLength: buffer.byteLength }],
  }
  const loader = new GLTFLoader().register(multiInfluenceSkinningPlugin)
  const text = Buffer.from(JSON.stringify(json))
  const padded = Buffer.alloc(Math.ceil(text.length / 4) * 4, 32)
  text.copy(padded)
  const glb = Buffer.alloc(28 + padded.length + buffer.byteLength)
  glb.writeUInt32LE(0x46546c67); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8)
  glb.writeUInt32LE(padded.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); padded.copy(glb, 20)
  glb.writeUInt32LE(buffer.byteLength, 20 + padded.length); glb.writeUInt32LE(0x004e4942, 24 + padded.length)
  buffer.copy(glb, 28 + padded.length)
  return loader.parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '')
}

describe('complete glTF skin influences', () => {
  it('preserves total weights and includes sets 1–3 in animated CPU positions and independent clones', async () => {
    const gltf = await loadFourSetFixture()
    const root = gltf.scene
    let mesh!: THREE.SkinnedMesh
    root.traverse(o => { if (o instanceof THREE.SkinnedMesh) mesh = o })
    expect(mesh.geometry.attributes.skinWeight.getX(0)).toBe(.25)
    mesh.skeleton.bones.forEach((bone, index) => { bone.position.x = index * 4 })
    root.updateMatrixWorld(true)
    expect(mesh.getVertexPosition(0, new THREE.Vector3()).x).toBeCloseTo(6)
    const copied = clone(root)
    configureMultiInfluenceSkinning(copied)
    let copy!: THREE.SkinnedMesh
    copied.traverse(o => { if (o instanceof THREE.SkinnedMesh) copy = o })
    copy.skeleton.bones[3].position.x = 20
    copied.updateMatrixWorld(true)
    expect(copy.getVertexPosition(0, new THREE.Vector3()).x).toBeCloseTo(8)
    expect(mesh.getVertexPosition(0, new THREE.Vector3()).x).toBeCloseTo(6)
    expect(copy.customDepthMaterial).toBe(mesh.customDepthMaterial)
    expect(copy.customDistanceMaterial).toBe(mesh.customDistanceMaterial)
    expect(copy.skeleton).not.toBe(mesh.skeleton)
    mesh.geometry.dispose()
    ;(mesh.material as THREE.Material).dispose()
    mesh.skeleton.dispose(); copy.skeleton.dispose()
  })
})
