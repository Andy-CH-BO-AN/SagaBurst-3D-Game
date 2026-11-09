/** Build public/models/characters/v2/byzantine-cataphract-t5 from the user-supplied Meshy Mixamo GLB.
 *   node tools/build-byzantine-cataphract.mjs <Byzantine_Warrior...animated_mixamo_All_animation.glb> [outDir]
 * Mesh, UVs and materials are retained; thigh skin weight above the hip joint moves to the pelvis. Only the 0.01 Armature scale is baked into the joints,
 * textures are resampled per LOD (macOS `sips`), and the clip set is assembled:
 *   native   Walking→walk, Running→run, Left_Slash(trimmed)→swordSlash, Punch_Combo_1→punchCombo
 *   composed punchRight (right-fist punches of the same take, left arm is owned by the shield pose)
 *   donor    idle, bow*, pilumThrow, axe* retargeted from roman-hero-t5 by bone direction (see lib). */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import * as T from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { readGlb, loadRig } from './lib/humanoid-glb.mjs'
const meshoptLoader = () => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
import { bakeArmatureScale, assembleGlb, reweightWaist } from './lib/byzantine-bake.mjs'
import { createRetargeter, PROJECT_NAMES } from './lib/mixamo-direction-retarget.mjs'

const source = process.argv[2]
if (!source) throw new Error('Usage: node tools/build-byzantine-cataphract.mjs <source.glb> [outDir]')
const out = process.argv[3] ?? 'public/models/characters/v2/byzantine-cataphract-t5'
const DONOR = 'public/models/characters/v2/roman-hero-t5'
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const docName = bone => bone === 'headfront' ? bone : `mixamorig:${bone}`
const q4 = (a, i) => new T.Quaternion(a[i], a[i + 1], a[i + 2], a[i + 3])

const sourceBytes = fs.readFileSync(source)
const asset = readGlb(source), baked = bakeArmatureScale(asset)
// Thigh pivot is y=.964: the waist above it follows the pelvis, the skirt below keeps the thighs.
console.log('waist vertices reweighted:', reweightWaist(baked, .86, .97))
const bakedAsset = { document: baked.document, binary: baked.binary }
const native = await loadRig(bakedAsset), fk = await loadRig(bakedAsset), reference = await loadRig(bakedAsset)
const donorAsset = readGlb(`${DONOR}/lod0.glb`), donor = await loadRig(donorAsset)
const donorManifest = JSON.parse(fs.readFileSync(`${DONOR}/manifest.json`, 'utf8'))
const stanceAsset = readGlb('public/models/characters/v2/roman-hero-t4/lod0.glb'), stance = await loadRig(stanceAsset, meshoptLoader())
const stanceManifest = JSON.parse(fs.readFileSync('public/models/characters/v2/roman-hero-t4/manifest.json', 'utf8'))

// Anatomical hand frames. The bind is a T-pose with palms down and thumbs forward (measured: the thumb vertices
// sit at +Z on both hands), which reproduces roman-hero-t4's hand-local axes on this same Mixamo basis.
const KNUCKLE = .10, GRIP_HEIGHT = .036
function handFrame(side) {
  const hand = reference.scene.getObjectByName(`mixamorig${side}Hand`), fore = reference.scene.getObjectByName(`mixamorig${side}ForeArm`)
  reference.scene.updateMatrixWorld(true)
  const q = hand.getWorldQuaternion(new T.Quaternion()).invert()
  const finger = hand.getWorldPosition(new T.Vector3()).sub(fore.getWorldPosition(new T.Vector3())).normalize().applyQuaternion(q)
  const thumb = new T.Vector3(0, 0, 1).applyQuaternion(q); thumb.addScaledVector(finger, -thumb.dot(finger)).normalize()
  const palm = new T.Vector3(0, -1, 0).applyQuaternion(q); palm.addScaledVector(finger, -palm.dot(finger)); palm.addScaledVector(thumb, -palm.dot(thumb)).normalize()
  return { finger: finger.toArray(), thumb: thumb.toArray(), palm: palm.toArray(),
    center: finger.clone().multiplyScalar(KNUCKLE).addScaledVector(palm, GRIP_HEIGHT).toArray() }
}
const targetFrames = { Left: handFrame('Left'), Right: handFrame('Right') }
const framesOf = m => ({
  Left: { finger: m.handGripFrames.left.fingerDirection, thumb: m.handGripFrames.left.thumbDirection, palm: m.handGripFrames.left.palmNormal },
  Right: { finger: m.swordGripFrames.lod0.fingerDirection, thumb: m.swordGripFrames.lod0.gripAxisLocal, palm: m.swordGripFrames.lod0.palmNormalLocal },
})
const retargeter = createRetargeter(donor.scene, reference.scene, { frames: { donor: framesOf(donorManifest), target: targetFrames } })
const stanceRetargeter = createRetargeter(stance.scene, reference.scene, { donorName: name => PROJECT_NAMES[name], frames: { donor: framesOf(stanceManifest), target: targetFrames } })
const { bones } = retargeter
const restToe = {}, restFoot = {}
for (const side of ['Left', 'Right']) {
  restToe[side] = reference.scene.getObjectByName(`mixamorig${side}ToeBase`).getWorldPosition(new T.Vector3()).y
  restFoot[side] = reference.scene.getObjectByName(`mixamorig${side}Foot`).getWorldPosition(new T.Vector3()).y
}

