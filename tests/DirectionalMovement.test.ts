import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  BACKWARD_SPEED_MULTIPLIER,
  DIRECTIONAL_THRESHOLD,
  FORWARD_SPEED_MULTIPLIER,
  LATERAL_SPEED_MULTIPLIER,
  MOUNT_LATERAL_SPEED_MULTIPLIER,
  getDirectionalMovementFromKeyboard,
  getDirectionalMovementFromVector,
  getEffectiveSpeedMultiplier,
} from '../src/movement/DirectionalMovement'

describe('DirectionalMovement Policy', () => {
  describe('getDirectionalMovementFromKeyboard', () => {
    it('returns null when no movement keys are pressed', () => {
      expect(getDirectionalMovementFromKeyboard(false, false, false, false)).toBeNull()
    })

    it('handles forward directions (100% speed, can sprint)', () => {
      // W (Forward)
      const forward = getDirectionalMovementFromKeyboard(true, false, false, false)
      expect(forward).toEqual({
        direction: 'forward',
        multiplier: FORWARD_SPEED_MULTIPLIER,
        canSprint: true,
      })

      // W+A (Forward-Left)
      const forwardLeft = getDirectionalMovementFromKeyboard(true, false, true, false)
      expect(forwardLeft).toEqual({
        direction: 'forward-left',
        multiplier: FORWARD_SPEED_MULTIPLIER,
        canSprint: true,
      })

      // W+D (Forward-Right)
      const forwardRight = getDirectionalMovementFromKeyboard(true, false, false, true)
      expect(forwardRight).toEqual({
        direction: 'forward-right',
        multiplier: FORWARD_SPEED_MULTIPLIER,
        canSprint: true,
      })
    })

    it('handles lateral directions (100% speed, CANNOT sprint)', () => {
      // A (Left)
      const left = getDirectionalMovementFromKeyboard(false, false, true, false)
      expect(left).toEqual({
        direction: 'left',
        multiplier: LATERAL_SPEED_MULTIPLIER,
        canSprint: false,
      })

      // D (Right)
      const right = getDirectionalMovementFromKeyboard(false, false, false, true)
      expect(right).toEqual({
        direction: 'right',
        multiplier: LATERAL_SPEED_MULTIPLIER,
        canSprint: false,
      })
    })

    it('handles backward directions (30% speed, CANNOT sprint)', () => {
      // S (Backward)
      const backward = getDirectionalMovementFromKeyboard(false, true, false, false)
      expect(backward).toEqual({
        direction: 'backward',
        multiplier: BACKWARD_SPEED_MULTIPLIER,
        canSprint: false,
      })

      // S+A (Backward-Left)
      const backwardLeft = getDirectionalMovementFromKeyboard(false, true, true, false)
      expect(backwardLeft).toEqual({
        direction: 'backward-left',
        multiplier: BACKWARD_SPEED_MULTIPLIER,
        canSprint: false,
      })

      // S+D (Backward-Right)
      const backwardRight = getDirectionalMovementFromKeyboard(false, true, false, true)
      expect(backwardRight).toEqual({
        direction: 'backward-right',
        multiplier: BACKWARD_SPEED_MULTIPLIER,
        canSprint: false,
      })
    })

    it('cancels opposing keys cleanly', () => {
      // W + S cancels forward/backward
      expect(getDirectionalMovementFromKeyboard(true, true, false, false)).toBeNull()
      // A + D cancels strafe
      expect(getDirectionalMovementFromKeyboard(false, false, true, true)).toBeNull()
      // W + S + D acts as D (right)
      const right = getDirectionalMovementFromKeyboard(true, true, false, true)
      expect(right?.direction).toBe('right')
    })
  })

  describe('Diagonal Speed Normalization', () => {
    it('ensures normalized diagonal magnitude matches cardinal magnitude', () => {
      const vW = new THREE.Vector3(0, 0, 1)
      const vWA = new THREE.Vector3(-1, 0, 1).normalize()
      const vWD = new THREE.Vector3(1, 0, 1).normalize()

      expect(vW.length()).toBeCloseTo(1.0, 5)
      expect(vWA.length()).toBeCloseTo(1.0, 5)
      expect(vWD.length()).toBeCloseTo(1.0, 5)
      expect(vW.length()).toBeCloseTo(vWA.length(), 5)
      expect(vW.length()).toBeCloseTo(vWD.length(), 5)

      const vS = new THREE.Vector3(0, 0, -1)
      const vSA = new THREE.Vector3(-1, 0, -1).normalize()
      const vSD = new THREE.Vector3(1, 0, -1).normalize()

      expect(vS.length()).toBeCloseTo(1.0, 5)
      expect(vSA.length()).toBeCloseTo(1.0, 5)
      expect(vSD.length()).toBeCloseTo(1.0, 5)
      expect(vS.length()).toBeCloseTo(vSA.length(), 5)
      expect(vS.length()).toBeCloseTo(vSD.length(), 5)
    })

    it('eliminates sqrt(2) diagonal speed boost with velocity multipliers applied', () => {
      const baseWalkSpeed = 8.0
      const policyW = getDirectionalMovementFromKeyboard(true, false, false, false)!
      const policyWA = getDirectionalMovementFromKeyboard(true, false, true, false)!
      const policyS = getDirectionalMovementFromKeyboard(false, true, false, false)!
      const policySA = getDirectionalMovementFromKeyboard(false, true, true, false)!

      const speedW = baseWalkSpeed * policyW.multiplier
      const speedWA = baseWalkSpeed * policyWA.multiplier
      const speedS = baseWalkSpeed * policyS.multiplier
      const speedSA = baseWalkSpeed * policySA.multiplier

      expect(speedW).toBe(8.0)
      expect(speedWA).toBe(8.0)
      expect(speedW).toBe(speedWA)

      expect(speedS).toBeCloseTo(2.4, 5)
      expect(speedSA).toBeCloseTo(2.4, 5)
      expect(speedS).toBe(speedSA)
    })
  })

  describe('getDirectionalMovementFromVector', () => {
    it('validates forward axis convention: moveDir === facing is forward, moveDir === -facing is backward', () => {
      const facing = new THREE.Vector3(0, 0, 1)

      // moveDir === facing -> forward
      const fwd = getDirectionalMovementFromVector(facing, new THREE.Vector3(0, 0, 1))
      expect(fwd.direction).toBe('forward')
      expect(fwd.multiplier).toBe(FORWARD_SPEED_MULTIPLIER)
      expect(fwd.canSprint).toBe(true)

      // moveDir === -facing -> backward
      const back = getDirectionalMovementFromVector(facing, new THREE.Vector3(0, 0, -1))
      expect(back.direction).toBe('backward')
      expect(back.multiplier).toBe(BACKWARD_SPEED_MULTIPLIER)
      expect(back.canSprint).toBe(false)
    })

    it('evaluates all 8 directions with facing along +Z', () => {
      const facing = new THREE.Vector3(0, 0, 1)

      // Forward (0 deg)
      expect(getDirectionalMovementFromVector(facing, new THREE.Vector3(0, 0, 1))).toMatchObject({
        direction: 'forward',
        multiplier: 1.0,
        canSprint: true,
      })

      // Forward-Left (-45 deg: X = -1, Z = 1)
      expect(getDirectionalMovementFromVector(facing, new THREE.Vector3(-1, 0, 1))).toMatchObject({
        direction: 'forward-left',
        multiplier: 1.0,
        canSprint: true,
      })

      // Forward-Right (+45 deg: X = 1, Z = 1)
      expect(getDirectionalMovementFromVector(facing, new THREE.Vector3(1, 0, 1))).toMatchObject({
        direction: 'forward-right',
        multiplier: 1.0,
        canSprint: true,
      })

      // Left (-90 deg: X = -1, Z = 0)
      expect(getDirectionalMovementFromVector(facing, new THREE.Vector3(-1, 0, 0))).toMatchObject({
        direction: 'left',
        multiplier: 1.0,
        canSprint: false,
      })

      // Right (+90 deg: X = 1, Z = 0)
      expect(getDirectionalMovementFromVector(facing, new THREE.Vector3(1, 0, 0))).toMatchObject({
        direction: 'right',
        multiplier: 1.0,
        canSprint: false,
      })

      // Backward (180 deg: X = 0, Z = -1)
      expect(getDirectionalMovementFromVector(facing, new THREE.Vector3(0, 0, -1))).toMatchObject({
        direction: 'backward',
        multiplier: 0.3,
        canSprint: false,
      })

      // Backward-Left (-135 deg: X = -1, Z = -1)
      expect(getDirectionalMovementFromVector(facing, new THREE.Vector3(-1, 0, -1))).toMatchObject({
        direction: 'backward-left',
        multiplier: 0.3,
        canSprint: false,
      })

      // Backward-Right (+135 deg: X = 1, Z = -1)
      expect(getDirectionalMovementFromVector(facing, new THREE.Vector3(1, 0, -1))).toMatchObject({
        direction: 'backward-right',
        multiplier: 0.3,
        canSprint: false,
      })
    })

    it('evaluates correctly under rotated facing (+X, -Z, arbitrary angle)', () => {
      // Facing along +X
      const facingX = new THREE.Vector3(1, 0, 0)
      expect(getDirectionalMovementFromVector(facingX, new THREE.Vector3(1, 0, 0)).direction).toBe('forward')
      expect(getDirectionalMovementFromVector(facingX, new THREE.Vector3(-1, 0, 0)).direction).toBe('backward')

      // Facing along -Z
      const facingNegZ = new THREE.Vector3(0, 0, -1)
      expect(getDirectionalMovementFromVector(facingNegZ, new THREE.Vector3(0, 0, -1)).direction).toBe('forward')
      expect(getDirectionalMovementFromVector(facingNegZ, new THREE.Vector3(0, 0, 1)).direction).toBe('backward')
    })

    it('defensively handles unnormalized inputs and 3D Y components', () => {
      const facing = new THREE.Vector3(0, 10, 5) // will be projected to XZ and normalized
      const move = new THREE.Vector3(0, -3, 100)  // same direction in XZ
      const res = getDirectionalMovementFromVector(facing, move)
      expect(res.direction).toBe('forward')
      expect(res.multiplier).toBe(1.0)
    })
  })

  describe('getEffectiveSpeedMultiplier for Mount vs Foot', () => {
    it('applies 1.0 for foot lateral and 0.5 for mount lateral', () => {
      const leftPolicy = getDirectionalMovementFromKeyboard(false, false, true, false)!
      const rightPolicy = getDirectionalMovementFromKeyboard(false, false, false, true)!

      // Foot (isMounted: false)
      expect(getEffectiveSpeedMultiplier(leftPolicy, false)).toBe(LATERAL_SPEED_MULTIPLIER) // 1.0
      expect(getEffectiveSpeedMultiplier(rightPolicy, false)).toBe(LATERAL_SPEED_MULTIPLIER) // 1.0

      // Mount (isMounted: true)
      expect(getEffectiveSpeedMultiplier(leftPolicy, true)).toBe(MOUNT_LATERAL_SPEED_MULTIPLIER) // 0.5
      expect(getEffectiveSpeedMultiplier(rightPolicy, true)).toBe(MOUNT_LATERAL_SPEED_MULTIPLIER) // 0.5
    })

    it('preserves forward (1.0) and backward (0.3) multipliers identically for foot and mount', () => {
      const fwdPolicy = getDirectionalMovementFromKeyboard(true, false, false, false)!
      const backPolicy = getDirectionalMovementFromKeyboard(false, true, false, false)!

      expect(getEffectiveSpeedMultiplier(fwdPolicy, false)).toBe(1.0)
      expect(getEffectiveSpeedMultiplier(fwdPolicy, true)).toBe(1.0)

      expect(getEffectiveSpeedMultiplier(backPolicy, false)).toBe(0.3)
      expect(getEffectiveSpeedMultiplier(backPolicy, true)).toBe(0.3)
    })
  })
})
