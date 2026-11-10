import { getOrdinarySoldierHp, type OrdinarySoldierTier } from '../combat/OrdinarySoldierProfile'
import { HERO_COMBAT_PROFILE_BY_ASSET, HERO_COMBAT_PROFILES, type HeroCombatProfileId } from '../battle/HeroCombatProfile'
import type { HeroAssetId } from '../world/HeroAssetCatalog'
import { resolveSkillAdjustedMaxHp } from '../rpg/CombatSkillProgression'
import type { CareerProfile } from './CareerProfile'
import { currentCareerClass, type CareerClassId } from './CareerElitePromotion'
import { currentT4Class, type T4ClassId } from './CareerT4Promotion'

/** Body of each class road; the class itself (CareerElitePromotion / CareerT4Promotion) decides which one is in use. */
export const CAREER_CLASS_HERO: Readonly<Record<CareerClassId, HeroAssetId>> = {
  'roman-commander': 'roman-hero-t5', 'byzantine-cataphract': 'byzantine-cataphract-t5',
  'viking-commander': 'viking-hero-t5', 'ironblood-warlord': 'viking-heavy-hero-t5',
}
export const T4_CLASS_HERO: Readonly<Record<T4ClassId, HeroAssetId>> = {
  paladin: 'roman-hero-t4', centurion: 'roman-centurion-t4', varangian: 'viking-hero-t4', 'dragon-oathguard': 'viking-heavy-hero-t4',
}

export function resolveCareerHeroAsset(
  profile: Pick<CareerProfile, 'faction' | 'rank' | 'eliteClass' | 't4Specialization'>,
): HeroAssetId | null {
  // Commander: the T5 class alone selects the body (t4Specialization is kept as data only). Captain: the T4 class.
  const commander = currentCareerClass(profile)
  if (commander) return CAREER_CLASS_HERO[commander]
  const captain = currentT4Class(profile)
  return captain ? T4_CLASS_HERO[captain] : null
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
