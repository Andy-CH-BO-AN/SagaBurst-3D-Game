import { describe, it, expect } from 'vitest'
import { COMBAT_BALANCE, getRangedCooldown, getBerserkerModifiers } from '../../src/combat/CombatBalance'
import * as THREE from 'three'
import { NPC, Faction, AIType } from '../../src/world/NPC'
import { Player } from '../../src/player/Player'
import { WEAPONS } from '../../src/rpg/WeaponDatabase'

describe('Combat actor balance wiring', () => {
  describe('J. Runtime Instances & Active Combat State', () => {
    it('initializes NPC with T2 Bow loadout using the authoritative bow multiplier', () => {
      const scene = new THREE.Scene()
      const bowNpc = new NPC(
        scene, 0, 0, Faction.ENEMY, 'roman', AIType.RANGED, 'TestArcher', 2, false,
        { meleeWeaponId: 'gladius_rusty', rangedWeaponId: 'recurve_longbow', shieldId: null, mountId: null }
      )
      const expectedDamage = WEAPONS.recurve_longbow.damageMax * COMBAT_BALANCE.bow.damageMultiplier
      expect(bowNpc.rangedDamage).toBeCloseTo(expectedDamage)
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
