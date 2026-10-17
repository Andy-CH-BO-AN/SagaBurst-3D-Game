#!/usr/bin/env node
/**
 * Bake immutable shipped animations onto new fitted humanoids, never onto source soldiers.
 * node tools/retarget-faction-humanoids.mjs --target-dir output/faction-humanoids/staged/viking-civilian
 * node tools/retarget-faction-humanoids.mjs --root output/faction-humanoids/staged viking-civilian,roman-civilian,maki-archer-t4
 * Required: clean lod0/1/2.glb and measured grip frames in blender-measurements.json or manifest.json.
 * Optional measured metadata: animationRetarget.{boneMap,groundContact:{mode:'plant'|'floor'|'none',clearanceM}},
 * clothRig.chains=[{anchor:'chest',bones:['cape_upper','cape_mid','cape_lower'],follow:[.5,.25,0]}].
 * Optional animationRetarget.capeFloorClearanceM requests bounded cape-only pitch and, if required,
 * mid/lower world-up offsets limited by their measured bind segments and capeFloorMaxTranslationM.
 * Optional animationRetarget.capeRunProfile supplies a measured periodic mid/lower swing;
 * its model, animation-input, geometry/skin and rest-rig SHA guards must match before baking.
 * Bow contact defaults to the actual gameplay idle-leg composition; raw source poses may hover.
 * --grounded-death opts a new target into the existing project death with measured whole-skin contact.
 * Exact LOD bind/socket identities are required; one canonical pose bake is serialized to every LOD.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { readGlb, loadRig, encodeGlb } from './lib/humanoid-glb.mjs'
import { frozenBanditDirectory, FROZEN_BANDIT_ASSET, FROZEN_BANDIT_COMMIT } from './lib/frozen-bandit-donor.mjs'
import { appendClips, bakeBanditFootClip, bakeFactionClips, bakeProjectDeathClip, collapseConstantTracks, factionHumanoidBindDigests, measureClipBounds, rigSignature } from './lib/faction-humanoid-animation.mjs'

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const publicRoot = 'public/models/characters/v2'

function cleanAsset(file) {
  const asset = readGlb(file), previous = asset.document.asset.extras?.factionHumanoidAnimationBuild
  if (asset.document.bufferViews.some(view => view.extensions?.EXT_meshopt_compression)) throw Error(`${file}: restore the pre-publication fitted checkpoint before rebaking; meshopt packing is the final lossless step`)
  if (previous) {
    const base = previous.preservedPayload
    if (!base || base.bytes > asset.binary.length || base.accessors > asset.document.accessors.length || base.bufferViews > asset.document.bufferViews.length) throw Error(`Invalid clean checkpoint: ${file}`)
    asset.binary = asset.binary.subarray(0, base.bytes)
    asset.document.accessors.length = base.accessors; asset.document.bufferViews.length = base.bufferViews
    asset.document.animations = []; asset.document.buffers[0].byteLength = base.bytes
    delete asset.document.asset.extras.factionHumanoidAnimationBuild
  } else if (asset.document.animations?.length) throw Error(`${file} is already animated. Restore this asset's clean fitted-rig checkpoint before the first bake.`)
  return { asset, previous }
}

function verifiedSource(directory) {
  const manifestPath = path.join(directory, 'manifest.json'), metadata = readJson(manifestPath)
  const file = path.join(directory, metadata.files.lod0), bytes = fs.readFileSync(file), digest = sha256(bytes)
  if (metadata.fileSha256?.lod0 !== digest) throw Error(`Animation source hash mismatch: ${file}`)
  return { directory: fs.realpathSync(directory), file, metadata, digest, manifestDigest: sha256(fs.readFileSync(manifestPath)), asset: readGlb(file) }
}

function animationDigest(clips) {
  const hash = createHash('sha256')
  for (const clip of clips) {
    hash.update(clip.name); hash.update(String(clip.duration))
    for (const track of clip.tracks) {
      hash.update(track.name); hash.update(Buffer.from(track.times.buffer, track.times.byteOffset, track.times.byteLength)); hash.update(Buffer.from(track.values.buffer, track.values.byteOffset, track.values.byteLength))
    }
  }
  return hash.digest('hex')
}

/** Import the authored exported function, not a copy of its timing/numbers.
 * Tree shaking avoids initializing the browser registry in this offline tool. */
