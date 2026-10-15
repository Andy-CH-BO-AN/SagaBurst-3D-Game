import type { UnitLoadout } from '../battle/UnitPresetCatalog'
import type { CharacterFaction } from '../world/CharacterVisuals'

/** Only formal Career commanders opt in; HR recruits and player loadouts retain their own equipment. */
export function careerCommanderLoadout(faction: CharacterFaction): UnitLoadout {
  return {
    rangedWeaponId: 'bow_t5',
    meleeWeaponId: faction === 'roman' ? 'paladin_sword_t4' : 'paladin_mace_t4',
    shieldId: null, mountId: null, reversibleRangedSwitch: true,
  }
}
