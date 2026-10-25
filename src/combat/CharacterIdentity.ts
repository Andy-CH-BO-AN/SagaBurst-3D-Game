import { HERO_COMBAT_PROFILES, HERO_COMBAT_PROFILE_BY_ASSET, type HeroCombatProfileId } from '../battle/HeroCombatProfile'
import type { HeroAssetId } from '../world/HeroAssetCatalog'
import { getOrdinarySoldierHp, type SoldierFaction } from './OrdinarySoldierProfile'

export type CharacterTier = 1 | 2 | 3 | 4 | 5
export type HeroArchetype = 'captain' | 'ranger' | 'commander'
/** Body/profile identity. Allegiance, recruitment role and equipment belong to their existing owners. */
export interface CharacterIdentity {
  characterFaction: SoldierFaction
  characterTier: CharacterTier
  heroArchetype?: HeroArchetype
  visualAssetId?: HeroAssetId
  combatProfileId?: HeroCombatProfileId
  specialCombatProfile?: 'maki-ranger'
}
export interface CharacterIdentityInput extends Partial<Omit<CharacterIdentity, 'characterFaction'>> {
  characterFaction: SoldierFaction
  /** Compatibility input for old mission rosters; never pass weapon tier in new data. */
  tier?: 1 | 2 | 3 | 4
}
const ARCHETYPE_BY_PROFILE: Record<HeroCombatProfileId, HeroArchetype> = {
  varangian: 'captain', praetorian: 'captain', ranger: 'ranger',
  'roman-commander': 'commander', 'viking-commander': 'commander',
}

/** Exact registered asset/profile IDs adapt old T5-as-tier-4 records in one place. */
export function resolveCharacterIdentity(input: CharacterIdentityInput): CharacterIdentity {
  const { characterFaction } = input
  if (characterFaction !== 'roman' && characterFaction !== 'viking') throw new Error('Invalid character faction')
  if (input.characterTier !== undefined && ![1, 2, 3, 4, 5].includes(input.characterTier)
    || input.heroArchetype !== undefined && !['captain', 'ranger', 'commander'].includes(input.heroArchetype)
    || input.specialCombatProfile !== undefined && input.specialCombatProfile !== 'maki-ranger') throw new Error('Invalid character identity')
  const assetProfile = input.visualAssetId ? HERO_COMBAT_PROFILE_BY_ASSET[input.visualAssetId] : undefined
  if (input.visualAssetId && !assetProfile) throw new Error('Invalid hero asset')
  if (assetProfile && input.combatProfileId && assetProfile !== input.combatProfileId) throw new Error('Conflicting hero asset and profile')
  const legacyProfile = input.combatProfileId ?? assetProfile ?? (input.specialCombatProfile ? 'ranger' : undefined)
  if (legacyProfile && !ARCHETYPE_BY_PROFILE[legacyProfile]) throw new Error('Invalid hero profile')
  const legacyArchetype = legacyProfile ? ARCHETYPE_BY_PROFILE[legacyProfile] : undefined
  const heroArchetype = input.heroArchetype ?? legacyArchetype
    ?? ((input.characterTier ?? input.tier) === 5 ? 'commander' : (input.characterTier ?? input.tier) === 4 ? 'captain' : undefined)
  const characterTier = input.characterTier ?? (heroArchetype === 'commander' ? 5 : heroArchetype ? 4 : input.tier ?? 2)
  if (![1, 2, 3, 4, 5].includes(characterTier)
    || (characterTier <= 3 ? Boolean(heroArchetype) : characterTier === 4 ? !['captain', 'ranger'].includes(heroArchetype ?? '') : heroArchetype !== 'commander')
    || (legacyArchetype && legacyArchetype !== heroArchetype)
    || input.specialCombatProfile === 'maki-ranger' && heroArchetype !== 'ranger') throw new Error('Conflicting character tier and hero archetype')
  if (!heroArchetype) return { characterFaction, characterTier }
  const visualAssetId: HeroAssetId = heroArchetype === 'ranger' ? 'maki-archer-t4'
    : heroArchetype === 'commander' ? characterFaction === 'roman' ? 'roman-hero-t5' : 'viking-hero-t5'
      : characterFaction === 'roman' ? 'roman-hero-t4' : 'viking-hero-t4'
  const combatProfileId = HERO_COMBAT_PROFILE_BY_ASSET[visualAssetId]
  if (input.visualAssetId && input.visualAssetId !== visualAssetId || legacyProfile && legacyProfile !== combatProfileId) {
    throw new Error('Conflicting character faction and hero profile')
  }
  return { characterFaction, characterTier, heroArchetype, visualAssetId, combatProfileId,
    ...(heroArchetype === 'ranger' ? { specialCombatProfile: 'maki-ranger' as const } : {}) }
}

/** Ordinary soldiers and heroes keep their existing HP sources; special NPCs use their own profile. */
export function characterIdentityMaxHp(identity: CharacterIdentity): number {
  if (identity.combatProfileId) return HERO_COMBAT_PROFILES[identity.combatProfileId].maxHp
  const tier = identity.characterTier
  if (tier === 1 || tier === 2 || tier === 3) return getOrdinarySoldierHp(identity.characterFaction, tier)
  throw new Error('Hero identity requires a combat profile')
}
