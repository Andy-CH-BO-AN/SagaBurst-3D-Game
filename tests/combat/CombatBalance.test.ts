import { describe, expect, it } from 'vitest'
import { calculateLanceChargeDamage, getAntiCavalryMultiplier, getBerserkerModifiers } from '../../src/combat/CombatBalance'

describe('Combat damage eligibility', () => {
  it.each([
    ['unmounted lance against cavalry', 'lance', false, true, 2],
    ['mounted lance against cavalry', 'lance', true, true, 1],
    ['unmounted lance against infantry', 'lance', false, false, 1],
    ['sword against cavalry', 'sword', false, true, 1],
  ] as const)('%s uses its required anti-cavalry multiplier', (_name, kind, mounted, targetMounted, expected) => {
    expect(getAntiCavalryMultiplier(kind, mounted, targetMounted)).toBe(expected)
  })

  it('grants the berserker damage and movement modifiers to unshielded foot swordsmen', () => {
    expect(getBerserkerModifiers('viking', false, 'sword', false)).toMatchObject({
      active: true, moveSpeedMultiplier: 1.3, meleeDamageMultiplier: 1.2, meleeAttackRateMultiplier: 1.2,
    })
  })

  it('disables the berserker modifiers when the swordsman equips a shield', () => {
    expect(getBerserkerModifiers('viking', false, 'sword', true)).toMatchObject({
      active: false, moveSpeedMultiplier: 1, meleeDamageMultiplier: 1, meleeAttackRateMultiplier: 1,
    })
  })

  it.each([[10, false, 45], [10.01, true, 135]] as const)(
    'mounted lance speed %s has charge=%s and damage=%s', (speed, charge, damage) => {
      expect(calculateLanceChargeDamage(45, 'lance', true, speed)).toMatchObject({
        isCharge: charge, skipImpact: charge, damage,
      })
    })
})
