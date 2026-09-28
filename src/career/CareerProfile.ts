import type { BattleStatsSnapshot } from '../combat/BattleStatsTracker'
import type { PlayerMountId } from '../battle/BattleConfig'
import type { HeroAssetId } from '../world/HeroAssetCatalog'
import type { CharacterFaction } from '../world/CharacterVisuals'
import {
  calculateMerit,
  type CareerBattleOutcome,
  type CareerBattleRole,
  type MeritBreakdown,
} from './MeritCalculator'

export type CareerRank = 'recruit' | 'soldier' | 'veteran' | 'captain' | 'commander'

export const CAREER_RANK_THRESHOLDS: Readonly<Record<CareerRank, number>> = {
  recruit: 0,
  soldier: 300,
  veteran: 900,
  captain: 2000,
  commander: 4000,
}

export interface CareerLifetimeStats {
  battles: number
  victories: number
  deaths: number
  kills: number
  damage: number
  structureDamage: number
  breaches: number
}

export interface CareerProfile {
  version: 1
  faction: CharacterFaction
  merit: number
  rank: CareerRank
  unlockedWeapons: string[]
  unlockedShields: string[]
  unlockedMounts: PlayerMountId[]
  unlockedHeroes: HeroAssetId[]
  lifetimeStats: CareerLifetimeStats
  claimedBattleIds: string[]
}

export interface CareerBattleResult {
  battleId: string
  outcome: CareerBattleOutcome
  role: CareerBattleRole
  stats: BattleStatsSnapshot
}

export interface CareerBattleClaim {
  profile: CareerProfile
  meritAwarded: number
  meritBreakdown: MeritBreakdown
  alreadyClaimed: boolean
  previousRank: CareerRank
  newRank: CareerRank
}

export type CareerUnlockKind = 'weapon' | 'shield' | 'mount' | 'hero'

export function createCareerProfile(faction: CharacterFaction): CareerProfile {
  return {
    version: 1,
    faction,
    merit: 0,
    rank: 'recruit',
    unlockedWeapons: [],
    unlockedShields: [],
    unlockedMounts: [],
    unlockedHeroes: [],
    lifetimeStats: {
      battles: 0,
      victories: 0,
      deaths: 0,
      kills: 0,
      damage: 0,
      structureDamage: 0,
      breaches: 0,
    },
    claimedBattleIds: [],
  }
}

export function resolveCareerRank(merit: number): CareerRank {
  const value = Math.max(0, Math.floor(merit))
  if (value >= CAREER_RANK_THRESHOLDS.commander) return 'commander'
  if (value >= CAREER_RANK_THRESHOLDS.captain) return 'captain'
  if (value >= CAREER_RANK_THRESHOLDS.veteran) return 'veteran'
  if (value >= CAREER_RANK_THRESHOLDS.soldier) return 'soldier'
  return 'recruit'
}

export function claimCareerBattle(
  current: CareerProfile,
  result: CareerBattleResult,
): CareerBattleClaim {
  const battleId = result.battleId.trim()
  if (!battleId) throw new Error('Career battleId must not be empty')

  const previousRank = current.rank
  const meritBreakdown = calculateMerit(result.stats, result.outcome, result.role)

  if (current.claimedBattleIds.includes(battleId)) {
    return {
      profile: cloneCareerProfile(current),
      meritAwarded: 0,
      meritBreakdown,
      alreadyClaimed: true,
      previousRank,
      newRank: previousRank,
    }
  }

  const structureDamage = result.role === 'offense'
    ? Math.max(0, result.stats.player.structureDamage)
    : 0
  const breaches = result.role === 'offense'
    ? Math.max(0, Math.floor(result.stats.player.gateBreaches))
    : 0
  const merit = current.merit + meritBreakdown.total
  const newRank = resolveCareerRank(merit)

  const profile = cloneCareerProfile(current)
  profile.merit = merit
  profile.rank = newRank
  profile.claimedBattleIds.push(battleId)
  profile.lifetimeStats.battles += 1
  if (result.outcome === 'victory') profile.lifetimeStats.victories += 1
  if (!result.stats.player.survived) profile.lifetimeStats.deaths += 1
  profile.lifetimeStats.kills += Math.max(0, Math.floor(result.stats.player.kills))
  profile.lifetimeStats.damage += Math.max(0, result.stats.player.damageDealt)
  profile.lifetimeStats.structureDamage += structureDamage
  profile.lifetimeStats.breaches += breaches

  return {
    profile,
    meritAwarded: meritBreakdown.total,
    meritBreakdown,
    alreadyClaimed: false,
    previousRank,
    newRank,
  }
}

export function unlockCareerContent(
  profile: CareerProfile,
  kind: CareerUnlockKind,
  id: string,
): boolean {
  const value = id.trim()
  if (!value) return false

  const target = kind === 'weapon'
    ? profile.unlockedWeapons as string[]
    : kind === 'shield'
      ? profile.unlockedShields as string[]
      : kind === 'mount'
        ? profile.unlockedMounts as string[]
        : profile.unlockedHeroes as string[]

  if (target.includes(value)) return false
  target.push(value)
  return true
}

export function cloneCareerProfile(profile: CareerProfile): CareerProfile {
  return {
    ...profile,
    unlockedWeapons: [...profile.unlockedWeapons],
    unlockedShields: [...profile.unlockedShields],
    unlockedMounts: [...profile.unlockedMounts],
    unlockedHeroes: [...profile.unlockedHeroes],
    lifetimeStats: { ...profile.lifetimeStats },
    claimedBattleIds: [...profile.claimedBattleIds],
  }
}
