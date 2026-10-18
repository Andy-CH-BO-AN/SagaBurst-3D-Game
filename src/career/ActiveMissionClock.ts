/** Monotonic active-play time, independent of the physics step clamp. A reset on
 * visibility/focus changes excludes the suspended interval even if RAF stopped. */
export class ActiveMissionClock {
  private previous?: number
  private wasActive = false
  reset(): void { this.previous = undefined; this.wasActive = false }
  advance(nowMilliseconds: number, active: boolean): number {
    if (!Number.isFinite(nowMilliseconds)) { this.reset(); return 0 }
    const elapsed = active && this.wasActive && this.previous !== undefined
      ? Math.max(0, (nowMilliseconds - this.previous) / 1000) : 0
    this.previous = nowMilliseconds
    this.wasActive = active
    return elapsed
  }
}
