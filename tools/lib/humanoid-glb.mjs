import fs from 'node:fs'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

export function readGlb(path) {
  const bytes = fs.readFileSync(path)
  const length = bytes.readUInt32LE(12)
  return { document: JSON.parse(bytes.toString('utf8', 20, 20 + length)), binary: bytes.subarray(28 + length) }
}

export function encodeGlb(document, binary) {
  const text = JSON.stringify(document)
  const json = Buffer.from(text + ' '.repeat((4 - Buffer.byteLength(text) % 4) % 4))
  const bin = Buffer.concat([binary, Buffer.alloc((4 - binary.length % 4) % 4)])
  const header = Buffer.alloc(20), tail = Buffer.alloc(8)
  header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + json.length + bin.length, 8)
  header.writeUInt32LE(json.length, 12); header.write('JSON', 16)
  tail.writeUInt32LE(bin.length); tail.write('BIN\0', 4)
  return Buffer.concat([header, json, tail, bin])
}

/** Parse an in-memory copy without image decoding; never change the asset. */
export async function loadRig(asset) {
  const document = structuredClone(asset.document)
  delete document.images; delete document.textures; delete document.materials
  for (const mesh of document.meshes) for (const primitive of mesh.primitives) delete primitive.material
  const bytes = encodeGlb(document, asset.binary)
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
}

export function readAccessor(asset, index) {
  const a = asset.document.accessors[index], v = asset.document.bufferViews[a.bufferView]
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type]
  if (a.componentType !== 5126) throw new Error('Animation accessor must contain floats')
  const values = new Float32Array(a.count * components)
  for (let row = 0; row < a.count; row++) for (let column = 0; column < components; column++) {
    values[row * components + column] = asset.binary.readFloatLE((v.byteOffset ?? 0) + (a.byteOffset ?? 0) + row * (v.byteStride ?? components * 4) + column * 4)
  }
  return values
}

/** Repack animation data only. Mesh/skin/image bytes and unselected samples are preserved. */
export function replaceClips(asset, replacements) {
  const document = structuredClone(asset.document), base = document.asset.extras.humanoidAnimationBuild
  const chunks = [asset.binary.subarray(0, base.baseBufferByteLength)]
  let offset = chunks[0].length
  document.accessors = document.accessors.slice(0, base.baseAccessorCount)
  document.bufferViews = document.bufferViews.slice(0, base.baseBufferViewCount)
  function append(values, type) {
    const bytes = Buffer.from(values.buffer, values.byteOffset, values.byteLength)
    const view = document.bufferViews.length
    document.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length })
    chunks.push(bytes); offset += bytes.length
    const components = type === 'SCALAR' ? 1 : type === 'VEC3' ? 3 : 4
    const accessor = { bufferView: view, componentType: 5126, count: values.length / components, type }
    if (type === 'SCALAR') { accessor.min = [values[0]]; accessor.max = [values.at(-1)] }
    document.accessors.push(accessor)
    return document.accessors.length - 1
  }
  document.animations = asset.document.animations.map(original => {
    const replacement = replacements.get(original.name)
    if (!replacement) {
      return { ...original, samplers: original.samplers.map(s => ({ ...s,
        input: append(readAccessor(asset, s.input), 'SCALAR'),
        output: append(readAccessor(asset, s.output), asset.document.accessors[s.output].type),
      })) }
    }
    const samplers = [], channels = []
    for (const track of replacement.tracks) {
      const split = track.name.lastIndexOf('.'), name = track.name.slice(0, split), property = track.name.slice(split + 1)
      const node = document.nodes.findIndex(n => n.name === name)
      if (node < 0 || property !== 'quaternion') throw new Error(`Unsupported output track: ${track.name}`)
      channels.push({ sampler: samplers.length, target: { node, path: 'rotation' } })
      samplers.push({ input: append(track.times, 'SCALAR'), output: append(track.values, 'VEC4'), interpolation: 'LINEAR' })
    }
    return { name: original.name, samplers, channels }
  })
  document.buffers[0].byteLength = offset
  return { document, binary: Buffer.concat(chunks) }
}

