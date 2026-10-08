import fs from 'node:fs'
import { retargetMountedAxeCarry } from './lib/mounted-axe-carry.mjs'
import { repairRomanArmBind } from './lib/roman-arm-bind.mjs'
import { repairRomanArmSurfaces } from './lib/roman-arm-surfaces.mjs'
import * as T from 'three'
import { createHash } from 'node:crypto'
import { readGlb, loadRig, encodeGlb, retargetArms } from './lib/humanoid-glb.mjs'

const source = JSON.parse(fs.readFileSync(process.argv[2] ?? 'output/axe/source.json', 'utf8'))
const map = { hips: 'B-hips', spine: 'B-spine', chest: 'B-chest', upper_chest: 'B-chest',
  neck: 'B-neck', head: 'B-head', clavicle_l: 'B-shoulder.L', clavicle_r: 'B-shoulder.R',
  upper_arm_l: 'B-upperArm.L', lower_arm_l: 'B-forearm.L', hand_l: 'B-hand.L',
  upper_arm_r: 'B-upperArm.R', lower_arm_r: 'B-forearm.R', hand_r: 'B-hand.R',
  upper_leg_l: 'B-thigh.L', lower_leg_l: 'B-shin.L', foot_l: 'B-foot.L', toe_l: 'B-toe.L',
  upper_leg_r: 'B-thigh.R', lower_leg_r: 'B-shin.R', foot_r: 'B-foot.R', toe_r: 'B-toe.R' }

function bodyClip(name, sample, target) {
  target.scene.updateMatrixWorld(true)
  const pairs = []
  target.scene.traverse(bone => {
    if (map[bone.name]) pairs.push({ bone, source: map[bone.name],
      rest: bone.getWorldQuaternion(new T.Quaternion()), values: [] })
  })
  for (const pose of sample.poses) {
    const hips = new T.Quaternion().fromArray(pose['B-hips'])
      .multiply(new T.Quaternion().fromArray(sample.rest['B-hips'].rotation).invert())
    const heading = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), new T.Euler().setFromQuaternion(hips, 'YXZ').y)
    for (const p of pairs) {
      const planted = /^(hips|upper_leg_|lower_leg_|foot_|toe_)/.test(p.bone.name)
      const world = planted ? heading.clone().multiply(p.rest) : new T.Quaternion().fromArray(pose[p.source])
        .multiply(new T.Quaternion().fromArray(sample.rest[p.source].rotation).invert()).multiply(p.rest)
      const q = p.bone.parent.getWorldQuaternion(new T.Quaternion()).invert().multiply(world).normalize()
      if (p.values.length && q.dot(new T.Quaternion().fromArray(p.values, p.values.length - 4)) < 0) q.set(-q.x, -q.y, -q.z, -q.w)
      p.values.push(...q.toArray()); p.bone.quaternion.copy(q); p.bone.updateWorldMatrix(false, false)
    }
  }
  return new T.AnimationClip(name, sample.duration, pairs.map(p => new T.QuaternionKeyframeTrack(`${p.bone.name}.quaternion`, sample.times, p.values)))
}

