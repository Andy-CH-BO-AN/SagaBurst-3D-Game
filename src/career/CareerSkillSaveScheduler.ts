/** Debounce window between a plain skill XP gain and its durable save. */
export const CAREER_SKILL_SAVE_DELAY_MS = 600

export interface CareerSkillSaveTimers {
  set(callback: () => void, delayMs: number): unknown
  clear(handle: unknown): void
}

/** Resolved at call time so the page's (or a test's) current timer functions are used. */
const globalTimers: CareerSkillSaveTimers = {
  set: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clear: handle => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export interface CareerSkillSavePorts {
  /** Writes the live skills durably; false means the write was rejected and the skills stay dirty. */
  save(): boolean
  /** While true a flush is a successful no-op and keeps the skills dirty (e.g. a frozen finale or no profile). */
  blocked?(): boolean
  /** Called once per rejected save, before flush returns false. */
  onSaveFailed?(): void
  timers?: CareerSkillSaveTimers
}

/**
 * Debounced owner of the "live skills not yet saved" state shared by Town and the battle scene.
 * Plain XP is coalesced into one save after the delay; level-ups and scene exits flush explicitly.
 */
export class CareerSkillSaveScheduler {
  private timer: unknown = null
  private dirtyFlag = false
  private readonly timers: CareerSkillSaveTimers

  constructor(private readonly ports: CareerSkillSavePorts) {
    this.timers = ports.timers ?? globalTimers
  }

  get dirty(): boolean { return this.dirtyFlag }

  markDirty(): void { this.dirtyFlag = true }

  /** Whoever saved the whole profile (skills included) acknowledges the skills as durable. */
  clearDirty(): void { this.dirtyFlag = false }

  /** Starts the debounce unless one is already pending; later awards do not postpone it. */
  schedule(): void {
    if (!this.dirtyFlag || this.timer !== null) return
    this.timer = this.timers.set(() => {
      this.timer = null
      this.flush()
    }, CAREER_SKILL_SAVE_DELAY_MS)
  }

  cancel(): void {
    if (this.timer === null) return
    this.timers.clear(this.timer)
    this.timer = null
  }

  /** Cancels the pending timer, saves if dirty, and returns whether the skills are durable. */
  flush(): boolean {
    this.cancel()
    if (this.ports.blocked?.() || !this.dirtyFlag) return true
    if (!this.ports.save()) {
      this.ports.onSaveFailed?.()
      return false
    }
    this.dirtyFlag = false
    return true
  }
}
