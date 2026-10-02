import { HERO_COMBAT_PROFILE_BY_ASSET, T4_COMBAT_PROFILES, type T4CombatProfileId } from '../battle/T4HeroCatalog'
import type { HeroAssetId } from '../world/HeroAssetCatalog'
import { normalizeSkillState, skillHpBonus } from '../rpg/SkillManager'
import type { CareerProfile } from './CareerProfile'

export function resolveCareerHeroAsset(
  profile: Pick<CareerProfile, 'faction' | 'rank'>,
): HeroAssetId | null {
  if (profile.rank !== 'captain' && profile.rank !== 'commander') return null
  return profile.faction === 'roman' ? 'roman-hero-t4' : 'viking-hero-t4'
}

export function resolveCareerCombatProfile(
  profile: Pick<CareerProfile, 'faction' | 'rank'>,
): T4CombatProfileId | null {
  const asset = resolveCareerHeroAsset(profile)
  return asset ? HERO_COMBAT_PROFILE_BY_ASSET[asset] : null
}

export function resolveCareerPlayerMaxHp(profile: Pick<CareerProfile, 'faction' | 'rank' | 'skills'>, normalMaxHp: number): number {
  const combatProfile = resolveCareerCombatProfile(profile)
  const baseMaxHp = combatProfile ? T4_COMBAT_PROFILES[combatProfile].maxHp : normalMaxHp
  return baseMaxHp + skillHpBonus(normalizeSkillState(profile.skills))
}

export function preserveHpRatio(oldHp: number, oldMaxHp: number, newMaxHp: number): number {
  if (oldHp <= 0 || oldMaxHp <= 0 || newMaxHp <= 0) return 0
  return Math.min(newMaxHp, Math.max(0, oldHp / oldMaxHp * newMaxHp))
}

