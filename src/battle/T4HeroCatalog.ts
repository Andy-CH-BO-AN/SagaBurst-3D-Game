import { resolveUnitLoadout, type UnitPresetId, type UnitLoadout } from './UnitPresetCatalog'
import { T4_RANGER_BOW_RANGED_ID, WEAPONS } from '../rpg/WeaponDatabase'
import type { HeroAssetId } from '../world/HeroAssetCatalog'
import { HERO_COMBAT_PROFILES, type HeroCombatProfile, type T4CombatProfileId } from './HeroCombatProfile'

// Keep existing callers compatible while all tiers share the same combat pipeline.
export { HERO_COMBAT_PROFILE_BY_ASSET, applyHeroIncomingDamage, applyHeroOutgoingDamage,
  getHeroCombatModifiers as getT4HeroCombatModifiers } from './HeroCombatProfile'
export type { T4CombatProfileId } from './HeroCombatProfile'
export type T4HeroCombatProfile = HeroCombatProfile

export const T4_COMBAT_PROFILES: Record<T4CombatProfileId, T4HeroCombatProfile> = {
  varangian: HERO_COMBAT_PROFILES.varangian,
  praetorian: HERO_COMBAT_PROFILES.praetorian,
  ranger: HERO_COMBAT_PROFILES.ranger,
}

export interface T4UnitProfile {
  visualAssetId: HeroAssetId
  combatProfileId: T4CombatProfileId
  baseLoadoutTier: 3
  mountOverride: UnitLoadout['mountId']
  specialCombatProfile?: 'maki-ranger'
}

const VARANGIAN_FOOT: T4UnitProfile = { visualAssetId: 'viking-hero-t4', combatProfileId: 'varangian', baseLoadoutTier: 3, mountOverride: null }
const VARANGIAN_MOUNTED: T4UnitProfile = { ...VARANGIAN_FOOT, mountOverride: 'black-cat' }
const PRAETORIAN_FOOT: T4UnitProfile = { visualAssetId: 'roman-hero-t4', combatProfileId: 'praetorian', baseLoadoutTier: 3, mountOverride: null }
const PRAETORIAN_MOUNTED: T4UnitProfile = { ...PRAETORIAN_FOOT, mountOverride: 'corgi' }
const RANGER: T4UnitProfile = { visualAssetId: 'maki-archer-t4', combatProfileId: 'ranger', baseLoadoutTier: 3, mountOverride: null, specialCombatProfile: 'maki-ranger' }

export const T4_UNIT_PROFILES: Record<UnitPresetId, T4UnitProfile> = {
  viking_berserker: VARANGIAN_FOOT,
  viking_spearman: VARANGIAN_FOOT,
  viking_archer: RANGER,
  viking_sword_cavalry: VARANGIAN_MOUNTED,
  viking_lancer: VARANGIAN_MOUNTED,
  viking_horse_archer: VARANGIAN_MOUNTED,
  roman_heavy_infantry: PRAETORIAN_FOOT,
  roman_spearman: PRAETORIAN_FOOT,
  roman_archer: RANGER,
  roman_javelin_infantry: PRAETORIAN_FOOT,
  roman_sword_cavalry: PRAETORIAN_MOUNTED,
  roman_lancer: PRAETORIAN_MOUNTED,
  roman_horse_archer: PRAETORIAN_MOUNTED,
}

/** Canonical hero equipment. Explicit runtime weapon swaps are never upgraded by character tier. */
export function resolveT4UnitLoadout(presetId: UnitPresetId): UnitLoadout {
  const profile = T4_UNIT_PROFILES[presetId]
  const base = { ...resolveUnitLoadout(presetId, profile.baseLoadoutTier) }
  if (profile.specialCombatProfile !== 'maki-ranger') {
    for (const slot of ['meleeWeaponId', 'secondaryMeleeWeaponId'] as const) {
      const weapon = WEAPONS[base[slot] ?? '']
      if (weapon?.animationKind === 'sword' || weapon?.animationKind === 'axe') {
        base[slot] = weapon.animationKind === 'axe' ? 'paladin_mace_t4' : 'paladin_sword_t4'
      }
    }
    if (base.shieldId) base.shieldId = 'paladin_shield_t4'
  }
  return { ...base, mountId: profile.mountOverride,
    ...(profile.specialCombatProfile === 'maki-ranger'
      ? { rangedWeaponId: T4_RANGER_BOW_RANGED_ID, shieldId: null } : {}),
  }
}