// Select assets explicitly when repairing existing independent hero outputs.
// Re-run after upstream humanoid/hero builds. Roman arms are fitted/rebound
// before retargeting; other meshes and unrelated animation samples are retained.
for (const assetId of (process.argv[3] ?? 'viking,roman,roman-hero-t4').split(',')) {
const base = `public/models/characters/v2/${assetId}`
const manifest = JSON.parse(fs.readFileSync(`${base}/manifest.json`, 'utf8'))
const inputSha256 = {}
const originals = [0, 1, 2].map(lod => readGlb(`${base}/lod${lod}.glb`))
if (assetId === 'roman' || assetId === 'roman-hero-t4') {
  const left = structuredClone(manifest.handGripFrames.left)
  for (let lod = 0; lod < 3; lod++) {
    const frame = structuredClone(left)
    const repaired = await repairRomanArmBind(originals[lod], assetId, manifest.swordGripFrames[`lod${lod}`], frame)
    await repairRomanArmSurfaces(originals[lod], assetId, lod)
    if (lod === 0 && repaired) manifest.handGripFrames.left = frame
  }
}
const reference = await loadRig(originals[0])
reference.scene.updateMatrixWorld(true)
const referenceLeft = reference.scene.getObjectByName('hand_l').matrixWorld.clone()
for (let lod = 0; lod < 3; lod++) {
  const original = originals[lod], replacements = new Map()
  const previousHash = createHash('sha256').update(fs.readFileSync(`${base}/lod${lod}.glb`)).digest('hex')
  // A hero build can inherit metadata from its faction source. Its payload
  // has since been rescaled/repacked, so never reuse another asset's checkpoint.
  const previous = original.document.asset.extras.axeAttackBuild
  const ownBuild = previous?.targetAssetId === assetId ? previous : undefined
  inputSha256[`lod${lod}`] = ownBuild?.inputSha256
    ?? previousHash
  for (const [name, sample] of Object.entries(source.clips)) {
    const target = await loadRig(original)
    target.scene.updateMatrixWorld(true)
    const transform = target.scene.getObjectByName('hand_l').matrixWorld.clone().invert().multiply(referenceLeft)
    const left = structuredClone(manifest.handGripFrames.left)
    for (const key of ['thumbDirection', 'fingerDirection']) left[key] = new T.Vector3(...left[key]).transformDirection(transform).toArray()
    const frame = manifest.swordGripFrames[`lod${lod}`]
    const clip = retargetArms(sample, target, bodyClip(name, sample, await loadRig(original)), frame, left)
    // Retain the existing axe model's 0.45 rad display tilt. Counter-rotate the
    // wrist so the actual haft follows the source's anatomical grip axis.
    const y = new T.Vector3(...frame.gripAxisLocal).normalize(), z = new T.Vector3(...frame.palmNormalLocal).negate().normalize()
    const x = new T.Vector3().crossVectors(y, z).normalize(); z.crossVectors(x, y)
    const grip = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(x, y, z))
    const correction = grip.clone().multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), -.45)).multiply(grip.clone().invert())
    const wrist = clip.tracks.find(t => t.name === 'hand_r.quaternion')
    for (let i = 0; i < wrist.values.length; i += 4) new T.Quaternion().fromArray(wrist.values, i).multiply(correction).toArray(wrist.values, i)
    replacements.set(name, clip)
    if (!original.document.animations.some(c => c.name === name)) original.document.animations.push({ name, samplers: [], channels: [] })
  }
  if (assetId === 'roman' || assetId === 'roman-hero-t4') {
    const sourceBase = 'public/models/characters/v2/viking'
    const sourceManifest = JSON.parse(fs.readFileSync(`${sourceBase}/manifest.json`))
    const target = await loadRig(original)
    target.scene.updateMatrixWorld(true)
    const leftFrame = (m, transform = new T.Matrix4()) => ({
      gripAxisLocal: new T.Vector3(...m.handGripFrames.left.thumbDirection).transformDirection(transform).toArray(),
      fingerDirection: new T.Vector3(...m.handGripFrames.left.fingerDirection).transformDirection(transform).toArray(),
    })
    const transform = target.scene.getObjectByName('hand_l').matrixWorld.clone().invert().multiply(referenceLeft)
    replacements.set('axeMountedIdle', retargetMountedAxeCarry(await loadRig(readGlb(`${sourceBase}/lod0.glb`)), target,
      { right: sourceManifest.swordGripFrames.lod0, left: leftFrame(sourceManifest) },
      { right: manifest.swordGripFrames[`lod${lod}`], left: leftFrame(manifest, transform) }))
  }
  // Heroes may have mesh/texture/accessor additions after humanoidAnimationBuild.
  // Preserve their complete input payload; use our own checkpoint for repeatable rebakes.
  const checkpoint = ownBuild?.preservedPayload ?? {
    bytes: original.binary.length, accessors: original.document.accessors.length,
    bufferViews: original.document.bufferViews.length,
  }
  const document = structuredClone(original.document)
  document.accessors.length = checkpoint.accessors
  document.bufferViews.length = checkpoint.bufferViews
  const chunks = [original.binary.subarray(0, checkpoint.bytes)]
  let offset = checkpoint.bytes
  const append = (values, type) => {
    const bytes = Buffer.from(values.buffer, values.byteOffset, values.byteLength)
    document.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length })
    chunks.push(bytes); offset += bytes.length
    const accessor = { bufferView: document.bufferViews.length - 1, componentType: 5126,
      count: values.length / (type === 'SCALAR' ? 1 : 4), type }
    if (type === 'SCALAR') { accessor.min = [values[0]]; accessor.max = [values.at(-1)] }
    document.accessors.push(accessor)
    return document.accessors.length - 1
  }
  document.animations = document.animations.filter(a => !replacements.has(a.name))
  for (const [name, clip] of replacements) {
    const samplers = [], channels = []
    for (const track of clip.tracks) {
      const bone = track.name.replace(/\.quaternion$/, '')
      const node = document.nodes.findIndex(n => n.name === bone)
      if (node < 0) throw Error(`Missing target bone ${bone}`)
      channels.push({ sampler: samplers.length, target: { node, path: 'rotation' } })
      samplers.push({ input: append(track.times, 'SCALAR'), output: append(track.values, 'VEC4'), interpolation: 'LINEAR' })
    }
    document.animations.push({ name, samplers, channels })
  }
  document.buffers[0].byteLength = offset
  const result = { document, binary: Buffer.concat(chunks) }
  result.document.asset.extras.axeAttackBuild = { version: 2, targetAssetId: assetId, preservedPayload: checkpoint, inputSha256: inputSha256[`lod${lod}`], sourceSha256: source.sourceSha256,
    rootMotion: 'rotation only; fixed root and pelvis position; planted lower body',
    clips: Object.fromEntries(Object.entries(source.clips).map(([name, sample]) => [name, {
      sourceClip: sample.sourceClip, sourceFileSha256: sample.sourceFileSha256, sourceFrames: sample.sourceFrames,
      sourceFps: sample.sourceFps, duration: sample.duration, timeMapping: 'linear; preserve existing 0.48s attack budget',
    }])) }
  if (replacements.has('axeMountedIdle')) result.document.asset.extras.axeAttackBuild.mountedCarrySource = {
    asset: 'viking/lod0.glb', sha256: createHash('sha256').update(fs.readFileSync('public/models/characters/v2/viking/lod0.glb')).digest('hex'),
    clip: 'idle', method: 'Anatomical arm/palm retarget; target torso and limb lengths retained',
  }
  const bytes = encodeGlb(result.document, result.binary)
  fs.writeFileSync(`${base}/lod${lod}.glb`, bytes)
  manifest.fileSha256[`lod${lod}`] = createHash('sha256').update(bytes).digest('hex')
  if (assetId === 'roman' && lod === 2) {
    // Owned arm repairs retain primitive/material boundaries and bone palettes.
    // The consolidation suite verifies the resulting attributes and indices.
    // Do not advance the guard for an unrelated upstream rebuild.
    const policyPath = 'src/world/HumanoidLod2Consolidation.ts'
    const policy = fs.readFileSync(policyPath, 'utf8')
    const prior = `AUDITED_ROMAN_LOD2_SHA256 = '${previousHash}'`
    if (policy.includes(prior)) fs.writeFileSync(policyPath, policy.replace(prior,
      `AUDITED_ROMAN_LOD2_SHA256 = '${manifest.fileSha256.lod2}'`))
  }
  const triangles = document.meshes.reduce((sum, mesh) => sum + mesh.primitives.reduce((sum, p) =>
    sum + document.accessors[p.indices ?? p.attributes.POSITION].count / 3, 0), 0)
  if (manifest.metrics?.triangles) manifest.metrics.triangles[`lod${lod}`] = triangles
  if (manifest.lodMeasurements?.[lod]) Object.assign(manifest.lodMeasurements[lod], { sha256: manifest.fileSha256[`lod${lod}`], bytes: bytes.length, triangles })
}
for (const [name, sample] of Object.entries(source.clips)) {
  manifest.animations.embedded = manifest.animations.embedded.filter(c => c.clip !== name)
  manifest.animations.embedded.push({ clip: name, source: 'Kevin Iglesias', sourceClip: sample.sourceClip,
    loop: false, duration: .48, events: { hit: name === 'axeAttack1H' ? .48 * 9 / 33 : .17, actionComplete: .48 } })
}
if (assetId === 'roman' || assetId === 'roman-hero-t4') {
  manifest.animations.embedded = manifest.animations.embedded.filter(c => c.clip !== 'axeMountedIdle')
  manifest.animations.embedded.push({ clip: 'axeMountedIdle', source: 'Viking authored idle',
    sourceClip: 'idle', loop: true, duration: reference.animations.find(c => c.name === 'idle').duration })
  manifest.armRigRepair = {
    bind: originals[0].document.asset.extras.romanArmBind,
    surfaces: originals[0].document.asset.extras.romanArmSurfaces,
    anatomicalVertices: 'preserved; only sleeve fit, bracer clearance and shoulder weights changed',
  }
}
manifest.axeAttackBuild = { inputSha256, sourceSha256: source.sourceSha256, license: 'Standard Asset Store EULA',
  licenseEvidence: 'Human Melee Animations 2.0 FREE.pdf',
  sourceUrl: 'https://kevdev.itch.io/human-melee-animatons-free',
  sourceDistribution: 'Retargeted rotation tracks only; source archive, FBX and meshes excluded from public/Git.',
  rootMotionRemoved: true, duration: .48,
  contactSourceFrames: { axeAttack1H: 10, axeAttack2H: 18 },
  contactMeasurement: 'Actual blade edge passes character-forward during the first strike; source frame 1 maps to t=0.' }
fs.writeFileSync(`${base}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n')
console.log(`Rebuilt ${assetId} axe animations in LOD0/1/2; unrelated animation samples retained${manifest.armRigRepair ? '; Roman arm bind/surface repair included' : ''}.`)
}
