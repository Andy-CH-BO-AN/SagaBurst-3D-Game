/** Offline animation-only conversion for a measured, fitted canonical rig. */
import * as T from 'three'
import { createHash } from 'node:crypto'

const position = object => object.getWorldPosition(new T.Vector3())
const rotation = object => object.getWorldQuaternion(new T.Quaternion())
const forward = new T.Vector3(0, 0, 1)
const nextBone = {
  hips: 'spine', spine: 'chest', chest: 'neck', neck: 'head',
  clavicle_l: 'upper_arm_l', clavicle_r: 'upper_arm_r',
  upper_arm_l: 'lower_arm_l', upper_arm_r: 'lower_arm_r',
  lower_arm_l: 'hand_l', lower_arm_r: 'hand_r',
  upper_leg_l: 'lower_leg_l', upper_leg_r: 'lower_leg_r',
  lower_leg_l: 'foot_l', lower_leg_r: 'foot_r', foot_l: 'toe_l', foot_r: 'toe_r',
}
const required = ['hips', 'spine', 'chest', 'neck', 'head', ...['l', 'r'].flatMap(side =>
  ['upper_arm', 'lower_arm', 'hand', 'upper_leg', 'lower_leg', 'foot', 'toe'].map(name => `${name}_${side}`))]

/** Use original GLTF names as well as Three's sanitized track names. */
export function rigIndex(rig, document) {
  const result = new Map()
  rig.scene.traverse(object => {
    result.set(object.name, object)
    const index = rig.parser.associations.get(object)?.nodes
    if (index !== undefined && document.nodes[index].name) result.set(document.nodes[index].name, object)
  })
  return result
}

export function captureRest(rig) {
  rig.scene.updateMatrixWorld(true)
  const rest = new Map()
  rig.scene.traverse(object => rest.set(object, {
    position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone(),
    worldPosition: position(object), worldQuaternion: rotation(object),
  }))
  return { rest, reset() {
    for (const [object, state] of rest) {
      object.position.copy(state.position); object.quaternion.copy(state.quaternion); object.scale.copy(state.scale)
    }
    rig.scene.updateMatrixWorld(true)
  } }
}

function vector(value, label) {
  if (!Array.isArray(value) || value.length !== 3 || value.some(n => !Number.isFinite(n))) throw Error(`Invalid measured ${label}`)
  const result = new T.Vector3(...value)
  if (result.lengthSq() < 1e-12) throw Error(`Zero measured ${label}`)
  return result.normalize()
}

function basis(along, preferredFront) {
  if (along.lengthSq() < 1e-12) throw Error('Anatomical segment has zero length')
  const y = along.clone().normalize(), z = preferredFront.clone().addScaledVector(y, -preferredFront.dot(y))
  if (z.lengthSq() < 1e-8) {
    const alternative = Math.abs(y.x) < .8 ? new T.Vector3(1, 0, 0) : new T.Vector3(0, 1, 0)
    z.copy(alternative).addScaledVector(y, -alternative.dot(y))
  }
  z.normalize()
  const x = new T.Vector3().crossVectors(y, z).normalize()
  return new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(x, y, new T.Vector3().crossVectors(x, y)))
}

/** Shaft and finger direction are measured in each target hand's bind-local frame. */
export function gripBasis(frame, left = false) {
  if (!frame) throw Error(`Missing measured ${left ? 'left' : 'right'} grip frame`)
  const y = vector(left ? frame.thumbDirection : frame.gripAxisLocal, 'grip/thumbnail axis')
  const x = vector(frame.fingerDirection, 'finger direction').addScaledVector(y, -new T.Vector3(...frame.fingerDirection).normalize().dot(y))
  if (x.lengthSq() < 1e-8) throw Error('Measured grip and finger directions are parallel')
  x.normalize()
  return new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(x, y, new T.Vector3().crossVectors(x, y)))
}

function fingerAlias(name) {
  const match = /^(thumb|index|middle|ring|pinky)_(0[123])_([lr])$/.exec(name)
  if (!match) return null
  const names = { thumb: 'Thumb', index: 'Index', middle: 'Middle', ring: 'Ring', pinky: 'Little' }
  return `${names[match[1]]}.${match[2]}.${match[3].toUpperCase()}`
}

function fingerNext(name) {
  const match = /^(thumb|index|middle|ring|pinky)_(0[123])_([lr])$/.exec(name)
  return match && Number(match[2]) < 3 ? `${match[1]}_0${Number(match[2]) + 1}_${match[3]}` : null
}

function anatomicalDirection(name, bone, index, aliases = {}) {
  const successor = nextBone[name] ?? fingerNext(name)
  const next = successor && index.get(aliases[successor] ?? fingerAlias(successor) ?? successor)
  if (next) return position(next).sub(position(bone))
  // Terminal toes/fingers continue their own preceding measured segment.
  if (/^(toe_|(?:thumb|index|middle|ring|pinky)_)/.test(name) && bone.parent?.isBone) return position(bone).sub(position(bone.parent))
  return null
}

function handFrame(metadata, name, clipName) {
  if (name === 'hand_l') return gripBasis(metadata.handGripFrames?.left, true)
  const frames = clipName === 'pilumThrow' ? metadata.rangedGripFrames ?? metadata.swordGripFrames : metadata.swordGripFrames
  return gripBasis(frames?.lod0)
}

function makePairs(source, target, sourceIndex, targetIndex, sourceRest, targetRest, sourceMetadata, targetMetadata, clipName, names) {
  const aliases = targetMetadata.animationRetarget?.boneMap ?? {}
  const pairs = []
  target.scene.traverse(bone => {
    if (!bone.isBone || /^(socket_|sole_|root$)/.test(bone.name) || (names && !names.has(bone.name))) return
    const sourceName = aliases[bone.name] ?? fingerAlias(bone.name) ?? bone.name
    const from = sourceIndex.get(sourceName)
    if (!from?.isBone) return
    const a = sourceRest.get(from), b = targetRest.get(bone)
    let conversion = a.worldQuaternion.clone().invert().multiply(b.worldQuaternion)
    if (/^hand_[lr]$/.test(bone.name)) {
      conversion = handFrame(sourceMetadata, bone.name, clipName).multiply(handFrame(targetMetadata, bone.name, clipName).invert())
    } else {
      const sourceDirection = anatomicalDirection(bone.name, from, sourceIndex, aliases)
      // Target names are already canonical; do not map them to Roman finger aliases.
      const targetAliases = Object.fromEntries([...targetIndex.keys()].map(name => [name, name]))
      const targetDirection = anatomicalDirection(bone.name, bone, targetIndex, targetAliases)
      if (sourceDirection && targetDirection) {
        let sourceFront = forward, targetFront = forward
        if (fingerAlias(bone.name)) {
          const side = bone.name.at(-1), sourceHand = sourceIndex.get(`hand_${side}`), targetHand = targetIndex.get(`hand_${side}`)
          sourceFront = new T.Vector3(0, 0, 1).applyQuaternion(handFrame(sourceMetadata, `hand_${side}`, clipName)).applyQuaternion(sourceRest.get(sourceHand).worldQuaternion)
          targetFront = new T.Vector3(0, 0, 1).applyQuaternion(handFrame(targetMetadata, `hand_${side}`, clipName)).applyQuaternion(targetRest.get(targetHand).worldQuaternion)
        }
        conversion = a.worldQuaternion.clone().invert().multiply(basis(sourceDirection, sourceFront))
          .multiply(basis(targetDirection, targetFront).invert()).multiply(b.worldQuaternion)
      }
    }
    pairs.push({ bone, from, conversion })
  })
  return pairs
}

function finiteQuaternion(q, values, label) {
  q.normalize()
  if (![q.x, q.y, q.z, q.w].every(Number.isFinite)) throw Error(`Non-finite quaternion: ${label}`)
  if (values.length && q.dot(new T.Quaternion().fromArray(values, values.length - 4)) < 0) q.set(-q.x, -q.y, -q.z, -q.w)
  values.push(...q.toArray())
}

