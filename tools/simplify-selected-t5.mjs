/** Conservative source-UV LOD geometry; intentionally stops at UV seam limits.
 * Uses index-only simplification: retained vertices/UVs/normals/weights are exact.
 * Head, hand and scabbard triangles are excluded from reduction.
 */
import fs from 'node:fs'
import { MeshoptSimplifier } from 'meshoptimizer'
import { readGlb } from './lib/humanoid-glb.mjs'
await MeshoptSimplifier.ready
const out = process.argv[2] ?? 'output/t5-lod-candidate'
fs.mkdirSync(out, { recursive: true })
function accessor(asset, index) {
  const a = asset.document.accessors[index], view = asset.document.bufferViews[a.bufferView]
  const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type]
  const bytes = { 5126: 4, 5125: 4, 5123: 2, 5121: 1 }[a.componentType]
  const method = { 5126: 'readFloatLE', 5125: 'readUInt32LE', 5123: 'readUInt16LE', 5121: 'readUInt8' }[a.componentType]
  return Array.from({ length: a.count }, (_, row) => Array.from({ length: width }, (_, col) =>
    asset.binary[method]((view.byteOffset ?? 0) + (a.byteOffset ?? 0) + row * (view.byteStride ?? width * bytes) + col * bytes)))
}
for (const faction of ['roman', 'viking']) {
  const source = `public/models/characters/v2/${faction}-hero-t5/lod0.glb`, asset = readGlb(source)
  const p = asset.document.meshes[0].primitives[0], attrs = p.attributes
  const positions = accessor(asset, attrs.POSITION), normals = accessor(asset, attrs.NORMAL), uv = accessor(asset, attrs.TEXCOORD_0)
  const skin = asset.document.skins[0]
  const influences = positions.map(() => [])
  for (let s = 0; attrs[`JOINTS_${s}`] !== undefined; s++) {
    const joints = accessor(asset, attrs[`JOINTS_${s}`]), weights = accessor(asset, attrs[`WEIGHTS_${s}`])
    joints.forEach((js, i) => js.forEach((j, k) => { if (weights[i][k] > 0) influences[i].push([asset.document.nodes[skin.joints[j]].name, weights[i][k]]) }))
  }
  const vertices = positions.map((p, i) => [p, normals[i], uv[i], influences[i]])
  const indices = accessor(asset, p.indices).flat(), protectedIndices = [], body = []
  const protectedVertices = influences.map(ws => ws.some(([n, w]) => /Hand|hand_|Head|^head$|^scabbard$/.test(n) && w > .05))
  for (let i = 0; i < indices.length; i += 3) {
    const triangle = indices.slice(i, i + 3)
    ;(triangle.some(v => protectedVertices[v]) ? protectedIndices : body).push(...triangle)
  }
  for (const level of [0, 1, 2]) {
    const [reduced, error] = level ? MeshoptSimplifier.simplify(new Uint32Array(body), new Float32Array(positions.flat()), 3,
      Math.floor(body.length * (level === 1 ? .7 : .3) / 3) * 3, level === 1 ? .003 : .015, ['LockBorder']) : [indices, 0]
    const result = level ? [...protectedIndices, ...reduced] : indices
    const used = [...new Set(result)], remap = new Map(used.map((old, i) => [old, i]))
    const data = { source, triangles: result.length / 3, vertices: used.map(i => vertices[i]), indices: result.map(i => remap.get(i)),
      simplifierError: error, protectedTriangles: protectedIndices.length / 3, strategy: 'index-only, locked UV boundaries, exact retained attributes' }
    fs.writeFileSync(`${out}/${faction}-lod${level}.json`, JSON.stringify(data))
    console.log(faction, level, data.triangles, error)
  }
  // Textures remain in their original UV frame. The resize step reads these
  // embedded PNGs without any Blender colour-management conversion.
  asset.document.images.forEach((image, i) => {
    const view = asset.document.bufferViews[image.bufferView]
    fs.writeFileSync(`${out}/${faction}-source-${i}.png`, asset.binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength))
  })
}
