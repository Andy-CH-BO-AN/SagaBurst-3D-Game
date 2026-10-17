#!/usr/bin/env node
/** Freeze the exact former registry-generated Roman T4 foot strike.
 * node tools/bake-roman-t4-foot-axe.mjs [--check]
 * Requires the pinned Git commit and installed project dependencies. The old
 * donor body is read only from Git; only retargeted animation tracks ship.
 * --check also exercises the current registry and compares every clip/sample.
 * This is a standalone asset bake/audit, never a unit-test or CI entry point.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { build } from 'esbuild'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { encodeGlb } from './lib/humanoid-glb.mjs'

const COMMIT = 'bb517258398423039a7a0dfa983681322c92a51d'
const ROOT = 'public/models/characters/v2'
const DIRECTORY = `${ROOT}/roman-hero-t4`
const FILE = 'foot-axe.glb'
const CLIP = 'axeAttack1HFoot'
const PINNED = {
  [`${ROOT}/bandit/lod0.glb`]: '76244820ef8c5e1304ef2ac2e3f246958c8d2f47b50ef0f7bcab72249e5f575c',
  [`${ROOT}/bandit/manifest.json`]: '71d2cc3a3c6a281c09d9031406f44aeba47202ca5896ea349b1fc9e0dcd8c637',
  [`${DIRECTORY}/manifest.json`]: 'e4f7d8d8bf2214770f1cf8f39007c15e505a9b6d5897156719076c65508b3640',
  [`${DIRECTORY}/lod0.glb`]: 'd044847b517f79e72b17c6ed89efb7928d50cbb8a01a36430fed62470cb0250a',
  [`${DIRECTORY}/lod1.glb`]: 'a00a0480c8b814d263f57217b88db1ccece3398e3f462ed0b3642a75c2be1458',
  [`${DIRECTORY}/lod2.glb`]: 'cb6de6a5eb2205edcf7bc02d3ee66bd9e4bce31cffcfe9cc284041d1ea730284',
  'src/world/BanditFootAttack.ts': '89d04fe6b1d1d1112656a62eadea5d472fe465d4771ff60918331935064fe5a0',
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const cache = new Map()
function historical(file) {
  if (!cache.has(file)) cache.set(file, execFileSync('git', ['show', `${COMMIT}:${file}`], { maxBuffer: 128 * 1024 * 1024 }))
  const bytes = cache.get(file)
  if (PINNED[file] && hash(bytes) !== PINNED[file]) throw Error(`Pinned SHA-256 mismatch: ${file}`)
  return bytes
}
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const originalManifest = JSON.parse(historical(`${DIRECTORY}/manifest.json`))
const donorManifest = JSON.parse(historical(`${ROOT}/bandit/manifest.json`))
if (THREE.REVISION !== '167') throw Error(`Exact bake requires Three.js r167, got ${THREE.REVISION}`)
for (const file of Object.keys(PINNED)) historical(file)
for (let lod = 0; lod < 3; lod++) {
  const file = `${DIRECTORY}/lod${lod}.glb`
  if (hash(fs.readFileSync(file)) !== PINNED[file]) throw Error(`${file} changed; this frozen bake must be reviewed for the new target`)
}

/** Load every source dependency from the same immutable commit, including the
 * original registry preprocessing, rather than copying its retarget formula. */
async function registryModule(frozen) {
  const entry = 'src/world/HumanoidAssetRegistry.ts'
  const result = await build({
    stdin: { contents: `export { HumanoidAssetRegistry } from '${frozen ? 'frozen:' : './'}${entry}'`, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
    define: { 'import.meta.env.DEV': 'false', 'import.meta.env.BASE_URL': '"/"' },
    plugins: [{ name: 'offline-registry', setup(builder) {
      builder.onResolve({ filter: /^three(?:\/|$)/ }, args => ({ path: import.meta.resolve(args.path), external: true }))
      if (!frozen) return
      builder.onResolve({ filter: /^frozen:/ }, args => ({ path: args.path.slice(7), namespace: 'frozen-code' }))
      builder.onResolve({ filter: /^\./, namespace: 'frozen-code' }, args => {
        let file = path.posix.normalize(path.posix.join(path.posix.dirname(args.importer), args.path))
        if (!path.posix.extname(file)) file += '.ts'
        return { path: file, namespace: 'frozen-code' }
      })
      builder.onLoad({ filter: /.*/, namespace: 'frozen-code' }, args => ({ contents: historical(args.path).toString(), loader: 'ts' }))
    } }],
  })
  return (await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)).HumanoidAssetRegistry
}

/** Keep the real loader, transform preparation and animation/controller code;
 * only transport and irrelevant image decoding are replaced for offline use. */