function sampledTimes(clip, binding, fps) {
  const values = [0, clip.duration, ...clip.tracks.flatMap(track => [...track.times]), ...Object.values(binding?.events ?? {})]
  const count = Math.max(1, Math.ceil(clip.duration * fps))
  for (let i = 0; i <= count; i++) values.push(i / count * clip.duration)
  // Float32 deduplication prevents duplicate GLTF timestamps at declared events.
  return [...new Set(values.filter(t => t >= 0 && t <= clip.duration + 1e-6).map(t => Math.fround(Math.min(t, clip.duration))))].sort((a, b) => a - b)
}

function sampler(rig, clip) {
  // Evaluate authored interpolants directly. A mixer can skip rewriting an
  // unchanged track after an explicit rest reset, leaking bind pose into an
  // otherwise constant idle channel during the Bandit overlay bake.
  const tracks = clip.tracks.map(track => {
    const split = track.name.lastIndexOf('.'), node = rig.scene.getObjectByName(track.name.slice(0, split)), property = track.name.slice(split + 1)
    if (!node || !['position', 'quaternion', 'scale'].includes(property)) throw Error(`Unsupported source transform track ${track.name}`)
    return { node, property, interpolant: track.createInterpolant() }
  })
  return { sample(time) {
    const clamped = T.MathUtils.clamp(time, 0, clip.duration)
    for (const { node, property, interpolant } of tracks) node[property].fromArray(interpolant.evaluate(clamped))
    rig.scene.updateMatrixWorld(true)
  }, stop() {} }
}

function clothEntries(metadata, index, rest, actor) {
  const config = metadata.clothRig ?? metadata.animationRetarget?.clothRig
  const chains = config?.chains ?? (config?.cape?.length ? [{ anchor: config.anchor ?? 'chest', bones: config.cape }] : metadata.animationRetarget?.cape ? [metadata.animationRetarget.cape] : [])
  const entries = [], seen = new Set()
  for (const chain of chains) {
    const anchor = index.get(chain.anchor ?? 'chest')
    if (!anchor) throw Error(`Missing cloth anchor ${chain.anchor ?? 'chest'}`)
    for (const [i, item] of chain.bones.entries()) {
      const name = typeof item === 'string' ? item : item.name, bone = index.get(name)
      const follow = (typeof item === 'object' ? item.follow : undefined) ?? chain.follow?.[i] ?? 1
      if (!bone?.isBone || !Number.isFinite(follow) || follow < 0 || follow > 1 || seen.has(name)) throw Error(`Invalid cloth helper ${name}`)
      const actorInverse = rest.get(actor).worldQuaternion.clone().invert()
      seen.add(name); entries.push({ bone, anchor, actor, follow,
        restActor: actorInverse.clone().multiply(rest.get(bone).worldQuaternion),
        anchorInverse: actorInverse.multiply(rest.get(anchor).worldQuaternion).invert(),
      })
    }
  }
  // Parents must be written before children even if metadata lists chains out of order.
  const depth = bone => { let n = 0; for (; bone.parent; bone = bone.parent) n++; return n }
  return entries.sort((a, b) => depth(a.bone) - depth(b.bone))
}

function clothFrame({ actor, anchor, anchorInverse }) {
  const actorWorld = rotation(actor)
  const delta = actorWorld.clone().invert().multiply(rotation(anchor)).multiply(anchorInverse)
  const direction = forward.clone().applyQuaternion(delta)
  const yaw = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), Math.atan2(direction.x, direction.z))
  return { actorWorld, delta, yaw }
}

function applyCloth(entries) {
  for (const entry of entries) {
    const { bone, follow, restActor } = entry, { actorWorld, delta, yaw } = clothFrame(entry)
    // A cape follows the full anatomical chest turn. Only its residual lean
    // is damped, in actor space, matching the runtime mounted helper contract.
    const lean = yaw.clone().invert().multiply(delta)
    const world = actorWorld.multiply(yaw).multiply(new T.Quaternion().slerp(lean, follow)).multiply(restActor)
    // Parent inversion cancels inherited chest motion, avoiding double rotation.
    bone.quaternion.copy(rotation(bone.parent).invert().multiply(world).normalize())
    bone.updateWorldMatrix(false, true)
  }
}

/** Measured, periodic run drape. The profile is target evidence, never a shared
 * locomotion/body correction. Main helpers are already replaced by the mounted
 * cloth layer, so mounted gait does not inherit a second trailing rotation. */
function runCapeProfile(metadata, entries, clip) {
  const config = metadata.animationRetarget?.capeRunProfile
  if (!config || clip.name !== 'run') return { apply() {}, summary: null }
  const samples = config.samples, maximum = config.maximumPitchRad ?? 1.2
  if (!Array.isArray(samples) || samples.length < 3 || !Number.isFinite(maximum) || maximum <= 0 || maximum > Math.PI / 2) throw Error('Invalid measured run cape profile')
  for (let i = 0; i < samples.length; i++) {
    const row = samples[i]
    if (!Array.isArray(row) || row.length !== 2 || !row.every(Number.isFinite) || row[0] < 0 || row[0] > 1 || row[1] < 0 || row[1] > maximum || (i && row[0] <= samples[i - 1][0])) throw Error('Invalid run cape profile sample')
  }
  if (samples[0][0] !== 0 || samples.at(-1)[0] !== 1 || Math.abs(samples[0][1] - samples.at(-1)[1]) > 1e-8) throw Error('Run cape profile must close periodically')
  const cape = ['cape_mid', 'cape_lower'].map(name => entries.find(entry => entry.bone.name === name))
  if (cape.some(entry => !entry) || cape[0].actor !== cape[1].actor || cape[0].anchor !== cape[1].anchor) throw Error('Run cape profile requires the measured mid/lower chest-follow chain')
  const summary = { method: 'Target-measured smooth periodic posterior swing; equal extra mid/lower pitch, upper fixed', interpolation: 'Linear between densely sampled smooth periodic measurements', sourceEvidence: config.sourceEvidence ?? null, maximumAllowedPitchRad: maximum, maximumAppliedPitchRad: 0, minimumAppliedPitchRad: Infinity, samples: samples.length }
  return { summary, apply(time) {
    const phase = T.MathUtils.clamp(time / clip.duration, 0, 1)
    let i = 1
    while (i < samples.length - 1 && samples[i][0] < phase) i++
    const [a, b] = [samples[i - 1], samples[i]], angle = T.MathUtils.lerp(a[1], b[1], (phase - a[0]) / (b[0] - a[0]))
    const frame = clothFrame(cape[0]), axis = new T.Vector3(1, 0, 0).applyQuaternion(frame.actorWorld.multiply(frame.yaw)), worlds = cape.map(entry => rotation(entry.bone))
    for (const [j, { bone }] of cape.entries()) {
      const world = new T.Quaternion().setFromAxisAngle(axis, angle).multiply(worlds[j])
      bone.quaternion.copy(rotation(bone.parent).invert().multiply(world).normalize()); bone.updateWorldMatrix(false, true)
    }
    summary.maximumAppliedPitchRad = Math.max(summary.maximumAppliedPitchRad, angle); summary.minimumAppliedPitchRad = Math.min(summary.minimumAppliedPitchRad, angle)
  } }
}

