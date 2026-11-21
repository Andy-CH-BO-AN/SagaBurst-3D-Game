export type ArenaPhase = 'waiting' | 'countdown' | 'paused' | 'fight' | 'result'

/** What the opening gate needs from the arena scene; it never sees the renderer, the DOM or the bodies. */
export interface ArenaOpeningHost {
  /** A co-op guest page mirrors the host's phase and never opens the fight. */
  isGuest(): boolean
  /** Not started yet, a panel is open or the equipment menu is showing. */
  blocked(): boolean
  /** `?nolock` QA path: the opening runs without pointer lock. */
  lockOptional(): boolean
  /** This arena's canvas holds the pointer lock. */
  hasPointerLock(): boolean
  requestPointerLock(): void
  unlockAudio(): void
  clearInput(): void
  /** The opening click must not reach combat. */
  consumeLeftGesture(): void
  /** Restart the frame clock so the countdown does not absorb the time spent waiting. */
  resetClock(): void
  render(phase: ArenaPhase, remaining: number): void
  /** Per-frame work owed while the opening is not fighting; true holds the countdown (a save retry is pending). */
  holdOpening(dt: number): boolean
  /** The countdown elapsed: arm the bodies and save. */
  fightStarted(): void
}

/** Pointer lock and countdown that turn a deployed arena into a live fight; the scene owns everything else. */
export class ArenaOpeningGate {
  phase: ArenaPhase = 'waiting'
  remaining: number
  constructor(private readonly host: ArenaOpeningHost, remaining: number) { this.remaining = remaining }

  reset(phase: ArenaPhase, remaining: number): void { this.phase = phase; this.remaining = remaining }

  /** The canvas was clicked: the gesture opens (or resumes) the countdown, or re-requests pointer lock. */
  click(): void {
    const host = this.host
    if (host.blocked()) return
    host.unlockAudio()
    if (!host.isGuest() && (this.phase === 'waiting' || this.phase === 'paused')) {
      host.consumeLeftGesture()
      if (host.lockOptional() || host.hasPointerLock()) this.begin()
      else host.requestPointerLock()
    } else if (!host.lockOptional()) host.requestPointerLock()
  }

  /** A request is not proof of control: only a lock held by this canvas starts the clock. */
  lockChanged(): void {
    this.pauseIfUnlocked()
    if (this.host.hasPointerLock()) this.begin()
  }

  pauseIfUnlocked(): void {
    const host = this.host
    if (host.isGuest() || this.phase !== 'countdown' || host.lockOptional() || host.hasPointerLock()) return
    this.phase = 'paused'
    host.clearInput()
    host.render(this.phase, this.remaining)
  }

  /** True while the opening owns the frame (waiting, paused or counting down). */
  advance(dt: number): boolean {
    this.pauseIfUnlocked()
    if (this.phase !== 'waiting' && this.phase !== 'paused' && this.phase !== 'countdown') return false
    if (this.host.holdOpening(dt)) return true
    this.pauseIfUnlocked()
    if (this.phase !== 'countdown') return true
    this.remaining -= dt
    if (this.remaining > 0) return true
    this.phase = 'fight'
    this.host.fightStarted()
    return true
  }

  private begin(): void {
    const host = this.host
    if (host.isGuest() || host.blocked() || this.phase !== 'waiting' && this.phase !== 'paused') return
    host.clearInput()
    this.phase = 'countdown'
    host.resetClock()
    host.render(this.phase, this.remaining)
  }
}
