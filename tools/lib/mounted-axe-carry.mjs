import * as THREE from 'three'

function basis(along, front) {
  const y = along.clone().normalize(), z = front.clone().addScaledVector(y, -front.dot(y)).normalize()
  const x = new THREE.Vector3().crossVectors(y, z).normalize()
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z))
}

/** Carry the same anatomical arm/palm pose on a different humanoid. The target
 * keeps its torso/neck idle and limb lengths; no local quaternion is copied.
 * This dedicated mounted-axe clip leaves sword/lance and foot idle untouched.
 */
export function retargetMountedAxeCarry(source, target, sourceFrames, targetFrames) {
  source.scene.updateMatrixWorld(true); target.scene.updateMatrixWorld(true)
  const names = ['upper_arm_r', 'lower_arm_r', 'hand_r', 'upper_arm_l', 'lower_arm_l', 'hand_l']
  const pairs = names.map(name => {
    const from = source.scene.getObjectByName(name), to = target.scene.getObjectByName(name)
    const local = (scene, bone, frames) => {
      if (name.startsWith('hand_')) {
        const frame = frames[name.endsWith('_r') ? 'right' : 'left']
        const thumb = new THREE.Vector3(...frame.gripAxisLocal).normalize()
        const finger = new THREE.Vector3(...frame.fingerDirection).normalize()
        finger.addScaledVector(thumb, -thumb.dot(finger)).normalize()
        return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(thumb, finger, new THREE.Vector3().crossVectors(thumb, finger)))
      }
      const child = scene.getObjectByName(name.startsWith('upper_arm') ? name.replace('upper_arm', 'lower_arm') : name.replace('lower_arm', 'hand'))
      const along = child.getWorldPosition(new THREE.Vector3()).sub(bone.getWorldPosition(new THREE.Vector3()))
      return bone.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(basis(along, new THREE.Vector3(0, 0, 1)))
    }
    return { from, to, sourceLocal: local(source.scene, from, sourceFrames), targetInverse: local(target.scene, to, targetFrames).invert(), values: [] }
  })
  const sourceIdle = source.animations.find(c => c.name === 'idle'), targetIdle = target.animations.find(c => c.name === 'idle')
  const sourceMixer = new THREE.AnimationMixer(source.scene), targetMixer = new THREE.AnimationMixer(target.scene)
  const actions = [[sourceMixer, sourceIdle], [targetMixer, targetIdle]].map(([mixer, clip]) => {
    const action = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play(); return action
  })
  const times = [], count = Math.round(targetIdle.duration * 30)
  for (let i = 0; i <= count; i++) {
    const time = targetIdle.duration * i / count
    actions.forEach(a => a.paused = false)
    sourceMixer.setTime(time / targetIdle.duration * sourceIdle.duration); targetMixer.setTime(time)
    source.scene.updateMatrixWorld(true); target.scene.updateMatrixWorld(true)
    for (const pair of pairs) {
      const world = pair.from.getWorldQuaternion(new THREE.Quaternion()).multiply(pair.sourceLocal).multiply(pair.targetInverse)
      const q = pair.to.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world).normalize()
      if (pair.values.length && q.dot(new THREE.Quaternion().fromArray(pair.values, pair.values.length - 4)) < 0) q.set(-q.x, -q.y, -q.z, -q.w)
      q.toArray(pair.values, pair.values.length); pair.to.quaternion.copy(q); pair.to.updateWorldMatrix(false, true)
    }
    times.push(time)
  }
  sourceMixer.stopAllAction(); targetMixer.stopAllAction()
  return new THREE.AnimationClip('axeMountedIdle', targetIdle.duration, [
    ...targetIdle.tracks.filter(t => /^(spine|chest|upper_chest|clavicle_|neck|head)/.test(t.name)),
    ...pairs.map(p => new THREE.QuaternionKeyframeTrack(`${p.to.name}.quaternion`, times, p.values)),
  ])
}