function skirtEntries(metadata, index, rest) {
  const config = metadata.animationRetarget?.skirt ?? metadata.clothRig?.skirt ?? [], pelvis = index.get('hips')
  const pelvisInverse = rest.get(pelvis).worldQuaternion.clone().invert()
  const entries = config.map(item => {
    const bone = index.get(item.name), thigh = index.get(item.thigh), knee = index.get(item.thigh?.replace('upper_leg_', 'lower_leg_'))
    if (!bone?.isBone || !thigh?.isBone || !knee?.isBone || !Number.isFinite(item.follow) || item.follow < 0 || item.follow > 1) throw Error(`Invalid skirt helper ${item.name}`)
    const restDirection = rest.get(knee).worldPosition.clone().sub(rest.get(thigh).worldPosition).normalize().applyQuaternion(pelvisInverse)
    return { bone, thigh, knee, follow: item.follow, restDirection, restPelvis: pelvisInverse.clone().multiply(rest.get(bone).worldQuaternion) }
  })
  const apronConfig = metadata.animationRetarget?.skirtApron ?? metadata.clothRig?.apron
  let apron
  if (apronConfig) {
    const name = typeof apronConfig === 'string' ? apronConfig : apronConfig.name, bone = index.get(name), follow = apronConfig.follow ?? .9
    if (!bone?.isBone || !entries.length || !Number.isFinite(follow) || follow < 0 || follow > 1) throw Error(`Invalid apron helper ${name}`)
    apron = { bone, follow, restPelvis: pelvisInverse.clone().multiply(rest.get(bone).worldQuaternion) }
  }
  return { pelvis, entries, apron, forwardLocal: forward.clone().applyQuaternion(pelvisInverse), downLocal: new T.Vector3(0, -1, 0).applyQuaternion(pelvisInverse), pitchAxis: new T.Vector3(1, 0, 0).applyQuaternion(pelvisInverse) }
}

function applySkirt({ pelvis, entries, apron, forwardLocal, downLocal, pitchAxis }) {
  const pelvisWorld = rotation(pelvis), pelvisInverse = pelvisWorld.clone().invert()
  let forwardFlexion = 0
  for (const { bone, thigh, knee, restDirection, restPelvis, follow } of entries) {
    const current = position(knee).sub(position(thigh)).normalize().applyQuaternion(pelvisInverse)
    const swing = new T.Quaternion().setFromUnitVectors(restDirection, current)
    const world = pelvisWorld.clone().multiply(new T.Quaternion().slerp(swing, follow)).multiply(restPelvis)
    bone.quaternion.copy(rotation(bone.parent).invert().multiply(world).normalize()); bone.updateWorldMatrix(false, true)
    const difference = Math.atan2(current.dot(forwardLocal), current.dot(downLocal)) - Math.atan2(restDirection.dot(forwardLocal), restDirection.dot(downLocal))
    forwardFlexion = Math.max(forwardFlexion, Math.atan2(Math.sin(difference), Math.cos(difference)))
  }
  if (apron) {
    const world = pelvisWorld.clone().multiply(new T.Quaternion().setFromAxisAngle(pitchAxis, -apron.follow * forwardFlexion)).multiply(apron.restPelvis)
    apron.bone.quaternion.copy(rotation(apron.bone.parent).invert().multiply(world).normalize()); apron.bone.updateWorldMatrix(false, true)
  }
}

