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

const readComponent = { 5126: (b, at) => b.readFloatLE(at), 5123: (b, at) => b.readUInt16LE(at) / 65535, 5121: (b, at) => b[at] / 255 }
const writeComponent = { 5126: (b, at, v) => b.writeFloatLE(v, at), 5123: (b, at, v) => b.writeUInt16LE(Math.round(v * 65535), at), 5121: (b, at, v) => { b[at] = Math.round(v * 255) } }

/** Meshy's auto-rig binds much of the waist above the hip joint to the thighs, so spreading the legs collapses it.
 * Above `top` thigh weight moves to the pelvis; between `bottom` and `top` it fades, keeping the skirt on the thighs.
 * Positions, UVs, normals and textures are untouched. Mutates `baked.binary`. */
export function reweightWaist(baked, bottom, top) {
  const { document, binary } = baked
  const skin = document.skins[0], primitive = document.meshes[0].primitives[0]
  const jointOf = name => skin.joints.findIndex(node => document.nodes[node].name === `mixamorig:${name}`)
  const hips = jointOf('Hips'), legs = new Set([jointOf('LeftUpLeg'), jointOf('RightUpLeg')])
  const view = accessor => { const a = document.accessors[accessor], v = document.bufferViews[a.bufferView]; return { a, base: (v.byteOffset ?? 0) + (a.byteOffset ?? 0), stride: v.byteStride } }
  const pos = view(primitive.attributes.POSITION), joints = view(primitive.attributes.JOINTS_0), weights = view(primitive.attributes.WEIGHTS_0)
  const jointSize = joints.a.componentType === 5123 ? 2 : 1
  const weightSize = { 5126: 4, 5123: 2, 5121: 1 }[weights.a.componentType]
  const readW = readComponent[weights.a.componentType], writeW = writeComponent[weights.a.componentType]
  let changed = 0
  for (let i = 0; i < pos.a.count; i++) {
    const y = binary.readFloatLE(pos.base + i * (pos.stride ?? 12) + 4)
    const u = Math.min(1, Math.max(0, (y - bottom) / (top - bottom)))
    const fade = u * u * (3 - 2 * u)
    if (fade === 0) continue
    const jointAt = c => joints.base + i * (joints.stride ?? 4 * jointSize) + c * jointSize
    const weightAt = c => weights.base + i * (weights.stride ?? 4 * weightSize) + c * weightSize
    const readJ = c => jointSize === 2 ? binary.readUInt16LE(jointAt(c)) : binary[jointAt(c)]
    const writeJ = (c, v) => { if (jointSize === 2) binary.writeUInt16LE(v, jointAt(c)); else binary[jointAt(c)] = v }
    const slots = [0, 1, 2, 3].map(c => ({ c, joint: readJ(c), weight: readW(binary, weightAt(c)) }))
    let moved = 0
    for (const slot of slots) if (legs.has(slot.joint) && slot.weight > 0) { moved += slot.weight * fade; slot.weight *= 1 - fade }
    if (moved === 0) continue
    // Prefer an existing pelvis slot, then an empty one, then the leg slot it drained the most.
    const target = slots.find(s => s.joint === hips && s.weight > 0) ?? slots.find(s => s.weight === 0) ?? slots.reduce((a, b) => legs.has(b.joint) && (!legs.has(a.joint) || b.weight < a.weight) ? b : a)
    if (target.joint !== hips || target.weight === 0) {
      const spilled = legs.has(target.joint) ? target.weight : 0
      target.joint = hips; target.weight = spilled
    }
    target.weight += moved
    const sum = slots.reduce((s, x) => s + x.weight, 0)
    for (const slot of slots) { writeJ(slot.c, slot.joint); writeW(binary, weightAt(slot.c), slot.weight / sum) }
    changed++
  }
  return changed
}