export async function loadProjectDeathClip() {
  const { build } = await import('esbuild'), sourceFile = 'src/world/HumanoidAssetRegistry.ts'
  const sourceSha256 = sha256(fs.readFileSync(sourceFile))
  const result = await build({
    stdin: { contents: `export { createProjectAnimationClips } from './${sourceFile}'`, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, format: 'esm', platform: 'node', treeShaking: true, logLevel: 'silent',
    plugins: [{ name: 'offline-three', setup(builder) {
      builder.onResolve({ filter: /^three(?:\/|$)/ }, args => ({ path: import.meta.resolve(args.path), external: true }))
    } }],
  })
  const module = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
  const clip = module.createProjectAnimationClips().find(clip => clip.name === 'death')
  if (!clip) throw Error('Project exported animation factory no longer supplies death')
  if (sha256(fs.readFileSync(sourceFile)) !== sourceSha256) throw Error('Project animation source changed during offline import')
  return { clip, provenance: { sourceFile, sourceSha256, sourceExport: 'createProjectAnimationClips', sourceClip: 'death', sourceClipSha256: animationDigest([clip]), duration: clip.duration } }
}

export async function retargetDirectory(directory, options = {}) {
  const targetDir = fs.realpathSync(directory)
  const manifestPath = path.join(targetDir, 'manifest.json'), measurementsPath = path.join(targetDir, 'blender-measurements.json')
  const manifest = fs.existsSync(manifestPath) ? readJson(manifestPath) : { schemaVersion: 1, id: path.basename(targetDir), status: 'blocked', reason: 'Awaiting provenance and visual acceptance.', skeleton: 'project-humanoid-v1', files: { lod0: 'lod0.glb', lod1: 'lod1.glb', lod2: 'lod2.glb' } }
  if (manifest.bufferCompression || manifest.losslessTexturePacking) throw Error(`${targetDir}: restore the pre-publication fitted checkpoint before rebaking; lossless texture/buffer packing invalidates the old byte-offset checkpoint`)
  const measurements = fs.existsSync(measurementsPath) ? readJson(measurementsPath) : {}
  const metadata = { ...manifest, ...measurements, animationRetarget: { ...manifest.animationRetarget, ...measurements.animationRetarget } }
  const configuredSource = metadata.animationRetarget.sourceAsset
  const sourceDirectory = configuredSource ? path.join(publicRoot, configuredSource.endsWith('.glb') ? path.dirname(configuredSource) : configuredSource) : path.join(publicRoot, 'roman')
  const source = verifiedSource(options.sourceDir ?? sourceDirectory)
  // The Meshy Bandit visual is not the original finger/hammer animation donor.
  const bandit = verifiedSource(options.banditDir ?? frozenBanditDirectory())
  const banditAsset = options.banditDir ? path.relative(publicRoot, bandit.file).split(path.sep).join('/') : FROZEN_BANDIT_ASSET
  const banditCommit = options.banditDir ? undefined : FROZEN_BANDIT_COMMIT
  if ([source.directory, bandit.directory, ...['viking', 'roman', 'bandit'].map(id => path.resolve(publicRoot, id))].includes(targetDir)) throw Error('Refusing to modify an original animation-source asset')
  if (manifest.skeleton && manifest.skeleton !== 'project-humanoid-v1') throw Error('Target must be project-humanoid-v1')
  for (const key of ['swordGripFrames', 'rangedGripFrames', 'shieldGripFrames']) {
    if (!metadata[key] && key !== 'swordGripFrames') continue
    for (let lod = 1; lod < 3; lod++) if (JSON.stringify(metadata[key]?.[`lod${lod}`]) !== JSON.stringify(metadata[key]?.lod0)) throw Error(`Shared-LOD ${key} must use one measured canonical bind frame`)
  }
  const sourceRig = await loadRig(source.asset), banditRig = await loadRig(bandit.asset)
  const embedded = source.metadata.animations.embedded
  if (new Set(embedded.map(binding => binding.clip)).size !== embedded.length) throw Error('Duplicate source animation bindings')
  for (const binding of embedded) {
    const clip = sourceRig.animations.find(clip => clip.name === binding.clip)
    if (!clip || Math.abs(clip.duration - binding.duration) > 1e-5) throw Error(`Source duration/binding mismatch: ${binding.clip}`)
  }
  const inputs = []
  for (let lod = 0; lod < 3; lod++) {
    const file = path.join(targetDir, manifest.files?.[`lod${lod}`] ?? `lod${lod}.glb`)
    const { asset, previous } = cleanAsset(file), rig = await loadRig(asset)
    inputs.push({ file, asset, previous, rig, before: sha256(fs.readFileSync(file)), signature: rigSignature(rig, asset.document) })
  }
  for (const input of inputs.slice(1)) if (input.signature !== inputs[0].signature) throw Error(`LOD bind/hierarchy/socket mismatch: ${input.file}`)
  const target = inputs[0]
  const runProfile = metadata.animationRetarget?.capeRunProfile
  if (runProfile) {
    const actual = { sourceSha256: metadata.sourceSha256 ?? metadata.source?.sourceSha256, animationSourceSha256: source.digest, ...factionHumanoidBindDigests(target.asset, target.rig) }
    for (const key of ['sourceSha256', 'animationSourceSha256', 'geometrySkinSha256', 'restRigSha256']) if (!runProfile[key] || runProfile[key] !== actual[key]) throw Error(`Measured run profile ${key} mismatch; regenerate it from this exact fitted LOD0 and animation input`)
  }
  const { clips, diagnostics, verticalScale } = bakeFactionClips({ source: sourceRig, target: target.rig, sourceDocument: source.asset.document, targetDocument: target.asset.document, sourceMetadata: source.metadata, targetMetadata: metadata, fps: options.fps ?? 60 })
  const binding = embedded.find(entry => entry.clip === 'axeAttack1H')
  if (!binding) throw Error('Source lacks established axeAttack1H clock')
  clips.push(bakeBanditFootClip({ source: banditRig, target: target.rig, sourceDocument: bandit.asset.document, targetDocument: target.asset.document, sourceMetadata: bandit.metadata, targetMetadata: metadata, idle: clips.find(clip => clip.name === 'idle'), binding, fps: options.fps ?? 60 }))
  diagnostics.push(clips.at(-1).bakeDiagnostics)
  const clipNames = clips.map(clip => clip.name).sort(), bindings = structuredClone(embedded)
  const footBinding = bindings.find(entry => entry.clip === 'axeAttack1HFoot')
  if (!footBinding) bindings.push({ ...structuredClone(bandit.metadata.animations.embedded.find(entry => entry.clip === 'swordSlash')), clip: 'axeAttack1HFoot', duration: binding.duration, meleeCycleSeconds: binding.meleeCycleSeconds, events: structuredClone(binding.events) })
  else if (footBinding.duration !== binding.duration || footBinding.meleeCycleSeconds !== binding.meleeCycleSeconds || JSON.stringify(footBinding.events) !== JSON.stringify(binding.events)) throw Error('Existing foot-axe binding does not preserve the source 1H event clock')
  let projectDeath = null
  const groundedDeath = options.groundedDeath ?? metadata.animationRetarget.groundedDeath
  if (groundedDeath) {
    if (clips.some(clip => clip.name === 'death')) throw Error('Refusing to replace an existing authored death')
    const authored = await loadProjectDeathClip()
    const adapted = bakeProjectDeathClip({ sourceClip: authored.clip, target: target.rig, targetDocument: target.asset.document, targetMetadata: metadata, fps: options.fps ?? 60, clearanceM: metadata.animationRetarget.deathGroundClearanceM ?? 0 })
    clips.push(adapted.clip); diagnostics.push(adapted.diagnostics); clipNames.push('death'); clipNames.sort()
    bindings.push({ clip: 'death', source: 'SagaBurst', sourceClip: 'createProjectAnimationClips/death', loop: false, duration: authored.clip.duration })
    projectDeath = { ...authored.provenance, method: 'Existing additive motion resolved on fitted rest; full dead-cloth follow, bounded late ankle relaxation, and whole-skin ground contact baked once into a normal target clip', clearanceM: metadata.animationRetarget.deathGroundClearanceM ?? 0, deathClothFollow: 1, ankleSettle: adapted.diagnostics.ankleSettle }
  }
  if (JSON.stringify(clipNames) !== JSON.stringify(bindings.map(entry => entry.clip).sort())) throw Error('Output animation names do not match source/project bindings')
  const exactOptimization = collapseConstantTracks(clips)
  const poseSha256 = animationDigest(clips), sourceAsset = path.relative(publicRoot, source.file).split(path.sep).join('/')
  const sourceReadme = source.metadata.source?.licenseEvidence ? path.resolve(source.directory, source.metadata.source.licenseEvidence) : null
  const readmeText = sourceReadme && fs.existsSync(sourceReadme) ? fs.readFileSync(sourceReadme, 'utf8') : null
  const attributionFile = 'animation-source-attribution.txt'
  const attribution = [
    'Animation attribution and upstream evidence for this fitted target. The target model has separate provenance in manifest.json/source and attribution-evidence.json.',
    `Retargeted animation input: ${sourceAsset}\nSHA-256: ${source.digest}\nOriginal attribution: ${source.metadata.attribution ?? ''}`,
    'Mixed animation rights remain unchanged: Kevin Iglesias / Unity Asset Store EULA, Quaternius / CC0, user-supplied Meshy derivatives, and the separately identified Bandit strike. The combined animation data is not CC0 and must not be redistributed as a standalone animation bank.',
    readmeText ? `Original animation-source readme, reproduced unchanged below (${path.relative(publicRoot, sourceReadme).split(path.sep).join('/')}):\n\n${readmeText}` : `Original animation-source metadata:\n${JSON.stringify(source.metadata.source, null, 2)}`,
    `Bandit foot-strike attribution: ${bandit.metadata.attribution}\n${JSON.stringify(bandit.metadata.source, null, 2)}\nEmbedded input: ${banditAsset}\nSHA-256: ${bandit.digest}`,
    ...(projectDeath ? [`Target-only death: SagaBurst project animation, ${projectDeath.sourceFile}#${projectDeath.sourceExport}. Existing timing and early joint motion retained; bounded late ankle relaxation, dead-cloth follow, and whole-skin contact adapted to this fitted target. Source code SHA-256: ${projectDeath.sourceSha256}`] : []),
  ].join('\n\n') + '\n'
  const provenance = {
    version: 1, sourceAsset, sourceSha256: source.digest, sourceManifestSha256: source.manifestDigest,
    source: { ...structuredClone(source.metadata.source), upstreamLicenseEvidence: source.metadata.source?.licenseEvidence ?? null, licenseEvidence: attributionFile }, animationSources: source.metadata.animationSources ?? null,
    attributionFile, attributionSha256: sha256(Buffer.from(attribution)), upstreamReadme: readmeText ? { sourceAsset: path.relative(publicRoot, sourceReadme).split(path.sep).join('/'), sha256: sha256(Buffer.from(readmeText)) } : null,
    method: 'Measured anatomical limb axes, target-local grip frames, canonical LOD0 pose shared across every LOD; no heading offsets or wrist patches',
    rootMotion: 'No source planar translation or scale; target anatomical limb lengths retained; vertical pelvis/contact measured on LOD0 skin, including actual idle-leg composition for bow; bounded cloth-helper offsets audited separately',
    sourceBindings: structuredClone(embedded), canonicalPoseSha256: poseSha256, measuredLegScale: verticalScale, exactOptimization,
    ...(projectDeath ? { groundedDeath: true, projectDeath } : {}),
    targetMeasurementsSha256: fs.existsSync(measurementsPath) ? sha256(fs.readFileSync(measurementsPath)) : null,
    helperRules: { clothRig: metadata.clothRig ?? metadata.animationRetarget?.clothRig ?? null, skirt: metadata.animationRetarget?.skirt ?? [], skirtApron: metadata.animationRetarget?.skirtApron ?? null },
    bowGroundContact: { policy: (typeof metadata.animationRetarget?.bowGroundContact === 'string' ? metadata.animationRetarget.bowGroundContact : metadata.animationRetarget?.bowGroundContact?.policy) ?? 'idle-composition', rawPoseNote: 'Gameplay replaces bow leg tracks with locomotion legs while retaining bow pelvis. Raw source-mode bow may hover to preserve the measured composed stance.', clips: diagnostics.filter(row => row.bowGroundContact).map(row => ({ clip: row.clip, ...row.bowGroundContact })) },
    capeFloorValidation: {
      failedFloorSamples: diagnostics.reduce((sum, row) => sum + (row.capeFloor?.failedFloorSamples ?? 0), 0),
      maximumRemainingPenetrationM: Math.max(0, ...diagnostics.map(row => row.capeFloor?.maximumRemainingPenetrationM ?? 0)),
      clips: diagnostics.filter(row => row.capeFloor?.enabled).map(row => ({ clip: row.clip, failedFloorSamples: row.capeFloor.failedFloorSamples, maximumRemainingPenetrationM: row.capeFloor.maximumRemainingPenetrationM, maximumAppliedTranslationM: row.capeFloor.maximumAppliedTranslationM })),
    },
    banditFootAxe: { sourceAsset: banditAsset, sourceCommit: banditCommit, sourceSha256: bandit.digest, sourceManifestSha256: bandit.manifestDigest, source: structuredClone(bandit.metadata.source), sourceBinding: structuredClone(bandit.metadata.animations.embedded.find(entry => entry.clip === 'swordSlash')), sourceClip: 'swordSlash', sourceHit: bandit.metadata.animations.embedded.find(entry => entry.clip === 'swordSlash').events.hit, duration: binding.duration, events: structuredClone(binding.events), meleeCycleSeconds: binding.meleeCycleSeconds },
    rebuild: 'node tools/retarget-faction-humanoids.mjs --target-dir <clean-target-directory>',
  }
  const poseBounds = measureClipBounds(target.rig, clips)
  const outputs = inputs.map(input => {
    const preservedPayload = { bytes: input.asset.binary.length, accessors: input.asset.document.accessors.length, bufferViews: input.asset.document.bufferViews.length }
    const packed = appendClips(input.asset, input.rig, clips, { version: 1, preservedPayload, inputSha256: input.previous?.inputSha256 ?? input.before, sourceSha256: source.digest, banditSha256: bandit.digest, canonicalPoseSha256: poseSha256 })
    if (!packed.binary.subarray(0, input.asset.binary.length).equals(input.asset.binary)) throw Error('Clean geometry/skin/image payload changed')
    return { input, bytes: encodeGlb(packed.document, packed.binary) }
  })
  // Validate every packed LOD before replacing any target file.
  for (const { bytes } of outputs) {
    const jsonLength = bytes.readUInt32LE(12), asset = { document: JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength)), binary: bytes.subarray(28 + jsonLength) }
    const loaded = await loadRig(asset)
    if (animationDigest(loaded.animations) !== poseSha256) throw Error('Serialized LOD animation differs from canonical pose')
  }
  manifest.animations = { embedded: bindings, runtimeGenerated: structuredClone(source.metadata.animations.runtimeGenerated).filter(name => !projectDeath || name !== 'death'), attributionFile }
  manifest.sharedLodPose = true; manifest.animationRetarget = { ...manifest.animationRetarget, ...measurements.animationRetarget, ...provenance }
  manifest.knownLimitations = [...new Set([
    ...(manifest.knownLimitations ?? []),
    ...(projectDeath ? ['The target-only grounded death retains a slightly propped prone shape from the authored motion; contacting extremities do not imply a fully flat torso.'] : []),
    ...(diagnostics.some(row => row.bowGroundContact) ? ['Raw source-mode bow poses may hover: gameplay retains the bow pelvis while replacing leg tracks with locomotion legs, and the fitted contact bake preserves that composed stance.'] : []),
    ...((metadata.animationRetarget?.groundContact?.mode ?? 'plant') === 'plant' && clipNames.includes('idle') && clipNames.includes('run') ? ['Per-frame locomotion planting removes authored airborne run clearance. Actual idle/run fades on the reviewed fitted targets can briefly dip soles about 2.5–4.7 cm; source-clearance-preserving locomotion remains unfinished.'] : []),
    ...(clipNames.includes('axeAttack2H') ? ['The inherited short early two-handed-axe runtime transition can briefly dip feet about 2–4 cm; the shared blend and body/root behavior are unchanged.'] : []),
  ])]
  for (const key of ['handGripFrames', 'swordGripFrames', 'rangedGripFrames', 'shieldGripFrames']) if (metadata[key]) manifest[key] = structuredClone(metadata[key])
  manifest.fileSha256 ??= {}
  for (const [lod, output] of outputs.entries()) {
    manifest.fileSha256[`lod${lod}`] = sha256(output.bytes)
    if (manifest.lodMeasurements?.[lod]) Object.assign(manifest.lodMeasurements[lod], { sha256: sha256(output.bytes), bytes: output.bytes.length })
  }
  if (sha256(fs.readFileSync(source.file)) !== source.digest || sha256(fs.readFileSync(bandit.file)) !== bandit.digest) throw Error('Immutable animation source changed during bake')
  for (const output of outputs) fs.writeFileSync(`${output.input.file}.animation-stage`, output.bytes)
  fs.writeFileSync(path.join(targetDir, `${attributionFile}.animation-stage`), attribution)
  fs.writeFileSync(`${manifestPath}.animation-stage`, JSON.stringify(manifest, null, 2) + '\n')
  for (const output of outputs) fs.renameSync(`${output.input.file}.animation-stage`, output.input.file)
  fs.renameSync(path.join(targetDir, `${attributionFile}.animation-stage`), path.join(targetDir, attributionFile))
  fs.renameSync(`${manifestPath}.animation-stage`, manifestPath)
  const report = { id: manifest.id, sourceAsset, sourceSha256: source.digest, banditSha256: bandit.digest, canonicalPoseSha256: poseSha256, clips: clipNames, measuredLegScale: verticalScale, exactOptimization, diagnostics, poseBounds, fileSha256: manifest.fileSha256, sourceInputsUnchanged: true }
  // The report is part of asset provenance, not a visual-readiness claim.
  fs.writeFileSync(path.join(targetDir, 'animation-retarget-audit.json'), JSON.stringify(report, null, 2) + '\n')
  return report
}

