import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { MESHOPT_EXTENSION, embeddedBufferBytes } from './meshopt-glb.mjs'

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }
const CLIP = 'axeAttack2H'
// These extensions either have references handled below or cannot reference
// animation accessors/embedded byte offsets. Unknown binary-reference schemes
// must be reviewed before a compactor can safely move their data.
const SUPPORTED_EXTENSIONS = new Set([
  MESHOPT_EXTENSION, 'EXT_mesh_gpu_instancing', 'EXT_structural_metadata', 'EXT_mesh_features',
  'KHR_draco_mesh_compression', 'KHR_mesh_quantization', 'KHR_animation_pointer',
  'KHR_lights_punctual', 'KHR_materials_variants', 'KHR_xmp_json_ld',
  'KHR_texture_transform', 'KHR_texture_basisu', 'EXT_texture_webp', 'EXT_texture_avif',
  'KHR_materials_unlit', 'KHR_materials_pbrSpecularGlossiness', 'KHR_materials_clearcoat',
  'KHR_materials_transmission', 'KHR_materials_volume', 'KHR_materials_ior',
  'KHR_materials_specular', 'KHR_materials_sheen', 'KHR_materials_iridescence',
  'KHR_materials_emissive_strength', 'KHR_materials_anisotropy', 'KHR_materials_dispersion',
])
const align4 = n => n + (4 - n % 4) % 4
const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0)
const norm = a => Math.hypot(...a)
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])

function normalizeQuaternion(value, derivative) {
  const length = norm(value)
  if (!(length > 1e-12)) throw new Error('Cannot trim a zero-length quaternion')
  const q = value.map(x => x / length)
  if (!derivative) return q
  const projection = dot(q, derivative)
  return derivative.map((x, i) => (x - q[i] * projection) / length)
}

function slerp(a, b, t) {
  a = normalizeQuaternion(a); b = normalizeQuaternion(b)
  let cosine = dot(a, b)
  if (cosine < 0) { b = b.map(x => -x); cosine = -cosine }
  if (cosine > .9995) return normalizeQuaternion(a.map((x, i) => x + (b[i] - x) * t))
  const angle = Math.acos(Math.min(1, cosine)), sine = Math.sin(angle)
  return a.map((x, i) => (x * Math.sin((1 - t) * angle) + b[i] * Math.sin(t * angle)) / sine)
}

function hermite(a, b, outTangent, inTangent, span, t) {
  const t2 = t * t, t3 = t2 * t
  const value = a.map((x, i) => (2 * t3 - 3 * t2 + 1) * x + (t3 - 2 * t2 + t) * span * outTangent[i]
    + (-2 * t3 + 3 * t2) * b[i] + (t3 - t2) * span * inTangent[i])
  const derivative = a.map((x, i) => ((6 * t2 - 6 * t) * x + (3 * t2 - 4 * t + 1) * span * outTangent[i]
    + (-6 * t2 + 6 * t) * b[i] + (3 * t2 - 2 * t) * span * inTangent[i]) / span)
  return { value, derivative }
}

function accessorViews(a) {
  return [a.bufferView, a.sparse?.indices.bufferView, a.sparse?.values.bufferView].filter(x => x !== undefined)
}

/** Keep indices stable, including unknown extension references. */
function externalAccessorReferences(document, target) {
  const refs = new Set()
  const attributes = object => { for (const value of Object.values(object ?? {})) refs.add(value) }
  for (const mesh of document.meshes ?? []) for (const primitive of mesh.primitives) {
    attributes(primitive.attributes)
    if (primitive.indices !== undefined) refs.add(primitive.indices)
    for (const morph of primitive.targets ?? []) attributes(morph)
  }
  for (const skin of document.skins ?? []) if (skin.inverseBindMatrices !== undefined) refs.add(skin.inverseBindMatrices)
  for (const animation of document.animations ?? []) if (animation !== target) {
    for (const sampler of animation.samplers) { refs.add(sampler.input); refs.add(sampler.output) }
  }
  for (const node of document.nodes ?? []) attributes(node.extensions?.EXT_mesh_gpu_instancing?.attributes)
  // Custom extension fields explicitly named accessor/accessors are also safe.
  function visit(value) {
    if (!value || typeof value !== 'object') return
    for (const [name, child] of Object.entries(value)) {
      if (name === 'accessor' && Number.isInteger(child)) refs.add(child)
      else if (name === 'accessors' && Array.isArray(child)) child.forEach(x => { if (Number.isInteger(x)) refs.add(x) })
      else if (name !== 'accessors' && name !== 'animations' && name !== 'bufferViews') visit(child)
    }
  }
  visit(document)
  return refs
}

