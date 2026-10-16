/** Byte-exact meshopt publication packing, after all animation/texture processing.
 * node tools/pack-faction-humanoid-buffers.mjs ROOT [comma-separated IDs] [comma-separated LODs]
 * Replaces GLBs and writes compact buffer-compression-audit.json; manifest updates belong to the caller.
 * Full per-view evidence stays in ignored output/faction-humanoid-buffer-audits/.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { MeshoptEncoder, MeshoptDecoder as NpmDecoder } from 'meshoptimizer'
import { MeshoptDecoder as ThreeDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { readGlb, encodeGlb } from './lib/humanoid-glb.mjs'
import { MESHOPT_EXTENSION, decodeMeshoptGlb, embeddedBufferBytes } from './lib/meshopt-glb.mjs'

const componentBytes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }
const componentCounts = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const align4 = value => value + (4 - value % 4) % 4

export async function packFactionHumanoidBuffers(input) {
  await Promise.all([MeshoptEncoder.ready, NpmDecoder.ready, ThreeDecoder.ready])
  const source = await decodeMeshoptGlb(input), document = structuredClone(source.document)
  const imageViews = new Set((document.images ?? []).map(image => image.bufferView))
  const accessorsByView = new Map()
  for (const accessor of document.accessors ?? []) {
    if (accessor.bufferView !== undefined && !accessorsByView.has(accessor.bufferView)) accessorsByView.set(accessor.bufferView, accessor)
  }
  const chunks = [], views = []
  let offset = 0, fallbackLength = 0
  const append = bytes => {
    const aligned = align4(offset)
    if (aligned > offset) chunks.push(Buffer.alloc(aligned - offset))
    offset = aligned
    chunks.push(bytes)
    offset += bytes.length
    return aligned
  }
  for (const [index, view] of document.bufferViews.entries()) {
    const bytes = embeddedBufferBytes(source, view.buffer, view.byteOffset ?? 0, view.byteLength)
    const accessor = accessorsByView.get(index)
    const kind = imageViews.has(index) ? 'image' : view.target === 34963 ? 'indices'
      : view.target === 34962 ? 'geometry' : accessor?.type === 'MAT4' ? 'skin' : 'animation'
    let best
    if (kind !== 'image' && bytes.length > 256) {
      const naturalStride = accessor ? componentBytes[accessor.componentType] * componentCounts[accessor.type] : 4
      const strides = view.byteStride ? [view.byteStride] : [...new Set([naturalStride, 4, 8, 12, 16, 32, 64])]
      const choices = kind === 'indices'
        ? [{ mode: 'INDICES', stride: componentBytes[accessor?.componentType] }]
        : strides.filter(stride => stride > 0 && stride <= 256 && stride % 4 === 0 && bytes.length % stride === 0)
          .map(stride => ({ mode: 'ATTRIBUTES', stride }))
      for (const { mode, stride } of choices) {
        if (!stride || bytes.length % stride !== 0 || (mode === 'INDICES' && stride !== 2 && stride !== 4)) continue
        // INDICES, rather than TRIANGLES, preserves the original exact index order.
        const encoded = Buffer.from(MeshoptEncoder.encodeGltfBuffer(bytes, bytes.length / stride, stride, mode))
        if (!best || encoded.length < best.bytes.length) best = { bytes: encoded, stride, mode }
      }
    }
    const audit = { view: index, kind, originalBytes: bytes.length, originalSha256: sha256(bytes) }
    if (best && best.bytes.length + 150 < bytes.length) {
      const compressedOffset = append(best.bytes)
      fallbackLength = align4(fallbackLength)
      view.buffer = 1
      view.byteOffset = fallbackLength
      fallbackLength += view.byteLength
      view.extensions = { ...view.extensions, [MESHOPT_EXTENSION]: {
        buffer: 0, byteOffset: compressedOffset, byteLength: best.bytes.length,
        byteStride: best.stride, count: bytes.length / best.stride, mode: best.mode, filter: 'NONE',
      } }
      Object.assign(audit, { storedBytes: best.bytes.length, mode: best.mode, stride: best.stride })
    } else {
      view.buffer = 0
      view.byteOffset = append(bytes)
      Object.assign(audit, { storedBytes: bytes.length, mode: 'raw' })
    }
    views.push(audit)
  }
  document.buffers = [{ byteLength: offset }]
  if (fallbackLength) {
    document.buffers.push({ byteLength: fallbackLength, extensions: { [MESHOPT_EXTENSION]: { fallback: true } } })
    for (const key of ['extensionsUsed', 'extensionsRequired']) document[key] = [...new Set([...(document[key] ?? []), MESHOPT_EXTENSION])]
  }
  const asset = { document, binary: Buffer.concat(chunks) }
  // Verify every view independently through both codecs, including retained image bytes.
  for (const [name, decoder] of [['npmDecodedSha256', NpmDecoder], ['threeDecodedSha256', ThreeDecoder]]) {
    const decoded = await decodeMeshoptGlb(asset, decoder)
    for (const [index, view] of decoded.document.bufferViews.entries()) {
      const bytes = embeddedBufferBytes(decoded, view.buffer, view.byteOffset ?? 0, view.byteLength)
      const originalView = source.document.bufferViews[index]
      const originalBytes = embeddedBufferBytes(source, originalView.buffer, originalView.byteOffset ?? 0, originalView.byteLength)
      if (!bytes.equals(originalBytes)) throw new Error(`${name}: bufferView ${index} is not byte-exact`)
      views[index][name] = sha256(bytes)
    }
  }
  return { ...asset, report: {
    extension: MESHOPT_EXTENSION,
    method: 'No quantization, filters, mesh reordering, key removal or image changes. INDICES preserves exact index bytes.',
    npmDecoderVersion: 'meshoptimizer 0.18.1',
    threeDecoderVersion: 'Three.js 0.167 bundled meshoptimizer 0.18',
    allBufferViewsByteExact: true,
    compressedBufferViews: views.filter(view => view.mode !== 'raw').length,
    views,
  } }
}

async function main() {
  const root = process.argv[2]
  if (!root) throw new Error('Usage: node tools/pack-faction-humanoid-buffers.mjs ROOT [IDs] [LODs]')
  const ids = (process.argv[3] ?? 'viking-civilian,roman-civilian,maki-archer-t4').split(',')
  const levels = (process.argv[4] ?? '0,1,2').split(',').map(Number)
  if (levels.some(level => ![0, 1, 2].includes(level))) throw new Error('LOD levels must be 0, 1 or 2')
  // Preserve the PNG-input -> compressed-output provenance chain on reruns.
  // Preflight the whole selection before replacing any asset or audit file.
  for (const id of ids) {
    if (!['viking-civilian', 'roman-civilian', 'maki-archer-t4'].includes(id)) throw new Error(`Unsupported faction asset: ${id}`)
    for (const level of levels) {
      const file = path.join(root, id, `lod${level}.glb`)
      if (readGlb(file).document.bufferViews.some(view => view.extensions?.[MESHOPT_EXTENSION])) {
        throw new Error(`${file}: already meshopt-compressed; restore the uncompressed PNG checkpoint before packing again`)
      }
    }
  }
  const evidenceRoot = fileURLToPath(new URL('../output/faction-humanoid-buffer-audits/', import.meta.url))
  for (const id of ids) {
    const directory = path.join(root, id), lods = []
    const evidenceDirectory = path.join(evidenceRoot, id)
    fs.mkdirSync(evidenceDirectory, { recursive: true })
    for (const level of levels) {
      const file = path.join(directory, `lod${level}.glb`), before = fs.readFileSync(file)
      const packed = await packFactionHumanoidBuffers(readGlb(file)), bytes = encodeGlb(packed.document, packed.binary)
      const { views, ...summary } = packed.report
      const identity = { level, beforeBytes: before.length, bytes: bytes.length, beforeSha256: sha256(before), sha256: sha256(bytes) }
      const viewDigest = key => sha256(views.map(view => view[key]).join(''))
      lods.push({ ...identity, ...summary, viewCount: views.length,
        originalViewsSha256: viewDigest('originalSha256'),
        npmDecodedViewsSha256: viewDigest('npmDecodedSha256'),
        threeDecodedViewsSha256: viewDigest('threeDecodedSha256'),
      })
      fs.writeFileSync(path.join(evidenceDirectory, `lod${level}-${identity.sha256}.json`),
        JSON.stringify({ schemaVersion: 1, id, ...identity, ...packed.report }, null, 2) + '\n')
      // Do not write a partial or unverified result over its input.
      fs.writeFileSync(file, bytes)
      console.log(JSON.stringify({ id, level, beforeBytes: before.length, bytes: bytes.length, sha256: sha256(bytes), allBufferViewsByteExact: true }))
    }
    fs.writeFileSync(path.join(directory, 'buffer-compression-audit.json'), JSON.stringify({ schemaVersion: 2, id, lods,
      digestDefinition: 'SHA-256 of ordered SHA-256 hex strings concatenated without separators',
    }, null, 2) + '\n')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main()
