import { PLAYER_MOUNT_IDS, type PlayerMountId } from '../battle/BattleConfig'
import type { UnitLoadout } from '../battle/UnitPresetCatalog'

export type TownMerchantMountId = Exclude<PlayerMountId, 'xongkoro'>

export function isTownMerchantMountId(mountId: string | null | undefined): mountId is TownMerchantMountId {
  return Boolean(mountId && mountId !== 'xongkoro' && (PLAYER_MOUNT_IDS as readonly string[]).includes(mountId))
}

/** Merchant stock is personal native equipment, never Career inventory. */
export function townMerchantLoadout(mountId: TownMerchantMountId | null = null): UnitLoadout {
  return { meleeWeaponId: 'sword_t5', secondaryMeleeWeaponId: 'axe_t5',
    rangedWeaponId: null, shieldId: 'byzantine_eagle_shield_t5', mountId }
}

/** Only a purchased ground/companion mount (not a private eagle) may vary from the canonical native equipment. */
export function isTownMerchantLoadout(loadout: UnitLoadout): boolean {
  if (loadout.mountId != null && !isTownMerchantMountId(loadout.mountId)) return false
  const fixed = townMerchantLoadout()
  return (Object.keys(fixed) as (keyof UnitLoadout)[]).every(slot => slot === 'mountId'
    || (loadout[slot] ?? null) === (fixed[slot] ?? null))
}

/**
 * The Merchant's own weapon for the next swing: the secondary against a raised
 * shield, otherwise the primary. Null keeps the held weapon, including during a
 * committed swing.
 */
export function chooseMerchantMelee(loadout: Pick<UnitLoadout, 'meleeWeaponId' | 'secondaryMeleeWeaponId'> | undefined,
  targetShieldActive: boolean, busy: boolean): string | null {
  if (busy) return null
  return (targetShieldActive ? loadout?.secondaryMeleeWeaponId : loadout?.meleeWeaponId) ?? null
}
