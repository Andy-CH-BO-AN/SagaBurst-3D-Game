/** Build the Viking heavy-armour heroes (Dragon Oathguard T4, Ironblood Warlord T5) from the owner-supplied
 * Meshy Mixamo24 GLBs. Same route as tools/build-byzantine-cataphract.mjs (Mixamo24, fingerless, 0.01 Armature):
 *   node tools/build-viking-heavy-heroes.mjs <downloads-dir> [assetId]
 * - The 0.01 Armature scale is baked into joint translations, inverse binds and position tracks (lib/byzantine-bake).
 * - LOD0 keeps the source mesh, UV and index bytes; only thigh weight above the hip pivot moves to the pelvis.
 * - LOD1/LOD2 are Blender collapse-decimated copies of that same skinned surface (tools/simplify-replacement-humanoids.py),
 *   limited to four influences per vertex so the stock skinning shader is kept.
 * - Clips: Walking/Running are native; idle (Paladin stance) and every combat clip are direction-retargeted
 *   (lib/mixamo-direction-retarget) from roman-hero-t4 / roman-hero-t5 with their event metadata; the foot one-hand axe
 *   attack (axeAttack1HFoot) is the donor's Bandit@attack clip.
 *   Hit and death stay runtime-generated, as on the Byzantine Mixamo24 asset. */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import * as T from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { readGlb, loadRig } from './lib/humanoid-glb.mjs'
import { bakeArmatureScale, assembleGlb, reweightWaist } from './lib/byzantine-bake.mjs'
import { createRetargeter, PROJECT_NAMES } from './lib/mixamo-direction-retarget.mjs'

const DEFINITIONS = [
  { id: 'viking-heavy-hero-t4', title: 'Viking Warrior Rigged (Dragon Oathguard)', nameEn: 'Dragon Oathguard',
    file: 'Meshy_AI_Viking_Warrior_Rigged_20261107_animated_mixamo_All_animation.glb',
    sha: '1c0773c314f64203dee2290bf2a95864aed1f531c863b2691a670fb5d595638b', lodTriangles: [15000, 6000] },
  { id: 'viking-heavy-hero-t5', title: 'Viking Warrior Rigged (Ironblood Warlord)', nameEn: 'Ironblood Warlord',
    file: 'Meshy_AI_VikingWarriorRigged_20261107_animated_mixamo_All_animation.glb',
    sha: '55f9357fafbe58f399d582caf730f7338c64660e6fc3ca06f8c9f6d26c0e62a6', lodTriangles: [15000, 6000] },
]
const RIGHTS = 'Owner-supplied Meshy asset; the repository owner supplied this file and requested its integration into SagaBurst on 2026-11-10'
const [root, only] = process.argv.slice(2)
if (!root) throw new Error('Usage: node tools/build-viking-heavy-heroes.mjs <downloads-dir> [assetId]')
const selected = DEFINITIONS.filter(def => !only || def.id === only)
if (!selected.length) throw new Error(`Unknown asset ${only}`)
const BLENDER = process.env.BLENDER ?? (process.platform === 'darwin' ? '/Applications/Blender.app/Contents/MacOS/Blender' : 'blender')
const COMBAT_DONOR = 'public/models/characters/v2/roman-hero-t5'
const STANCE_DONOR = 'public/models/characters/v2/roman-hero-t4'
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const docName = bone => bone === 'headfront' ? bone : `mixamorig:${bone}`
const meshoptLoader = () => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)

const donorAsset = readGlb(`${COMBAT_DONOR}/lod0.glb`)
const donorManifest = JSON.parse(fs.readFileSync(`${COMBAT_DONOR}/manifest.json`, 'utf8'))
const stanceAsset = readGlb(`${STANCE_DONOR}/lod0.glb`)
const stanceManifest = JSON.parse(fs.readFileSync(`${STANCE_DONOR}/manifest.json`, 'utf8'))
const framesOf = m => ({
  Left: { finger: m.handGripFrames.left.fingerDirection, thumb: m.handGripFrames.left.thumbDirection, palm: m.handGripFrames.left.palmNormal },
  Right: { finger: m.swordGripFrames.lod0.fingerDirection, thumb: m.swordGripFrames.lod0.gripAxisLocal, palm: m.swordGripFrames.lod0.palmNormalLocal },
})
const continuity = list => { for (let i = 1; i < list.length; i++) if (list[i].dot(list[i - 1]) < 0) list[i].set(-list[i].x, -list[i].y, -list[i].z, -list[i].w) }

