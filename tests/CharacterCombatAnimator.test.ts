import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { ArmRig, CharacterRig, LegRig } from '../src/world/CharacterVisuals'
import {
  CharacterCombatAnimator,
  COMBAT_ANIMATION_PROFILES,
  type CombatAction,
} from '../src/world/CharacterCombatAnimator'
import { applyCharacterMountedPose, buildCharacterVisual, polishWeaponMaterials, setRigRotation } from '../src/world/CharacterVisuals'
import { WeaponMeshFactory } from '../src/world/WeaponMeshFactory'
import { ThirdPersonCamera } from '../src/camera/ThirdPersonCamera'
import { ArrowProjectile } from '../src/world/ArrowProjectile'
import { CharacterBowVisual } from '../src/world/CharacterBowVisual'
import type { DummyEnemy } from '../src/world/DummyEnemy'
import { getTerrainHeight } from '../src/world/Terrain'
import { Faction } from '../src/world/NPC'
import {
  positionArrowCenterFromNock,
  sampleBowBodyLocal,
  Player,
} from '../src/player/Player'
import type { PlayerInput } from '../src/player/PlayerInput'
import { proceduralMaterial, proceduralMaterialCacheSize } from '../src/world/ProceduralMaterials'
import {
  createHumanoidRigAdapter,
  createProjectAnimationClips,
  createVikingHornAccessory,
  validateHumanoidManifest,
  type HumanoidAssetManifest,
} from '../src/world/HumanoidAssetRegistry'
import type { HumanoidAnimationController } from '../src/world/CharacterVisuals'
import {
  horseLocomotionClipForSpeed,
  horseVariantForStableKey,
  horseVariantFromSave,
  validateHorseManifest,
  type HorseAssetManifest,
} from '../src/world/HorseAssetRegistry'
import { DEFAULT_MOUNT_TYPE, MountType, mountTypeFromSave } from '../src/world/Mount'
import { DEFAULT_SAVE, SaveManager } from '../src/save/SaveManager'
import horseRuntimeManifest from '../public/models/mounts/v1/horse/manifest.json'

function arm(side: -1 | 1): ArmRig {
  const shoulder = new THREE.Group()
  shoulder.position.set(side * 0.49, 0.35, 0)
  const elbow = new THREE.Group()
  elbow.position.set(0, -0.38, 0)
  const wrist = new THREE.Group()
  wrist.position.set(0, -0.35, 0)
  const handSocket = new THREE.Group()
  handSocket.position.set(0, -0.18, 0)
  shoulder.add(elbow)
  elbow.add(wrist)
  wrist.add(handSocket)
  return { shoulder, elbow, wrist, handSocket }
}

function leg(side: -1 | 1, forwardBendSign: -1 | 1 = -1): LegRig {
  const hip = new THREE.Group()
  const knee = new THREE.Group()
  knee.position.y = -0.4
  const ankle = new THREE.Group()
  ankle.position.y = -0.4
  const foot = new THREE.Mesh(new THREE.BoxGeometry())
  hip.add(knee)
  knee.add(ankle)
  ankle.add(foot)
  return { hip, knee, ankle, foot, side, forwardBendSign }
}

function characterRig(): CharacterRig {
  return { right: arm(1), left: arm(-1), rightLeg: leg(1), leftLeg: leg(-1) }
}

function animator(): CharacterCombatAnimator {
  const rig = characterRig()
  return new CharacterCombatAnimator(rig, new THREE.Group(), new THREE.Group())
}

describe('Viking head accessory', () => {
  it('keeps the detachable fantasy horns inside the 0.44 m span', () => {
    const horns = createVikingHornAccessory()
    const bounds = new THREE.Box3().setFromObject(horns)
    expect(bounds.max.x - bounds.min.x).toBeLessThanOrEqual(0.44)
    expect(horns.children).toHaveLength(2)
  })
})

function rigAndAnimator(): { rig: CharacterRig, subject: CharacterCombatAnimator, melee: THREE.Group, grip: THREE.Group } {
  const rig = characterRig()
  const melee = new THREE.Group()
  const grip = new THREE.Group()
  grip.rotation.set(0, 0, Math.PI)
  melee.add(grip)
  rig.right.handSocket.add(melee)
  return { rig, melee, grip, subject: new CharacterCombatAnimator(rig, melee, new THREE.Group()) }
}

const meleeActions: CombatAction[] = [
  'daggerSlash',
  'swordSlash',
  'greatswordSlash',
  'lanceThrust',
  'mountedLance',
]

