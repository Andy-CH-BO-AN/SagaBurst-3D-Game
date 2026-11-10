import { getOrdinarySoldierHp, type OrdinarySoldierTier } from '../combat/OrdinarySoldierProfile'
import { HERO_COMBAT_PROFILE_BY_ASSET, HERO_COMBAT_PROFILES, type HeroCombatProfileId } from '../battle/HeroCombatProfile'
import type { HeroAssetId } from '../world/HeroAssetCatalog'
import { resolveSkillAdjustedMaxHp } from '../rpg/CombatSkillProgression'
import type { CareerProfile } from './CareerProfile'

export function resolveCareerHeroAsset(
  profile: Pick<CareerProfile, 'faction' | 'rank' | 'eliteClass' | 't4Specialization'>,
): HeroAssetId | null {
  if (profile.rank !== 'captain' && profile.rank !== 'commander') return null
  if (profile.rank === 'commander' && profile.faction === 'roman' && profile.eliteClass === 'byzantine-cataphract') return 'byzantine-cataphract-t5'
  if (profile.rank === 'commander') return profile.faction === 'roman' ? 'roman-hero-t5' : 'viking-hero-t5'
  // Captain only: T4 class selects the body. T5 above never reads t4Specialization.
  if (profile.faction === 'roman') return profile.t4Specialization === 'centurion' ? 'roman-centurion-t4' : 'roman-hero-t4'
  return 'viking-hero-t4'
}

export function resolveCareerCombatProfile(
  profile: Pick<CareerProfile, 'faction' | 'rank' | 'eliteClass' | 't4Specialization'>,
): HeroCombatProfileId | null {
  const asset = resolveCareerHeroAsset(profile)
  return asset ? HERO_COMBAT_PROFILE_BY_ASSET[asset] : null
}

export function resolveCareerPlayerMaxHp(profile: Pick<CareerProfile, 'faction' | 'rank' | 'skills' | 'eliteClass' | 't4Specialization'>, _normalMaxHp?: number): number {
  const combatProfile = resolveCareerCombatProfile(profile)
  const baseMaxHp = combatProfile ? HERO_COMBAT_PROFILES[combatProfile].maxHp : getOrdinarySoldierHp(profile.faction, resolveCareerOrdinaryTier(profile))
  return resolveSkillAdjustedMaxHp(baseMaxHp, profile.skills)
}

export function preserveHpRatio(oldHp: number, oldMaxHp: number, newMaxHp: number): number {
  if (oldHp <= 0 || oldMaxHp <= 0 || newMaxHp <= 0) return 0
  return Math.min(newMaxHp, Math.max(0, oldHp / oldMaxHp * newMaxHp))
}

/** Only an appointed rank changes a Career body, never equipment or earned eligibility. */
export function resolveCareerCharacterTier(profile: Pick<CareerProfile, 'rank'>): 1 | 2 | 3 | 4 | 5 {
  return { recruit: 1, soldier: 2, veteran: 3, captain: 4, commander: 5 }[profile.rank] as 1 | 2 | 3 | 4 | 5
}

export function resolveCareerOrdinaryTier(profile: Pick<CareerProfile, 'rank'>): OrdinarySoldierTier {
  return Math.min(3, resolveCareerCharacterTier(profile)) as OrdinarySoldierTier
}
