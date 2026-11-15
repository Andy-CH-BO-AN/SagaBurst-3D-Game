/** Structural GLB editing on a meshopt-decoded copy: replace images, replace a primitive's
 * triangles with an index subset (retained vertex rows are byte-identical), then drop
 * unreferenced accessors/views and repack. Animation, skin and untouched views keep their bytes.
 */
import fs from 'node:fs'
import { readGlb, encodeGlb } from './humanoid-glb.mjs'
import { MESHOPT_EXTENSION, decodeMeshoptGlb } from './meshopt-glb.mjs'
import { packFactionHumanoidBuffers } from '../pack-faction-humanoid-buffers.mjs'

const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }
const COMPONENT_COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }
const align4 = value => value + (4 - value % 4) % 4

export async function openGlb(path) {
  const raw = readGlb(path)
  const compressed = raw.document.bufferViews?.some(view => view.extensions?.[MESHOPT_EXTENSION]) ?? false
  const decoded = await decodeMeshoptGlb(raw)
  return new GlbEdit(decoded, compressed)
}

export class GlbEdit {
  constructor(asset, compressed) {
    this.document = structuredClone(asset.document)
    this.binary = Buffer.from(asset.binary)
    this.compressed = compressed
  }

  viewBytes(index) {
    const view = this.document.bufferViews[index]
    if (view.buffer !== 0) throw new Error('Expected a decoded buffer 0 view')
    return this.binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength)
  }

  appendView(bytes, target) {
    const offset = align4(this.binary.length)
    this.binary = Buffer.concat([this.binary, Buffer.alloc(offset - this.binary.length), bytes])
    this.document.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target ? { target } : {}) })
    return this.document.bufferViews.length - 1
  }

  /** Packed element bytes of one accessor (honours byteStride). */
  accessorElements(index) {
    const accessor = this.document.accessors[index]
    if (accessor.sparse) throw new Error('Sparse accessors are not supported')
    const width = COMPONENT_BYTES[accessor.componentType] * COMPONENT_COUNT[accessor.type]
    const view = this.document.bufferViews[accessor.bufferView], bytes = this.viewBytes(accessor.bufferView)
    const stride = view.byteStride ?? width, start = accessor.byteOffset ?? 0
    return { accessor, width, at: row => bytes.subarray(start + row * stride, start + row * stride + width) }
  }

  readIndices(index) {
    const { accessor, at } = this.accessorElements(index)
    const out = new Uint32Array(accessor.count)
    for (let i = 0; i < accessor.count; i++) {
      const b = at(i)
      out[i] = accessor.componentType === 5125 ? b.readUInt32LE(0) : accessor.componentType === 5123 ? b.readUInt16LE(0) : b.readUInt8(0)
    }
    return out
  }

  readFloats(index) {
    const { accessor, at } = this.accessorElements(index)
    if (accessor.componentType !== 5126 || accessor.normalized) throw new Error('Expected a float accessor')
    const n = COMPONENT_COUNT[accessor.type], out = new Float32Array(accessor.count * n)
    for (let i = 0; i < accessor.count; i++) { const b = at(i); for (let c = 0; c < n; c++) out[i * n + c] = b.readFloatLE(c * 4) }
    return out
  }

  /** Any numeric accessor as plain numbers (joint indices, normalized weights, positions). */
  readNumbers(index) {
    const { accessor, at } = this.accessorElements(index)
    const n = COMPONENT_COUNT[accessor.type], size = COMPONENT_BYTES[accessor.componentType]
    const read = { 5126: 'readFloatLE', 5125: 'readUInt32LE', 5123: 'readUInt16LE', 5121: 'readUInt8', 5122: 'readInt16LE', 5120: 'readInt8' }[accessor.componentType]
    const scale = accessor.normalized ? { 5121: 255, 5123: 65535, 5120: 127, 5122: 32767 }[accessor.componentType] : 1
    const out = new Float64Array(accessor.count * n)
    for (let i = 0; i < accessor.count; i++) { const b = at(i); for (let c = 0; c < n; c++) out[i * n + c] = b[read](c * size) / scale }
    return out
  }

  /** Replace a primitive's triangles. `indices` refer to the current vertex rows; unused rows are
   * dropped and every retained attribute row is copied byte-for-byte. */
  replaceTriangles(meshIndex, primitiveIndex, indices) {
    const primitive = this.document.meshes[meshIndex].primitives[primitiveIndex]
    if ((primitive.mode ?? 4) !== 4) throw new Error('Only triangle lists are supported')
    if (primitive.targets?.length) throw new Error('Morph targets are not supported')
    const used = [...new Set(indices)].sort((a, b) => a - b), remap = new Map(used.map((old, i) => [old, i]))
    const attributes = {}
    for (const [name, index] of Object.entries(primitive.attributes)) {
      const { accessor, width, at } = this.accessorElements(index)
      const bytes = Buffer.alloc(used.length * width)
      used.forEach((row, i) => at(row).copy(bytes, i * width))
      const view = this.appendView(bytes, 34962)
      const copy = { bufferView: view, componentType: accessor.componentType, count: used.length, type: accessor.type,
        ...(accessor.normalized ? { normalized: true } : {}) }
      if (accessor.min || accessor.max) Object.assign(copy, this.bounds(bytes, accessor))
      this.document.accessors.push(copy)
      attributes[name] = this.document.accessors.length - 1
    }
    const wide = used.length > 65535
    const indexBytes = Buffer.alloc(indices.length * (wide ? 4 : 2))
    indices.forEach((old, i) => wide ? indexBytes.writeUInt32LE(remap.get(old), i * 4) : indexBytes.writeUInt16LE(remap.get(old), i * 2))
    this.document.accessors.push({ bufferView: this.appendView(indexBytes, 34963), componentType: wide ? 5125 : 5123, count: indices.length, type: 'SCALAR' })
    primitive.attributes = attributes
    primitive.indices = this.document.accessors.length - 1
    return { vertices: used.length, triangles: indices.length / 3 }
  }

  bounds(bytes, accessor) {
    const n = COMPONENT_COUNT[accessor.type], size = COMPONENT_BYTES[accessor.componentType]
    const read = { 5126: 'readFloatLE', 5125: 'readUInt32LE', 5123: 'readUInt16LE', 5121: 'readUInt8', 5122: 'readInt16LE', 5120: 'readInt8' }[accessor.componentType]
    const min = Array(n).fill(Infinity), max = Array(n).fill(-Infinity)
    for (let offset = 0; offset < bytes.length; offset += n * size) for (let c = 0; c < n; c++) {
      const v = bytes[read](offset + c * size); if (v < min[c]) min[c] = v; if (v > max[c]) max[c] = v
    }
    return { min, max }
  }

  imageBytes(index) { return this.viewBytes(this.document.images[index].bufferView) }

  replaceImage(index, bytes, mimeType) {
    const image = this.document.images[index]
    image.bufferView = this.appendView(bytes)
    image.mimeType = mimeType
  }

  /** Point every texture that samples `imageIndex` at it through KHR_texture_basisu. */
  useBasisu(imageIndex) {
    for (const texture of this.document.textures ?? []) {
      if (texture.source !== imageIndex) continue
      delete texture.source
      texture.extensions = { ...texture.extensions, KHR_texture_basisu: { source: imageIndex } }
    }
    for (const key of ['extensionsUsed', 'extensionsRequired']) this.document[key] = [...new Set([...(this.document[key] ?? []), 'KHR_texture_basisu'])]
  }

  /** Drop accessors/views nothing references, then repack buffer 0 in view order. */
  compact() {
    const d = this.document, usedAccessors = new Set()
    for (const mesh of d.meshes ?? []) for (const p of mesh.primitives) {
      Object.values(p.attributes).forEach(i => usedAccessors.add(i))
      if (p.indices !== undefined) usedAccessors.add(p.indices)
      for (const target of p.targets ?? []) Object.values(target).forEach(i => usedAccessors.add(i))
    }
    for (const skin of d.skins ?? []) if (skin.inverseBindMatrices !== undefined) usedAccessors.add(skin.inverseBindMatrices)
    for (const animation of d.animations ?? []) for (const s of animation.samplers) { usedAccessors.add(s.input); usedAccessors.add(s.output) }
    const accessorMap = new Map(), accessors = []
    d.accessors.forEach((a, i) => { if (usedAccessors.has(i)) { accessorMap.set(i, accessors.length); accessors.push(a) } })
    const usedViews = new Set([...accessors.map(a => a.bufferView), ...(d.images ?? []).map(img => img.bufferView)])
    const viewMap = new Map(), views = [], chunks = []
    let offset = 0
    d.bufferViews.forEach((view, i) => {
      if (!usedViews.has(i)) return
      const bytes = this.viewBytes(i), aligned = align4(offset)
      if (aligned > offset) chunks.push(Buffer.alloc(aligned - offset))
      chunks.push(bytes)
      viewMap.set(i, views.length)
      views.push({ ...view, buffer: 0, byteOffset: aligned })
      offset = aligned + bytes.length
    })
    for (const a of accessors) a.bufferView = viewMap.get(a.bufferView)
    for (const image of d.images ?? []) image.bufferView = viewMap.get(image.bufferView)
    const ref = i => accessorMap.get(i)
    for (const mesh of d.meshes ?? []) for (const p of mesh.primitives) {
      for (const k of Object.keys(p.attributes)) p.attributes[k] = ref(p.attributes[k])
      if (p.indices !== undefined) p.indices = ref(p.indices)
      for (const target of p.targets ?? []) for (const k of Object.keys(target)) target[k] = ref(target[k])
    }
    for (const skin of d.skins ?? []) if (skin.inverseBindMatrices !== undefined) skin.inverseBindMatrices = ref(skin.inverseBindMatrices)
    for (const animation of d.animations ?? []) for (const s of animation.samplers) { s.input = ref(s.input); s.output = ref(s.output) }
    d.accessors = accessors
    d.bufferViews = views
    d.buffers = [{ byteLength: offset }]
    this.binary = Buffer.concat(chunks)
  }

  /** Final bytes; meshopt-compressed inputs are re-packed through the byte-exact repository packer. */
  async encode() {
    this.compact()
    const asset = { document: this.document, binary: this.binary }
    if (!this.compressed) return encodeGlb(asset.document, asset.binary)
    const packed = await packFactionHumanoidBuffers(asset)
    return encodeGlb(packed.document, packed.binary)
  }

  async write(path) {
    const bytes = await this.encode()
    fs.writeFileSync(path, bytes)
    return bytes
  }
}