describe('CharacterCombatAnimator timeline events', () => {
  for (const action of meleeActions) {
    it(`${action} emits one hit event and completes`, () => {
      const subject = animator()
      expect(subject.start(action as Exclude<CombatAction, 'idle' | 'bowAim'>)).toBe(true)

      let hits = 0
      let completions = 0
      for (let i = 0; i < 120; i++) {
        const events = subject.update(1 / 120)
        if (events.hitActiveStarted) hits++
        if (events.actionCompleted) completions++
      }

      expect(hits).toBe(1)
      expect(completions).toBe(1)
      expect(subject.currentAction).toBe('idle')
    })
  }

  it('does not miss events when dt crosses an entire action', () => {
    const subject = animator()
    subject.start('daggerSlash')
    const events = subject.update(1)
    expect(events.hitActiveStarted).toBe(true)
    expect(events.actionCompleted).toBe(true)
  })

  it('bow release emits one projectile event before completion', () => {
    const subject = animator()
    subject.poseBow(1, 1)
    expect(subject.start('bowRelease')).toBe(true)

    let releases = 0
    let completions = 0
    const profile = COMBAT_ANIMATION_PROFILES.bowRelease
    const total = profile.windup + profile.active + profile.recovery
    for (let elapsed = 0; elapsed < total + 0.1; elapsed += 0.01) {
      const events = subject.update(0.01)
      if (events.projectileRelease) releases++
      if (events.actionCompleted) completions++
    }

    expect(releases).toBe(1)
    expect(completions).toBe(1)
  })

  it('rejects a second action during windup and recovery', () => {
    const subject = animator()
    expect(subject.start('greatswordSlash')).toBe(true)
    expect(subject.start('swordSlash')).toBe(false)
    subject.update(0.5)
    expect(subject.start('daggerSlash')).toBe(false)
  })

  for (const action of meleeActions) {
    it(`moves the weapon hand during ${action}`, () => {
      const { rig, subject } = rigAndAnimator()
      const idle = new THREE.Vector3()
      const windup = new THREE.Vector3()
      rig.right.handSocket.getWorldPosition(idle)
      subject.start(action as Exclude<CombatAction, 'idle' | 'bowAim'>)
      subject.update(COMBAT_ANIMATION_PROFILES[action].windup * 0.8)
      rig.right.handSocket.getWorldPosition(windup)
      expect(windup.distanceTo(idle)).toBeGreaterThan(0.15)
    })
  }

  it('keeps the full bow draw outside the torso and couches a mounted lance forward', () => {
    const { rig, subject, melee, grip } = rigAndAnimator()
    subject.poseBow(1, 1)
    const bowHand = new THREE.Vector3()
    const stringHand = new THREE.Vector3()
    rig.left.handSocket.getWorldPosition(bowHand)
    rig.right.handSocket.getWorldPosition(stringHand)
    expect(bowHand.z).toBeLessThan(-0.45)
    expect(bowHand.x).toBeLessThan(-0.45)
    expect(stringHand.x).toBeLessThan(0)
    expect(stringHand.y).toBeGreaterThan(0.6)
    expect(stringHand.z).toBeGreaterThan(bowHand.z + 0.45)
    expect(stringHand.distanceTo(bowHand)).toBeGreaterThan(0.65)

    subject.poseIdle()
    grip.rotation.set(0, 0, Math.PI)
    subject.poseMountedLanceReady()
    expect(melee.rotation.x).toBeCloseTo(0)
    expect(melee.rotation.y).toBeCloseTo(0)
    expect(melee.rotation.z).toBeCloseTo(0)
    subject.update(0.5)
    expect(melee.rotation.x).toBeCloseTo(0)
    expect(melee.rotation.y).toBeCloseTo(0)
    expect(melee.rotation.z).toBeCloseTo(0)

    const lanceDirection = new THREE.Vector3(0, 1, 0)
    grip.localToWorld(lanceDirection)
    const lanceOrigin = new THREE.Vector3()
    grip.getWorldPosition(lanceOrigin)
    lanceDirection.sub(lanceOrigin).normalize()
    expect(lanceDirection.z).toBeLessThan(-0.85)
  })

  it('points the sword blade forward at the thrust contact frame', () => {
    const { subject, grip } = rigAndAnimator()
    const profile = COMBAT_ANIMATION_PROFILES.swordSlash
    subject.start('swordSlash')
    const events = subject.update(profile.windup + profile.active * 0.8 + 0.0001)
    const bladeDirection = new THREE.Vector3(0, 1, 0)
    grip.localToWorld(bladeDirection)
    const bladeOrigin = new THREE.Vector3()
    grip.getWorldPosition(bladeOrigin)
    bladeDirection.sub(bladeOrigin).normalize()
    expect(events.hitActiveStarted).toBe(true)
    expect(bladeDirection.z).toBeLessThan(-0.4)
  })

  it('keeps an idle sword above the ground plane with the blade pointing upward', () => {
    const { subject, grip } = rigAndAnimator()
    subject.poseIdle()
    const tip = new THREE.Vector3(0, 1.58, 0)
    grip.localToWorld(tip)
    const gripOrigin = new THREE.Vector3()
    grip.getWorldPosition(gripOrigin)
    const bladeDirection = tip.clone().sub(gripOrigin).normalize()
    expect(tip.y + 0.95).toBeGreaterThan(0)
    expect(bladeDirection.y).toBeGreaterThan(0.9)
  })

  for (const [action, minimumReach] of [
    ['daggerSlash', 0.2],
    ['swordSlash', 0.3],
    ['greatswordSlash', 0.35],
  ] as const) {
    it(`drives the weapon tip forward with little drift during ${action}`, () => {
      const { subject, grip } = rigAndAnimator()
      const profile = COMBAT_ANIMATION_PROFILES[action]
      subject.start(action)
      subject.update(profile.windup)
      const readyTip = new THREE.Vector3(0, 1.58, 0)
      grip.localToWorld(readyTip)
      subject.update(profile.active * 0.98)
      const strikeTip = new THREE.Vector3(0, 1.58, 0)
      grip.localToWorld(strikeTip)
      expect(strikeTip.z).toBeLessThan(readyTip.z - minimumReach)
      expect(Math.abs(strikeTip.x - readyTip.x)).toBeLessThan(0.35)
      expect(Math.abs(strikeTip.y - readyTip.y)).toBeLessThan(0.35)
    })
  }

  it('retracts the sword along the thrust line before returning upright', () => {
    const { subject, grip } = rigAndAnimator()
    const profile = COMBAT_ANIMATION_PROFILES.swordSlash
    subject.start('swordSlash')
    subject.update(profile.windup + profile.active)
    const strikeTip = new THREE.Vector3(0, 1.58, 0)
    grip.localToWorld(strikeTip)

    subject.update(profile.recovery * 0.5)
    const retractedTip = new THREE.Vector3(0, 1.58, 0)
    grip.localToWorld(retractedTip)

    subject.update(profile.recovery * 0.49)
    const returnTip = new THREE.Vector3(0, 1.58, 0)
    grip.localToWorld(returnTip)

    expect(retractedTip.z).toBeGreaterThan(strikeTip.z + 0.35)
    expect(Math.abs(retractedTip.x - strikeTip.x)).toBeLessThan(0.35)
    expect(Math.abs(retractedTip.y - strikeTip.y)).toBeLessThan(0.35)
    expect(returnTip.y).toBeGreaterThan(retractedTip.y)
  })

  it('moves a mounted lance tip forward along its shaft during active thrust', () => {
    const { subject, grip } = rigAndAnimator()
    grip.rotation.set(0, 0, Math.PI)
    subject.poseLanceReady(true)
    const readyTip = new THREE.Vector3(0, 2.6, 0)
    grip.localToWorld(readyTip)
    subject.start('mountedLance')
    const profile = COMBAT_ANIMATION_PROFILES.mountedLance
    subject.update(profile.windup + profile.active * 0.9)
    const thrustTip = new THREE.Vector3(0, 2.6, 0)
    grip.localToWorld(thrustTip)
    expect(thrustTip.z).toBeLessThan(readyTip.z - 0.15)
  })

  it('keeps the shield rear grip at the raised forward hand', () => {
    const rig = characterRig()
    const melee = new THREE.Group()
    const bow = new THREE.Group()
    rig.right.handSocket.add(melee)
    rig.left.handSocket.add(bow)
    const animator = new CharacterCombatAnimator(rig, melee, bow)
    animator.setShieldGuard(true)
    animator.poseIdle()
    const shield = new THREE.Group()
    rig.left.handSocket.add(shield)
    shield.position.set(0, 0.124, 0.019)
    shield.rotation.set(-1.42, Math.PI, -0.12)
    const hand = new THREE.Vector3()
    const centre = new THREE.Vector3()
    const rearSurface = new THREE.Vector3(0, 0, 0.125)
    rig.left.handSocket.getWorldPosition(hand)
    shield.localToWorld(rearSurface)
    shield.localToWorld(centre.set(0, 0, 0.15))
    const face = new THREE.Vector3(0, 0, 1)
    shield.localToWorld(face)
    face.sub(centre).normalize()
    expect(hand.distanceTo(rearSurface)).toBeLessThan(0.08)
    expect(hand.z).toBeLessThan(-0.55)
    expect(hand.y).toBeGreaterThan(0.05)
    expect(face.z).toBeLessThan(-0.95)
  })

  it('gives player and NPC boots an unmistakable forward toe', () => {
    for (const isPlayer of [true, false]) {
      const root = new THREE.Group()
      buildCharacterVisual(root, { faction: 'viking', tier: 2, isPlayer })
      const boots = [root.getObjectByName('left-boot'), root.getObjectByName('right-boot')]
      for (const boot of boots) {
        expect(boot).toBeDefined()
        expect(boot!.position.z).toBeLessThan(-0.1)
        const geometry = (boot as THREE.Mesh).geometry as THREE.BoxGeometry
        geometry.computeBoundingBox()
        expect(geometry.boundingBox!.min.z + boot!.position.z).toBeLessThan(-0.3)
        expect(geometry.boundingBox!.max.z + boot!.position.z).toBeLessThan(0.11)
      }
    }
  })

  it('places the player boot soles on terrain without lowering the collision root', () => {
    const player = new Player(new THREE.Scene())
    const visual = (player as unknown as { characterVisualGroup: THREE.Group }).characterVisualGroup
    const boot = visual.getObjectByName('left-boot') as THREE.Mesh<THREE.BoxGeometry>
    boot.geometry.computeBoundingBox()
    player.group.updateWorldMatrix(true, true)
    const sole = boot.localToWorld(new THREE.Vector3(0, boot.geometry.boundingBox!.min.y, 0))
    expect(sole.y).toBeCloseTo(getTerrainHeight(player.position.x, player.position.z), 5)
  })
})

