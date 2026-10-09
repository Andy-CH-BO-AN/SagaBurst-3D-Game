import { describe, expect, it, vi, onTestFinished } from 'vitest'
import * as THREE from 'three'
import { InventoryManager } from '../../src/rpg/InventoryManager'
import { Player } from '../../src/player/Player'
import { ThirdPersonCamera } from '../../src/camera/ThirdPersonCamera'
import { PILUM_THROW_RELEASE_TIME } from '../../src/world/CharacterCombatAnimator'
import { getRangedCooldown } from '../../src/combat/CombatBalance'
import { Mount, MountType } from '../../src/world/Mount'

const input = (values = {}) => ({
  keys: {},
  isLeftMouseDown: false,
  isRightMouseDown: false,
  consumeLeftClick: () => false,
  consumeLeftClickRelease: () => false,
  consumeMouseDelta: () => ({ dx: 0, dy: 0 }),
  ...values,
})

function createPlayerHarness(initialLoadout?: { meleeWeaponId: string; rangedWeaponId: string; shieldId: string | null }) {
  const scene = new THREE.Scene()
  const player = new Player(scene)
  onTestFinished(() => player.dispose())
  const inventory = new InventoryManager(initialLoadout)
  if (!initialLoadout) inventory.equipWeapon('elven_runebow')
  const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 500)
  const tpCamera = new ThirdPersonCamera(camera, player)
  const ui = { setAiming: vi.fn(), setChargeRatio: vi.fn(), setShieldBlocked: vi.fn() }
  const sounds = { playSwing: vi.fn(), playHit: vi.fn(), playBowRelease: vi.fn() }

  const update = (controls: Parameters<Player['update']>[1] & Parameters<ThirdPersonCamera['update']>[0], dt = 1 / 60, combatEnabled = true) => {
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
      1,
      combatEnabled,
    )
    tpCamera.update(controls, dt)
  }

  return { scene, player, inventory, camera, tpCamera, ui, sounds, update }
}

vi.mock('../../src/world/CorgiVisual', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/CorgiVisual')>()),
  CorgiVisual: (await import('../helpers/gameplayQuadrupedVisual')).GameplayQuadrupedVisualDouble,
}))

