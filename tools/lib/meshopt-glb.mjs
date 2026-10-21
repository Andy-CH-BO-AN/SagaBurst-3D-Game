import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

export const MESHOPT_EXTENSION = 'EXT_meshopt_compression'

/** Read only the embedded GLB buffer; never fetch external fallback resources. */
export function embeddedBufferBytes(asset, buffer, offset, length) {
  if (buffer !== 0 || asset.document.buffers[0].uri) throw new Error('Expected an embedded GLB buffer')
  if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length < 0 || offset + length > asset.binary.length) {
    throw new Error('GLB bufferView is outside its embedded buffer')
  }
  return asset.binary.subarray(offset, offset + length)
}

/** Expand meshopt views before existing numeric audits read binary accessors.
 * Returns a separate document/binary and retains every view, accessor and image.
 * No quantization, filtering, precision changes or source-asset mutation.
 */
export async function decodeMeshoptGlb(asset, decoder = MeshoptDecoder) {
  const compressed = asset.document.bufferViews.some(view => view.extensions?.[MESHOPT_EXTENSION])
  if (!compressed) return asset
  if (!decoder?.supported) throw new Error('Meshopt decoder is unavailable')
  await decoder.ready
  const document = structuredClone(asset.document), chunks = []
  let offset = 0
  for (const view of document.bufferViews) {
    const extension = view.extensions?.[MESHOPT_EXTENSION]
    let bytes
    if (extension) {
      if (extension.count * extension.byteStride !== view.byteLength) throw new Error('Meshopt decoded length does not match bufferView')
      const source = embeddedBufferBytes(asset, extension.buffer, extension.byteOffset ?? 0, extension.byteLength)
      bytes = Buffer.alloc(view.byteLength)
      decoder.decodeGltfBuffer(bytes, extension.count, extension.byteStride, source, extension.mode, extension.filter)
      delete view.extensions[MESHOPT_EXTENSION]
      if (!Object.keys(view.extensions).length) delete view.extensions
    } else bytes = embeddedBufferBytes(asset, view.buffer, view.byteOffset ?? 0, view.byteLength)
    const padding = (4 - offset % 4) % 4
    if (padding) { chunks.push(Buffer.alloc(padding)); offset += padding }
    view.buffer = 0
    view.byteOffset = offset
    chunks.push(bytes)
    offset += bytes.length
  }
  document.buffers = [{ byteLength: offset }]
  for (const key of ['extensionsUsed', 'extensionsRequired']) {
    if (!document[key]) continue
    document[key] = document[key].filter(name => name !== MESHOPT_EXTENSION)
    if (!document[key].length) delete document[key]
  }
  return { document, binary: Buffer.concat(chunks) }
}
