import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { InventoryManager } from '../src/rpg/InventoryManager'
import { Player } from '../src/player/Player'
import { NPC, Faction, AIType } from '../src/world/NPC'
import { ThirdPersonCamera } from '../src/camera/ThirdPersonCamera'
import { COMBAT_ANIMATION_PROFILES } from '../src/world/CharacterCombatAnimator'
import { WEAPONS } from '../src/rpg/WeaponDatabase'
import { WeaponMeshFactory } from '../src/world/WeaponMeshFactory'

const input = (values = {}) => ({
  keys: {},
  isLeftMouseDown: false,
  isRightMouseDown: false,
  consumeLeftClick: () => false,
  consumeLeftClickRelease: () => false,
  consumeMouseDelta: () => ({ dx: 0, dy: 0 }),
  ...values,
})

function createPlayerHarness() {
  const scene = new THREE.Scene()
  const player = new Player(scene)
  const inventory = new InventoryManager()
  const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 500)
  const tpCamera = new ThirdPersonCamera(camera, player)
  const ui = { setAiming: vi.fn(), setChargeRatio: vi.fn(), setShieldBlocked: vi.fn() }
  const sounds = { playSwing: vi.fn(), playHit: vi.fn(), playBowRelease: vi.fn() }

  const update = (controls: any, dt = 1 / 60) => {
    player.update(
      dt,
      controls,
      0,
      new THREE.Vector3(0, 1.4, 10),
      [],
      { setFill() {} } as any,
      ui as any,
      sounds as any,
      inventory,
    )
    tpCamera.update(controls, dt)
  }

  return { scene, player, inventory, camera, tpCamera, ui, sounds, update }
}

describe('Targeted Verification: Bow / Shield & Camera Zoom', () => {
  it('Melee + Shield -> RMB -> shield stowed, bow active, isAiming = true, loadout shield intact', () => {
    const h = createPlayerHarness()
    h.update(input())

    // 1. Initial melee stance
    expect(h.player.currentCombatStance).toBe('melee')
    expect(h.player.isShieldActive).toBe(true)
    expect(h.inventory.equippedShield?.id).toBe('round_shield_t3')
    expect(h.camera.fov).toBeCloseTo(58, 0)

    // 2. RMB pressed with equipped bow -> switches to ranged stance, shield stowed, isAiming true
    h.update(input({ isRightMouseDown: true }))
    expect(h.player.currentCombatStance).toBe('ranged')
    expect(h.player.isAiming).toBe(true)
    expect(h.player.isShieldActive).toBe(false)
    expect(h.inventory.equippedShield?.id).toBe('round_shield_t3') // Loadout shield remains intact!

    // Camera zooms smoothly toward 40°
    for (let i = 0; i < 30; i++) {
      h.update(input({ isRightMouseDown: true }), 1 / 60)
    }
    expect(h.camera.fov).toBeLessThan(42)
    expect(h.camera.fov).toBeGreaterThanOrEqual(40)

    // 3. RMB release -> isAiming = false, stays in ranged stance with bow in hand, shield remains stowed
    h.update(input({ isRightMouseDown: false }))
    expect(h.player.isAiming).toBe(false)
    expect(h.player.currentCombatStance).toBe('ranged')
    expect(h.player.isShieldActive).toBe(false)
    expect(h.inventory.equippedShield?.id).toBe('round_shield_t3')

    // Camera zooms smoothly back toward 58°
    for (let i = 0; i < 30; i++) {
      h.update(input({ isRightMouseDown: false }), 1 / 60)
    }
    expect(h.camera.fov).toBeGreaterThan(56)

    // 4. Switch back to melee (e.g. Digit1 or setCombatStance) -> shield restored
    h.player.setCombatStance('melee')
    h.update(input())
    expect(h.player.currentCombatStance).toBe('melee')
    expect(h.player.isShieldActive).toBe(true)
  })

  it('持盾時按 RMB 進入 Aim，釋放 LMB 正常射出箭矢', () => {
    const h = createPlayerHarness()
    h.update(input())
    expect(h.inventory.equippedShield?.id).toBe('round_shield_t3')

    // Enter aim and charge with LMB
    h.update(input({ isRightMouseDown: true }))
    expect(h.player.isAiming).toBe(true)
    for (let i = 0; i < 15; i++) {
      h.update(input({ isRightMouseDown: true, isLeftMouseDown: true }), 1 / 60)
    }

    // Release LMB -> triggers _startBowRelease
    const initialArrows = h.player.arrowCount
    h.update(input({ isRightMouseDown: true, isLeftMouseDown: false, consumeLeftClickRelease: () => true }), 1 / 60)
    expect(h.player.combatAnimationAction).toBe('bowRelease')

    // Advance through projectileRelease frame
    h.update(input({ isRightMouseDown: true }), 0.1)
    expect(h.player.arrowCount).toBe(initialArrows - 1)
    expect(h.sounds.playBowRelease).toHaveBeenCalled()
  })

  it('僅按住 RMB 瞄準即有慢慢拉弓的動畫（bowDrawRatio 隨幀平滑遞增），釋放 RMB 射出箭矢', () => {
    const h = createPlayerHarness()
    h.update(input())
    expect(h.inventory.equippedShield?.id).toBe('round_shield_t3')

    // Hold RMB only (no LMB)
    h.update(input({ isRightMouseDown: true }), 1 / 60)
    expect(h.player.isAiming).toBe(true)
    expect(h.player.isShieldActive).toBe(false)
    const ratio1 = h.player.bowDrawRatio
    expect(ratio1).toBeGreaterThan(0)

    // Advance 10 frames with RMB only
    for (let i = 0; i < 10; i++) {
      h.update(input({ isRightMouseDown: true }), 1 / 60)
    }
    const ratio2 = h.player.bowDrawRatio
    expect(ratio2).toBeGreaterThan(ratio1)

    // Advance 20 more frames
    for (let i = 0; i < 20; i++) {
      h.update(input({ isRightMouseDown: true }), 1 / 60)
    }
    const ratio3 = h.player.bowDrawRatio
    expect(ratio3).toBeGreaterThan(ratio2)

    // Release RMB -> shoots
    const initialArrows = h.player.arrowCount
    h.update(input({ isRightMouseDown: false }), 1 / 60)
    expect(h.player.combatAnimationAction).toBe('bowRelease')

    // Advance past projectileRelease
    h.update(input(), 0.1)
    expect(h.player.arrowCount).toBe(initialArrows - 1)
    expect(h.sounds.playBowRelease).toHaveBeenCalled()
  })

  it('使用完弓箭後，按左鍵自動切回近戰姿態、恢復盾牌並揮擊近戰武器', () => {
    const h = createPlayerHarness()
    h.update(input())
    expect(h.inventory.equippedShield?.id).toBe('round_shield_t3')
    expect(h.player.isShieldActive).toBe(true)

    // 1. 按住 RMB 瞄準拉弓
    h.update(input({ isRightMouseDown: true }), 1 / 60)
    expect(h.player.isAiming).toBe(true)
    expect(h.player.isShieldActive).toBe(false)
    expect(h.player.currentCombatStance).toBe('ranged')

    for (let i = 0; i < 20; i++) {
      h.update(input({ isRightMouseDown: true }), 1 / 60)
    }
    expect(h.player.bowDrawRatio).toBeGreaterThan(0.1)

    // 2. 釋放 RMB 射箭
    h.update(input({ isRightMouseDown: false }), 1 / 60)
    expect(h.player.combatAnimationAction).toBe('bowRelease')

    // 完成放箭動作 (0.25s)
    for (let i = 0; i < 20; i++) {
      h.update(input(), 1 / 60)
    }
    expect(h.player.combatAnimationAction).toBe('idle')
    expect(h.player.currentCombatStance).toBe('ranged')
    expect(h.player.isShieldActive).toBe(false)

    // 3. 使用完弓箭後，按左鍵攻擊
    h.update(input({ consumeLeftClick: () => true }), 1 / 60)

    // 應自動切換回近戰姿態、恢復盾牌、並揮擊近戰武器
    expect(h.player.currentCombatStance).toBe('melee')
    expect(h.player.isShieldActive).toBe(true)
    expect(h.player.swinging).toBe(true)
    expect(h.player.combatAnimationAction).toBe('lanceThrust')
    expect(h.sounds.playSwing).toHaveBeenCalled()
  })
})

