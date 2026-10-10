import * as THREE from 'three'
import { XONGKORO_VISUAL } from '../movement/XongkoroConfig'

export interface EagleBonePose {
  node: THREE.Bone
  position: THREE.Vector3
  quaternion: THREE.Quaternion
}

export const EAGLE_GROUND_BONES = ['Bip01_Pelvis', ...['L', 'R'].flatMap(side => [
  ...['Thigh', 'Calf', 'HorseLink', 'Foot'].map(part => `Bip01_${side}_${part}`),
  ...['00', '10', '11', '20'].map(part => `BN_Toe_${side}_${part}`),
])]

/** Shared preload/instance contract: both feet must have a real support surface. */
export function eagleFootVertices(body: THREE.SkinnedMesh): number[][] {
  const skinIndex = body.geometry.getAttribute('skinIndex')
  const skinWeight = body.geometry.getAttribute('skinWeight')
  if (!skinIndex || !skinWeight) throw new Error('xongkoro standing rig is missing skin influences')
  return ['L', 'R'].map(side => {
    const indices: number[] = []
    for (let index = 0; index < skinIndex.count; index++) {
      let weight = 0
      for (let component = 0; component < 4; component++) {
        const bone = body.skeleton.bones[skinIndex.getComponent(index, component)]
        if (!bone) throw new Error('xongkoro standing rig has an invalid skin joint')
        if (bone.name === `Bip01_${side}_Foot` || bone.name.startsWith(`BN_Toe_${side}_`)) weight += skinWeight.getComponent(index, component)
      }
      if (weight >= XONGKORO_VISUAL.groundFootInfluence) indices.push(index)
    }
    if (indices.length === 0) throw new Error(`xongkoro standing rig has no ${side} foot surface`)
    return indices
  })
}

export function captureEaglePose(skeleton: THREE.Skeleton): EagleBonePose[] {
  return skeleton.bones.map(node => ({ node, position: node.position.clone(), quaternion: node.quaternion.clone() }))
}

/** Build once from the source reference, without changing mesh proportions or bind matrices. */
export function buildEagleGroundPose(root: THREE.Object3D, body: THREE.SkinnedMesh, footVertices: number[][]): EagleBonePose[] {
  const source = captureEaglePose(body.skeleton)
  const node = (name: string): THREE.Object3D => {
    const bone = root.getObjectByName(name)
    if (!bone) throw new Error(`xongkoro standing rig is missing ${name}`)
    return bone
  }
  const at = (name: string): THREE.Vector3 => node(name).getWorldPosition(new THREE.Vector3())
  const rotate = (bone: THREE.Object3D, delta: THREE.Quaternion): void => {
    const world = bone.getWorldQuaternion(new THREE.Quaternion())
    const inverseParent = bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert()
    bone.quaternion.copy(inverseParent).multiply(delta).multiply(world)
    root.updateMatrixWorld(true)
  }
  const align = (name: string, child: string, direction: THREE.Vector3): void => {
    const from = at(child).sub(at(name)).normalize()
    rotate(node(name), new THREE.Quaternion().setFromUnitVectors(from, direction.normalize()))
  }
  const pelvis = node('Bip01_Pelvis')
  rotate(pelvis, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), XONGKORO_VISUAL.groundBodyPitch))
  for (const side of ['L', 'R']) {
    const sign = side === 'L' ? 1 : -1
    const v = XONGKORO_VISUAL
    align(`Bip01_${side}_Thigh`, `Bip01_${side}_Calf`, new THREE.Vector3(...v.groundThighDirection))
    align(`Bip01_${side}_Calf`, `Bip01_${side}_HorseLink`, new THREE.Vector3(...v.groundCalfDirection))
    align(`Bip01_${side}_HorseLink`, `Bip01_${side}_Foot`, new THREE.Vector3(...v.groundAnkleDirection))
    // Source bone axes do not follow the limb: middle toe and lateral spread
    // identify the real horizontal, forward-facing sole.
    const foot = node(`Bip01_${side}_Foot`)
    const forward = at(`BN_Toe_${side}_11`).sub(at(`BN_Toe_${side}_10`)).normalize()
    rotate(foot, new THREE.Quaternion().setFromUnitVectors(forward, new THREE.Vector3(0, 0, 1)))
    const across = at(`BN_Toe_${side}_00`).sub(at(`BN_Toe_${side}_20`)).multiplyScalar(sign)
    rotate(foot, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.atan2(across.y, across.x)))
  }

  // Measure the actual skinned feet once per instance. Wing/tail bounds must
  // never determine support height, and no geometry is normalized per frame.
  const feet = ['L', 'R'].map((side, index) => ({ side, indices: footVertices[index] }))
  const vertex = new THREE.Vector3()
  const soleY = (indices: number[]): number => {
    let lowest = Infinity
    for (const index of indices) lowest = Math.min(lowest, body.getVertexPosition(index, vertex).applyMatrix4(body.matrixWorld).y)
    return lowest
  }
  const supportY = Math.min(...feet.map(foot => soleY(foot.indices)))
  // The donor legs are asymmetric. Adjust each calf bend while preserving its
  // length and ankle orientation so both feet, not just the lower foot, land.
  for (const foot of feet) {
    const correction = supportY - soleY(foot.indices)
    const calf = node(`Bip01_${foot.side}_Calf`)
    const ankle = node(`Bip01_${foot.side}_HorseLink`)
    const ankleRotation = ankle.getWorldQuaternion(new THREE.Quaternion())
    const direction = ankle.getWorldPosition(new THREE.Vector3()).sub(calf.getWorldPosition(new THREE.Vector3()))
    const length = direction.length()
    const y = THREE.MathUtils.clamp(direction.y + correction, -length * .99, length * .99)
    const horizontal = new THREE.Vector3(direction.x, 0, direction.z).normalize().multiplyScalar(Math.sqrt(length * length - y * y))
    horizontal.y = y
    rotate(calf, new THREE.Quaternion().setFromUnitVectors(direction.normalize(), horizontal.normalize()))
    ankle.quaternion.copy(ankle.parent!.getWorldQuaternion(new THREE.Quaternion()).invert()).multiply(ankleRotation)
    root.updateMatrixWorld(true)
  }
  const lowest = Math.min(...feet.map(foot => soleY(foot.indices)))
  const pelvisPosition = pelvis.getWorldPosition(new THREE.Vector3())
  pelvisPosition.y -= lowest
  pelvis.position.copy(pelvis.parent!.worldToLocal(pelvisPosition))
  root.updateMatrixWorld(true)
  const grounded = captureEaglePose(body.skeleton)
  // Constructor callers still need the source reference for collider binding.
  for (const pose of source) { pose.node.position.copy(pose.position); pose.node.quaternion.copy(pose.quaternion) }
  root.updateMatrixWorld(true)
  return grounded
}