// ---- helpers ---------------------------------------------------------------------------------
function trackSet(times, locals, hips) {
  const tracks = bones.map(bone => ({ node: docName(bone), path: 'rotation', times, values: locals[bone].flatMap(q => q.toArray()) }))
  tracks.push({ node: 'headfront', path: 'rotation', times, values: times.flatMap(() => reference.scene.getObjectByName('headfront').quaternion.toArray()) })
  tracks.push({ node: docName('Hips'), path: 'translation', times, values: hips.flatMap(p => p.toArray()) })
  return tracks
}
function continuity(list) { for (let i = 1; i < list.length; i++) if (list[i].dot(list[i - 1]) < 0) list[i].set(-list[i].x, -list[i].y, -list[i].z, -list[i].w) }
function groundOffset(times, locals, hips) {
  // Pose the unanimated target with the generated rotations and find how far the lowest sole point sits from rest.
  const nodes = Object.fromEntries(bones.map(b => [b, fk.scene.getObjectByName(`mixamorig${b}`)]))
  const clearance = []
  times.forEach((_, i) => {
    for (const b of bones) nodes[b].quaternion.copy(locals[b][i])
    nodes.Hips.position.copy(hips[i]); fk.scene.updateMatrixWorld(true)
    let low = Infinity
    for (const side of ['Left', 'Right']) {
      low = Math.min(low, nodes[`${side}ToeBase`].getWorldPosition(new T.Vector3()).y - restToe[side], nodes[`${side}Foot`].getWorldPosition(new T.Vector3()).y - restFoot[side])
    }
    clearance.push(low)
  })
  return clearance
}
function applyGround(times, locals, hips, label) {
  const clearance = groundOffset(times, locals, hips)
  const lift = -Math.min(...clearance)
  hips.forEach((p, i) => { p.y += lift + Math.max(0, -(clearance[i] + lift) - 0.01) })
  console.log(`${label}: grounded by ${(lift * 1000).toFixed(1)} mm`)
}
function retarget(clipName, source = donor, solver = retargeter) {
  const clip = source.animations.find(c => c.name === clipName)
  if (!clip) throw new Error(`Donor has no ${clipName}`)
  const mixer = new T.AnimationMixer(source.scene); mixer.clipAction(clip).play()
  const set = new Set([0, clip.duration])
  for (const track of clip.tracks) for (const t of track.times) set.add(Math.round(t * 1e6) / 1e6)
  const times = [...set].sort((a, b) => a - b), locals = Object.fromEntries(bones.map(b => [b, []])), hips = []
  for (const t of times) {
    mixer.setTime(t)
    const pose = solver.pose()
    for (const b of bones) locals[b].push(pose.local[b].clone())
    hips.push(pose.hips)
  }
  mixer.stopAllAction()
  for (const b of bones) continuity(locals[b])
  return { name: clipName, duration: clip.duration, times, locals, hips }
}
function nativeClip(name, start = 0, end = Infinity) {
  const clip = native.animations.find(c => c.name === name)
  const times = [], locals = Object.fromEntries(bones.map(b => [b, []])), hips = []
  const fps = 60, last = Math.min(clip.duration, end)
  const mixer = new T.AnimationMixer(native.scene); mixer.clipAction(clip).play()
  const nodes = Object.fromEntries(bones.map(b => [b, native.scene.getObjectByName(`mixamorig${b}`)]))
  const count = Math.round((last - start) * fps)
  for (let i = 0; i <= count; i++) {
    const t = start + i / fps
    mixer.setTime(Math.min(t, last)); native.scene.updateMatrixWorld(true)
    times.push(i / fps)
    for (const b of bones) locals[b].push(nodes[b].quaternion.clone())
    // Source position tracks are in the pre-bake (centimetre) space.
    hips.push(nodes.Hips.position.clone().multiplyScalar(baked.scale))
  }
  mixer.stopAllAction()
  for (const b of bones) continuity(locals[b])
  return { name, duration: times.at(-1), times, locals, hips, mixerClip: clip }
}
function handPositions(clipData, hand) {
  const nodes = Object.fromEntries(bones.map(b => [b, fk.scene.getObjectByName(`mixamorig${b}`)]))
  const chest = nodes.Spine2
  return clipData.times.map((_, i) => {
    for (const b of bones) nodes[b].quaternion.copy(clipData.locals[b][i])
    nodes.Hips.position.copy(clipData.hips[i]); fk.scene.updateMatrixWorld(true)
    return nodes[hand].getWorldPosition(new T.Vector3()).sub(chest.getWorldPosition(new T.Vector3()))
  })
}
function peaks(clipData, hand) {
  const z = handPositions(clipData, `${hand}Hand`).map(p => p.z), result = []
  for (let i = 2; i < z.length - 2; i++) if (z[i] > .5 && z[i] >= z[i - 1] && z[i] > z[i + 1] && z[i] >= z[i - 2] && z[i] > z[i + 2]) result.push(clipData.times[i])
  return result
}
function slice(clipData, start, end) {
  const keep = clipData.times.map((t, i) => [t, i]).filter(([t]) => t >= start - 1e-9 && t <= end + 1e-9).map(([, i]) => i)
  return { ...clipData, times: keep.map(i => clipData.times[i] - clipData.times[keep[0]]), hips: keep.map(i => clipData.hips[i].clone()),
    locals: Object.fromEntries(bones.map(b => [b, keep.map(i => clipData.locals[b][i].clone())])) }
}
function composePunches(segments, overlap) {
  // Lay segments end to start with a smooth cross-fade over `overlap` seconds.
  const fps = 60, sampled = segments.map(s => ({ ...s, length: s.times.at(-1) }))
  const starts = []; let cursor = 0
  for (const s of sampled) { starts.push(cursor); cursor += s.length - overlap }
  const total = starts.at(-1) + sampled.at(-1).length, count = Math.round(total * fps)
  const times = [], locals = Object.fromEntries(bones.map(b => [b, []])), hips = []
  const at = (s, t, arr) => { // linear sample of a sliced clip (arr is quaternion[] or Vector3[])
    const u = Math.min(Math.max(t, 0), s.length) * fps, i = Math.min(Math.floor(u), s.times.length - 2), f = u - i
    return arr[i].clone().lerp ? arr[i].clone().lerp(arr[i + 1], f) : arr[i].clone().slerp(arr[i + 1], f)
  }
  for (let n = 0; n <= count; n++) {
    const t = n / fps; times.push(t)
    const active = sampled.map((s, k) => [s, k, t - starts[k]]).filter(([s, , local]) => local >= -1e-9 && local <= s.length + 1e-9)
    const [a, b] = active.length > 1 ? [active[active.length - 2], active[active.length - 1]] : [active[0], null]
    let w = 0
    if (b) { w = Math.min(1, Math.max(0, b[2] / overlap)); w = w * w * (3 - 2 * w) }
    for (const bone of bones) {
      const qa = at(a[0], a[2], a[0].locals[bone])
      locals[bone].push(b ? qa.slerp(at(b[0], b[2], b[0].locals[bone]), w) : qa)
    }
    const pa = at(a[0], a[2], a[0].hips)
    hips.push(b ? pa.lerp(at(b[0], b[2], b[0].hips), w) : pa)
  }
  for (const bone of bones) continuity(locals[bone])
  return { times, locals, hips, starts, total }
}
function stride(clipData) {
  // Planted foot speed relative to the pelvis, forward being +Z.
  const nodes = Object.fromEntries(bones.map(b => [b, fk.scene.getObjectByName(`mixamorig${b}`)]))
  const feet = clipData.times.map((_, i) => {
    for (const b of bones) nodes[b].quaternion.copy(clipData.locals[b][i])
    nodes.Hips.position.copy(clipData.hips[i]); fk.scene.updateMatrixWorld(true)
    const rows = ['Left', 'Right'].map(s => nodes[`${s}Foot`].getWorldPosition(new T.Vector3()))
    return rows
  })
  let sum = 0, n = 0
  for (let i = 1; i < feet.length; i++) {
    const dt = clipData.times[i] - clipData.times[i - 1]
    const planted = feet[i][0].y < feet[i][1].y ? 0 : 1
    if (feet[i][planted].y > restFoot.Left + .12) continue
    sum += -(feet[i][planted].z - feet[i - 1][planted].z) / dt; n++
  }
  console.log('stride samples', n, 'min foot y', Math.min(...feet.map(f => Math.min(f[0].y, f[1].y))).toFixed(3))
  return n ? sum / n : NaN
}

