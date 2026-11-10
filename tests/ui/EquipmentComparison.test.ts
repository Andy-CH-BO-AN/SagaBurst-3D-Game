import { describe, expect, it } from 'vitest'
import { ARMORS } from '../../src/rpg/ArmorDatabase'
import { compareEquipment, equipmentTraits } from '../../src/rpg/EquipmentComparison'
import { WEAPONS, type WeaponData } from '../../src/rpg/WeaponDatabase'

describe('Equipment comparison', () => {
  const melee = Object.values(WEAPONS).filter((w): w is WeaponData => w.type === 'melee').sort((a, b) => a.damageMax - b.damageMax)
  const [weak, strong] = [melee[0], melee.at(-1)!]
  it('reports direction per slot, never compares across slots, and treats an empty slot as no claim', () => {
    expect(compareEquipment(strong, weak).relation).not.toBe('none')
    expect(compareEquipment(strong, weak).lines.some(line => line.startsWith('傷害 +'))).toBe(true)
    expect(compareEquipment(weak, strong).lines.some(line => line.startsWith('傷害 -'))).toBe(true)
    expect(compareEquipment(strong, strong)).toEqual({ relation: 'same', lines: ['目前裝備中'] })
    expect(compareEquipment(strong, ARMORS.commander_shield_t5).relation).toBe('none')
    expect(compareEquipment(strong, null).relation).toBe('none')
    expect(compareEquipment(ARMORS.byzantine_eagle_shield_t5, ARMORS.roman_officer_shield_t4)).toMatchObject({ relation: 'upgrade' })
    expect(equipmentTraits(ARMORS.byzantine_eagle_shield_t5)).toEqual(['高防護'])
  })
})
