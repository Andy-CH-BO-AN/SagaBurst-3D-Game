import type { UnitLoadout } from '../battle/UnitPresetCatalog'

/** Merchant stock is personal native equipment, never Career inventory. */
export function townMerchantLoadout(mountId: 'horse' | null = null): UnitLoadout {
  return { meleeWeaponId: 'sword_t5', secondaryMeleeWeaponId: 'axe_t5',
    rangedWeaponId: null, shieldId: 'paladin_shield_t4', mountId }
}

/** Only a purchased military horse may vary from the canonical native equipment. */
export function isTownMerchantLoadout(loadout: UnitLoadout): boolean {
  if (loadout.mountId != null && loadout.mountId !== 'horse') return false
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
