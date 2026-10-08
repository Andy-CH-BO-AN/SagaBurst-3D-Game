import { readFileSync } from 'node:fs'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

interface GlbJson {
  images?: unknown[]
  textures?: unknown[]
  materials?: unknown[]
  meshes?: Array<{ primitives: Array<{ material?: number }> }>
  [key: string]: unknown
}

/** Parse a shipped GLB while omitting image/material payloads unavailable in node tests. */
export async function loadTestGlbAsset(assetPath: string): Promise<GLTF> {
  const bytes = readFileSync(assetPath)
  if (bytes.toString('utf8', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2) {
    throw new Error(`Expected a GLB 2.0 asset at ${assetPath}`)
  }
  const jsonLength = bytes.readUInt32LE(12)
  const document = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength)) as GlbJson
  delete document.images
  delete document.textures
  delete document.materials
  for (const mesh of document.meshes ?? []) {
    for (const primitive of mesh.primitives) delete primitive.material
  }

  const text = Buffer.from(JSON.stringify(document))
  const json = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 32)])
  const binary = bytes.subarray(28 + jsonLength)
  const header = Buffer.alloc(20)
  const binaryHeader = Buffer.alloc(8)
  header.write('glTF')
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(28 + json.length + binary.length, 8)
  header.writeUInt32LE(json.length, 12)
  header.write('JSON', 16)
  binaryHeader.writeUInt32LE(binary.length, 0)
  binaryHeader.write('BIN\0', 4)
  const stripped = Buffer.concat([header, json, binaryHeader, binary])
  const arrayBuffer = stripped.buffer.slice(stripped.byteOffset, stripped.byteOffset + stripped.byteLength)
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(arrayBuffer, '')
}
