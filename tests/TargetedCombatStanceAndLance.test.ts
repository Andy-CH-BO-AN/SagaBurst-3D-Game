import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { InventoryManager } from '../src/rpg/InventoryManager'
import { Player } from '../src/player/Player'
import { NPC, Faction, AIType } from '../src/world/NPC'
import { ThirdPersonCamera } from '../src/camera/ThirdPersonCamera'
import { CharacterCombatAnimator, COMBAT_ANIMATION_PROFILES } from '../src/world/CharacterCombatAnimator'
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
  it('Melee + Shield -> RMB -> shield auto-unequipped, isAiming = true, camera zooms', () => {
    const h = createPlayerHarness()
    h.update(input())

    // 1. Initial state: shield equipped
    expect(h.inventory.equippedShield?.id).toBe('round_shield_t3')
    expect(h.player.isAiming).toBe(false)
    expect(h.camera.fov).toBeCloseTo(58, 0)

    // 2. RMB pressed with equipped bow -> shield automatically unequipped, enters aim in the same frame
    h.update(input({ isRightMouseDown: true }))
    expect(h.inventory.equippedShield).toBeNull()
    expect(h.player.isAiming).toBe(true)

    // Camera zooms smoothly toward 28° (AIM_FOV)
    for (let i = 0; i < 60; i++) {
      h.update(input({ isRightMouseDown: true }), 1 / 60)
    }
    expect(h.camera.fov).toBeLessThan(30)
    expect(h.camera.fov).toBeGreaterThanOrEqual(28)

    // 3. RMB release -> isAiming = false
    h.update(input({ isRightMouseDown: false }))
    expect(h.player.isAiming).toBe(false)

    // Camera zooms smoothly back toward 58°
    for (let i = 0; i < 60; i++) {
      h.update(input({ isRightMouseDown: false }), 1 / 60)
    }
    expect(h.camera.fov).toBeGreaterThan(56)
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

    // Advance through projectileRelease
    h.update(input({ isRightMouseDown: true }), 0.1)
    expect(h.player.arrowCount).toBe(initialArrows - 1)
    expect(h.sounds.playBowRelease).toHaveBeenCalled()
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
    // bowRelease animation must NOT have been triggered
    expect(h.player.combatAnimationAction).not.toBe('bowRelease')
    // Arrow count unchanged
    h.update(input(), 0.1)
    expect(h.player.arrowCount).toBe(initialArrows)
    expect(h.sounds.playBowRelease).not.toHaveBeenCalled()
  })

  // Test 4: shield auto-unequipped on RMB, shoots arrow on release LMB
  it('持盾時按 RMB 自動卸盾進入 Aim，蓄力釋放 LMB 正常射出箭矢', () => {
    const h = createPlayerHarness()
    h.update(input())
    expect(h.inventory.equippedShield?.id).toBe('round_shield_t3')

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
    expect(h.sounds.playSwing).toHaveBeenCalled()
  })
})

