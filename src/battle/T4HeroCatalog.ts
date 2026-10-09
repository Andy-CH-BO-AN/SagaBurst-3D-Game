import { resolveUnitLoadout, type UnitPresetId, type UnitLoadout } from './UnitPresetCatalog'
import { T4_RANGER_BOW_RANGED_ID } from '../rpg/WeaponDatabase'
import type { HeroAssetId } from '../world/HeroAssetCatalog'

export type T4CombatProfileId = 'varangian' | 'praetorian' | 'ranger'
export interface T4HeroCombatProfile {
  maxHp: number
  damageMultiplier: number
  damageTakenMultiplier: number
  attackSpeedMultiplier: number
  moveSpeedMultiplier: number
  rangedAttackRangeMultiplier: number
}

export const T4_COMBAT_PROFILES: Record<T4CombatProfileId, T4HeroCombatProfile> = {
  varangian: { maxHp: 500, damageMultiplier: 2, damageTakenMultiplier: 1, attackSpeedMultiplier: 1.5, moveSpeedMultiplier: 1.2, rangedAttackRangeMultiplier: 1 },
  praetorian: { maxHp: 500, damageMultiplier: 2, damageTakenMultiplier: .7, attackSpeedMultiplier: 1, moveSpeedMultiplier: 1, rangedAttackRangeMultiplier: 1 },
  ranger: { maxHp: 300, damageMultiplier: 1.3, damageTakenMultiplier: 1, attackSpeedMultiplier: 1, moveSpeedMultiplier: 1.3, rangedAttackRangeMultiplier: 2 },
}

export const HERO_COMBAT_PROFILE_BY_ASSET: Record<HeroAssetId, T4CombatProfileId> = {
  'viking-hero-t4': 'varangian',
  'roman-hero-t4': 'praetorian',
  'maki-archer-t4': 'ranger',
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

export function getT4HeroCombatModifiers(id?: T4CombatProfileId | null): T4HeroCombatProfile | null {
  return id ? T4_COMBAT_PROFILES[id] : null
}

export function applyHeroOutgoingDamage(damage: number, id?: T4CombatProfileId | null): number {
  return damage * (getT4HeroCombatModifiers(id)?.damageMultiplier ?? 1)
}

export function applyHeroIncomingDamage(damage: number, id?: T4CombatProfileId | null): number {
  return damage * (getT4HeroCombatModifiers(id)?.damageTakenMultiplier ?? 1)
}

/** Canonical hero equipment. Explicit runtime weapon swaps are never upgraded by character tier. */
export function resolveT4UnitLoadout(presetId: UnitPresetId): UnitLoadout {
  const profile = T4_UNIT_PROFILES[presetId]
  const base = resolveUnitLoadout(presetId, profile.baseLoadoutTier)
  return { ...base, mountId: profile.mountOverride,
    ...(profile.specialCombatProfile === 'maki-ranger'
      ? { rangedWeaponId: T4_RANGER_BOW_RANGED_ID, shieldId: null } : {}),
  }
}
