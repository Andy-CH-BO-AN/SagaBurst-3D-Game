import { describe, it, expect } from 'vitest'
import {
  COMBAT_BALANCE,
  getRangedCombatKind,
  getRangedCombatRules,
  getNpcRangedAttackRange,
  getRangedDamageMultiplier,
  getRangedCooldown,
  getAntiCavalryMultiplier,
  getBerserkerModifiers,
  calculateLanceChargeDamage,
  calculateMountImpactDamage,
} from '../src/combat/CombatBalance'

describe('CombatBalance SSOT & Pure Functions', () => {
  describe('A. Balance Constants', () => {
    it('defines authoritative HP defaults', () => {
      expect(COMBAT_BALANCE.hp.npcDefault).toBe(200)
      expect(COMBAT_BALANCE.hp.playerDefault).toBe(200)
    })

    it('defines Bow and Javelin balance rules', () => {
      expect(COMBAT_BALANCE.bow.damageMultiplier).toBe(0.5)
      expect(COMBAT_BALANCE.bow.attackRateMultiplier).toBe(1.3)
      expect(COMBAT_BALANCE.bow.footAttackRange).toBe(50)
      expect(COMBAT_BALANCE.bow.mountedAttackRange).toBe(15)

      expect(COMBAT_BALANCE.javelin.damageMultiplier).toBe(1.5)
      expect(COMBAT_BALANCE.javelin.attackRateMultiplier).toBe(0.7)
      expect(COMBAT_BALANCE.javelin.footAttackRange).toBe(30)
      expect(COMBAT_BALANCE.javelin.mountedAttackRange).toBe(15)
    })

    it('defines Lance and Berserker balance rules', () => {
      expect(COMBAT_BALANCE.lance.unmountedVsMountedDamageMultiplier).toBe(2.0)
      expect(COMBAT_BALANCE.lance.mountedChargeSpeedThreshold).toBe(10)
      expect(COMBAT_BALANCE.lance.mountedChargeDamageMultiplier).toBe(3.0)

      expect(COMBAT_BALANCE.berserker.moveSpeedMultiplier).toBe(1.3)
      expect(COMBAT_BALANCE.berserker.meleeDamageMultiplier).toBe(1.2)
      expect(COMBAT_BALANCE.berserker.meleeAttackRateMultiplier).toBe(1.2)
    })

    it('defines Mount Impact balance rules', () => {
      expect(COMBAT_BALANCE.mountImpact.minSpeed).toBe(4)
      expect(COMBAT_BALANCE.mountImpact.baseDamage).toBe(8)
      expect(COMBAT_BALANCE.mountImpact.speedDamageMultiplier).toBe(1.5)
      expect(COMBAT_BALANCE.mountImpact.sprintDamageMultiplier).toBe(1.5)
      expect(COMBAT_BALANCE.mountImpact.sameTargetCooldown).toBe(0.6)
    })
  })

  describe('B. Ranged Helpers', () => {
    it('getRangedCombatKind correctly identifies bow and javelin', () => {
      expect(getRangedCombatKind('bow')).toBe('bow')
      expect(getRangedCombatKind('javelin')).toBe('javelin')
      expect(getRangedCombatKind('recurve_longbow')).toBe('bow')
      expect(getRangedCombatKind('pilum_standard')).toBe('javelin')
      expect(getRangedCombatKind({ combatKind: 'bow' })).toBe('bow')
      expect(getRangedCombatKind({ combatKind: 'javelin' })).toBe('javelin')
      expect(getRangedCombatKind({ combatKind: 'sword' })).toBeNull()
      expect(getRangedCombatKind(null)).toBeNull()
      expect(getRangedCombatKind(undefined)).toBeNull()
    })

    it('getNpcRangedAttackRange returns correct foot and mounted ranges', () => {
      expect(getNpcRangedAttackRange('bow', false)).toBe(50)
      expect(getNpcRangedAttackRange('bow', true)).toBe(15)
      expect(getNpcRangedAttackRange('javelin', false)).toBe(30)
      expect(getNpcRangedAttackRange('javelin', true)).toBe(15)
    })

    it('getRangedDamageMultiplier returns 0.5 for bow and 1.5 for javelin', () => {
      expect(getRangedDamageMultiplier('bow')).toBe(0.5)
      expect(getRangedDamageMultiplier('javelin')).toBe(1.5)
    })

    it('getRangedCooldown scales with attackRateMultiplier', () => {
      const bowCooldown = getRangedCooldown('bow')
      expect(bowCooldown).toBeCloseTo(1.5 / 1.3, 4)

      const javelinCooldown = getRangedCooldown('javelin')
      expect(javelinCooldown).toBeCloseTo(1.5 / 0.7, 4)
    })
  })

  describe('C. Anti-Cavalry Rule', () => {
    it('grants 2.0x multiplier only when attacker is unmounted lance vs mounted target', () => {
      // Unmounted lance vs mounted target -> 2.0x
      expect(getAntiCavalryMultiplier('lance', false, true)).toBe(2.0)

      // Mounted lance vs mounted target -> 1.0x
      expect(getAntiCavalryMultiplier('lance', true, true)).toBe(1.0)

      // Unmounted lance vs unmounted target -> 1.0x
      expect(getAntiCavalryMultiplier('lance', false, false)).toBe(1.0)

      // Unmounted sword vs mounted target -> 1.0x
      expect(getAntiCavalryMultiplier('sword', false, true)).toBe(1.0)
    })
  })

  describe('D. Berserker Modifiers', () => {
    it('activates buff only for Viking + unmounted + sword + no shield', () => {
      const active = getBerserkerModifiers('viking', false, 'sword', false)
      expect(active.active).toBe(true)
      expect(active.moveSpeedMultiplier).toBe(1.3)
      expect(active.meleeDamageMultiplier).toBe(1.2)
      expect(active.meleeAttackRateMultiplier).toBe(1.2)

      // Viking mounted -> inactive
      expect(getBerserkerModifiers('viking', true, 'sword', false).active).toBe(false)

      // Viking with shield -> inactive
      expect(getBerserkerModifiers('viking', false, 'sword', true).active).toBe(false)

      // Viking with lance -> inactive
      expect(getBerserkerModifiers('viking', false, 'lance', false).active).toBe(false)

      // Roman -> inactive
      expect(getBerserkerModifiers('roman', false, 'sword', false).active).toBe(false)
    })
  })

  describe('E. Lance Charge Damage', () => {
    it('applies 3.0x damage and sets skipImpact when mounted lance moves > 10m/s', () => {
      const result = calculateLanceChargeDamage(45, 'lance', true, 12)
      expect(result.isCharge).toBe(true)
      expect(result.skipImpact).toBe(true)
      expect(result.damage).toBe(135) // 45 * 3
    })

    it('does not charge when mounted lance moves <= 10m/s', () => {
      const result = calculateLanceChargeDamage(45, 'lance', true, 9.5)
      expect(result.isCharge).toBe(false)
      expect(result.skipImpact).toBe(false)
      expect(result.damage).toBe(45)
    })

    it('does not charge when unmounted even if speed > 10', () => {
      const result = calculateLanceChargeDamage(45, 'lance', false, 12)
      expect(result.isCharge).toBe(false)
      expect(result.skipImpact).toBe(false)
      expect(result.damage).toBe(45)
    })

    it('does not charge when using non-lance weapon even if mounted and fast', () => {
      const result = calculateLanceChargeDamage(45, 'sword', true, 12)
      expect(result.isCharge).toBe(false)
      expect(result.skipImpact).toBe(false)
      expect(result.damage).toBe(45)
    })

    it('supports alternative argument order (combatKind, isMounted, speed, baseDamage)', () => {
      const result = calculateLanceChargeDamage('lance', true, 12, 60)
      expect(result.isCharge).toBe(true)
      expect(result.skipImpact).toBe(true)
      expect(result.damage).toBe(180) // 60 * 3
    })
  })

  describe('F. Mount Impact Damage', () => {
    it('returns 0 when speed <= minSpeed (4m/s)', () => {
      expect(calculateMountImpactDamage(0, false)).toBe(0)
      expect(calculateMountImpactDamage(4, false)).toBe(0)
      expect(calculateMountImpactDamage(3.9, true)).toBe(0)
    })

    it('calculates damage when speed > 4m/s without sprint', () => {
      // 8 + 6 * 1.5 = 17
      expect(calculateMountImpactDamage(6, false)).toBe(17)
      // 8 + 10 * 1.5 = 23
      expect(calculateMountImpactDamage(10, false)).toBe(23)
    })

    it('applies 1.5x sprint multiplier when sprinting', () => {
      // (8 + 10 * 1.5) * 1.5 = 23 * 1.5 = 34.5 -> 35
      expect(calculateMountImpactDamage(10, true)).toBe(35)
    })
  })
})
