import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { readGlb, loadRig, replaceClips, encodeGlb, retargetSwordBody, retargetArms } from './lib/humanoid-glb.mjs'

const source = JSON.parse(fs.readFileSync('output/sword/source-attack.json', 'utf8'))
const sample = source.clips.swordSlash
if (sample.sourceClip !== 'Sword_Regular_A' || sample.duration !== .48) throw new Error('Expected Sword_Regular_A → 0.48 second swordSlash')
for (const faction of ['roman', 'viking']) {
  const base = `public/models/characters/v2/${faction}`
  const manifest = JSON.parse(fs.readFileSync(`${base}/manifest.json`, 'utf8'))
  for (let lod = 0; lod < 3; lod++) {
    const original = readGlb(`${base}/lod${lod}.glb`)
    const body = retargetSwordBody(sample, await loadRig(original))
    const clip = retargetArms(sample, await loadRig(original), body,
      manifest.swordGripFrames[`lod${lod}`], manifest.handGripFrames.left, 'quaternius')
    const result = replaceClips(original, new Map([['swordSlash', clip]]))
    result.document.asset.extras.swordAttackBuild = {
      version: 1, source: 'UAL2_Standard.glb', clip: sample.sourceClip, sourceSha256: source.sourceSha256,
      sourceDuration: .43333333333333335, duration: .48, fps: 30, exactEndSample: true,
      timeMapping: sample.timeMapping,
      method: 'immutable source world samples; anatomical upper body; target planted stance with source pelvis yaw; rotation-only in-place',
    }
    const bytes = encodeGlb(result.document, result.binary)
    fs.writeFileSync(`${base}/lod${lod}.glb`, bytes)
    manifest.fileSha256[`lod${lod}`] = createHash('sha256').update(bytes).digest('hex')
  }
  manifest.swordAttackBuild = { sourceClip: sample.sourceClip, sourceSha256: source.sourceSha256, duration: .48, fps: 30,
    lowerBody: 'target bind stance with source pelvis yaw (no pelvis translation)', timeMapping: sample.timeMapping }
  fs.writeFileSync(`${base}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n')
  console.log(`${faction}: rebuilt swordSlash in all three LODs`)
}
