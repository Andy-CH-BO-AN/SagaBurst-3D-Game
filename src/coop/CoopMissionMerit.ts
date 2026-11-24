/**
 * LAN co-op merit: each player earns its own merit by the ordinary single-player rules.
 * The host counts the guest's own combat (its body and its own HR squad) and, when the
 * host's mission settles, sends the guest that record; the guest writes its award once
 * per host mission into its own save.
 */
import type { PlayerBattleStats } from '../combat/BattleStatsTracker'
import type { CombatEvent } from '../combat/CombatAttribution'
import type { ActiveCareerMission } from '../career/CareerMissionState'
import { careerMissionMerit, cloneCareerProfile, type CareerProfile } from '../career/CareerProfile'
import { CareerProfileStore } from '../career/CareerProfileStore'
import { calculateMerit } from '../career/MeritCalculator'
import { isPrisonBattleId, prisonEscapeMerit, type PrisonBattleId } from '../career/CareerPrisonBreak'

export type CoopMissionKind = ActiveCareerMission['kind'] | 'outpost-defense' | 'outpost-relief' | 'prison-break'

export interface CoopMissionMerit {
  /** The host's mission id: the receipt that keeps the award single. */
  missionId: string
  kind: CoopMissionKind
  victory: boolean
  stats: PlayerBattleStats
  /** Prison break only: the encounter whose fixed escape reward applies. */
  prison?: PrisonBattleId
}

export function emptyCoopStats(): PlayerBattleStats {
  return { damageDealt: 0, damageTaken: 0, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: true }
}

/** Host: add one combat event to the guest's record when the guest (or its own squad) caused or took it. */
export function recordCoopGuestEvent(stats: PlayerBattleStats, event: CombatEvent, guestActorIds: ReadonlySet<string>): void {
  if (event.type === 'damage_applied') {
    if (guestActorIds.has(event.source.actorId) && event.target.allegiance !== event.source.allegiance) stats.damageDealt += Math.max(0, event.appliedDamage)
    if (guestActorIds.has(event.target.targetId)) stats.damageTaken += Math.max(0, event.appliedDamage)
  } else if (event.type === 'actor_killed' && guestActorIds.has(event.source.actorId) && event.target.allegiance !== event.source.allegiance) {
    stats.kills += 1
  } else if (event.type === 'structure_damaged' && guestActorIds.has(event.source.actorId)) {
    stats.structureDamage += Math.max(0, event.appliedDamage)
  } else if (event.type === 'structure_destroyed' && guestActorIds.has(event.source.actorId)) {
    stats.structuresDestroyed += 1
  }
}

/** The same merit the host's own claim would give for these stats. */
export function coopMissionMeritTotal(record: CoopMissionMerit): number {
  if (record.kind === 'prison-break') return record.prison ? prisonEscapeMerit(record.prison, record.victory ? 'victory' : 'failure') : 0
  if (record.kind === 'outpost-defense' || record.kind === 'outpost-relief') {
    return calculateMerit({ player: record.stats, squads: [] }, record.victory ? 'victory' : 'defeat', 'defense', 'mission').total
  }
  return careerMissionMerit(record.kind, record.victory ? 'victory' : 'failure', record.stats).total
}

export function parseCoopMissionMerit(value: unknown): CoopMissionMerit | null {
  if (!value || typeof value !== 'object') return null
  const r = value as Partial<CoopMissionMerit>
  if (typeof r.missionId !== 'string' || !r.missionId || r.missionId.length > 200 || typeof r.kind !== 'string' || typeof r.victory !== 'boolean') return null
  const s = r.stats as Partial<PlayerBattleStats> | undefined
  const numbers = ['damageDealt', 'damageTaken', 'kills', 'structureDamage', 'structuresDestroyed', 'gateBreaches'] as const
  if (!s || numbers.some(key => typeof s[key] !== 'number' || !Number.isFinite(s[key]) || s[key]! < 0) || typeof s.survived !== 'boolean') return null
  if ((r.kind === 'prison-break') !== (r.prison !== undefined) || r.prison !== undefined && !isPrisonBattleId(r.prison)) return null
  return { missionId: r.missionId, kind: r.kind as CoopMissionKind, victory: r.victory, ...(r.prison ? { prison: r.prison } : {}),
    stats: { damageDealt: s.damageDealt!, damageTaken: s.damageTaken!, kills: Math.floor(s.kills!), structureDamage: s.structureDamage!,
      structuresDestroyed: Math.floor(s.structuresDestroyed!), gateBreaches: Math.floor(s.gateBreaches!), survived: s.survived } }
}

/** The guest's own award; the host mission id in claimedBattleIds makes a re-send a no-op. */
export function applyCoopMissionMerit(profile: CareerProfile, record: CoopMissionMerit): { profile: CareerProfile; merit: number } {
  if (profile.claimedBattleIds.includes(record.missionId)) return { profile, merit: 0 }
  const merit = coopMissionMeritTotal(record)
  const next = cloneCareerProfile(profile)
  next.totalMerit += merit
  next.availableMerit += merit
  next.claimedBattleIds.push(record.missionId)
  // The single-player escape writes only its fixed reward; the lost parent battle already counted.
  if (record.kind === 'prison-break') return { profile: next, merit }
  next.lifetimeStats.battles += 1
  if (record.victory) next.lifetimeStats.victories += 1
  if (!record.stats.survived) next.lifetimeStats.deaths += 1
  next.lifetimeStats.kills += record.stats.kills
  next.lifetimeStats.damage += record.stats.damageDealt
  return { profile: next, merit }
}

/** Guest: commit to its own save (never the co-op memory copy). */
export function commitCoopMissionMerit(record: CoopMissionMerit, storage: Storage = localStorage): { merit: number } | { error: string } {
  const store = new CareerProfileStore(storage)
  const current = store.loadChecked().profile
  if (!current) return { error: '這台電腦沒有生涯存檔，無法領取軍功。' }
  const { profile, merit } = applyCoopMissionMerit(current, record)
  if (profile === current) return { merit: 0 }
  if (!store.save(profile)) return { error: '軍功保存失敗。' }
  return { merit }
}