describe('Targeted Verification: Lance Reach, Attack Speed & Hit Mechanics', () => {
  it('Lance mesh length in WeaponMeshFactory remains 2.6m (mesh length unchanged)', () => {
    const parent = new THREE.Group()
    const { tipLocal } = WeaponMeshFactory.buildMelee('steel_lance', parent)
    expect(tipLocal.y).toBeCloseTo(2.6, 2)
  })

  it('Attack cadence is +20% faster (mounted 0.35s, unmounted 0.584s)', () => {
    const mounted = COMBAT_ANIMATION_PROFILES['mountedLance']
    const mountedTotal = mounted.windup + mounted.active + mounted.recovery
    expect(mountedTotal).toBeCloseTo(0.35, 2)

    const unmounted = COMBAT_ANIMATION_PROFILES['lanceThrust']
    const unmountedTotal = unmounted.windup + unmounted.active + unmounted.recovery
    expect(unmountedTotal).toBeCloseTo(0.584, 3)

    // UI text display only
    expect(WEAPONS['steel_lance'].speedOrCharge).toBe(0.42)
    expect(WEAPONS['steel_lance'].range).toBe(3.9)
  })

  it('Swords retain unchanged range and animation profile (no regression)', () => {
    const sword = COMBAT_ANIMATION_PROFILES['swordSlash']
    expect(sword.windup + sword.active + sword.recovery).toBeCloseTo(0.48, 2)
    expect(WEAPONS['steel_sword'].range).toBe(1.8)
  })

  it('NPC Lance: forward reach within 3.9m corridor hits, behind does not hit', () => {
    const scene = new THREE.Scene()
    const npc = new NPC(scene, 0, 0, Faction.ENEMY, AIType.MELEE, 'LanceFighter', 2, false)
    npc.isUsingLance = true
    npc.meleeAttackRadius = 3.9

    // NPC facing yaw = 0 means forward is (0, 0, 1) (+Z)
    // Target 2.5m in front of NPC (forwardDist = 2.5, lateralDist = 0.2)
    const inFrontTarget = new THREE.Vector3(0.2, 0, 2.5)
    expect((npc as any)._isTargetInMeleeRange(inFrontTarget)).toBe(true)

    // Target behind NPC (forwardDist = -1.5)
    const behindTarget = new THREE.Vector3(0, 0, -1.5)
    expect((npc as any)._isTargetInMeleeRange(behindTarget)).toBe(false)

    // Target far to the side (forwardDist = 1.0, lateralDist = 2.5 > 1.4)
    const sideTarget = new THREE.Vector3(2.5, 0, 1.0)
    expect((npc as any)._isTargetInMeleeRange(sideTarget)).toBe(false)
  })
})