describe('Phase 21 procedural presentation', () => {
  it('adds articulated legs and applies species-specific mounted poses', () => {
    const root = new THREE.Group()
    const visual = buildCharacterVisual(root, { faction: 'viking', tier: 2, isPlayer: true })
    expect(visual.rig.leftLeg.hip.parent).toBe(root)
    expect(visual.rig.rightLeg.knee.parent).toBe(visual.rig.rightLeg.hip)

    applyCharacterMountedPose(visual.rig, true, 'CORGI')
    expect(visual.rig.leftLeg.hip.rotation.z).toBeLessThan(-0.3)
    expect(visual.rig.rightLeg.hip.rotation.z).toBeGreaterThan(0.3)
    expect(visual.rig.leftLeg.knee.rotation.x).toBeLessThan(-1.2)

    applyCharacterMountedPose(visual.rig, false)
    expect(visual.rig.leftLeg.hip.rotation.x).toBe(0)
    expect(visual.rig.leftLeg.hip.rotation.z).toBe(0)
    expect(visual.rig.rightLeg.knee.rotation.x).toBe(0)
  })

  it('reuses cached procedural PBR materials', () => {
    const before = proceduralMaterialCacheSize()
    const first = proceduralMaterial({ kind: 'leather', color: 0x49301f, roughness: 0.82 })
    const afterFirst = proceduralMaterialCacheSize()
    const second = proceduralMaterial({ kind: 'leather', color: 0x49301f, roughness: 0.82 })
    expect(second).toBe(first)
    expect(afterFirst).toBeGreaterThanOrEqual(before)
    expect(proceduralMaterialCacheSize()).toBe(afterFirst)
    expect(first.map).toBeTruthy()
    expect(first.roughnessMap).toBeTruthy()
    expect(first.bumpMap).toBeTruthy()
  })

  it('builds profiled Tier-2 blades and curved shields', () => {
    const sword = new THREE.Group()
    const swordTip = WeaponMeshFactory.buildMelee('steel_sword', sword).tipLocal
    expect(sword.getObjectByName('steel-sword-profiled-blade')).toBeDefined()
    expect(swordTip.y).toBeGreaterThan(1.45)

    const gladius = new THREE.Group()
    const gladiusTip = WeaponMeshFactory.buildNpcMelee(Faction.ENEMY, 2, false, gladius)
    expect(gladius.getObjectByName('roman-gladius-profiled-blade')).toBeDefined()
    expect(gladiusTip.y).toBeGreaterThan(0.8)

    const scutum = new THREE.Group()
    WeaponMeshFactory.buildShield('scutum_t2', scutum)
    const board = scutum.getObjectByName('curved-scutum-board') as THREE.Mesh
    board.geometry.computeBoundingBox()
    expect(board.geometry.boundingBox!.max.z - board.geometry.boundingBox!.min.z).toBeGreaterThan(0.14)
    expect(scutum.getObjectByName('shield-boss')).toBeDefined()

    const round = new THREE.Group()
    WeaponMeshFactory.buildShield('round_shield_t2', round)
    expect(round.getObjectByName('round-shield-board')).toBeDefined()
    expect(round.getObjectByName('shield-rear-strap')).toBeDefined()
  })

})