/** Optional target-only cape floor constraint, measured on actual weighted vertices. */
function capeFloorSolver(target, metadata, entries) {
  const clearance = metadata.animationRetarget?.capeFloorClearanceM ?? metadata.clothRig?.groundClearanceM
  if (clearance === undefined) return { apply() {}, summary: null }
  const maximum = metadata.animationRetarget?.capeFloorMaxPitchRad ?? 1.2
  if (!Number.isFinite(clearance) || clearance < 0 || !Number.isFinite(maximum) || maximum <= 0 || maximum > Math.PI / 2) throw Error('Invalid cape floor constraint')
  const cape = entries.filter(entry => /^cape_/.test(entry.bone.name))
  if (!cape.length) return { apply() {}, summary: { clearanceM: clearance, enabled: false, reason: 'No cape helpers' } }
  if (cape.some(entry => entry.actor !== cape[0].actor || entry.anchor !== cape[0].anchor)) throw Error('Cape floor helpers must share an actor and chest anchor')
  const translationLimit = metadata.animationRetarget?.capeFloorMaxTranslationM ?? .15
  if (!Number.isFinite(translationLimit) || translationLimit < 0) throw Error('Invalid cape translation limit')
  const movable = ['cape_mid', 'cape_lower'].map(name => cape.find(entry => entry.bone.name === name)?.bone)
  if (movable.some(bone => !bone)) throw Error('Cape floor constraint requires measured mid/lower helpers')
  const translationBounds = movable.map(bone => Math.min(translationLimit, position(bone).distanceTo(position(bone.parent)) * .25))
  const names = new Set(cape.map(entry => entry.bone.name)), candidates = [], point = new T.Vector3()
  target.scene.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return
    const joints = mesh.geometry.attributes.skinIndex, weights = mesh.geometry.attributes.skinWeight, indices = []
    for (let i = 0; i < joints.count; i++) {
      let total = 0
      for (let j = 0; j < joints.itemSize; j++) if (names.has(mesh.skeleton.bones[joints.getComponent(i, j)]?.name)) total += weights.getComponent(i, j)
      if (total > 1e-4) indices.push(i)
    }
    if (indices.length) {
      const basePositions = new Float64Array(indices.length * 3), jointValues = new Uint32Array(indices.length * 4), weightValues = new Float64Array(indices.length * 4), sums = new Float64Array(indices.length), used = new Set()
      for (const [row, i] of indices.entries()) {
        point.fromBufferAttribute(mesh.geometry.attributes.position, i).applyMatrix4(mesh.bindMatrix); point.toArray(basePositions, row * 3)
        for (let j = 0; j < 4; j++) {
          const joint = joints.getComponent(i, j), weight = weights.getComponent(i, j)
          jointValues[row * 4 + j] = joint; weightValues[row * 4 + j] = weight; sums[row] += weight
          if (weight) used.add(joint)
        }
      }
      candidates.push({ mesh, indices, basePositions, jointValues, weightValues, sums, used: [...used], yRows: new Float64Array(mesh.skeleton.bones.length * 4), projection: new T.Matrix4(), matrix: new T.Matrix4() })
    }
  })
  if (!candidates.length) throw Error('Cape floor constraint has no cape-weighted target vertices')
  let lowestVertex = null
  const lowest = heights => {
    let minimum = Infinity
    let sample = 0
    for (const { mesh, indices, basePositions, jointValues, weightValues, sums, used, yRows, projection, matrix } of candidates) {
      // The same linear skin equation as applyBoneTransform, reduced to its
      // world-Y row once per used joint. Avoid repeating four matrix products
      // for every cape vertex at each bisection candidate.
      projection.multiplyMatrices(mesh.matrixWorld, mesh.bindMatrixInverse)
      for (const joint of used) {
        matrix.multiplyMatrices(mesh.skeleton.bones[joint].matrixWorld, mesh.skeleton.boneInverses[joint]).premultiply(projection)
        const e = matrix.elements, offset = joint * 4
        yRows[offset] = e[1]; yRows[offset + 1] = e[5]; yRows[offset + 2] = e[9]; yRows[offset + 3] = e[13]
      }
      for (let row = 0; row < indices.length; row++) {
        const x = basePositions[row * 3], y = basePositions[row * 3 + 1], z = basePositions[row * 3 + 2]
        let height = projection.elements[13] * (1 - sums[row])
        for (let j = 0; j < 4; j++) {
          const weight = weightValues[row * 4 + j]
          if (!weight) continue
          const offset = jointValues[row * 4 + j] * 4
          height += weight * (yRows[offset] * x + yRows[offset + 1] * y + yRows[offset + 2] * z + yRows[offset + 3])
        }
        if (heights) heights[sample] = height
        sample++
        if (height < minimum) {
          minimum = height
          lowestVertex = { mesh: mesh.name, vertexIndex: indices[row] }
        }
      }
    }
    if (!Number.isFinite(minimum)) throw Error('Non-finite cape floor measurement')
    return minimum
  }
  const summary = { enabled: true, clearanceM: clearance, pitchAxis: 'Chest-yaw-transformed actor lateral; posterior lift in the same frame as cape follow', maximumAllowedPitchRad: maximum, maximumAppliedPitchRad: 0, maximumUpperPitchRad: 0, maximumRemainingPenetrationM: 0, failedFloorSamples: 0, constrainedSamples: 0, upperAssistanceSamples: 0, translationSamples: 0, maximumAllowedTranslationM: { cape_mid: translationBounds[0], cape_lower: translationBounds[1] }, maximumAppliedTranslationM: { cape_mid: 0, cape_lower: 0 }, translationBound: 'At most one quarter of each measured bind parent/helper segment, capped by capeFloorMaxTranslationM (default .15 m)', sampledCapeVertices: candidates.reduce((sum, entry) => sum + entry.indices.length, 0), preferredPitchWeights: { cape_upper: 0, cape_mid: .5, cape_lower: 1 }, assistedPitchWeights: { cape_upper: .25, cape_mid: .5, cape_lower: 1 } }
  const baseHeights = new Float64Array(summary.sampledCapeVertices), midHeights = baseHeights.slice(), lowerHeights = baseHeights.slice()
  return { summary, apply(time) {
    const before = lowest()
    if (before >= clearance - 1e-7) return
    const bases = cape.map(entry => rotation(entry.bone)), frame = clothFrame(cape[0])
    const axis = new T.Vector3(1, 0, 0).applyQuaternion(frame.actorWorld.multiply(frame.yaw))
    let weights = summary.preferredPitchWeights
    const setPitch = angle => {
      for (const [i, { bone }] of cape.entries()) {
        const weight = weights[bone.name]
        if (weight === undefined) throw Error(`Cape floor pitch weight missing for ${bone.name}`)
        const world = new T.Quaternion().setFromAxisAngle(axis, angle * weight).multiply(bases[i])
        bone.quaternion.copy(rotation(bone.parent).invert().multiply(world).normalize()); bone.updateWorldMatrix(false, true)
      }
      target.scene.updateMatrixWorld(true)
    }
    // Search posterior lifts only. If no feasible pitch exists, keep the best
    // measured candidate and explicitly retain the residual penetration report.
    const search = () => {
      let low = 0, high = null, bestAngle = 0, bestFloor = before
      for (let i = 1; i <= 12; i++) {
        const angle = maximum * i / 12
        setPitch(angle); const floor = lowest()
        if (floor > bestFloor) { bestFloor = floor; bestAngle = angle }
        if (floor >= clearance) { high = angle; break }
        low = angle
      }
      if (high !== null) {
        for (let i = 0; i < 14; i++) {
          const middle = (low + high) / 2
          setPitch(middle)
          if (lowest() >= clearance) high = middle; else low = middle
        }
        bestAngle = high
      }
      setPitch(bestAngle)
      return { angle: bestAngle, floor: lowest(), feasible: high !== null }
    }
    let result = search()
    // Preserve the shoulder/upper cloak whenever mid/lower helpers suffice.
    if (!result.feasible) {
      weights = { ...summary.assistedPitchWeights }
      setPitch(maximum)
      if (lowest() >= clearance) {
        // Reach the mid/lower limit first, then introduce only the minimum
        // continuous upper contribution. A binary on/off .25 fallback pops.
        let low = 0, high = summary.assistedPitchWeights.cape_upper
        for (let i = 0; i < 14; i++) {
          weights.cape_upper = (low + high) / 2; setPitch(maximum)
          if (lowest() >= clearance) high = weights.cape_upper; else low = weights.cape_upper
        }
        weights.cape_upper = high; setPitch(maximum)
        result = { angle: maximum, floor: lowest(), feasible: true }; summary.upperAssistanceSamples++
      } else {
        const assisted = search()
        if (assisted.feasible || assisted.floor > result.floor) { result = assisted; summary.upperAssistanceSamples++ }
        else weights = summary.preferredPitchWeights
      }
    }
    setPitch(result.angle)
    if (lowest() < clearance - 1e-7 && translationLimit > 0) {
      const worldPositions = movable.map(position)
      const setOffsets = (mid, lower) => {
        for (const [i, bone] of movable.entries()) {
          const world = worldPositions[i].clone().add(new T.Vector3(0, i === 0 ? mid : lower, 0))
          bone.position.copy(bone.parent.worldToLocal(world)); bone.updateWorldMatrix(false, true)
        }
      }
      lowest(baseHeights)
      setOffsets(1, 0); lowest(midHeights)
      setOffsets(0, 1); lowest(lowerHeights)
      setOffsets(0, 0)
      // With rotations fixed, linear skinning is affine in these independent
      // world-up helper offsets. Solve the exact per-vertex inequalities,
      // preferring lower-only motion before the least required mid assistance.
      const required = (variable, other, offset) => {
        let amount = 0
        for (let i = 0; i < baseHeights.length; i++) {
          const deficit = clearance - baseHeights[i] - (other[i] - baseHeights[i]) * offset
          if (deficit <= 1e-8) continue
          const slope = variable[i] - baseHeights[i]
          if (slope <= 1e-9) return Infinity
          amount = Math.max(amount, deficit / slope)
        }
        return amount
      }
      let mid = 0, lower = required(lowerHeights, midHeights, 0)
      if (lower > translationBounds[1]) {
        mid = Math.min(translationBounds[0], required(midHeights, lowerHeights, translationBounds[1]))
        lower = required(lowerHeights, midHeights, mid)
      }
      mid = Math.min(translationBounds[0], mid > 0 ? mid + 1e-7 : 0)
      lower = Math.min(translationBounds[1], lower > 0 ? lower + 1e-7 : 0)
      setOffsets(mid, lower)
      summary.translationSamples++
      summary.maximumAppliedTranslationM.cape_mid = Math.max(summary.maximumAppliedTranslationM.cape_mid, mid)
      summary.maximumAppliedTranslationM.cape_lower = Math.max(summary.maximumAppliedTranslationM.cape_lower, lower)
    }
    summary.constrainedSamples++
    summary.maximumAppliedPitchRad = Math.max(summary.maximumAppliedPitchRad, result.angle)
    summary.maximumUpperPitchRad = Math.max(summary.maximumUpperPitchRad, result.angle * weights.cape_upper)
    const remaining = Math.max(0, clearance - lowest())
    if (remaining > 1e-6) summary.failedFloorSamples++
    if (remaining > summary.maximumRemainingPenetrationM) {
      summary.maximumRemainingPenetrationM = remaining
      summary.worstFailure = { time, remainingPenetrationM: remaining, ...lowestVertex }
    }
  } }
}

function soleSampler(target, metadata) {
  const mode = metadata.animationRetarget?.groundContact?.mode ?? 'plant'
  if (!['none', 'plant', 'floor'].includes(mode)) throw Error(`Unknown ground-contact mode ${mode}`)
  const clearance = metadata.animationRetarget?.groundContact?.clearanceM ?? 0
  if (!Number.isFinite(clearance)) throw Error('Invalid ground clearance')
  if (mode === 'none') return () => 0
  const candidates = []
  target.scene.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return
    const joints = mesh.geometry.attributes.skinIndex, weights = mesh.geometry.attributes.skinWeight, indices = []
    for (let i = 0; i < joints.count; i++) {
      let total = 0
      for (let j = 0; j < joints.itemSize; j++) if (/^(foot_|toe_)/.test(mesh.skeleton.bones[joints.getComponent(i, j)]?.name ?? '')) total += weights.getComponent(i, j)
      if (total > .5) indices.push(i)
    }
    if (indices.length) candidates.push({ mesh, indices })
  })
  if (!candidates.length) throw Error('No measured foot/toe-weighted vertices for ground contact; set groundContact.mode=none only if intentional')
  const point = new T.Vector3()
  return () => {
    let lowest = Infinity
    for (const { mesh, indices } of candidates) {
      mesh.skeleton.update()
      for (const i of indices) {
        point.fromBufferAttribute(mesh.geometry.attributes.position, i)
        mesh.applyBoneTransform(i, point); point.applyMatrix4(mesh.matrixWorld)
        lowest = Math.min(lowest, point.y)
      }
    }
    if (!Number.isFinite(lowest)) throw Error('Non-finite skinned sole measurement')
    return mode === 'floor' ? Math.max(0, clearance - lowest) : clearance - lowest
  }
}

