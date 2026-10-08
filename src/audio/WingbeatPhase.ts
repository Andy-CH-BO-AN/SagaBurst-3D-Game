/** The source fly clip starts near its upper apex; the downstroke begins at 5%. */
const DOWNSTROKE_PHASE = .05

/** Counts actual animation crossings, independent of render LOD and audio availability. */
export class WingbeatPhaseTracker {
  private previousPhase = 0
  private wasActive = false
  private count = 0

  get sequence(): number { return this.count }

  sample(normalizedPhase: number, active: boolean): void {
    if (!Number.isFinite(normalizedPhase)) { this.wasActive = false; return }
    const phase = ((normalizedPhase % 1) + 1) % 1
    if (active && this.wasActive) {
      const crossed = phase >= this.previousPhase
        ? this.previousPhase < DOWNSTROKE_PHASE && phase >= DOWNSTROKE_PHASE
        : this.previousPhase < DOWNSTROKE_PHASE || phase >= DOWNSTROKE_PHASE
      if (crossed) this.count++
    }
    this.previousPhase = phase
    this.wasActive = active
  }
}
