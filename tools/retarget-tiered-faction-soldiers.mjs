/** Bake the four fingered source-fitted soldiers through the existing offline pipeline.
 * node tools/retarget-tiered-faction-soldiers.mjs ROOT [roman-t1,roman-t2,viking-t1,viking-t2] [--pack]
 * Default: resize textures, retain faction body motion, bake the existing Roman
 * finger poses onto new Viking fingers. --pack is a separate byte-exact final step.
 * Does not mark an asset visually accepted or replace any original T3 donor.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { retargetDirectory } from './retarget-faction-humanoids.mjs'
import { readGlb, loadRig, encodeGlb } from './lib/humanoid-glb.mjs'
import { appendClips, bakeFactionClips, collapseConstantTracks, measureClipBounds } from './lib/faction-humanoid-animation.mjs'
import { correctTieredFingerPoses } from './lib/tiered-finger-pose.mjs'
import { packFactionHumanoidBuffers } from './pack-faction-humanoid-buffers.mjs'

const IDS = ['roman-t1', 'roman-t2', 'viking-t1', 'viking-t2']
const FINGER = /^(thumb|index|middle|ring|pinky)_0[123]_[lr]\.quaternion$/
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const saveJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n')

function animationDigest(clips) {
  const digest = createHash('sha256')
  for (const clip of clips) {
    digest.update(clip.name); digest.update(String(clip.duration))
    for (const track of clip.tracks) {
      digest.update(track.name)
      digest.update(Buffer.from(track.times.buffer, track.times.byteOffset, track.times.byteLength))
      digest.update(Buffer.from(track.values.buffer, track.values.byteOffset, track.values.byteLength))
    }
  }
  return digest.digest('hex')
}

async function addVikingFingers(directory, clean) {
  const manifestFile = path.join(directory, 'manifest.json'), manifest = json(manifestFile)
  const measurements = json(path.join(directory, 'blender-measurements.json'))
  const donorDirectory = 'public/models/characters/v2/roman'
  const donorManifest = json(path.join(donorDirectory, 'manifest.json'))
  const donorFile = path.join(donorDirectory, donorManifest.files.lod0)
  if (hash(fs.readFileSync(donorFile)) !== donorManifest.fileSha256.lod0) throw Error('Roman finger donor hash mismatch')
  const sourceAsset = readGlb(donorFile), source = await loadRig(sourceAsset)
  const target = await loadRig(clean[0])
  const metadata = { ...manifest, ...measurements, animationRetarget: { ...manifest.animationRetarget, ...measurements.animationRetarget } }
  const fingerBake = bakeFactionClips({ source, target, sourceDocument: sourceAsset.document,
    targetDocument: clean[0].document, sourceMetadata: donorManifest, targetMetadata: metadata })
  const baked = await loadRig(readGlb(path.join(directory, manifest.files.lod0)))
  const originalBodyDigest = animationDigest(baked.animations.map(clip => ({ ...clip, tracks: clip.tracks.filter(track => !FINGER.test(track.name)) })))
  for (const clip of baked.animations) {
    // The existing foot-axe bake keeps fingers from idle throughout its swing.
    // Preserve that contract while supplying the missing authored finger pose.
    const donor = fingerBake.clips.find(value => value.name === (clip.name === 'axeAttack1HFoot' ? 'idle' : clip.name))
    if (!donor) throw Error(`No authored finger action for ${clip.name}`)
    const fingers = donor.tracks.filter(track => FINGER.test(track.name))
    if (fingers.length !== 30) throw Error(`Expected thirty measured finger channels in ${clip.name}, found ${fingers.length}`)
    const replacement = new Map(fingers.map(track => {
      const copy = track.clone()
      if (clip.name === 'axeAttack1HFoot') {
        // Match the existing foot-bake idle clock, limited to its first .8 s.
        const sourceTime = Math.min(donor.duration, .8)
        const interpolant = track.createInterpolant()
        const samples = [...new Set([0, ...track.times.filter(time => time < sourceTime), sourceTime])].sort((a, b) => a - b)
        const times = Float32Array.from(samples, time => time / sourceTime * clip.duration)
        const values = Float32Array.from(samples.flatMap(time => [...interpolant.evaluate(time)]))
        return [copy.name, new track.constructor(copy.name, times, values)]
      }
      if (Math.abs(clip.duration - donor.duration) > 1e-5) throw Error(`Faction action clocks differ: ${clip.name}`)
      return [copy.name, copy]
    }))
    clip.tracks = clip.tracks.map(track => replacement.get(track.name) ?? track)
    if (clip.tracks.filter(track => FINGER.test(track.name)).length !== 30) throw Error(`Target lost finger channels: ${clip.name}`)
  }
  if (animationDigest(baked.animations.map(clip => ({ ...clip, tracks: clip.tracks.filter(track => !FINGER.test(track.name)) }))) !== originalBodyDigest) throw Error('Finger adaptation changed Viking body channels')
  collapseConstantTracks(baked.animations)
  const poseSha256 = animationDigest(baked.animations)
  const provenance = { sourceAsset: 'roman/lod0.glb', sourceSha256: donorManifest.fileSha256.lod0,
    method: 'Existing anatomical retarget applied to thirty target-local finger rotations only; Viking body channels, action durations and events retained.',
    fingerChannelsPerClip: 30, bodyChannelsUnchanged: true }
  const outputs = []
  for (const [level, asset] of clean.entries()) {
    const rig = await loadRig(asset)
    const preservedPayload = { bytes: asset.binary.length, accessors: asset.document.accessors.length, bufferViews: asset.document.bufferViews.length }
    const packed = appendClips(asset, rig, baked.animations, { version: 1, preservedPayload,
      inputSha256: hash(encodeGlb(asset.document, asset.binary)), canonicalPoseSha256: poseSha256, fingerAdaptation: provenance })
    const bytes = encodeGlb(packed.document, packed.binary), verified = await loadRig(packed)
    if (animationDigest(verified.animations) !== poseSha256) throw Error('Serialized Viking fingers changed')
    outputs.push({ level, bytes })
  }
  for (const { level, bytes } of outputs) {
    fs.writeFileSync(path.join(directory, manifest.files[`lod${level}`]), bytes)
    manifest.fileSha256[`lod${level}`] = hash(bytes)
  }
  manifest.animationRetarget.fingerAdaptation = provenance
  manifest.animationRetarget.canonicalPoseSha256 = poseSha256
  saveJson(manifestFile, manifest)
  const reportFile = path.join(directory, 'animation-retarget-audit.json'), report = json(reportFile)
  Object.assign(report, { canonicalPoseSha256: poseSha256, fingerAdaptation: provenance,
    fileSha256: manifest.fileSha256, poseBounds: measureClipBounds(target, baked.animations) })
  saveJson(reportFile, report)
  fs.appendFileSync(path.join(directory, 'animation-source-attribution.txt'),
    `\nFinger-only donor: roman/lod0.glb, SHA-256 ${donorManifest.fileSha256.lod0}.\n${donorManifest.attribution}\nNo donor geometry or body animation channels were copied.\n`)
}

async function applyFingerCorrections(directory, clean) {
  const manifestFile = path.join(directory, 'manifest.json'), manifest = json(manifestFile)
  const specification = json(path.join(directory, 'blender-measurements.json')).fingerPoseCorrections
  if (!specification) return
  const baked = await loadRig(readGlb(path.join(directory, manifest.files.lod0)))
  const body = clips => animationDigest(clips.map(clip => ({ ...clip, tracks: clip.tracks.filter(track => !FINGER.test(track.name)) })))
  const before = body(baked.animations)
  const correction = correctTieredFingerPoses(baked.animations, manifest.animations.embedded, specification, Object.fromEntries(clean[0].document.nodes.filter(node => node.name).map(node => [node.name, node.rotation ?? [0,0,0,1]])))
  if (body(baked.animations) !== before) throw Error('Finger correction changed body channels')
  collapseConstantTracks(baked.animations)
  const poseSha256 = animationDigest(baked.animations)
  for (const [level, asset] of clean.entries()) {
    const rig = await loadRig(asset)
    const previous = readGlb(path.join(directory, manifest.files[`lod${level}`])).document.asset.extras.factionHumanoidAnimationBuild
    const packed = appendClips(asset, rig, baked.animations, { ...previous, canonicalPoseSha256: poseSha256, fingerPoseCorrections: correction })
    const bytes = encodeGlb(packed.document, packed.binary)
    if (animationDigest((await loadRig(packed)).animations) !== poseSha256) throw Error('Corrected finger serialization mismatch')
    fs.writeFileSync(path.join(directory, manifest.files[`lod${level}`]), bytes)
    manifest.fileSha256[`lod${level}`] = hash(bytes)
  }
  manifest.animationRetarget.fingerPoseCorrections = correction
  manifest.animationRetarget.canonicalPoseSha256 = poseSha256
  saveJson(manifestFile, manifest)
  const reportFile = path.join(directory, 'animation-retarget-audit.json'), report = json(reportFile)
  Object.assign(report, { fingerPoseCorrections: correction, canonicalPoseSha256: poseSha256, fileSha256: manifest.fileSha256 })
  saveJson(reportFile, report)
}

function prepareCompleteSkin(directory) {
  const manifestFile = path.join(directory, 'manifest.json'), manifest = json(manifestFile)
  for (let level = 0; level < 3; level++) {
    const file = path.join(directory, manifest.files[`lod${level}`]), asset = readGlb(file)
    if (asset.document.bufferViews.some(view => view.extensions?.EXT_meshopt_compression)) throw Error('Prepare skin before packing')
    const document = asset.document, chunks = [asset.binary]; let offset = asset.binary.length
    for (const mesh of document.meshes) for (const primitive of mesh.primitives) {
      if (primitive.attributes.JOINTS_0 === undefined) continue
      const count = document.accessors[primitive.attributes.JOINTS_0].count
      for (let set = 1; set < 4; set++) for (const kind of ['JOINTS', 'WEIGHTS']) {
        const key = `${kind}_${set}`
        if (primitive.attributes[key] !== undefined) continue
        const padding = (4 - offset % 4) % 4
        if (padding) { chunks.push(Buffer.alloc(padding)); offset += padding }
        const bytes = Buffer.alloc(count * 4 * (kind === 'JOINTS' ? 2 : 4))
        const view = document.bufferViews.length
        document.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target: 34962 })
        primitive.attributes[key] = document.accessors.length
        document.accessors.push({ bufferView: view, componentType: kind === 'JOINTS' ? 5123 : 5126, count, type: 'VEC4' })
        chunks.push(bytes); offset += bytes.length
      }
    }
    document.buffers[0].byteLength = offset
    const bytes = encodeGlb(document, Buffer.concat(chunks))
    fs.writeFileSync(file, bytes); manifest.fileSha256[`lod${level}`] = hash(bytes)
  }
  manifest.skinInfluenceSets = 4
  saveJson(manifestFile, manifest)
  const auditFile = path.join(directory, 'animation-retarget-audit.json'), audit = json(auditFile)
  audit.fileSha256 = manifest.fileSha256
  audit.poseBoundsLimitation = 'Inherited shared-pipeline pose bounds use default four-influence CPU skinning before optional target finger calibration; not a complete-skin visual or contact acceptance result.'
  audit.completeSkin = { sets: 4, method: 'Retain every source influence; pad absent JOINTS/WEIGHTS sets with zeros for the complete-skin runtime plugin.' }
  saveJson(auditFile, audit)
}

async function pack(directory) {
  const manifestFile = path.join(directory, 'manifest.json'), manifest = json(manifestFile), results = []
  for (let level = 0; level < 3; level++) {
    const file = path.join(directory, manifest.files[`lod${level}`]), before = fs.readFileSync(file), asset = readGlb(file)
    if (asset.document.bufferViews.some(view => view.extensions?.EXT_meshopt_compression)) throw Error('Already packed; rebuild the clean target first')
    const packed = await packFactionHumanoidBuffers(asset), bytes = encodeGlb(packed.document, packed.binary)
    const { views, ...summary } = packed.report
    results.push({ level, ...summary, inputSha256: hash(before), sha256: hash(bytes),
      bufferViewCount: views.length, originalViewsSha256: hash(views.map(view => view.originalSha256).join('')),
      npmDecodedViewsSha256: hash(views.map(view => view.npmDecodedSha256).join('')),
      threeDecodedViewsSha256: hash(views.map(view => view.threeDecodedSha256).join('')), bytes: bytes.length })
    fs.writeFileSync(`${file}.packed`, bytes)
  }
  for (const result of results) {
    const file = path.join(directory, manifest.files[`lod${result.level}`])
    fs.renameSync(`${file}.packed`, file); manifest.fileSha256[`lod${result.level}`] = result.sha256
  }
  manifest.bufferCompression = 'EXT_meshopt_compression'
  saveJson(manifestFile, manifest)
  const retargetFile = path.join(directory, 'animation-retarget-audit.json'), retarget = json(retargetFile)
  retarget.uncompressedFileSha256 = retarget.fileSha256
  retarget.fileSha256 = manifest.fileSha256
  saveJson(retargetFile, retarget)
  saveJson(path.join(directory, 'buffer-compression-audit.json'), { schemaVersion: 2, id: manifest.id,
    digestDefinition: 'SHA-256 of ordered buffer-view SHA-256 hex strings concatenated without separators', lods: results })
}

async function main(args) {
  const root = args[0]
  if (!root) throw Error('Pass a clean target root; no implicit source publication')
  const ids = (args.find((value, index) => index > 0 && !value.startsWith('--')) ?? IDS.join(',')).split(',')
  if (new Set(ids).size !== ids.length || ids.some(id => !IDS.includes(id))) throw Error('Only the four explicit new tier assets are supported')
  const packing = args.includes('--pack')
  for (const id of ids) {
    const directory = path.join(root, id)
    if (packing) await pack(directory)
    else if (args.includes('--prepare-skin')) prepareCompleteSkin(directory)
    else {
      execFileSync('python3', ['tools/pack-faction-humanoid-textures.py', root, id], { stdio: 'inherit' })
      const clean = [0, 1, 2].map(level => readGlb(path.join(directory, `lod${level}.glb`)))
      if (clean.some(asset => asset.document.animations?.length)) throw Error('Expected newly built clean LODs without source animations')
      await retargetDirectory(directory, { sourceDir: `public/models/characters/v2/${id.startsWith('viking') ? 'viking' : 'roman'}` })
      if (id.startsWith('viking')) await addVikingFingers(directory, clean)
      await applyFingerCorrections(directory, clean)
      prepareCompleteSkin(directory)
    }
    console.log(JSON.stringify({ id, stage: packing ? 'byte-exact packing' : 'animation bake', visualAcceptance: 'Requires separate rendered/runtime inspection' }))
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main(process.argv.slice(2)).catch(error => { console.error(error.stack); process.exitCode = 1 })
