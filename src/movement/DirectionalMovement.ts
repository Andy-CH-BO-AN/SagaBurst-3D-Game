import * as THREE from 'three'

export const BACKWARD_SPEED_MULTIPLIER = 0.3
export const FORWARD_SPEED_MULTIPLIER = 1.0
export const LATERAL_SPEED_MULTIPLIER = 1.0
export const MOUNT_LATERAL_SPEED_MULTIPLIER = 0.5
export const DIRECTIONAL_THRESHOLD = Math.cos((Math.PI * 3) / 8) // ~0.3826834323650898

export type MovementDirection =
  | 'forward'
  | 'forward-left'
  | 'forward-right'
  | 'left'
  | 'right'
  | 'backward'
  | 'backward-left'
  | 'backward-right'

export interface DirectionalMovementPolicy {
  direction: MovementDirection
  multiplier: number
  canSprint: boolean
}

/**
 * Returns the effective speed multiplier given a directional policy and mount status.
 * Mounted entities use 0.5 for pure lateral movement (left / right) to prevent kite orbiting.
 */
export function getEffectiveSpeedMultiplier(
  policy: DirectionalMovementPolicy,
  isMounted: boolean = false,
): number {
  if (isMounted && (policy.direction === 'left' || policy.direction === 'right')) {
    return MOUNT_LATERAL_SPEED_MULTIPLIER
  }
  return policy.multiplier
}

const UP = new THREE.Vector3(0, 1, 0)
const _normFacing = new THREE.Vector3()
const _normMoveDir = new THREE.Vector3()
const _right = new THREE.Vector3()

/**
 * Evaluates directional policy directly from WASD keyboard inputs.
 * Returns null if no movement keys are pressed.
 */
export function getDirectionalMovementFromKeyboard(
  w: boolean,
  s: boolean,
  a: boolean,
  d: boolean,
): DirectionalMovementPolicy | null {
  const fwd = (w ? 1 : 0) - (s ? 1 : 0)
  const strafe = (d ? 1 : 0) - (a ? 1 : 0)

  if (fwd === 0 && strafe === 0) return null

  if (fwd > 0) {
    if (strafe < 0) {
      return { direction: 'forward-left', multiplier: FORWARD_SPEED_MULTIPLIER, canSprint: true }
    }
    if (strafe > 0) {
      return { direction: 'forward-right', multiplier: FORWARD_SPEED_MULTIPLIER, canSprint: true }
    }
    return { direction: 'forward', multiplier: FORWARD_SPEED_MULTIPLIER, canSprint: true }
  }

  if (fwd < 0) {
    if (strafe < 0) {
      return { direction: 'backward-left', multiplier: BACKWARD_SPEED_MULTIPLIER, canSprint: false }
    }
    if (strafe > 0) {
      return { direction: 'backward-right', multiplier: BACKWARD_SPEED_MULTIPLIER, canSprint: false }
    }
    return { direction: 'backward', multiplier: BACKWARD_SPEED_MULTIPLIER, canSprint: false }
  }

  // Pure strafe (lateral)
  if (strafe < 0) {
    return { direction: 'left', multiplier: LATERAL_SPEED_MULTIPLIER, canSprint: false }
  }
  return { direction: 'right', multiplier: LATERAL_SPEED_MULTIPLIER, canSprint: false }
}

/**
 * Evaluates directional policy from character/mount facing and final movement direction.
 * Defensively normalizes both vectors on the XZ plane.
 */
export function getDirectionalMovementFromVector(
  facing: THREE.Vector3,
  moveDir: THREE.Vector3,
  threshold: number = DIRECTIONAL_THRESHOLD,
): DirectionalMovementPolicy {
  _normFacing.set(facing.x, 0, facing.z)
  if (_normFacing.lengthSq() < 1e-6) {
    _normFacing.set(0, 0, 1)
  } else {
    _normFacing.normalize()
  }

  _normMoveDir.set(moveDir.x, 0, moveDir.z)
  if (_normMoveDir.lengthSq() < 1e-6) {
    return { direction: 'forward', multiplier: FORWARD_SPEED_MULTIPLIER, canSprint: false }
  }
  _normMoveDir.normalize()

  // Right axis relative to facing in Three.js coordinates (UP x facing)
  _right.crossVectors(UP, _normFacing).normalize()

  const forwardAmount = _normMoveDir.dot(_normFacing)
  const rightAmount = _normMoveDir.dot(_right)

  if (forwardAmount > threshold) {
    if (rightAmount > threshold) {
      return { direction: 'forward-right', multiplier: FORWARD_SPEED_MULTIPLIER, canSprint: true }
    }
    if (rightAmount < -threshold) {
      return { direction: 'forward-left', multiplier: FORWARD_SPEED_MULTIPLIER, canSprint: true }
    }
    return { direction: 'forward', multiplier: FORWARD_SPEED_MULTIPLIER, canSprint: true }
  }

  if (forwardAmount < -threshold) {
    if (rightAmount > threshold) {
      return { direction: 'backward-right', multiplier: BACKWARD_SPEED_MULTIPLIER, canSprint: false }
    }
    if (rightAmount < -threshold) {
      return { direction: 'backward-left', multiplier: BACKWARD_SPEED_MULTIPLIER, canSprint: false }
    }
    return { direction: 'backward', multiplier: BACKWARD_SPEED_MULTIPLIER, canSprint: false }
  }

  // Lateral (-threshold <= forwardAmount <= threshold)
  if (rightAmount >= 0) {
    return { direction: 'right', multiplier: LATERAL_SPEED_MULTIPLIER, canSprint: false }
  }
  return { direction: 'left', multiplier: LATERAL_SPEED_MULTIPLIER, canSprint: false }
}
