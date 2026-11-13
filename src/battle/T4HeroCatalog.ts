import { getUnitPreset, resolveUnitLoadout, type UnitPresetId, type UnitLoadout } from './UnitPresetCatalog'
import { defaultRangerMeleeWeaponId, T4_RANGER_BOW_RANGED_ID, WEAPONS } from '../rpg/WeaponDatabase'
import type { HeroAssetId } from '../world/HeroAssetCatalog'
import type { CharacterFaction } from '../world/CharacterVisuals'
import { HERO_COMBAT_PROFILES, type HeroCombatProfile, type T4CombatProfileId } from './HeroCombatProfile'

// Keep existing callers compatible while all tiers share the same combat pipeline.
export { HERO_COMBAT_PROFILE_BY_ASSET, applyHeroIncomingDamage, applyHeroOutgoingDamage,
  getHeroCombatModifiers as getT4HeroCombatModifiers } from './HeroCombatProfile'
export type { T4CombatProfileId } from './HeroCombatProfile'
export type T4HeroCombatProfile = HeroCombatProfile

export const T4_COMBAT_PROFILES: Record<T4CombatProfileId, T4HeroCombatProfile> = {
  varangian: HERO_COMBAT_PROFILES.varangian,
  praetorian: HERO_COMBAT_PROFILES.praetorian,
  centurion: HERO_COMBAT_PROFILES.centurion,
  'dragon-oathguard': HERO_COMBAT_PROFILES['dragon-oathguard'],
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
/** The faction's second (heavy) T4 class: its body and combat profile, independent of weapons and mount. */
export const HEAVY_T4_HERO: Readonly<Record<CharacterFaction, Pick<T4UnitProfile, 'visualAssetId' | 'combatProfileId'>>> = {
  roman: { visualAssetId: 'roman-centurion-t4', combatProfileId: 'centurion' },
  viking: { visualAssetId: 'viking-heavy-hero-t4', combatProfileId: 'dragon-oathguard' },
}
/** All T4 heavy cavalry, in every mode, is the heavy class; only Heavy Cavalry changes class, so the other presets keep their profiles. */
const DRAGON_OATHGUARD_HEAVY_CAVALRY: T4UnitProfile = { ...VARANGIAN_FOOT, ...HEAVY_T4_HERO.viking, mountOverride: 'snow-leopard' }
const CENTURION_HEAVY_CAVALRY: T4UnitProfile = { ...PRAETORIAN_FOOT, ...HEAVY_T4_HERO.roman, mountOverride: 'armored-horse' }
const RANGER: T4UnitProfile = { visualAssetId: 'maki-archer-t4', combatProfileId: 'ranger', baseLoadoutTier: 3, mountOverride: null, specialCombatProfile: 'maki-ranger' }

export const T4_UNIT_PROFILES: Record<UnitPresetId, T4UnitProfile> = {
  viking_berserker: VARANGIAN_FOOT,
  viking_spearman: VARANGIAN_FOOT,
  viking_archer: RANGER,
  viking_sword_cavalry: VARANGIAN_MOUNTED,
  viking_lancer: VARANGIAN_MOUNTED,
  viking_horse_archer: VARANGIAN_MOUNTED,
  viking_heavy_cavalry: DRAGON_OATHGUARD_HEAVY_CAVALRY,
  roman_heavy_infantry: PRAETORIAN_FOOT,
  roman_spearman: PRAETORIAN_FOOT,
  roman_archer: RANGER,
  roman_javelin_infantry: PRAETORIAN_FOOT,
  roman_sword_cavalry: PRAETORIAN_MOUNTED,
  roman_lancer: PRAETORIAN_MOUNTED,
  roman_horse_archer: PRAETORIAN_MOUNTED,
  roman_heavy_cavalry: CENTURION_HEAVY_CAVALRY,
}

/** The faction's heavy T4 class for a captain profile; Rangers have no second body and keep theirs. Weapons and mounts stay the caller's. */
export function heavyT4Variant(profile: T4UnitProfile, faction: CharacterFaction): T4UnitProfile {
  return profile.combatProfileId === 'ranger' ? profile : { ...profile, ...HEAVY_T4_HERO[faction] }
}

/** Default shield of each T4 Heavy Cavalry preset; every other T4 preset keeps the faction's shared shield. */
const HEAVY_CAVALRY_SHIELD: Partial<Record<UnitPresetId, string>> = {
  roman_heavy_cavalry: 'centurion_aquila_shield_t4',
  viking_heavy_cavalry: 'viking_dragonward_shield_t4',
}

/** Shield ids a T4 army must preload on demand (only the Heavy Cavalry signature shields are optional gear). */
export function t4EquipmentIdsForArmy(counts: Record<string, { 4?: number }>): string[] {
  return Object.entries(counts).flatMap(([presetId, tiers]) => {
    if (!(tiers[4] ?? 0)) return []
    const shieldId = HEAVY_CAVALRY_SHIELD[presetId as UnitPresetId]
    return shieldId ? [shieldId] : []
  })
}

/** Canonical hero equipment. Explicit runtime weapon swaps are never upgraded by character tier. */
export function resolveT4UnitLoadout(presetId: UnitPresetId, mountOverride?: string | null): UnitLoadout {
  const profile = T4_UNIT_PROFILES[presetId]
  const base = { ...resolveUnitLoadout(presetId, profile.baseLoadoutTier) }
  if (profile.specialCombatProfile !== 'maki-ranger') {
    for (const slot of ['meleeWeaponId', 'secondaryMeleeWeaponId'] as const) {
      const weapon = WEAPONS[base[slot] ?? '']
      if (weapon?.combatKind === 'lance') base[slot] = 'spear_t4'
      if (weapon?.animationKind === 'sword' || weapon?.animationKind === 'axe') {
        base[slot] = weapon.animationKind === 'axe' ? 'paladin_mace_t4' : 'paladin_sword_t4'
      }
    }
    // Shield follows the army, not the body: only the two Heavy Cavalry presets carry their faction signature shield.
    if (base.shieldId) base.shieldId = HEAVY_CAVALRY_SHIELD[presetId] ?? (getUnitPreset(presetId).faction === 'roman' ? 'roman_officer_shield_t4' : 'paladin_shield_t4')
  }
  return { ...base, mountId: profile.mountOverride ? (mountOverride ?? profile.mountOverride) : null,
    ...(profile.specialCombatProfile === 'maki-ranger'
      ? { meleeWeaponId: defaultRangerMeleeWeaponId(getUnitPreset(presetId).faction),
          rangedWeaponId: T4_RANGER_BOW_RANGED_ID, shieldId: null, reversibleRangedSwitch: true } : {}),
  }
}