// ---- clip assembly ---------------------------------------------------------------------------
const clips = [], bindings = []
const add = (name, data, binding) => {
  clips.push({ name, tracks: trackSet(data.times, data.locals, data.hips) })
  bindings.push({ clip: name, ...binding, duration: data.times.at(-1) })
}
// Warrior stance: the Paladin's bent-knee idle, same Mixamo basis.
const idle = retarget('idle', stance, stanceRetargeter); applyGround(idle.times, idle.locals, idle.hips, 'idle')
add('idle', idle, { source: 'Kevin Iglesias', sourceClip: 'idle', loop: true, retargetedFrom: 'roman-hero-t4' })
// Mounted upper body: the saddle masks the pelvis, so transfer the stance's pelvis tilt onto the spine and keep the torso upright.
{
  const hipsRest = reference.scene.getObjectByName('mixamorigHips').quaternion.clone().invert()
  const upper = bones.filter(b => !/(UpLeg|Leg|Foot|ToeBase)$/.test(b) && b !== 'Hips')
  const locals = Object.fromEntries(upper.map(b => [b, idle.locals[b].map(q => q.clone())]))
  locals.Spine = idle.locals.Spine.map((q, i) => hipsRest.clone().multiply(idle.locals.Hips[i]).multiply(q).normalize())
  clips.push({ name: 'mounted', tracks: upper.map(b => ({ node: docName(b), path: 'rotation', times: idle.times, values: locals[b].flatMap(q => q.toArray()) })) })
  bindings.push({ clip: 'mounted', source: 'Kevin Iglesias', sourceClip: 'idle', loop: true, retargetedFrom: 'roman-hero-t4', duration: idle.times.at(-1) })
}
const walk = nativeClip('Walking'), run = nativeClip('Running')
const walkSpeed = stride(walk), runSpeed = stride(run)
console.log('measured planted-foot speed (m/s, rig scale 1):', walkSpeed.toFixed(2), runSpeed.toFixed(2))
add('walk', walk, { source: 'Meshy', sourceClip: 'Walking', loop: true, nominalSpeed: 2 })
add('run', run, { source: 'Meshy', sourceClip: 'Running', loop: true, nominalSpeed: 4 })
// Left_Slash: the wind-up, first strike and recovery; speed peaks at 0.80 s.
const slashFull = nativeClip('Left_Slash'), slash = slice(slashFull, .40, 1.10)
add('swordSlash', slash, { source: 'Meshy', sourceClip: 'Left_Slash', loop: false, sourceRange: [.40, 1.10], meleeCycleSeconds: .48,
  events: { activeStart: .30, hit: .40, activeEnd: .55, actionComplete: slash.times.at(-1) } })