describe('Targeted Verification: Bow / Shield & Camera Zoom', () => {
  it('Selecting Bow stows Shield; RMB enters aim and camera zooms', () => {
    const h = createPlayerHarness()
    h.update(input())

    h.inventory.equipWeapon('round_shield_t3'); h.update(input())
    // 1. Initial state: shield equipped
    expect(h.inventory.equippedShield?.id).toBe('round_shield_t3')
    expect(h.player.isAiming).toBe(false)
    expect(h.camera.fov).toBeCloseTo(58, 0)

    // 2. Explicitly selecting the bow stows the shield before RMB aims
    h.inventory.equipWeapon('elven_runebow')
    h.update(input({ isRightMouseDown: true }))
    expect(h.inventory.equippedShield).toBeNull()
    expect(h.player.isAiming).toBe(true)
    expect(h.player.isRangedAimViewActive).toBe(true)
    expect(h.ui.setAiming).toHaveBeenLastCalledWith(true)

    // Camera zooms smoothly toward 28° (AIM_FOV)
    for (let i = 0; i < 60; i++) {
      h.update(input({ isRightMouseDown: true }), 1 / 60)
    }
    expect(h.camera.fov).toBeLessThan(30)
    expect(h.camera.fov).toBeGreaterThanOrEqual(28)
    expect(h.camera.position.distanceTo(h.player.position)).toBeLessThan(2)

    // 3. RMB release -> isAiming = false
    h.update(input({ isRightMouseDown: false }))
    expect(h.player.isAiming).toBe(false)
    expect(h.player.isRangedAimViewActive).toBe(false)

    // Camera zooms smoothly back toward 58°
    for (let i = 0; i < 60; i++) {
      h.update(input({ isRightMouseDown: false }), 1 / 60)
    }
    expect(h.camera.fov).toBeGreaterThan(56)
    expect(h.camera.position.distanceTo(h.player.position)).toBeGreaterThan(5)
  })

  // Test 1: RMB only -> isAiming === true, but bowDrawRatio === 0
  it('RMB only -> isAiming true, bowDrawRatio stays 0 (no auto-charge)', () => {
    const h = createPlayerHarness()
    h.update(input())

    // Hold RMB only (no LMB) for 30 frames
    for (let i = 0; i < 30; i++) {
      h.update(input({ isRightMouseDown: true }), 1 / 60)
    }
    expect(h.player.isAiming).toBe(true)
    // bowDrawRatio must remain 0 — RMB alone does NOT draw the bow
    expect(h.player.bowDrawRatio).toBe(0)
  })

  it('Player procedural pilum stays in hand through windup, then releases once and completes recovery', () => {
    const h = createPlayerHarness({
      meleeWeaponId: 'steel_sword',
      rangedWeaponId: 'pilum_standard',
      shieldId: null,
    })
    h.update(input())

    h.update(input({ isRightMouseDown: true }), 1 / 60)
    expect(h.player.isAiming).toBe(true)
    expect(h.player.isRangedAimViewActive).toBe(true)
    const initialPila = h.player.arrowCount
    const projectiles = vi.fn()
    h.player.onFireArrow = projectiles

    h.update(input({ isRightMouseDown: true, consumeLeftClick: () => true }), 1 / 60)
    expect(h.player.combatAnimationAction).toBe('pilumThrow')
    expect(h.player.isRangedAimViewActive).toBe(true)
    expect(h.player.pilumCooldown).toBeCloseTo(getRangedCooldown('javelin') - 1 / 60)
    expect(h.player.arrowCount).toBe(initialPila)
    expect(projectiles).not.toHaveBeenCalled()
    expect((h.player as any).bowPivot.visible).toBe(true)
    expect(h.sounds.playBowRelease).not.toHaveBeenCalled()
    expect((h.player as any).swordPivot.visible).toBe(false)

    // The procedural fallback releases at its 0.45s windup boundary.
    h.update(input({ isRightMouseDown: true }), 0.40)
    expect(projectiles).not.toHaveBeenCalled()
    expect(h.player.arrowCount).toBe(initialPila)
    expect(h.player.isRangedAimViewActive).toBe(true)
    expect((h.player as any).bowPivot.visible).toBe(true)

    h.update(input({ isRightMouseDown: true }), 0.06)
    expect(projectiles).toHaveBeenCalledTimes(1)
    expect(h.player.isRangedAimViewActive).toBe(false)
    expect(h.ui.setAiming).toHaveBeenLastCalledWith(false)
    expect(projectiles.mock.calls[0][0].visualKind).toBe('pilum')
    const heldGrip = (h.player as any).bowGripPivot.getWorldPosition(new THREE.Vector3())
    expect(projectiles.mock.calls[0][0].origin.distanceTo(heldGrip)).toBeLessThan(1e-6)
    expect(h.player.pilumCooldown).toBeCloseTo(getRangedCooldown('javelin') - 0.46 - 1 / 60)
    expect(h.player.arrowCount).toBe(initialPila - 1)
    expect(h.player.combatAnimationAction).toBe('pilumThrow')
    expect((h.player as any).bowPivot.visible).toBe(false)

    h.update(input({ isRightMouseDown: true }), 0.20)
    expect(projectiles).toHaveBeenCalledTimes(1)
    expect(h.player.combatAnimationAction).toBe('pilumThrow')
    h.update(input({ isRightMouseDown: true }), 0.10)
    expect(h.player.combatAnimationAction).toBe('idle')
    expect(h.player.isAiming).toBe(false)
    expect(h.player.isRangedAimViewActive).toBe(false)
    expect((h.player as any).bowPivot.visible).toBe(true)
    expect((h.player as any).swordPivot.visible).toBe(false)

    // RMB-up only exits aim; it cannot be a delayed or duplicate launch trigger.
    h.update(input({ isRightMouseDown: false }), 1 / 60)
    expect(h.player.arrowCount).toBe(initialPila - 1)
    expect(projectiles).toHaveBeenCalledTimes(1)
    expect(h.sounds.playBowRelease).not.toHaveBeenCalled()
    h.update(input({ isRightMouseDown: true }))
    expect(h.player.isRangedAimViewActive).toBe(true)
  })

  it('holds the imported pilum until release, then draws a fresh one after recovery without re-aiming', () => {
    const h = createPlayerHarness({
      meleeWeaponId: 'steel_sword',
      rangedWeaponId: 'pilum_standard',
      shieldId: null,
    })
    h.update(input())
    ;(h.player as any).rig.animation = {
      has: (state: string) => state === 'pilumThrow',
      getDuration: () => 1.5,
      play: vi.fn(), seek: vi.fn(), update: vi.fn(), setEquipmentState: vi.fn(), stop: vi.fn(),
    }
    const projectiles = vi.fn()
    h.player.onFireArrow = projectiles

    h.update(input({ isRightMouseDown: true, consumeLeftClick: () => true }), 0)
    expect(h.player.combatAnimationAction).toBe('pilumThrow')
    expect(h.player.isRangedAimViewActive).toBe(true)
    expect((h.player as any).bowPivot.visible).toBe(true)
    expect(projectiles).not.toHaveBeenCalled()
    h.update(input({ isRightMouseDown: true }), PILUM_THROW_RELEASE_TIME - 0.01)
    expect(projectiles).not.toHaveBeenCalled()
    expect((h.player as any).bowPivot.visible).toBe(true)
    expect(h.player.isRangedAimViewActive).toBe(true)
    h.update(input({ isRightMouseDown: true }), 0.01)
    expect(projectiles).toHaveBeenCalledTimes(1)
    expect(h.player.isRangedAimViewActive).toBe(false)
    expect(h.player.combatAnimationAction).toBe('pilumThrow')
    expect((h.player as any).bowPivot.visible).toBe(false)
    h.update(input({ isRightMouseDown: true }), 0.46)
    h.update(input({ isRightMouseDown: true }), 1.5 - PILUM_THROW_RELEASE_TIME - 0.47)
    expect(projectiles).toHaveBeenCalledTimes(1)
    expect(h.player.combatAnimationAction).toBe('pilumThrow')
    expect((h.player as any).bowPivot.visible).toBe(false)

    h.update(input({ isRightMouseDown: true }), 0.01)
    expect(projectiles).toHaveBeenCalledTimes(1)
    expect(h.player.combatAnimationAction).toBe('idle')
    expect(h.player.isAiming).toBe(false)
    expect(h.player.isRangedAimViewActive).toBe(false)
    expect((h.player as any).bowPivot.visible).toBe(true)
    expect((h.player as any).swordPivot.visible).toBe(false)
    h.update(input({ isRightMouseDown: true }))
    expect(projectiles).toHaveBeenCalledTimes(1)
    expect(h.player.isAiming).toBe(false)
    expect((h.player as any).bowPivot.visible).toBe(true)
  })

  it('zooms out after an imported throw and keeps the next pilum visible until RMB is re-pressed', () => {
    const h = createPlayerHarness({
      meleeWeaponId: 'steel_sword', rangedWeaponId: 'pilum_standard', shieldId: null,
    })
    h.update(input())
    ;(h.player as any).rig.animation = {
      has: (state: string) => state === 'pilumThrow', getDuration: () => 1.5,
      play: vi.fn(), seek: vi.fn(), update: vi.fn(), setEquipmentState: vi.fn(), stop: vi.fn(),
    }
    const projectiles = vi.fn()
    h.player.onFireArrow = projectiles
    const heldRmb = input({ isRightMouseDown: true })
    for (let frame = 0; frame < 60; frame++) h.update(heldRmb)
    expect(h.player.isAiming).toBe(true)
    expect(h.camera.fov).toBeLessThan(30)

    h.update(input({ isRightMouseDown: true, consumeLeftClick: () => true }))
    expect(h.player.combatAnimationAction).toBe('pilumThrow')
    expect((h.player as any).bowPivot.visible).toBe(true)
    expect(projectiles).not.toHaveBeenCalled()
    for (let frame = 0; frame < 90; frame++) h.update(heldRmb)
    expect(projectiles).toHaveBeenCalledTimes(1)
    expect(h.player.combatAnimationAction).toBe('idle')
    expect(h.player.isAiming).toBe(false)
    expect((h.player as any).bowPivot.visible).toBe(true)
    expect(h.camera.fov).toBeGreaterThan(56)
    expect(h.player.isRangedAimViewActive).toBe(false)

    // Holding the original RMB cannot silently re-enter aim or launch from an empty hand.
    for (let frame = 0; frame < 50; frame++) h.update(heldRmb)
    h.update(input({ isRightMouseDown: true, consumeLeftClick: () => true }))
    expect(h.player.isAiming).toBe(false)
    expect(h.player.isRangedAimViewActive).toBe(false)
    expect(h.player.combatAnimationAction).toBe('idle')
    expect(projectiles).toHaveBeenCalledTimes(1)

    h.update(input({ isRightMouseDown: false }))
    h.update(heldRmb)
    expect(h.player.isAiming).toBe(true)
    expect(h.player.isRangedAimViewActive).toBe(true)
    expect((h.player as any).bowPivot.visible).toBe(true)
    h.update(input({ isRightMouseDown: true, consumeLeftClick: () => true }))
    expect(h.player.combatAnimationAction).toBe('pilumThrow')
    expect((h.player as any).bowPivot.visible).toBe(true)
    expect(projectiles).toHaveBeenCalledTimes(1)
    for (let frame = 0; frame < 35; frame++) h.update(heldRmb)
    expect(projectiles).toHaveBeenCalledTimes(2)
    expect((h.player as any).bowPivot.visible).toBe(false)
  })

  it('does not conjure another held pilum or projectile when the last pilum is spent', () => {
    const h = createPlayerHarness({
      meleeWeaponId: 'steel_sword', rangedWeaponId: 'pilum_standard', shieldId: null,
    })
    h.update(input())
    h.player.setArrowCount(1)
    const projectiles = vi.fn()
    h.player.onFireArrow = projectiles
    h.update(input({ isRightMouseDown: true, consumeLeftClick: () => true }))
    h.update(input({ isRightMouseDown: true }), 0.46)
    expect(projectiles).toHaveBeenCalledTimes(1)
    expect(h.player.arrowCount).toBe(0)
    expect((h.player as any).bowPivot.visible).toBe(false)
    h.update(input({ isRightMouseDown: true }), 0.24)
    expect(h.player.combatAnimationAction).toBe('idle')
    expect((h.player as any).bowPivot.visible).toBe(false)
    expect((h.player as any).swordPivot.visible).toBe(true)
    h.update(input({ isRightMouseDown: false }))
    h.update(input({ isRightMouseDown: true, consumeLeftClick: () => true }), 2)
    expect(h.player.combatAnimationAction).not.toBe('pilumThrow')
    expect(projectiles).toHaveBeenCalledTimes(1)
    expect((h.player as any).bowPivot.visible).toBe(false)
  })

  // Test 2: RMB + hold LMB -> bowDrawRatio increases smoothly over time
  it('RMB + hold LMB -> bowDrawRatio increases smoothly; release LMB -> shoots arrow', () => {
    const h = createPlayerHarness()
    h.update(input())

    // Enter aim
    h.update(input({ isRightMouseDown: true }), 1 / 60)
    expect(h.player.isAiming).toBe(true)
    expect(h.player.bowDrawRatio).toBe(0)

    // Hold LMB for 10 frames -> bow should start drawing
    for (let i = 0; i < 10; i++) {
      h.update(input({ isRightMouseDown: true, isLeftMouseDown: true }), 1 / 60)
    }
    const ratio1 = h.player.bowDrawRatio
    expect(ratio1).toBeGreaterThan(0)

    // Hold LMB for 20 more frames -> ratio increases further
    for (let i = 0; i < 20; i++) {
      h.update(input({ isRightMouseDown: true, isLeftMouseDown: true }), 1 / 60)
    }
    expect(h.player.bowDrawRatio).toBeGreaterThan(ratio1)

    // Release LMB -> fires arrow
    const initialArrows = h.player.arrowCount
    h.update(input({ isRightMouseDown: true, isLeftMouseDown: false, consumeLeftClickRelease: () => true }), 1 / 60)
    expect(h.player.combatAnimationAction).toBe('bowRelease')
    expect(h.player.isRangedAimViewActive).toBe(true)

    // Advance through projectileRelease
    h.update(input({ isRightMouseDown: true }), 0.1)
    expect(h.player.arrowCount).toBe(initialArrows - 1)
    expect(h.player.isRangedAimViewActive).toBe(true)
    expect(h.sounds.playBowRelease).toHaveBeenCalled()
  })

  it('keeps Bow in first person after firing and allows another load while RMB stays held', () => {
    const h = createPlayerHarness()
    const projectiles = vi.fn()
    h.player.onFireArrow = projectiles
    h.update(input({ isRightMouseDown: true }))
    h.update(input({ isRightMouseDown: true, isLeftMouseDown: true }), 0.2)
    h.update(input({ isRightMouseDown: true, consumeLeftClickRelease: () => true }), 0)
    expect(h.player.combatAnimationAction).toBe('bowRelease')
    expect(h.player.isAiming).toBe(true)
    expect(h.player.isRangedAimViewActive).toBe(true)
    expect(h.ui.setAiming).toHaveBeenLastCalledWith(true)
    h.update(input({ isRightMouseDown: true }), 0.03)
    expect(projectiles).not.toHaveBeenCalled()
    expect(h.player.isRangedAimViewActive).toBe(true)
    h.update(input({ isRightMouseDown: true }), 0.02)
    expect(projectiles).toHaveBeenCalledTimes(1)
    expect(projectiles.mock.calls[0][0].visualKind).toBe('arrow')
    expect(h.player.isRangedAimViewActive).toBe(true)
    expect(h.ui.setAiming).toHaveBeenLastCalledWith(true)
    for (let frame = 0; frame < 90; frame++) h.update(input({ isRightMouseDown: true }))
    expect(h.player.combatAnimationAction).toBe('bowAim')
    expect(h.player.isAiming).toBe(true)
    expect(h.player.isRangedAimViewActive).toBe(true)
    expect(h.camera.position.distanceTo(h.player.position)).toBeLessThan(2)
    expect(h.camera.fov).toBeLessThan(30)
    h.update(input({ isRightMouseDown: true, isLeftMouseDown: true }), 0.2)
    expect(h.player.bowDrawRatio).toBeGreaterThan(0)
    h.update(input({ isRightMouseDown: true, consumeLeftClickRelease: () => true }), 0)
    expect(h.player.combatAnimationAction).toBe('bowRelease')
    h.update(input({ isRightMouseDown: true }), 0.05)
    expect(projectiles).toHaveBeenCalledTimes(2)
    expect(h.player.isRangedAimViewActive).toBe(true)
    h.update(input({ isRightMouseDown: false }))
    expect(h.player.isRangedAimViewActive).toBe(false)
    for (let frame = 0; frame < 30; frame++) h.update(input({ isRightMouseDown: false }))
    expect(h.camera.fov).toBeGreaterThan(56)
  })

  it('cancels a charged Bow aim on RMB release without firing or locking the next aim', () => {
    const h = createPlayerHarness()
    const projectiles = vi.fn()
    h.player.onFireArrow = projectiles
    const initialArrows = h.player.arrowCount
    h.update(input({ isRightMouseDown: true }))
    h.update(input({ isRightMouseDown: true, isLeftMouseDown: true }), 0.2)
    expect(h.player.bowDrawRatio).toBeGreaterThan(0)
    h.update(input({ isRightMouseDown: false }), 1 / 60)
    expect(h.player.isRangedAimViewActive).toBe(false)
    expect(h.player.combatAnimationAction).not.toBe('bowRelease')
    expect(h.player.arrowCount).toBe(initialArrows)
    expect(projectiles).not.toHaveBeenCalled()
    h.update(input({ isRightMouseDown: true }), 1 / 60)
    expect(h.player.isRangedAimViewActive).toBe(true)
  })

  it('keeps Bow aim through a committed release even if RMB is released during windup', () => {
    const h = createPlayerHarness()
    const projectiles = vi.fn()
    h.player.onFireArrow = projectiles
    h.update(input({ isRightMouseDown: true }))
    h.update(input({ isRightMouseDown: true, isLeftMouseDown: true }), 0.2)
    h.update(input({ isRightMouseDown: true, consumeLeftClickRelease: () => true }), 0)
    h.update(input({ isRightMouseDown: false }), 0.03)
    expect(projectiles).not.toHaveBeenCalled()
    expect(h.player.isRangedAimViewActive).toBe(true)
    h.update(input({ isRightMouseDown: false }), 0.02)
    expect(projectiles).toHaveBeenCalledTimes(1)
    expect(h.player.isRangedAimViewActive).toBe(false)
  })

  it('keeps Pilum aim through windup after RMB release and clears aim on weapon rebuild', () => {
    const h = createPlayerHarness({ meleeWeaponId: 'steel_sword', rangedWeaponId: 'pilum_standard', shieldId: null })
    const projectiles = vi.fn()
    h.player.onFireArrow = projectiles
    h.update(input({ isRightMouseDown: true, consumeLeftClick: () => true }), 0)
    h.update(input({ isRightMouseDown: false }), 0.3)
    expect(projectiles).not.toHaveBeenCalled()
    expect(h.player.isRangedAimViewActive).toBe(true)
    h.player.rebuildRangedWeapon('recurve_longbow')
    expect(h.player.isRangedAimViewActive).toBe(false)
    h.update(input({ isRightMouseDown: false }), 0.2)
    expect(projectiles).not.toHaveBeenCalled()
  })

  it('uses the same aim direction on a mounted Player while moving the camera to and from eye level', () => {
    const h = createPlayerHarness({ meleeWeaponId: 'steel_sword', rangedWeaponId: 'pilum_standard', shieldId: null })
    const mount = new Mount(h.scene, MountType.CORGI, 0, 0, 0)
    onTestFinished(() => mount.dispose())
    h.player.mountVehicle(mount)
    h.update(input())
    const beforeDirection = h.tpCamera.getAimDirection(new THREE.Vector3())
    const beforePosition = h.camera.position.clone()
    for (let frame = 0; frame < 30; frame++) h.update(input({ isRightMouseDown: true }))
    expect(h.player.isRangedAimViewActive).toBe(true)
    expect([h.camera.position.x, h.camera.position.y, h.camera.position.z].every(Number.isFinite)).toBe(true)
    const aimedDirection = h.tpCamera.getAimDirection(new THREE.Vector3())
    expect(aimedDirection.dot(beforeDirection)).toBeGreaterThan(0.999999)
    expect(h.camera.getWorldDirection(new THREE.Vector3()).dot(beforeDirection)).toBeGreaterThan(0.999999)
    expect(h.camera.position.distanceTo(beforePosition)).toBeGreaterThan(5)
    expect(Math.abs(h.camera.position.y - h.player.position.y)).toBeLessThan(1)
    const projectiles = vi.fn()
    h.player.onFireArrow = projectiles
    h.update(input({ isRightMouseDown: true, consumeLeftClick: () => true }))
    h.update(input({ isRightMouseDown: true }), 0.46)
    expect(projectiles).toHaveBeenCalledTimes(1)
    expect(h.player.isRangedAimViewActive).toBe(false)
    for (let frame = 0; frame < 30; frame++) h.update(input({ isRightMouseDown: true }))
    expect(h.camera.position.distanceTo(h.player.position)).toBeGreaterThan(5)
  })

  // Test 3: release RMB without LMB charge -> does not shoot, only exits aim
  it('release RMB without LMB charge -> exits aim without shooting', () => {
    const h = createPlayerHarness()
    h.update(input())

    // Enter aim with RMB, but do NOT hold LMB
    for (let i = 0; i < 10; i++) {
      h.update(input({ isRightMouseDown: true }), 1 / 60)
    }
    expect(h.player.isAiming).toBe(true)
    expect(h.player.bowDrawRatio).toBe(0)

    const initialArrows = h.player.arrowCount

    // Release RMB (no LMB was held) -> should only exit aim, not fire
    h.update(input({ isRightMouseDown: false }), 1 / 60)
    expect(h.player.isAiming).toBe(false)
    expect(h.player.isRangedAimViewActive).toBe(false)
    // bowRelease animation must NOT have been triggered
    expect(h.player.combatAnimationAction).not.toBe('bowRelease')
    // Arrow count unchanged
    h.update(input(), 0.1)
    expect(h.player.arrowCount).toBe(initialArrows)
    expect(h.sounds.playBowRelease).not.toHaveBeenCalled()
  })

  // Test 4: selecting Bow stows Shield; release LMB shoots
  it('選弓卸盾後按 RMB 進入 Aim，蓄力釋放 LMB 正常射出箭矢', () => {
    const h = createPlayerHarness()
    h.inventory.equipWeapon('round_shield_t3')
    h.update(input())
    expect(h.inventory.equippedShield?.id).toBe('round_shield_t3')

    h.inventory.equipWeapon('elven_runebow')
    // Enter aim and charge with LMB
    h.update(input({ isRightMouseDown: true }))
    expect(h.inventory.equippedShield).toBeNull()
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

  // Test 5: LMB when not aiming -> attack with melee
  it('使用完弓箭後（未按 RMB 瞄準時），按左鍵揮擊近戰武器', () => {
    const h = createPlayerHarness()
    h.update(input())

    // 1. 按住 RMB + LMB 瞄準拉弓
    h.update(input({ isRightMouseDown: true }), 1 / 60)
    expect(h.player.isAiming).toBe(true)

    for (let i = 0; i < 20; i++) {
      h.update(input({ isRightMouseDown: true, isLeftMouseDown: true }), 1 / 60)
    }
    expect(h.player.bowDrawRatio).toBeGreaterThan(0.1)

    // 2. 釋放 LMB 射箭
    h.update(input({ isRightMouseDown: true, isLeftMouseDown: false, consumeLeftClickRelease: () => true }), 1 / 60)
    expect(h.player.combatAnimationAction).toBe('bowRelease')

    // 放開 RMB，完成放箭動作 (0.25s)
    for (let i = 0; i < 20; i++) {
      h.update(input({ isRightMouseDown: false }), 1 / 60)
    }
    expect(h.player.combatAnimationAction).toBe('idle')
    expect(h.player.isAiming).toBe(false)

    // 3. 未瞄準時按左鍵攻擊近戰
    h.update(input({ consumeLeftClick: () => true }), 1 / 60)
    expect(h.player.swinging).toBe(true)
    expect(h.player.combatAnimationAction).toBe('lanceThrust')
    expect(h.sounds.playSwing).not.toHaveBeenCalled()
  })
})

describe('Targeted Verification: Melee Attack Input Buffer & Attack Cadence', () => {
  it('Early click during recovery queues and immediately triggers next attack upon busy end', () => {
    const h = createPlayerHarness()
    h.update(input())

    // 1. Initial attack (lanceThrust total = 0.42s)
    h.update(input({ consumeLeftClick: () => true }), 1 / 60)
    expect(h.player.swinging).toBe(true)
    expect(h.sounds.playSwing).not.toHaveBeenCalled()

    // Advance 0.35s into the 0.42s attack (during recovery, 0.07s before completion)
    for (let t = 1 / 60; t < 0.35; t += 1 / 60) {
      h.update(input(), 1 / 60)
    }
    expect(h.player.swinging).toBe(true)
    expect(h.sounds.playSwing).not.toHaveBeenCalled()

    // 2. Early click during recovery (within 150ms buffer window)
    h.update(input({ consumeLeftClick: () => true }), 1 / 60)
    // First attack is still running, sound should NOT have been called again yet
    expect(h.sounds.playSwing).not.toHaveBeenCalled()

    // 3. Advance to completion (0.42s)
    for (let t = 0.35 + 1 / 60; t <= 0.42 + 1e-4; t += 1 / 60) {
      h.update(input(), 1 / 60)
    }
    // Buffer should have immediately triggered the second attack!
    expect(h.player.swinging).toBe(true)
    expect(h.sounds.playSwing).not.toHaveBeenCalled()
  })

  it('Single click never triggers two attacks', () => {
    const h = createPlayerHarness()
    h.update(input())

    // Single click
    h.update(input({ consumeLeftClick: () => true }), 1 / 60)
    expect(h.sounds.playSwing).not.toHaveBeenCalled()

    // Run through the entire attack and into idle (0.6s > 0.42s) without clicking again
    for (let t = 0; t < 0.6; t += 1 / 60) {
      h.update(input(), 1 / 60)
    }

    // Must remain exactly 1 swing, not 2
    expect(h.sounds.playSwing).not.toHaveBeenCalled()
    expect(h.player.swinging).toBe(false)
  })

  it('Holding LMB does NOT auto-repeat attacks', () => {
    const h = createPlayerHarness()
    h.update(input())

    // Frame 0: mouse down (click happens)
    h.update(input({ isLeftMouseDown: true, consumeLeftClick: () => true }), 1 / 60)
    expect(h.sounds.playSwing).not.toHaveBeenCalled()

    // Next 60 frames: LMB is held down (isLeftMouseDown = true, but consumeLeftClick = false)
    for (let i = 0; i < 60; i++) {
      h.update(input({ isLeftMouseDown: true, consumeLeftClick: () => false }), 1 / 60)
    }

    // Must not auto-repeat
    expect(h.sounds.playSwing).not.toHaveBeenCalled()
    expect(h.player.swinging).toBe(false)
  })

  it('Click too early (>150ms before completion, e.g. during windup) expires and does not trigger next attack', () => {
    const h = createPlayerHarness()
    h.update(input())

    // 1. Initial attack
    h.update(input({ consumeLeftClick: () => true }), 1 / 60)
    expect(h.sounds.playSwing).not.toHaveBeenCalled()

    // 2. Click immediately during early windup (t = 0.03s, which is 0.39s > 0.15s before 0.42s completion)
    h.update(input(), 1 / 60)
    h.update(input({ consumeLeftClick: () => true }), 1 / 60)
    expect(h.sounds.playSwing).not.toHaveBeenCalled()

    // 3. Advance to completion (0.42s) without clicking again
    for (let t = 0.05; t <= 0.50; t += 1 / 60) {
      h.update(input(), 1 / 60)
    }

    // Buffer expired, so it should cleanly return to idle without triggering a second attack
    expect(h.sounds.playSwing).not.toHaveBeenCalled()
    expect(h.player.swinging).toBe(false)
  })

  it('RMB Aim intent cancels buffered lance attack even when shield is already unequipped', () => {
    const h = createPlayerHarness()
    h.inventory.unequipShield()
    h.update(input())
    expect(h.inventory.equippedShield).toBeNull()

    // 1. Initial lance attack
    h.update(input({ consumeLeftClick: () => true }), 1 / 60)
    expect(h.player.swinging).toBe(true)
    expect(h.sounds.playSwing).not.toHaveBeenCalled()

    // Advance to recovery (t = 0.35s)
    for (let t = 1 / 60; t < 0.35; t += 1 / 60) {
      h.update(input(), 1 / 60)
    }

    // 2. Early click during recovery to queue a buffered attack
    h.update(input({ consumeLeftClick: () => true }), 1 / 60)
    expect(h.sounds.playSwing).not.toHaveBeenCalled()

    // 3. While first attack is still in recovery (before action completes), player presses RMB to aim bow
    h.update(input({ isRightMouseDown: true }), 1 / 60)

    // 4. Advance through action completion (t = 0.42s) holding RMB
    for (let t = 0.37; t <= 0.45; t += 1 / 60) {
      h.update(input({ isRightMouseDown: true }), 1 / 60)
    }

    // Second thrust must NOT have been triggered!
    expect(h.sounds.playSwing).not.toHaveBeenCalled()
    expect(h.player.swinging).toBe(false)

    // Player should now be aiming bow, and camera zooms toward 28°
    expect(h.player.isAiming).toBe(true)
    for (let i = 0; i < 40; i++) {
      h.update(input({ isRightMouseDown: true }), 1 / 60)
    }
    expect(h.camera.fov).toBeLessThan(30)
    expect(h.camera.fov).toBeGreaterThanOrEqual(28)
  })

  it('Lance attacks require no stamina and do not consume stamina', () => {
    const h = createPlayerHarness()
    h.update(input())

    h.player.setStamina(0)
    h.update(input({ consumeLeftClick: () => true }), 1 / 60)

    expect(h.sounds.playSwing).not.toHaveBeenCalled()
    expect(h.player.swinging).toBe(true)
    expect(h.player.staminaValue).toBe(0)
  })

  it('Sword attacks require no stamina and do not consume stamina', () => {
    const h = createPlayerHarness()
    h.inventory.addWeapon('steel_sword')
    h.inventory.equipWeapon('steel_sword')
    h.update(input())

    h.player.setStamina(0)
    h.update(input({ consumeLeftClick: () => true }), 1 / 60)

    expect(h.sounds.playSwing).not.toHaveBeenCalled()
    expect(h.player.swinging).toBe(true)
    expect(h.player.staminaValue).toBe(0)
  })

  it('Buffer is strictly scoped to Lance: sword clicks during recovery do not buffer follow-up attack', () => {
    const h = createPlayerHarness()
    h.inventory.equipWeapon('round_shield_t3')
    h.inventory.addWeapon('steel_sword')
    h.inventory.equipWeapon('steel_sword')
    h.update(input())

    // 1. Start sword slash (0.48s total)
    h.update(input({ consumeLeftClick: () => true }), 1 / 60)
    expect(h.player.swinging).toBe(true)
    expect(h.sounds.playSwing).not.toHaveBeenCalled()

    // 2. Advance to sword recovery (0.40s)
    for (let t = 1 / 60; t < 0.40; t += 1 / 60) {
      h.update(input(), 1 / 60)
    }

    // 3. Click during recovery (sword should NOT buffer)
    h.update(input({ consumeLeftClick: () => true }), 1 / 60)
    expect(h.sounds.playSwing).not.toHaveBeenCalled()

    // 4. Advance past action completion (0.50s > 0.48s)
    for (let t = 0.41; t <= 0.55; t += 1 / 60) {
      h.update(input(), 1 / 60)
    }

    // Sword has no buffer: stays at 1 swing, enters idle cleanly
    expect(h.sounds.playSwing).not.toHaveBeenCalled()
    expect(h.player.swinging).toBe(false)
  })
})

it.each([
  { action: 'melee', meleeWeaponId: 'steel_sword', rangedWeaponId: '', shieldId: 'round_shield_t3' },
  { action: 'bow', meleeWeaponId: 'steel_sword', rangedWeaponId: 'elven_runebow', shieldId: null },
  { action: 'pilum', meleeWeaponId: 'steel_sword', rangedWeaponId: 'pilum_standard', shieldId: null },
])('movement-only update cancels queued $action, drains clicks and re-enables combat afterwards', loadout => {
  const h = createPlayerHarness(loadout)
  const fire = vi.fn(); h.player.onFireArrow = fire
  h.update(input())
  const aim = loadout.action !== 'melee'
  h.update(input({ isRightMouseDown: aim, isLeftMouseDown: true, consumeLeftClick: () => true }))
  if (loadout.action === 'bow') h.update(input({ isRightMouseDown: true, consumeLeftClickRelease: () => true }))
  expect(h.player.combatAnimationAction).not.toBe('idle')
  const before = h.player.position.clone(), ammo = h.player.arrowCount
  const click = vi.fn(() => true), release = vi.fn(() => true)
  const controls = input({ keys: { KeyW: true, ShiftLeft: true, Space: true },
    isLeftMouseDown: true, isRightMouseDown: true, consumeLeftClick: click, consumeLeftClickRelease: release })
  h.update(controls, .05, false)
  expect(click).toHaveBeenCalledOnce(); expect(release).toHaveBeenCalledOnce()
  expect(h.player.position.distanceTo(before)).toBeGreaterThan(.1)
  expect(h.player.position.y).toBeGreaterThan(before.y)
  expect(h.player.combatAnimationAction).toBe('idle')
  expect(h.player.shield.shieldRaised).toBe(false)
  h.update(input({ isRightMouseDown: true, isLeftMouseDown: true }), .6, false)
  expect(fire).not.toHaveBeenCalled()
  expect(h.player.arrowCount).toBe(ammo)
  h.update(input({ isRightMouseDown: true, consumeLeftClick: () => true }))
  if (loadout.action === 'melee') {
    expect(h.player.shield.shieldRaised).toBe(true)
    expect(h.player.swinging).toBe(true)
  } else expect(h.player.isAiming).toBe(true)
})
