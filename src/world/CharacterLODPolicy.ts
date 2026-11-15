/** Geometry selection shared by humanoids and ground mounts.
 * Flying mounts keep their own policy. */
export const CHARACTER_LOD_DISTANCES = [0, 10, 30] as const

/** Humanoid pose sampling beyond this camera distance runs at the far cadence. */
export const HUMANOID_ANIMATION_THROTTLE_DISTANCE = 28
export const HUMANOID_FAR_ANIMATION_INTERVAL = 1 / 12
/** Beyond this distance (well inside LOD2) humans and ground mounts sample at 6 Hz;
 * melee contact poses are never throttled (callers pass distance 0). */
export const VERY_FAR_ANIMATION_DISTANCE = 55
export const VERY_FAR_ANIMATION_INTERVAL = 1 / 6

/** Seconds between humanoid pose samples at this camera distance (0 = every frame). */
export function humanoidPoseInterval(cameraDistance: number): number {
  return cameraDistance > VERY_FAR_ANIMATION_DISTANCE ? VERY_FAR_ANIMATION_INTERVAL
    : cameraDistance > HUMANOID_ANIMATION_THROTTLE_DISTANCE ? HUMANOID_FAR_ANIMATION_INTERVAL : 0
}

/** Seconds between horse/quadruped mixer steps at this camera distance (0 = every frame). */
export function mountAnimationInterval(cameraDistance: number): number {
  return cameraDistance > VERY_FAR_ANIMATION_DISTANCE ? VERY_FAR_ANIMATION_INTERVAL
    : cameraDistance > MOUNT_ANIMATION_THROTTLE_DISTANCE ? MOUNT_FAR_ANIMATION_INTERVAL : 0
}

/** Ground-mount (horse and quadruped) animation beyond this distance runs at the far cadence. */
export const MOUNT_ANIMATION_THROTTLE_DISTANCE = 35
export const MOUNT_FAR_ANIMATION_INTERVAL = 1 / 15

/** True while a far humanoid's next pose sample is not yet due. */
export function deferFarHumanoidPose(cameraDistance: number, pendingSeconds: number): boolean {
  return pendingSeconds < humanoidPoseInterval(cameraDistance)
}
