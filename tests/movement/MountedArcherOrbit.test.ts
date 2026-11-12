import { describe, expect, it } from 'vitest'
import { angleDifference, canUseMountedBowOrbit, mountedBowTorsoTurn, orbitHeading, steerOrbitForward, orbitRadius, orbitTurnRate, writeOrbitDirection } from '../../src/movement/MountedArcherOrbit'

describe('Ground mounted archer steering', () => {
  it('uses forward orbit after charge reaches combat while preserving held positions and other units', () => {
    expect(canUseMountedBowOrbit('charge', true, false)).toBe(true)
    expect(canUseMountedBowOrbit('attack', true, false)).toBe(true)
    expect(canUseMountedBowOrbit('defend', true, false)).toBe(false)
    expect(canUseMountedBowOrbit('charge', true, true)).toBe(false)
    expect(canUseMountedBowOrbit('charge', false, false)).toBe(false)
  })
  it('runs forward around a stationary centre on either side and supports faster cat mounts without multiplier drift', () => {
    for (const [side, speed] of [[-1, 12], [1, 12], [1, 15]] as const) {
      const radius = orbitRadius(30, speed, .3)
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
        maxForwardError = Math.max(maxForwardError, Math.abs(dx * Math.sin(yaw) + dz * Math.cos(yaw) - speed * dt))
        maxLateral = Math.max(maxLateral, Math.abs(dx * Math.cos(yaw) - dz * Math.sin(yaw)))
        p.x += dx; p.z += dz
      }
      expect(maxTurn).toBeLessThanOrEqual(orbitTurnRate(speed, radius) * dt + 1e-10)
      expect(maxForwardError).toBeLessThan(1e-10)
      expect(maxLateral).toBeLessThan(1e-10)
      expect(Math.abs(Math.hypot(p.x, p.z) - radius)).toBeLessThan(1)
    }
  })

  it('recovers the firing radius from initial distance factors', () => {
    for (const factor of [.65, 1.3]) {
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
    }
  })

  it('bounds steering through moving-centre acquisition and a target switch', () => {
    const p = { x: 30, z: 0 }, target = { x: 0, z: 0 }, direction = { x: 0, z: 0 }
    let yaw = Math.PI, maxTurn = 0
    for (let frame = 0; frame < 180; frame++) {
      target.x += .08
      if (frame === 90) target.z = -40
      writeOrbitDirection(direction, p, target, 1, 30)
      const before = yaw
      yaw = orbitHeading(yaw, Math.atan2(direction.x, direction.z), 12, 1 / 30)
      maxTurn = Math.max(maxTurn, Math.abs(angleDifference(yaw, before)))
      p.x += Math.sin(yaw) * .4; p.z += Math.cos(yaw) * .4
    }
    expect(maxTurn).toBeLessThanOrEqual(.5 / 30 + 1e-10)
    expect(Number.isFinite(yaw + p.x + p.z)).toBe(true)
  })

  it('turns gradually toward an avoidance reversal, including a long frame', () => {
    expect(orbitHeading(0, Math.PI, 12, 1 / 60)).toBeCloseTo(.5 / 60)
    expect(orbitHeading(0, Math.PI, 15, .1)).toBeCloseTo(.04)
    expect(orbitHeading(0, Math.PI, 15, 2)).toBeCloseTo(.04)
    expect(orbitHeading(0, Math.PI, 15, 0)).toBe(0)
    // Turn geometry does not replace the existing directional speed policy.
  })

  it('keeps torso twist anatomical on both sides for rearward targets and corrects stance for forward targets', () => {
    for (const side of [-1, 1]) {
      const sourceYaw = side * Math.PI / 2
      const correction = side * Math.PI / 2
      const actualTurn = mountedBowTorsoTurn(sourceYaw, correction)
      expect(sourceYaw + actualTurn).toBeCloseTo(side * 100 * Math.PI / 180)
      expect(Math.abs(correction - actualTurn)).toBeGreaterThan(1)
    }
    // Corrects authored sideways stance toward forward target (#226 merged)
    const forwardSourceYaw = -Math.PI / 2
    expect(angleDifference(forwardSourceYaw + mountedBowTorsoTurn(forwardSourceYaw, Math.PI / 2), 0)).toBeCloseTo(0)
  })
  it('takes the short turn across the rear-facing ±180 degree seam', () => {
    const from = 179 * Math.PI / 180
    const to = -179 * Math.PI / 180
    expect(angleDifference(to, from)).toBeCloseTo(2 * Math.PI / 180)
  })
})
