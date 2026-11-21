export const TARGET_REACQUIRE_NEAR_DISTANCE = 50
export const TARGET_REACQUIRE_MID_DISTANCE = 100
export const TARGET_REACQUIRE_NEAR_FRAMES = 2
export const TARGET_REACQUIRE_MID_FRAMES = 8
export const TARGET_REACQUIRE_FAR_FRAMES = 16

export function getTargetReacquireFrameInterval(distance: number | null): number {
  if (distance === null || !Number.isFinite(distance)) return TARGET_REACQUIRE_FAR_FRAMES
  if (distance <= TARGET_REACQUIRE_NEAR_DISTANCE) return TARGET_REACQUIRE_NEAR_FRAMES
  if (distance <= TARGET_REACQUIRE_MID_DISTANCE) return TARGET_REACQUIRE_MID_FRAMES
  return TARGET_REACQUIRE_FAR_FRAMES
}

/** Distance-banded sensor cadence: far targets are rescanned rarely, a nearer
 * band takes effect at once, and a farther band never postpones a pending scan. */
export class TargetReacquireSchedule {
  private framesRemaining = 0
  private intervalFrames = TARGET_REACQUIRE_FAR_FRAMES

  /** After an acquisition: the first scan is staggered by the actor's phase (0..1). */
  schedule(distance: number | null, staggered: boolean, phase: number): void {
    const interval = getTargetReacquireFrameInterval(distance)
    this.intervalFrames = interval
    this.framesRemaining = staggered ? 1 + Math.floor(phase * interval) : interval
  }

  /** One frame without an acquisition; true when a rescan is due. */
  tick(distance: number | null): boolean {
    const interval = getTargetReacquireFrameInterval(distance)
    if (interval < this.intervalFrames) this.framesRemaining = Math.min(this.framesRemaining, interval)
    this.intervalFrames = interval
    this.framesRemaining -= 1
    return this.framesRemaining <= 0
  }

  /** The next tick rescans. */
  expedite(): void { this.framesRemaining = 0 }
}