describe('Phase 22 humanoid asset contract', () => {
  const readyManifest = (faction: 'viking' | 'roman'): HumanoidAssetManifest => ({
    schemaVersion: 1,
    id: `${faction}-tier2-v2`,
    status: 'ready',
    attribution: 'CC BY 4.0 test asset',
    files: { lod0: 'lod0.glb', lod1: 'lod1.glb', lod2: 'lod2.glb' },
    metrics: {
      heightM: faction === 'viking' ? 1.86 : 1.78,
      shoulderWidthM: faction === 'viking' ? 0.54 : 0.46,
      neckLengthM: 0.09,
      triangles: { lod0: 60000, lod1: 20000, lod2: 6000 },
      textures: { lod0: 2048, lod1: 1024, lod2: 512 },
    },
  })

  it('accepts measured faction proportions and rejects runtime scale fixes', () => {
    expect(() => validateHumanoidManifest('viking', readyManifest('viking'))).not.toThrow()
    expect(() => validateHumanoidManifest('roman', readyManifest('roman'))).not.toThrow()
    const invalid = readyManifest('viking')
    invalid.metrics = { ...invalid.metrics!, heightM: 1.68 }
    expect(() => validateHumanoidManifest('viking', invalid)).toThrow(/height/)
  })

  it('rejects blocked manifests before any GLB is loaded', () => {
    const blocked: HumanoidAssetManifest = {
      ...readyManifest('roman'),
      status: 'blocked',
      blocker: { code: 'AUTH', message: 'download requires authentication' },
      files: null,
      metrics: null,
    }
    expect(() => validateHumanoidManifest('roman', blocked)).toThrow(/authentication/)
  })

  it('maps the common skeleton and creates missing project sockets', () => {
    const root = new THREE.Group()
    for (const name of [
      'hips', 'spine', 'chest', 'neck', 'head',
      'upperarm.l', 'lowerarm.l', 'hand.l', 'upperarm.r', 'lowerarm.r', 'hand.r',
      'upperleg.l', 'lowerleg.l', 'foot.l', 'toes.l',
      'upperleg.r', 'lowerleg.r', 'foot.r', 'toes.r',
    ]) {
      const bone = new THREE.Bone()
      bone.name = name
      root.add(bone)
    }
    const animation: HumanoidAnimationController = {
      play: vi.fn(),
      update: vi.fn(),
      stop: vi.fn(),
    }
    const rig = createHumanoidRigAdapter(root, animation)
    expect(rig.right.handSocket.name).toBe('socket_hand_r')
    expect(rig.left.handSocket.parent?.name).toBe('hand.l')
    expect(rig.pelvis?.parent?.name).toBe('hips')
    expect(rig.leftFootSocket?.parent?.name).toBe('foot.l')
    expect(rig.leftLeg.forwardBendSign).toBe(1)
    expect(rig.rightLeg.forwardBendSign).toBe(1)
  })

  it('keeps combat timing while requesting mixer cross-fades', () => {
    const rig = characterRig()
    const play = vi.fn()
    const update = vi.fn()
    rig.animation = { play, update, stop: vi.fn() }
    const subject = new CharacterCombatAnimator(rig, new THREE.Group(), new THREE.Group())
    subject.start('swordSlash')
    const profile = COMBAT_ANIMATION_PROFILES.swordSlash
    const events = subject.update(profile.windup + profile.active * 0.8 + 0.001)
    expect(play).toHaveBeenCalledWith('swordSlash', 0.1, false)
    expect(update).toHaveBeenCalled()
    expect(events.hitActiveStarted).toBe(true)
  })

  it('selects walk, run and mounted mixer states without changing combat actions', () => {
    const rig = characterRig()
    const play = vi.fn()
    rig.animation = { play, update: vi.fn(), stop: vi.fn() }
    const subject = new CharacterCombatAnimator(rig, new THREE.Group(), new THREE.Group())
    play.mockClear()
    subject.setLocomotion(4, false)
    subject.setLocomotion(12, false)
    subject.setLocomotion(0, true)
    expect(play).toHaveBeenNthCalledWith(1, 'walk', 0.14, true)
    expect(play).toHaveBeenNthCalledWith(2, 'run', 0.14, true)
    expect(play).toHaveBeenNthCalledWith(3, 'mounted', 0.14, true)
    expect(subject.currentAction).toBe('idle')
  })

  it('applies imported-bone pose deltas on top of the recorded bind rotation', () => {
    const bone = new THREE.Bone()
    bone.rotation.set(0.1, 0.2, 0.3)
    bone.userData.humanoidRestQuaternion = bone.quaternion.toArray()
    const rest = bone.quaternion.clone()
    const delta = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 0, 0))
    setRigRotation(bone, 0.4, 0, 0)
    expect(bone.quaternion.angleTo(rest.clone().multiply(delta))).toBeLessThan(0.000001)
  })
})

