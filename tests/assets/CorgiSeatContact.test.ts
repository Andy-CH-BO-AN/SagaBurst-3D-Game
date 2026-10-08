import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { CorgiSeatContact } from '../../src/world/CorgiSeatContact'

function skin(name: string, geometry: THREE.BufferGeometry) {
  const count = geometry.getAttribute('position').count
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4))
  const weights = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) weights[i * 4] = 1
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4))
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial())
  mesh.name = name
  const bone = new THREE.Bone()
  mesh.add(bone)
  mesh.bind(new THREE.Skeleton([bone]))
  return { mesh, bone }
}

describe('mount studio skin-to-seat contact', () => {
  it.each(['Pants_Pants_0', 'Tunic_1', 'Tunic'])('keeps the actual seated surface on an animated saddle without accumulating offsets (%s)', (name) => {
    const mount = new THREE.Group(), rider = new THREE.Group()
    rider.name = 'maki-archer-t4-humanoid-v2'
    const butt = skin(name, new THREE.BoxGeometry(.25, .2, .6).translate(0, 1.5, -.2))
    const saddle = skin('corgi_saddle_leather', new THREE.BoxGeometry(.4, .1, .6).translate(0, 1.6, -.15))
    rider.add(butt.mesh); mount.add(rider, saddle.mesh)
    mount.position.set(5, 8, -3)
    mount.rotation.set(.2, .8, -.1)
    mount.scale.setScalar(1.3)
    const socket = new THREE.Object3D(); socket.name = 'socket_saddle_seat'; socket.position.set(0, 1.65, -.15); mount.add(socket)
    const fit = new CorgiSeatContact(rider, mount)
    const gap = () => rider.position.y + 1.4 + butt.bone.position.y - (1.65 + saddle.bone.position.y)
    fit.align()
    expect(gap()).toBeCloseTo(.002)
    const height = rider.position.y
    for (let i = 0; i < 20; i++) fit.align()
    expect(rider.position.y).toBeCloseTo(height)
    butt.bone.position.y = -.06
    saddle.bone.position.y = .04
    fit.align()
    expect(gap()).toBeCloseTo(.002)
    butt.bone.position.y = 0
    saddle.bone.position.y = 0
    fit.align()
    expect(rider.position.y).toBeCloseTo(height)
  })
})
