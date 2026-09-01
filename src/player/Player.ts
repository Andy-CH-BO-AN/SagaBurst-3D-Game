/**
 * Player.ts
 * The player character (capsule geometry).
 * Calibrated with getTerrainHeight(x, z) for procedural heightmap terrain.
 * Supports 6 distinct 3D weapon geometries for Tier 1~3 Melee and Ranged weapons.
 * Triggers SoundManager audio effects for sword swings and bow releases.
 */
import * as THREE from 'three'

import type { PlayerInput } from './PlayerInput'
import type { StaminaBar } from '../ui/StaminaBar'
import type { HpBar } from '../ui/HpBar'
import type { QuiverUI } from '../ui/QuiverUI'
import type { SoundManager } from '../audio/SoundManager'
import type { InventoryManager } from '../rpg/InventoryManager'
import type { WeaponData } from '../rpg/WeaponDatabase'
import { getTerrainHeight, ObstacleData, resolveObstacleCollision } from '../world/Terrain'
import { WeaponMeshFactory } from '../world/WeaponMeshFactory'
import { Mount } from '../world/Mount'
import { applyCharacterMountedPose, buildCharacterVisual, polishWeaponMaterials } from '../world/CharacterVisuals'
import type { CharacterRig, MountedPoseKind } from '../world/CharacterVisuals'
import { HumanoidAssetRegistry } from '../world/HumanoidAssetRegistry'
import { CharacterCombatAnimator, type CombatAction } from '../world/CharacterCombatAnimator'
import {
  CharacterBowVisual,
} from '../world/CharacterBowVisual'

export { positionArrowCenterFromNock, sampleBowBodyLocal } from '../world/CharacterBowVisual'

// ── Tuning constants ──
const MOVE_SPEED        = 8    // units/s walk
const SPRINT_MULTIPLIER = 2.0  // walk × this = sprint speed
const JUMP_VELOCITY     = 9    // units/s upward
const GRAVITY           = -22  // units/s²
const PLAYER_HALF_HEIGHT = 0.95
const PLAYER_VISUAL_GROUND_OFFSET = -0.15

const MAX_HP            = 100
const MAX_STAMINA       = 100
const STAMINA_DRAIN     = 30   // per second while sprinting
const STAMINA_REGEN     = 15   // per second when not sprinting
const STAMINA_SPRINT_MIN = 10  // must have at least this much to start sprint
const SWING_STAMINA_COST = 15  // stamina consumed per sword swing

const PLAYER_RADIUS = 0.38
const MAX_BOW_CHARGE_TIME = 1.2
export interface ArrowLaunchEvent {
  origin: THREE.Vector3
  direction: THREE.Vector3
  speed: number
  damage: number
}

export class Player {
  readonly group: THREE.Group

  private hitFlashMat: THREE.MeshBasicMaterial
  private bodyMesh!: THREE.Group
  private headMesh!: THREE.Mesh
  private headMat!: THREE.MeshStandardMaterial
  private characterVisualGroup: THREE.Group
  private externalPelvisHeight = 0
  private usesExternalForwardAdapter = false
  private rig!: CharacterRig
  private animator!: CharacterCombatAnimator
  private currentArmorTier: 1 | 2 | 3 = 2

  private flashTimer = 0

  // 3D Weapon Pivots & Models
  private swordPivot!: THREE.Group
  private swordGripPivot!: THREE.Group
  private currentMeleeId: string = ''

  private bowPivot!: THREE.Group
  private bowGripPivot!: THREE.Group
  private bowVisual!: CharacterBowVisual
  private currentRangedId: string = ''

  private shieldPivot!: THREE.Group
  private currentShieldId: string | null = null
  private shieldOnBack = false
  private readonly shieldTargetPosition = new THREE.Vector3()
  private readonly shieldTargetQuaternion = new THREE.Quaternion()
  private readonly shieldTargetEuler = new THREE.Euler()
  private readonly shieldStartPosition = new THREE.Vector3()
  private readonly shieldStartQuaternion = new THREE.Quaternion()
  private shieldTransitionElapsed = 0.15