function nonAccessorViewReferences(document) {
  const refs = new Set()
  function visit(value) {
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      if (key === 'bufferView' && Number.isInteger(child)) refs.add(child)
      else if (key !== 'accessors' && key !== 'bufferViews') visit(child)
    }
  }
  visit(document)
  // EXT_structural_metadata uses these names rather than bufferView.
  for (const table of document.extensions?.EXT_structural_metadata?.propertyTables ?? []) {
    for (const property of Object.values(table.properties ?? {})) {
      for (const key of ['values', 'arrayOffsets', 'stringOffsets']) if (property[key] !== undefined) refs.add(property[key])
    }
  }
  return refs
}

function unionRanges(ranges) {
  const result = []
  for (const [start, end] of ranges.filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0])) {
    const last = result.at(-1)
    if (last && start <= last[1]) last[1] = Math.max(last[1], end)
    else result.push([start, end])
  }
  return result
}

function subtractRanges(ranges, protectedRanges) {
  const result = []
  for (const [start, end] of unionRanges(ranges)) {
    let cursor = start
    for (const [a, b] of protectedRanges) {
      if (b <= cursor) continue
      if (a >= end) break
      if (a > cursor) result.push([cursor, a])
      cursor = Math.max(cursor, b)
      if (cursor >= end) break
    }
    if (cursor < end) result.push([cursor, end])
  }
  return result
}

function physicalRanges(asset, view) {
  const ranges = [], extension = view.extensions?.[MESHOPT_EXTENSION]
  const add = (buffer, start = 0, length) => {
    if (buffer !== 0) return
    embeddedBufferBytes(asset, buffer, start, length)
    ranges.push([start, start + length])
  }
  add(view.buffer, view.byteOffset, view.byteLength)
  if (extension) add(extension.buffer, extension.byteOffset, extension.byteLength)
  return ranges
}

async function makeAccessorReader(asset) {
  const views = new Map()
  async function readView(index) {
    if (views.has(index)) return views.get(index)
    const view = asset.document.bufferViews[index]
    if (!view) throw new Error(`Missing bufferView ${index}`)
    const extension = view.extensions?.[MESHOPT_EXTENSION]
    let bytes
    if (extension) {
      if (extension.count * extension.byteStride !== view.byteLength) throw new Error('Invalid meshopt decoded length')
      await MeshoptDecoder.ready
      bytes = Buffer.alloc(view.byteLength)
      MeshoptDecoder.decodeGltfBuffer(bytes, extension.count, extension.byteStride,
        embeddedBufferBytes(asset, extension.buffer, extension.byteOffset ?? 0, extension.byteLength), extension.mode, extension.filter)
    } else bytes = embeddedBufferBytes(asset, view.buffer, view.byteOffset ?? 0, view.byteLength)
    views.set(index, bytes)
    return bytes
  }
  return async index => {
    const accessor = asset.document.accessors[index]
    if (!accessor || accessor.componentType !== 5126 || !COMPONENTS[accessor.type] || accessor.normalized) {
      throw new Error(`Animation accessor ${index} must contain non-normalized FLOAT scalars/vectors`)
    }
    const size = COMPONENTS[accessor.type], result = new Float32Array(accessor.count * size)
    if (accessor.bufferView !== undefined) {
      const bytes = await readView(accessor.bufferView), view = asset.document.bufferViews[accessor.bufferView]
      const stride = view.byteStride ?? size * 4
      for (let row = 0; row < accessor.count; row++) for (let c = 0; c < size; c++) {
        result[row * size + c] = bytes.readFloatLE((accessor.byteOffset ?? 0) + row * stride + c * 4)
      }
    }
    if (accessor.sparse) {
      const { indices, values, count } = accessor.sparse
      const indicesBytes = await readView(indices.bufferView), valuesBytes = await readView(values.bufferView)
      const readers = { 5121: ['readUInt8', 1], 5123: ['readUInt16LE', 2], 5125: ['readUInt32LE', 4] }
      const reader = readers[indices.componentType]
      if (!reader) throw new Error('Invalid sparse index component type')
      for (let row = 0; row < count; row++) {
        const at = indicesBytes[reader[0]]((indices.byteOffset ?? 0) + row * reader[1])
        if (at >= accessor.count) throw new Error('Sparse animation index is out of bounds')
        for (let c = 0; c < size; c++) result[at * size + c] = valuesBytes.readFloatLE((values.byteOffset ?? 0) + (row * size + c) * 4)
      }
    }
    if (result.some(x => !Number.isFinite(x))) throw new Error(`Non-finite animation accessor ${index}`)
    return result
  }
}

