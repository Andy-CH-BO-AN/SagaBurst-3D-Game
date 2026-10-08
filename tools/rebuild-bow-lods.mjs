/** Align ordinary Viking bow LODs to the authority pose in each target bind basis.
 * Run after upstream humanoid/axe generation. No source downloads are needed.
 */
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import * as THREE from 'three'
import { readGlb, loadRig, transferClip, replaceClips, encodeGlb } from './lib/humanoid-glb.mjs'
const base = 'public/models/characters/v2/viking'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const manifest = JSON.parse(fs.readFileSync(`${base}/manifest.json`))
const sourceBytes = fs.readFileSync(`${base}/lod0.glb`)
for (const lod of [1, 2]) {
  const path = `${base}/lod${lod}.glb`, asset = readGlb(path), replacements = new Map()
  for (const name of ['bowLoad', 'bowHold', 'bowRelease']) {
    const source = await loadRig(readGlb(`${base}/lod0.glb`)), target = await loadRig(asset)
    const original = source.animations.find(c => c.name === name)
    const clip = transferClip(source, target, original)
    // Runtime keeps LOD0's contact-critical left-hand topology in each LOD's
    // hand-local frame (BowGripLOD). Therefore its palm frame must follow the
    // source hand in world space, while the other bones retain rest-delta skin
    // deformation. Re-express that frame relative to the target's animated
    // forearm; copying source local quaternions would ignore the parent basis.
    const sourceHand = source.scene.getObjectByName('hand_l')
    const targetHand = target.scene.getObjectByName('hand_l')
    const handTrack = clip.tracks.find(t => t.name === 'hand_l.quaternion')
    const sourceMixer = new THREE.AnimationMixer(source.scene), targetMixer = new THREE.AnimationMixer(target.scene)
    for (const [mixer, animation] of [[sourceMixer, original], [targetMixer, clip]]) {
      const action = mixer.clipAction(animation).setLoop(THREE.LoopOnce, 1)
      action.clampWhenFinished = true; action.play()
    }
    const handValues = new Float32Array(handTrack.values.length)
    handTrack.times.forEach((time, i) => {
      sourceMixer.setTime(time); targetMixer.setTime(time)
      source.scene.updateMatrixWorld(true); target.scene.updateMatrixWorld(true)
      const local = targetHand.parent.getWorldQuaternion(new THREE.Quaternion()).invert()
        .multiply(sourceHand.getWorldQuaternion(new THREE.Quaternion())).normalize()
      local.toArray(handValues, i * 4)
    })
    sourceMixer.stopAllAction(); targetMixer.stopAllAction()
    handTrack.values = handValues
    // Preserve the source's two-key load endpoints. The runtime completes the
    // static load toward this same rig's hold, just as for authority LOD0.
    if (name === 'bowLoad') clip.tracks = clip.tracks.map(t => new THREE.QuaternionKeyframeTrack(t.name,
      [0, clip.duration], [...t.values.slice(0, 4), ...t.values.slice(-4)]))
    replacements.set(name, clip)
  }
  const result = replaceClips(asset, replacements)
  // Repacking invalidates a later append-only axe checkpoint, if present.
  // The next axe rebuild must capture this new payload instead of truncating it.
  const axeBuild = result.document.asset.extras.axeAttackBuild
  if (axeBuild) { delete axeBuild.preservedPayload; delete axeBuild.targetAssetId }
  result.document.asset.extras.bowLodBuild = { sourceSha256: hash(sourceBytes), sourceLOD: 0,
    method: 'World rest-delta transfer; left palm follows authority topology frame; rotation only' }
  const bytes = encodeGlb(result.document, result.binary)
  fs.writeFileSync(path, bytes)
  manifest.fileSha256[`lod${lod}`] = hash(bytes)
}
manifest.bowLodBuild = { sourceSha256: hash(sourceBytes), sourceLOD: 0,
  clips: ['bowLoad', 'bowHold', 'bowRelease'], targetLODs: [1, 2],
  method: 'Re-express authority skin deformation in target rest basis and retained left-hand topology frame; preserve two-key load endpoints for runtime completion' }
fs.writeFileSync(`${base}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n')
console.log('Viking bow LOD1/2 retargeted from authority LOD0; other clips and mesh payload preserved.')
