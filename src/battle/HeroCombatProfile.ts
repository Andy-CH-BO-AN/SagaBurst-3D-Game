import type { HeroAssetId } from '../world/HeroAssetCatalog'

export type T4CombatProfileId = 'varangian' | 'praetorian' | 'ranger'
export type HeroCombatProfileId = T4CombatProfileId | 'roman-commander' | 'viking-commander'

/** Shared by Player and NPC; player skill progression is applied by its existing owner. */
export interface HeroCombatProfile {
  maxHp: number
  damageMultiplier: number
  damageTakenMultiplier: number
  attackSpeedMultiplier: number
  moveSpeedMultiplier: number
  rangedAttackRangeMultiplier: number
}

export const HERO_COMBAT_PROFILES: Record<HeroCombatProfileId, HeroCombatProfile> = {
  varangian: { maxHp: 500, damageMultiplier: 2, damageTakenMultiplier: 1, attackSpeedMultiplier: 1.5, moveSpeedMultiplier: 1.2, rangedAttackRangeMultiplier: 1 },
  praetorian: { maxHp: 500, damageMultiplier: 2, damageTakenMultiplier: .7, attackSpeedMultiplier: 1, moveSpeedMultiplier: 1, rangedAttackRangeMultiplier: 1 },
  ranger: { maxHp: 300, damageMultiplier: 1.3, damageTakenMultiplier: 1, attackSpeedMultiplier: 1, moveSpeedMultiplier: 1.3, rangedAttackRangeMultiplier: 2 },
  'roman-commander': { maxHp: 850, damageMultiplier: 2.2, damageTakenMultiplier: .5, attackSpeedMultiplier: 1.15, moveSpeedMultiplier: 1.05, rangedAttackRangeMultiplier: 1 },
  'viking-commander': { maxHp: 950, damageMultiplier: 2.2, damageTakenMultiplier: .65, attackSpeedMultiplier: 1.55, moveSpeedMultiplier: 1.2, rangedAttackRangeMultiplier: 1 },
}

export const HERO_COMBAT_PROFILE_BY_ASSET: Record<HeroAssetId, HeroCombatProfileId> = {
  'viking-hero-t4': 'varangian',
  'roman-hero-t4': 'praetorian',
  'maki-archer-t4': 'ranger',
  'roman-hero-t5': 'roman-commander',
  'viking-hero-t5': 'viking-commander',
}

export function getHeroCombatModifiers(id?: HeroCombatProfileId | null): HeroCombatProfile | null {
  return id ? HERO_COMBAT_PROFILES[id] : null
}

export function applyHeroOutgoingDamage(damage: number, id?: HeroCombatProfileId | null): number {
  return damage * (getHeroCombatModifiers(id)?.damageMultiplier ?? 1)
}

export function applyHeroIncomingDamage(damage: number, id?: HeroCombatProfileId | null): number {
  return damage * (getHeroCombatModifiers(id)?.damageTakenMultiplier ?? 1)
}