async function loadTemplate(frozen) {
  const registry = await registryModule(frozen)
  const originalLoad = GLTFLoader.prototype.loadAsync, originalFetch = globalThis.fetch
  const requests = []
  const read = url => {
    if (!url.startsWith('/models/characters/v2/')) throw Error(`Unexpected asset URL: ${url}`)
    const file = `public${url}`
    requests.push(file)
    return frozen ? historical(file) : fs.readFileSync(file)
  }
  GLTFLoader.prototype.loadAsync = async function (url) {
    const bytes = read(url), length = bytes.readUInt32LE(12)
    const document = JSON.parse(bytes.toString('utf8', 20, 20 + length))
    delete document.images; delete document.textures; delete document.materials
    for (const mesh of document.meshes ?? []) for (const primitive of mesh.primitives) delete primitive.material
    const stripped = encodeGlb(document, bytes.subarray(28 + length))
    return this.parseAsync(stripped.buffer.slice(stripped.byteOffset, stripped.byteOffset + stripped.byteLength), '')
  }
  globalThis.fetch = async url => {
    const bytes = read(url)
    return { ok: true, status: 200, json: async () => JSON.parse(bytes), arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }
  }
  try {
    await registry.preloadAsset({ assetId: originalManifest.id, faction: 'roman', heightM: originalManifest.metrics.heightM,
      maxShoulderWidthM: originalManifest.metrics.shoulderWidthM, neckLengthM: originalManifest.metrics.neckLengthM })
    // TypeScript private state is inspected only by this offline provenance audit.
    return { template: registry.assets.get(originalManifest.id), requests }
  } finally {
    GLTFLoader.prototype.loadAsync = originalLoad
    globalThis.fetch = originalFetch
  }
}

function animationOnlyGlb(clips) {
  const document = { asset: { version: '2.0', generator: 'SagaBurst frozen Roman T4 foot-axe bake',
    extras: { sourceCommit: COMMIT, sourceClip: 'Bandit/swordSlash', runtimeDuration: clips[0].duration } },
    scene: 0, scenes: [{ nodes: [] }], nodes: [], animations: [], accessors: [], bufferViews: [], buffers: [{ byteLength: 0 }] }
  const chunks = [], accessors = new Map(), nodes = new Map()
  let offset = 0
  function append(values, type) {
    const bytes = Buffer.from(values.buffer, values.byteOffset, values.byteLength), key = `${type}:${hash(bytes)}`
    if (accessors.has(key)) return accessors.get(key)
    const index = document.accessors.length
    document.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length })
    const accessor = { bufferView: document.bufferViews.length - 1, componentType: 5126, count: values.length / (type === 'SCALAR' ? 1 : type === 'VEC3' ? 3 : 4), type }
    if (type === 'SCALAR') { accessor.min = [values[0]]; accessor.max = [values.at(-1)] }
    document.accessors.push(accessor); accessors.set(key, index); chunks.push(bytes); offset += bytes.length
    return index
  }
  for (let lod = 0; lod < clips.length; lod++) {
    const animation = { name: `${CLIP}_lod${lod}`, samplers: [], channels: [] }
    for (const track of clips[lod].tracks) {
      const dot = track.name.lastIndexOf('.'), name = track.name.slice(0, dot), property = track.name.slice(dot + 1)
      const targetPath = { position: 'translation', quaternion: 'rotation', scale: 'scale' }[property]
      if (!targetPath || track.getInterpolation() !== THREE.InterpolateLinear) throw Error(`Unsupported track: ${track.name}`)
      if (!nodes.has(name)) {
        nodes.set(name, document.nodes.length); document.scenes[0].nodes.push(document.nodes.length); document.nodes.push({ name })
      }
      animation.channels.push({ sampler: animation.samplers.length, target: { node: nodes.get(name), path: targetPath } })
      animation.samplers.push({ input: append(track.times, 'SCALAR'), output: append(track.values, property === 'quaternion' ? 'VEC4' : 'VEC3'), interpolation: 'LINEAR' })
    }
    document.animations.push(animation)
  }
  document.buffers[0].byteLength = offset
  return encodeGlb(document, Buffer.concat(chunks))
}

function clipDigest(clip) {
  const digest = createHash('sha256').update(clip.name).update(String(clip.duration)).update(String(clip.blendMode))
  for (const track of clip.tracks) {
    digest.update(track.name).update(String(track.getInterpolation()))
    for (const values of [track.times, track.values]) digest.update(Buffer.from(values.buffer, values.byteOffset, values.byteLength))
  }
  return digest.digest('hex')
}

