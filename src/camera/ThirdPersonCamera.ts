/**
 * ThirdPersonCamera.ts
 * Third-person camera that orbits around the player.
 * Phase 3 addition: smooth FOV zoom (70 -> 40) & shoulder offset when in Aim Mode.
 */
import * as THREE from 'three'
import type { Player } from '../player/Player'
import type { PlayerInput } from '../player/PlayerInput'

const MOUSE_SENSITIVITY = 0.002   // radians per pixel
const MIN_PITCH = -0.4            // ~-23 deg
const MAX_PITCH = 1.1             // ~+63 deg
const CAMERA_DISTANCE = 6
const CAMERA_HEIGHT_OFFSET = 1.6  // look-at offset above player root

const NORMAL_FOV = 70
const AIM_FOV    = 40
const AIM_DISTANCE = 3.5

export class ThirdPersonCamera {
  private yaw = Math.PI            // start behind player
  private pitch = 0.3

  constructor(private camera: THREE.PerspectiveCamera, private player: Player) {}

  get cameraYaw(): number {
    return this.yaw
  }

  update(input: PlayerInput, dt = 0.016): void {
    // Consume mouse delta
    const { dx, dy } = input.consumeMouseDelta()
    this.yaw -= dx * MOUSE_SENSITIVITY
    this.pitch = THREE.MathUtils.clamp(
      this.pitch + dy * MOUSE_SENSITIVITY,
      MIN_PITCH,
      MAX_PITCH
    )

    // Smooth FOV zoom transition
    const targetFOV = this.player.isAiming ? AIM_FOV : NORMAL_FOV
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFOV, dt * 10)
    this.camera.updateProjectionMatrix()

    // Smooth camera distance
    const dist = this.player.isAiming ? AIM_DISTANCE : CAMERA_DISTANCE

    // Spherical offset from player
    const offset = new THREE.Vector3(
      dist * Math.sin(this.yaw) * Math.cos(this.pitch),
      dist * Math.sin(this.pitch),
      dist * Math.cos(this.yaw) * Math.cos(this.pitch)
    )

    // Shoulder offset when aiming
    if (this.player.isAiming) {
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw))
      offset.addScaledVector(right, 0.6) // shift right shoulder
    }

    const target = this.player.position.clone()
    target.y += CAMERA_HEIGHT_OFFSET

    this.camera.position.copy(target).add(offset)
    this.camera.lookAt(target)
  }
}
