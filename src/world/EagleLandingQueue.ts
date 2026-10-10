/** One scene's automatic approach permission, independent of permanent pad ownership. */
export class EagleLandingQueue {
  private readonly waiting = new Set<string>()
  private active?: { owner: string; deadline: number }
  private time = 0
  private availableAt = 0

  /** A failed approach yields to waiting aircraft instead of renewing while circling. */
  constructor(private readonly approachSeconds = 60, private readonly goAroundSeconds = 3) {}

  beginFrame(dt: number): void {
    this.time += Math.max(0, dt)
    if (this.active && this.time >= this.active.deadline) {
      const owner = this.active.owner
      this.active = undefined
      this.waiting.delete(owner)
      this.waiting.add(owner)
      this.availableAt = this.time + this.goAroundSeconds
    }
  }

  request(owner: string, clear = true): boolean {
    if (!clear) { this.release(owner); return false }
    this.waiting.add(owner)
    if (this.active?.owner === owner) return true
    if (!this.active && this.time >= this.availableAt && this.waiting.values().next().value === owner) {
      this.active = { owner, deadline: this.time + this.approachSeconds }
      return true
    }
    return false
  }

  release(owner: string): void {
    this.withdraw(owner, this.goAroundSeconds)
  }

  complete(owner: string): void {
    this.withdraw(owner, 0)
  }

  private withdraw(owner: string, clearanceSeconds: number): void {
    this.waiting.delete(owner)
    if (this.active?.owner === owner) {
      this.active = undefined
      // Give an interrupted final approach time to climb before admitting the next bird.
      this.availableAt = this.time + clearanceSeconds
    }
  }
}