/** Runtime bow actions retain their pelvis but replace leg tracks with the
 * locomotion legs. Grounding the raw bow alone can therefore sink the composed
 * idle stance. Cache the actual fitted sole surface through a full idle cycle
 * in pelvis-local space; no runtime root offset or leg rotation is introduced.
 * Midpoints supplement every exported idle key. Raw bow may legitimately hover,
 * just as the upstream clips do, because it is not the gameplay composition. */
function idleSoleEnvelope(target, idleClip) {
  if (!idleClip) throw Error('Bow contact requires the fitted idle clip')
  const saved = captureRest(target), hips = target.scene.getObjectByName('hips')
  if (!hips) throw Error('Bow contact requires hips')
  const tracks = idleClip.tracks.filter(track => /^(upper_leg_|lower_leg_|foot_|toe_)/.test(track.name))
  const keys = [...new Set(tracks.flatMap(track => [...track.times]))].sort((a, b) => a - b)
  const times = [...new Set([...keys, ...keys.slice(1).map((time, i) => (keys[i] + time) / 2)])].sort((a, b) => a - b)
  const sample = sampler(target, new T.AnimationClip('idle-sole-contact', idleClip.duration, tracks)), candidates = []
  target.scene.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return
    const joints = mesh.geometry.attributes.skinIndex, weights = mesh.geometry.attributes.skinWeight, indices = []
    for (let i = 0; i < joints.count; i++) {
      let total = 0
      for (let j = 0; j < joints.itemSize; j++) if (/^(foot_|toe_)/.test(mesh.skeleton.bones[joints.getComponent(i, j)]?.name ?? '')) total += weights.getComponent(i, j)
      if (total <= .5) continue
      for (let j = 0; j < joints.itemSize; j++) if (weights.getComponent(i, j) > 0 && !/^(hips|upper_leg_[lr]|lower_leg_[lr]|foot_[lr]|toe_[lr])$/.test(mesh.skeleton.bones[joints.getComponent(i, j)]?.name ?? '')) throw Error('Bow sole envelope contains a non-leg influence')
      indices.push(i)
    }
    if (indices.length) candidates.push({ mesh, indices })
  })
  if (!candidates.length || !times.length) throw Error('No fitted idle soles for bow contact')
  const point = new T.Vector3(), inverseHip = hips.matrixWorld.clone().invert(), coordinates = []
  for (const time of times) {
    sample.sample(time)
    for (const { mesh, indices } of candidates) for (const index of indices) {
      point.fromBufferAttribute(mesh.geometry.attributes.position, index)
      mesh.applyBoneTransform(index, point); point.applyMatrix4(mesh.matrixWorld).applyMatrix4(inverseHip)
      coordinates.push(point.x, point.y, point.z)
    }
  }
  saved.reset()
  const values = Float64Array.from(coordinates)
  return { samples: times.length, verticesPerSample: candidates.reduce((sum, entry) => sum + entry.indices.length, 0),
    correction(clearance) {
      const e = hips.matrixWorld.elements
      let lowest = Infinity
      for (let i = 0; i < values.length; i += 3) lowest = Math.min(lowest, e[1] * values[i] + e[5] * values[i + 1] + e[9] * values[i + 2] + e[13])
      return clearance - lowest
    },
  }
}

function recordsFor(target) {
  const records = []
  target.scene.traverse(bone => {
    if (bone.isBone && !/^(socket_|sole_|root$)/.test(bone.name)) records.push({ bone, values: [], positions: /^cape_(mid|lower)$/.test(bone.name) ? [] : null })
  })
  return records
}

function collect(records) { for (const record of records) { finiteQuaternion(record.bone.quaternion.clone(), record.values, record.bone.name); if (record.positions) record.positions.push(...record.bone.position.toArray()) } }
function tracksFor(records, times) { return records.flatMap(record => [new T.QuaternionKeyframeTrack(`${record.bone.name}.quaternion`, times, record.values), ...(record.positions ? [new T.VectorKeyframeTrack(`${record.bone.name}.position`, times, record.positions)] : [])]) }

export function bakeFactionClips({ source, target, sourceDocument, targetDocument, sourceMetadata, targetMetadata, fps = 60 }) {
  const sourceIndex = rigIndex(source, sourceDocument), targetIndex = rigIndex(target, targetDocument)
  for (const name of required) if (!sourceIndex.get(name)?.isBone || !targetIndex.get(name)?.isBone) throw Error(`Missing required source/target bone ${name}`)
  const sourceState = captureRest(source), targetState = captureRest(target)
  const cloth = clothEntries(targetMetadata, targetIndex, targetState.rest, target.scene), skirt = skirtEntries(targetMetadata, targetIndex, targetState.rest), measureSole = soleSampler(target, targetMetadata)
  const sourceHip = sourceIndex.get('hips'), targetHip = targetIndex.get('hips')
  const legLength = index => ['l', 'r'].reduce((sum, side) => sum + position(index.get(`upper_leg_${side}`)).distanceTo(position(index.get(`lower_leg_${side}`))) + position(index.get(`lower_leg_${side}`)).distanceTo(position(index.get(`foot_${side}`))), 0) / 2
  const verticalScale = legLength(targetIndex) / legLength(sourceIndex)
  const clips = [], diagnostics = [], sourceOrder = new Map(source.animations.map((clip, index) => [clip.name, index]))
  let bowSoles = null
  const bowContactConfig = targetMetadata.animationRetarget?.bowGroundContact
  const bowGroundContact = (typeof bowContactConfig === 'string' ? bowContactConfig : bowContactConfig?.policy) ?? 'idle-composition'
  if (!['idle-composition', 'raw'].includes(bowGroundContact)) throw Error('Invalid bow ground-contact policy')
  for (const clip of [...source.animations].sort((a, b) => Number(b.name === 'idle') - Number(a.name === 'idle'))) {
    if (clip.name === 'axeAttack1HFoot') continue // Rebuilt directly from Bandit on this target below.
    sourceState.reset(); targetState.reset()
    const binding = sourceMetadata.animations.embedded.find(entry => entry.clip === clip.name)
    if (!binding) throw Error(`Source clip has no provenance binding: ${clip.name}`)
    const pairs = makePairs(source, target, sourceIndex, targetIndex, sourceState.rest, targetState.rest, sourceMetadata, targetMetadata, clip.name)
    const capeFloor = capeFloorSolver(target, targetMetadata, cloth)
    const runCape = runCapeProfile(targetMetadata, cloth, clip)
    const mixedBow = /^bow(Load|Hold|Release)$/.test(clip.name) && bowGroundContact === 'idle-composition' && targetMetadata.animationRetarget?.groundContact?.mode !== 'none'
    if (mixedBow && !bowSoles) bowSoles = idleSoleEnvelope(target, clips.find(clip => clip.name === 'idle'))
    const records = recordsFor(target), times = sampledTimes(clip, binding, fps), sample = sampler(source, clip), hips = []
    let minCorrection = Infinity, maxCorrection = -Infinity, maxCompositionClearance = 0
    for (const time of times) {
      targetState.reset(); sample.sample(time)
      for (const { bone, from, conversion } of pairs) {
        bone.quaternion.copy(rotation(bone.parent).invert().multiply(rotation(from).multiply(conversion)).normalize())
        bone.updateWorldMatrix(false, true)
      }
      // Gameplay owns planar travel. Preserve vertical body motion, scaled by measured legs.
      const deltaY = (position(sourceHip).y - sourceState.rest.get(sourceHip).worldPosition.y) * verticalScale
      const world = position(targetHip).add(new T.Vector3(0, deltaY, 0))
      targetHip.position.copy(targetHip.parent.worldToLocal(world)); target.scene.updateMatrixWorld(true)
      let correction = /mounted/i.test(clip.name) ? 0 : measureSole()
      if (mixedBow) {
        const composed = bowSoles.correction(targetMetadata.animationRetarget?.groundContact?.clearanceM ?? 0)
        maxCompositionClearance = Math.max(maxCompositionClearance, composed - correction)
        correction = Math.max(correction, composed)
      }
      const planted = position(targetHip).add(new T.Vector3(0, correction, 0))
      targetHip.position.copy(targetHip.parent.worldToLocal(planted)); target.scene.updateMatrixWorld(true)
      applyCloth(cloth); applySkirt(skirt); capeFloor.apply(time); collect(records); hips.push(...targetHip.position.toArray())
      minCorrection = Math.min(minCorrection, correction); maxCorrection = Math.max(maxCorrection, correction)
    }
    sample.stop(); sourceState.reset(); targetState.reset()
    let baked = new T.AnimationClip(clip.name, clip.duration, [...tracksFor(records, times), new T.VectorKeyframeTrack(`${targetHip.name}.position`, times, hips)])
    if (runCape.summary) {
      // Refine only helper tracks on the already baked target motion. Keeping
      // the body's original time/value buffers avoids changing its interpolation
      // when dense contact-validation samples are added to the cape profile.
      const refineTimes = [...new Set([...times, ...targetMetadata.animationRetarget.capeRunProfile.samples.map(([phase]) => Math.fround(phase * clip.duration))])].sort((a, b) => a - b)
      const baseSample = sampler(target, baked), helperRecords = recordsFor(target).filter(record => /^cape_(mid|lower)$/.test(record.bone.name)), upper = target.scene.getObjectByName('cape_upper')
      for (const time of refineTimes) {
        targetState.reset(); baseSample.sample(time); runCape.apply(time)
        const fixedUpper = upper?.quaternion.clone()
        capeFloor.apply(time)
        if (fixedUpper && fixedUpper.toArray().some((value, i) => Math.abs(value - upper.quaternion.toArray()[i]) > 1e-8)) throw Error('Measured run profile unexpectedly requires upper-cape floor assistance')
        collect(helperRecords)
      }
      const replacements = new Map(tracksFor(helperRecords, refineTimes).map(track => [track.name, track]))
      baked = new T.AnimationClip(clip.name, clip.duration, baked.tracks.map(track => replacements.get(track.name) ?? track))
      runCape.summary.bakedHelperSamples = refineTimes.length
      baseSample.stop(); targetState.reset()
    }
    clips.push(baked)
    diagnostics.push({ clip: clip.name, duration: clip.duration, samples: times.length, groundCorrectionM: [minCorrection, maxCorrection], ...(mixedBow ? { bowGroundContact: { method: 'Whole fitted idle-leg cycle composed under authored bow pelvis; raw bow may hover', idleSamples: bowSoles.samples, soleVerticesPerSample: bowSoles.verticesPerSample, maximumClearanceRestoredM: maxCompositionClearance } } : {}), mappedBones: pairs.map(pair => pair.bone.name), capeFloor: capeFloor.summary, ...(runCape.summary ? { runCape: runCape.summary } : {}) })
  }
  clips.sort((a, b) => sourceOrder.get(a.name) - sourceOrder.get(b.name)); diagnostics.sort((a, b) => sourceOrder.get(a.clip) - sourceOrder.get(b.clip))
  return { clips, diagnostics, verticalScale }
}

