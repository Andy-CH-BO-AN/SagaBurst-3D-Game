import fs from 'node:fs'
import * as THREE from 'three'
import { createHash } from 'node:crypto'
import { readGlb, loadRig, replaceClips, encodeGlb, transferClip, retargetArms } from './lib/humanoid-glb.mjs'

// Only the existing locomotion clips are repaired here. Sword attack is a separate gate.
const samples = JSON.parse(fs.readFileSync('output/sword/source-locomotion.json', 'utf8'))
for (const faction of ['roman', 'viking']) {
  const base = `public/models/characters/v2/${faction}`
  const reference = readGlb(`${base}/lod1.glb`)
  const baseline = JSON.parse(fs.readFileSync(`artifacts/animation_sources/sword_baselines/${faction}-locomotion.json`, 'utf8'))
  const manifest = JSON.parse(fs.readFileSync(`${base}/manifest.json`, 'utf8'))
  for (let lod = 0; lod < 3; lod++) {
    const original = readGlb(`${base}/lod${lod}.glb`)
    const replacements = new Map()
    for (const name of ['idle', 'walk', 'run']) {
      const source = await loadRig(reference), target = await loadRig(original)
      const body = transferClip(source, target, THREE.AnimationClip.parse(baseline.clips.find(c => c.name === name)))
      // Roman's authored arm poses are already correct. Only restore its existing
      // LOD1 motion in LOD0; never apply the Viking anatomical arm retarget here.
      if (faction === 'roman') replacements.set(name, body)
      else {
        const cleanTarget = await loadRig(original)
        replacements.set(name, retargetArms(samples.clips[name], cleanTarget, body,
          manifest.swordGripFrames[`lod${lod}`], manifest.handGripFrames.left))
      }
    }
    const result = replaceClips(original, replacements)
    result.document.asset.extras.swordLocomotionRepair = { version: 3, sourceLod: 1, baselineSha256: baseline.sha256, sourceSha256: samples.sourceSha256, clips: [...replacements.keys()], fps: 30, method: faction === 'roman' ? 'restore authored LOD1 motion; no anatomical arm retarget' : 'source anatomical arm axes; immutable existing locomotion body in target rest basis' }
    const bytes = encodeGlb(result.document, result.binary)
    fs.writeFileSync(`${base}/lod${lod}.glb`, bytes)
    manifest.fileSha256[`lod${lod}`] = createHash('sha256').update(bytes).digest('hex')
  }
  fs.writeFileSync(`${base}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n')
  console.log(`${faction}：已恢復 idle／walk／run；其餘動畫與骨架／網格資料保留。`)
}
