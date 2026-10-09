/** Run after build-paladin.py. Reuses the prior Roman T4 clips and event contract. */
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as THREE from 'three'
import { readGlb, loadRig, encodeGlb } from './lib/humanoid-glb.mjs'

const dir = 'public/models/characters/v2/roman-hero-t4'
// Read the already integrated asset from the pinned base, without distributing a
// separate animation-only payload. Full Git history is required for this build.
const sourcePath = 'output/paladin-build/roman-t4-source.glb'
fs.mkdirSync('output/paladin-build', { recursive: true })
fs.writeFileSync(sourcePath, execFileSync('git', ['show', 'ae06476:public/models/characters/v2/roman-hero-t4/lod0.glb'], { maxBuffer: 32 * 1024 * 1024 }))
const sourceAsset = readGlb(sourcePath)
const source = await loadRig(sourceAsset)
const original = JSON.parse(fs.readFileSync('tools/assets/roman-t4-animation-source.json'))
const measured = JSON.parse(fs.readFileSync(`${dir}/paladin-build.json`))
const sources = JSON.parse(fs.readFileSync('public/models/weapons/paladin/sources.json'))
const hash = path => createHash('sha256').update(fs.readFileSync(path)).digest('hex')
source.scene.updateMatrixWorld(true)
const reports = []
let rightFrame, leftFrame
for (let lod = 0; lod < 3; lod++) {
  const path = `${dir}/lod${lod}.glb`, asset = readGlb(path), target = await loadRig(asset)
  if (target.animations.length) throw Error('Rebuild clean Paladin before retargeting')
  target.scene.updateMatrixWorld(true)
  const rest = new Map()
  target.scene.traverse(o => rest.set(o, { p: o.position.clone(), q: o.quaternion.clone() }))
  const reset = () => { for (const [o, t] of rest) { o.position.copy(t.p); o.quaternion.copy(t.q) }; target.scene.updateMatrixWorld(true) }
  // Frame transfer uses world anatomical directions, not coincident local bone names.
  const transfer = (frame, side) => {
    const from = source.scene.getObjectByName(`hand_${side}`), to = target.scene.getObjectByName(`hand_${side}`)
    const rotation = to.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(from.getWorldQuaternion(new THREE.Quaternion()))
    const dir = a => new THREE.Vector3(...a).applyQuaternion(rotation).toArray()
    const point = a => new THREE.Vector3(...a).multiplyScalar(1.6).applyQuaternion(rotation).toArray()
    return { ...frame, gripCenterLocal: point(frame.gripCenterLocal), gripAxisLocal: dir(frame.gripAxisLocal),
      palmNormalLocal: dir(frame.palmNormalLocal), fingerDirection: dir(frame.fingerDirection),
      wristCenter: point(frame.wristCenter), thumbBaseCenter: point(frame.thumbBaseCenter), fingerBase: frame.fingerBase * 1.6 }
  }
  if (lod === 0) {
    rightFrame = transfer(original.swordGripFrames.lod0, 'r')
    rightFrame.gripCenterLocal = [0, .115, -.065]
    const f = original.handGripFrames.left
    const converted = transfer({ gripCenterLocal: f.palmContactCenter, gripAxisLocal: f.thumbDirection,
      palmNormalLocal: f.palmNormal, fingerDirection: f.fingerDirection, wristCenter: f.wristCenter,
      thumbBaseCenter: f.thumbBaseCenter, fingerBase: f.fingerBase }, 'l')
    leftFrame = { palmContactCenter: converted.gripCenterLocal, palmNormal: converted.palmNormalLocal,
      thumbDir: 1, thumbDirection: converted.gripAxisLocal, fingerDirection: converted.fingerDirection,
      wristCenter: converted.wristCenter, thumbBaseCenter: converted.thumbBaseCenter, fingerBase: converted.fingerBase }
  }
  const clips = source.animations.map(clip => {
    reset()
    source.scene.updateMatrixWorld(true)
    const pairs = []
    target.scene.traverse(bone => {
      const from = source.scene.getObjectByName(bone.name)
      if (!bone.isBone || !from || !clip.tracks.some(t => t.name === `${bone.name}.quaternion`)) return
      pairs.push({ bone, from, inverse: from.getWorldQuaternion(new THREE.Quaternion()).invert(),
        rest: bone.getWorldQuaternion(new THREE.Quaternion()), values: [] })
    })
    const times = [...new Set(clip.tracks.flatMap(t => Array.from(t.times)))].sort((a, b) => a - b)
    const mixer = new THREE.AnimationMixer(source.scene), action = mixer.clipAction(clip)
    action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play()
    for (const time of times) {
      action.paused = false; mixer.setTime(time); source.scene.updateMatrixWorld(true)
      for (const p of pairs) {
        const q = p.from.getWorldQuaternion(new THREE.Quaternion()).multiply(p.inverse).multiply(p.rest)
        p.bone.quaternion.copy(p.bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q).normalize())
        p.bone.updateWorldMatrix(false, false)
        const out = p.bone.quaternion.clone()
        if (p.values.length && out.dot(new THREE.Quaternion().fromArray(p.values, p.values.length - 4)) < 0) out.set(-out.x, -out.y, -out.z, -out.w)
        p.values.push(...out.toArray())
      }
    }
    mixer.stopAllAction()
    return new THREE.AnimationClip(clip.name, clip.duration, pairs.map(p => new THREE.QuaternionKeyframeTrack(`${p.bone.name}.quaternion`, times, p.values)))
  })
  const meshes = []
  target.scene.traverse(o => { if (o.isSkinnedMesh) meshes.push(o) })
  reset()
  for (const mesh of meshes) mesh.skeleton.update()
  const soles = meshes.map(mesh => ({ mesh, indices: Array.from({ length: mesh.geometry.attributes.position.count }, (_, i) => i)
    .filter(i => { const p = new THREE.Vector3(); mesh.getVertexPosition(i, p); return p.applyMatrix4(mesh.matrixWorld).y < .20 }) }))
  for (const clip of clips) {
    if (clip.name === 'mounted' || clip.name === 'axeMountedIdle') continue
    reset()
    const mixer = new THREE.AnimationMixer(target.scene), action = mixer.clipAction(clip)
    action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play()
    const count = Math.ceil(clip.duration * 30), times = Array.from({ length: count + 1 }, (_, i) => i * clip.duration / count)
    const hips = target.scene.getObjectByName('hips'), values = [], point = new THREE.Vector3()
    const candidates = clip.name === 'death' ? meshes.map(mesh => ({ mesh, indices: Array.from({ length: mesh.geometry.attributes.position.count }, (_, i) => i) })) : soles
    for (const time of times) {
      hips.position.copy(rest.get(hips).p); action.paused = false; mixer.setTime(time); target.scene.updateMatrixWorld(true)
      for (const mesh of meshes) mesh.skeleton.update()
      let min = Infinity
      for (const { mesh, indices } of candidates) for (const i of indices) {
        mesh.getVertexPosition(i, point); min = Math.min(min, point.applyMatrix4(mesh.matrixWorld).y)
      }
      if (!Number.isFinite(min)) throw Error('No finite contact vertices')
      // Convert the world floor correction into the actual parent basis.
      const delta = new THREE.Vector3(0, -min + .003, 0).applyQuaternion(hips.parent.getWorldQuaternion(new THREE.Quaternion()).invert())
      values.push(...rest.get(hips).p.clone().add(delta).toArray())
    }
    mixer.stopAllAction()
    clip.tracks.push(new THREE.VectorKeyframeTrack('hips.position', times, values))
  }
  reset()
  const doc = asset.document, chunks = [asset.binary]; let offset = asset.binary.length
  function append(values, type) {
    const padding = (4 - offset % 4) % 4
    if (padding) { chunks.push(Buffer.alloc(padding)); offset += padding }
    const bytes = Buffer.from(values.buffer, values.byteOffset, values.byteLength), view = doc.bufferViews.length
    doc.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length }); chunks.push(bytes); offset += bytes.length
    const accessor = { bufferView: view, componentType: 5126, count: values.length / ({ SCALAR: 1, VEC3: 3, VEC4: 4 }[type]), type }
    if (type === 'SCALAR') { accessor.min = [values[0]]; accessor.max = [values.at(-1)] }
    doc.accessors.push(accessor); return doc.accessors.length - 1
  }
  doc.animations = clips.map(clip => {
    const channels = [], samplers = []
    for (const t of clip.tracks) {
      const [name, prop] = t.name.split('.'), node = doc.nodes.findIndex(n => n.name === name)
      if (node < 0) throw Error(name)
      channels.push({ sampler: samplers.length, target: { node, path: prop === 'position' ? 'translation' : 'rotation' } })
      samplers.push({ input: append(t.times, 'SCALAR'), output: append(t.values, prop === 'position' ? 'VEC3' : 'VEC4'), interpolation: 'LINEAR' })
    }
    return { name: clip.name, channels, samplers }
  })
  doc.buffers[0].byteLength = offset
  doc.asset.extras = { paladinSourceSha256: sources[0].sourceSha256, animationSourceSha256: hash(sourcePath) }
  fs.writeFileSync(path, encodeGlb(doc, Buffer.concat(chunks)))
  reports.push({ lod, triangles: measured.triangles[`lod${lod}`], drawCalls: meshes.length, joints: doc.skins[0].joints.length, textures: doc.images.length, animations: doc.animations.map(a => a.name), bytes: fs.statSync(path).size, sha256: hash(path) })
}
const manifest = { schemaVersion: 1, id: 'roman-hero-t4', status: 'ready', source: sources[0],
  attribution: 'Paladin by DJMaesen, CC-BY-4.0. Adapted for SagaBurst; original source linked in ATTRIBUTION.md.',
  modifications: ['Source skin retained; offline T-pose, metre normalization, LOD reduction and existing Roman T4 animation retarget',
    'Both source swords and scabbards removed from body; actual bastard sword exported as shared equipment'],
  metrics: { ...measured, overallHeightM: 1.95, textures: { lod0: 2048, lod1: 1024, lod2: 512 } }, files: { lod0: 'lod0.glb', lod1: 'lod1.glb', lod2: 'lod2.glb' },
  skeleton: 'project-humanoid-v1', boneMap: 'bone-map.json', audit: 'audit.json',
  handShapeMode: 'authored', handGripFrames: { left: leftFrame }, swordGripFrames: Object.fromEntries([0, 1, 2].map(i => [`lod${i}`, rightFrame])),
  animations: original.animations, animationSources: original.animationSources, axeAttackBuild: original.axeAttackBuild,
  animationRetarget: { source: 'ae06476:public/models/characters/v2/roman-hero-t4/lod0.glb', sha256: hash(sourcePath) }, attachmentOffsets: { corgiPelvis: [0, .09, 0] }, lodMeasurements: reports,
  fileSha256: Object.fromEntries(reports.map(r => [`lod${r.lod}`, r.sha256])) }
fs.writeFileSync(`${dir}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n')
fs.writeFileSync(`${dir}/audit.json`, JSON.stringify({ builder: 'tools/build-paladin.py + tools/retarget-paladin.mjs', lods: reports, visualAcceptance: 'Representative browser poses checked; full mounted ranged/contact and 200v200 GPU acceptance remains manual. See PR checklist.' }, null, 2) + '\n')
console.log(JSON.stringify(reports, null, 2))