describe('Targeted Verification: Lance Reach, Attack Speed & Hit Mechanics', () => {
  it('Lance mesh length in WeaponMeshFactory remains 2.6m (mesh length unchanged)', () => {
    const parent = new THREE.Group()
    const { tipLocal } = WeaponMeshFactory.buildMelee('steel_lance', parent)
    expect(tipLocal.y).toBeCloseTo(2.6, 2)
  })

  it('Attack cadence: unmounted lance is 0.42s (faster than sword 0.48s), mounted lance is 0.28s', () => {
    const mounted = COMBAT_ANIMATION_PROFILES['mountedLance']
    const mountedTotal = mounted.windup + mounted.active + mounted.recovery
    expect(mountedTotal).toBeCloseTo(0.28, 2)

    const unmounted = COMBAT_ANIMATION_PROFILES['lanceThrust']
    const unmountedTotal = unmounted.windup + unmounted.active + unmounted.recovery
    expect(unmountedTotal).toBeCloseTo(0.42, 2)

    // Swords remain 0.48s
    const sword = COMBAT_ANIMATION_PROFILES['swordSlash']
    const swordTotal = sword.windup + sword.active + sword.recovery
    expect(swordTotal).toBeCloseTo(0.48, 2)

    // Unmounted lance (0.42s) is faster than sword (0.48s)
    expect(unmountedTotal).toBeLessThan(swordTotal)
    // Mounted lance (0.28s) has rapid thrust cadence
    expect(mountedTotal).toBeLessThan(unmountedTotal)

    // UI text display
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

// ── Imported Humanoid Setup for Visual & Gameplay Reach Verification ──
import { readFileSync } from 'node:fs'
import { readGlb, loadRig } from '../tools/lib/humanoid-glb.mjs'
import { createHumanoidRigAdapter, createMountedIdleClip, MixerController } from '../src/world/HumanoidAssetRegistry'
import { CharacterEquipmentPose } from '../src/world/CharacterEquipmentPose'
import { applyEquipmentAttachment, calibrateEquipmentFrames, calibrateLanceIdleAttachment } from '../src/world/EquipmentAttachmentContract'
import { createEquipmentSocketProxies } from '../src/world/HumanoidEquipmentSockets'
import type { HandGripFrame } from '../src/world/BowAttachmentContract'

async function createHumanoidFixture(faction: 'roman' | 'viking') {
  const base = `public/models/characters/v2/${faction}`
  const manifest = JSON.parse(readFileSync(`${base}/manifest.json`, 'utf8'))
  const levels = await Promise.all([0, 1, 2].map(i => loadRig(readGlb(`${base}/lod${i}.glb`))))
  const a = manifest.handGripFrames.left
  const left: HandGripFrame = { ...a }
  for (const k of ['palmContactCenter', 'palmNormal', 'thumbDirection', 'fingerDirection', 'wristCenter', 'thumbBaseCenter'] as const) left[k] = new THREE.Vector3(...a[k])
  const root = new THREE.Group()
  levels.forEach(l => root.add(l.scene))
  root.updateMatrixWorld(true)

  const frames = levels.map((l, i) => calibrateEquipmentFrames(manifest.swordGripFrames[`lod${i}`], left, levels[0].scene.getObjectByName('hand_l'), l.scene.getObjectByName('hand_l')))
  levels.forEach((l, i) => calibrateLanceIdleAttachment(l.scene, l.animations.find(c => c.name === 'idle')!, frames[i].lanceRight))

  const controller = new MixerController(
    levels.map(l => new THREE.AnimationMixer(l.scene)),
    levels.map(l => [...l.animations, createMountedIdleClip(l.animations.find(c => c.name === 'idle')!)])
  )
  const rigs = levels.map((l, i) => {
    l.scene.userData.equipmentGripFrames = frames[i]
    l.scene.userData.equipmentFaction = faction
    return createHumanoidRigAdapter(l.scene, controller)
  })
  controller.equipmentLayers = rigs.map((r, i) => new CharacterEquipmentPose(levels[i].scene, r, frames[i]))
  controller.onPoseEvaluated = createEquipmentSocketProxies(root, rigs[0])
  controller.onPoseEvaluated()

  const lance = new THREE.Group(), model = new THREE.Group()
  lance.add(model)
  WeaponMeshFactory.buildMelee('steel_lance', model)
  rigs[0].right.handSocket.add(lance)
  applyEquipmentAttachment(rigs[0].right.handSocket, lance, model, frames[0].lanceRight, 'lance')

  const animator = new CharacterCombatAnimator(rigs[0], lance, new THREE.Group())

  const reset = (mounted = false) => {
    controller.stop()
    animator.cancel()
    animator.setEquipment(true, false)
    animator.setLocomotion(0, mounted)
    animator.update(0.2)
  }

  const measure = () => {
    root.updateMatrixWorld(true)
    const grip = model.localToWorld(new THREE.Vector3(0, 0.15, 0))
    const tip = model.localToWorld(new THREE.Vector3(0, 2.6, 0))
    return { grip, tip }
  }

  return { root, animator, reset, measure }
}

function distToSegmentSq(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const ab = new THREE.Vector3().subVectors(b, a)
  const ap = new THREE.Vector3().subVectors(p, a)
  const abLenSq = ab.lengthSq()
  if (abLenSq < 1e-6) return ap.lengthSq()
  const t = Math.max(0, Math.min(1, ap.dot(ab) / abLenSq))
  const proj = new THREE.Vector3().copy(a).addScaledVector(ab, t)
  return p.distanceToSquared(proj)
}

function checkLanceHit(
  playerPos: THREE.Vector3,
  playerForward: THREE.Vector3,
  currTipPos: THREE.Vector3,
  prevTipPos: THREE.Vector3,
  currGripPos: THREE.Vector3,
  npcCombatPos: THREE.Vector3,
  npcIsMounted: boolean,
  lanceReach = 3.9
): boolean {
  const aiCenter = npcCombatPos.clone()
  aiCenter.y += 1.0

  const toTarget = npcCombatPos.clone().sub(playerPos)
  toTarget.y = 0
  const forwardDist = toTarget.dot(playerForward)
  const hitTolerance = npcIsMounted ? 0.85 : 0.60

  if (forwardDist <= 0 || forwardDist > lanceReach + hitTolerance) return false

  const d1Sq = distToSegmentSq(aiCenter, prevTipPos, currTipPos)
  const d2Sq = distToSegmentSq(aiCenter, currGripPos, currTipPos)
  const minDSq = Math.min(d1Sq, d2Sq)

  return minDSq <= hitTolerance * hitTolerance
}

describe('Targeted Verification: Lance Visual Reach in CharacterEquipmentPose', () => {
  for (const faction of ['roman', 'viking'] as const) {
    for (const mounted of [false, true]) {
      const mode = mounted ? 'mounted' : 'unmounted'
      it(`${faction} ${mode}: idle, 50% thrust, full thrust satisfy +20-30% forward reach increase`, async () => {
        const fixture = await createHumanoidFixture(faction)
        fixture.reset(mounted)

        // 1. Idle / ready pose
        const idle = fixture.measure()
        const idleTipForward = idle.tip.z
        const idleGripForward = idle.grip.z

        // Action profile
        const action = mounted ? 'mountedLance' : 'lanceThrust'
        const profile = COMBAT_ANIMATION_PROFILES[action]
        const hitTime = profile.windup + profile.active * 0.9
        const halfThrustTime = profile.windup + (hitTime - profile.windup) * 0.5

        fixture.animator.start(action)

        // 2. Windup pullback check
        fixture.animator.update(profile.windup * 0.8)
        const windupState = fixture.measure()
        expect(windupState.tip.z).toBeLessThanOrEqual(idleTipForward + 0.01) // Noticeable pullback or ready hold

        // 3. 50% thrust
        fixture.reset(mounted)
        fixture.animator.start(action)
        fixture.animator.update(halfThrustTime)
        const halfThrust = fixture.measure()
        const halfTipForward = halfThrust.tip.z
        expect(halfTipForward).toBeGreaterThan(idleTipForward + 0.15)

        // 4. Full thrust (at hit time / peak)
        fixture.reset(mounted)
        fixture.animator.start(action)
        fixture.animator.update(hitTime)
        const fullThrust = fixture.measure()
        const fullTipForward = fullThrust.tip.z
        const fullGripForward = fullThrust.grip.z

        const forwardDelta = fullTipForward - idleTipForward
        const percentIncrease = (forwardDelta / idleTipForward) * 100
        const gripDelta = fullGripForward - idleGripForward

        // Verify arm noticeably drives forward
        expect(gripDelta).toBeGreaterThan(0.45)
        // Verify forward reach increase is between 20% and 30%
        expect(percentIncrease).toBeGreaterThanOrEqual(20.0)
        expect(percentIncrease).toBeLessThanOrEqual(30.0)

        // Verify lance tip points forward
        const lanceDir = fullThrust.tip.clone().sub(fullThrust.grip).normalize()
        expect(lanceDir.z).toBeGreaterThan(0.96)

        // 5. Recovery smoothly returns toward idle
        fixture.animator.update(profile.recovery)
        const recoveryState = fixture.measure()
        expect(Math.abs(recoveryState.tip.z - idleTipForward)).toBeLessThan(0.08)
      })
    }
  }
})

describe('Targeted Verification: Lance Gameplay Reach & Swept Hit Mechanics', () => {
  it('Gameplay Hit: verifies close hits, extended reach hits, beyond reach misses, and side/behind misses', async () => {
    const fixture = await createHumanoidFixture('roman')
    fixture.reset(false)

    const playerPos = new THREE.Vector3(0, 0, 0)
    const playerForward = new THREE.Vector3(0, 0, 1)

    // At full thrust:
    const thrustProfile = COMBAT_ANIMATION_PROFILES['lanceThrust']
    fixture.animator.start('lanceThrust')
    fixture.animator.update(thrustProfile.windup + thrustProfile.active * 0.9)
    const fullThrust = fixture.measure()
    const currTipPos = fullThrust.tip
    const currGripPos = fullThrust.grip
    const prevTipPos = currTipPos.clone()

    // 1. Within original distance (e.g. 2.2m) -> HITS
    const closeEnemy = new THREE.Vector3(currTipPos.x, 0, 2.2)
    expect(checkLanceHit(playerPos, playerForward, currTipPos, prevTipPos, currGripPos, closeEnemy, false)).toBe(true)

    // 2. Newly extended reach (e.g. 3.3m) -> HITS!
    // (At tip.z ≈ 2.88m, distance to 3.3m is ~0.42m <= 0.60m hit tolerance)
    const extendedEnemy = new THREE.Vector3(currTipPos.x, 0, 3.3)
    expect(checkLanceHit(playerPos, playerForward, currTipPos, prevTipPos, currGripPos, extendedEnemy, false)).toBe(true)

    // 3. Beyond maximum effective reach (e.g. 3.6m for unmounted) -> MISSES
    const farEnemy = new THREE.Vector3(currTipPos.x, 0, 3.6)
    expect(checkLanceHit(playerPos, playerForward, currTipPos, prevTipPos, currGripPos, farEnemy, false)).toBe(false)

    // 4. Behind player (z = -1.5m) -> MISSES
    const behindEnemy = new THREE.Vector3(currTipPos.x, 0, -1.5)
    expect(checkLanceHit(playerPos, playerForward, currTipPos, prevTipPos, currGripPos, behindEnemy, false)).toBe(false)

    // 5. Far to the side (x = 2.5m, z = 2.5m) -> MISSES
    const sideEnemy = new THREE.Vector3(2.5, 0, 2.5)
    expect(checkLanceHit(playerPos, playerForward, currTipPos, prevTipPos, currGripPos, sideEnemy, false)).toBe(false)
  })

  it('Mounted High-Speed Swept Segment: catches fast-moving targets without tunneling/skipping', () => {
    const playerPos = new THREE.Vector3(0, 0, 0)
    const playerForward = new THREE.Vector3(0, 0, 1)

    // Simulating high-speed horse charge where tip moves from z = 1.5 to z = 3.5 in one frame
    const prevTipPos = new THREE.Vector3(0.2, 1.2, 1.5)
    const currTipPos = new THREE.Vector3(0.2, 1.2, 3.5)
    const currGripPos = new THREE.Vector3(0.2, 1.2, 1.0)

    // Enemy positioned right in the swept path at z = 2.5 (where neither prevTip nor currTip is directly touching)
    const sweptEnemy = new THREE.Vector3(0.2, 0.2, 2.5) // aiCenter.y = 0.2 + 1.0 = 1.2

    // d1Sq is 0 because aiCenter is exactly on the swept line segment [prevTipPos, currTipPos]
    const hitResult = checkLanceHit(playerPos, playerForward, currTipPos, prevTipPos, currGripPos, sweptEnemy, false)
    expect(hitResult).toBe(true)
  })
})

describe('Targeted Verification: Melee Attack Input Buffer & Attack Cadence', () => {
  it('Early click during recovery queues and immediately triggers next attack upon busy end', () => {
    const h = createPlayerHarness()
    h.update(input())

    // 1. Initial attack (lanceThrust total = 0.42s)
    h.update(input({ consumeLeftClick: () => true }), 1 / 60)
    expect(h.player.swinging).toBe(true)
    expect(h.sounds.playSwing).toHaveBeenCalledTimes(1)

    // Advance 0.35s into the 0.42s attack (during recovery, 0.07s before completion)
    for (let t = 1 / 60; t < 0.35; t += 1 / 60) {
      h.update(input(), 1 / 60)
    }
    expect(h.player.swinging).toBe(true)
    expect(h.sounds.playSwing).toHaveBeenCalledTimes(1)

    // 2. Early click during recovery (within 150ms buffer window)
    h.update(input({ consumeLeftClick: () => true }), 1 / 60)
    // First attack is still running, sound should NOT have been called again yet
    expect(h.sounds.playSwing).toHaveBeenCalledTimes(1)

    // 3. Advance to completion (0.42s)
    for (let t = 0.35 + 1 / 60; t <= 0.42 + 1e-4; t += 1 / 60) {
      h.update(input(), 1 / 60)
    }
    // Buffer should have immediately triggered the second attack!
    expect(h.player.swinging).toBe(true)
    expect(h.sounds.playSwing).toHaveBeenCalledTimes(2)
  })

  it('Single click never triggers two attacks', () => {
    const h = createPlayerHarness()
    h.update(input())

    // Single click
    h.update(input({ consumeLeftClick: () => true }), 1 / 60)
    expect(h.sounds.playSwing).toHaveBeenCalledTimes(1)

    // Run through the entire attack and into idle (0.6s > 0.42s) without clicking again
    for (let t = 0; t < 0.6; t += 1 / 60) {
      h.update(input(), 1 / 60)
    }

    // Must remain exactly 1 swing, not 2
    expect(h.sounds.playSwing).toHaveBeenCalledTimes(1)
    expect(h.player.swinging).toBe(false)
  })

  it('Holding LMB does NOT auto-repeat attacks', () => {
    const h = createPlayerHarness()
    h.update(input())

    // Frame 0: mouse down (click happens)
    h.update(input({ isLeftMouseDown: true, consumeLeftClick: () => true }), 1 / 60)
    expect(h.sounds.playSwing).toHaveBeenCalledTimes(1)

    // Next 60 frames: LMB is held down (isLeftMouseDown = true, but consumeLeftClick = false)
    for (let i = 0; i < 60; i++) {
      h.update(input({ isLeftMouseDown: true, consumeLeftClick: () => false }), 1 / 60)
    }

    // Must not auto-repeat
    expect(h.sounds.playSwing).toHaveBeenCalledTimes(1)
    expect(h.player.swinging).toBe(false)
  })

  it('Click too early (>150ms before completion, e.g. during windup) expires and does not trigger next attack', () => {
    const h = createPlayerHarness()
    h.update(input())

    // 1. Initial attack
    h.update(input({ consumeLeftClick: () => true }), 1 / 60)
    expect(h.sounds.playSwing).toHaveBeenCalledTimes(1)

    // 2. Click immediately during early windup (t = 0.03s, which is 0.39s > 0.15s before 0.42s completion)
    h.update(input(), 1 / 60)
    h.update(input({ consumeLeftClick: () => true }), 1 / 60)
    expect(h.sounds.playSwing).toHaveBeenCalledTimes(1)

    // 3. Advance to completion (0.42s) without clicking again
    for (let t = 0.05; t <= 0.50; t += 1 / 60) {
      h.update(input(), 1 / 60)
    }

    // Buffer expired, so it should cleanly return to idle without triggering a second attack
    expect(h.sounds.playSwing).toHaveBeenCalledTimes(1)
    expect(h.player.swinging).toBe(false)
  })
})
