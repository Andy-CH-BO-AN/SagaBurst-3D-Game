import { describe, expect, it } from 'vitest'
import { angleDifference, canUseMountedBowOrbit, mountedBowTorsoTurn, orbitHeading, steerOrbitForward, orbitRadius, orbitTurnRate, writeOrbitDirection, isWithinMountedBowOrbitRange } from '../../src/movement/MountedArcherOrbit'

describe('Ground mounted archer steering', () => {
  it('uses forward orbit after charge reaches combat while preserving held positions and other units', () => {
    expect(canUseMountedBowOrbit('charge', true, false)).toBe(true)
    expect(canUseMountedBowOrbit('attack', true, false)).toBe(true)
    expect(canUseMountedBowOrbit('defend', true, false)).toBe(false)
    expect(canUseMountedBowOrbit('charge', true, true)).toBe(false)
    expect(canUseMountedBowOrbit('charge', false, false)).toBe(false)
  })
  it.each([-1, 1] as const)('runs forward around a stationary centre with side %s', side => {
    const speed = 12, radius = orbitRadius(30, speed, .3)
    const p = { x: radius, z: 0 }, target = { x: 0, z: 0 }, direction = { x: 0, z: 0 }
    let yaw = side === 1 ? Math.PI : 0
    const dt = 1 / 60
    let maxTurn = 0, maxForwardError = 0, maxLateral = 0
    for (let frame = 0; frame < 900; frame++) {
      writeOrbitDirection(direction, p, target, side, radius)
      const previousYaw = yaw
      yaw = steerOrbitForward(direction, yaw, Math.atan2(direction.x, direction.z), speed, dt, radius)
      maxTurn = Math.max(maxTurn, Math.abs(angleDifference(yaw, previousYaw)))
      const dx = direction.x * speed * dt, dz = direction.z * speed * dt
      // Actual displacement is parallel to the model's +Z, never a strafe/backstep.
      maxForwardError = Math.max(maxForwardError, Math.abs(dx * Math.sin(yaw) + dz * Math.cos(yaw) - speed * dt))
      maxLateral = Math.max(maxLateral, Math.abs(dx * Math.cos(yaw) - dz * Math.sin(yaw)))
      p.x += dx; p.z += dz
    }
    expect(maxTurn).toBeLessThanOrEqual(orbitTurnRate(speed, radius) * dt + 1e-10)
    expect(maxForwardError).toBeLessThan(1e-10)
    expect(maxLateral).toBeLessThan(1e-10)
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(radius, 0)
    const targetBearing = angleDifference(Math.atan2(-p.x, -p.z), yaw)
    expect(targetBearing * side).toBeGreaterThan(1.3)
    expect(Math.abs(targetBearing)).toBeLessThan(1.8)
  })

  it('keeps the faster cat mounts on the circle without a speed multiplier', () => {
    const speed = 15, radius = orbitRadius(30, speed, .3), p = { x: radius, z: 0 }
    const target = { x: 0, z: 0 }, direction = { x: 0, z: 0 }
    let yaw = Math.PI, maxDistance = 0
    for (let frame = 0; frame < 900; frame++) {
      writeOrbitDirection(direction, p, target, 1, radius)
      yaw = steerOrbitForward(direction, yaw, Math.atan2(direction.x, direction.z), speed, 1 / 60, radius)
      p.x += direction.x * speed / 60
      p.z += direction.z * speed / 60
      maxDistance = Math.max(maxDistance, Math.hypot(p.x, p.z))
    }
    expect(maxDistance).toBeLessThan(30)
    expect(Math.abs(Math.hypot(p.x, p.z) - radius)).toBeLessThan(1)
  })

  it.each([.65, 1.3])('recovers the firing radius from initial distance factor %s', factor => {
    const speed = 10, radius = orbitRadius(30, speed, .8)
    const p = { x: radius * factor, z: 0 }, direction = { x: 0, z: 0 }
    let yaw = Math.PI
    for (let frame = 0; frame < 1200; frame++) {
      writeOrbitDirection(direction, p, { x: 0, z: 0 }, 1, radius)
      const desired = Math.atan2(direction.x, direction.z)
      yaw = orbitHeading(yaw, desired, speed, 1 / 60)
      const step = speed / 60
      p.x += Math.sin(yaw) * step; p.z += Math.cos(yaw) * step
    }
    expect(Math.abs(Math.hypot(p.x, p.z) - radius)).toBeLessThan(1)
    expect(radius).toBeLessThan(30 * .8)
  })

  it('bounds steering through moving-centre acquisition and a target switch', () => {
    const p = { x: 30, z: 0 }, target = { x: 0, z: 0 }, direction = { x: 0, z: 0 }
    let yaw = Math.PI
    for (let frame = 0; frame < 180; frame++) {
      target.x += .08
      if (frame === 90) target.z = -40
      writeOrbitDirection(direction, p, target, 1, 30)
      const before = yaw
      yaw = orbitHeading(yaw, Math.atan2(direction.x, direction.z), 12, 1 / 30)
      expect(Math.abs(angleDifference(yaw, before))).toBeLessThanOrEqual(.5 / 30 + 1e-10)
      p.x += Math.sin(yaw) * .4; p.z += Math.cos(yaw) * .4
    }
    expect(Number.isFinite(yaw + p.x + p.z)).toBe(true)
  })

  it('turns gradually toward an avoidance reversal, including a long frame', () => {
    expect(orbitHeading(0, Math.PI, 12, 1 / 60)).toBeCloseTo(.5 / 60)
    expect(orbitHeading(0, Math.PI, 15, .1)).toBeCloseTo(.04)
    expect(orbitHeading(0, Math.PI, 15, 2)).toBeCloseTo(.04)
    expect(orbitHeading(0, Math.PI, 15, 0)).toBe(0)
    // Turn geometry does not replace the existing directional speed policy.
  })

  it.each([0, Math.PI / 2, -Math.PI / 2, 3 * Math.PI / 4, -3 * Math.PI / 4, Math.PI])(
    'retains target-relative yaw %s even past the former 90 degree firing arc', yaw => {
      const sourceYaw = -Math.PI / 2
      const correction = angleDifference(yaw, sourceYaw)
      const actualTurn = mountedBowTorsoTurn(sourceYaw, correction)
      expect(angleDifference(sourceYaw + actualTurn, yaw)).toBeCloseTo(0)
    },
  )
  it('takes the short turn across the rear-facing ±180 degree seam', () => {
    const from = 179 * Math.PI / 180
    const to = -179 * Math.PI / 180
    expect(angleDifference(to, from)).toBeCloseTo(2 * Math.PI / 180)
  })

  it('enters circling at 90% while the ranged attack limit stays unchanged', () => {
    expect(isWithinMountedBowOrbitRange(27 * 27, 30)).toBe(true)
    expect(isWithinMountedBowOrbitRange(27.1 * 27.1, 30)).toBe(false)
    expect(isWithinMountedBowOrbitRange(30 * 30, 30)).toBe(false)
    expect(isWithinMountedBowOrbitRange(36 * 36, 40)).toBe(true)
    expect(isWithinMountedBowOrbitRange(36.1 * 36.1, 40)).toBe(false)
  })

  it('corrects the authored sideways bow stance toward forward and rear targets', () => {
    const sourceYaw = -Math.PI / 2
    expect(angleDifference(sourceYaw + mountedBowTorsoTurn(sourceYaw, Math.PI / 2), 0)).toBeCloseTo(0)
    expect(Math.abs(angleDifference(sourceYaw + mountedBowTorsoTurn(sourceYaw, -Math.PI / 2), Math.PI))).toBeCloseTo(0)
  })
})
