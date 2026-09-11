import fs from 'node:fs'
import path from 'node:path'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'

const GLB_PATH = path.resolve('public/models/mounts/v1/horse/horse_runtime.glb')
const MANIFEST_PATH = path.resolve('public/models/mounts/v1/horse/manifest.json')

function align4(value) {
  return (value + 3) & ~3
}

async function main() {
  await MeshoptDecoder.ready
  await MeshoptEncoder.ready

  console.log('Reading GLB:', GLB_PATH)
  const rawGlb = fs.readFileSync(GLB_PATH)

  const magic = rawGlb.subarray(0, 4).toString('ascii')
  if (magic !== 'glTF') throw new Error('Not a glTF binary file')
  const version = rawGlb.readUInt32LE(4)
  if (version !== 2) throw new Error(`Unsupported glTF version: ${version}`)
  const totalLength = rawGlb.readUInt32LE(8)
  if (totalLength !== rawGlb.length) throw new Error('GLB length mismatch')

  const jsonChunkLen = rawGlb.readUInt32LE(12)
  const jsonChunkType = rawGlb.readUInt32LE(16)
  if (jsonChunkType !== 0x4e4f534a) throw new Error('First chunk is not JSON')
  const jsonBuf = rawGlb.subarray(20, 20 + jsonChunkLen)
  const gltf = JSON.parse(jsonBuf.toString('utf8'))

  const binHeaderOffset = 20 + jsonChunkLen
  const binChunkLen = rawGlb.readUInt32LE(binHeaderOffset)
  const binChunkType = rawGlb.readUInt32LE(binHeaderOffset + 4)
  if (binChunkType !== 0x004e4942) throw new Error('Second chunk is not BIN')
  const origBin = rawGlb.subarray(binHeaderOffset + 8, binHeaderOffset + 8 + binChunkLen)

  console.log(`Original JSON: ${jsonChunkLen} bytes, BIN: ${binChunkLen} bytes`)

  // --- HARD ASSERTIONS ---
  console.log('Validating hard assertions on LOD2 source meshes...')
  const lod2NodeIdx = 136
  const lod2Node = gltf.nodes[lod2NodeIdx]
  if (lod2Node.name !== 'horse_lod2') throw new Error(`Node ${lod2NodeIdx} is not horse_lod2`)

  // Check TRS of all 18 source children
  for (const childIdx of lod2Node.children) {
    const node = gltf.nodes[childIdx]
    if (node.skin !== 0) throw new Error(`Node ${childIdx} skin (${node.skin}) !== 0`)
    if (node.matrix || node.translation || node.rotation || node.scale) {
      throw new Error(`Node ${childIdx} has non-identity local transform`)
    }
  }

  // Compare Mat 5 and Mat 6 property equivalence
  const mat5 = gltf.materials[5]
  const mat6 = gltf.materials[6]
  if (mat5.alphaMode !== mat6.alphaMode || mat5.alphaCutoff !== mat6.alphaCutoff) {
    throw new Error('Mat 5 and Mat 6 alpha properties mismatch')
  }
  const tex5 = gltf.textures[mat5.pbrMetallicRoughness.baseColorTexture.index]
  const tex6 = gltf.textures[mat6.pbrMetallicRoughness.baseColorTexture.index]
  const src5 = tex5.extensions?.KHR_texture_basisu?.source ?? tex5.source
  const src6 = tex6.extensions?.KHR_texture_basisu?.source ?? tex6.source
  if (src5 !== src6) throw new Error(`Mat 5 and Mat 6 baseColor texture mismatch: ${src5} vs ${src6}`)
  console.log('Hard assertions passed: skinning, transforms, and hair materials are fully compatible.')

  // Helper to decode a bufferView
  function decodeBufferView(bvIdx) {
    const bv = gltf.bufferViews[bvIdx]
    if (!bv.extensions?.EXT_meshopt_compression) {
      return origBin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength)
    }
    const ext = bv.extensions.EXT_meshopt_compression
    const source = origBin.subarray(ext.byteOffset, ext.byteOffset + ext.byteLength)
    const target = new Uint8Array(ext.count * ext.byteStride)
    MeshoptDecoder.decodeGltfBuffer(target, ext.count, ext.byteStride, source, ext.mode, ext.filter)
    return target
  }

  function readAccessor(accIdx) {
    const acc = gltf.accessors[accIdx]
    const raw = decodeBufferView(acc.bufferView)
    const byteOffset = acc.byteOffset || 0
    return { acc, data: raw.subarray(byteOffset) }
  }

  function getMeshPrimitives(meshIdx) {
    const mesh = gltf.meshes[meshIdx]
    const prim = mesh.primitives[0]
    const ind = readAccessor(prim.indices)
    const pos = readAccessor(prim.attributes.POSITION)
    const norm = readAccessor(prim.attributes.NORMAL)
    const uv = readAccessor(prim.attributes.TEXCOORD_0)
    const joints0 = readAccessor(prim.attributes.JOINTS_0)
    const weights0 = readAccessor(prim.attributes.WEIGHTS_0)
    const joints1 = prim.attributes.JOINTS_1 !== undefined ? readAccessor(prim.attributes.JOINTS_1) : null
    const weights1 = prim.attributes.WEIGHTS_1 !== undefined ? readAccessor(prim.attributes.WEIGHTS_1) : null

    return {
      name: mesh.name,
      indices: new Uint16Array(ind.data.buffer, ind.data.byteOffset, ind.acc.count),
      positions: new Float32Array(pos.data.buffer, pos.data.byteOffset, pos.acc.count * 3),
      normals: new Float32Array(norm.data.buffer, norm.data.byteOffset, norm.acc.count * 3),
      uvs: new Float32Array(uv.data.buffer, uv.data.byteOffset, uv.acc.count * 2),
      joints0: new Uint8Array(joints0.data.buffer, joints0.data.byteOffset, joints0.acc.count * 4),
      weights0: new Float32Array(weights0.data.buffer, weights0.data.byteOffset, weights0.acc.count * 4),
      joints1: joints1 ? new Uint8Array(joints1.data.buffer, joints1.data.byteOffset, joints1.acc.count * 4) : null,
      weights1: weights1 ? new Float32Array(weights1.data.buffer, weights1.data.byteOffset, weights1.acc.count * 4) : null,
      vertexCount: pos.acc.count,
      indexCount: ind.acc.count,
    }
  }

  // --- 1. CONSOLIDATE HAIR (Mane + Tail) ---
  console.log('Consolidating Hair (Mane mesh 41 + Tail mesh 42)...')
  const maneData = getMeshPrimitives(41)
  const tailData = getMeshPrimitives(42)

  const totalHairVerts = maneData.vertexCount + tailData.vertexCount
  const totalHairIndices = maneData.indexCount + tailData.indexCount

  const hairPositions = new Float32Array(totalHairVerts * 3)
  const hairNormals = new Float32Array(totalHairVerts * 3)
  const hairUvs = new Float32Array(totalHairVerts * 2)
  const hairJoints = new Uint8Array(totalHairVerts * 4)
  const hairWeights = new Float32Array(totalHairVerts * 4)
  const hairIndices = new Uint16Array(totalHairIndices)

  // Copy Mane
  hairPositions.set(maneData.positions, 0)
  hairNormals.set(maneData.normals, 0)
  hairUvs.set(maneData.uvs, 0)
  hairJoints.set(maneData.joints0, 0)
  hairWeights.set(maneData.weights0, 0)
  hairIndices.set(maneData.indices, 0)

  // Copy Tail (offset vertex index)
  const tailOffset = maneData.vertexCount
  hairPositions.set(tailData.positions, maneData.vertexCount * 3)
  hairNormals.set(tailData.normals, maneData.vertexCount * 3)
  hairUvs.set(tailData.uvs, maneData.vertexCount * 2)
  hairJoints.set(tailData.joints0, maneData.vertexCount * 4)
  hairWeights.set(tailData.weights0, maneData.vertexCount * 4)

  for (let i = 0; i < tailData.indexCount; i++) {
    hairIndices[maneData.indexCount + i] = tailData.indices[i] + tailOffset
  }

  console.log(`Hair consolidated: ${totalHairVerts} vertices, ${totalHairIndices / 3} triangles`)

  // --- 2. CONSOLIDATE TACK + HOOVES ---
  console.log('Consolidating Tack & Hooves...')
  const tackConfigs = [
    { meshIdx: 36, name: 'bit', color: [0.45, 0.45, 0.45, 1.0] },
    { meshIdx: 37, name: 'bridle', color: [0.24, 0.16, 0.10, 1.0] },
    { meshIdx: 38, name: 'bridle_body_metal', color: [0.45, 0.45, 0.45, 1.0] },
    { meshIdx: 39, name: 'bridle_body_leather', color: [0.24, 0.16, 0.10, 1.0] },
    { meshIdx: 46, name: 'hooves', color: [0.12, 0.11, 0.10, 1.0] },
    { meshIdx: 48, name: 'reins', color: [0.24, 0.16, 0.10, 1.0] },
    { meshIdx: 49, name: 'saddle_pad', color: [0.18, 0.16, 0.15, 1.0] },
    { meshIdx: 50, name: 'saddle_quilt_dark', color: [0.15, 0.13, 0.12, 1.0] },
    { meshIdx: 51, name: 'saddle_saddle', color: [0.22, 0.14, 0.09, 1.0] },
    { meshIdx: 52, name: 'saddle_stirrup', color: [0.42, 0.40, 0.38, 1.0] },
    { meshIdx: 53, name: 'saddle_stirrup_strap', color: [0.10, 0.10, 0.10, 1.0] },
  ]

  let totalTackVerts = 0
  let totalTackIndices = 0
  const tackDataList = tackConfigs.map((cfg) => {
    const data = getMeshPrimitives(cfg.meshIdx)
    totalTackVerts += data.vertexCount
    totalTackIndices += data.indexCount
    return { ...cfg, data }
  })

  const tackPositions = new Float32Array(totalTackVerts * 3)
  const tackNormals = new Float32Array(totalTackVerts * 3)
  const tackUvs = new Float32Array(totalTackVerts * 2)
  const tackColors = new Float32Array(totalTackVerts * 4)
  const tackJoints = new Uint8Array(totalTackVerts * 4)
  const tackWeights = new Float32Array(totalTackVerts * 4)
  const tackIndices = new Uint16Array(totalTackIndices)

  let currentVertOffset = 0
  let currentIndexOffset = 0

  for (const item of tackDataList) {
    const d = item.data
    const vCount = d.vertexCount
    const iCount = d.indexCount

    tackPositions.set(d.positions, currentVertOffset * 3)
    tackNormals.set(d.normals, currentVertOffset * 3)
    tackUvs.set(d.uvs, currentVertOffset * 2)

    // Set vertex color
    for (let v = 0; v < vCount; v++) {
      const idx4 = (currentVertOffset + v) * 4
      tackColors[idx4 + 0] = item.color[0]
      tackColors[idx4 + 1] = item.color[1]
      tackColors[idx4 + 2] = item.color[2]
      tackColors[idx4 + 3] = item.color[3]
    }

    // Set joints and normalized weights
    for (let v = 0; v < vCount; v++) {
      const v4 = v * 4
      const target4 = (currentVertOffset + v) * 4

      if (d.weights1) {
        // Collect all up to 8 weights
        const influences = []
        for (let k = 0; k < 4; k++) {
          influences.push({ joint: d.joints0[v4 + k], weight: d.weights0[v4 + k] })
          influences.push({ joint: d.joints1[v4 + k], weight: d.weights1[v4 + k] })
        }
        influences.sort((a, b) => b.weight - a.weight)
        const top4 = influences.slice(0, 4)
        const sum = top4.reduce((acc, cur) => acc + cur.weight, 0) || 1.0
        for (let k = 0; k < 4; k++) {
          tackJoints[target4 + k] = top4[k].joint
          tackWeights[target4 + k] = top4[k].weight / sum
        }
      } else {
        const sum = (d.weights0[v4] + d.weights0[v4 + 1] + d.weights0[v4 + 2] + d.weights0[v4 + 3]) || 1.0
        for (let k = 0; k < 4; k++) {
          tackJoints[target4 + k] = d.joints0[v4 + k]
          tackWeights[target4 + k] = d.weights0[v4 + k] / sum
        }
      }
    }

    // Indices with vertex offset
    for (let i = 0; i < iCount; i++) {
      tackIndices[currentIndexOffset + i] = d.indices[i] + currentVertOffset
    }

    currentVertOffset += vCount
    currentIndexOffset += iCount
  }

  console.log(`Tack consolidated: ${totalTackVerts} vertices, ${totalTackIndices / 3} triangles`)

  // --- 3. CREATE NEW MATERIAL FOR TACK ---
  const tackMatIdx = gltf.materials.length
  gltf.materials.push({
    name: 'runtime_v10_horse_tack_lod2',
    doubleSided: true,
    pbrMetallicRoughness: {
      baseColorFactor: [1.0, 1.0, 1.0, 1.0],
      roughnessFactor: 0.7,
      metallicFactor: 0.1,
    },
  })

  // --- 4. ENCODE NEW BUFFERS AND APPEND TO BIN CHUNK ---
  let binBuffers = [origBin]
  let currentBinOffset = origBin.length
  let currentUncompressedOffset = gltf.buffers[1].byteLength

  function appendBufferView({ uncompressedData, count, byteStride, mode, filter, target }) {
    // Encode with MeshoptEncoder
    const encoded = MeshoptEncoder.encodeGltfBuffer(
      new Uint8Array(uncompressedData.buffer, uncompressedData.byteOffset, uncompressedData.byteLength),
      count,
      byteStride,
      mode,
      filter,
    )

    // Ensure 4-byte alignment
    const alignedBinOffset = align4(currentBinOffset)
    const padBinBytes = alignedBinOffset - currentBinOffset
    if (padBinBytes > 0) {
      binBuffers.push(new Uint8Array(padBinBytes))
      currentBinOffset = alignedBinOffset
    }

    binBuffers.push(encoded)
    const compressedByteOffset = currentBinOffset
    const compressedByteLength = encoded.length
    currentBinOffset += compressedByteLength

    const uncompressedByteOffset = currentUncompressedOffset
    const uncompressedByteLength = uncompressedData.byteLength
    currentUncompressedOffset += uncompressedByteLength

    const bvIdx = gltf.bufferViews.length
    gltf.bufferViews.push({
      buffer: 1,
      byteOffset: uncompressedByteOffset,
      byteLength: uncompressedByteLength,
      target,
      extensions: {
        EXT_meshopt_compression: {
          buffer: 0,
          byteOffset: compressedByteOffset,
          byteLength: compressedByteLength,
          byteStride,
          count,
          mode,
          filter,
        },
      },
    })
    return bvIdx
  }

  function computeMinMaxVec3(arr, count) {
    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < count; i++) {
      for (let c = 0; c < 3; c++) {
        const val = arr[i * 3 + c]
        if (val < min[c]) min[c] = val
        if (val > max[c]) max[c] = val
      }
    }
    return { min, max }
  }

  // Add Hair Buffers & Accessors
  console.log('Encoding Hair bufferViews...')
  const hairIndBv = appendBufferView({
    uncompressedData: hairIndices,
    count: totalHairIndices,
    byteStride: 2,
    mode: 'INDICES',
    filter: 'NONE',
    target: 34963,
  })
  const hairPosBv = appendBufferView({
    uncompressedData: hairPositions,
    count: totalHairVerts,
    byteStride: 12,
    mode: 'ATTRIBUTES',
    filter: 'NONE',
    target: 34962,
  })
  const hairNormBv = appendBufferView({
    uncompressedData: hairNormals,
    count: totalHairVerts,
    byteStride: 12,
    mode: 'ATTRIBUTES',
    filter: 'OCTAHEDRAL',
    target: 34962,
  })
  const hairUvBv = appendBufferView({
    uncompressedData: hairUvs,
    count: totalHairVerts,
    byteStride: 8,
    mode: 'ATTRIBUTES',
    filter: 'NONE',
    target: 34962,
  })
  const hairJointBv = appendBufferView({
    uncompressedData: hairJoints,
    count: totalHairVerts,
    byteStride: 4,
    mode: 'ATTRIBUTES',
    filter: 'NONE',
    target: 34962,
  })
  const hairWeightBv = appendBufferView({
    uncompressedData: hairWeights,
    count: totalHairVerts,
    byteStride: 16,
    mode: 'ATTRIBUTES',
    filter: 'NONE',
    target: 34962,
  })

  const hairPosBounds = computeMinMaxVec3(hairPositions, totalHairVerts)

  const hairIndAcc = gltf.accessors.length
  gltf.accessors.push({
    bufferView: hairIndBv,
    byteOffset: 0,
    componentType: 5123,
    count: totalHairIndices,
    type: 'SCALAR',
  })
  const hairPosAcc = gltf.accessors.length
  gltf.accessors.push({
    bufferView: hairPosBv,
    byteOffset: 0,
    componentType: 5126,
    count: totalHairVerts,
    type: 'VEC3',
    min: hairPosBounds.min,
    max: hairPosBounds.max,
  })
  const hairNormAcc = gltf.accessors.length
  gltf.accessors.push({
    bufferView: hairNormBv,
    byteOffset: 0,
    componentType: 5126,
    count: totalHairVerts,
    type: 'VEC3',
  })
  const hairUvAcc = gltf.accessors.length
  gltf.accessors.push({
    bufferView: hairUvBv,
    byteOffset: 0,
    componentType: 5126,
    count: totalHairVerts,
    type: 'VEC2',
  })
  const hairJointAcc = gltf.accessors.length
  gltf.accessors.push({
    bufferView: hairJointBv,
    byteOffset: 0,
    componentType: 5121,
    count: totalHairVerts,
    type: 'VEC4',
  })
  const hairWeightAcc = gltf.accessors.length
  gltf.accessors.push({
    bufferView: hairWeightBv,
    byteOffset: 0,
    componentType: 5126,
    count: totalHairVerts,
    type: 'VEC4',
  })

  const hairMeshIdx = gltf.meshes.length
  gltf.meshes.push({
    name: 'horse_groom_hair_lod2',
    primitives: [
      {
        attributes: {
          JOINTS_0: hairJointAcc,
          NORMAL: hairNormAcc,
          POSITION: hairPosAcc,
          TEXCOORD_0: hairUvAcc,
          WEIGHTS_0: hairWeightAcc,
        },
        indices: hairIndAcc,
        material: 5, // Mat 5 (runtime_v9_mane_groom_cards, MASK)
        mode: 4,
      },
    ],
  })

  // Add Tack Buffers & Accessors
  console.log('Encoding Tack bufferViews...')
  const tackIndBv = appendBufferView({
    uncompressedData: tackIndices,
    count: totalTackIndices,
    byteStride: 2,
    mode: 'INDICES',
    filter: 'NONE',
    target: 34963,
  })
  const tackPosBv = appendBufferView({
    uncompressedData: tackPositions,
    count: totalTackVerts,
    byteStride: 12,
    mode: 'ATTRIBUTES',
    filter: 'NONE',
    target: 34962,
  })
  const tackNormBv = appendBufferView({
    uncompressedData: tackNormals,
    count: totalTackVerts,
    byteStride: 12,
    mode: 'ATTRIBUTES',
    filter: 'OCTAHEDRAL',
    target: 34962,
  })
  const tackUvBv = appendBufferView({
    uncompressedData: tackUvs,
    count: totalTackVerts,
    byteStride: 8,
    mode: 'ATTRIBUTES',
    filter: 'NONE',
    target: 34962,
  })
  const tackColorBv = appendBufferView({
    uncompressedData: tackColors,
    count: totalTackVerts,
    byteStride: 16,
    mode: 'ATTRIBUTES',
    filter: 'NONE',
    target: 34962,
  })
  const tackJointBv = appendBufferView({
    uncompressedData: tackJoints,
    count: totalTackVerts,
    byteStride: 4,
    mode: 'ATTRIBUTES',
    filter: 'NONE',
    target: 34962,
  })
  const tackWeightBv = appendBufferView({
    uncompressedData: tackWeights,
    count: totalTackVerts,
    byteStride: 16,
    mode: 'ATTRIBUTES',
    filter: 'NONE',
    target: 34962,
  })

  const tackPosBounds = computeMinMaxVec3(tackPositions, totalTackVerts)

  const tackIndAcc = gltf.accessors.length
  gltf.accessors.push({
    bufferView: tackIndBv,
    byteOffset: 0,
    componentType: 5123,
    count: totalTackIndices,
    type: 'SCALAR',
  })
  const tackPosAcc = gltf.accessors.length
  gltf.accessors.push({
    bufferView: tackPosBv,
    byteOffset: 0,
    componentType: 5126,
    count: totalTackVerts,
    type: 'VEC3',
    min: tackPosBounds.min,
    max: tackPosBounds.max,
  })
  const tackNormAcc = gltf.accessors.length
  gltf.accessors.push({
    bufferView: tackNormBv,
    byteOffset: 0,
    componentType: 5126,
    count: totalTackVerts,
    type: 'VEC3',
  })
  const tackUvAcc = gltf.accessors.length
  gltf.accessors.push({
    bufferView: tackUvBv,
    byteOffset: 0,
    componentType: 5126,
    count: totalTackVerts,
    type: 'VEC2',
  })
  const tackColorAcc = gltf.accessors.length
  gltf.accessors.push({
    bufferView: tackColorBv,
    byteOffset: 0,
    componentType: 5126,
    count: totalTackVerts,
    type: 'VEC4',
  })
  const tackJointAcc = gltf.accessors.length
  gltf.accessors.push({
    bufferView: tackJointBv,
    byteOffset: 0,
    componentType: 5121,
    count: totalTackVerts,
    type: 'VEC4',
  })
  const tackWeightAcc = gltf.accessors.length
  gltf.accessors.push({
    bufferView: tackWeightBv,
    byteOffset: 0,
    componentType: 5126,
    count: totalTackVerts,
    type: 'VEC4',
  })

  const tackMeshIdx = gltf.meshes.length
  gltf.meshes.push({
    name: 'horse_tack_lod2',
    primitives: [
      {
        attributes: {
          COLOR_0: tackColorAcc,
          JOINTS_0: tackJointAcc,
          NORMAL: tackNormAcc,
          POSITION: tackPosAcc,
          TEXCOORD_0: tackUvAcc,
          WEIGHTS_0: tackWeightAcc,
        },
        indices: tackIndAcc,
        material: tackMatIdx,
        mode: 4,
      },
    ],
  })

  // --- 5. CREATE NEW LOD2 NODES ---
  const hairNodeIdx = gltf.nodes.length
  gltf.nodes.push({
    name: 'horse_groom_hair_lod2',
    mesh: hairMeshIdx,
    skin: 0,
  })

  const tackNodeIdx = gltf.nodes.length
  gltf.nodes.push({
    name: 'horse_tack_lod2',
    mesh: tackMeshIdx,
    skin: 0,
  })

  // Node 122 is horse_body_lod2 (mesh 40, mat 4)
  const bodyNodeIdx = 122
  lod2Node.children = [bodyNodeIdx, hairNodeIdx, tackNodeIdx]

  console.log(`LOD2 children updated: [${lod2Node.children.join(', ')}]`)
  console.log('LOD2 now contains exactly 3 SkinnedMeshes: horse_body_lod2, horse_groom_hair_lod2, horse_tack_lod2')

  // --- 6. ASSEMBLE FINAL GLB BUFFER ---
  const finalBin = Buffer.concat(binBuffers)
  const finalBinLenAligned = align4(finalBin.length)
  const padBin = Buffer.alloc(finalBinLenAligned - finalBin.length, 0)
  const fullBinChunk = Buffer.concat([finalBin, padBin])

  gltf.buffers[0].byteLength = fullBinChunk.length
  gltf.buffers[1].byteLength = currentUncompressedOffset

  const jsonStr = JSON.stringify(gltf)
  const jsonBytes = Buffer.from(jsonStr, 'utf8')
  const jsonChunkLenAligned = align4(jsonBytes.length)
  const padJson = Buffer.alloc(jsonChunkLenAligned - jsonBytes.length, 0x20) // glTF pads JSON with 0x20 spaces
  const fullJsonChunk = Buffer.concat([jsonBytes, padJson])

  const totalGlbLength = 12 + 8 + fullJsonChunk.length + 8 + fullBinChunk.length
  const header = Buffer.alloc(12)
  header.write('glTF', 0, 'ascii')
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(totalGlbLength, 8)

  const jsonHeader = Buffer.alloc(8)
  jsonHeader.writeUInt32LE(fullJsonChunk.length, 0)
  jsonHeader.writeUInt32LE(0x4e4f534a, 4)

  const binHeader = Buffer.alloc(8)
  binHeader.writeUInt32LE(fullBinChunk.length, 0)
  binHeader.writeUInt32LE(0x004e4942, 4)

  const outputGlb = Buffer.concat([
    header,
    jsonHeader,
    fullJsonChunk,
    binHeader,
    fullBinChunk,
  ])

  console.log(`Writing consolidated GLB (${outputGlb.length} bytes)...`)
  fs.writeFileSync(GLB_PATH, outputGlb)

  // --- 7. UPDATE MANIFEST.JSON ---
  console.log('Updating manifest.json...')
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
  const prevTriangles = manifest.metrics.triangles.lod2
  const prevPackageBytes = manifest.metrics.packageBytes

  manifest.metrics.triangles.lod2 = 1244 + (totalHairIndices / 3) + (totalTackIndices / 3)

  // Calculate new packageBytes
  const packageDir = path.dirname(MANIFEST_PATH)
  const runtimeFiles = [
    'manifest.json',
    'horse_runtime.glb',
    ...fs.readdirSync(path.join(packageDir, 'textures')).map((n) => `textures/${n}`),
    ...fs.readdirSync(path.join(packageDir, 'basis')).map((n) => `basis/${n}`),
  ]
  // We need to write manifest first to get exact size
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n')
  const newPackageBytes = runtimeFiles.reduce((total, rel) => total + fs.statSync(path.join(packageDir, rel)).size, 0)
  manifest.metrics.packageBytes = newPackageBytes
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n')

  console.log(`Manifest updated: LOD2 triangles ${prevTriangles} -> ${manifest.metrics.triangles.lod2}, packageBytes ${prevPackageBytes} -> ${newPackageBytes}`)

  // --- 8. VERIFY RELOAD WITH THREE.JS GLTFLoader ---
  console.log('Verifying generated GLB with Three.js GLTFLoader + MeshoptDecoder...')
  const loader = new GLTFLoader()
  loader.setMeshoptDecoder(MeshoptDecoder)
  loader.register(() => ({
    name: 'KHR_texture_basisu',
    loadTexture: async () => new THREE.Texture(),
  }))

  const loadedGlb = await new Promise((resolve, reject) => {
    loader.parse(outputGlb.buffer.slice(outputGlb.byteOffset, outputGlb.byteOffset + outputGlb.byteLength), '', resolve, reject)
  })

  console.log('GLTFLoader parsed successfully!')
  const scene = loadedGlb.scene
  const lod2Loaded = scene.getObjectByName('horse_lod2')
  if (!lod2Loaded) throw new Error('horse_lod2 not found in reloaded scene')

  const lod2Meshes = []
  lod2Loaded.traverse((child) => {
    if (child.isMesh) lod2Meshes.push(child)
  })

  console.log(`Reloaded horse_lod2 contains ${lod2Meshes.length} meshes:`)
  let reloadedLod2Triangles = 0
  for (const m of lod2Meshes) {
    const isSkinned = m instanceof THREE.SkinnedMesh
    const triCount = m.geometry.index ? m.geometry.index.count / 3 : m.geometry.attributes.position.count / 3
    reloadedLod2Triangles += triCount
    console.log(`  - [${m.name}]: isSkinnedMesh=${isSkinned}, material=${m.material?.name}, tris=${triCount}, hasSkinIndex=${!!m.geometry.attributes.skinIndex}, hasSkinWeight=${!!m.geometry.attributes.skinWeight}, hasColor=${!!m.geometry.attributes.color}`)
    if (!isSkinned) throw new Error(`Mesh ${m.name} is not a SkinnedMesh!`)
    if (!m.geometry.attributes.skinIndex || !m.geometry.attributes.skinWeight) {
      throw new Error(`Mesh ${m.name} is missing skinIndex or skinWeight!`)
    }
  }

  if (lod2Meshes.length !== 3) {
    throw new Error(`Expected exactly 3 meshes in LOD2, found ${lod2Meshes.length}`)
  }
  if (reloadedLod2Triangles !== manifest.metrics.triangles.lod2) {
    throw new Error(`Reloaded LOD2 triangles (${reloadedLod2Triangles}) !== manifest (${manifest.metrics.triangles.lod2})`)
  }

  // Verify LOD0 & LOD1
  const lod0Loaded = scene.getObjectByName('horse_lod0')
  const lod1Loaded = scene.getObjectByName('horse_lod1')
  let lod0Tris = 0
  let lod1Tris = 0
  lod0Loaded.traverse((c) => { if (c.isMesh) lod0Tris += c.geometry.index.count / 3 })
  lod1Loaded.traverse((c) => { if (c.isMesh) lod1Tris += c.geometry.index.count / 3 })
  console.log(`LOD0 tris: ${lod0Tris} (expected ${manifest.metrics.triangles.lod0})`)
  console.log(`LOD1 tris: ${lod1Tris} (expected ${manifest.metrics.triangles.lod1})`)
  if (lod0Tris !== manifest.metrics.triangles.lod0) throw new Error('LOD0 triangles changed!')
  if (lod1Tris !== manifest.metrics.triangles.lod1) throw new Error('LOD1 triangles changed!')

  console.log('\nConsolidation and structural verification completed with 100% SUCCESS!')
}

main().catch((err) => {
  console.error('Consolidation failed:', err)
  process.exit(1)
})
