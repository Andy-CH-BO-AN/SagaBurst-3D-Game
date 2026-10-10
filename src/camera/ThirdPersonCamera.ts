/**
 * ThirdPersonCamera.ts
 * Player camera that blends between third-person orbit and ranged first-person aim.
 */
import * as THREE from 'three'
import type { Player } from '../player/Player'
import type { PlayerInput } from '../player/PlayerInput'
import { getTerrainHeight, type ObstacleData } from '../world/Terrain'
import { EagleFlightAim, EAGLE_AIM } from '../player/EagleFlightAim'

const MOUSE_SENSITIVITY = 0.002   // radians per pixel
const MIN_PITCH = -0.4            // ~-23 deg
const MAX_PITCH = 1.1             // ~+63 deg
const CAMERA_DISTANCE = 6
// The imported helmet and bow intersect the view at shorter offsets.
const FIRST_PERSON_FORWARD_OFFSET = 0.55
const CAMERA_HEIGHT_OFFSET = 0.8  // standing eye/chest line above capsule centre
const MOUNTED_CAMERA_HEIGHT_OFFSET = -0.1 // mounted root already includes seat + capsule height
const CAMERA_COLLISION_MARGIN = 0.28
const FIRST_PERSON_COLLISION_MARGIN = 0.12
const CAMERA_TERRAIN_CLEARANCE = 0.18
const CAMERA_RETURN_SPEED = 8
const CAMERA_MIN_HORIZONTAL_OBSTACLE_SPAN = 1
const CAMERA_TERRAIN_SAMPLE_COUNT = 24

const NORMAL_FOV = 58
const AIM_FOV    = 28
const LEVEL_AIM_PITCH = 0.3

const collisionRay = new THREE.Ray()
const collisionDirection = new THREE.Vector3()
const collisionHit = new THREE.Vector3()
const collisionSample = new THREE.Vector3()

export interface CameraCollisionOptions {
  obstacleMargin?: number
  terrainClearance?: number
  terrainHeight?: (x: number, z: number) => number
}

/**
 * Returns the furthest safe distance along a camera ray.
 * Large world obstacles block the camera, while narrow props such as posts and
 * tree trunks stay ignored to avoid noisy camera pumping during movement.
 */
export function resolveCameraDistance(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  desiredDistance: number,
  obstacles: readonly ObstacleData[],
  options: CameraCollisionOptions = {},
): number {
  if (desiredDistance <= 0) return 0

  collisionDirection.copy(direction)
  if (collisionDirection.lengthSq() < 1e-8) return desiredDistance
  collisionDirection.normalize()
  collisionRay.set(origin, collisionDirection)

  const obstacleMargin = options.obstacleMargin ?? CAMERA_COLLISION_MARGIN
  let allowedDistance = desiredDistance

  for (const obstacle of obstacles) {
    const box = obstacle.box
    const width = box.max.x - box.min.x
    const depth = box.max.z - box.min.z
    if (Math.max(width, depth) < CAMERA_MIN_HORIZONTAL_OBSTACLE_SPAN) continue

    const hit = collisionRay.intersectBox(box, collisionHit)
    if (!hit) continue
    const distance = origin.distanceTo(hit)
    if (distance > desiredDistance) continue
    allowedDistance = Math.min(allowedDistance, Math.max(0, distance - obstacleMargin))
  }

  if (options.terrainHeight) {
    const terrainClearance = options.terrainClearance ?? CAMERA_TERRAIN_CLEARANCE
    // Some isolated presentation/unit tests intentionally keep the player root
    // at world Y=0 instead of placing it on procedural terrain. Treat terrain
    // as an obstruction only when the ray origin itself starts above ground;
    // real gameplay camera targets always satisfy this after spawn grounding.
    const originGround = options.terrainHeight(origin.x, origin.z)
    if (origin.y > originGround + terrainClearance) {
      const step = desiredDistance / CAMERA_TERRAIN_SAMPLE_COUNT
      for (let i = 1; i <= CAMERA_TERRAIN_SAMPLE_COUNT; i++) {
        const distance = step * i
        if (distance >= allowedDistance) break
        collisionSample.copy(origin).addScaledVector(collisionDirection, distance)
        if (collisionSample.y <= options.terrainHeight(collisionSample.x, collisionSample.z) + terrainClearance) {
          allowedDistance = Math.min(allowedDistance, Math.max(0, distance - step - obstacleMargin))
          break
        }
      }
    }
  }

  return allowedDistance
}

