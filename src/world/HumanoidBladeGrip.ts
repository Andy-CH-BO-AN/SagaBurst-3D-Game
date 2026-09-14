import * as THREE from 'three'

/** Author a shared, optional closed-hand shape in the hand's bind coordinates. */
export function prepareBladeGrip(scene: THREE.Object3D, faction: 'viking' | 'roman'): void {
  const hand = scene.getObjectByName('hand_r')!
  const palmZ = faction === 'roman' ? -0.062 : -0.04
  const knuckleY = faction === 'roman' ? 0.065 : 0.10
  const curlSign = faction === 'roman' ? 1 : -1
  const radius = 0.038
  hand.userData.bladeGripCenter = [-0.025, knuckleY, palmZ + curlSign * radius]
  // Calibrated in bind-hand front/back views, not inferred from bone names.
  hand.userData.bladeGripAxis = faction === 'roman' ? -1 : 1
  const leftHand = scene.getObjectByName('hand_l')
  if (leftHand) leftHand.userData.thumbAxis = faction === 'roman' ? 1 : -1
  scene.traverse((object) => {
    if (!(object instanceof THREE.SkinnedMesh)) return
    const handIndex = object.skeleton.bones.indexOf(hand as THREE.Bone)
    if (handIndex < 0) return
    const geometry = object.geometry
    const { position, skinIndex, skinWeight } = geometry.attributes
    const toHand = new THREE.Matrix4().multiplyMatrices(object.skeleton.boneInverses[handIndex], object.bindMatrix)
    const fromHand = toHand.clone().invert()
    const target = new Float32Array(position.count * 3)
    const point = new THREE.Vector3()
    const original = new THREE.Vector3()
    let changed = false
    for (let i = 0; i < position.count; i++) {
      original.fromBufferAttribute(position, i)
      point.copy(original).applyMatrix4(toHand)
      let weight = 0
      for (let k = 0; k < 4; k++) {
        if (skinIndex.getComponent(i, k) === handIndex) weight += skinWeight.getComponent(i, k)
      }
      // Bend the distal fingers around the cylindrical grip, leaving the wrist
      // and palm intact. No finger bones survived the canonical skeleton export.
      const restZ = palmZ - (faction === 'viking' ? Math.max(0, point.y - knuckleY) * 0.85 : 0)
      if (weight > 0.5 && point.y > knuckleY && Math.abs(point.z - restZ) < 0.045) {
        const length = point.y - knuckleY
        const angle = Math.min(length / radius, Math.PI * 0.95)
        const thickness = (point.z - restZ) * curlSign
        point.y = knuckleY + (radius - thickness) * Math.sin(angle)
        point.z = palmZ + curlSign * (radius - (radius - thickness) * Math.cos(angle))
        point.applyMatrix4(fromHand).sub(original)
        target.set(point.toArray(), i * 3)
        changed = true
      }
    }
    if (!changed) return
    geometry.morphTargetsRelative = true
    const morph = new THREE.Float32BufferAttribute(target, 3)
    morph.name = 'bladeGrip'
    geometry.morphAttributes.position = [morph]
    object.updateMorphTargets()
  })
}
