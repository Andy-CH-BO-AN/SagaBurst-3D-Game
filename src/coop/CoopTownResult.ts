/**
 * LAN co-op: a hostile Town ends for both players together. The host settles its own
 * save; the guest receives the same result and applies the ordinary Town settlement
 * (death penalty, or defection to the other faction as a recruit) to its own save.
 */
import { cloneCareerProfile, type CareerProfile } from '../career/CareerProfile'
import { CareerProfileStore } from '../career/CareerProfileStore'
import { settleTown, type TownResult } from '../town/TownRules'

export interface CoopTownResult { id: string; result: TownResult }

export function parseCoopTownResult(value: unknown): CoopTownResult | null {
  if (!value || typeof value !== 'object') return null
  const r = value as Partial<CoopTownResult>
  if (typeof r.id !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(r.id)) return null
  if (r.result !== 'player_defeated' && r.result !== 'town_defeated') return null
  return { id: r.id, result: r.result }
}

/** The ordinary settlement on the guest's own profile; the host event id is the receipt. */
export function applyCoopTownResult(profile: CareerProfile, outcome: CoopTownResult): CareerProfile {
  if (profile.townEvent?.id === outcome.id) return profile
  const own = profile.townEvent?.state === 'hostile' ? profile.townEvent : undefined
  const staged = cloneCareerProfile(profile)
  staged.townEvent = { id: outcome.id, state: 'hostile' }
  const settled = settleTown(staged, outcome.id, outcome.result)
  // The guest's own unfinished Town event (in its own town) stays its own to settle.
  if (own) settled.townEvent = own
  return settled
}

/** Guest: commit the shared Town result to its own save (never the co-op memory copy). */
export function commitCoopTownResult(outcome: CoopTownResult, storage: Storage = localStorage): { penalty: number; defected: boolean } | { error: string } {
  const store = new CareerProfileStore(storage)
  const current = store.loadChecked().profile
  if (!current) return { error: '這台電腦沒有生涯存檔，無法套用城鎮結果。' }
  const next = applyCoopTownResult(current, outcome)
  if (next === current) return { penalty: 0, defected: false }
  if (!store.save(next)) return { error: '城鎮結果保存失敗。' }
  return { penalty: current.availableMerit - next.availableMerit, defected: next.faction !== current.faction }
}