  private velY = 0
  private onGround = false

  private currentHp = MAX_HP
  private stamina = MAX_STAMINA
  private isSprinting = false

  private isSwinging = false
  private attackHitProcessed = false
  private hitEventPending = false

  private aiming = false
  private bowChargeTime = 0
  private bowVisualDrawRatio = 0
  private nockedArrowReleased = false
  private aimBlend = 0
  private pendingBowChargeTime = 0
  private pendingArcheryMultiplier = 1
  private pendingRangedWeapon?: WeaponData
  private readonly pendingArrowTarget = new THREE.Vector3()
  private arrows = 30
  private isDead = false

  onFireArrow: ((evt: ArrowLaunchEvent) => void) | null = null
  onPlayerDeath: (() => void) | null = null

  // ── Reusable temporary vectors (P-1: avoid per-frame GC pressure) ──
  private readonly _tmpTipWorld = new THREE.Vector3()
  private readonly _tmpForward = new THREE.Vector3()
  private readonly _tmpRight = new THREE.Vector3()
  private readonly _tmpMoveDir = new THREE.Vector3()
  private readonly _tmpPreviousPosition = new THREE.Vector3()
  private readonly _tmpWorldNock = new THREE.Vector3()
  private readonly _tmpArrowDirection = new THREE.Vector3()
  private readonly _tmpPelvisWorld = new THREE.Vector3()

  public isMounted = false
  public currentMount: Mount | null = null

  get position(): THREE.Vector3 { return this.group.position }
  get staminaRatio(): number    { return this.stamina / MAX_STAMINA }
  get hpRatio(): number         { return Math.max(0, this.currentHp / MAX_HP) }

  get combatPosition(): THREE.Vector3 {
    if (this.isMounted && this.currentMount) {
      return this.currentMount.group.position.clone()
    }
    return this.group.position.clone()
  }

  get hp(): number              { return this.currentHp }
  get staminaValue(): number    { return this.stamina }
  get swinging(): boolean       { return this.isSwinging }
  get isAiming(): boolean       { return this.aiming }
  get bowDrawRatio(): number    { return this.bowVisualDrawRatio }
  get arrowCount(): number      { return this.arrows }
  get dead(): boolean           { return this.isDead }
  get combatAnimationAction(): CombatAction { return this.animator.currentAction }

  getWeaponGripPosition(target: THREE.Vector3): THREE.Vector3 {
    return this.swordGripPivot.getWorldPosition(target)
  }

  getBowGripPosition(target: THREE.Vector3): THREE.Vector3 {
    return this.bowVisual.getGripPosition(target)
  }

  getBowNockPosition(target: THREE.Vector3): THREE.Vector3 {
    return this.bowVisual.getNockPosition(target)
  }

  getBowTopTipPosition(target: THREE.Vector3): THREE.Vector3 {
    return this.bowVisual.getTopTipPosition(target)
  }

  getBowBottomTipPosition(target: THREE.Vector3): THREE.Vector3 {
    return this.bowVisual.getBottomTipPosition(target)
  }

  writeBowBodyProfile(target: Float32Array, pointCount = 9): number {
    return this.bowVisual.writeBodyProfile(target, pointCount)
  }

  getBowStringHandPosition(target: THREE.Vector3): THREE.Vector3 {
    return this.rig.right.handSocket.getWorldPosition(target)
  }

  getNockedArrowTipPosition(target: THREE.Vector3): THREE.Vector3 {
    return this.bowVisual.getArrowTipPosition(target)
  }

  setPosition(x: number, y: number, z: number): void {
    this.group.position.set(x, y, z)
  }
  setStamina(value: number): void {
    this.stamina = Math.max(0, Math.min(MAX_STAMINA, value))
  }
  setHp(value: number): void {
    this.currentHp = Math.max(0, Math.min(MAX_HP, value))
  }
  setArrowCount(count: number): void {
    this.arrows = count
  }

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group()
    this.group.name = 'player'

