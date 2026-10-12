/** Pack reduced geometry into the source skeleton/animation container.
 * No skeleton, bind matrix, animation, socket or LOD0 byte is re-exported.
 * Usage: node tools/pack-selected-t5-lods.mjs <geometry-dir> <destination>
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { readGlb, encodeGlb, readAccessor } from './lib/humanoid-glb.mjs'

const geometryDir = process.argv[2] ?? 'output/t5-lod-candidate'
const destination = process.argv[3] ?? 'output/t5-lod-candidate/assets'
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
for (const faction of ['roman', 'viking']) {
  const sourceDir = `public/models/characters/v2/${faction}-hero-t5`
  const source = readGlb(`${sourceDir}/lod0.glb`)
  const manifest = JSON.parse(fs.readFileSync(`${sourceDir}/manifest.json`))
  const outDir = path.join(destination, manifest.id)
  fs.mkdirSync(outDir, { recursive: true })
  fs.copyFileSync(`${sourceDir}/lod0.glb`, `${outDir}/lod0.glb`)
  // The geometry interchange must retain original positions and UVs.
  const roundTrip = JSON.parse(fs.readFileSync(`${geometryDir}/${faction}-lod0.json`))
  const primitive = source.document.meshes[0].primitives[0]
  const positions = readAccessor(source, primitive.attributes.POSITION)
  const uvs = readAccessor(source, primitive.attributes.TEXCOORD_0)
  const buckets = new Map()
  for (const v of roundTrip.vertices) {
    const key = v[0].map(x => Math.floor(x * 1e4)).join(',')
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(v)
  }
  let matching = 0
  for (let i = 0; i < positions.length / 3; i++) {
    const p = positions.slice(i * 3, i * 3 + 3), uv = uvs.slice(i * 2, i * 2 + 2)
    const cell = [...p].map(x => Math.floor(x * 1e4))
    let found = false
    for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) {
      const options = buckets.get([cell[0] + x, cell[1] + y, cell[2] + z].join(',')) ?? []
      if (options.some(v => p.every((n, c) => Math.abs(n - v[0][c]) < 5e-6) && uv.every((n, c) => Math.abs(n - v[2][c]) < 2e-6))) found = true
    }
    if (found) matching++
  }
  assert.equal(matching, positions.length / 3, `${faction}: changed coordinate/UV frame`)
  const audits = []
  for (const level of [1, 2]) {
    const geometry = JSON.parse(fs.readFileSync(`${geometryDir}/${faction}-lod${level}.json`))
    const document = structuredClone(source.document)
    const chunks = [source.binary]
    let offset = source.binary.length
    const appendView = bytes => {
      const pad = (4 - offset % 4) % 4
      chunks.push(Buffer.alloc(pad), bytes); offset += pad
      const index = document.bufferViews.length
      document.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length })
      offset += bytes.length
      return index
    }
    const append = (array, type, componentType) => {
      const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[type]
      const accessor = { bufferView: appendView(Buffer.from(array.buffer)), componentType, count: array.length / components, type }
      if (type === 'VEC3') {
        accessor.min = [0, 1, 2].map(c => Math.min(...array.filter((_, i) => i % 3 === c)))
        accessor.max = [0, 1, 2].map(c => Math.max(...array.filter((_, i) => i % 3 === c)))
      }
      document.accessors.push(accessor)
      return document.accessors.length - 1
    }
    const jointIndex = new Map(document.skins[0].joints.map((n, i) => [document.nodes[n].name, i]))
    let discardedWeightMax = 0
    const weights = geometry.vertices.map(v => {
      const all = v[3].map(([name, weight]) => {
        assert(jointIndex.has(name), `Unknown source joint ${name}`)
        return [jointIndex.get(name), weight]
      })
      discardedWeightMax = Math.max(discardedWeightMax, all.slice(16).reduce((s, p) => s + p[1], 0))
      const kept = all.slice(0, 16), total = kept.reduce((s, p) => s + p[1], 0)
      assert(total > .99, 'Unweighted or heavily truncated LOD vertex')
      return kept.map(([j, w]) => [j, w / total])
    })
    assert(discardedWeightMax < .001, 'LOD exceeded supported 16 influences')
    const attributes = {}
    for (const [name, slot, type] of [['POSITION', 0, 'VEC3'], ['NORMAL', 1, 'VEC3'], ['TEXCOORD_0', 2, 'VEC2']]) {
      attributes[name] = append(new Float32Array(geometry.vertices.flatMap(v => v[slot])), type, 5126)
    }
    const sets = Math.ceil(Math.max(...weights.map(w => w.length)) / 4)
    for (let set = 0; set < sets; set++) {
      attributes[`JOINTS_${set}`] = append(new Uint16Array(weights.flatMap(w => Array.from({ length: 4 }, (_, k) => w[set * 4 + k]?.[0] ?? 0))), 'VEC4', 5123)
      attributes[`WEIGHTS_${set}`] = append(new Float32Array(weights.flatMap(w => Array.from({ length: 4 }, (_, k) => w[set * 4 + k]?.[1] ?? 0))), 'VEC4', 5126)
    }
    document.meshes[0].primitives = [{ ...primitive, attributes, indices: append(new Uint32Array(geometry.indices), 'SCALAR', 5125) }]
    const textureSize = level === 1 ? 1024 : 512
    document.images.forEach((image, i) => {
      image.bufferView = appendView(fs.readFileSync(`${geometryDir}/${faction}-${textureSize}-${i}.png`))
      image.mimeType = 'image/png'
    })
    const combined = Buffer.concat(chunks)
    // Drop unreachable source geometry/textures and unused old repair samplers.
    for (const animation of document.animations) {
      const used = [...new Set(animation.channels.map(c => c.sampler))]
      animation.channels.forEach(c => { c.sampler = used.indexOf(c.sampler) })
      animation.samplers = used.map(i => animation.samplers[i])
    }
    const usedAccessors = new Set()
    document.meshes.forEach(m => m.primitives.forEach(p => { Object.values(p.attributes).forEach(i => usedAccessors.add(i)); usedAccessors.add(p.indices) }))
    document.skins.forEach(s => usedAccessors.add(s.inverseBindMatrices))
    document.animations.forEach(a => a.samplers.forEach(s => { usedAccessors.add(s.input); usedAccessors.add(s.output) }))
    const accessorIds = [...usedAccessors], remap = i => accessorIds.indexOf(i)
    document.accessors = accessorIds.map(i => document.accessors[i])
    document.meshes.forEach(m => m.primitives.forEach(p => { Object.keys(p.attributes).forEach(k => { p.attributes[k] = remap(p.attributes[k]) }); p.indices = remap(p.indices) }))
    document.skins.forEach(s => { s.inverseBindMatrices = remap(s.inverseBindMatrices) })
    document.animations.forEach(a => a.samplers.forEach(s => { s.input = remap(s.input); s.output = remap(s.output) }))
    const views = [...new Set([...document.accessors.map(a => a.bufferView), ...document.images.map(i => i.bufferView)])]
    const packed = []; let packedOffset = 0
    const packedViews = views.map(i => {
      const v = document.bufferViews[i], pad = (4 - packedOffset % 4) % 4
      packed.push(Buffer.alloc(pad)); packedOffset += pad
      const result = { ...v, byteOffset: packedOffset }
      packed.push(combined.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength)); packedOffset += v.byteLength
      return result
    })
    document.accessors.forEach(a => { a.bufferView = views.indexOf(a.bufferView) })
    document.images.forEach(i => { i.bufferView = views.indexOf(i.bufferView) })
    document.bufferViews = packedViews; document.buffers[0].byteLength = packedOffset
    const bytes = encodeGlb(document, Buffer.concat(packed))
    fs.writeFileSync(`${outDir}/lod${level}.glb`, bytes)
    manifest.files[`lod${level}`] = `lod${level}.glb`
    manifest.fileSha256[`lod${level}`] = sha(bytes)
    manifest.metrics.triangles[`lod${level}`] = geometry.triangles
    manifest.metrics.textures[`lod${level}`] = textureSize
    audits.push({ level, triangles: geometry.triangles, vertices: geometry.vertices.length, sets, discardedWeightMax, bytes: bytes.length,
      strategy: geometry.strategy, simplifierError: geometry.simplifierError, protectedTriangles: geometry.protectedTriangles })
  }
  manifest.visualAcceptance = 'LOD candidate; requires browser comparison before promotion.'
  manifest.knownLimitations = manifest.knownLimitations.filter(s => !s.startsWith('LOD1/2'))
  fs.writeFileSync(`${outDir}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n')
  fs.writeFileSync(`${outDir}/lod-audit.json`, JSON.stringify({ roundTripMatched: matching, sourceVertices: positions.length / 3, lods: audits }, null, 2) + '\n')
  console.log(faction, audits)
}