/** Resolve the existing project additive death once into a target-only normal
 * clip. Gameplay still owns the actor/capsule transform and the death clock. */
export function bakeProjectDeathClip({ sourceClip, target, targetDocument, targetMetadata, fps = 60, clearanceM = 0 }) {
  if (sourceClip.name !== 'death' || sourceClip.blendMode !== T.AdditiveAnimationBlendMode || !Number.isFinite(clearanceM) || clearanceM < 0) throw Error('Expected the existing additive project death and a nonnegative clearance')
  const state = captureRest(target), index = rigIndex(target, targetDocument), hips = index.get('hips')
  if (!hips?.isBone) throw Error('Target death has no hips')
  const channels = sourceClip.tracks.map(track => {
    const dot = track.name.lastIndexOf('.'), bone = index.get(track.name.slice(0, dot)), property = track.name.slice(dot + 1)
    if (!bone?.isBone || !['position', 'quaternion'].includes(property)) throw Error(`Unsupported authored death channel ${track.name}`)
    return { bone, property, sample: track.createInterpolant() }
  })
  const cloth = clothEntries(targetMetadata, index, state.rest, target.scene), skirt = skirtEntries(targetMetadata, index, state.rest), records = recordsFor(target)
  // Living capes resist torso lean, but that rule would leave a dead cape
  // hanging vertically through the ground and lift the entire corpse. Let
  // helpers follow the authored prone chest completely during death only.
  for (const entry of cloth) entry.follow = 1
  const meshes = [], point = new T.Vector3()
  target.scene.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return
    const joints = mesh.geometry.attributes.skinIndex, weights = mesh.geometry.attributes.skinWeight, torso = new Uint8Array(joints.count), feet = new Uint8Array(joints.count)
    for (let i = 0; i < joints.count; i++) {
      let amount = 0, left = 0, right = 0
      for (let j = 0; j < joints.itemSize; j++) {
        const name = mesh.skeleton.bones[joints.getComponent(i, j)].name, weight = weights.getComponent(i, j)
        if (/^(hips|spine|chest|upper_chest)$/.test(name)) amount += weight
        if (/^(foot|toe)_l$/.test(name)) left += weight
        if (/^(foot|toe)_r$/.test(name)) right += weight
      }
      torso[i] = amount > .5 ? 1 : 0
      feet[i] = left > .5 ? 1 : right > .5 ? 2 : left + right < .1 ? 0 : 3
    }
    meshes.push({ mesh, torso, feet })
  })
  if (!meshes.length) throw Error('No target skin for measured death contact')
  const measure = () => {
    let lowest = Infinity, torsoLowest = Infinity, bodyLowest = Infinity
    const footLowest = [Infinity, Infinity]
    for (const { mesh, torso, feet } of meshes) for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
      point.fromBufferAttribute(mesh.geometry.attributes.position, i); mesh.applyBoneTransform(i, point); point.applyMatrix4(mesh.matrixWorld)
      lowest = Math.min(lowest, point.y)
      if (torso[i]) torsoLowest = Math.min(torsoLowest, point.y)
      if (feet[i] === 0) bodyLowest = Math.min(bodyLowest, point.y)
      if (feet[i] === 1 || feet[i] === 2) footLowest[feet[i] - 1] = Math.min(footLowest[feet[i] - 1], point.y)
    }
    if (!Number.isFinite(lowest) || !Number.isFinite(torsoLowest)) throw Error('Non-finite death contact measurement')
    return { lowest, torsoLowest, bodyLowest, footLowest }
  }
  const evaluateAuthored = time => {
    state.reset()
    for (const { bone, property, sample } of channels) {
      const value = sample.evaluate(time), rest = state.rest.get(bone)
      if (property === 'quaternion') bone.quaternion.copy(rest.quaternion).multiply(new T.Quaternion().fromArray(value)).normalize()
      else bone.position.copy(rest.position).add(new T.Vector3().fromArray(value))
    }
    target.scene.updateMatrixWorld(true); applyCloth(cloth); applySkirt(skirt)
  }
  // The shared generic fall leaves standing ankles extended toward the floor.
  // Find the smallest bounded plantar-flexion that allows another body surface
  // to settle. Apply it only late in this target clip, never in the source.
  const startPhase = targetMetadata.animationRetarget?.deathSettleStartPhase ?? .55
  const maxAngle = targetMetadata.animationRetarget?.deathAnkleMaxPitchRad ?? 1.2
  if (!(startPhase >= 0 && startPhase < 1) || !(maxAngle > 0 && maxAngle <= Math.PI / 2)) throw Error('Invalid death ankle-settle configuration')
  const ankleBones = ['foot_l', 'foot_r'].map(name => index.get(name))
  if (ankleBones.some(bone => !bone?.isBone)) throw Error('Death ankle-settle requires both fitted feet')
  const axis = new T.Vector3(1, 0, 0).applyQuaternion(rotation(target.scene))
  const setAnkle = (bone, world, angle) => {
    bone.quaternion.copy(rotation(bone.parent).invert().multiply(new T.Quaternion().setFromAxisAngle(axis, angle)).multiply(world).normalize())
    bone.updateWorldMatrix(false, true)
  }
  evaluateAuthored(sourceClip.duration)
  const finalContact = measure(), ankleAngles = [], unmet = []
  for (const [side, bone] of ankleBones.entries()) {
    const world = rotation(bone), desiredFloor = finalContact.bodyLowest
    let low = 0, high = null, bestAngle = 0, bestFloor = finalContact.footLowest[side]
    if (bestFloor < desiredFloor) for (let step = 1; step <= 12; step++) {
      const angle = maxAngle * step / 12
      setAnkle(bone, world, angle); const floor = measure().footLowest[side]
      if (floor > bestFloor) { bestFloor = floor; bestAngle = angle }
      if (floor >= desiredFloor) { high = angle; break }
      low = angle
    }
    if (high !== null) {
      for (let step = 0; step < 14; step++) {
        const angle = (low + high) / 2
        setAnkle(bone, world, angle)
        if (measure().footLowest[side] >= desiredFloor) high = angle; else low = angle
      }
      bestAngle = high
    }
    setAnkle(bone, world, bestAngle); ankleAngles.push(bestAngle)
    unmet.push(Math.max(0, desiredFloor - measure().footLowest[side]))
  }
  const times = sampledTimes(sourceClip, { events: Object.fromEntries([.05, .28, .55, .85, startPhase].map(phase => [String(phase), sourceClip.duration * phase])) }, fps), positions = [], samples = []
  for (const time of times) {
    evaluateAuthored(time)
    const authoredFloor = measure().lowest
    const alpha = T.MathUtils.clamp((time / sourceClip.duration - startPhase) / (1 - startPhase), 0, 1), settle = alpha * alpha * (3 - 2 * alpha)
    for (const [side, bone] of ankleBones.entries()) setAnkle(bone, rotation(bone), ankleAngles[side] * settle)
    // Cloth participates in the same measured contact, so there is no extra
    // cape/pelvis offset to apply again in the runtime death path.
    const before = measure(), correction = clearanceM - before.lowest
    hips.position.copy(hips.parent.worldToLocal(position(hips).add(new T.Vector3(0, correction, 0))))
    target.scene.updateMatrixWorld(true)
    const after = measure()
    collect(records); positions.push(...hips.position.toArray())
    samples.push({ time, phase: time / sourceClip.duration, authoredFloorM: authoredFloor, relaxedFloorM: before.lowest, groundCorrectionM: correction, adaptedFloorM: after.lowest, torsoClearanceM: after.torsoLowest - clearanceM })
  }
  state.reset()
  const clip = new T.AnimationClip('death', sourceClip.duration, [...tracksFor(records, times), new T.VectorKeyframeTrack(`${hips.name}.position`, times, positions)])
  return { clip, diagnostics: { clip: 'death', source: 'createProjectAnimationClips()', duration: sourceClip.duration, clearanceM, deathClothFollow: 1, ankleSettle: { startPhase, endPhase: 1, maximumAllowedPitchRad: maxAngle, finalPitchRad: { left: ankleAngles[0], right: ankleAngles[1] }, finalUnmetContactM: { left: unmet[0], right: unmet[1] }, interpolation: 'smoothstep; original early joint motion retained' }, samples, maximumRemainingPenetrationM: Math.max(0, ...samples.map(sample => clearanceM - sample.adaptedFloorM)), finalTorsoClearanceM: samples.at(-1).torsoClearanceM, contact: 'Whole target skin including cloth; bounded late ankle relaxation only, with residual torso clearance explicitly reported' } }
}

