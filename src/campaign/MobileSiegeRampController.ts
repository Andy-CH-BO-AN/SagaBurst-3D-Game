import { SIEGE_RAMP, type MobileSiegeRampId, type SiegeRampId, type SiegeRampAssignment } from './MobileSiegeRampPolicy'

export type MobileSiegeRampState = 'DEPLOYING' | 'PUSHING' | 'DOCKING' | 'DOCKED' | 'ABANDONED' | 'DESTROYED'
export interface SiegeCrewRecord { readonly combatantId: string; readonly dead: boolean }

/** Lifecycle owns IDs/readiness, never creates actors or chooses replacements. */
export class MobileSiegeRampController<Id extends MobileSiegeRampId = SiegeRampId> {
  state: MobileSiegeRampState = 'DEPLOYING'
  distance = 0
  currentSpeed = 0
  private dockElapsed = 0
  private disposed = false
  private progressElapsed = 0
  private progressStartX = 0
  private progressStartZ = 0
  private readonly actors = new Map<string, SiegeCrewRecord>()
  constructor(readonly assignment: SiegeRampAssignment<Id>, readonly travelDistance: number,
    private readonly changed: (state: MobileSiegeRampState) => void = () => {}) {}

  register(actor: SiegeCrewRecord): void {
    const ids = [...this.assignment.pusherIds, ...this.assignment.assaultIds]
    if (this.disposed || !ids.includes(actor.combatantId) || this.actors.has(actor.combatantId)) {
      throw new Error(`Invalid siege crew registration: ${actor.combatantId}`)
    }
    this.actors.set(actor.combatantId, actor)
  }
  withdraw(id: string): void {
    if (this.actors.has(id)) this.actors.set(id, { combatantId: id, dead: true })
  }
  get dockingProgress(): number { return Math.min(1, this.dockElapsed / SIEGE_RAMP.dockSeconds) }
  get assigned(): boolean { return ['DEPLOYING', 'PUSHING', 'DOCKING'].includes(this.state) && !this.disposed }
  get alivePushers(): number { return this.assignment.pusherIds.filter(id => this.actors.has(id) && !this.actors.get(id)!.dead).length }

  advance(dt: number, mayMove: boolean | (() => boolean) = true): number {
    if (this.disposed || !Number.isFinite(dt) || dt <= 0) return 0
    if (this.state === 'DEPLOYING') {
      if (this.actors.size !== 10) return 0
      this.transition('PUSHING')
    }
    if (!this.assigned || this.actors.size !== 10) return 0
    if (this.alivePushers === 0) { this.transition('ABANDONED'); return 0 }
    if (this.state === 'DOCKING') {
      this.dockElapsed += dt
      if (this.dockElapsed >= SIEGE_RAMP.dockSeconds) this.transition('DOCKED')
      return 0
    }
    // Query the movement envelope only after readiness, death and docking gates.
    const unblocked = typeof mayMove === 'function' ? mayMove() : mayMove
    this.currentSpeed = unblocked ? SIEGE_RAMP.speed * this.alivePushers / 4 : 0
    const moved = Math.min(this.travelDistance - this.distance, this.currentSpeed * dt)
    this.distance += moved
    if (this.distance >= this.travelDistance) this.transition('DOCKING')
    return moved
  }
  /** Sample the applied world-space motion, including the very first blocked pushing frame. */
  observeMovement(dt: number, startX: number, startZ: number, endX: number, endZ: number): void {
    if (this.disposed || this.state !== 'PUSHING' || this.actors.size !== 10
      || !Number.isFinite(dt) || dt <= 0) return
    if (this.progressElapsed === 0) {
      this.progressStartX = startX
      this.progressStartZ = startZ
    }
    this.progressElapsed += dt
    if (this.progressElapsed < 10 - 1e-9) return
    const distance = Math.hypot(endX - this.progressStartX, endZ - this.progressStartZ)
    this.progressElapsed = 0
    if (distance < 1) this.transition('ABANDONED')
  }
  restore(saved: { state: MobileSiegeRampState; distance: number; dockingProgress: number }): void {
    this.progressElapsed = 0
    this.state = saved.state
    this.distance = Math.min(this.travelDistance, saved.distance)
    this.dockElapsed = saved.dockingProgress * SIEGE_RAMP.dockSeconds
    this.currentSpeed = 0
  }
  destroy(): void {
    if (!this.disposed && this.state !== 'DESTROYED') this.transition('DESTROYED')
  }
  dispose(): void { this.disposed = true; this.currentSpeed = 0; this.progressElapsed = 0; this.actors.clear() }
  private transition(state: MobileSiegeRampState): void {
    this.state = state
    if (state !== 'PUSHING') { this.currentSpeed = 0; this.progressElapsed = 0 }
    this.changed(state)
  }
}