    this.hitFlashMat = new THREE.MeshBasicMaterial({ color: 0xff3333 })
    this.characterVisualGroup = new THREE.Group()
    // The collision capsule centre rests 0.95m above terrain while the visual
    // boot sole is authored at -0.8m. Lower only the render rig by the 0.15m
    // difference so feet touch terrain without changing physics or camera roots.
    this.characterVisualGroup.position.y = PLAYER_VISUAL_GROUND_OFFSET
    this.group.add(this.characterVisualGroup)

    this.swordPivot = new THREE.Group()
    this.swordGripPivot = new THREE.Group()
    this.swordPivot.add(this.swordGripPivot)
    this.bowPivot = new THREE.Group()
    this.bowGripPivot = new THREE.Group()
    this.bowPivot.add(this.bowGripPivot)
    this.bowVisual = new CharacterBowVisual(this.bowPivot, this.bowGripPivot)

    // Shield Pivot (defaults to leftArm after character mesh is built)
    this.shieldPivot = new THREE.Group()

    this._buildMesh(2)

    // Build default initial weapons (Steel Sword & Recurve Longbow)
    this.rebuildMeleeWeapon('steel_sword')
    this.rebuildRangedWeapon('recurve_longbow')

    scene.add(this.group)

    // Initial position calibrated with terrain height at [0, 0]
    const terrainY = getTerrainHeight(0, 0)
    this.group.position.set(0, terrainY + PLAYER_HALF_HEIGHT, 0)
  }

  private _buildMesh(tier: 1 | 2 | 3): void {
    this.currentArmorTier = tier
    this.swordPivot.removeFromParent()
    this.bowPivot.removeFromParent()
    this.shieldPivot.removeFromParent()
    this.characterVisualGroup.clear()
    this.characterVisualGroup.position.y = HumanoidAssetRegistry.ready
      ? -PLAYER_HALF_HEIGHT
      : PLAYER_VISUAL_GROUND_OFFSET
    const config = {
      faction: 'viking',
      tier,
      isPlayer: true,
    } as const
    const allowLegacyFixture = import.meta.env.MODE === 'test'
      || (import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('legacyhumanoids'))
    const parts = HumanoidAssetRegistry.ready
      ? HumanoidAssetRegistry.createCharacterVisual(this.characterVisualGroup, config)
      : allowLegacyFixture
        ? buildCharacterVisual(this.characterVisualGroup, config)
        : (() => { throw new Error('Viking humanoid assets were not preloaded') })()
    this.usesExternalForwardAdapter = HumanoidAssetRegistry.ready
    // Project humanoids are exported facing the same +Z gameplay heading used
    // by mounts and movement. Keep the render adapter unrotated; group yaw is
    // therefore the actual desired world heading.
    this.characterVisualGroup.rotation.y = 0
    this.bodyMesh = parts.bodyMesh
    this.headMesh = parts.headMesh
    this.headMat = parts.headMaterial
    this.rig = parts.rig
    this.externalPelvisHeight = 0
    if (HumanoidAssetRegistry.ready && this.rig.pelvis) {
      this.characterVisualGroup.updateWorldMatrix(true, true)
      this.rig.pelvis.getWorldPosition(this._tmpPelvisWorld)
      this.externalPelvisHeight = this.characterVisualGroup.worldToLocal(this._tmpPelvisWorld).y
    }
    this.rig.right.handSocket.add(this.swordPivot)
    this.rig.left.handSocket.add(this.bowPivot)
    this.rig.left.handSocket.add(this.shieldPivot)
    this.shieldOnBack = false
    this.shieldPivot.position.set(0, 0.124, 0.019)
    this.shieldPivot.rotation.set(-1.42, Math.PI, -0.12)
    this.shieldTargetPosition.set(0, 0.124, 0.019)
    this.shieldTargetEuler.set(-1.42, Math.PI, -0.12)
    this.shieldTargetQuaternion.setFromEuler(this.shieldTargetEuler)
    this.animator = new CharacterCombatAnimator(this.rig, this.swordPivot, this.bowPivot)
    this.isSwinging = false
    this.hitEventPending = false
  }

  // ── Dynamic 3D Melee Weapon Builders ──
  private swordTipLocal = new THREE.Vector3(0, 1.2, 0)

  rebuildMeleeWeapon(weaponId: string): void {
    if (this.currentMeleeId === weaponId) return
    this.currentMeleeId = weaponId

    // Clear existing meshes
    while (this.swordGripPivot.children.length > 0) {
      this.swordGripPivot.remove(this.swordGripPivot.children[0])
    }

    const { tipLocal } = WeaponMeshFactory.buildMelee(weaponId, this.swordGripPivot)
    this.swordTipLocal.copy(tipLocal)

    // Meshes use +Y as their long axis. The static grip correction is kept
    // separate from the action pivot animated by CharacterCombatAnimator.
    this.swordGripPivot.position.set(0, 0.05, 0)
    this.swordGripPivot.rotation.set(0, 0, Math.PI)

    polishWeaponMaterials(this.swordGripPivot)
  }

  // ── Dynamic 3D Ranged Bow Builders (3 Distinct Geometries) ──
  rebuildRangedWeapon(weaponId: string): void {
    if (this.currentRangedId === weaponId) return
    this.currentRangedId = weaponId
    this.bowVisual.rebuild(weaponId)
    this.bowPivot.visible = false
  }

  getSwordTipPosition(): THREE.Vector3 {
    const tipWorld = this._tmpTipWorld
    this.swordGripPivot.localToWorld(tipWorld.copy(this.swordTipLocal))
    return tipWorld
  }

  // ── Dynamic 3D Shield Builder ──
  rebuildShield(shieldId: string | null): void {
    if (this.currentShieldId === shieldId) return
    this.currentShieldId = shieldId

    while (this.shieldPivot.children.length > 0) {
      this.shieldPivot.remove(this.shieldPivot.children[0])
    }

    if (shieldId) {
      WeaponMeshFactory.buildShield(shieldId, this.shieldPivot)
      polishWeaponMaterials(this.shieldPivot)
    }
  }

  dismountFromMount(): void {
    if (!this.isMounted || !this.currentMount) return
    const mountPosition = this.currentMount.group.position.clone()
    this.currentMount.releaseRider()
    this.currentMount = null
    this.isMounted = false
    applyCharacterMountedPose(this.rig, false)
    this._alignExternalVisualToMount(false)
    this.group.position.copy(mountPosition)
    this.velY = 0
  }

  takeDamage(amount: number, hpBar: HpBar): boolean {
    if (this.isDead) return false

    if (this.isMounted && this.currentMount) {
      const hitSuccess = this.currentMount.takeDamage(amount)
      if (hitSuccess && this.currentMount.dead) {
        this.dismountFromMount()
      }
      return hitSuccess
    }

    this.currentHp = Math.max(0, this.currentHp - amount)
    this.flashTimer = 0.2
    hpBar.setFill(this.hpRatio)

    if (this.currentHp <= 0) {
      this.isDead = true
      if (this.onPlayerDeath) this.onPlayerDeath()
      this.respawn(hpBar)
    }
    return true
  }

  respawn(hpBar: HpBar): void {
    this.currentHp = MAX_HP
    this.stamina = MAX_STAMINA
    this.isDead = false
    this.animator.cancel()
    this.isSwinging = false
    this.hitEventPending = false
    this.bowChargeTime = 0
    this.bowVisualDrawRatio = 0
    this.nockedArrowReleased = false
    const terrainY = getTerrainHeight(0, 0)
    this.group.position.set(0, terrainY + PLAYER_HALF_HEIGHT, 0)
    hpBar.setFill(1)
  }

  isHitFrame(_equippedMelee?: WeaponData): boolean {
    return this.hitEventPending && !this.attackHitProcessed
  }

  markHitProcessed(): void {
    this.attackHitProcessed = true
    this.hitEventPending = false
  }

  private _meleeAction(weapon: WeaponData): Exclude<CombatAction, 'idle' | 'bowAim' | 'bowRelease'> {
    switch (weapon.animationKind) {
      case 'dagger': return 'daggerSlash'
      case 'greatsword': return 'greatswordSlash'
      case 'lance': return this.isMounted ? 'mountedLance' : 'lanceThrust'
      default: return 'swordSlash'
    }
  }

  private _setShieldPlacement(onBack: boolean): void {
    const targetParent = onBack ? this.bodyMesh : this.rig.left.handSocket
    if (this.shieldOnBack === onBack && this.shieldPivot.parent === targetParent) return
    this.shieldOnBack = onBack
    if (onBack) {
      this.bodyMesh.attach(this.shieldPivot)
      this.shieldTargetPosition.set(0, 0.3, 0.45)
      this.shieldTargetEuler.set(0, Math.PI, Math.PI / 8)
    } else {
      this.rig.left.handSocket.attach(this.shieldPivot)
      // Keep the hand at the shield's rear grip. The arm pose, not a large
      // socket offset, carries both hand and shield in front of the torso.
      this.shieldTargetPosition.set(0, 0.124, 0.019)
      this.shieldTargetEuler.set(-1.42, Math.PI, -0.12)
    }
    this.shieldTargetQuaternion.setFromEuler(this.shieldTargetEuler)
    this.shieldStartPosition.copy(this.shieldPivot.position)
    this.shieldStartQuaternion.copy(this.shieldPivot.quaternion)
    this.shieldTransitionElapsed = 0
  }

  private _updateShieldTransition(dt: number): void {
    this.shieldTransitionElapsed = Math.min(0.15, this.shieldTransitionElapsed + dt)
    const blend = this.shieldTransitionElapsed / 0.15
    this.shieldPivot.position.lerpVectors(this.shieldStartPosition, this.shieldTargetPosition, blend)
    this.shieldPivot.quaternion.slerpQuaternions(this.shieldStartQuaternion, this.shieldTargetQuaternion, blend)
  }

  private _startBowRelease(
    cameraAimPoint: THREE.Vector3,
    archeryMultiplier: number,
    equippedRanged?: WeaponData,
  ): void {
    if (this.bowChargeTime <= 0.1 || this.arrows <= 0 || this.animator.busy) return
    this.pendingBowChargeTime = this.bowChargeTime
    const maxChargeTime = equippedRanged?.speedOrCharge ?? MAX_BOW_CHARGE_TIME
    this.bowVisualDrawRatio = THREE.MathUtils.clamp(this.pendingBowChargeTime / maxChargeTime, 0, 1)
    this.nockedArrowReleased = false
    this.pendingArrowTarget.copy(cameraAimPoint)
    this.pendingArcheryMultiplier = archeryMultiplier
    this.pendingRangedWeapon = equippedRanged
    this.animator.start('bowRelease')
    this.bowChargeTime = 0
  }

  update(
    dt: number,
    input: PlayerInput,
    cameraYaw: number,
    cameraAimPoint: THREE.Vector3,
    obstacles: ObstacleData[],
    staminaBar: StaminaBar,
    quiverUI: QuiverUI,
    soundManager: SoundManager,
    inventoryManager?: InventoryManager,
    archeryMultiplier = 1.0,
  ): void {
    if (this.flashTimer > 0) {
      this.flashTimer -= dt
      this.bodyMesh.traverse((child) => {
        if (this.shieldPivot.getObjectById(child.id)) return
        if ((child as THREE.Mesh).isMesh) (child as THREE.Mesh).material = this.hitFlashMat
      })
      this.headMesh.material = this.hitFlashMat
    } else {
      this.bodyMesh.traverse((child) => {
        if (this.shieldPivot.getObjectById(child.id)) return
        if ((child as THREE.Mesh).isMesh && child.userData.originalMat) {
          (child as THREE.Mesh).material = child.userData.originalMat
        }
      })
      this.headMesh.material = this.headMat
    }

    if (this.isDead) return
    this.hitEventPending = false

    const equippedMelee = inventoryManager?.equippedMelee
    const equippedRanged = inventoryManager?.equippedRanged

    const visualTier = Math.max(equippedMelee?.tier ?? 2, equippedRanged?.tier ?? 2) as 1 | 2 | 3
    if (visualTier !== this.currentArmorTier) this._buildMesh(visualTier)

    if (equippedMelee) this.rebuildMeleeWeapon(equippedMelee.id)
    if (equippedRanged) this.rebuildRangedWeapon(equippedRanged.id)
    
    const equippedShield = inventoryManager?.equippedShield ?? null
    this.rebuildShield(equippedShield ? equippedShield.id : null)

    const maxChargeTime = equippedRanged ? equippedRanged.speedOrCharge : MAX_BOW_CHARGE_TIME
    const wantAim = input.isRightMouseDown
    const bowReleasing = this.animator.currentAction === 'bowRelease'
    this.aiming = wantAim && !this.isSwinging && !bowReleasing
    this.aimBlend = THREE.MathUtils.clamp(this.aimBlend + (this.aiming ? dt / 0.18 : -dt / 0.18), 0, 1)

    quiverUI.setAiming(this.aiming)

    if (this.aiming) {
      this.swordPivot.visible = false
      this.bowPivot.visible = true
      this.nockedArrowReleased = false

      if (input.isLeftMouseDown && this.arrows > 0) {
        this.bowChargeTime = Math.min(maxChargeTime, this.bowChargeTime + dt)
        quiverUI.setChargeRatio(this.bowChargeTime / maxChargeTime)
      }
      this.bowVisualDrawRatio = THREE.MathUtils.clamp(this.bowChargeTime / maxChargeTime, 0, 1)

      if (input.consumeLeftClickRelease()) {
        this._startBowRelease(cameraAimPoint, archeryMultiplier, equippedRanged)
        quiverUI.setChargeRatio(0)
      }
    } else {
      if (this.bowChargeTime > 0.1 && this.arrows > 0) {
        this._startBowRelease(cameraAimPoint, archeryMultiplier, equippedRanged)
      }
      this.bowChargeTime = 0
      quiverUI.setChargeRatio(0)

      if (input.consumeLeftClick() && !this.animator.busy && equippedMelee && this.stamina >= SWING_STAMINA_COST) {
        const action = this._meleeAction(equippedMelee)
        if (this.animator.start(action)) {
          this.isSwinging = true
          this.attackHitProcessed = false
          this.hitEventPending = false
          this.stamina -= SWING_STAMINA_COST
          soundManager.playSwing()
        }
      }
    }

    const showingBow = this.aiming || this.animator.currentAction === 'bowRelease'
    this.swordPivot.visible = !showingBow
    this.bowPivot.visible = showingBow

    const needsTwoHands = equippedMelee?.animationKind === 'greatsword'
      || (equippedMelee?.animationKind === 'lance' && !this.isMounted)
    this.animator.setShieldGuard(Boolean(equippedShield) && !showingBow && !needsTwoHands)

    if (this.aiming) {
      this.animator.poseBow(this.bowChargeTime / maxChargeTime, this.aimBlend)
    } else if (!this.animator.busy) {
      if (equippedMelee?.animationKind === 'lance') this.animator.poseLanceReady(this.isMounted)
      else this.animator.poseIdle()
    }

    this._updateBowPose(maxChargeTime, cameraAimPoint)
    const animationEvents = this.animator.update(dt)
    if (animationEvents.hitActiveStarted) this.hitEventPending = true
    if (animationEvents.projectileRelease) {
      this._fireArrow(
        this.pendingArrowTarget,
        this.pendingArcheryMultiplier,
        this.pendingRangedWeapon,
        this.pendingBowChargeTime,
      )
      this.nockedArrowReleased = true
      this.bowVisualDrawRatio = 0
      soundManager.playBowRelease()
    }
    if (animationEvents.actionCompleted) {
      this.isSwinging = false
      this.hitEventPending = false
    }

    this._setShieldPlacement(showingBow || needsTwoHands)
    this._updateShieldTransition(dt)

    const forward = this._tmpForward.set(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw))
    const right   = this._tmpRight.set( Math.cos(cameraYaw), 0, -Math.sin(cameraYaw))

    const moveDir = this._tmpMoveDir.set(0, 0, 0)
    if (input.keys['KeyW']) moveDir.addScaledVector(forward, 1)
    if (input.keys['KeyS']) moveDir.addScaledVector(forward, -1)
    if (input.keys['KeyA']) moveDir.addScaledVector(right, -1)
    if (input.keys['KeyD']) moveDir.addScaledVector(right, 1)

    const isMoving = moveDir.lengthSq() > 0

    const wantSprint = input.keys['ShiftLeft'] || input.keys['ShiftRight']

    if (wantSprint && isMoving && this.stamina >= STAMINA_SPRINT_MIN && !this.isSwinging && !this.aiming) {
      this.isSprinting = true
    }
    if (!wantSprint || !isMoving || this.stamina <= 0 || this.isSwinging || this.aiming) {
      this.isSprinting = false
    }

    const visualSpeed = isMoving
      ? this.isMounted && this.currentMount
        ? this.currentMount.baseSpeed * (this.isSprinting ? SPRINT_MULTIPLIER : 1)
        : MOVE_SPEED * (this.isSprinting ? SPRINT_MULTIPLIER : 1)
      : 0
    this.animator.setLocomotion(visualSpeed, this.isMounted)



    if (this.isSprinting) {
      this.stamina = Math.max(0, this.stamina - STAMINA_DRAIN * dt)
    } else if (!this.isSwinging) {
      this.stamina = Math.min(MAX_STAMINA, this.stamina + STAMINA_REGEN * dt)
    }
    staminaBar.setFill(this.staminaRatio)

    if (this.isMounted && this.currentMount) {
      this.currentMount.beginControlledFrame()
      const speed = this.currentMount.baseSpeed * (this.isSprinting ? SPRINT_MULTIPLIER : 1)
      this.currentMount.addControlledMovement(moveDir, speed, dt)
      
      // Jump (Mount)
      if (input.keys['Space'] && this.currentMount.onGround) {
        this.currentMount.startJump(JUMP_VELOCITY * 1.6)
      }

      this.currentMount.finishControlledFrame(dt, obstacles)

      // Sync player to mount
      this.currentMount.getSaddleSeatWorld(this.group.position)
      this.group.position.y += PLAYER_HALF_HEIGHT
      applyCharacterMountedPose(this.rig, true, this.currentMount.type as MountedPoseKind)
      this._alignExternalVisualToMount(true)
      
      // Ride posture
      this.group.rotation.x = this.currentMount.ridePitch
      
      // Rotation
      if (isMoving) {
        moveDir.normalize()
        const mountAngle = Math.atan2(moveDir.x, moveDir.z)
        this.currentMount.group.rotation.y = mountAngle
        this.group.rotation.y = this._characterYaw(mountAngle)
      } else if (this.aiming || this.isSwinging) {
        this.group.rotation.y = this._characterYaw(cameraYaw + Math.PI)
        this.currentMount.group.rotation.y = cameraYaw + Math.PI
      }

      // Reset player velY so when dismounting they don't fall fast
      this.velY = 0

    } else {
      // Normal Player Movement
      this.group.rotation.x = 0
      applyCharacterMountedPose(this.rig, false)
      this._alignExternalVisualToMount(false)
      const previousPlayerPosition = this._tmpPreviousPosition.copy(this.group.position)
      const speed = MOVE_SPEED * (this.isSprinting ? SPRINT_MULTIPLIER : 1)
      this.group.position.addScaledVector(moveDir, speed * dt)
      
      if (this.aiming) {
        this.group.rotation.y = this._characterYaw(cameraYaw + Math.PI)
      } else if (isMoving) {
        moveDir.normalize()
        const targetAngle = Math.atan2(moveDir.x, moveDir.z)
        this.group.rotation.y = this._characterYaw(targetAngle)
      } else if (this.isSwinging) {
        this.group.rotation.y = this._characterYaw(cameraYaw + Math.PI)
      }

      // Map boundary clamp
      this.group.position.x = THREE.MathUtils.clamp(this.group.position.x, -95, 95)
      this.group.position.z = THREE.MathUtils.clamp(this.group.position.z, -95, 95)

      // Jump
      if (input.keys['Space'] && this.onGround) {
        this.velY = JUMP_VELOCITY
        this.onGround = false
      }

      // Gravity
      this.velY += GRAVITY * dt
      this.group.position.y += this.velY * dt

      // Dynamic Heightmap Ground Collision
      const currentGroundY = getTerrainHeight(this.group.position.x, this.group.position.z)
      const footY = currentGroundY + PLAYER_HALF_HEIGHT
      if (this.group.position.y <= footY) {
        this.group.position.y = footY
        this.velY = 0
        this.onGround = true
      }

      // Block against obstacle sides and land on obstacle tops.
      const playerCollision = resolveObstacleCollision(
        this.group.position,
        previousPlayerPosition,
        this.velY,
        this.onGround,
        PLAYER_RADIUS,
        PLAYER_HALF_HEIGHT * 2,
        PLAYER_HALF_HEIGHT,
        obstacles,
      )
      this.velY = playerCollision.velocityY
      this.onGround = playerCollision.onGround

      // World Boundary Clamp
      const BOUND = 95
      this.group.position.x = THREE.MathUtils.clamp(this.group.position.x, -BOUND, BOUND)
      this.group.position.z = THREE.MathUtils.clamp(this.group.position.z, -BOUND, BOUND)
    }
  }

  private _alignExternalVisualToMount(mounted: boolean): void {
    if (this.externalPelvisHeight <= 0) return
    this.characterVisualGroup.position.y = -PLAYER_HALF_HEIGHT - (mounted ? this.externalPelvisHeight : 0)
  }

  private _characterYaw(desiredForwardYaw: number): number {
    // Browser-validated v2 assets already align with the gameplay heading.
    // Applying the legacy 180-degree procedural-mesh correction makes W move
    // the character butt-first.
    return desiredForwardYaw + (this.usesExternalForwardAdapter ? 0 : Math.PI)
  }

  private _updateBowPose(maxChargeTime = MAX_BOW_CHARGE_TIME, cameraAimPoint?: THREE.Vector3): void {
    if (!this.aiming && this.animator.currentAction !== 'bowRelease') return
    const drawRatio = this.animator.currentAction === 'bowRelease'
      ? this.bowVisualDrawRatio
      : this.bowChargeTime / maxChargeTime
    this.bowVisual.update(drawRatio, cameraAimPoint, this.arrows > 0 && !this.nockedArrowReleased)
  }

  private _fireArrow(
    cameraAimPoint: THREE.Vector3,
    archeryMultiplier = 1.0,
    equippedRanged?: WeaponData,
    chargeTime = this.bowChargeTime,
  ): void {
    if (this.arrows <= 0) return

    this.arrows -= 1

    const maxChargeTime = equippedRanged ? equippedRanged.speedOrCharge : MAX_BOW_CHARGE_TIME
    const speedMin = equippedRanged?.arrowSpeedMin ?? 18
    const speedMax = equippedRanged?.arrowSpeedMax ?? 48
    const dmgMin   = equippedRanged?.damageMin ?? 15
    const dmgMax   = equippedRanged?.damageMax ?? 42

    const chargeRatio = chargeTime / maxChargeTime
    const speed  = THREE.MathUtils.lerp(speedMin, speedMax, chargeRatio)
    const baseDamage = THREE.MathUtils.lerp(dmgMin, dmgMax, chargeRatio)
    const damage = Math.round(baseDamage * archeryMultiplier)

    const arrowOrigin = this._tmpWorldNock
    const arrowDirection = this._tmpArrowDirection
    this.bowVisual.writeLaunch(arrowOrigin, arrowDirection, cameraAimPoint)

    if (this.onFireArrow) {
      this.onFireArrow({
        origin: arrowOrigin.clone(),
        direction: arrowDirection.clone(),
        speed,
        damage,
      })
    }
  }

}