/** Target-only form of retarget-bandit-foot-axe.mjs; retains its existing event/melee clock. */
export function bakeBanditFootClip({ source, target, sourceDocument, targetDocument, sourceMetadata, targetMetadata, idle, binding, fps = 60 }) {
  const sourceIndex = rigIndex(source, sourceDocument), targetIndex = rigIndex(target, targetDocument)
  const sourceState = captureRest(source), targetState = captureRest(target)
  const sourceClip = source.animations.find(clip => clip.name === 'swordSlash')
  const sourceBinding = sourceMetadata.animations.embedded.find(clip => clip.clip === 'swordSlash')
  const duration = binding.duration, hit = binding.events?.hit, sourceHit = sourceBinding.events?.hit, sourceDuration = sourceBinding.duration
  if (!sourceClip || !idle || !(hit > 0 && hit < duration) || !(sourceHit > 0 && sourceHit < sourceDuration)) throw Error('Invalid Bandit source/target event clock')
  const names = new Set(['spine', 'chest', 'upper_chest', 'neck', 'head', 'upper_arm_r', 'lower_arm_r', 'hand_r'])
  const hand = sourceIndex.get('hand_r'), middle = sourceIndex.get('RightHandMiddle1'), grip = sourceIndex.get('hammer_grip'), tip = sourceIndex.get('hammer_tip')
  if (!hand || !middle || !grip || !tip) throw Error('Bandit measured hammer/hand landmarks missing')
  const shaft = position(tip).sub(position(grip)).applyQuaternion(rotation(hand).invert())
  const finger = position(middle).sub(position(hand)).applyQuaternion(rotation(hand).invert())
  const sourceFrames = { ...sourceMetadata, swordGripFrames: { lod0: { gripAxisLocal: shaft.toArray(), fingerDirection: finger.toArray() } } }
  const pairs = makePairs(source, target, sourceIndex, targetIndex, sourceState.rest, targetState.rest, sourceFrames, targetMetadata, 'axeAttack1HFoot', names)
  const cloth = clothEntries(targetMetadata, targetIndex, targetState.rest, target.scene), skirt = skirtEntries(targetMetadata, targetIndex, targetState.rest), records = recordsFor(target), times = [], hips = [], targetHip = targetIndex.get('hips')
  const capeFloor = capeFloorSolver(target, targetMetadata, cloth)
  const sourceSample = sampler(source, sourceClip), targetSample = sampler(target, idle)
  const count = Math.max(120, Math.ceil(duration * fps))
  const clock = [...new Set([0, duration, ...Object.values(binding.events ?? {}), ...Array.from({ length: count + 1 }, (_, i) => i / count * duration)].map(Math.fround))].sort((a, b) => a - b)
  const smooth = value => { const v = T.MathUtils.clamp(value, 0, 1); return v * v * (3 - 2 * v) }
  for (const time of clock) {
    targetState.reset()
    const sourceTime = time <= hit ? time / hit * sourceHit : sourceHit + (time - hit) / (duration - hit) * (sourceDuration - sourceHit)
    sourceSample.sample(Math.min(sourceClip.duration, sourceTime)); targetSample.sample(time / duration * Math.min(idle.duration, .8))
    // These normalized envelopes are the established Bandit foot bake's recovery profile.
    const phase = time / duration, weight = smooth(phase / (1 / 6)) * (1 - smooth((phase - .8125) / .1875))
    for (const { bone, from, conversion } of pairs) {
      const q = rotation(bone.parent).invert().multiply(rotation(from).multiply(conversion)).normalize()
      bone.quaternion.slerp(q, weight); bone.updateWorldMatrix(false, true)
    }
    applyCloth(cloth); applySkirt(skirt); capeFloor.apply(time); collect(records); hips.push(...targetHip.position.toArray()); times.push(time)
  }
  sourceSample.stop(); targetSample.stop(); sourceState.reset(); targetState.reset()
  const clip = new T.AnimationClip('axeAttack1HFoot', duration, [...tracksFor(records, times), new T.VectorKeyframeTrack(`${targetHip.name}.position`, times, hips)])
  clip.bakeDiagnostics = { clip: clip.name, duration, samples: times.length, capeFloor: capeFloor.summary }
  return clip
}

