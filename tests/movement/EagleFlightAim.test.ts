import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { EagleFlightAim, eagleRiderAimYaw } from '../../src/player/EagleFlightAim'

// Flight dynamics owns speed/turn/collision. This suite owns mouse intent only.
describe('eagle free aim and flight steering', () => {
  it.each([1, -1])('standing turn follows heading across the ±π boundary, direction %s', sign => {
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, sign * (Math.PI - .02), 0, 'YXZ'))
    expect(eagleRiderAimYaw(rotation, -sign * (Math.PI - .03))).toBeCloseTo(sign * .05)
  })

  it.each([.4, -.4])('standing turn preserves the eagle up axis and reticle heading with pitch/bank, yaw %s', yaw => {
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-.6, 1, .5, 'YXZ'))
    const rider = rotation.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), eagleRiderAimYaw(rotation, 1 + yaw)))
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(rider)
    expect(Math.atan2(forward.x, forward.z)).toBeCloseTo(1 + yaw)
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(rider).distanceTo(new THREE.Vector3(0, 1, 0).applyQuaternion(rotation))).toBeLessThan(1e-8)
  })

  it('continued mouse input stays within the existing 1.25 radian arc while edge steering advances', () => {
    const controls = new EagleFlightAim()
    const flight = { yaw: Math.PI - .1, pitch: 0 }
    for (let frame = 0; frame < 120; frame++) {
      controls.update(-100, 0, true, flight, 1 / 60)
      expect(controls.aim.yaw - flight.yaw).toBeLessThanOrEqual(1.25 + 1e-12)
    }
    expect(controls.aim.yaw - flight.yaw).toBeCloseTo(1.25)
    expect(controls.steering.yaw).toBeGreaterThan(flight.yaw)
  })

  it('enters aim on a climbing heading and keeps small reticle movement inside the free zone', () => {
    const controls = new EagleFlightAim()
    const flight = { yaw: 1.2, pitch: .4 }
    controls.update(0, 0, false, flight, .016)
    controls.update(50, 40, true, flight, .016)
    expect(controls.steering).toEqual(flight)
    expect(controls.aim.yaw).toBeCloseTo(1.1)
    expect(controls.aim.pitch).toBeCloseTo(.32)
  })

  it('progressively turns at the free-aim edge and blends back without a release snap', () => {
    const controls = new EagleFlightAim()
    const flight = { yaw: 0, pitch: .3 }
    controls.update(-600, 0, true, flight, .1)
    expect(controls.steering.yaw).toBeGreaterThan(0)
    expect(controls.steering.yaw).toBeLessThan(.1)
    const before = controls.steering.yaw
    controls.update(0, 0, false, flight, 1 / 60)
    expect(controls.steering.yaw - before).toBeLessThan(.07)
    expect(controls.steering.pitch).toBeCloseTo(.3)
  })

  it('held turn input continues turning beyond an initial lateral offset', () => {
    const controls = new EagleFlightAim()
    const flight = { yaw: 0, pitch: 0 }
    for (let i = 0; i < 180; i++) controls.update(0, 0, false, flight, 1 / 60, 1)
    expect(controls.steering.yaw).toBeCloseTo(2.55)
    expect(controls.steering.pitch).toBe(0)
  })

  it('reset initializes from the new mount heading without reusing a prior flight target', () => {
    const controls = new EagleFlightAim()
    controls.update(-300, 200, true, { yaw: 0, pitch: 0 }, .1)
    controls.reset()
    controls.update(0, 0, false, { yaw: -2, pitch: -.6 }, .1)
    expect(controls.steering).toEqual({ yaw: -2, pitch: -.6 })
  })
})
