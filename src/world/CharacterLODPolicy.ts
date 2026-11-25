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

const GOLDEN_RATIO_CONJUGATE = 0.6180339887498949
let nextStaggerIndex = 0

/** Deterministic low-discrepancy phase in [0, 1) so far instances do not fire on the same frame. */
export function nextAnimationStaggerPhase(): number {
  nextStaggerIndex = (nextStaggerIndex + 1) >>> 0
  return (nextStaggerIndex * GOLDEN_RATIO_CONJUGATE) % 1
}

/**
 * Separates real accumulated simulation delta (`pendingDt`, passed to mixers/clocks)
 * from the staggered scheduling threshold (`phaseDebt`), avoiding fake time jumps.
 */
export class FarAnimationCadence {
  private readonly phase: number
  private pendingDt = 0
  private phaseDebt = 0
  private armed = false

  constructor(phase = nextAnimationStaggerPhase()) {
    const normalized = Number.isFinite(phase) ? phase - Math.floor(phase) : 0
    this.phase = normalized >= 0 && normalized < 1 ? normalized : 0
  }

  reset(): void {
    this.pendingDt = 0
    this.phaseDebt = 0
    this.armed = false
  }

  wouldDefer(interval: number, nextDt: number): boolean {
    if (interval <= 0) return false
    const debt = this.armed ? this.phaseDebt : this.phase * interval
    return debt + nextDt < interval
  }

  advance(dt: number, interval: number): number | null {
    this.pendingDt += dt
    if (interval <= 0) {
      const step = this.pendingDt
      this.pendingDt = 0
      this.phaseDebt = 0
      this.armed = false
      return step
    }
    if (!this.armed) {
      this.phaseDebt = this.phase * interval
      this.armed = true
    }
    this.phaseDebt += dt
    if (this.phaseDebt < interval) return null
    const step = this.pendingDt
    this.pendingDt = 0
    this.phaseDebt %= interval
    return step
  }
}
