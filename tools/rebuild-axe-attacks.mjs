import fs from 'node:fs'
import * as T from 'three'
import { createHash } from 'node:crypto'
import { readGlb, loadRig, replaceClips, encodeGlb, retargetArms } from './lib/humanoid-glb.mjs'

const source = JSON.parse(fs.readFileSync(process.argv[2] ?? 'output/axe/source.json', 'utf8'))
const base = 'public/models/characters/v2/viking'
const manifest = JSON.parse(fs.readFileSync(`${base}/manifest.json`, 'utf8'))
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

const reference = await loadRig(readGlb(`${base}/lod0.glb`))
reference.scene.updateMatrixWorld(true)
const referenceLeft = reference.scene.getObjectByName('hand_l').matrixWorld.clone()
for (let lod = 0; lod < 3; lod++) {
  const original = readGlb(`${base}/lod${lod}.glb`), replacements = new Map()
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
  const result = replaceClips(original, replacements)
  result.document.asset.extras.axeAttackBuild = { version: 1, sourceSha256: source.sourceSha256,
    rootMotion: 'rotation only; fixed root and pelvis position; planted lower body',
    clips: Object.fromEntries(Object.entries(source.clips).map(([name, sample]) => [name, {
      sourceClip: sample.sourceClip, sourceFileSha256: sample.sourceFileSha256, sourceFrames: sample.sourceFrames,
      sourceFps: sample.sourceFps, duration: sample.duration, timeMapping: 'linear; preserve existing 0.48s attack budget',
    }])) }
  const bytes = encodeGlb(result.document, result.binary)
  fs.writeFileSync(`${base}/lod${lod}.glb`, bytes)
  manifest.fileSha256[`lod${lod}`] = createHash('sha256').update(bytes).digest('hex')
}
for (const [name, sample] of Object.entries(source.clips)) {
  manifest.animations.embedded = manifest.animations.embedded.filter(c => c.clip !== name)
  manifest.animations.embedded.push({ clip: name, source: 'Kevin Iglesias', sourceClip: sample.sourceClip,
    loop: false, duration: .48, events: { hit: name === 'axeAttack1H' ? .48 * 9 / 33 : .17, actionComplete: .48 } })
}
manifest.axeAttackBuild = { sourceSha256: source.sourceSha256, license: 'Standard Asset Store EULA',
  licenseEvidence: 'Human Melee Animations 2.0 FREE.pdf',
  sourceUrl: 'https://kevdev.itch.io/human-melee-animatons-free',
  sourceDistribution: 'Retargeted rotation tracks only; source archive, FBX and meshes excluded from public/Git.',
  rootMotionRemoved: true, duration: .48,
  contactSourceFrames: { axeAttack1H: 10, axeAttack2H: 18 },
  contactMeasurement: 'Actual blade edge passes character-forward during the first strike; source frame 1 maps to t=0.' }
fs.writeFileSync(`${base}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n')
console.log('Rebuilt Viking axeAttack1H / axeAttack2H in LOD0/1/2; all existing clips/mesh buffers preserved.')
