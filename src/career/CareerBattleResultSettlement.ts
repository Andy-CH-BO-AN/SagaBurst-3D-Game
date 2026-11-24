import type { CareerProfile } from './CareerProfile'
import type { CareerProfileStore } from './CareerProfileStore'

export type CareerBattleResultSettlement =
  | { status: 'save-failed' }
  | { status: 'saved'; profile: CareerProfile }

/** What the battle kind decides: how the durable profile is claimed. Everything else is the shared transaction. */
export interface CareerBattleResultPorts {
  store: Pick<CareerProfileStore, 'loadChecked' | 'save'>
  /** Writes the in-progress skill XP; false means it is not durable. */
  flushSkills(): boolean
  /** Writes the battle's own checkpoint (field / veteran / personal outpost); false means it is not durable. */
  persistBattle(): boolean
  /** Claims the result on the freshly loaded profile; null refuses. `durable` means the claim already saved itself. */
  claim(fresh: CareerProfile): { profile: CareerProfile; durable?: boolean } | null
}

/**
 * Settles a Career battle result as one transaction: flush skills, persist the battle, reload the
 * stored profile, claim on it and save. The result is published only from `saved`; any failed step
 * leaves the stored profile untouched so the caller can offer a retry, and a claimed mission is never claimed twice.
 */
export function settleCareerBattleResult(ports: CareerBattleResultPorts): CareerBattleResultSettlement {
  if (!ports.flushSkills() || !ports.persistBattle()) return { status: 'save-failed' }
  const fresh = ports.store.loadChecked().profile
  if (!fresh) return { status: 'save-failed' }
  const claim = ports.claim(fresh)
  if (!claim) return { status: 'save-failed' }
  if (!claim.durable && !ports.store.save(claim.profile)) return { status: 'save-failed' }
  return { status: 'saved', profile: claim.profile }
}
