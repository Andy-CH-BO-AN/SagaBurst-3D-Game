import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readGlb, readAccessor, loadRig } from './lib/humanoid-glb.mjs'
import * as T from 'three'

async function verifyRomanArmRepair(original, current) {
  const a = original.document, b = current.document, same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  const moved = /^(upper_arm_[lr]|socket_hand_[lr])$/
  const nodes = a.nodes.length === b.nodes.length && a.nodes.every((node, i) => {
    const next = b.nodes[i]
    return moved.test(node.name) ? same({ ...node, translation: undefined }, { ...next, translation: undefined }) : same(node, next)
  })
  const meshes = a.meshes.length === b.meshes.length && a.meshes.every((mesh, i) => {
    const next = b.meshes[i]
    if (mesh.name !== 'Tunic_1') return same(mesh, next)
    const strip = mesh => ({ ...mesh, primitives: mesh.primitives.map(p => ({ ...p, attributes: undefined, indices: undefined })) })
    return same(strip(mesh), strip(next))
  })
  const expected = Buffer.from(original.binary)
  const mask = (index, rowStart = 0, rowCount) => {
    const ac = a.accessors[index], view = a.bufferViews[ac.bufferView]
    const count = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[ac.type]
    const size = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[ac.componentType] * count
    for (let row = rowStart; row < rowStart + (rowCount ?? ac.count); row++) {
      const start = (view.byteOffset ?? 0) + (ac.byteOffset ?? 0) + row * (view.byteStride ?? size)
      current.binary.copy(expected, start, start, start + size)
    }
  }
  for (const skin of a.skins) skin.joints.forEach((node, row) => {
    if (/^(upper_arm_|lower_arm_|hand_|socket_hand_)[lr]$/.test(a.nodes[node].name)) mask(skin.inverseBindMatrices, row, 1)
  })
  const mutableBounds = new Set()
  for (const mesh of a.meshes) if (['New_arms', 'Tunic_1', 'Armour_top', 'Wrist_guard1'].includes(mesh.name)) {
    for (const p of mesh.primitives) {
      mask(p.attributes.JOINTS_0); mask(p.attributes.WEIGHTS_0)
      if (mesh.name === 'Tunic_1' || mesh.name === 'Wrist_guard1') { mask(p.attributes.POSITION); mutableBounds.add(p.attributes.POSITION) }
    }
  }
  const payload = expected.equals(current.binary.subarray(0, expected.length))
    && same(a.bufferViews, b.bufferViews.slice(0, a.bufferViews.length))
    && a.accessors.every((ac, i) => mutableBounds.has(i)
      ? same({ ...ac, min: undefined, max: undefined }, { ...b.accessors[i], min: undefined, max: undefined }) : same(ac, b.accessors[i]))
  const before = await loadRig(original), after = await loadRig(current)
  before.scene.updateMatrixWorld(true); after.scene.updateMatrixWorld(true)
  const byName = new Map(); after.scene.traverse(o => { if (o.isSkinnedMesh) { o.skeleton.update(); byName.set(o.name, o) } })
  let unchangedAnatomy = true
  before.scene.traverse(o => {
    if (!o.isSkinnedMesh || /^(Tunic_1|Wrist_guard1)/.test(o.name)) return
    o.skeleton.update(); const next = byName.get(o.name)
    if (!next || o.geometry.attributes.position.count !== next.geometry.attributes.position.count) { unchangedAnatomy = false; return }
    for (let i = 0; i < o.geometry.attributes.position.count; i++) {
      const p = o.applyBoneTransform(i, new T.Vector3().fromBufferAttribute(o.geometry.attributes.position, i))
      const q = next.applyBoneTransform(i, new T.Vector3().fromBufferAttribute(next.geometry.attributes.position, i))
      if (p.distanceTo(q) > 1e-5) unchangedAnatomy = false
    }
  })
  const sockets = ['socket_hand_l', 'socket_hand_r'].every(name => before.scene.getObjectByName(name).getWorldPosition(new T.Vector3())
    .distanceTo(after.scene.getObjectByName(name).getWorldPosition(new T.Vector3())) < 1e-5)
  return { structure: nodes && meshes && ['skins', 'materials', 'images'].every(key => same(a[key], b[key])), payload, unchangedAnatomy, sockets }
}