/** Re-express the same skin deformation in a target's authored rest frame. */
export function transferClip(source, target, clip) {
  source.scene.updateMatrixWorld(true); target.scene.updateMatrixWorld(true)
  const pairs = []
  target.scene.traverse(bone => {
    if (!bone.isBone || bone.name.startsWith('socket_') || bone.name.startsWith('sole_')) return
    const from = source.scene.getObjectByName(bone.name)
    if (!from) throw new Error(`Missing source bone ${bone.name}`)
    pairs.push({ from, bone,
      sourceRest: from.getWorldQuaternion(new THREE.Quaternion()).invert(),
      targetRest: bone.getWorldQuaternion(new THREE.Quaternion()), values: [],
    })
  })
  const mixer = new THREE.AnimationMixer(source.scene), action = mixer.clipAction(clip)
  action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play()
  const times = [], count = Math.round(clip.duration * 30)
  for (let i = 0; i <= count; i++) {
    const time = i / count * clip.duration
    action.paused = false; mixer.setTime(time); source.scene.updateMatrixWorld(true)
    for (const pair of pairs) {
      const world = pair.from.getWorldQuaternion(new THREE.Quaternion()).multiply(pair.sourceRest).multiply(pair.targetRest)
      pair.bone.quaternion.copy(pair.bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world).normalize())
      pair.bone.updateWorldMatrix(false, false)
      const q = pair.bone.quaternion
      if (pair.values.length && q.dot(new THREE.Quaternion().fromArray(pair.values, pair.values.length - 4)) < 0) q.set(-q.x, -q.y, -q.z, -q.w)
      pair.values.push(...q.toArray())
    }
    times.push(time)
  }
  mixer.stopAllAction()
  return new THREE.AnimationClip(clip.name, clip.duration, pairs.map(p => new THREE.QuaternionKeyframeTrack(`${p.bone.name}.quaternion`, times, p.values)))
}

function anatomicalBasis(along, front) {
  const y = along.clone().normalize(), z = front.clone().addScaledVector(y, -front.dot(y)).normalize()
  const x = new THREE.Vector3().crossVectors(y, z).normalize()
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, new THREE.Vector3().crossVectors(x, y)))
}

/** Rotation-only, in-place body bake from immutable source world samples. */
export function retargetSwordBody(sample, target) {
  const map = {
    hips: 'pelvis', spine: 'spine_01', chest: 'spine_02', upper_chest: 'spine_03', neck: 'neck_01', head: 'Head',
    clavicle_l: 'clavicle_l', clavicle_r: 'clavicle_r',
    upper_arm_l: 'upperarm_l', lower_arm_l: 'lowerarm_l', hand_l: 'hand_l',
    upper_arm_r: 'upperarm_r', lower_arm_r: 'lowerarm_r', hand_r: 'hand_r',
    upper_leg_l: 'thigh_l', lower_leg_l: 'calf_l', foot_l: 'foot_l', toe_l: 'ball_l',
    upper_leg_r: 'thigh_r', lower_leg_r: 'calf_r', foot_r: 'foot_r', toe_r: 'ball_r',
  }
  target.scene.updateMatrixWorld(true)
  const pairs = []
  target.scene.traverse(bone => {
    if (!map[bone.name]) return
    const source = map[bone.name]
    pairs.push({ bone, source, rest: bone.getWorldQuaternion(new THREE.Quaternion()),
      sourceRest: new THREE.Quaternion().fromArray(sample.rest[source].rotation).invert(), values: [] })
  })
  for (const pose of sample.poses) {
    const pelvisDelta = new THREE.Quaternion().fromArray(pose.pelvis)
      .multiply(new THREE.Quaternion().fromArray(sample.rest.pelvis.rotation).invert())
    const heading = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), new THREE.Euler().setFromQuaternion(pelvisDelta, 'YXZ').y)
    for (const pair of pairs) {
      // The source crouch depends on pelvis translation. Rotation-only output
      // uses the target's planted stance, turning with the authored pelvis yaw.
      // Keeping crouched leg rotations with a fixed pelvis lifts both soles.
      const planted = /^(hips|upper_leg_|lower_leg_|foot_|toe_)/.test(pair.bone.name)
      const world = planted ? heading.clone().multiply(pair.rest)
        : new THREE.Quaternion().fromArray(pose[pair.source]).multiply(pair.sourceRest).multiply(pair.rest)
      const q = pair.bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world).normalize()
      if (pair.values.length && q.dot(new THREE.Quaternion().fromArray(pair.values, pair.values.length - 4)) < 0) q.set(-q.x, -q.y, -q.z, -q.w)
      pair.values.push(...q.toArray()); pair.bone.quaternion.copy(q); pair.bone.updateWorldMatrix(false, false)
    }
  }
  return new THREE.AnimationClip('swordSlash', sample.duration, pairs.map(p => new THREE.QuaternionKeyframeTrack(`${p.bone.name}.quaternion`, sample.times, p.values)))
}

