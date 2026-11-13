import { eagleColumnsConflict } from './EagleAirspace'
import type { EagleLandingPoint } from './EagleLanding'

interface Approach { deadline: number; best: number; zone?: EagleLandingPoint }

/**
 * One scene's automatic landing permission, independent of permanent pad ownership.
 * Owners that name their pad `zone` only wait for approaches whose airspace overlaps
 * theirs; an owner without a zone (a fixed-wing corridor) is exclusive with everyone.
 */
export class EagleLandingQueue {
  /** Insertion order is the queue order; the value is the requested zone. */
  private readonly waiting = new Map<string, EagleLandingPoint | undefined>()
  private readonly active = new Map<string, Approach>()
  /** Airspace an interrupted approach is still climbing out of. */
  private readonly vacating: { zone?: EagleLandingPoint; until: number }[] = []
  private time = 0

  /**
   * A failed approach yields to waiting aircraft instead of renewing while circling.
   * `approachSeconds` is a stall window: only a new closest `remaining` distance
   * extends it, so a working approach is never cut off and an orbit cannot renew.
   */
  constructor(private readonly approachSeconds = 60, private readonly goAroundSeconds = 3,
    private readonly progressDistance = 1) {}

  beginFrame(dt: number): void {
    this.time += Math.max(0, dt)
    for (const [owner, approach] of this.active) if (this.time >= approach.deadline) {
      this.active.delete(owner)
      this.waiting.delete(owner)
      this.waiting.set(owner, approach.zone)
      this.vacate(approach.zone, this.goAroundSeconds)
    }
    for (let i = this.vacating.length - 1; i >= 0; i--) if (this.time >= this.vacating[i].until) this.vacating.splice(i, 1)
  }

  /** `remaining` is the caller's distance still to cover to touchdown; omitted keeps the fixed window. */
  request(owner: string, clear = true, remaining?: number, zone?: EagleLandingPoint): boolean {
    if (!clear) { this.release(owner); return false }
    const approach = this.active.get(owner)
    if (approach) {
      if (remaining !== undefined && remaining <= approach.best - this.progressDistance) {
        approach.best = remaining; approach.deadline = this.time + this.approachSeconds
      }
      return true
    }
    this.waiting.set(owner, zone)
    for (const other of this.active.values()) if (conflict(zone, other.zone)) return false
    for (const other of this.vacating) if (conflict(zone, other.zone)) return false
    // Earlier waiters keep their turn for any airspace this owner would take from them.
    for (const [other, otherZone] of this.waiting) {
      if (other === owner) break
      if (conflict(zone, otherZone)) return false
    }
    this.active.set(owner, { deadline: this.time + this.approachSeconds, best: remaining ?? Infinity, zone })
    return true
  }

  release(owner: string): void {
    this.withdraw(owner, this.goAroundSeconds)
  }

  complete(owner: string): void {
    this.withdraw(owner, 0)
  }

  private withdraw(owner: string, clearanceSeconds: number): void {
    this.waiting.delete(owner)
    const approach = this.active.get(owner)
    if (!approach) return
    this.active.delete(owner)
    // Give an interrupted final approach time to climb before admitting the next bird.
    this.vacate(approach.zone, clearanceSeconds)
  }

  private vacate(zone: EagleLandingPoint | undefined, seconds: number): void {
    if (seconds > 0) this.vacating.push({ zone, until: this.time + seconds })
  }
}

function conflict(a: EagleLandingPoint | undefined, b: EagleLandingPoint | undefined): boolean {
  return !a || !b || eagleColumnsConflict(a, b)
}
