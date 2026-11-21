import type { CareerProfile } from '../career/CareerProfile'
import { settleTown, type TownResult } from './TownRules'

export type TownResultFinish =
  | { status: 'ignored' }
  | { status: 'save-failed' }
  | { status: 'saved'; profile: CareerProfile }

/** Scene effects the settlement cannot decide itself: the save, co-op relay and scene replacement. */
export interface TownResultPorts {
  read(): CareerProfile
  /** Publishes the profile only after saving it; false leaves the current profile unchanged. */
  commit(profile: CareerProfile): boolean
  /** Co-op host only: relays the settled outcome to the guest's own save. */
  announce(outcome: { id: string; result: TownResult }): void
  dispose(): void
  restart(profile: CareerProfile, reason?: 'death-return'): void
}

/**
 * Settles a hostile Town event once. The result is claimed only by a successful save, so a
 * failed write can be retried by calling finish again and a settled event is never settled twice.
 */
export class TownResultSettlement {
  constructor(private readonly ports: TownResultPorts) {}

  finish(result: TownResult): TownResultFinish {
    const current = this.ports.read()
    if (current.townEvent?.state !== 'hostile') return { status: 'ignored' }
    const next = settleTown(current, current.townEvent.id, result)
    if (!this.ports.commit(next)) return { status: 'save-failed' }
    if (next.townEvent?.result) this.ports.announce({ id: next.townEvent.id, result: next.townEvent.result })
    return { status: 'saved', profile: next }
  }

  /** The transition out of Town; the scene offers it only on the result screen after a saved settlement. */
  leave(result: TownResult): void {
    this.ports.dispose()
    this.ports.restart(this.ports.read(), result === 'player_defeated' ? 'death-return' : undefined)
  }
}

export interface TownCasualtyPorts {
  actor(id: string): { takeDamage(amount: number): unknown } | undefined
  building(id: string): { hp: { destroy(): unknown } } | undefined
}

/** Re-applies the saved casualties of a hostile Town event to the freshly built Town. */
export function restoreTownCasualties(profile: CareerProfile, ports: TownCasualtyPorts): void {
  const event = profile.townEvent
  if (event?.state !== 'hostile') return
  for (const id of event.deadActorIds ?? []) ports.actor(id)?.takeDamage(999999)
  for (const id of event.destroyedBuildingIds ?? []) ports.building(id)?.hp.destroy()
}
