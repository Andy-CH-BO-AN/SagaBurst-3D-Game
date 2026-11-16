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

  it('compares sword and axe swaps across T3 and T5, trading speed against shield-break with upgrade/downgrade/mixed relations', () => {
    const forward = compareEquipment(WEAPONS.axe_t5, WEAPONS.sword_t5), back = compareEquipment(WEAPONS.sword_t5, WEAPONS.axe_t5)
    expect(forward.relation).toBe('mixed'); expect(forward.lines).toContain('破盾衝擊較強'); expect(forward.lines.some(l => l.startsWith('出手時間 +'))).toBe(true)
    expect(back.relation).toBe('mixed'); expect(back.lines).toContain('破盾衝擊較弱'); expect(back.lines.some(l => l.startsWith('出手時間 -'))).toBe(true)
    expect([...forward.lines, ...back.lines].join()).not.toMatch(/Infinity|NaN/)

    const toAxe = compareEquipment(WEAPONS.viking_axe_t3, WEAPONS.runic_greatsword), toSword = compareEquipment(WEAPONS.runic_greatsword, WEAPONS.viking_axe_t3)
    expect(toAxe.lines).toContain('破盾衝擊較強'); expect(toAxe.relation).toBe('upgrade')
    expect(toSword.lines).toContain('破盾衝擊較弱'); expect(toSword.relation).toBe('downgrade')
  })

  it('treats a lance swap as mixed with a disclosed uncounted charge trait, and skips shield-break when a weapon lacks the value', () => {
    const sword = WEAPONS.sword_t5, lance = WEAPONS.heavy_lance
    expect(compareEquipment(lance, sword)).toMatchObject({ relation: 'mixed' })
    expect(compareEquipment(lance, sword).lines.at(-1)).toContain('未計入')
    expect(compareEquipment(sword, lance).lines.at(-1)).toContain('未計入')
    expect(compareEquipment(lance, sword).lines.join()).not.toContain('破盾')
  })
})
