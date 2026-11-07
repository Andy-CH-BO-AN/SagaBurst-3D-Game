/**
 * T5HeroCatalog.ts
 * Authoritative Catalog of Tier 5 Commander Units, Loadouts and Mounts for Custom Battle.
 */
import type { HeroAssetId } from '../world/HeroAssetCatalog'
import type { HeroCombatProfileId } from './HeroCombatProfile'
import { getUnitPreset, resolveUnitLoadout, type UnitPresetId, type UnitLoadout } from './UnitPresetCatalog'
import { WEAPONS } from '../rpg/WeaponDatabase'
import type { CharacterFaction } from '../world/CharacterVisuals'

export const T4_RANDOM_MOUNTS = ['corgi', 'black-cat', 'white-cat', 'orange-cat'] as const
export const T5_RANDOM_MOUNTS = ['serval', 'caracal', 'snow-leopard'] as const

export type T4RandomMountId = typeof T4_RANDOM_MOUNTS[number]
export type T5RandomMountId = typeof T5_RANDOM_MOUNTS[number]

export interface T5UnitProfile {
  visualAssetId: HeroAssetId
  combatProfileId: HeroCombatProfileId
  baseLoadoutTier: 3
}

export function getT5ProfileForFaction(faction: CharacterFaction): T5UnitProfile {
  return {
    visualAssetId: faction === 'roman' ? 'roman-hero-t5' : 'viking-hero-t5',
    combatProfileId: faction === 'roman' ? 'roman-commander' : 'viking-commander',
    baseLoadoutTier: 3,
  }
}

export function resolveT5UnitLoadout(presetId: UnitPresetId, mountOverride?: string | null): UnitLoadout {
  const preset = getUnitPreset(presetId)
  const isRoman = preset.faction === 'roman'
  const base = { ...resolveUnitLoadout(presetId, 3) }

  for (const slot of ['meleeWeaponId', 'secondaryMeleeWeaponId'] as const) {
    const current = base[slot]
    if (current) {
      const weapon = WEAPONS[current]
      if (weapon?.combatKind === 'lance') {
        base[slot] = 'spear_t5'
      } else {
        base[slot] = isRoman ? 'sword_t5' : 'axe_t5'
      }
    }
  }

  if (base.shieldId) {
    base.shieldId = isRoman ? 'commander_shield_t5' : 'viking_berserker_shield_t5'
  }

  if (base.rangedWeaponId) {
    base.rangedWeaponId = 'bow_t5'
  }

  const isMounted = Boolean(base.mountId)
  return {
    ...base,
    mountId: isMounted ? (mountOverride ?? (isRoman ? 'caracal' : 'serval')) : null,
    reversibleRangedSwitch: Boolean(base.rangedWeaponId),
  }
}

/**
 * Returns deterministic random mount from specified pool for T4 and T5 cavalry.
 */
export function getCustomBattleMount(tier: number, prngOrSeed: (() => number) | number): string {
  const prng: () => number =
    typeof prngOrSeed === 'function'
      ? prngOrSeed
      : (() => {
          let s = (prngOrSeed >>> 0) + 0x6d2b79f5
          return () => {
            s = (s + 0x6d2b79f5) >>> 0
            let t = Math.imul(s ^ (s >>> 15), 1 | s)
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296
          }
        })()

  if (tier === 4) {
    const idx = Math.floor(prng() * T4_RANDOM_MOUNTS.length)
    return T4_RANDOM_MOUNTS[idx]
  }
  if (tier === 5) {
    const idx = Math.floor(prng() * T5_RANDOM_MOUNTS.length)
    return T5_RANDOM_MOUNTS[idx]
  }
  return 'horse'
}