/** Signature excludes geometry and node indices, but includes socket semantics and every bind transform. */
export function rigSignature(rig, document) {
  const entries = [], inverseBinds = new Set()
  rig.scene.updateMatrixWorld(true)
  rig.scene.traverse(object => {
    if (object.isSkinnedMesh) inverseBinds.add(JSON.stringify(object.skeleton.bones.map((bone, index) => [bone.name, object.skeleton.boneInverses[index].toArray()])))
    if (object.isBone || /^(socket_|sole_)/.test(object.name)) entries.push({
      name: object.name, parent: object.parent?.name, position: object.position.toArray(), quaternion: object.quaternion.toArray(), scale: object.scale.toArray(),
    })
  })
  const names = new Set(entries.map(entry => entry.name))
  if (names.size !== entries.length) throw Error('Duplicate bone/socket names')
  const skins = (document.skins ?? []).map(skin => skin.joints.map(index => document.nodes[index].name).join('|')).sort()
  return JSON.stringify({ entries: entries.sort((a, b) => a.name.localeCompare(b.name)), skins, inverseBinds: [...inverseBinds].sort() })
}

/** Texture/animation-independent guards for a measured target contact profile.
 * Hash tightly packed accessor elements, not bufferView offsets or padding. */
export function factionHumanoidBindDigests(asset, rig) {
  const hash = createHash('sha256'), sizes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }, dimensions = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }
  for (const [meshIndex, mesh] of asset.document.meshes.entries()) for (const [primitiveIndex, primitive] of mesh.primitives.entries()) {
    hash.update(JSON.stringify({ meshIndex, primitiveIndex, mode: primitive.mode ?? 4 }))
    for (const semantic of ['POSITION', 'JOINTS_0', 'WEIGHTS_0', 'indices']) {
      const index = semantic === 'indices' ? primitive.indices : primitive.attributes?.[semantic]
      if (index === undefined) throw Error(`Measured run profile requires ${semantic}`)
      const accessor = asset.document.accessors[index], view = asset.document.bufferViews[accessor.bufferView]
      const elementBytes = sizes[accessor.componentType] * dimensions[accessor.type]
      if (accessor.sparse || !view || (view.buffer ?? 0) !== 0 || !Number.isFinite(elementBytes)) throw Error(`Unsupported guarded ${semantic} accessor`)
      hash.update(JSON.stringify({ semantic, type: accessor.type, componentType: accessor.componentType, count: accessor.count, normalized: accessor.normalized ?? false }))
      const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0), stride = view.byteStride ?? elementBytes
      for (let row = 0; row < accessor.count; row++) {
        const offset = start + row * stride
        if (offset + elementBytes > asset.binary.length) throw Error('Guarded accessor exceeds binary payload')
        hash.update(asset.binary.subarray(offset, offset + elementBytes))
      }
    }
  }
  hash.update(JSON.stringify(asset.document.nodes.filter(node => node.mesh !== undefined).map(node => ({ name: node.name, matrix: node.matrix, translation: node.translation, rotation: node.rotation, scale: node.scale }))))
  return { geometrySkinSha256: hash.digest('hex'), restRigSha256: createHash('sha256').update(rigSignature(rig, asset.document)).digest('hex') }
}

/** Small structural pose sweep; a bound measurement is not visual acceptance. */
export function measureClipBounds(target, clips) {
  const state = captureRest(target), meshes = [], point = new T.Vector3(), rows = []
  target.scene.traverse(object => { if (object.isSkinnedMesh) meshes.push(object) })
  for (const clip of clips) {
    const sample = sampler(target, clip), frames = []
    for (const phase of [0, .25, .5, .75, 1]) {
      state.reset(); sample.sample(clip.duration * phase)
      const box = new T.Box3()
      for (const mesh of meshes) {
        mesh.skeleton.update()
        for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
          point.fromBufferAttribute(mesh.geometry.attributes.position, i); mesh.applyBoneTransform(i, point); point.applyMatrix4(mesh.matrixWorld)
          if (![point.x, point.y, point.z].every(Number.isFinite)) throw Error(`Non-finite skinned vertex in ${clip.name}`)
          box.expandByPoint(point)
        }
      }
      frames.push({ phase, min: box.min.toArray(), max: box.max.toArray() })
    }
    sample.stop(); rows.push({ clip: clip.name, frames })
  }
  state.reset(); return rows
}

/** Exact constants only: no tolerance, key reduction, or interpolation changes. */
export function collapseConstantTracks(clips) {
  let collapsed = 0, savedSamples = 0
  const streamBytes = () => clips.reduce((sum, clip) => sum + clip.tracks.reduce((bytes, track) => bytes + track.times.byteLength + track.values.byteLength, 0), 0)
  const beforeAnimationStreamBytes = streamBytes()
  for (const clip of clips) clip.tracks = clip.tracks.map(track => {
    const size = track.getValueSize()
    if (track.times.length <= 2 || !track.values.every((value, index) => value === track.values[index % size])) return track
    const values = new Float32Array(size * 2)
    values.set(track.values.subarray(0, size)); values.set(track.values.subarray(0, size), size)
    collapsed++; savedSamples += track.times.length - 2
    return new track.constructor(track.name, new Float32Array([track.times[0], track.times.at(-1)]), values, track.getInterpolation())
  })
  return { collapsedTracks: collapsed, removedExactConstantSamples: savedSamples, beforeAnimationStreamBytes, afterConstantTrackStreamBytes: streamBytes() }
}

export function appendClips(asset, rig, clips, extras) {
  const document = structuredClone(asset.document), chunks = [asset.binary]
  document.accessors ??= []; document.bufferViews ??= []
  let offset = asset.binary.length
  const accessorCache = new Map()
  const append = (values, type) => {
    if ([...values].some(value => !Number.isFinite(value))) throw Error('Non-finite animation samples')
    const bytes = Buffer.from(values.buffer, values.byteOffset, values.byteLength)
    const key = `${type}:${values.length}:${createHash('sha256').update(bytes).digest('hex')}`
    const cached = accessorCache.get(key)
    if (cached && cached.bytes.equals(bytes)) return cached.index
    const padding = (4 - offset % 4) % 4
    if (padding) { chunks.push(Buffer.alloc(padding)); offset += padding }
    const view = document.bufferViews.length
    document.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length }); chunks.push(bytes); offset += bytes.length
    const accessor = { bufferView: view, componentType: 5126, count: values.length / ({ SCALAR: 1, VEC3: 3, VEC4: 4 }[type]), type }
    if (type === 'SCALAR') { accessor.min = [values[0]]; accessor.max = [values.at(-1)] }
    document.accessors.push(accessor)
    const index = document.accessors.length - 1
    accessorCache.set(key, { bytes, index }); return index
  }
  document.animations = clips.map(clip => {
    const samplers = [], channels = []
    for (const track of clip.tracks) {
      const split = track.name.lastIndexOf('.'), name = track.name.slice(0, split), property = track.name.slice(split + 1)
      const object = rig.scene.getObjectByName(name), node = object && rig.parser.associations.get(object)?.nodes
      if (node === undefined || !['position', 'quaternion'].includes(property)) throw Error(`Invalid output track ${track.name}`)
      channels.push({ sampler: samplers.length, target: { node, path: property === 'position' ? 'translation' : 'rotation' } })
      samplers.push({ input: append(track.times, 'SCALAR'), output: append(track.values, property === 'position' ? 'VEC3' : 'VEC4'), interpolation: 'LINEAR' })
    }
    return { name: clip.name, samplers, channels }
  })
  document.asset.extras ??= {}; document.asset.extras.factionHumanoidAnimationBuild = extras
  document.buffers[0].byteLength = offset
  return { document, binary: Buffer.concat(chunks) }
}
