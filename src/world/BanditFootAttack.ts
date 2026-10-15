import * as THREE from 'three'
import type { SwordGripFrame } from './SwordAttachmentContract'

const BODY = ['spine', 'chest', 'upper_chest', 'neck', 'head', 'upper_arm_r', 'lower_arm_r', 'hand_r']
const position = (node: THREE.Object3D) => node.getWorldPosition(new THREE.Vector3())
const rotation = (node: THREE.Object3D) => node.getWorldQuaternion(new THREE.Quaternion())

function basis(along: THREE.Vector3, front: THREE.Vector3): THREE.Quaternion {
  const y = along.clone().normalize()
  const z = front.clone().addScaledVector(y, -front.dot(y)).normalize()
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(y, z), y, z))
}

function gripBasis(shaft: THREE.Vector3, finger: THREE.Vector3): THREE.Quaternion {
  const y = shaft.clone().normalize()
  const x = finger.clone().addScaledVector(y, -finger.dot(y)).normalize()
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, new THREE.Vector3().crossVectors(x, y)))
}

/** Adapt the shipped Bandit strike once per canonical legacy LOD at preload.
 * Mirrors the anatomical mapping used by tools/retarget-bandit-foot-axe.mjs.
 * No new GLB, per-actor retarget, root turn or gameplay clock is introduced.
 * Only cloned transforms are sampled; shared mesh/skin/material data is untouched. */
export function createBanditFootAttack(sourceRoot: THREE.Object3D, sourceClip: THREE.AnimationClip,
  targetRoot: THREE.Object3D, idle: THREE.AnimationClip, frame: SwordGripFrame,
  duration: number, hit: number): THREE.AnimationClip {
  const source = sourceRoot.clone(true), target = targetRoot.clone(true)
  source.updateMatrixWorld(true); target.updateMatrixWorld(true)
  const required = (root: THREE.Object3D, name: string) => {
    const node = root.getObjectByName(name)
    if (!node) throw new Error(`Bandit foot attack requires ${name}`)
    return node
  }
  const hand = required(source, 'hand_r')
  const sourceGrip = rotation(hand).invert().multiply(gripBasis(
    position(required(source, 'hammer_tip')).sub(position(required(source, 'hammer_grip'))),
    position(required(source, 'RightHandMiddle1')).sub(position(hand)),
  ))
  const targetGrip = gripBasis(new THREE.Vector3(...frame.gripAxisLocal), new THREE.Vector3(...frame.fingerDirection))
  const pairs = BODY.filter(name => target.getObjectByName(name)).map(name => {
    const bone = required(target, name), from = required(source, name)
    let conversion = rotation(from).invert().multiply(rotation(bone))
    if (name === 'hand_r') conversion = sourceGrip.clone().multiply(targetGrip.clone().invert())
    else if (name === 'upper_arm_r' || name === 'lower_arm_r') {
      const next = name === 'upper_arm_r' ? 'lower_arm_r' : 'hand_r'
      conversion = rotation(from).invert().multiply(basis(position(required(source, next)).sub(position(from)), new THREE.Vector3(0, 0, 1)))
        .multiply(basis(position(required(target, next)).sub(position(bone)), new THREE.Vector3(0, 0, 1)).invert()).multiply(rotation(bone))
    }
    return { bone, from, conversion }
  })
  const records = new Map(idle.tracks.map(track => {
    const dot = track.name.lastIndexOf('.')
    const property = track.name.slice(dot + 1)
    if (property !== 'position' && property !== 'quaternion' && property !== 'scale') throw new Error(`Unsupported idle track ${track.name}`)
    return [track.name, { node: required(target, track.name.slice(0, dot)), property, values: [] as number[] }] as const
  }))
  for (const { bone } of pairs) records.set(`${bone.name}.quaternion`, { node: bone, property: 'quaternion', values: [] })
  const sourceMixer = new THREE.AnimationMixer(source), targetMixer = new THREE.AnimationMixer(target)
  const action = sourceMixer.clipAction(sourceClip)
  action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play()
  targetMixer.clipAction(idle).play()
  const smooth = (x: number) => { const t = THREE.MathUtils.clamp(x, 0, 1); return t * t * (3 - 2 * t) }
  const times: number[] = []
  try {
    for (let i = 0; i <= 120; i++) {
      const t = i / 120 * duration, seconds = i / 120 * .48
      // Align Bandit's physical contact to the target's existing event clock.
      const sourceTime = t <= hit ? t / hit * .252 : .252 + (t - hit) / (duration - hit) * (.48 - .252)
      action.paused = false; sourceMixer.setTime(sourceTime); source.updateMatrixWorld(true)
      targetMixer.setTime(i / 120 * Math.min(idle.duration, .8)); target.updateMatrixWorld(true)
      const weight = smooth(seconds / .08) * (1 - smooth((seconds - .39) / .09))
      for (const { bone, from, conversion } of pairs) {
        const q = rotation(bone.parent!).invert().multiply(rotation(from).multiply(conversion)).normalize()
        bone.quaternion.slerp(q, weight); bone.updateWorldMatrix(false, true)
      }
      for (const record of records.values()) {
        const value = record.node[record.property].toArray()
        if (record.property === 'quaternion' && record.values.length
          && new THREE.Quaternion(value[0], value[1], value[2], value[3]).dot(new THREE.Quaternion(
            record.values[record.values.length - 4], record.values[record.values.length - 3],
            record.values[record.values.length - 2], record.values[record.values.length - 1])) < 0) {
          for (let j = 0; j < 4; j++) value[j] *= -1
        }
        if (!value.every(Number.isFinite)) throw new Error(`Non-finite Bandit track ${record.node.name}`)
        record.values.push(...value)
      }
      times.push(t)
    }
  } finally {
    sourceMixer.stopAllAction(); sourceMixer.uncacheRoot(source)
    targetMixer.stopAllAction(); targetMixer.uncacheRoot(target)
  }
  return new THREE.AnimationClip('axeAttack1HFoot', duration, [...records].map(([name, record]) =>
    record.property === 'quaternion' ? new THREE.QuaternionKeyframeTrack(name, times, record.values)
      : new THREE.VectorKeyframeTrack(name, times, record.values)))
}
