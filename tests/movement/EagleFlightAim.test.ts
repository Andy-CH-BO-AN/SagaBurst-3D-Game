import { describe, expect, it } from 'vitest'
import { EagleFlightAim } from '../../src/player/EagleFlightAim'

// Flight dynamics owns speed/turn/collision. This suite owns mouse intent only.
describe('eagle free aim and flight steering', () => {
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
