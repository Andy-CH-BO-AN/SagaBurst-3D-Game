/** Normalise the Meshy Mixamo export (cm bones under a 0.01 Armature) into a unit-scale skeleton.
 * Mesh, UV and skin-weight bytes are untouched; only joint translations, inverse-binds and
 * position tracks are multiplied by the Armature scale, so every bind/world matrix is the
 * exact same metre-space matrix the game previously obtained through the Armature node. */
import { readGlb, encodeGlb } from './humanoid-glb.mjs'

export function bakeArmatureScale(asset) {
  const document = structuredClone(asset.document)
  const binary = Buffer.from(asset.binary)
  const armature = document.nodes.findIndex(node => node.name === 'Armature')
  if (armature < 0) throw new Error('Source has no Armature node')
  const s = document.nodes[armature].scale?.[0] ?? 1
  if (!(s > 0) || document.nodes[armature].scale?.some(v => Math.abs(v - s) > 1e-9)) throw new Error('Armature scale must be uniform')
  delete document.nodes[armature].scale
  const visit = index => {
    const node = document.nodes[index]
    if (node.translation) node.translation = node.translation.map(v => v * s)
    for (const child of node.children ?? []) visit(child)
  }
  for (const child of document.nodes[armature].children ?? []) visit(child)
  // inverse(world_new) = S * inverse(world_old): scale the first three rows of every column.
  for (const skin of document.skins) {
    const accessor = document.accessors[skin.inverseBindMatrices], view = document.bufferViews[accessor.bufferView]
    const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
    for (let m = 0; m < accessor.count; m++) for (let c = 0; c < 4; c++) for (let r = 0; r < 3; r++) {
      const at = base + (m * 16 + c * 4 + r) * 4
      binary.writeFloatLE(binary.readFloatLE(at) * s, at)
    }
  }
  return { document, binary, scale: s }
}

/** Rebuild the GLB with only referenced data: mesh/skin bytes copied verbatim, images optionally replaced,
 * animations written from `clips` ({ name, tracks: [{ node, path: 'rotation'|'translation', times, values }] }). */
export function assembleGlb(baked, clips, images) {
  const source = baked.document
  const document = { asset: { ...source.asset, extras: { ...(source.asset.extras ?? {}), byzantineCataphract: { generator: 'tools/build-byzantine-cataphract.mjs' } } },
    scene: source.scene, scenes: source.scenes, nodes: source.nodes, meshes: structuredClone(source.meshes), skins: structuredClone(source.skins),
    materials: source.materials, textures: source.textures, samplers: source.samplers, images: structuredClone(source.images),
    accessors: [], bufferViews: [], buffers: [{ byteLength: 0 }], animations: [] }
  const chunks = []
  let offset = 0
  const addView = bytes => {
    const pad = (4 - offset % 4) % 4
    if (pad) { chunks.push(Buffer.alloc(pad)); offset += pad }
    document.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length })
    chunks.push(bytes); offset += bytes.length
    return document.bufferViews.length - 1
  }
  const copied = new Map()
  const copyAccessor = index => {
    if (copied.has(index)) return copied.get(index)
    const accessor = structuredClone(source.accessors[index]), view = source.bufferViews[accessor.bufferView]
    const componentSize = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[accessor.componentType]
    const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[accessor.type]
    const stride = view.byteStride
    const packed = componentSize * width
    const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
    let bytes
    if (stride && stride !== packed) {
      bytes = Buffer.alloc(accessor.count * packed)
      for (let i = 0; i < accessor.count; i++) baked.binary.copy(bytes, i * packed, start + i * stride, start + i * stride + packed)
    } else bytes = baked.binary.subarray(start, start + accessor.count * packed)
    accessor.bufferView = addView(Buffer.from(bytes)); delete accessor.byteOffset
    if (view.target) document.bufferViews[accessor.bufferView].target = view.target
    document.accessors.push(accessor)
    copied.set(index, document.accessors.length - 1)
    return document.accessors.length - 1
  }
  for (const mesh of document.meshes) for (const primitive of mesh.primitives) {
    for (const key of Object.keys(primitive.attributes)) primitive.attributes[key] = copyAccessor(primitive.attributes[key])
    if (primitive.indices !== undefined) primitive.indices = copyAccessor(primitive.indices)
  }
  for (const skin of document.skins) skin.inverseBindMatrices = copyAccessor(skin.inverseBindMatrices)
  document.images.forEach((image, index) => {
    const view = source.bufferViews[image.bufferView]
    const bytes = images?.[index] ?? baked.binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength)
    image.bufferView = addView(Buffer.from(bytes))
  })
  const append = (array, type) => {
    const floats = Float32Array.from(array)
    const bytes = Buffer.from(floats.buffer)
    const view = addView(bytes)
    const width = { SCALAR: 1, VEC3: 3, VEC4: 4 }[type]
    const accessor = { bufferView: view, componentType: 5126, count: floats.length / width, type }
    if (type === 'SCALAR') { accessor.min = [floats[0]]; accessor.max = [floats[floats.length - 1]] }
    document.accessors.push(accessor)
    return document.accessors.length - 1
  }
  for (const clip of clips) {
    const samplers = [], channels = []
    for (const track of clip.tracks) {
      const node = document.nodes.findIndex(n => n.name === track.node)
      if (node < 0) throw new Error(`Unknown node ${track.node} in ${clip.name}`)
      channels.push({ sampler: samplers.length, target: { node, path: track.path } })
      samplers.push({ input: append(track.times, 'SCALAR'), output: append(track.values, track.path === 'rotation' ? 'VEC4' : 'VEC3'), interpolation: 'LINEAR' })
    }
    document.animations.push({ name: clip.name, samplers, channels })
  }
  const pad = (4 - offset % 4) % 4
  if (pad) { chunks.push(Buffer.alloc(pad)); offset += pad }
  document.buffers[0].byteLength = offset
  return encodeGlb(document, Buffer.concat(chunks))
}
