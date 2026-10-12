import * as THREE from 'three'
import { expect, it, onTestFinished } from 'vitest'
import { prepareSeatSupport, SkinnedSeatContact } from '../../src/world/SkinnedSeatContact'

function skin(geometry: THREE.BufferGeometry) {
  const count = geometry.attributes.position.count
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4))
  const weights = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) weights[i * 4] = 1
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4))
  const material = new THREE.MeshBasicMaterial(), mesh = new THREE.SkinnedMesh(geometry, material), bone = new THREE.Bone()
  mesh.add(bone); mesh.bind(new THREE.Skeleton([bone]))
  onTestFinished(() => { mesh.skeleton.dispose(); geometry.dispose(); material.dispose() })
  return { mesh, bone }
}

it('tracks both posed surfaces across LOD changes and restores without accumulated movement in transformed parents', () => {
  const scene = new THREE.Group(), mount = new THREE.Group(), rider = new THREE.Group()
  scene.add(mount); mount.add(rider)
  mount.position.set(5, 8, -3); mount.rotation.set(.2, .8, -.1); mount.scale.setScalar(1.3)
  const bodies = [0, 1].map(i => {
    const body = skin(new THREE.BoxGeometry(.25, .2, .6, i + 1, i + 1, i + 1).translate(0, 1.5, -.2))
    prepareSeatSupport(body.mesh, [[-.1, 1.4, -.18], [.1, 1.4, -.18]])
    const level = new THREE.Group(); level.add(body.mesh); rider.add(level); level.visible = i === 0
    return { ...body, level }
  })
  const saddle = skin(new THREE.BoxGeometry(.4, .1, .6).translate(0, 1.6, -.15))
  mount.add(saddle.mesh)
  const socket = new THREE.Object3D(); socket.position.set(0, 1.65, -.15); mount.add(socket)
  const fit = new SkinnedSeatContact(rider, mount, saddle.mesh, socket)
  for (const i of [0, 1, 0]) {
    bodies.forEach((body, index) => { body.level.visible = index === i })
    for (const [bodyY, saddleY] of [[0, 0], [-.06, .04], [.02, -.03], [0, 0]]) {
      bodies[i].bone.position.y = bodyY; saddle.bone.position.y = saddleY
      fit.align()
      expect(rider.position.y + 1.4 + bodyY - (1.65 + saddleY)).toBeCloseTo(.002, 6)
      const height = rider.position.y
      for (let repeat = 0; repeat < 10; repeat++) fit.align()
      expect(rider.position.y).toBeCloseTo(height, 6)
    }
  }
  // A legacy rider with no selected bearing metadata remains untouched.
  const legacy = new THREE.Group(); mount.add(legacy); legacy.position.y = .7
  new SkinnedSeatContact(legacy, mount, saddle.mesh, socket).align()
  expect(legacy.position.y).toBe(.7)
})
