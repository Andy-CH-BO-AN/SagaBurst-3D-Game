import { addCareerItem } from './CareerInventory'
import type { CareerProfile } from './CareerProfile'
import type { UnitLoadout } from '../battle/UnitPresetCatalog'
import type { CharacterFaction } from '../world/CharacterVisuals'

/** Only formal Career commanders opt in; HR recruits and player loadouts retain their own equipment. */
export function careerCommanderLoadout(faction: CharacterFaction): UnitLoadout {
  return {
    rangedWeaponId: 'bow_t5',
    meleeWeaponId: faction === 'roman' ? 'sword_t5' : 'axe_t5',
    shieldId: null, mountId: null, reversibleRangedSwitch: true,
  }
}

/** Mutates a staged profile only; the grant and receipt must be saved in one transaction.
 * Legacy saves have no reliable history of player choices, so retain every explicit melee slot.
 */
export function grantCommanderMelee(profile: CareerProfile): boolean {
  if (profile.rank !== 'commander' || profile.commanderMeleeGranted === true) return false
  const autoEquip = !profile.equipment?.melee || (profile.meleeSelectionOrigin === 'starter'
    && profile.equipment.melee === profile.starterWeaponId)
  const id = profile.faction === 'roman' ? 'sword_t5' : 'axe_t5'
  addCareerItem(profile, id, 1)
  if (autoEquip) profile.equipment = { ...profile.equipment, melee: id }
  profile.commanderMeleeGranted = true
  return true
}
