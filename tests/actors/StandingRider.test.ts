import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { fitStandingRider } from '../../src/world/StandingRider'

describe('standing rider sole alignment', () => {
  it('aligns a normal-size rider to the animated socket through pitch, yaw and bank without cumulative translation', () => {
    // No real actors or GLB. This owns the coordinate conversion, not anatomy.
    const mount = new THREE.Group(), scaledModel = new THREE.Group(), socket = new THREE.Object3D()
    mount.position.set(6, 18, -4); mount.rotation.set(.4, 1.2, -.6)
    scaledModel.scale.setScalar(30); socket.position.set(0, .09, .06)
    mount.add(scaledModel); scaledModel.add(socket)
    const rider = new THREE.Group(), visual = new THREE.Group()
    rider.position.copy(mount.position); rider.quaternion.copy(mount.quaternion)
    rider.add(visual)
    const leftFootSocket = new THREE.Object3D(), rightFootSocket = new THREE.Object3D()
    leftFootSocket.position.set(-.15, -.17, .05); rightFootSocket.position.set(.15, -.13, .05)
    visual.add(leftFootSocket, rightFootSocket)
    const rig = { leftFootSocket, rightFootSocket }
    expect(fitStandingRider(visual, rig, socket)).toBe(true)
    const midpoint = leftFootSocket.getWorldPosition(new THREE.Vector3()).add(rightFootSocket.getWorldPosition(new THREE.Vector3())).multiplyScalar(.5)
    expect(midpoint.distanceTo(socket.getWorldPosition(new THREE.Vector3()))).toBeLessThan(1e-8)
    expect(rider.scale.toArray()).toEqual([1, 1, 1])
    expect(visual.scale.toArray()).toEqual([1, 1, 1])
    const first = visual.position.clone()
    fitStandingRider(visual, rig, socket)
    expect(visual.position.distanceTo(first)).toBeLessThan(1e-8)
    socket.position.y += .02
    fitStandingRider(visual, rig, socket)
    expect(visual.position.distanceTo(first)).toBeCloseTo(.6)
  })
})