const punch = nativeClip('Punch_Combo_1')
const left = peaks(punch, 'Left'), right = peaks(punch, 'Right')
if (left.length !== 2 || right.length !== 2) throw new Error(`Expected two punches per hand, got L${left} R${right}`)
const contacts = [...left.map(time => ({ time, hand: 'left' })), ...right.map(time => ({ time, hand: 'right' }))].sort((a, b) => a.time - b.time)
add('punchCombo', punch, { source: 'Meshy', sourceClip: 'Punch_Combo_1', loop: false,
  events: { ...Object.fromEntries(contacts.map((c, i) => [`punch${i}`, c.time])), actionComplete: punch.times.at(-1) }, punchHands: contacts.map(c => c.hand) })
// Shield stance: right-fist punches only. Wind-up starts where the right hand is furthest back.
const segA = slice(punch, right[0] - .283, right[0] + .117), segB = slice(punch, right[1] - .234, right[1] + .183)
const ov = .10, composed = composePunches([segA, segB, segA, segB], ov)
const rightContacts = [right[0] - (right[0] - .283) + composed.starts[0], right[1] - (right[1] - .234) + composed.starts[1],
  right[0] - (right[0] - .283) + composed.starts[2], right[1] - (right[1] - .234) + composed.starts[3]]
add('punchRight', composed, { source: 'Meshy', sourceClip: 'Punch_Combo_1', loop: false,
  events: { punch0: rightContacts[0], punch1: rightContacts[1], punch2: rightContacts[2], punch3: rightContacts[3], actionComplete: composed.times.at(-1) },
  punchHands: ['right', 'right', 'right', 'right'], composition: 'right-fist segments of Punch_Combo_1, cross-faded' })