export class ThirdPersonCamera {
  private yaw: number
  private pitch = 0.3
  private readonly aimDirection = new THREE.Vector3(0, 0, 1)
  private readonly cameraTarget = new THREE.Vector3()
  private readonly cameraBackward = new THREE.Vector3()
  private readonly thirdPersonPosition = new THREE.Vector3()
  private readonly firstPersonPosition = new THREE.Vector3()
  private readonly lookTarget = new THREE.Vector3()
  private aimViewBlend = 0
  private thirdPersonDistance = CAMERA_DISTANCE
  private readonly flightAim = new EagleFlightAim()

  constructor(private camera: THREE.PerspectiveCamera, private player: Player) {
    this.yaw = (player.facingYaw ?? 0) + Math.PI
    this._updateAimDirection()
  }

  setYaw(value: number): void {
    this.yaw = value
    this._updateAimDirection()
  }

  setPitch(value: number): void {
    this.pitch = THREE.MathUtils.clamp(value, MIN_PITCH, MAX_PITCH)
    this._updateAimDirection()
  }

  get cameraYaw(): number {
    return this.yaw
  }

  get cameraPitch(): number { return this.pitch }

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

  update(input: Pick<PlayerInput, 'keys' | 'isRightMouseDown' | 'consumeMouseDelta'>, dt = 0.016, obstacles: readonly ObstacleData[] = []): void {
    // Consume mouse delta
    const { dx, dy } = input.consumeMouseDelta()
    const flight = this.player.currentMount?.flight
    if (flight) {
      this.flightAim.update(dx, dy, input.isRightMouseDown, flight, dt,
        Number(Boolean(input.keys['KeyA'])) - Number(Boolean(input.keys['KeyD'])))
      this.player.setFlightSteering(this.flightAim.steering)
      this.player.setFlightRiderAim(input.isRightMouseDown ? this.flightAim.aim.yaw : null)
      this.yaw = this.flightAim.aim.yaw - Math.PI
      this.pitch = LEVEL_AIM_PITCH - this.flightAim.aim.pitch + EAGLE_AIM.followDownPitch * (1 - this.aimViewBlend)
    } else {
      this.flightAim.reset()
      this.yaw -= dx * MOUSE_SENSITIVITY
      this.pitch = THREE.MathUtils.clamp(
      this.pitch + dy * MOUSE_SENSITIVITY,
      MIN_PITCH,
      MAX_PITCH
      )
    }

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
    this.cameraTarget.y += flight
      ? THREE.MathUtils.lerp(EAGLE_AIM.followHeight, EAGLE_AIM.aimHeight, this.aimViewBlend)
      : this.player.isMounted ? MOUNTED_CAMERA_HEIGHT_OFFSET : CAMERA_HEIGHT_OFFSET

    const safeThirdPersonDistance = resolveCameraDistance(
      this.cameraTarget,
      this.cameraBackward.copy(this.aimDirection).multiplyScalar(-1),
      flight ? EAGLE_AIM.followDistance : CAMERA_DISTANCE,
      obstacles,
      {
        obstacleMargin: CAMERA_COLLISION_MARGIN,
        terrainClearance: CAMERA_TERRAIN_CLEARANCE,
        terrainHeight: getTerrainHeight,
      },
    )
    if (safeThirdPersonDistance < this.thirdPersonDistance) {
      // Pull inward immediately so a fast turn cannot expose the far side of a wall.
      this.thirdPersonDistance = safeThirdPersonDistance
    } else {
      // Recover the normal follow distance smoothly once the obstruction clears.
      const returnAlpha = 1 - Math.exp(-CAMERA_RETURN_SPEED * dt)
      this.thirdPersonDistance = THREE.MathUtils.lerp(this.thirdPersonDistance, safeThirdPersonDistance, returnAlpha)
    }

    const safeFirstPersonDistance = resolveCameraDistance(
      this.cameraTarget,
      this.aimDirection,
      FIRST_PERSON_FORWARD_OFFSET,
      obstacles,
      { obstacleMargin: FIRST_PERSON_COLLISION_MARGIN },
    )

    this.thirdPersonPosition.copy(this.cameraTarget).addScaledVector(this.aimDirection, -this.thirdPersonDistance)
    this.firstPersonPosition.copy(this.cameraTarget).addScaledVector(this.aimDirection, safeFirstPersonDistance)
    this.camera.position.lerpVectors(this.thirdPersonPosition, this.firstPersonPosition, this.aimViewBlend)
    this.camera.lookAt(this.lookTarget.copy(this.camera.position).add(this.aimDirection))
  }
}
