import type { HeroAssetId } from '../world/HeroAssetCatalog'

export type T4CombatProfileId = 'varangian' | 'praetorian' | 'centurion' | 'dragon-oathguard' | 'ranger'
export type HeroCombatProfileId = T4CombatProfileId | 'roman-commander' | 'viking-commander' | 'byzantine-cataphract' | 'ironblood-warlord'

/** Shared by Player and NPC; player skill progression is applied by its existing owner. */
export interface HeroCombatProfile {
  maxHp: number
  damageMultiplier: number
  meleeDamageMultiplier?: number
  damageTakenMultiplier: number
  attackSpeedMultiplier: number
  meleeAttackSpeedMultiplier?: number
  moveSpeedMultiplier: number
  rangedAttackRangeMultiplier: number
}

export const HERO_COMBAT_PROFILES: Record<HeroCombatProfileId, HeroCombatProfile> = {
  'byzantine-cataphract': { maxHp: 1000, damageMultiplier: 3, damageTakenMultiplier: .4, attackSpeedMultiplier: 1.3, meleeAttackSpeedMultiplier: 1.3, moveSpeedMultiplier: 1, rangedAttackRangeMultiplier: 1 },
  varangian: { maxHp: 500, damageMultiplier: 2, damageTakenMultiplier: 1, attackSpeedMultiplier: 1.5, moveSpeedMultiplier: 1.2, rangedAttackRangeMultiplier: 1 },
  praetorian: { maxHp: 500, damageMultiplier: 2, damageTakenMultiplier: .7, attackSpeedMultiplier: 1, moveSpeedMultiplier: 1, rangedAttackRangeMultiplier: 1 },
  // Career-only Roman T4 second class (7,000 merit); NPC Roman T4 rosters keep praetorian.
  centurion: { maxHp: 700, damageMultiplier: 2.2, damageTakenMultiplier: .6, attackSpeedMultiplier: 1, moveSpeedMultiplier: 1, rangedAttackRangeMultiplier: 1 },
  // Career-only Viking T4 heavy class (7,000 merit): slower (on foot and mounted), tougher, harder single hits; NPC Viking T4 keep varangian.
  'dragon-oathguard': { maxHp: 550, damageMultiplier: 2.3, damageTakenMultiplier: .85, attackSpeedMultiplier: 1.4, moveSpeedMultiplier: 1, rangedAttackRangeMultiplier: 1 },
  ranger: { maxHp: 300, damageMultiplier: 1.3, damageTakenMultiplier: 1, attackSpeedMultiplier: 1, moveSpeedMultiplier: 1.3, rangedAttackRangeMultiplier: 2 },
  'roman-commander': { maxHp: 850, damageMultiplier: 2.2, damageTakenMultiplier: .5, attackSpeedMultiplier: 1.15, moveSpeedMultiplier: 1.05, rangedAttackRangeMultiplier: 1 },
  'viking-commander': { maxHp: 900, damageMultiplier: 2.2, meleeDamageMultiplier: 2.6, damageTakenMultiplier: .8, attackSpeedMultiplier: 1.55, meleeAttackSpeedMultiplier: 1.7, moveSpeedMultiplier: 1.2, rangedAttackRangeMultiplier: 1 },
  // Career-only Viking T5 heavy class (30,000 merit); the same heavy trade-off as Dragon Oathguard. NPC Viking T5 keep viking-commander.
  'ironblood-warlord': { maxHp: 1000, damageMultiplier: 2.4, meleeDamageMultiplier: 2.9, damageTakenMultiplier: .7, attackSpeedMultiplier: 1.45, meleeAttackSpeedMultiplier: 1.6, moveSpeedMultiplier: 1, rangedAttackRangeMultiplier: 1 },
}

export const HERO_COMBAT_PROFILE_BY_ASSET: Record<HeroAssetId, HeroCombatProfileId> = {
  'byzantine-cataphract-t5': 'byzantine-cataphract',
  'viking-hero-t4': 'varangian',
  'roman-hero-t4': 'praetorian',
  'roman-centurion-t4': 'centurion',
  'maki-archer-t4': 'ranger',
  'roman-hero-t5': 'roman-commander',
  'viking-hero-t5': 'viking-commander',
  'viking-heavy-hero-t4': 'dragon-oathguard',
  'viking-heavy-hero-t5': 'ironblood-warlord',
}

/** Army whose soldiers may wear each hero profile; the Ranger serves both factions. Independent of the rig's own descriptor faction. */
export const HERO_PROFILE_FACTION: Readonly<Record<HeroCombatProfileId, 'roman' | 'viking' | null>> = {
  'byzantine-cataphract': 'roman', praetorian: 'roman', centurion: 'roman', 'roman-commander': 'roman',
  varangian: 'viking', 'dragon-oathguard': 'viking', 'viking-commander': 'viking', 'ironblood-warlord': 'viking',
  ranger: null,
}

export function getHeroCombatModifiers(id?: HeroCombatProfileId | null): HeroCombatProfile | null {
  return id ? HERO_COMBAT_PROFILES[id] : null
}

export function applyHeroOutgoingDamage(damage: number, id?: HeroCombatProfileId | null): number {
  return damage * (getHeroCombatModifiers(id)?.damageMultiplier ?? 1)
}

export function applyHeroMeleeDamage(damage: number, id?: HeroCombatProfileId | null): number {
  const profile = getHeroCombatModifiers(id)
  return damage * (profile?.meleeDamageMultiplier ?? profile?.damageMultiplier ?? 1)
}

export function heroMeleeAttackSpeed(id?: HeroCombatProfileId | null): number {
  const profile = getHeroCombatModifiers(id)
  return profile?.meleeAttackSpeedMultiplier ?? profile?.attackSpeedMultiplier ?? 1
}

export function applyHeroIncomingDamage(damage: number, id?: HeroCombatProfileId | null): number {
  return damage * (getHeroCombatModifiers(id)?.damageTakenMultiplier ?? 1)
}
