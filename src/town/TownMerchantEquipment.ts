import type { UnitLoadout } from '../battle/UnitPresetCatalog'

/** Merchant stock is personal native equipment, never Career inventory. */
export function townMerchantLoadout(): UnitLoadout {
  return { meleeWeaponId: 'paladin_sword_t4', secondaryMeleeWeaponId: 'paladin_mace_t4',
    rangedWeaponId: null, shieldId: 'paladin_shield_t4', mountId: null }
}
