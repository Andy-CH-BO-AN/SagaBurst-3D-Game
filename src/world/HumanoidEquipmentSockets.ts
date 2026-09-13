import * as THREE from 'three'
import type { CharacterRig } from './CharacterVisuals'

/**
 * Equipment must survive mesh LOD visibility changes. These socket copies live
 * outside the LOD groups and follow the evaluated primary hand, without writing
 * to any skeletal transform or changing the authored socket/weapon contract.
 */
export function createEquipmentSocketProxies(root: THREE.Object3D, rig: CharacterRig): () => void {
  const followers = [rig.left, rig.right].map((arm, index) => {
    const source = arm.handSocket
    const parent = new THREE.Group()
    parent.name = `equipment-hand-${index === 0 ? 'l' : 'r'}`
    parent.matrixAutoUpdate = false
    const socket = new THREE.Group()
    socket.name = source.name
    socket.userData = { ...source.userData }
    parent.add(socket)
    root.add(parent)
    arm.handSocket = socket
    return { source, parent, socket }
  })
  const inverseRoot = new THREE.Matrix4()
  return () => {
    root.updateWorldMatrix(true, false)
    inverseRoot.copy(root.matrixWorld).invert()
    for (const { source, parent, socket } of followers) {
      source.parent!.updateWorldMatrix(true, false)
      parent.matrix.multiplyMatrices(inverseRoot, source.parent!.matrixWorld)
      parent.matrixWorldNeedsUpdate = true
      socket.position.copy(source.position)
      socket.quaternion.copy(source.quaternion)
      socket.scale.copy(source.scale)
      parent.updateWorldMatrix(false, true)
    }
  }
}
