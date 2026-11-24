/**
 * LAN co-op race: when the guest finishes before both the host and the Commander,
 * only that one race reward is written into the guest's own Career save.
 */
import { cloneCareerProfile, type CareerProfile } from '../career/CareerProfile'
import { CareerProfileStore } from '../career/CareerProfileStore'
import { RACE_SCHEDULE_VERSION, raceDefinitionForSchedule } from '../career/CareerRaceState'

export interface CoopRaceAward {
  /** The host's race session; the receipt that keeps the award single. */
  sessionId: string
  raceId: string
  scheduleVersion: number
  guestSeconds: number
  opponentSeconds?: number
}

export function parseCoopRaceAward(value: unknown): CoopRaceAward | null {
  if (!value || typeof value !== 'object') return null
  const a = value as Partial<CoopRaceAward>
  if (typeof a.sessionId !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(a.sessionId) || typeof a.raceId !== 'string'
    || typeof a.scheduleVersion !== 'number' || typeof a.guestSeconds !== 'number' || !Number.isFinite(a.guestSeconds) || a.guestSeconds <= 0
    || a.opponentSeconds !== undefined && (typeof a.opponentSeconds !== 'number' || !Number.isFinite(a.opponentSeconds))) return null
  return { sessionId: a.sessionId, raceId: a.raceId, scheduleVersion: a.scheduleVersion, guestSeconds: a.guestSeconds,
    ...(a.opponentSeconds !== undefined ? { opponentSeconds: a.opponentSeconds } : {}) }
}

/** The ordinary race win (record, merit, best time, completion) applied to the guest's profile; null when not applicable. */
export function applyCoopRaceAward(profile: CareerProfile, award: CoopRaceAward): CareerProfile | null {
  const definition = raceDefinitionForSchedule(award.raceId, award.scheduleVersion)
  if (!definition) return null
  if (profile.raceRecords?.some(record => record.sessionId === award.sessionId)) return profile
  const next = cloneCareerProfile(profile)
  next.raceRecords = [...(next.raceRecords ?? []), { sessionId: award.sessionId, raceId: definition.id, scheduleVersion: RACE_SCHEDULE_VERSION,
    result: 'win', legalFinish: true, playerSeconds: award.guestSeconds,
    ...(award.opponentSeconds !== undefined ? { opponentSeconds: award.opponentSeconds } : {}), merit: definition.merit }]
  next.totalMerit += definition.merit
  next.availableMerit += definition.merit
  next.raceScheduleVersion = RACE_SCHEDULE_VERSION
  next.raceBestSeconds = { ...next.raceBestSeconds, [definition.id]: Math.min(next.raceBestSeconds?.[definition.id] ?? Infinity, award.guestSeconds) }
  next.completedRaceIds = [...new Set([...(next.completedRaceIds ?? []), definition.id])]
  return next
}

/** Guest: commit the award to its own save (never the co-op memory copy). Returns the merit, or null. */
export function commitCoopRaceAward(award: CoopRaceAward, storage: Storage = localStorage): { merit: number } | { error: string } {
  const store = new CareerProfileStore(storage)
  const current = store.loadChecked().profile
  if (!current) return { error: '這台電腦沒有生涯存檔，無法領取賽馬獎勵。' }
  const next = applyCoopRaceAward(current, award)
  if (!next) return { error: '賽事資料不符，無法領取獎勵。' }
  if (next === current) return { merit: 0 }
  if (!store.save(next)) return { error: '賽馬獎勵保存失敗。' }
  return { merit: next.totalMerit - current.totalMerit }
}