/** Retarget physical limb axes, not a T-pose rotation delta onto an A-pose. */
export function retargetArms(sample, target, baseClip, rightFrame, leftFrame, family = 'kevin') {
  target.scene.updateMatrixWorld(true)
  const map = family === 'kevin' ? {
    upper_arm_r: 'B-upperArm.R', lower_arm_r: 'B-forearm.R', hand_r: 'B-hand.R',
    upper_arm_l: 'B-upperArm.L', lower_arm_l: 'B-forearm.L', hand_l: 'B-hand.L',
  } : {
    upper_arm_r: 'upperarm_r', lower_arm_r: 'lowerarm_r', hand_r: 'hand_r',
    upper_arm_l: 'upperarm_l', lower_arm_l: 'lowerarm_l', hand_l: 'hand_l',
  }
  const targets = []
  target.scene.traverse(bone => {
    const name = map[bone.name]
    if (!name) return
    const rest = sample.rest[name]
    const sourceRest = new THREE.Quaternion().fromArray(rest.rotation)
    let sourceLocal, targetLocal
    if (bone.name.startsWith('hand_')) {
      const right = bone.name.endsWith('_r'), side = right ? 'R' : 'L', suffix = right ? 'r' : 'l'
      const index = sample.rest[family === 'kevin' ? `B-indexFinger01.${side}` : `index_01_${suffix}`]
      const pinky = sample.rest[family === 'kevin' ? `B-pinky01.${side}` : `pinky_01_${suffix}`]
      const middle = sample.rest[family === 'kevin' ? `B-middleFinger01.${side}` : `middle_01_${suffix}`]
      const thumb = new THREE.Vector3(...index.position).sub(new THREE.Vector3(...pinky.position)).normalize()
      const finger = new THREE.Vector3(...middle.position).sub(new THREE.Vector3(...rest.position)).normalize()
      finger.addScaledVector(thumb, -finger.dot(thumb)).normalize()
      sourceLocal = sourceRest.clone().invert().multiply(new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(thumb, finger, new THREE.Vector3().crossVectors(thumb, finger))))
      const frame = right ? rightFrame : leftFrame
      const t = new THREE.Vector3(...(right ? frame.gripAxisLocal : frame.thumbDirection)).normalize()
      const f = new THREE.Vector3(...frame.fingerDirection).normalize()
      targetLocal = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(t, f, new THREE.Vector3().crossVectors(t, f))).invert()
    } else {
      const nextName = bone.name.startsWith('upper_arm')
        ? bone.name.replace('upper_arm', 'lower_arm') : bone.name.replace('lower_arm', 'hand')
      const sourceNext = sample.rest[map[nextName]]
      const sourceDir = new THREE.Vector3(...sourceNext.position).sub(new THREE.Vector3(...rest.position))
      const sourceBasis = anatomicalBasis(sourceDir, new THREE.Vector3(0, 0, 1))
      sourceLocal = sourceRest.clone().invert().multiply(sourceBasis)
      const child = target.scene.getObjectByName(nextName)
      const dir = child.getWorldPosition(new THREE.Vector3()).sub(bone.getWorldPosition(new THREE.Vector3()))
      const targetBasis = anatomicalBasis(dir, new THREE.Vector3(0, 0, 1))
      targetLocal = targetBasis.invert().multiply(bone.getWorldQuaternion(new THREE.Quaternion()))
    }
    targets.push({ bone, name, sourceLocal, targetLocal, values: [] })
  })
  const mixer = new THREE.AnimationMixer(target.scene), action = mixer.clipAction(baseClip)
  action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play()
  // Restore a freshly sampled base each time; don't feed the previous bake back.
  for (let i = 0; i < sample.times.length; i++) {
    action.paused = false; mixer.setTime(sample.times[i]); target.scene.updateMatrixWorld(true)
    for (const entry of targets) {
      const world = new THREE.Quaternion().fromArray(sample.poses[i][entry.name]).multiply(entry.sourceLocal).multiply(entry.targetLocal)
      const q = entry.bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world).normalize()
      if (entry.values.length && q.dot(new THREE.Quaternion().fromArray(entry.values, entry.values.length - 4)) < 0) q.set(-q.x, -q.y, -q.z, -q.w)
      entry.values.push(...q.toArray()); entry.bone.quaternion.copy(q); entry.bone.updateWorldMatrix(false, true)
    }
  }
  mixer.stopAllAction()
  const owned = new Set(targets.map(t => t.bone.name + '.quaternion'))
  return new THREE.AnimationClip(baseClip.name, baseClip.duration, [
    ...baseClip.tracks.filter(t => !owned.has(t.name)),
    ...targets.map(t => new THREE.QuaternionKeyframeTrack(`${t.bone.name}.quaternion`, sample.times, t.values)),
  ])
}
