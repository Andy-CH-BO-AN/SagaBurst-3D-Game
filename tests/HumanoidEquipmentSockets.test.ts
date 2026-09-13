import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createEquipmentSocketProxies } from '../src/world/HumanoidEquipmentSockets'
import type { CharacterRig } from '../src/world/CharacterVisuals'

describe('equipment remains attached when the primary mesh LOD is hidden', () => {
  it('follows the evaluated hand and authored socket without inheriting LOD visibility', () => {
    const scene = new THREE.Group(), root = new THREE.Group(), lod0 = new THREE.Group()
    scene.add(root); root.add(lod0)
    root.position.set(3, 1, -2); root.rotation.y = 0.7
    const hands = [new THREE.Bone(), new THREE.Bone()]
    const sockets = hands.map((hand, index) => {
      lod0.add(hand); hand.position.set(index ? 0.3 : -0.3, 1.2, 0)
      const socket = new THREE.Bone(); socket.position.set(0.01, 0.07, -0.03); socket.rotation.set(0.1, 0.2, 0.3)
      hand.add(socket); return socket
    })
    const rig = { left: { handSocket: sockets[0] }, right: { handSocket: sockets[1] } } as CharacterRig
    const follow = createEquipmentSocketProxies(root, rig)
    const equipment = [rig.left, rig.right].map(arm => { const item = new THREE.Group(); arm.handSocket.add(item); return item })
    lod0.visible = false
    for (const angle of [0, 0.6, -0.9]) {
      hands[0].rotation.set(angle, angle / 2, 0.2)
      hands[1].rotation.set(-angle, 0.3, -0.2)
      root.rotation.y += 0.2
      follow(); scene.updateMatrixWorld(true)
      equipment.forEach((item, index) => {
        item.matrixWorld.elements.forEach((value, component) => expect(value).toBeCloseTo(sockets[index].matrixWorld.elements[component], 10))
        for (let parent: THREE.Object3D | null = item; parent; parent = parent.parent) expect(parent.visible).toBe(true)
      })
    }
  })
})
