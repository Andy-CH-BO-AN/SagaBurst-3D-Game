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
export type CareerPurchaseKind = 'weapon' | 'armor' | 'mount' | 'hero'
export type CareerPurchaseTier = 1 | 2 | 3 | 4

export const CAREER_RANK_THRESHOLDS: Readonly<Record<CareerRank, number>> = {
  recruit: 0,
  soldier: 300,
  veteran: 900,
  captain: 5000,
  commander: 20000,
}

export const CAREER_PURCHASE_TIER_BY_RANK: Readonly<Record<CareerRank, CareerPurchaseTier>> = {
  recruit: 1,
  soldier: 2,
  veteran: 3,
  captain: 4,
  commander: 4,
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

  /** Lifetime earned merit. Never decreases and determines rank / purchasable tier. */
  totalMerit: number
  /** Spendable merit. Purchases deduct this without affecting rank. */
  availableMerit: number
  rank: CareerRank

  ownedWeapons: string[]
  ownedArmors: string[]
  ownedMounts: PlayerMountId[]
  ownedHeroes: HeroAssetId[]

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

export interface CareerPurchaseRequest {
  kind: CareerPurchaseKind
  id: string
  cost: number
  requiredTier: CareerPurchaseTier
}

export type CareerPurchaseFailureReason =
  | 'invalid-id'
  | 'invalid-cost'
  | 'already-owned'
  | 'tier-locked'
  | 'insufficient-merit'

export interface CareerPurchaseResult {
  profile: CareerProfile
  purchased: boolean
  spentMerit: number
  reason?: CareerPurchaseFailureReason
}

export function createCareerProfile(faction: CharacterFaction): CareerProfile {
  return {
    version: 1,
    faction,
    totalMerit: 0,
    availableMerit: 0,
    rank: 'recruit',
    ownedWeapons: [],
    ownedArmors: [],
    ownedMounts: [],
    ownedHeroes: [],
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

export function resolveCareerRank(totalMerit: number): CareerRank {
  const value = Math.max(0, Math.floor(totalMerit))
  if (value >= CAREER_RANK_THRESHOLDS.commander) return 'commander'
  if (value >= CAREER_RANK_THRESHOLDS.captain) return 'captain'
  if (value >= CAREER_RANK_THRESHOLDS.veteran) return 'veteran'
  if (value >= CAREER_RANK_THRESHOLDS.soldier) return 'soldier'
  return 'recruit'
}

export function getCareerPurchaseTier(rank: CareerRank): CareerPurchaseTier {
  return CAREER_PURCHASE_TIER_BY_RANK[rank]
}

export function isCareerPurchaseTierUnlocked(
  profile: Pick<CareerProfile, 'rank'>,
  tier: CareerPurchaseTier,
): boolean {
  return tier <= getCareerPurchaseTier(profile.rank)
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

  const totalMerit = current.totalMerit + meritBreakdown.total
  const availableMerit = current.availableMerit + meritBreakdown.total
  const newRank = resolveCareerRank(totalMerit)

  const profile = cloneCareerProfile(current)
  profile.totalMerit = totalMerit
  profile.availableMerit = availableMerit
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

export function purchaseCareerContent(
  current: CareerProfile,
  request: CareerPurchaseRequest,
): CareerPurchaseResult {
  const id = request.id.trim()
  if (!id) {
    return {
      profile: cloneCareerProfile(current),
      purchased: false,
      spentMerit: 0,
      reason: 'invalid-id',
    }
  }
  if (!Number.isInteger(request.cost) || request.cost < 0) {
    return {
      profile: cloneCareerProfile(current),
      purchased: false,
      spentMerit: 0,
      reason: 'invalid-cost',
    }
  }

  const profile = cloneCareerProfile(current)
  if (!isCareerPurchaseTierUnlocked(profile, request.requiredTier)) {
    return {
      profile,
      purchased: false,
      spentMerit: 0,
      reason: 'tier-locked',
    }
  }
  const target = request.kind === 'weapon'
    ? profile.ownedWeapons as string[]
    : request.kind === 'armor'
      ? profile.ownedArmors as string[]
      : request.kind === 'mount'
        ? profile.ownedMounts as string[]
        : profile.ownedHeroes as string[]

  if (target.includes(id)) {
    return {
      profile,
      purchased: false,
      spentMerit: 0,
      reason: 'already-owned',
    }
  }
  if (profile.availableMerit < request.cost) {
    return {
      profile,
      purchased: false,
      spentMerit: 0,
      reason: 'insufficient-merit',
    }
  }

  profile.availableMerit -= request.cost
  target.push(id)

  return {
    profile,
    purchased: true,
    spentMerit: request.cost,
  }
}

export function cloneCareerProfile(profile: CareerProfile): CareerProfile {
  return {
    ...profile,
    ownedWeapons: [...profile.ownedWeapons],
    ownedArmors: [...profile.ownedArmors],
    ownedMounts: [...profile.ownedMounts],
    ownedHeroes: [...profile.ownedHeroes],
    lifetimeStats: { ...profile.lifetimeStats },
    claimedBattleIds: [...profile.claimedBattleIds],
  }
}
