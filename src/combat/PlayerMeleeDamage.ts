import { HERO_COMBAT_PROFILE_BY_ASSET, applyHeroMeleeDamage, type HeroCombatProfileId } from '../battle/HeroCombatProfile'
import type { HeroAssetId } from '../world/HeroAssetCatalog'
import type { CharacterFaction } from '../world/CharacterVisuals'
import type { WeaponCombatKind } from '../rpg/WeaponDatabase'
import { calculateLanceChargeDamage, getAntiCavalryMultiplier, getBerserkerModifiers } from './CombatBalance'

export interface PlayerMeleeDamageInput {
  baseDamage: number
  combatKind: WeaponCombatKind
  isLance: boolean
  isMounted: boolean
  mountSpeed: number
  oneHandedMultiplier: number
  faction: CharacterFaction
  hasShield: boolean
  heroAssetId?: HeroAssetId
}

/** One authoritative player-melee pipeline shared by battles and Career Town. */
export function calculatePlayerMeleeDamage(input: PlayerMeleeDamageInput): { damage: number; isCharge: boolean } {
  const charge = calculateLanceChargeDamage(
    input.baseDamage,
    input.combatKind ?? (input.isLance ? 'lance' : 'sword'),
    input.isMounted,
    input.mountSpeed,
  )
  const berserker = getBerserkerModifiers(input.faction, input.isMounted, input.combatKind, input.hasShield)
  const profile = input.heroAssetId ? HERO_COMBAT_PROFILE_BY_ASSET[input.heroAssetId] : null
  return {
    damage: applyHeroMeleeDamage(Math.round(charge.damage * input.oneHandedMultiplier * berserker.meleeDamageMultiplier), profile),
    isCharge: charge.skipImpact,
  }
}

export interface NpcMeleeDamageInput {
  baseDamage: number
  /** The NPC's resolved melee kind, passed through without the Player's lance/sword fallback. */
  combatKind: WeaponCombatKind
  isMounted: boolean
  /** Fastest of the ridden mount and a pending charge latched before the contact frame. */
  chargeSpeed: number
  faction: CharacterFaction
  hasShield: boolean
  targetIsMounted: boolean
  combatProfileId?: HeroCombatProfileId
}

/** NPC melee pipeline: berserker, mounted lance charge, foot anti-cavalry, then the hero profile.
 * `skipImpact` asks the caller to suppress this frame's mount impact after a charge hit. */
export function calculateNpcMeleeDamage(input: NpcMeleeDamageInput): { damage: number; skipImpact: boolean } {
  const berserker = getBerserkerModifiers(input.faction, input.isMounted, input.combatKind, input.hasShield)
  let damage = input.baseDamage * berserker.meleeDamageMultiplier
  const charge = calculateLanceChargeDamage(input.baseDamage, input.combatKind, input.isMounted, input.chargeSpeed)
  if (charge.isCharge) damage = charge.damage * berserker.meleeDamageMultiplier
  damage *= getAntiCavalryMultiplier(input.combatKind, input.isMounted, input.targetIsMounted)
  return {
    damage: applyHeroMeleeDamage(Math.round(damage), input.combatProfileId),
    skipImpact: charge.isCharge && charge.skipImpact,
  }
}
