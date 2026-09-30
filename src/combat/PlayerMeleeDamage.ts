import { HERO_COMBAT_PROFILE_BY_ASSET, applyHeroOutgoingDamage } from '../battle/T4HeroCatalog'
import type { HeroAssetId } from '../world/HeroAssetCatalog'
import type { CharacterFaction } from '../world/CharacterVisuals'
import type { WeaponCombatKind } from '../rpg/WeaponDatabase'
import { calculateLanceChargeDamage, getBerserkerModifiers } from './CombatBalance'

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
    damage: applyHeroOutgoingDamage(Math.round(charge.damage * input.oneHandedMultiplier * berserker.meleeDamageMultiplier), profile),
    isCharge: charge.skipImpact,
  }
}