for (const def of selected) await build(def)

async function build(def) {
  const out = `public/models/characters/v2/${def.id}`
  const sourcePath = path.join(root, def.file), sourceBytes = fs.readFileSync(sourcePath)
  if (sha(sourceBytes) !== def.sha) throw new Error(`Unexpected ${def.file}`)
  const asset = readGlb(sourcePath), baked = bakeArmatureScale(asset)
  if (asset.document.skins[0].joints.length !== 24) throw new Error(`${def.id}: expected the Mixamo24 skin`)
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), `${def.id}-`))

  // Hip pivot measured on the baked rig; the waist band sits on it the way the Byzantine band sat on its own (.86–.97 for .964).
  const pre = await loadRig({ document: baked.document, binary: baked.binary }); pre.scene.updateMatrixWorld(true)
  const pivot = ['Left', 'Right'].reduce((s, side) => s + pre.scene.getObjectByName(`mixamorig${side}UpLeg`).getWorldPosition(new T.Vector3()).y, 0) / 2
  const waist = reweightWaist(baked, pivot - .104, pivot + .006)
  console.log(def.id, 'thigh pivot', pivot.toFixed(3), 'waist vertices reweighted:', waist)
  const bakedAsset = { document: baked.document, binary: baked.binary }
  const native = await loadRig(bakedAsset), fk = await loadRig(bakedAsset), reference = await loadRig(bakedAsset)
  const donor = await loadRig(donorAsset), stance = await loadRig(stanceAsset, meshoptLoader())
  reference.scene.updateMatrixWorld(true)

  // Anatomical hand frames from this bind. Thumb side is measured from the hand-weighted vertices, never assumed.
  const KNUCKLE = .10, GRIP_HEIGHT = .036
  const skinned = []; reference.scene.traverse(o => { if (o.isSkinnedMesh) skinned.push(o) })
  const body = skinned[0]
  const thumbSide = side => {
    const hand = reference.scene.getObjectByName(`mixamorig${side}Hand`), fore = reference.scene.getObjectByName(`mixamorig${side}ForeArm`)
    const handIndex = body.skeleton.bones.indexOf(hand), axis = hand.getWorldPosition(new T.Vector3()).sub(fore.getWorldPosition(new T.Vector3())).normalize()
    const origin = hand.getWorldPosition(new T.Vector3()), skinIndex = body.geometry.attributes.skinIndex, skinWeight = body.geometry.attributes.skinWeight, v = new T.Vector3()
    let forward = 0, back = 0
    for (let i = 0; i < skinIndex.count; i++) {
      let w = 0; for (let c = 0; c < 4; c++) if (skinIndex.getComponent(i, c) === handIndex) w += skinWeight.getComponent(i, c)
      if (w < .5) continue
      body.getVertexPosition(i, v); v.applyMatrix4(body.matrixWorld).sub(origin)
      const along = v.dot(axis); if (along < .02 || along > .07) continue // thumb root band beyond the wrist
      const z = v.z; if (z > forward) forward = z; if (z < back) back = z
    }
    return { forward, back }
  }
  for (const side of ['Left', 'Right']) {
    const t = thumbSide(side)
    console.log(def.id, side, 'hand band z extent', t.forward.toFixed(3), t.back.toFixed(3))
    if (t.forward <= -t.back) throw new Error(`${def.id}: ${side} thumb is not on +Z; the Byzantine hand frame does not apply`)
  }
  function handFrame(side) {
    const hand = reference.scene.getObjectByName(`mixamorig${side}Hand`), fore = reference.scene.getObjectByName(`mixamorig${side}ForeArm`)
    const q = hand.getWorldQuaternion(new T.Quaternion()).invert()
    const finger = hand.getWorldPosition(new T.Vector3()).sub(fore.getWorldPosition(new T.Vector3())).normalize().applyQuaternion(q)
    const thumb = new T.Vector3(0, 0, 1).applyQuaternion(q); thumb.addScaledVector(finger, -thumb.dot(finger)).normalize()
    const palm = new T.Vector3(0, -1, 0).applyQuaternion(q); palm.addScaledVector(finger, -palm.dot(finger)); palm.addScaledVector(thumb, -palm.dot(thumb)).normalize()
    return { finger: finger.toArray(), thumb: thumb.toArray(), palm: palm.toArray(), center: finger.clone().multiplyScalar(KNUCKLE).addScaledVector(palm, GRIP_HEIGHT).toArray() }
  }
  const targetFrames = { Left: handFrame('Left'), Right: handFrame('Right') }
  const retargeter = createRetargeter(donor.scene, reference.scene, { frames: { donor: framesOf(donorManifest), target: targetFrames } })
  const stanceRetargeter = createRetargeter(stance.scene, reference.scene, { donorName: name => PROJECT_NAMES[name], frames: { donor: framesOf(stanceManifest), target: targetFrames } })
  const { bones } = retargeter
  const restToe = {}, restFoot = {}
  for (const side of ['Left', 'Right']) {
    restToe[side] = reference.scene.getObjectByName(`mixamorig${side}ToeBase`).getWorldPosition(new T.Vector3()).y
    restFoot[side] = reference.scene.getObjectByName(`mixamorig${side}Foot`).getWorldPosition(new T.Vector3()).y
  }
  const fkNodes = Object.fromEntries(bones.map(b => [b, fk.scene.getObjectByName(`mixamorig${b}`)]))
  const poseFk = (data, i) => { for (const b of bones) fkNodes[b].quaternion.copy(data.locals[b][i]); fkNodes.Hips.position.copy(data.hips[i]); fk.scene.updateMatrixWorld(true) }
  const trackSet = (times, locals, hips) => {
    const tracks = bones.map(bone => ({ node: docName(bone), path: 'rotation', times, values: locals[bone].flatMap(q => q.toArray()) }))
    tracks.push({ node: 'headfront', path: 'rotation', times, values: times.flatMap(() => reference.scene.getObjectByName('headfront').quaternion.toArray()) })
    tracks.push({ node: docName('Hips'), path: 'translation', times, values: hips.flatMap(p => p.toArray()) })
    return tracks
  }
  function applyGround(data, label) {
    const clearance = data.times.map((_, i) => {
      poseFk(data, i)
      return Math.min(...['Left', 'Right'].flatMap(side => [fkNodes[`${side}ToeBase`].getWorldPosition(new T.Vector3()).y - restToe[side], fkNodes[`${side}Foot`].getWorldPosition(new T.Vector3()).y - restFoot[side]]))
    })
    const lift = -Math.min(...clearance)
    data.hips.forEach((p, i) => { p.y += lift + Math.max(0, -(clearance[i] + lift) - .01) })
    console.log(`${def.id} ${label}: grounded by ${(lift * 1000).toFixed(1)} mm`)
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
    return { times, locals, hips }
  }
  function nativeClip(name) {
    const clip = native.animations.find(c => c.name === name)
    if (!clip) throw new Error(`${def.id}: source has no ${name}`)
    const times = [], locals = Object.fromEntries(bones.map(b => [b, []])), hips = [], fps = 60
    const mixer = new T.AnimationMixer(native.scene); mixer.clipAction(clip).play()
    const nodes = Object.fromEntries(bones.map(b => [b, native.scene.getObjectByName(`mixamorig${b}`)]))
    const count = Math.round(clip.duration * fps)
    for (let i = 0; i <= count; i++) {
      mixer.setTime(Math.min(i / fps, clip.duration)); native.scene.updateMatrixWorld(true)
      times.push(i / fps)
      for (const b of bones) locals[b].push(nodes[b].quaternion.clone())
      hips.push(nodes.Hips.position.clone().multiplyScalar(baked.scale)) // source position tracks are pre-bake centimetres
    }
    mixer.stopAllAction()
    for (const b of bones) continuity(locals[b])
    return { times, locals, hips }
  }
  function stride(data) {
    let sum = 0, n = 0, previous
    data.times.forEach((_, i) => {
      poseFk(data, i)
      const feet = ['Left', 'Right'].map(s => fkNodes[`${s}Foot`].getWorldPosition(new T.Vector3()))
      if (previous) {
        const planted = feet[0].y < feet[1].y ? 0 : 1
        if (feet[planted].y <= restFoot.Left + .12) { sum += -(feet[planted].z - previous[planted].z) / (data.times[i] - data.times[i - 1]); n++ }
      }
      previous = feet
    })
    return n ? sum / n : NaN
  }

  // ---- clips ---------------------------------------------------------------------------------
  const clips = [], bindings = []
  const add = (name, data, binding) => {
    clips.push({ name, tracks: trackSet(data.times, data.locals, data.hips) })
    bindings.push({ clip: name, ...binding, duration: data.times.at(-1) })
  }
  const idle = retarget('idle', stance, stanceRetargeter); applyGround(idle, 'idle')
  add('idle', idle, { source: 'Kevin Iglesias', sourceClip: 'idle', loop: true, retargetedFrom: 'roman-hero-t4' })
  {
    // Mounted upper body: the saddle masks the pelvis, so the stance's pelvis tilt moves onto the spine (Byzantine contract).
    const hipsRest = reference.scene.getObjectByName('mixamorigHips').quaternion.clone().invert()
    const upper = bones.filter(b => !/(UpLeg|Leg|Foot|ToeBase)$/.test(b) && b !== 'Hips')
    const locals = Object.fromEntries(upper.map(b => [b, idle.locals[b].map(q => q.clone())]))
    locals.Spine = idle.locals.Spine.map((q, i) => hipsRest.clone().multiply(idle.locals.Hips[i]).multiply(q).normalize())
    clips.push({ name: 'mounted', tracks: upper.map(b => ({ node: docName(b), path: 'rotation', times: idle.times, values: locals[b].flatMap(q => q.toArray()) })) })
    bindings.push({ clip: 'mounted', source: 'Kevin Iglesias', sourceClip: 'idle', loop: true, retargetedFrom: 'roman-hero-t4', duration: idle.times.at(-1) })
  }
  const walk = nativeClip('Walking'), run = nativeClip('Running')
  const walkSpeed = stride(walk), runSpeed = stride(run)
  add('walk', walk, { source: 'Meshy', sourceClip: 'Walking', loop: true, nominalSpeed: 0 })
  add('run', run, { source: 'Meshy', sourceClip: 'Running', loop: true, nominalSpeed: 0 })
  const donorBinding = clip => donorManifest.animations.embedded.find(b => b.clip === clip)
  // axeAttack1HFoot is the donor's Bandit-sourced foot one-hand axe attack; the animator picks it for 1H axes on foot.
  for (const name of ['swordSlash', 'bowLoad', 'bowHold', 'bowRelease', 'pilumThrow', 'axeMountedIdle', 'axeAttack1H', 'axeAttack1HFoot', 'axeAttack2H']) {
    const data = retarget(name)
    if (name !== 'axeMountedIdle') applyGround(data, name)
    const { clip: _clip, duration: _duration, ...rest } = donorBinding(name)
    add(name, data, { ...rest, retargetedFrom: 'roman-hero-t5' })
  }

  // ---- metrics: Meshy exports metres; the baked rig keeps its own scale (Viking heroes are 2.0–2.12 m). The Paladin landmark
  // fit used for the Byzantine asset would shrink these broad-shouldered armour sources, so it is recorded only as a comparison.
  const ref = await loadRig(stanceAsset, meshoptLoader()); ref.scene.updateMatrixWorld(true)
  const pos = name => reference.scene.getObjectByName(name).getWorldPosition(new T.Vector3())
  const landmarks = [['hips', 'mixamorigHips'], ['upper_arm_l', 'mixamorigLeftArm'], ['upper_arm_r', 'mixamorigRightArm']].map(([name, bone]) => ({
    name, source: pos(bone).y, reference: ref.scene.getObjectByName(name).getWorldPosition(new T.Vector3()).y }))
  const paladinLandmarkFit = landmarks.reduce((s, p) => s + p.source * p.reference, 0) / landmarks.reduce((s, p) => s + p.source * p.source, 0)
  const scale = 1
  const box = new T.Box3(), v = new T.Vector3()
  for (let i = 0; i < body.geometry.attributes.position.count; i++) { body.getVertexPosition(i, v); box.expandByPoint(v) }
  for (const [clip, speed] of [['walk', walkSpeed], ['run', runSpeed]]) bindings.find(b => b.clip === clip).nominalSpeed = +(speed * scale).toFixed(2)

  // Seat bearing: back/underside of each upper thigh in source mesh space. The Byzantine asset's inspected landmark sits
  // (−.012 medial, −.067, −.093) from its hip pivot on a .372 m thigh; the same anatomical offset is scaled by this thigh length
  // and then projected onto the nearest body triangle per LOD at runtime (prepareSeatSupport). Mounted fit is verified in-game.
  const seatBearing = ['Left', 'Right'].map(side => {
    const top = pos(`mixamorig${side}UpLeg`), knee = pos(`mixamorig${side}Leg`), k = top.distanceTo(knee) / .372, medial = Math.sign(top.x)
    return [+(top.x - medial * .012 * k).toFixed(3), +(top.y - .067 * k).toFixed(3), +(top.z - .093 * k).toFixed(3)]
  })

  // ---- LOD surfaces --------------------------------------------------------------------------
  // Decimate the already-baked, reweighted skin so LOD1/LOD2 inherit the same waist correction.
  const plainPath = path.join(scratch, 'baked.glb'), surfacesPath = path.join(scratch, 'surfaces.json')
  fs.writeFileSync(plainPath, assembleGlb(baked, [], undefined))
  const triangles0 = asset.document.accessors[asset.document.meshes[0].primitives[0].indices].count / 3
  execFileSync(BLENDER, ['-b', '--python-exit-code', '1', '--python', 'tools/simplify-replacement-humanoids.py', '--', plainPath, surfacesPath,
    String(def.lodTriangles[0] / triangles0), String(def.lodTriangles[1] / triangles0)], { stdio: 'ignore' })
  const surfaces = JSON.parse(fs.readFileSync(surfacesPath, 'utf8'))
  const meshNode = baked.document.nodes.find(n => n.mesh === 0)
  const skin = baked.document.skins[meshNode.skin], jointIndex = new Map(skin.joints.map((node, i) => [baked.document.nodes[node].name, i]))
  const lodSurface = level => {
    const reduced = surfaces[meshNode.name]?.[String(level)]?.primitives?.[0]
    if (!reduced) throw new Error(`${def.id}: Blender produced no LOD${level} surface for ${meshNode.name}`)
    const unique = [], indices = [], seen = new Map()
    for (const index of reduced.indices) {
      const vertex = reduced.vertices[index], key = JSON.stringify(vertex)
      if (!seen.has(key)) { seen.set(key, unique.length); unique.push(vertex) }
      indices.push(seen.get(key))
    }
    let maxDropped = 0
    const influences = unique.map(vertex => {
      const weights = vertex[3].filter(([name]) => jointIndex.has(name)).sort((a, b) => b[1] - a[1])
      const total = weights.reduce((s, [, w]) => s + w, 0)
      if (total < .99) throw new Error(`${def.id}: LOD${level} lost skin weight`)
      const kept = weights.slice(0, 4), keptSum = kept.reduce((s, [, w]) => s + w, 0)
      maxDropped = Math.max(maxDropped, 1 - keptSum / total)
      return kept.map(([name, w]) => [jointIndex.get(name), w / keptSum])
    })
    return { unique, indices, influences, maxDropped }
  }

  // ---- textures + GLBs -----------------------------------------------------------------------
  const images = asset.document.images.map((image, i) => {
    const view = asset.document.bufferViews[image.bufferView], file = path.join(scratch, `source-${i}.${image.mimeType === 'image/png' ? 'png' : 'jpg'}`)
    fs.writeFileSync(file, asset.binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength)); return file
  })
  const resized = (size, i) => {
    const output = path.join(scratch, `${size}-${i}.jpg`)
    execFileSync('sips', ['-Z', String(size), '-s', 'format', 'jpeg', '-s', 'formatOptions', '88', images[i], '--out', output], { stdio: 'ignore' })
    return fs.readFileSync(output)
  }
  fs.mkdirSync(out, { recursive: true })
  const fileSha256 = {}, triangles = {}, lods = []
  for (const [lod, size] of [[0, 2048], [1, 1024], [2, 512]]) {
    const document = structuredClone(baked.document), chunks = [baked.binary]
    let offset = baked.binary.length, dropped = 0
    if (lod > 0) {
      const surface = lodSurface(lod), primitive = document.meshes[0].primitives[0]
      const appendArray = (typed, type, componentType = 5126) => {
        const pad = (4 - offset % 4) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); offset += pad }
        const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength)
        document.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length })
        chunks.push(bytes); offset += bytes.length
        const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[type]
        document.accessors.push({ bufferView: document.bufferViews.length - 1, componentType, count: typed.length / width, type })
        return document.accessors.length - 1
      }
      const positions = surface.unique.map(u => u[0])
      primitive.attributes = {
        POSITION: appendArray(new Float32Array(positions.flat()), 'VEC3'),
        NORMAL: appendArray(new Float32Array(surface.unique.flatMap(u => u[1])), 'VEC3'),
        TEXCOORD_0: appendArray(new Float32Array(surface.unique.flatMap(u => u[2])), 'VEC2'),
        JOINTS_0: appendArray(new Uint16Array(surface.influences.flatMap(w => [0, 1, 2, 3].map(k => w[k]?.[0] ?? 0))), 'VEC4', 5123),
        WEIGHTS_0: appendArray(new Float32Array(surface.influences.flatMap(w => [0, 1, 2, 3].map(k => w[k]?.[1] ?? 0))), 'VEC4'),
      }
      document.accessors[primitive.attributes.POSITION].min = [0, 1, 2].map(c => Math.min(...positions.map(p => p[c])))
      document.accessors[primitive.attributes.POSITION].max = [0, 1, 2].map(c => Math.max(...positions.map(p => p[c])))
      primitive.indices = appendArray(new Uint32Array(surface.indices), 'SCALAR', 5125)
      // Tangents are not regenerated for collapsed LODs; the material's normal map then uses derivative tangents.
      dropped = surface.maxDropped
    }
    const lodBaked = { document, binary: Buffer.concat(chunks), scale: baked.scale }
    const bytes = assembleGlb(lodBaked, clips, images.map((_, i) => resized(size, i)))
    // assembleGlb keeps the source image entries; every LOD map is now JPEG.
    const patched = setJpegMime(bytes)
    fs.writeFileSync(path.join(out, `lod${lod}.glb`), patched)
    fileSha256[`lod${lod}`] = sha(patched)
    triangles[`lod${lod}`] = lod === 0 ? triangles0 : lodSurface(lod).indices.length / 3
    lods.push({ level: lod, triangles: triangles[`lod${lod}`], textureMax: size, bytes: patched.length, sha256: fileSha256[`lod${lod}`], maxDroppedInfluenceWeight: dropped, joints: 24, animationNames: clips.map(c => c.name) })
    console.log(`${def.id} lod${lod}.glb`, (patched.length / 1e6).toFixed(2), 'MB', triangles[`lod${lod}`], 'triangles')
  }

  // ---- manifest + evidence -------------------------------------------------------------------
  const LANCE_RADIUS = .022, R = targetFrames.Right, L = targetFrames.Left
  const rightFrame = { gripCenterLocal: R.center, gripAxisLocal: R.thumb, palmNormalLocal: R.palm, fingerDirection: R.finger, wristCenter: [0, 0, 0], thumbBaseCenter: R.finger.map(x => x * .045), fingerBase: KNUCKLE, gripRadius: .019 }
  const leftFrame = { palmContactCenter: L.center.map((x, i) => x - L.palm[i] * LANCE_RADIUS), palmNormal: L.palm, thumbDir: 1, thumbDirection: L.thumb, fingerDirection: L.finger, wristCenter: [0, 0, 0], fingerBase: KNUCKLE, thumbBaseCenter: L.finger.map(x => x * .045) }
  const metrics = { heightM: (box.max.y - box.min.y) * scale, shoulderWidthM: pos('mixamorigLeftArm').distanceTo(pos('mixamorigRightArm')) * scale + .15,
    neckLengthM: pos('mixamorigNeck').distanceTo(pos('mixamorigHead')) * scale, triangles, textures: { lod0: 2048, lod1: 1024, lod2: 512 }, uniformScale: scale, bodyLandmarks: landmarks, paladinLandmarkFit }
  const manifest = {
    schemaVersion: 1, id: def.id, status: 'ready', skeleton: 'project-humanoid-v1',
    source: { title: def.title, sourceFile: def.file, sourceSha256: def.sha, license: RIGHTS, licenseEvidence: 'attribution-evidence.json' },
    attribution: `${def.title}: owner-supplied Meshy model, textures and Walking / Running. Idle, sword, bow, pilum and axe clips are direction-retargeted from roman-hero-t4 / roman-hero-t5 (project-licensed Kevin Iglesias and Quaternius sources; the foot one-hand axe attack is tokeshi's Bandit@attack via roman-hero-t5; see those assets).`,
    selectedSource: { rig: 'mixamo24', uniformScale: scale, seatBearing },
    handShapeMode: 'authored', preserveLodHandTopology: true,
    files: { lod0: 'lod0.glb', lod1: 'lod1.glb', lod2: 'lod2.glb' }, fileSha256, boneMap: 'bone-map.json', audit: 'audit.json', metrics,
    animations: { embedded: bindings, runtimeGenerated: ['death', 'hit', 'daggerSlash', 'greatswordSlash', 'lanceThrust', 'mountedLance'] },
    handGripFrames: { left: leftFrame },
    swordGripFrames: { lod0: rightFrame, lod1: rightFrame, lod2: rightFrame },
    bakedSource: { armatureScaleBaked: baked.scale, note: 'Joint translations, inverse binds and position tracks multiplied by the Armature scale; LOD0 positions and UVs unchanged. Thigh skin weight above the hip pivot moved to the pelvis (waist collapse when seated).' },
    animationRetarget: { revision, method: 'tools/lib/mixamo-direction-retarget.mjs (bone direction + donor twist, anatomical palm frames)', idleDonor: `${STANCE_DONOR}/lod0.glb`, combatDonor: `${COMBAT_DONOR}/lod0.glb`, idleDonorSha256: sha(fs.readFileSync(`${STANCE_DONOR}/lod0.glb`)), combatDonorSha256: sha(fs.readFileSync(`${COMBAT_DONOR}/lod0.glb`)) },
    visualAcceptance: 'Requires live game review; structural audit alone does not establish visual acceptance.',
    knownLimitations: ['Source rig has no finger bones: runtime morphs (MittenHandShape) curl the mitten hands.', 'Idle / sword / bow / pilum / axe clips are direction-retargeted from roman-hero-t4 / roman-hero-t5; the foot one-hand axe attack is the Bandit clip carried by roman-hero-t5.', 'No dynamic cloth: tassets and fur follow the thigh/pelvis skin.'],
  }
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  const mapping = Object.fromEntries(skin.joints.map(node => baked.document.nodes[node].name).map(name => [name, PROJECT_NAMES[name.replace(/^mixamorig:/, '')] ?? null]))
  fs.writeFileSync(path.join(out, 'bone-map.json'), JSON.stringify({ skeleton: 'project-humanoid-v1', rig: 'mixamo24', sourceToProject: mapping, skinJointCount: 24,
    sockets: 'Runtime-created by prepareSelectedHumanoidSource (src/world/SelectedHumanoidSource.ts) on the mapped bones.', fingerBones: 'none (mitten hands)' }, null, 2) + '\n')
  fs.writeFileSync(path.join(out, 'audit.json'), JSON.stringify({ builder: 'tools/build-viking-heavy-heroes.mjs', sourceSha256: def.sha, sourceBytes: sourceBytes.length,
    sourceStructure: { joints: 24, animations: asset.document.animations.map(a => a.name), armatureScale: baked.scale, images: asset.document.images.map(i => i.mimeType), triangles: triangles0 },
    thighPivotM: pivot, waistVerticesReweighted: waist, measuredPlantedFootSpeed: { walk: walkSpeed * scale, run: runSpeed * scale }, seatBearing,
    lod0Policy: 'Original vertex, normal, UV, tangent and index bytes preserved; only JOINTS/WEIGHTS of the waist band changed. No decimation of LOD0.', lods }, null, 2) + '\n')
  fs.writeFileSync(path.join(out, 'attribution-evidence.json'), JSON.stringify({ source: manifest.source, rightsEvidence: RIGHTS,
    animationDonor: manifest.animationRetarget, sourceDistribution: 'Original supplied downloads remain outside the shipped runtime bundle; normalized derivative GLBs only.' }, null, 2) + '\n')
  fs.writeFileSync(path.join(out, 'ATTRIBUTION.md'), `# ${def.nameEn} (${def.id})\n\nOwner-supplied Meshy model \`${def.file}\` (SHA-256 in manifest.json). ${RIGHTS}.\n`
    + 'LOD0 mesh and UVs are unchanged; thigh skin weight above the hip pivot moves to the pelvis so the waist holds when seated; the 0.01 Armature scale is baked into the joints; '
    + 'LOD1/LOD2 are collapse-decimated copies; textures are resampled per LOD (2048/1024/512 JPEG).\n'
    + 'Walking and Running are the model\'s own clips. Idle is retargeted from `roman-hero-t4`; sword, bow, pilum and axe clips from `roman-hero-t5` (project-licensed Kevin Iglesias / Quaternius sources; the foot one-hand axe attack is tokeshi\'s Fantasy Bandit `Bandit@attack`, see those assets).\n'
    + `Rebuild: \`node tools/build-viking-heavy-heroes.mjs <downloads-dir> ${def.id}\`.\n`)
  console.log(def.id, 'metrics', JSON.stringify({ height: metrics.heightM, shoulder: metrics.shoulderWidthM, neck: metrics.neckLengthM, scale, seatBearing, walk: bindings.find(b => b.clip === 'walk').nominalSpeed, run: bindings.find(b => b.clip === 'run').nominalSpeed }))
  fs.rmSync(scratch, { recursive: true, force: true })
}

function setJpegMime(bytes) {
  const length = bytes.readUInt32LE(12), document = JSON.parse(bytes.toString('utf8', 20, 20 + length))
  for (const image of document.images ?? []) image.mimeType = 'image/jpeg'
  const text = JSON.stringify(document), json = Buffer.from(text + ' '.repeat((4 - Buffer.byteLength(text) % 4) % 4))
  const rest = bytes.subarray(20 + length), header = Buffer.alloc(20)
  header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + json.length + rest.length, 8); header.writeUInt32LE(json.length, 12); header.write('JSON', 16)
  return Buffer.concat([header, json, rest])
}