const { template: baseline } = await loadTemplate(true)
const clips = baseline.animationClips.map((level, lod) => {
  const clip = level.find(clip => clip.name === CLIP)
  if (!clip) throw Error(`Frozen registry did not generate LOD${lod} ${CLIP}`)
  return clip
})
const output = animationOnlyGlb(clips)
const supplemental = { file: FILE, clip: CLIP, duration: clips[0].duration, lodClips: clips.map((_clip, lod) => `${CLIP}_lod${lod}`) }
const provenance = {
  schemaVersion: 1,
  sourceCommit: COMMIT,
  rebuild: 'node tools/bake-roman-t4-foot-axe.mjs',
  audit: 'node tools/bake-roman-t4-foot-axe.mjs --check',
  implementation: { file: 'src/world/BanditFootAttack.ts', sha256: PINNED['src/world/BanditFootAttack.ts'], export: 'createBanditFootAttack',
    invocation: 'Original HumanoidAssetRegistry.preloadAsset, including original asset preparation; all code read from sourceCommit', threeRevision: THREE.REVISION },
  donor: { file: `${ROOT}/bandit/lod0.glb`, sha256: PINNED[`${ROOT}/bandit/lod0.glb`], manifestSha256: PINNED[`${ROOT}/bandit/manifest.json`],
    source: donorManifest.source, animation: donorManifest.animations.embedded.find(binding => binding.clip === 'swordSlash'),
    gripReference: 'Original tokeshi hammer_grip/hammer_tip and RightHandMiddle1; no donor body, hammer geometry, skin or textures included in this animation asset' },
  targetManifestSha256: PINNED[`${DIRECTORY}/manifest.json`],
  preservedTargetSha256: Object.fromEntries([0, 1, 2].map(lod => [`lod${lod}`, PINNED[`${DIRECTORY}/lod${lod}.glb`]])),
  timing: { binding: originalManifest.animations.embedded.find(binding => binding.clip === 'axeAttack1H'), samplesPerTrack: 121,
    sourceContactSeconds: .252, sourceDurationSeconds: .48, note: 'Existing gameplay event selection and hand attachment paths are unchanged; only runtime retargeting becomes an offline bake' },
  output: { file: FILE, sha256: hash(output), bytes: output.length, geometry: false, textures: false,
    lods: clips.map((clip, lod) => ({ lod, duration: clip.duration, tracks: clip.tracks.length, clipSha256: clipDigest(clip) })) },
}
const manifest = readJson(`${DIRECTORY}/manifest.json`)
const originalFields = structuredClone(manifest)
delete originalFields.animations.supplemental; delete originalFields.footAxeBake
if (JSON.stringify(originalFields) !== JSON.stringify(originalManifest)) throw Error('Roman T4 manifest changed outside the supplemental bake fields')
const check = process.argv.includes('--check')
if (process.argv.slice(2).some(arg => arg !== '--check')) throw Error('Usage: node tools/bake-roman-t4-foot-axe.mjs [--check]')
if (check) {
  if (!fs.readFileSync(`${DIRECTORY}/${FILE}`).equals(output)) throw Error('Frozen animation bytes differ; rebuild required')
  if (JSON.stringify(manifest.animations.supplemental) !== JSON.stringify([supplemental])) throw Error('Supplemental animation manifest mismatch')
  if (manifest.footAxeBake !== 'foot-axe-provenance.json') throw Error('Missing bake provenance link')
  if (JSON.stringify(readJson(`${DIRECTORY}/foot-axe-provenance.json`)) !== JSON.stringify(provenance)) throw Error('Bake provenance mismatch')
} else {
  fs.writeFileSync(`${DIRECTORY}/${FILE}`, output)
  fs.writeFileSync(`${DIRECTORY}/foot-axe-provenance.json`, JSON.stringify(provenance, null, 2) + '\n')
  manifest.animations.supplemental = [supplemental]
  manifest.footAxeBake = 'foot-axe-provenance.json'
  fs.writeFileSync(`${DIRECTORY}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n')
}

// Validate the actual updated preload path, including supplemental Float32
// round-trip, final duration, bow/raw clip treatment, and donor independence.
const { template: current, requests } = await loadTemplate(false)
if (requests.some(file => file.startsWith(`${ROOT}/bandit/`))) throw Error('Roman T4 still requests the Bandit body')
for (let lod = 0; lod < 3; lod++) {
  for (const field of ['animationClips', 'bowClips']) {
    const before = baseline[field][lod], after = current[field][lod]
    if (before.length !== after.length || before.some((clip, index) => clipDigest(clip) !== clipDigest(after[index]))) {
      throw Error(`LOD${lod}: registry ${field} changed`)
    }
  }
}
console.log(JSON.stringify({ result: check ? 'checked' : 'baked', file: `${DIRECTORY}/${FILE}`, bytes: output.length, sha256: hash(output),
  exactRegistryClipAndTimingParity: true, lods: 3, tracksPerLod: clips.map(clip => clip.tracks.length), donorRequests: 0,
  targetGeometrySkinTexturesAndOtherClips: 'original GLBs byte-identical', visualAcceptance: 'not a visual review' }, null, 2))
