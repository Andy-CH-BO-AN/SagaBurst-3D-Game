import { Vector3 } from 'three'
import { combatAllegiancesHostile, type CombatAllegiance } from '../combat/CombatFaction'

export interface BypassActor extends CombatAllegiance {
  combatantId: string; combatPosition: Vector3; dead: boolean; isMounted: boolean
}
type ClearSegment = (from: Vector3, to: Vector3) => boolean

/** Local recovery only: never changes the caller's goal or its static route. */
export class FriendlyMovementBypass {
  private readonly sample = new Vector3()
  private readonly first = new Vector3()
  private readonly last = new Vector3()
  private elapsed = 0
  private remaining = 0
  private initialized = false
  private stage = 0
  private preferredSide = 1
  private retrySide = 0
  private activeSide = 0
  private validationRemaining = 0

  clear(): void { this.initialized = false; this.stage = 0; this.elapsed = 0; this.remaining = 0; this.retrySide = 0 }

  steer(dt: number, self: BypassActor, goal: Vector3, direction: Vector3,
    nearby: readonly BypassActor[], clear: ClearSegment): boolean {
    const p = self.combatPosition
    // Assignment/order changes explicitly clear this owner. Follow coordinates
    // are not an identity: a moving leader must not reset a blocked follower.
    if (!this.initialized) {
      this.clear(); this.initialized = true; this.sample.copy(p)
      let hash = 0
      for (let i = 0; i < self.combatantId.length; i++) hash = (hash * 31 + self.combatantId.charCodeAt(i)) | 0
      this.preferredSide = hash & 1 ? -1 : 1
    }
    if (this.stage) {
      this.remaining -= dt
      this.validationRemaining -= dt
      const target = this.stage === 1 ? this.first : this.last
      if (Math.hypot(p.x - target.x, p.z - target.z) < .4) this.stage++
      const next = this.stage === 1 ? this.first : this.last
      if (this.remaining <= 0 || this.stage > 2 || this.validationRemaining <= 0
        && (!clear(p, next) || !this.residentsClear(self, nearby, p, next, self.isMounted ? 1.15 : .6))) {
        this.retrySide = this.stage <= 2 ? -this.activeSide : 0
        this.stage = 0; this.elapsed = 0; this.sample.copy(p); this.preferredSide *= -1
        return false
      }
      if (this.validationRemaining <= 0) this.validationRemaining = .35
      direction.copy(this.stage === 1 ? this.first : this.last).sub(p).setY(0).normalize()
      return true
    }
    this.elapsed += dt
    if (this.elapsed < 1.2) return false
    this.elapsed = 0
    // Compare both samples against the current goal: sideways/backward collision
    // motion (or a moving Follow goal) must not count as the mover's progress.
    const progress = Math.hypot(goal.x - this.sample.x, goal.z - this.sample.z)
      - Math.hypot(goal.x - p.x, goal.z - p.z)
    this.sample.copy(p)
    if (progress >= .45) return false
    const dx = direction.x, dz = direction.z, radius = self.isMounted ? 1.15 : .6
    let blocked = false, forward = 0, left = radius + .8, right = left
    for (const other of nearby) {
      if (other === self || other.dead || combatAllegiancesHostile(self, other) || Math.abs(p.y - other.combatPosition.y) > 1.5) continue
      const ox = other.combatPosition.x - p.x, oz = other.combatPosition.z - p.z
      const along = ox * dx + oz * dz, lateral = -ox * dz + oz * dx
      const clearance = radius + (other.isMounted ? 1.15 : .6) + .35
      if (along < -.5 || along > 4 + radius || Math.abs(lateral) > 7) continue
      if (along > 0 && Math.abs(lateral) < clearance) blocked = true
      forward = Math.max(forward, along + clearance + 1)
      left = Math.max(left, lateral + clearance); right = Math.max(right, -lateral + clearance)
    }
    if (!blocked) return false
    // Try the shorter detour first; deterministic identity breaks equal-cost ties.
    const preferred = this.retrySide || (Math.abs(left - right) < .05 ? this.preferredSide : left < right ? 1 : -1)
    for (let attempt = 0; attempt < 2; attempt++) {
      const side = preferred * (attempt ? -1 : 1), offset = side * (side > 0 ? left : right)
      this.first.set(p.x - dz * offset, p.y, p.z + dx * offset)
      this.last.copy(this.first).addScaledVector(direction, forward)
      if (!clear(p, this.first) || !clear(this.first, this.last)
        || !this.residentsClear(self, nearby, p, this.first, radius)
        || !this.residentsClear(self, nearby, this.first, this.last, radius)) continue
      this.stage = 1; this.remaining = 8; this.validationRemaining = .35; this.activeSide = side; this.retrySide = 0
      direction.copy(this.first).sub(p).setY(0).normalize()
      return true
    }
    this.preferredSide *= -1
    return false
  }

  private residentsClear(self: BypassActor, nearby: readonly BypassActor[], a: Vector3, b: Vector3, radius: number): boolean {
    const dx = b.x - a.x, dz = b.z - a.z, lengthSq = dx * dx + dz * dz
    for (const other of nearby) {
      if (other === self || other.dead || Math.abs(a.y - other.combatPosition.y) > 1.5) continue
      const p = other.combatPosition
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / Math.max(.001, lengthSq)))
      const clearance = radius + (other.isMounted ? 1 : .42)
      // Existing contact may be escaped laterally, but no new contact is admitted.
      const startDistance = Math.hypot(p.x - a.x, p.z - a.z)
      if (Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t) < Math.min(clearance, startDistance - .01)) return false
    }
    return true
  }
}
