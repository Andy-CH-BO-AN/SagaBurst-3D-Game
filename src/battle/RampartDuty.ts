import type { TacticalOrder } from './TacticalOrder'

/** Live actor facts the hold policy reads lazily, in its original evaluation order. */
export interface RampartDutyActor {
  readonly tacticalOrder: TacticalOrder
  readonly isMounted: boolean
}

/** Adds the lazily read ground fact the fire-position policy needs. */
export interface RampartFireActor extends RampartDutyActor {
  readonly standsOnOutpostRampart: boolean
}

/**
 * Native wall duty owned by one actor. Town walls admit a mounted body only with
 * explicit permission; Outpost duty holds foot soldiers only. Release clears both,
 * so command ownership never inherits a stale duty.
 */
export class RampartDuty {
  private town = false
  private townMounted = false
  private outpost = false

  isTownActive(actor: Pick<RampartDutyActor, 'isMounted'>): boolean {
    return this.town && (!actor.isMounted || this.townMounted)
  }

  get isMountedTownEnabled(): boolean { return this.town && this.townMounted }
  get isOutpostActive(): boolean { return this.outpost }

  activateTown(allowMounted: boolean): void {
    this.town = true
    this.townMounted = allowMounted
  }

  activateOutpost(): void { this.outpost = true }

  release(): void {
    this.outpost = false; this.town = false; this.townMounted = false
  }

  /** Defend/Attack keep an active duty in place; every other order moves the actor. */
  holdsPosition(actor: RampartDutyActor): boolean {
    return (actor.tacticalOrder === 'defend' || actor.tacticalOrder === 'attack')
      && (this.isTownActive(actor) || !actor.isMounted && this.outpost)
  }

  /** An explicit Defend command owns stationary fire even after a formation
   * released native duty. This never grants Attack a movement-hold policy. */
  holdsFirePosition(actor: RampartFireActor): boolean {
    return this.holdsPosition(actor)
      || actor.tacticalOrder === 'defend' && !actor.isMounted && actor.standsOnOutpostRampart
  }
}