describe('Phase 23 horse asset contract', () => {
  const readyManifest = (): HorseAssetManifest => ({
    schemaVersion: 2,
    id: 'realistic-warhorse-v2',
    status: 'ready',
    attribution: 'Tarnyloo CC BY 3.0; fdoss001; Quaternius CC0',
    sources: [{
      author: 'Tarnyloo',
      url: 'https://blendswap.com/blend/17172',
      license: 'CC BY 3.0',
      sha256: '3372b6dea03939798cf2c4c7fa4a63a43933d4760b9b283e9e28e66fd5fe5f31',
    }],
    file: 'horse_runtime.glb',
    basisPath: 'basis/',
    lodNodes: {
      lod0: 'horse_lod0',
      lod1: 'horse_lod1',
      lod2: 'horse_lod2',
    },
    bodyMeshNames: ['horse_body_lod0', 'horse_body_lod1', 'horse_body_lod2'],
    sharedBodyMaps: {
      normal: 'textures/horse_body_normal.ktx2',
      roughness: 'textures/horse_body_roughness.ktx2',
      ao: 'textures/horse_body_ao.ktx2',
    },
    variants: [
      { id: 'paint_01', label: 'Paint 01', baseColor: 'textures/paint_01_basecolor.ktx2' },
      { id: 'paint_02', label: 'Paint 02', baseColor: 'textures/paint_02_basecolor.ktx2' },
      { id: 'paint_03', label: 'Paint 03', baseColor: 'textures/paint_03_basecolor.ktx2' },
    ],
    compression: {
      geometry: 'EXT_meshopt_compression',
      textures: 'KHR_texture_basisu',
    },
    metrics: {
      shoulderHeightM: 1.65,
      overallHeightM: 2.15,
      saddleHeightM: 1.72,
      widthM: 0.7,
      lengthM: 2.67,
      packageBytes: 20 * 1024 * 1024,
      triangles: { lod0: 64000, lod1: 21000, lod2: 6500 },
      textureMaxSize: 2048,
    },
    forward: '+Z',
    clips: ['idle', 'walk', 'trot', 'canter', 'gallop', 'jump', 'land', 'hit', 'death'],
    sockets: ['socket_saddle_seat', 'socket_stirrup_l', 'socket_stirrup_r', 'socket_camera'],
  })

  it('validates horse proportions, LOD budgets, clips and sockets', () => {
    expect(() => validateHorseManifest(readyManifest())).not.toThrow()
    const oversized = readyManifest()
    oversized.metrics = {
      ...oversized.metrics!,
      triangles: { ...oversized.metrics!.triangles, lod2: 7001 },
    }
    expect(() => validateHorseManifest(oversized)).toThrow(/LOD2/)
    const missingDeath = readyManifest()
    missingDeath.clips = missingDeath.clips.filter((clip) => clip !== 'death')
    expect(() => validateHorseManifest(missingDeath)).toThrow(/death/)
    const tooLarge = readyManifest()
    tooLarge.metrics = { ...tooLarge.metrics!, packageBytes: 30 * 1024 * 1024 + 1 }
    expect(() => validateHorseManifest(tooLarge)).toThrow(/30 MB/)
  })

  it('ships a runtime manifest that passes the same preload gate', () => {
    expect(() => validateHorseManifest(horseRuntimeManifest as unknown as HorseAssetManifest)).not.toThrow()
  })

  it('uses deterministic gait thresholds and a horse for every new spawn', () => {
    expect(horseLocomotionClipForSpeed(0)).toBe('idle')
    expect(horseLocomotionClipForSpeed(0.25)).toBe('walk')
    expect(horseLocomotionClipForSpeed(3.5)).toBe('trot')
    expect(horseLocomotionClipForSpeed(7)).toBe('canter')
    expect(horseLocomotionClipForSpeed(10.5)).toBe('gallop')
    expect(horseLocomotionClipForSpeed(Number.NaN)).toBe('idle')
    expect(DEFAULT_MOUNT_TYPE).toBe(MountType.HORSE)
  })

  it('assigns three reproducible horse coats from stable keys', () => {
    const keys = Array.from({ length: 30 }, (_, index) => `npc:horse:${index}`)
    const firstPass = keys.map(horseVariantForStableKey)
    expect(keys.map(horseVariantForStableKey)).toEqual(firstPass)
    expect(new Set(firstPass)).toEqual(new Set([0, 1, 2]))
    const worldKeys = [[10, -5], [-15, 20], [15, 15], [-20, -10]]
      .map(([x, z], index) => `world:${index}:${x}:${z}`)
    expect(new Set(worldKeys.map(horseVariantForStableKey))).toEqual(new Set([0, 1, 2]))
    expect(horseVariantFromSave(0)).toBe(0)
    expect(horseVariantFromSave(2)).toBe(2)
    expect(horseVariantFromSave(9)).toBe(0)
    expect(horseVariantFromSave(undefined)).toBe(0)
  })

  it('keeps all legacy mount save IDs round-trippable without migration', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    })
    const manager = new SaveManager()
    for (const type of [MountType.BLACK_CAT, MountType.CORGI, MountType.HORSE]) {
      const appearanceVariant = type === MountType.HORSE ? 2 as const : undefined
      expect(manager.save({ ...DEFAULT_SAVE, mountData: { isMounted: true, type, appearanceVariant } })).toBe(true)
      const loaded = manager.load()
      expect(loaded.mountData?.type).toBe(type)
      expect(mountTypeFromSave(loaded.mountData!.type)).toBe(type)
      expect(loaded.mountData?.appearanceVariant).toBe(appearanceVariant)
    }
    expect(mountTypeFromSave('UNKNOWN')).toBe(MountType.HORSE)
    vi.unstubAllGlobals()
  })

  it('applies a distinct finite horse riding pose', () => {
    const rig = characterRig()
    applyCharacterMountedPose(rig, true, 'HORSE')
    for (const mountLeg of [rig.leftLeg, rig.rightLeg]) {
      expect(mountLeg.hip.rotation.x).toBeCloseTo(0.68)
      expect(Math.abs(mountLeg.hip.rotation.z)).toBeCloseTo(0.25)
      expect(mountLeg.knee.rotation.x).toBeCloseTo(-1.22)
      expect(mountLeg.ankle.rotation.x).toBeCloseTo(0.44)
    }
  })

  it('bends imported rider knees forward while preserving the legacy procedural convention', () => {
    const importedRig = characterRig()
    importedRig.leftLeg.forwardBendSign = 1
    importedRig.rightLeg.forwardBendSign = 1
    applyCharacterMountedPose(importedRig, true, 'HORSE')

    const importedKnee = new THREE.Vector3()
    const importedAnkle = new THREE.Vector3()
    importedRig.leftLeg.knee.getWorldPosition(importedKnee)
    importedRig.leftLeg.ankle.getWorldPosition(importedAnkle)
    expect(importedRig.leftLeg.hip.rotation.x).toBeCloseTo(-0.68)
    expect(importedRig.leftLeg.knee.rotation.x).toBeCloseTo(1.22)
    expect(importedKnee.z).toBeGreaterThan(0)
    expect(importedAnkle.y).toBeLessThan(importedKnee.y)

    const proceduralRig = characterRig()
    applyCharacterMountedPose(proceduralRig, true, 'HORSE')
    expect(proceduralRig.leftLeg.knee.rotation.x).toBeCloseTo(-1.22)
  })

  it('restores imported rider legs to their bind pose after dismounting', () => {
    const importedRig = characterRig()
    for (const mountLeg of [importedRig.leftLeg, importedRig.rightLeg]) {
      mountLeg.forwardBendSign = 1
      for (const joint of [mountLeg.hip, mountLeg.knee, mountLeg.ankle]) {
        joint.rotation.set(0.08, -0.04, 0.02)
        joint.userData.humanoidRestQuaternion = joint.quaternion.toArray()
      }
    }

    applyCharacterMountedPose(importedRig, true, 'HORSE')
    applyCharacterMountedPose(importedRig, false)
    for (const mountLeg of [importedRig.leftLeg, importedRig.rightLeg]) {
      for (const joint of [mountLeg.hip, mountLeg.knee, mountLeg.ankle]) {
        expect(joint.quaternion.angleTo(new THREE.Quaternion().fromArray(joint.userData.humanoidRestQuaternion))).toBeLessThan(0.000001)
      }
    }
  })

  it('keeps the mounted mixer clip neutral so the riding pose is not applied twice', () => {
    const mounted = createProjectAnimationClips().find((clip) => clip.name === 'Mounted')
    expect(mounted).toBeDefined()
    expect(mounted!.tracks).toHaveLength(0)
  })
})

