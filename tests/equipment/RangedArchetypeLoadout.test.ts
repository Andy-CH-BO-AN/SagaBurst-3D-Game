import { describe, it, expect } from 'vitest'
import { UNIT_PRESETS } from '../../src/battle/UnitPresetCatalog'

describe('Ranged archetype loadout policy', () => {
  describe('G. Ranged Archetype Melee Fallback Fixed to T1', () => {
    it('fixes Viking Archer and Mounted Archer melee weapons to T1 across all tiers', () => {
      const archer = UNIT_PRESETS.viking_archer
      expect(archer.tierLoadouts[1].meleeWeaponId).toBe('rusty_dagger')
      expect(archer.tierLoadouts[2].meleeWeaponId).toBe('rusty_dagger')
      expect(archer.tierLoadouts[3].meleeWeaponId).toBe('rusty_dagger')
      expect(archer.tierLoadouts[1].rangedWeaponId).toBe('wooden_shortbow')
      expect(archer.tierLoadouts[2].rangedWeaponId).toBe('recurve_longbow')
      expect(archer.tierLoadouts[3].rangedWeaponId).toBe('elven_runebow')

      const horseArcher = UNIT_PRESETS.viking_horse_archer
      expect(horseArcher.tierLoadouts[1].meleeWeaponId).toBe('rusty_dagger')
      expect(horseArcher.tierLoadouts[2].meleeWeaponId).toBe('rusty_dagger')
      expect(horseArcher.tierLoadouts[3].meleeWeaponId).toBe('rusty_dagger')
      expect(horseArcher.tierLoadouts[1].rangedWeaponId).toBe('wooden_shortbow')
      expect(horseArcher.tierLoadouts[2].rangedWeaponId).toBe('recurve_longbow')
      expect(horseArcher.tierLoadouts[3].rangedWeaponId).toBe('elven_runebow')
    })

    it('fixes Roman Archer, Javelin Infantry, and Mounted Archer melee weapons to T1 across all tiers', () => {
      const archer = UNIT_PRESETS.roman_archer
      expect(archer.tierLoadouts[1].meleeWeaponId).toBe('gladius_rusty')
      expect(archer.tierLoadouts[2].meleeWeaponId).toBe('gladius_rusty')
      expect(archer.tierLoadouts[3].meleeWeaponId).toBe('gladius_rusty')
      expect(archer.tierLoadouts[1].rangedWeaponId).toBe('wooden_shortbow')
      expect(archer.tierLoadouts[2].rangedWeaponId).toBe('recurve_longbow')
      expect(archer.tierLoadouts[3].rangedWeaponId).toBe('elven_runebow')

      const jav = UNIT_PRESETS.roman_javelin_infantry
      expect(jav.tierLoadouts[1].meleeWeaponId).toBe('gladius_rusty')
      expect(jav.tierLoadouts[2].meleeWeaponId).toBe('gladius_rusty')
      expect(jav.tierLoadouts[3].meleeWeaponId).toBe('gladius_rusty')
      expect(jav.tierLoadouts[1].rangedWeaponId).toBe('pilum_basic')
      expect(jav.tierLoadouts[2].rangedWeaponId).toBe('pilum_standard')
      expect(jav.tierLoadouts[3].rangedWeaponId).toBe('legionary_pilum')

      const horseArcher = UNIT_PRESETS.roman_horse_archer
      expect(horseArcher.tierLoadouts[1].meleeWeaponId).toBe('gladius_rusty')
      expect(horseArcher.tierLoadouts[2].meleeWeaponId).toBe('gladius_rusty')
      expect(horseArcher.tierLoadouts[3].meleeWeaponId).toBe('gladius_rusty')
      expect(horseArcher.tierLoadouts[1].rangedWeaponId).toBe('wooden_shortbow')
      expect(horseArcher.tierLoadouts[2].rangedWeaponId).toBe('recurve_longbow')
      expect(horseArcher.tierLoadouts[3].rangedWeaponId).toBe('elven_runebow')
    })
  })
})
