import type { BattleStatsSnapshot } from '../combat/BattleStatsTracker'
import type { PlayerMountId } from '../battle/BattleConfig'
import type { HeroAssetId } from '../world/HeroAssetCatalog'
import type { CharacterFaction } from '../world/CharacterVisuals'
import { calculateRecruitMissionMerit } from './CareerMissionMeritPolicy'
import type { ActiveCareerMission, CareerMissionOutcome } from './CareerMissionState'
import {
  calculateMerit,
  type CareerBattleOutcome,
  type CareerBattleRole,
  type MeritBreakdown,
} from './MeritCalculator'

export type CareerRank = 'recruit' | 'soldier' | 'veteran' | 'captain' | 'commander'
export type CareerPurchaseKind = 'weapon' | 'armor' | 'mount' | 'hero'
export type CareerPurchaseTier = 1 | 2 | 3 | 4
export type CareerMountId = 'horse-t1' | 'horse-t2' | 'horse-t3' | 'black-cat' | 'corgi'

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

  /** Lifetime earned merit. Never decreases; appointments use merit earned during this enlistment. */
  totalMerit: number
  /** Spendable merit. Purchases deduct this without affecting rank. */
  availableMerit: number
  rank: CareerRank
  enlistmentMeritBase: number
  equipment?: { melee?: string; ranged?: string; shield?: string | null }
  starterWeaponId?: string
  townDialogueSeen?: string[]
  ownedHorseTiers?: (1 | 2 | 3)[]
  selectedMountId?: CareerMountId
  activeMission?: ActiveCareerMission
  careerMissionCompletions?: number
  completedCareerMissionTemplateIds?: string[]
  townEvent?: { id: string; state: 'hostile' | 'settled'; result?: 'player_defeated' | 'town_defeated'; penalty?: number; deadActorIds?: string[]; destroyedBuildingIds?: string[] }

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

export interface CareerMissionClaim {
  profile: CareerProfile
  meritAwarded: number
  alreadyClaimed: boolean
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
    enlistmentMeritBase: 0,
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
  const newRank = current.rank

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

export function claimCareerMission(
  current: CareerProfile,
  missionId: string,
  outcome: CareerMissionOutcome,
  stats: BattleStatsSnapshot['player'],
): CareerMissionClaim {
  const active = current.activeMission
  if (!active || active.id !== missionId) {
    return { profile: cloneCareerProfile(current), meritAwarded: 0, alreadyClaimed: false }
  }
  if (current.claimedBattleIds.includes(missionId)) {
    return { profile: cloneCareerProfile(current), meritAwarded: 0, alreadyClaimed: true }
  }

  const merit = calculateRecruitMissionMerit(stats, outcome)
  const profile = cloneCareerProfile(current)
  profile.totalMerit += merit.total
  profile.availableMerit += merit.total
  profile.claimedBattleIds.push(missionId)
  profile.lifetimeStats.battles += 1
  if (outcome === 'victory') {
    profile.lifetimeStats.victories += 1
    profile.careerMissionCompletions = (profile.careerMissionCompletions ?? 0) + 1
    if (active.kind === 'town-defense' && !(profile.completedCareerMissionTemplateIds ?? []).includes(active.templateId)) {
      profile.completedCareerMissionTemplateIds = [...(profile.completedCareerMissionTemplateIds ?? []), active.templateId]
    }
  }
  if (!stats.survived) profile.lifetimeStats.deaths += 1
  profile.lifetimeStats.kills += Math.max(0, Math.floor(stats.kills))
  profile.lifetimeStats.damage += Math.max(0, stats.damageDealt)
  profile.activeMission = {
    ...active,
    phase: 'RESULT',
    targetActorIds: [...active.targetActorIds],
    friendlyActorIds: [...active.friendlyActorIds],
    result: { outcome, stats: { ...stats }, merit, claimed: true },
  }
  return { profile, meritAwarded: merit.total, alreadyClaimed: false }
}

export function clearCareerMission(current: CareerProfile, missionId: string): CareerProfile {
  const profile = cloneCareerProfile(current)
  if (profile.activeMission?.id === missionId) delete profile.activeMission
  return profile
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
    ...(profile.equipment ? { equipment: { ...profile.equipment } } : {}),
    ...(profile.townEvent ? { townEvent: { ...profile.townEvent, ...(profile.townEvent.deadActorIds ? { deadActorIds: [...profile.townEvent.deadActorIds] } : {}), ...(profile.townEvent.destroyedBuildingIds ? { destroyedBuildingIds: [...profile.townEvent.destroyedBuildingIds] } : {}) } } : {}),
    ...(profile.townDialogueSeen ? { townDialogueSeen: [...profile.townDialogueSeen] } : {}),
    ...(profile.ownedHorseTiers ? { ownedHorseTiers: [...profile.ownedHorseTiers] } : {}),
    ...(profile.activeMission ? { activeMission: {
      ...profile.activeMission,
      targetActorIds: [...profile.activeMission.targetActorIds],
      friendlyActorIds: [...profile.activeMission.friendlyActorIds],
      ...(profile.activeMission.deadTargetActorIds ? { deadTargetActorIds: [...profile.activeMission.deadTargetActorIds] } : {}),
      ...(profile.activeMission.deadFriendlyActorIds ? { deadFriendlyActorIds: [...profile.activeMission.deadFriendlyActorIds] } : {}),
      ...(profile.activeMission.deadCivilianActorIds ? { deadCivilianActorIds: [...profile.activeMission.deadCivilianActorIds] } : {}),
      ...(profile.activeMission.result ? { result: {
        ...profile.activeMission.result,
        stats: { ...profile.activeMission.result.stats },
        merit: { ...profile.activeMission.result.merit },
        ...(profile.activeMission.result.defense ? { defense: { ...profile.activeMission.result.defense } } : {}),
      } } : {}),
      ...(profile.activeMission.civilianActorIds ? { civilianActorIds: [...profile.activeMission.civilianActorIds] } : {}),
    } } : {}),
    ...(profile.completedCareerMissionTemplateIds ? { completedCareerMissionTemplateIds: [...profile.completedCareerMissionTemplateIds] } : {}),
    ownedWeapons: [...profile.ownedWeapons],
    ownedArmors: [...profile.ownedArmors],
    ownedMounts: [...profile.ownedMounts],
    ownedHeroes: [...profile.ownedHeroes],
    lifetimeStats: { ...profile.lifetimeStats },
    claimedBattleIds: [...profile.claimedBattleIds],
  }
}

export const CAREER_RANKS: CareerRank[] = ['recruit', 'soldier', 'veteran', 'captain', 'commander']
export function enlistmentMerit(profile: CareerProfile): number {
  return Math.max(0, profile.totalMerit - profile.enlistmentMeritBase)
}
export function eligibleRank(profile: CareerProfile): CareerRank {
  return resolveCareerRank(enlistmentMerit(profile))
}
export function promoteCareer(profile: CareerProfile): CareerProfile | null {
  const next = CAREER_RANKS[CAREER_RANKS.indexOf(profile.rank) + 1]
  if (!next || enlistmentMerit(profile) < CAREER_RANK_THRESHOLDS[next]) return null
  return { ...cloneCareerProfile(profile), rank: next }
}