describe('combat presentation regressions', () => {
  it('builds readable player-sized bows without scaling the arrow socket', () => {
    for (const [weaponId, minimumSpan] of [
      ['wooden_shortbow', 1.45],
      ['recurve_longbow', 1.95],
      ['elven_runebow', 2.35],
    ] as const) {
      const socket = new THREE.Group()
      const { topTip, botTip } = WeaponMeshFactory.buildRanged(weaponId, socket)
      const bowModel = socket.getObjectByName('bow-model')
      expect(topTip.y - botTip.y).toBeGreaterThan(minimumSpan)
      expect(bowModel?.scale.x).toBeCloseTo(1.22)
      expect(bowModel?.scale.z).toBeCloseTo(-1.22)
      expect(socket.scale.x).toBe(1)
    }
  })

  it('keeps the arrow tail on the centre nock when positioning its shaft', () => {
    const nock = new THREE.Vector3(-0.5, 1.4, -0.8)
    const direction = new THREE.Vector3(0.2, 0.1, -1).normalize()
    const centre = positionArrowCenterFromNock(new THREE.Vector3(), nock, direction)
    const reconstructedTail = centre.clone().addScaledVector(direction, -0.45)
    expect(reconstructedTail.distanceTo(nock)).toBeLessThan(0.000001)
    expect(centre.clone().sub(nock).normalize().dot(direction)).toBeGreaterThan(0.999)
  })

  it('uses one bow visual controller for nocking, aiming, and projectile launch', () => {
    const actionPivot = new THREE.Group()
    const gripPivot = new THREE.Group()
    actionPivot.add(gripPivot)
    const bow = new CharacterBowVisual(actionPivot, gripPivot)
    bow.rebuild('recurve_longbow')
    const target = new THREE.Vector3(2, 1.4, -20)
    bow.update(1, target, true)

    const grip = bow.getGripPosition(new THREE.Vector3())
    const nock = bow.getNockPosition(new THREE.Vector3())
    const origin = new THREE.Vector3()
    const direction = new THREE.Vector3()
    bow.writeLaunch(origin, direction, target)
    expect(nock.z).toBeGreaterThan(grip.z + 0.5)
    expect(origin.distanceTo(nock)).toBeCloseTo(0.45)
    expect(direction.dot(target.clone().sub(nock).normalize())).toBeGreaterThan(0.999)
  })

  it('samples the complete bow body from lower tip through grip to upper tip', () => {
    const bottom = new THREE.Vector3(0, -1, -0.05)
    const top = new THREE.Vector3(0, 1, -0.05)
    const point = new THREE.Vector3()
    expect(sampleBowBodyLocal(point, bottom, top, 0)).toEqual(bottom)
    expect(sampleBowBodyLocal(point, bottom, top, 0.5)).toEqual(new THREE.Vector3())
    expect(sampleBowBodyLocal(point, bottom, top, 1)).toEqual(top)
    expect(sampleBowBodyLocal(point, bottom, top, 0.25).z).toBeLessThan(0)
  })

  it('holds the player bow vertically with its upper tip near forehead height', () => {
    const player = new Player(new THREE.Scene())
    const subject = player as unknown as {
      aiming: boolean
      animator: CharacterCombatAnimator
      _updateBowPose(maxChargeTime: number, aimPoint: THREE.Vector3): void
    }
    subject.aiming = true
    subject.animator.poseBow(1, 1)
    subject._updateBowPose(1.2, new THREE.Vector3(0, 1, -30))

    const top = player.getBowTopTipPosition(new THREE.Vector3())
    const bottom = player.getBowBottomTipPosition(new THREE.Vector3())
    const relativeTopY = top.y - player.position.y
    expect(top.y - bottom.y).toBeGreaterThan(1.9)
    expect(relativeTopY).toBeGreaterThan(0.85)
    expect(relativeTopY).toBeLessThan(1.35)
  })

  it('sets the raycaster camera before recursively aiming through sprites', () => {
    const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 100)
    camera.position.set(0, 1, 5)
    camera.lookAt(0, 1, 0)
    camera.updateMatrixWorld()
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial())
    sprite.position.set(0, 1, 0)
    sprite.updateMatrixWorld()
    const raycaster = new THREE.Raycaster()
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera)
    raycaster.intersectObject(sprite)
    expect(raycaster.camera).toBe(camera)
    expect(error).not.toHaveBeenCalled()
    error.mockRestore()
  })

  it('aligns the arrowhead local -Z axis with physical velocity', () => {
    const scene = new THREE.Scene()
    const direction = new THREE.Vector3(0.4, 0.2, -0.8).normalize()
    const arrow = new ArrowProjectile(scene, new THREE.Vector3(), direction, 20, 10, Faction.PLAYER, true)
    const visualForward = new THREE.Vector3(0, 0, -1).applyQuaternion(arrow.mesh.quaternion)
    expect(visualForward.dot(direction)).toBeGreaterThan(0.999)
    const tracedTip = arrow.getTipPosition(new THREE.Vector3())
    const tracedDirection = tracedTip.sub(arrow.mesh.position).normalize()
    expect(tracedDirection.dot(direction)).toBeGreaterThan(0.999)
  })

  it('renders Roman ranged projectiles as long pilums', () => {
    const scene = new THREE.Scene()
    const direction = new THREE.Vector3(0, 0.1, -1).normalize()
    const pilum = new ArrowProjectile(
      scene,
      new THREE.Vector3(),
      direction,
      15,
      20,
      Faction.ENEMY,
      false,
      'pilum',
    )
    expect(pilum.mesh.name).toBe('pilum-projectile')
    expect(pilum.mesh.children.length).toBeGreaterThanOrEqual(4)
    expect(pilum.getTipPosition(new THREE.Vector3()).length()).toBeGreaterThan(1.2)
  })

  it('reuses immutable projectile geometry instead of growing renderer memory', () => {
    const scene = new THREE.Scene()
    const direction = new THREE.Vector3(0, 0, -1)
    const firstArrow = new ArrowProjectile(scene, new THREE.Vector3(), direction, 20, 10, Faction.PLAYER)
    const secondArrow = new ArrowProjectile(scene, new THREE.Vector3(), direction, 20, 10, Faction.PLAYER)
    const firstPilum = new ArrowProjectile(scene, new THREE.Vector3(), direction, 20, 10, Faction.ENEMY, false, 'pilum')
    const secondPilum = new ArrowProjectile(scene, new THREE.Vector3(), direction, 20, 10, Faction.ENEMY, false, 'pilum')
    expect((firstArrow.mesh.children[0] as THREE.Mesh).geometry).toBe((secondArrow.mesh.children[0] as THREE.Mesh).geometry)
    expect((firstPilum.mesh.children[0] as THREE.Mesh).geometry).toBe((secondPilum.mesh.children[0] as THREE.Mesh).geometry)
  })

  it('does not swallow arrows fired above terrain in a below-zero valley', () => {
    const scene = new THREE.Scene()
    const x = -34
    const z = 15
    const origin = new THREE.Vector3(x, getTerrainHeight(x, z) + 1.2, z)
    expect(origin.y).toBeLessThan(0.05)
    const arrow = new ArrowProjectile(scene, origin, new THREE.Vector3(0, 0, -1), 20, 10, Faction.PLAYER, true)
    const dummy = { dead: true } as DummyEnemy
    const player = { dead: true } as Player
    for (let i = 0; i < 5; i++) {
      arrow.update(0.01, dummy, player, [], [], () => undefined)
    }
    expect(arrow.isAlive).toBe(true)
    expect(arrow.isStuck).toBe(false)
  })

  it('uses a level reticle direction at the default camera orbit', () => {
    const camera = new THREE.PerspectiveCamera()
    const player = {
      isAiming: true,
      position: new THREE.Vector3(),
    } as Player
    const input = {
      consumeMouseDelta: () => ({ dx: 0, dy: 0 }),
    } as PlayerInput
    const thirdPerson = new ThirdPersonCamera(camera, player)
    thirdPerson.update(input)
    expect(camera.position.z).toBeLessThan(player.position.z)
    const direction = thirdPerson.getAimDirection(new THREE.Vector3())
    expect(direction.y).toBeCloseTo(0)
    expect(direction.length()).toBeCloseTo(1)
    const aimPoint = thirdPerson.getAimPoint(new THREE.Vector3(), 60)
    const cameraForward = new THREE.Vector3()
    camera.getWorldDirection(cameraForward)
    expect(aimPoint.clone().sub(camera.position).normalize().dot(cameraForward)).toBeGreaterThan(0.999)
  })

  it('does not move the camera when right-click aiming begins', () => {
    const camera = new THREE.PerspectiveCamera()
    const playerState = {
      isAiming: false,
      position: new THREE.Vector3(),
    }
    const input = {
      consumeMouseDelta: () => ({ dx: 0, dy: 0 }),
    } as PlayerInput
    const thirdPerson = new ThirdPersonCamera(camera, playerState as Player)
    thirdPerson.update(input)
    const before = camera.position.clone()
    playerState.isAiming = true
    thirdPerson.update(input)
    expect(camera.position.distanceTo(before)).toBeCloseTo(0)
  })

  it('preserves upgraded weapon and shield materials for flash restoration', () => {
    const root = new THREE.Group()
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({ color: 0x884422 }),
    )
    root.add(mesh)
    polishWeaponMaterials(root)
    expect(mesh.material).toBeInstanceOf(THREE.MeshStandardMaterial)
    expect(mesh.userData.originalMat).toBe(mesh.material)
  })
})
