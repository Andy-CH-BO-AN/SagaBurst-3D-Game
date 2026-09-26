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
      { tier: 1 as const, axe: 'viking_axe_t1', shield: 'round_shield_t1' },
      { tier: 2 as const, axe: 'viking_axe_t2', shield: 'round_shield_t2' },
      { tier: 3 as const, axe: 'viking_axe_t3', shield: 'round_shield_t3' },
    ]

    for (const { tier, axe, shield } of expected) {
      const loadout = resolveUnitLoadout('viking_berserker', tier)
      expect(loadout.meleeWeaponId).toBe(axe)
      expect(loadout.shieldId).toBe(shield)
    }
  })

  it('keeps the cavalry preset id and shield while equipping the matching axe', () => {
    const preset = getUnitPreset('viking_sword_cavalry')
    expect(preset.nameZh).toBe('斧騎兵')
    expect(preset.nameEn).toBe('Axe Cavalry')
    for (const tier of [1, 2, 3] as const) {
      const loadout = resolveUnitLoadout('viking_sword_cavalry', tier)
      expect(loadout.meleeWeaponId).toBe(`viking_axe_t${tier}`)
      expect(loadout.shieldId).toBe(`round_shield_t${tier}`)
      expect(loadout.mountId).toBe('horse')
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
