/** Geometry selection shared by humanoids and ground mounts.
 * Flying mounts keep their own policy. */
export const CHARACTER_LOD_DISTANCES = [0, 10, 30] as const

/** Humanoid pose sampling beyond this camera distance runs at the far cadence. */
export const HUMANOID_ANIMATION_THROTTLE_DISTANCE = 28
export const HUMANOID_FAR_ANIMATION_INTERVAL = 1 / 12

/** Ground-mount (horse and quadruped) animation beyond this distance runs at the far cadence. */
export const MOUNT_ANIMATION_THROTTLE_DISTANCE = 35
export const MOUNT_FAR_ANIMATION_INTERVAL = 1 / 15

/** True while a far humanoid's next pose sample is not yet due. */
export function deferFarHumanoidPose(cameraDistance: number, pendingSeconds: number): boolean {
  return cameraDistance > HUMANOID_ANIMATION_THROTTLE_DISTANCE && pendingSeconds < HUMANOID_FAR_ANIMATION_INTERVAL
}