const baseRef = process.argv[2] ?? 'origin/dev'
const rows = []
for (const faction of ['roman', 'roman-hero-t4', 'viking', 'viking-hero-t4']) for (let lod = 0; lod < 3; lod++) {
  const path = `public/models/characters/v2/${faction}/lod${lod}.glb`
  const bytes = execFileSync('rtk', ['proxy', 'git', 'show', `${baseRef}:${path}`], { maxBuffer: 64 * 1024 * 1024 })
  const length = bytes.readUInt32LE(12)
  const original = { document: JSON.parse(bytes.toString('utf8', 20, 20 + length)), binary: bytes.subarray(28 + length) }
  const current = readGlb(path)
  const armRepair = faction.startsWith('roman') && current.document.asset.extras.romanArmBind
    ? await verifyRomanArmRepair(original, current) : undefined
  const skeleton = armRepair ? armRepair.structure && armRepair.sockets
    : ['nodes', 'skins', 'meshes', 'materials', 'images'].every(key => JSON.stringify(original.document[key]) === JSON.stringify(current.document[key]))
  const bowLodRepair = faction === 'viking' && lod > 0 && current.document.asset.extras.bowLodBuild
  // Bow retargeting repacks animation accessors; immutable geometry/skin/image
  // bytes remain before the existing upstream checkpoint. Every other clip is
  // compared by actual samples below, independently of its new byte offset.
  const immutableLength = bowLodRepair
    ? original.document.asset.extras.humanoidAnimationBuild.baseBufferByteLength : original.binary.length
  const base = original.document.asset.extras?.humanoidAnimationBuild
  const geometry = armRepair ? armRepair.payload && armRepair.unchangedAnatomy : original.binary.subarray(0, immutableLength).equals(current.binary.subarray(0, immutableLength))
    && (!bowLodRepair || (JSON.stringify(original.document.accessors.slice(0, base.baseAccessorCount))
      === JSON.stringify(current.document.accessors.slice(0, base.baseAccessorCount))
      && JSON.stringify(original.document.bufferViews.slice(0, base.baseBufferViewCount))
      === JSON.stringify(current.document.bufferViews.slice(0, base.baseBufferViewCount))))
  const existingClips = original.document.animations.every(a => {
    // The independent bow LOD repair is verified against authority hand contacts.
    if (bowLodRepair
      && ['bowLoad', 'bowHold', 'bowRelease'].includes(a.name)) return true
    const b = current.document.animations.find(b => a.name === b.name)
    return b && a.samplers.length === b.samplers.length && JSON.stringify(a.channels) === JSON.stringify(b.channels) && a.samplers.every((s, i) => {
      const t = b.samplers[i]
      return (s.interpolation ?? 'LINEAR') === (t.interpolation ?? 'LINEAR') && ['input', 'output'].every(key => Buffer.from(readAccessor(original, s[key]).buffer).equals(Buffer.from(readAccessor(current, t[key]).buffer)))
    })
  })
  const manifest = JSON.parse(fs.readFileSync(`public/models/characters/v2/${faction}/manifest.json`))
  const hash = createHash('sha256').update(fs.readFileSync(path)).digest('hex') === manifest.fileSha256[`lod${lod}`]
  const axes = ['axeAttack1H', 'axeAttack2H'].every(name => {
    const clip = current.document.animations.find(c => c.name === name)
    return clip && clip.channels.length > 0
      && (original.document.animations.some(a => a.name === name) || clip.channels.every(c => c.target.path === 'rotation'))
      && clip.samplers.every(s => [...readAccessor(current, s.output)].every(Number.isFinite))
  })
  rows.push({ faction, lod, skeleton, geometry, armRepair, existingClips, manifestHash: hash, finiteAxeClipsAndRotationOnlyAdditions: axes })
  if (!skeleton || !geometry || !existingClips || !hash || !axes) process.exitCode = 1
}
fs.mkdirSync('output/axe', { recursive: true })
fs.writeFileSync('output/axe/asset-preservation.json', JSON.stringify({ baseRef, rows }, null, 2))
console.log(JSON.stringify(rows, null, 2))