function makeCurve(times, output, width, interpolation, rotation) {
  const cubic = interpolation === 'CUBICSPLINE', factor = cubic ? 3 : 1
  const keys = Array.from(times, (_, row) => {
    const read = part => Array.from(output.subarray((row * factor + part) * width, (row * factor + part + 1) * width))
    return { value: read(cubic ? 1 : 0), incoming: cubic ? read(0) : Array(width).fill(0), outgoing: cubic ? read(2) : Array(width).fill(0) }
  })
  // glTF clamps outside each sampler's own domain. Its endpoint-facing
  // tangents were unused in the source and must not bend the new constant
  // segments when another channel makes the common trim interval longer.
  if (cubic) {
    keys[0].incoming = Array(width).fill(0)
    keys.at(-1).outgoing = Array(width).fill(0)
  }
  let hemisphereFlips = 0
  // glTF cubic rotations interpolate the authored quaternion components, not
  // the shortest arc. Flipping their keys/tangents changes the curve. Preserve
  // those signs and obtain adjacent-hemisphere continuity by subdivision below.
  if (rotation && !cubic) for (let i = 1; i < keys.length; i++) if (dot(keys[i - 1].value, keys[i].value) < 0) {
    for (const part of ['value', 'incoming', 'outgoing']) keys[i][part] = keys[i][part].map(x => -x)
    hemisphereFlips++
  }
  const finish = sample => {
    if (!rotation) return sample
    return { value: normalizeQuaternion(sample.value), incoming: normalizeQuaternion(sample.value, sample.incoming), outgoing: normalizeQuaternion(sample.value, sample.outgoing) }
  }
  const sample = time => {
    if (time < times[0] || time > times.at(-1)) {
      const key = time < times[0] ? keys[0] : keys.at(-1)
      return finish({ value: key.value, incoming: Array(width).fill(0), outgoing: Array(width).fill(0) })
    }
    let low = 0, high = times.length - 1
    while (low < high) { const mid = Math.ceil((low + high) / 2); if (times[mid] <= time) low = mid; else high = mid - 1 }
    const index = low, a = keys[index]
    if (time === times[index] || index === times.length - 1 || interpolation === 'STEP') return finish(a)
    const b = keys[index + 1], span = times[index + 1] - times[index], t = (time - times[index]) / span
    if (cubic) {
      const { value, derivative } = hermite(a.value, b.value, a.outgoing, b.incoming, span, t)
      return finish({ value, incoming: derivative, outgoing: derivative })
    }
    const value = rotation ? slerp(a.value, b.value, t) : a.value.map((x, c) => x + (b.value[c] - x) * t)
    return { value, incoming: Array(width).fill(0), outgoing: Array(width).fill(0) }
  }
  return { sample, hemisphereFlips }
}