const donorBinding = clip => donorManifest.animations.embedded.find(b => b.clip === clip)
for (const name of ['bowLoad', 'bowHold', 'bowRelease', 'pilumThrow', 'axeMountedIdle', 'axeAttack1H', 'axeAttack2H']) {
  const data = retarget(name); applyGround(data.times, data.locals, data.hips, name)
  const b = donorBinding(name)
  const { clip: _clip, duration: _duration, ...rest } = b
  add(name, data, { ...rest, retargetedFrom: 'roman-hero-t5' })
}

// ---- metrics ---------------------------------------------------------------------------------
const ref = await loadRig(readGlb('public/models/characters/v2/roman-hero-t4/lod0.glb'), meshoptLoader())
ref.scene.updateMatrixWorld(true); reference.scene.updateMatrixWorld(true)
const landmarks = [['hips', 'mixamorigHips'], ['upper_arm_l', 'mixamorigLeftArm'], ['upper_arm_r', 'mixamorigRightArm']].map(([name, bone]) => ({
  name, source: reference.scene.getObjectByName(bone).getWorldPosition(new T.Vector3()).y, reference: ref.scene.getObjectByName(name).getWorldPosition(new T.Vector3()).y }))
const scale = landmarks.reduce((s, p) => s + p.source * p.reference, 0) / landmarks.reduce((s, p) => s + p.source * p.source, 0)
const box = new T.Box3(); reference.scene.traverse(o => { if (o.isSkinnedMesh) { const v = new T.Vector3(); for (let i = 0; i < o.geometry.attributes.position.count; i++) { o.getVertexPosition(i, v); box.expandByPoint(v) } } })
const pos = name => reference.scene.getObjectByName(name).getWorldPosition(new T.Vector3())
const triangles = asset.document.meshes.flatMap(m => m.primitives).reduce((s, p) => s + asset.document.accessors[p.indices].count / 3, 0)
const metrics = { heightM: (box.max.y - box.min.y) * scale, shoulderWidthM: pos('mixamorigLeftArm').distanceTo(pos('mixamorigRightArm')) * scale + .15,
  neckLengthM: pos('mixamorigNeck').distanceTo(pos('mixamorigHead')) * scale, triangles: { lod0: triangles, lod1: triangles, lod2: triangles },
  textures: { lod0: 2048, lod1: 1024, lod2: 512 }, uniformScale: scale, bodyLandmarks: landmarks }

for (const [clip, speed] of [['walk', walkSpeed], ['run', runSpeed]]) bindings.find(b => b.clip === clip).nominalSpeed = +(speed * scale).toFixed(2)

