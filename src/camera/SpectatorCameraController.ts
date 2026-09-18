/**
 * SpectatorCameraController.ts
 * Free-flying spectator camera controller used after player death.
 * Detached from Player/Mount entities, allowing high-speed battlefield inspection.
 */
import * as THREE from 'three'
import type { PlayerInput } from '../player/PlayerInput'

export const SPECTATOR_MOVE_SPEED = 35 // Base units/sec (~4.4x normal player walk)
export const SPECTATOR_FAST_MULTIPLIER = 3 // Shift multiplier (~105 units/sec)
export const SPECTATOR_MOUSE_SENSITIVITY = 0.002 // Radians per pixel
export const SPECTATOR_MIN_PITCH = -Math.PI / 2 + 0.05 // ~-87 deg (prevent upside-down)
export const SPECTATOR_MAX_PITCH = Math.PI / 2 - 0.05 // ~+87 deg
export const SPECTATOR_NORMAL_FOV = 58

export class SpectatorCameraController {
  private yaw = 0
  private pitch = 0
  private readonly _tmpPos = new THREE.Vector3()
  private readonly _tmpQuat = new THREE.Quaternion()
  private readonly _tmpDir = new THREE.Vector3()
  private readonly _tmpTarget = new THREE.Vector3()

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    public moveSpeed = SPECTATOR_MOVE_SPEED,
    public fastMultiplier = SPECTATOR_FAST_MULTIPLIER,
    public mouseSensitivity = SPECTATOR_MOUSE_SENSITIVITY,
  ) {}

  get cameraYaw(): number {
    return this.yaw
  }

  get cameraPitch(): number {
    return this.pitch
  }

  setYaw(yaw: number): void {
    this.yaw = yaw
  }

  setPitch(pitch: number): void {
    this.pitch = THREE.MathUtils.clamp(pitch, SPECTATOR_MIN_PITCH, SPECTATOR_MAX_PITCH)
  }

  /**
   * Initialize spectator camera from current camera transform.
   * Copies world position and quaternion directly to guarantee zero camera jump
   * on the first frame of transition, then derives yaw/pitch for subsequent mouse look.
   */
  initFromCamera(sourceCamera?: THREE.PerspectiveCamera): void {
    const src = sourceCamera ?? this.camera
    src.updateMatrixWorld(true)
    src.getWorldPosition(this._tmpPos)
    src.getWorldQuaternion(this._tmpQuat)

    this.camera.position.copy(this._tmpPos)
    this.camera.quaternion.copy(this._tmpQuat)

    // In Three.js, camera looks along local -Z
    this._tmpDir.set(0, 0, -1).applyQuaternion(this._tmpQuat).normalize()
    this.pitch = Math.asin(THREE.MathUtils.clamp(this._tmpDir.y, -1, 1))
    this.yaw = Math.atan2(-this._tmpDir.x, -this._tmpDir.z)
  }

  update(input: PlayerInput, dt: number): void {
    // 1. Mouse look
    const { dx, dy } = input.consumeMouseDelta()
    this.yaw -= dx * this.mouseSensitivity
    this.pitch = THREE.MathUtils.clamp(
      this.pitch - dy * this.mouseSensitivity,
      SPECTATOR_MIN_PITCH,
      SPECTATOR_MAX_PITCH,
    )

    // Smooth FOV back to normal if aiming was previously active
    if (Math.abs(this.camera.fov - SPECTATOR_NORMAL_FOV) > 0.01) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, SPECTATOR_NORMAL_FOV, dt * 10)
      this.camera.updateProjectionMatrix()
    }

    // 2. Horizontal WASD movement relative to camera yaw on the XZ plane
    const forwardX = -Math.sin(this.yaw)
    const forwardZ = -Math.cos(this.yaw)
    const rightX = Math.cos(this.yaw)
    const rightZ = -Math.sin(this.yaw)

    let moveX = 0
    let moveZ = 0

    if (input.keys['KeyW']) {
      moveX += forwardX
      moveZ += forwardZ
    }
    if (input.keys['KeyS']) {
      moveX -= forwardX
      moveZ -= forwardZ
    }
    if (input.keys['KeyD']) {
      moveX += rightX
      moveZ += rightZ
    }
    if (input.keys['KeyA']) {
      moveX -= rightX
      moveZ -= rightZ
    }

    const horizontalLenSq = moveX * moveX + moveZ * moveZ
    if (horizontalLenSq > 0) {
      const invLen = 1 / Math.sqrt(horizontalLenSq)
      moveX *= invLen
      moveZ *= invLen
    }

    // 3. Vertical Space / Ctrl movement (independent of camera pitch)
    let moveY = 0
    if (input.keys['Space']) moveY += 1
    if (input.keys['ControlLeft'] || input.keys['ControlRight']) moveY -= 1

    // 4. Fast movement with Shift (does not consume stamina)
    const isFast = Boolean(input.keys['ShiftLeft'] || input.keys['ShiftRight'])
    const speed = this.moveSpeed * (isFast ? this.fastMultiplier : 1)

    this.camera.position.x += moveX * speed * dt
    this.camera.position.z += moveZ * speed * dt
    this.camera.position.y += moveY * speed * dt

    // 5. Update camera lookAt based on yaw and pitch
    const cosPitch = Math.cos(this.pitch)
    const dirX = -Math.sin(this.yaw) * cosPitch
    const dirY = Math.sin(this.pitch)
    const dirZ = -Math.cos(this.yaw) * cosPitch

    this._tmpTarget.set(
      this.camera.position.x + dirX,
      this.camera.position.y + dirY,
      this.camera.position.z + dirZ,
    )
    this.camera.lookAt(this._tmpTarget)

    // Consume clicks and interact key to prevent any actions leaking
    input.consumeLeftClick()
    input.consumeLeftClickRelease()
    input.consumeKeyE()
  }
}