function resample(times, output, width, interpolation, rotation, start, end, duration) {
  const { sample, hemisphereFlips } = makeCurve(times, output, width, interpolation, rotation)
  let knots = [start, ...Array.from(times).filter(t => t > start && t < end), end]
  let maxCubicRotationError = 0, adaptiveKeys = 0
  // Unit quaternion values at new cuts cannot in general describe the exact
  // original normalized cubic with just one polynomial. Sample its normalized
  // derivative and refine until the angular error is bounded, not raw/non-unit
  // quaternion endpoints or a silent LINEAR conversion.
  if (rotation && interpolation === 'CUBICSPLINE') {
    const refine = (aTime, bTime, depth = 0) => {
      const a = sample(aTime), b = sample(bTime), span = bTime - aTime
      let error = 0
      for (const t of [.25, .5, .75]) {
        const actual = normalizeQuaternion(hermite(a.value, b.value, a.outgoing, b.incoming, span, t).value)
        const expected = sample(aTime + span * t).value
        error = Math.max(error, 2 * Math.acos(Math.min(1, Math.abs(dot(actual, expected)))))
      }
      if (error > 1e-5 || dot(a.value, b.value) < 0) {
        if (depth >= 16) throw new Error('Cubic quaternion refinement failed to converge')
        const middle = (aTime + bTime) / 2
        adaptiveKeys++
        return [...refine(aTime, middle, depth + 1), ...refine(middle, bTime, depth + 1)]
      }
      maxCubicRotationError = Math.max(maxCubicRotationError, error)
      return [aTime]
    }
    knots = knots.slice(0, -1).flatMap((t, i) => refine(t, knots[i + 1])).concat(end)
  }
  const timeScale = duration / (end - start), tangentScale = 1 / timeScale
  const newTimes = new Float32Array(knots.map(t => (t - start) * timeScale))
  newTimes[0] = 0; newTimes[newTimes.length - 1] = duration
  if (newTimes.some(x => !Number.isFinite(x))) throw new Error('Retimed keyframe times overflow FLOAT storage')
  for (let i = 1; i < newTimes.length; i++) if (!(newTimes[i] > newTimes[i - 1])) {
    throw new Error('Trim interval is too small to retain distinct FLOAT keyframe times')
  }
  const values = [], cubic = interpolation === 'CUBICSPLINE'
  let previous
  for (const time of knots) {
    const point = sample(time)
    if (rotation && !cubic && previous && dot(previous, point.value) < 0) {
      for (const key of ['value', 'incoming', 'outgoing']) point[key] = point[key].map(x => -x)
    }
    if (cubic) values.push(...point.incoming.map(x => x * tangentScale))
    values.push(...point.value)
    if (cubic) values.push(...point.outgoing.map(x => x * tangentScale))
    previous = point.value
  }
  const newValues = new Float32Array(values)
  if (newValues.some(x => !Number.isFinite(x))) throw new Error('Retimed samples or tangents overflow FLOAT storage')
  return { times: newTimes, values: newValues, hemisphereFlips, adaptiveKeys, maxCubicRotationError }
}

/**
 * Physically trim only axeAttack2H and map the common source interval to duration.
 * Input is readGlb()'s { document, binary }; returns a new asset plus a report.
 * Other accessors, compressed payloads, geometry, skins and images are never
 * decoded/re-encoded. Obsolete target-only payload ranges are removed. Stable
 * unused accessor/view slots alias new scalar data rather than retaining the old
 * clip; known prefix checkpoints are rebased. Unknown extension schemes and
 * target-only accessors sharing an interleaved view fail closed.
 */
