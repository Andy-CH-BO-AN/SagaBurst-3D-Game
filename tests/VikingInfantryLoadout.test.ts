import { describe, expect, it } from 'vitest'
import { getUnitPreset, resolveUnitLoadout } from '../src/battle/UnitPresetCatalog'

describe('Viking infantry loadouts', () => {
  it('keeps the legacy berserker preset id while presenting a shielded Viking Veteran', () => {
    const preset = getUnitPreset('viking_berserker')

    expect(preset.nameZh).toBe('維京資深戰士')
    expect(preset.nameEn).toBe('Viking Veteran')
    expect(preset.traits).toContain('shield_defense')
    expect(preset.traits).not.toContain('berserker')

    const expected = [
      { tier: 1 as const, sword: 'rusty_dagger', shield: 'round_shield_t1' },
      { tier: 2 as const, sword: 'steel_sword', shield: 'round_shield_t2' },
      { tier: 3 as const, sword: 'runic_greatsword', shield: 'round_shield_t3' },
    ]

    for (const { tier, sword, shield } of expected) {
      const loadout = resolveUnitLoadout('viking_berserker', tier)
      expect(loadout.meleeWeaponId).toBe(sword)
      expect(loadout.shieldId).toBe(shield)
    }
  })

  it('gives Viking spearmen a same-tier sword sidearm while keeping the lance primary', () => {
    const expected = [
      { tier: 1 as const, lance: 'hunting_spear', sword: 'rusty_dagger' },
      { tier: 2 as const, lance: 'steel_lance', sword: 'steel_sword' },
      { tier: 3 as const, lance: 'heavy_lance', sword: 'runic_greatsword' },
    ]

    for (const { tier, lance, sword } of expected) {
      const loadout = resolveUnitLoadout('viking_spearman', tier)
      expect(loadout.meleeWeaponId).toBe(lance)
      expect(loadout.secondaryMeleeWeaponId).toBe(sword)
      expect(loadout.shieldId).toBeNull()
    }
  })
})
