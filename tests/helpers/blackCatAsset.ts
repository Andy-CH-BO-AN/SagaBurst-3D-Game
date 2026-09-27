import { readFileSync } from 'node:fs'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { BlackCatVisual } from '../../src/world/BlackCatVisual'

/** Load the real shipped skin/animation data without requiring a DOM image decoder. */
export async function installBlackCatTestAsset(): Promise<GLTF> {
  const bytes = readFileSync('public/models/mounts/v2/black-cat/black-cat.glb')
  const length = bytes.readUInt32LE(12)
  const document = JSON.parse(bytes.toString('utf8', 20, 20 + length))
  delete document.images; delete document.textures; delete document.materials
  for (const mesh of document.meshes) for (const primitive of mesh.primitives) delete primitive.material
  const text = Buffer.from(JSON.stringify(document))
  const json = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 32)])
  const binary = bytes.subarray(28 + length)
  const header = Buffer.alloc(20), binHeader = Buffer.alloc(8)
  header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + json.length + binary.length, 8)
  header.writeUInt32LE(json.length, 12); header.write('JSON', 16)
  binHeader.writeUInt32LE(binary.length, 0); binHeader.write('BIN\0', 4)
  const stripped = Buffer.concat([header, json, binHeader, binary])
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(
    stripped.buffer.slice(stripped.byteOffset, stripped.byteOffset + stripped.byteLength), '',
  )
  ;(BlackCatVisual as unknown as { template: GLTF }).template = gltf
  return gltf
}