async function main(args) {
  const dirs = [], ids = [], options = {}; let root = publicRoot
  const take = (flag, i) => { if (!args[i + 1] || args[i + 1].startsWith('--')) throw Error(`Missing value for ${flag}`); return args[i + 1] }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--target-dir') dirs.push(take(arg, i++))
    else if (arg === '--root') root = take(arg, i++)
    else if (arg === '--source-dir') options.sourceDir = take(arg, i++)
    else if (arg === '--source') { const id = take(arg, i++); if (!['roman', 'viking'].includes(id)) throw Error('--source must be roman or viking'); options.sourceDir = path.join(publicRoot, id) }
    else if (arg === '--grounded-death') options.groundedDeath = true
    else if (arg === '--fps') { options.fps = Number(take(arg, i++)); if (!Number.isFinite(options.fps) || options.fps < 30 || options.fps > 120) throw Error('--fps must be between 30 and 120') }
    else if (arg === '--help' || arg === '-h') { console.log('Usage: node tools/retarget-faction-humanoids.mjs --target-dir <directory> [--source roman|viking] [--fps 60] [--grounded-death]\n   or: node tools/retarget-faction-humanoids.mjs --root <staged-root> <id,id,...>\nRequires clean fitted lod0/1/2.glb and measured grip frames. Source GLBs are read-only.'); return }
    else if (arg.startsWith('-')) throw Error(`Unknown option ${arg}`)
    else ids.push(...arg.split(','))
  }
  dirs.push(...ids.map(id => path.join(root, id)))
  if (!dirs.length) throw Error('Specify --target-dir or target IDs; no assets are modified by default')
  if (new Set(dirs.map(dir => path.resolve(dir))).size !== dirs.length) throw Error('Duplicate target directories')
  for (const directory of dirs) console.log(JSON.stringify(await retargetDirectory(directory, options), null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main(process.argv.slice(2)).catch(error => { console.error(error.stack); process.exitCode = 1 })