export async function trimAxeClip(asset, { start, end, duration = .48 }) {
  if (![start, end, duration].every(Number.isFinite) || start < 0 || end <= start || duration <= 0) {
    throw new Error('Expected 0 <= start < end and a positive finite duration')
  }
  const extensions = new Set([...(asset.document.extensionsUsed ?? []), ...(asset.document.extensionsRequired ?? [])])
  function findExtensions(value) {
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      if (key === 'extensions') Object.keys(child ?? {}).forEach(name => extensions.add(name))
      // extras are opaque user metadata, not glTF extension declarations.
      if (key !== 'extras') findExtensions(child)
    }
  }
  findExtensions(asset.document)
  for (const name of extensions) if (!SUPPORTED_EXTENSIONS.has(name)) {
    throw new Error(`Unsupported extension ${name}: review its binary references before trimming`)
  }
  const originals = asset.document.animations?.filter(a => a.name === CLIP) ?? []
  if (originals.length !== 1) throw new Error(`Expected exactly one ${CLIP} animation`)
  const original = originals[0], document = structuredClone(asset.document)
  const animation = document.animations[asset.document.animations.indexOf(original)]
  if (!original.channels.length) throw new Error('Cannot trim an animation without channels')
  const read = await makeAccessorReader(asset), active = new Map()
  for (const channel of original.channels) {
    const path = channel.target?.path
    if (!['translation', 'rotation', 'scale', 'weights'].includes(path) || !Number.isInteger(channel.target?.node)) {
      throw new Error('Only node translation/rotation/scale/weights animation channels are supported')
    }
    if (!original.samplers[channel.sampler]) throw new Error('Channel references a missing sampler')
    if (active.has(channel.sampler) && active.get(channel.sampler) !== path) throw new Error('One sampler cannot target different property types')
    active.set(channel.sampler, path)
  }
  const samples = [], report = { clip: CLIP, sourceStart: start, sourceEnd: end, duration,
    inputBytes: asset.binary.length, channelCount: original.channels.length, originalSamplerCount: original.samplers.length,
    samplerCount: active.size, discardedUnusedSamplers: original.samplers.length - active.size, samplers: [] }
  let sourceStart = Infinity, sourceEnd = -Infinity
  for (const [index, path] of active) {
    const sampler = original.samplers[index], interpolation = sampler.interpolation ?? 'LINEAR'
    if (!['LINEAR', 'STEP', 'CUBICSPLINE'].includes(interpolation)) throw new Error(`Unsupported interpolation ${interpolation}`)
    const times = await read(sampler.input), values = await read(sampler.output)
    if (asset.document.accessors[sampler.input].type !== 'SCALAR' || !times.length) throw new Error('Animation times must be nonempty SCALAR accessors')
    for (let i = 1; i < times.length; i++) if (!(times[i] > times[i - 1])) throw new Error(`Sampler ${index} times are not strictly increasing`)
    sourceStart = Math.min(sourceStart, times[0]); sourceEnd = Math.max(sourceEnd, times.at(-1))
    const factor = interpolation === 'CUBICSPLINE' ? 3 : 1, width = values.length / (times.length * factor)
    if (!Number.isInteger(width) || width < 1 || (path === 'rotation' && width !== 4) || (['translation', 'scale'].includes(path) && width !== 3)) {
      throw new Error(`Invalid ${path} sample width in sampler ${index}`)
    }
    const result = resample(times, values, width, interpolation, path === 'rotation', start, end, duration)
    samples.push({ index, sampler, ...result, type: asset.document.accessors[sampler.output].type })
    report.samplers.push({ sampler: index, path, interpolation, originalKeys: times.length, keys: result.times.length,
      hemisphereFlips: result.hemisphereFlips, adaptiveKeys: result.adaptiveKeys, maxCubicRotationError: result.maxCubicRotationError })
  }
  if (start < sourceStart - 1e-6 || end > sourceEnd + 1e-6) throw new Error(`Trim interval is outside source range ${sourceStart}..${sourceEnd}`)
  report.originalStart = sourceStart; report.originalEnd = sourceEnd

  const targetAccessors = new Set(original.samplers.flatMap(s => [s.input, s.output]))
  const external = externalAccessorReferences(asset.document, original)
  const obsoleteAccessors = new Set([...targetAccessors].filter(index => !external.has(index)))
  const targetViews = new Set([...obsoleteAccessors].flatMap(index => accessorViews(asset.document.accessors[index])))
  const protectedViews = nonAccessorViewReferences(asset.document)
  for (const [index, accessor] of asset.document.accessors.entries()) if (!obsoleteAccessors.has(index)) {
    accessorViews(accessor).forEach(view => protectedViews.add(view))
  }
  const obsoleteViews = new Set([...targetViews].filter(index => !protectedViews.has(index)))
  // A whole shared accessor is retained for its other consumers. An interleaved
  // target-only accessor sharing a view needs a separate deinterleaving tool;
  // refuse rather than leave the old windup hidden in the output.
  for (const index of obsoleteAccessors) for (const view of accessorViews(asset.document.accessors[index])) {
    if (!obsoleteViews.has(view)) throw new Error(`Target-only accessor ${index} shares bufferView ${view}; deinterleave before trimming`)
  }
  const removed = subtractRanges([...obsoleteViews].flatMap(i => physicalRanges(asset, asset.document.bufferViews[i])),
    unionRanges(asset.document.bufferViews.flatMap((v, i) => obsoleteViews.has(i) ? [] : physicalRanges(asset, v))))
  // Replace the final 0..3 bytes of each removed range with zero padding. This
  // removes the complete old payload while preserving alignment of every
  // surviving accessor, including raw views after meshopt byte streams.
  const paddingFor = (start, end) => (end - start) % 4
  const mapOffset = offset => offset - removed.reduce((sum, [start, end]) =>
    sum + Math.max(0, Math.min(offset, end) - start) - (offset >= end ? paddingFor(start, end) : 0), 0)
  const chunks = []; let cursor = 0
  for (const [start, end] of removed) {
    chunks.push(asset.binary.subarray(cursor, start))
    if (paddingFor(start, end)) chunks.push(Buffer.alloc(paddingFor(start, end)))
    cursor = end
  }
  chunks.push(asset.binary.subarray(cursor))
  let offset = mapOffset(asset.binary.length)
  for (const [index, view] of document.bufferViews.entries()) if (!obsoleteViews.has(index)) {
    if (view.buffer === 0) view.byteOffset = mapOffset(view.byteOffset ?? 0)
    const extension = view.extensions?.[MESHOPT_EXTENSION]
    if (extension?.buffer === 0) extension.byteOffset = mapOffset(extension.byteOffset ?? 0)
  }
  const freeViews = [...obsoleteViews].sort((a, b) => a - b), claimedAccessors = new Set(), claimedViews = new Set()
  const retainMetadata = object => Object.fromEntries(['name', 'extras'].filter(key => object?.[key] !== undefined).map(key => [key, structuredClone(object[key])]))
  function append(values, type, preferredAccessor) {
    const aligned = align4(offset)
    if (aligned !== offset) chunks.push(Buffer.alloc(aligned - offset))
    offset = aligned
    const bytes = Buffer.alloc(values.length * 4)
    values.forEach((value, i) => bytes.writeFloatLE(value, i * 4))
    const viewIndex = freeViews.length ? freeViews.shift() : document.bufferViews.length
    document.bufferViews[viewIndex] = { ...retainMetadata(document.bufferViews[viewIndex]), buffer: 0, byteOffset: offset, byteLength: bytes.length }
    claimedViews.add(viewIndex); chunks.push(bytes); offset += bytes.length
    const index = obsoleteAccessors.has(preferredAccessor) && !claimedAccessors.has(preferredAccessor) ? preferredAccessor : document.accessors.length
    const accessor = { ...retainMetadata(document.accessors[index]), bufferView: viewIndex, componentType: 5126, count: values.length / COMPONENTS[type], type }
    if (type === 'SCALAR') {
      accessor.min = [values.reduce((minimum, x) => Math.min(minimum, x), Infinity)]
      accessor.max = [values.reduce((maximum, x) => Math.max(maximum, x), -Infinity)]
    }
    document.accessors[index] = accessor; claimedAccessors.add(index)
    return index
  }
  const samplerMap = new Map(), inputCache = new Map()
  animation.samplers = samples.map(sample => {
    samplerMap.set(sample.index, samplerMap.size)
    const cached = inputCache.get(sample.sampler.input)
    const input = cached && same(cached.times, sample.times) ? cached.index : append(sample.times, 'SCALAR', sample.sampler.input)
    inputCache.set(sample.sampler.input, { times: sample.times, index: input })
    return { ...structuredClone(sample.sampler), input, output: append(sample.values, sample.type, sample.sampler.output) }
  })
  for (const channel of animation.channels) channel.sampler = samplerMap.get(channel.sampler)
  const aliasAccessor = document.accessors[animation.samplers[0].input], aliasView = document.bufferViews[aliasAccessor.bufferView]
  for (const index of obsoleteAccessors) if (!claimedAccessors.has(index)) document.accessors[index] = { ...structuredClone(aliasAccessor), ...retainMetadata(document.accessors[index]) }
  for (const index of obsoleteViews) if (!claimedViews.has(index)) document.bufferViews[index] = { ...structuredClone(aliasView), ...retainMetadata(document.bufferViews[index]) }
  document.buffers[0].byteLength = offset

  // Rebase known prefix checkpoints. If a retained prefix slot aliases a new
  // sample, extend its byte boundary so legacy rebuilders cannot truncate it.
  const checkpoints = [], extras = document.asset?.extras
  function checkpoint(object, byteKey, viewKey) {
    if (!object || !Number.isInteger(object[byteKey])) return
    let boundary = mapOffset(object[byteKey])
    for (const view of document.bufferViews.slice(0, object[viewKey] ?? 0)) {
      if (view.buffer === 0) boundary = Math.max(boundary, (view.byteOffset ?? 0) + view.byteLength)
      const e = view.extensions?.[MESHOPT_EXTENSION]
      if (e?.buffer === 0) boundary = Math.max(boundary, (e.byteOffset ?? 0) + e.byteLength)
    }
    object[byteKey] = boundary; checkpoints.push(byteKey)
  }
  checkpoint(extras?.humanoidAnimationBuild, 'baseBufferByteLength', 'baseBufferViewCount')
  checkpoint(extras?.axeAttackBuild?.preservedPayload, 'bytes', 'bufferViews')
  Object.assign(report, { outputBytes: offset, removedBytes: removed.reduce((sum, [a, b]) => sum + b - a, 0),
    removedTargetViews: obsoleteViews.size, retainedSharedAccessors: [...targetAccessors].filter(i => external.has(i)),
    aliasedUnusedAccessors: [...obsoleteAccessors].filter(i => !claimedAccessors.has(i)).length,
    aliasedUnusedViews: [...obsoleteViews].filter(i => !claimedViews.has(i)).length, updatedCheckpoints: checkpoints,
    timeMapping: 'tOutput = (tSource - sourceStart) * duration / (sourceEnd - sourceStart)' })
  return { document, binary: Buffer.concat(chunks), report }
}
