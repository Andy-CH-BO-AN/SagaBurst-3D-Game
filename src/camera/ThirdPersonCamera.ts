/**
 * ThirdPersonCamera.ts
 * Player camera that blends between third-person orbit and ranged first-person aim.
 */
import * as THREE from 'three'
import type { Player } from '../player/Player'
import type { PlayerInput } from '../player/PlayerInput'

const MOUSE_SENSITIVITY = 0.002   // radians per pixel
const MIN_PITCH = -0.4            // ~-23 deg
const MAX_PITCH = 1.1             // ~+63 deg
const CAMERA_DISTANCE = 6
// The imported helmet and bow intersect the view at shorter offsets.
const FIRST_PERSON_FORWARD_OFFSET = 0.55
const CAMERA_HEIGHT_OFFSET = 0.8  // standing eye/chest line above capsule centre
const MOUNTED_CAMERA_HEIGHT_OFFSET = -0.1 // mounted root already includes seat + capsule height

const NORMAL_FOV = 58
const AIM_FOV    = 28
const LEVEL_AIM_PITCH = 0.3

export class ThirdPersonCamera {
  private yaw: number
  private pitch = 0.3
  private readonly aimDirection = new THREE.Vector3(0, 0, 1)
  private readonly cameraTarget = new THREE.Vector3()
  private readonly thirdPersonPosition = new THREE.Vector3()
  private readonly firstPersonPosition = new THREE.Vector3()
  private readonly lookTarget = new THREE.Vector3()
  private aimViewBlend = 0

  constructor(private camera: THREE.PerspectiveCamera, private player: Player) {
    this.yaw = (player.facingYaw ?? 0) + Math.PI
    this._updateAimDirection()
  }

  setYaw(value: number): void {
    this.yaw = value
    this._updateAimDirection()
  }

  get cameraYaw(): number {
    return this.yaw
  }

  /** Direction represented by the orbit reticle, corrected for the camera's player look-at offset. */
  getAimDirection(target: THREE.Vector3): THREE.Vector3 {
    return target.copy(this.aimDirection)
  }

  /** A world-space point beneath the screen-centre reticle. */
  getAimPoint(target: THREE.Vector3, distance = 60): THREE.Vector3 {
    return target.copy(this.camera.position).addScaledVector(this.aimDirection, distance)
  }

  private _updateAimDirection(): void {
    const aimPitch = LEVEL_AIM_PITCH - this.pitch
    this.aimDirection.set(
      -Math.sin(this.yaw) * Math.cos(aimPitch),
      Math.sin(aimPitch),
      -Math.cos(this.yaw) * Math.cos(aimPitch),
    ).normalize()
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

    const targetBlend = this.player.isRangedAimViewActive ? 1 : 0
    const alpha = 1 - Math.exp(-18 * dt)
    this.aimViewBlend = THREE.MathUtils.lerp(this.aimViewBlend, targetBlend, alpha)
    this.camera.fov = THREE.MathUtils.lerp(NORMAL_FOV, AIM_FOV, this.aimViewBlend)
    this.camera.updateProjectionMatrix()

    // The camera and projectile share one forward ray.  Looking back at the
    // player would make the screen-centre reticle point into the ground while
    // arrows used a separate direction.
    this._updateAimDirection()
    this.cameraTarget.copy(this.player.position)
    this.cameraTarget.y += this.player.isMounted ? MOUNTED_CAMERA_HEIGHT_OFFSET : CAMERA_HEIGHT_OFFSET
    this.thirdPersonPosition.copy(this.cameraTarget).addScaledVector(this.aimDirection, -CAMERA_DISTANCE)
    this.firstPersonPosition.copy(this.cameraTarget).addScaledVector(this.aimDirection, FIRST_PERSON_FORWARD_OFFSET)
    this.camera.position.lerpVectors(this.thirdPersonPosition, this.firstPersonPosition, this.aimViewBlend)
    this.camera.lookAt(this.lookTarget.copy(this.camera.position).add(this.aimDirection))
  }
}