// ---- textures + LODs -------------------------------------------------------------------------
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'byz-'))
const images = asset.document.images.map((image, i) => {
  const view = asset.document.bufferViews[image.bufferView]
  const file = path.join(scratch, `source-${i}.jpg`)
  fs.writeFileSync(file, asset.binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength)); return file
})
const resized = (size, i) => {
  const output = path.join(scratch, `${size}-${i}.jpg`)
  execFileSync('sips', ['-Z', String(size), '-s', 'format', 'jpeg', '-s', 'formatOptions', '88', images[i], '--out', output], { stdio: 'ignore' })
  return fs.readFileSync(output)
}
fs.mkdirSync(out, { recursive: true })
const fileSha256 = {}
for (const [lod, size] of [[0, 2048], [1, 1024], [2, 512]]) {
  const bytes = assembleGlb(baked, clips, images.map((_, i) => resized(size, i)))
  fs.writeFileSync(path.join(out, `lod${lod}.glb`), bytes); fileSha256[`lod${lod}`] = sha(bytes)
  console.log(`lod${lod}.glb`, (bytes.length / 1e6).toFixed(2), 'MB')
}

// ---- grip frames: weapon axis runs through the wrapped fingers' curl centre ---------------------
const LANCE_RADIUS = .022
const rightFrame = { gripCenterLocal: targetFrames.Right.center, gripAxisLocal: targetFrames.Right.thumb, palmNormalLocal: targetFrames.Right.palm,
  fingerDirection: targetFrames.Right.finger, wristCenter: [0, 0, 0], thumbBaseCenter: targetFrames.Right.finger.map(v => v * .045), fingerBase: KNUCKLE, gripRadius: .019 }
const L = targetFrames.Left
const leftFrame = { palmContactCenter: L.center.map((v, i) => v - L.palm[i] * LANCE_RADIUS), palmNormal: L.palm, thumbDir: 1, thumbDirection: L.thumb,
  fingerDirection: L.finger, wristCenter: [0, 0, 0], fingerBase: KNUCKLE, thumbBaseCenter: L.finger.map(v => v * .045) }

const manifest = {
  schemaVersion: 1, id: 'byzantine-cataphract-t5', status: 'ready', skeleton: 'project-humanoid-v1',
  source: { title: 'Byzantine Warrior (Mixamo-rigged)', sourceFile: path.basename(source), sourceSha256: sha(sourceBytes),
    license: 'Owner-supplied Meshy model; project animation sources retain their original terms', licenseEvidence: 'ATTRIBUTION.md' },
  attribution: 'Byzantine Warrior: user-supplied Meshy model, textures and Walking / Running / Left_Slash / Punch_Combo_1. Idle, bow, pilum and axe clips are retargeted from roman-hero-t5 (project-licensed Kevin Iglesias and Quaternius sources; see that asset).',
  selectedSource: { rig: 'mixamo24', uniformScale: scale, seatBearing: [[-.082, .897, -.057], [.082, .897, -.057]] },
  handShapeMode: 'authored', preserveLodHandTopology: true,
  files: { lod0: 'lod0.glb', lod1: 'lod1.glb', lod2: 'lod2.glb' }, fileSha256, metrics,
  animations: { embedded: bindings, runtimeGenerated: ['death', 'hit', 'daggerSlash', 'greatswordSlash', 'lanceThrust', 'mountedLance'] },
  handGripFrames: { left: leftFrame },
  swordGripFrames: { lod0: rightFrame, lod1: rightFrame, lod2: rightFrame },
  bakedSource: { armatureScaleBaked: baked.scale, note: 'Joint translations, inverse binds and position tracks multiplied by the Armature scale; positions and UVs unchanged. Thigh skin weight above the hip joint moved to the pelvis (waist collapsed when seated).' },
  visualAcceptance: 'See PR #444 for the hero-preview close-up results.',
  knownLimitations: ['Source rig has no finger bones: runtime morphs (MittenHandShape) curl the mitten hands.', 'Idle / bow / pilum / axe clips are direction-retargeted from roman-hero-t5.', 'Shield stance punchRight is composed from right-fist segments of Punch_Combo_1.'],
}
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log('metrics', { height: metrics.heightM, shoulder: metrics.shoulderWidthM, neck: metrics.neckLengthM, scale })
console.log('punch contacts', contacts, 'right-only', rightContacts, 'slash', slash.times.at(-1))
fs.rmSync(scratch, { recursive: true, force: true })
