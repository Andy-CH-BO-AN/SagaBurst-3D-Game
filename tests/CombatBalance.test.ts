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
import { UNIT_PRESETS } from '../src/battle/UnitPresetCatalog'
import { ARMORS } from '../src/rpg/ArmorDatabase'
import { damageNpc } from '../src/combat/DamageRouter'
import * as THREE from 'three'
import { NPC, Faction, AIState, AIType } from '../src/world/NPC'
import { Player } from '../src/player/Player'
import { WEAPONS } from '../src/rpg/WeaponDatabase'
import { getUnitCombatProfile } from '../src/battle/BattleConfig'

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
      // 8 + 10 * 1.5 * 1.5 = 8 + 22.5 = 30.5 -> 31
      expect(calculateMountImpactDamage(10, true)).toBe(31)
    })
  })

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

  describe('H. Shield Damage Reduction for Rider and Horse', () => {
    it('defines authoritative shield tier reductions: 10% (T1), 15% (T2), 20% (T3)', () => {
      expect(ARMORS.round_shield_t1.damageReduction).toBe(0.10)
      expect(ARMORS.round_shield_t2.damageReduction).toBe(0.15)
      expect(ARMORS.round_shield_t3.damageReduction).toBe(0.20)

      expect(ARMORS.scutum_t1.damageReduction).toBe(0.10)
      expect(ARMORS.scutum_t2.damageReduction).toBe(0.15)
      expect(ARMORS.scutum_t3.damageReduction).toBe(0.20)
    })

    it('DamageRouter applies shield reduction to Horse while mounted, and to Rider after dismount', () => {
      let mountDamageTaken = 0
      let npcDamageTaken = 0

      const mockMount: any = {
        dead: false,
        currentHp: 200,
        maxHp: 200,
        mountDisplayName: '戰馬',
        takeDamage: (amt: number) => {
          mountDamageTaken = amt
          return true
        },
      }

      const mockNpc: any = {
        name: 'TestNpc',
        shieldId: 'round_shield_t2', // 15% reduction
        isMounted: true,
        mount: mockMount,
        hpRatio: 1.0,
        dismountFromMount: () => { mockNpc.isMounted = false },
        takeDamage: (amt: number) => {
          npcDamageTaken = amt
          return true
        },
      }

      // 1. Mounted with T2 shield: 100 incoming damage -> mount takes 85
      damageNpc(mockNpc, 100)
      expect(mountDamageTaken).toBe(85)
      expect(npcDamageTaken).toBe(0)

      // 2. Unmounted with T2 shield: 100 incoming damage -> NPC takes 85
      mockNpc.isMounted = false
      mockNpc.mount = null
      damageNpc(mockNpc, 100)
      expect(npcDamageTaken).toBe(85)

      // 3. No shield: 100 incoming damage -> NPC takes full 100
      mockNpc.shieldId = null
      damageNpc(mockNpc, 100)
      expect(npcDamageTaken).toBe(100)
    })
  })

  describe('I. Bow Cadence & Impact Cooldown SSOT', () => {
    it('verifies bow attack rate produces ~1.154s cadence and javelin ~2.143s', () => {
      const bowCooldown = getRangedCooldown('bow')
      expect(bowCooldown).toBeCloseTo(1.5 / 1.3, 3)

      const javelinCooldown = getRangedCooldown('javelin')
      expect(javelinCooldown).toBeCloseTo(1.5 / 0.7, 3)
    })

    it('mountImpact sameTargetCooldown is authoritative 0.6s', () => {
      expect(COMBAT_BALANCE.mountImpact.sameTargetCooldown).toBe(0.6)
    })

    it('getRangedCooldown defaults to rules.baseCooldown without duplicate literal 1.5', () => {
      expect(getRangedCooldown(null)).toBe(COMBAT_BALANCE.bow.baseCooldown)
      expect(getRangedCooldown(undefined)).toBe(COMBAT_BALANCE.bow.baseCooldown)
      expect(getRangedCooldown(null, 2.5)).toBe(2.5)
      expect(getRangedCooldown('bow', 2.6)).toBeCloseTo(2.6 / COMBAT_BALANCE.bow.attackRateMultiplier)
    })
  })

  describe('J. Runtime Instances & Active Combat State', () => {
    it('initializes NPC with T2 Bow loadout to rangedDamage === 21', () => {
      const scene = new THREE.Scene()
      const bowNpc = new NPC(
        scene, 0, 0, Faction.ENEMY, 'roman', AIType.RANGED, 'TestArcher', 2, false,
        { meleeWeaponId: 'gladius_rusty', rangedWeaponId: 'recurve_longbow', shieldId: null, mountId: null }
      )
      // recurve_longbow damageMax 42 * bow damageMultiplier 0.5 = 21
      expect(bowNpc.rangedDamage).toBe(21)
    })

    it('initializes NPC with T2 Javelin loadout to rangedDamage === 63', () => {
      const scene = new THREE.Scene()
      const javNpc = new NPC(
        scene, 0, 0, Faction.ENEMY, 'roman', AIType.RANGED, 'TestJavelin', 2, false,
        { meleeWeaponId: 'gladius_rusty', rangedWeaponId: 'pilum_standard', shieldId: null, mountId: null }
      )
      // pilum_standard damageMax 42 * javelin damageMultiplier 1.5 = 63
      expect(javNpc.rangedDamage).toBe(63)
    })

    it('verifies Viking Archer does NOT receive Berserker buff while holding Bow, but activates upon switching to melee', () => {
      const scene = new THREE.Scene()
      const archer = new NPC(
        scene, 0, 0, Faction.PLAYER, 'viking', AIType.RANGED, 'VikingArcher', 1, false,
        { meleeWeaponId: 'rusty_dagger', rangedWeaponId: 'wooden_shortbow', shieldId: null, mountId: null }
      )

      // 1. While holding bow with arrows > 0: active combat state is 'bow'
      expect(archer.hasActiveRangedWeapon).toBe(true)
      expect(archer.activeCombatKind).toBe('bow')

      const rangedBerserker = getBerserkerModifiers(archer.characterFaction, archer.isMounted, archer.activeCombatKind, Boolean(archer.shieldId))
      expect(rangedBerserker.active).toBe(false)
      expect(rangedBerserker.moveSpeedMultiplier).toBe(1.0)
      expect(rangedBerserker.meleeDamageMultiplier).toBe(1.0)
      expect(rangedBerserker.meleeAttackRateMultiplier).toBe(1.0)

      // Test movement speed while bow is active
      archer.visualMovementSpeed = 0
      ;(archer as any)._moveByDirection(new THREE.Vector3(0, 0, 1), 5.0, 0.1)
      const speedRanged = archer.visualMovementSpeed
      expect(speedRanged).toBeCloseTo(5.0)

      // 2. Target gets within 6m or arrows run out -> switches to melee
      ;(archer as any)._switchToMelee()
      expect(archer.hasActiveRangedWeapon).toBe(false)
      expect(archer.activeCombatKind).toBe('sword')

      const meleeBerserker = getBerserkerModifiers(archer.characterFaction, archer.isMounted, archer.activeCombatKind, Boolean(archer.shieldId))
      expect(meleeBerserker.active).toBe(true)
      expect(meleeBerserker.moveSpeedMultiplier).toBe(1.3)
      expect(meleeBerserker.meleeDamageMultiplier).toBe(1.2)
      expect(meleeBerserker.meleeAttackRateMultiplier).toBe(1.2)

      // Test movement speed after switching to melee
      archer.visualMovementSpeed = 0
      ;(archer as any)._moveByDirection(new THREE.Vector3(0, 0, 1), 5.0, 0.1)
      const speedMelee = archer.visualMovementSpeed
      expect(speedMelee).toBeCloseTo(5.0 * 1.3)
    })

    it('verifies Player Bow release cadence: sets bowCooldown, blocks immediate second release, and decays via update(dt)', () => {
      const scene = new THREE.Scene()
      const player = new Player(scene, 'viking')
      player.arrows = 10
      const testBow = WEAPONS.wooden_shortbow

      expect(player.bowCooldown).toBe(0)

      // Simulate bow charging and firing
      ;(player as any).bowChargeTime = 0.8
      ;(player as any)._startBowRelease(new THREE.Vector3(0, 0, 10), 1.0, testBow)

      const expectedCooldown = getRangedCooldown('bow')
      expect(player.bowCooldown).toBeCloseTo(expectedCooldown)

      // Attempt second release immediately while cooldown active: blocked
      ;(player as any).bowChargeTime = 0.8
      ;(player as any).animator.cancel() // make sure animator isn't busy
      ;(player as any)._startBowRelease(new THREE.Vector3(0, 0, 10), 1.0, testBow)

      // Cooldown must not be retriggered or changed
      expect(player.bowCooldown).toBeCloseTo(expectedCooldown)

      // Advance dt via update(dt)
      const mockInput = {
        isRightMouseDown: false,
        consumeLeftClick: () => false,
        consumeDismount: () => false,
        consumeMountSprint: () => false,
        consumeWhistle: () => false,
        moveVector: new THREE.Vector3(),
        keys: {},
      } as any
      const mockStaminaBar = { setFill: () => {} } as any
      const mockQuiverUI = { setAiming: () => {}, setChargeRatio: () => {}, setShieldBlocked: () => {} } as any
      const mockSoundManager = { playBowRelease: () => {}, playSwing: () => {} } as any

      const dt = 0.25
      player.update(dt, mockInput, 0, new THREE.Vector3(0, 0, 10), [], mockStaminaBar, mockQuiverUI, mockSoundManager)

      expect(player.bowCooldown).toBeCloseTo(expectedCooldown - dt)
    })
  })
})
