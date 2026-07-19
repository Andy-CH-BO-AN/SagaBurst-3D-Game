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
import { buildCharacterVisual, polishWeaponMaterials } from '../world/CharacterVisuals'

// ── Tuning constants ──
const MOVE_SPEED        = 8    // units/s walk
const SPRINT_MULTIPLIER = 2.0  // walk × this = sprint speed
const JUMP_VELOCITY     = 9    // units/s upward
const GRAVITY           = -22  // units/s²
const PLAYER_HALF_HEIGHT = 0.95

const MAX_HP            = 100
const MAX_STAMINA       = 100
const STAMINA_DRAIN     = 30   // per second while sprinting
const STAMINA_REGEN     = 15   // per second when not sprinting
const STAMINA_SPRINT_MIN = 10  // must have at least this much to start sprint
const SWING_STAMINA_COST = 15  // stamina consumed per sword swing

const PLAYER_RADIUS = 0.38
const SWING_DURATION = 0.35
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
  private rightArm!: THREE.Group
  private leftArm!: THREE.Group
  private currentArmorTier: 1 | 2 | 3 = 2

  private flashTimer = 0

  // 3D Weapon Pivots & Models
  private rightHandSocket!: THREE.Group
  private swordPivot!: THREE.Group
  private currentMeleeId: string = ''

  private bowPivot!: THREE.Group
  private currentRangedId: string = ''
  private stringMeshTop!: THREE.Mesh
  private stringMeshBottom!: THREE.Mesh
  private nockedArrow!: THREE.Group

  private shieldPivot!: THREE.Group
  private currentShieldId: string | null = null

  private velY = 0
  private onGround = false

  private currentHp = MAX_HP
  private stamina = MAX_STAMINA
  private isSprinting = false

  private isSwinging = false
  private swingTimer = 0
  private attackHitProcessed = false

  private aiming = false
  private bowChargeTime = 0
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
  private readonly _tmpNockPos = new THREE.Vector3()
  private readonly _tmpWorldNock = new THREE.Vector3()

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
  get arrowCount(): number      { return this.arrows }
  get dead(): boolean           { return this.isDead }

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
    this.group.add(this.characterVisualGroup)

    // Create Right Hand Socket (Default position at player right hand T-pose palm)
    this.rightHandSocket = new THREE.Group()
    this.rightHandSocket.position.set(0.45, 0.1, -0.1)
    this.group.add(this.rightHandSocket)

    // Create Weapon Pivots inside Right Hand Socket
    this.swordPivot = new THREE.Group()
    this.rightHandSocket.add(this.swordPivot)

    this.bowPivot = new THREE.Group()
    this.group.add(this.bowPivot)

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
    this.characterVisualGroup.clear()
    const parts = buildCharacterVisual(this.characterVisualGroup, {
      faction: 'viking',
      tier,
      isPlayer: true,
    })
    this.bodyMesh = parts.bodyMesh
    this.headMesh = parts.headMesh
    this.headMat = parts.headMaterial
    this.rightArm = parts.rightArm
    this.leftArm = parts.leftArm

    // Reattach shieldPivot to the new leftArm
    this.leftArm.add(this.shieldPivot)
    this.shieldPivot.position.set(0, -0.35, 0)
    this.shieldPivot.rotation.set(0, -Math.PI / 2, 0)
  }

  // ── Dynamic 3D Melee Weapon Builders ──
  private swordTipLocal = new THREE.Vector3(0, 1.2, 0)

  rebuildMeleeWeapon(weaponId: string): void {
    if (this.currentMeleeId === weaponId) return
    this.currentMeleeId = weaponId

    // Clear existing meshes
    while (this.swordPivot.children.length > 0) {
      this.swordPivot.remove(this.swordPivot.children[0])
    }

    const { tipLocal } = WeaponMeshFactory.buildMelee(weaponId, this.swordPivot)
    this.swordTipLocal.copy(tipLocal)

    polishWeaponMaterials(this.swordPivot)
  }

  // ── Dynamic 3D Ranged Bow Builders (3 Distinct Geometries) ──
  rebuildRangedWeapon(weaponId: string): void {
    if (this.currentRangedId === weaponId) return
    this.currentRangedId = weaponId

    while (this.bowPivot.children.length > 0) {
      this.bowPivot.remove(this.bowPivot.children[0])
    }

    const { stringLength } = WeaponMeshFactory.buildRanged(weaponId, this.bowPivot)
    
    const stringMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
    this.stringMeshTop = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, stringLength, 4), stringMat)
    this.bowPivot.add(this.stringMeshTop)

    this.stringMeshBottom = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, stringLength, 4), stringMat)
    this.bowPivot.add(this.stringMeshBottom)

    this._buildNockedArrow(weaponId)

    polishWeaponMaterials(this.bowPivot)
    this.bowPivot.visible = false
  }

  getSwordTipPosition(): THREE.Vector3 {
    const tipWorld = this._tmpTipWorld
    this.swordPivot.localToWorld(tipWorld.copy(this.swordTipLocal))
    return tipWorld
  }

  private _buildNockedArrow(weaponId: string): void {
    this.nockedArrow = new THREE.Group()
    const woodMat = new THREE.MeshLambertMaterial({ color: 0x5c3a1e })

    const arrowShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.95, 6), woodMat)
    arrowShaft.rotation.x = Math.PI / 2
    this.nockedArrow.add(arrowShaft)

    const tipColor = weaponId === 'elven_runebow' ? 0x00f0ff : 0xaaaaaa
    const tipMat = new THREE.MeshStandardMaterial({ color: tipColor, metalness: 0.9 })
    const arrowTip = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.14, 6), tipMat)
    arrowTip.rotation.x = -Math.PI / 2
    arrowTip.position.z = -0.52
    this.nockedArrow.add(arrowTip)

    const featherMat = new THREE.MeshBasicMaterial({ color: weaponId === 'elven_runebow' ? 0x00d2ff : 0xdddddd })
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.12, 0.16), featherMat)
    fin.position.z = 0.4
    this.nockedArrow.add(fin)

    this.bowPivot.add(this.nockedArrow)
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
    const terrainY = getTerrainHeight(0, 0)
    this.group.position.set(0, terrainY + PLAYER_HALF_HEIGHT, 0)
    hpBar.setFill(1)
  }

  isHitFrame(equippedMelee?: WeaponData): boolean {
    if (!this.isSwinging || this.attackHitProcessed) return false
    const swingDuration = equippedMelee ? equippedMelee.speedOrCharge : SWING_DURATION
    const progress = this.swingTimer / swingDuration
    return progress >= 0.2 && progress <= 0.8
  }

  markHitProcessed(): void {
    this.attackHitProcessed = true
  }

  update(
    dt: number,
    input: PlayerInput,
    cameraYaw: number,
    cameraDirection: THREE.Vector3,
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
        if ((child as THREE.Mesh).isMesh) (child as THREE.Mesh).material = this.hitFlashMat
      })
      this.headMesh.material = this.hitFlashMat
    } else {
      this.bodyMesh.traverse((child) => {
        if ((child as THREE.Mesh).isMesh && child.userData.originalMat) {
          (child as THREE.Mesh).material = child.userData.originalMat
        }
      })
      this.headMesh.material = this.headMat
    }

    if (this.isDead) return

    const equippedMelee = inventoryManager?.equippedMelee
    const equippedRanged = inventoryManager?.equippedRanged

    const visualTier = Math.max(equippedMelee?.tier ?? 2, equippedRanged?.tier ?? 2) as 1 | 2 | 3
    if (visualTier !== this.currentArmorTier) this._buildMesh(visualTier)

    if (equippedMelee) this.rebuildMeleeWeapon(equippedMelee.id)
    if (equippedRanged) this.rebuildRangedWeapon(equippedRanged.id)
    
    const equippedShield = inventoryManager?.equippedShield ?? null
    this.rebuildShield(equippedShield ? equippedShield.id : null)

    const maxChargeTime = equippedRanged ? equippedRanged.speedOrCharge : MAX_BOW_CHARGE_TIME
    const swingDuration = equippedMelee ? equippedMelee.speedOrCharge : SWING_DURATION

    const wantAim = input.isRightMouseDown
    this.aiming = wantAim && !this.isSwinging

    quiverUI.setAiming(this.aiming)

    if (this.aiming) {
      this.swordPivot.visible = false
      this.bowPivot.visible = true

      // Dynamic Back-Shield: move shield to back
      if (this.shieldPivot.parent !== this.bodyMesh) {
        this.bodyMesh.add(this.shieldPivot)
        this.shieldPivot.position.set(0, 0.3, 0.45)
        this.shieldPivot.rotation.set(0, Math.PI, Math.PI / 8) // Slanted on back
      }

      if (input.isLeftMouseDown && this.arrows > 0) {
        this.bowChargeTime = Math.min(maxChargeTime, this.bowChargeTime + dt)
        quiverUI.setChargeRatio(this.bowChargeTime / maxChargeTime)
      }

      if (input.consumeLeftClickRelease()) {
        if (this.bowChargeTime > 0.1 && this.arrows > 0) {
          this._fireArrow(cameraDirection, archeryMultiplier, equippedRanged)
          soundManager.playBowRelease()
        }
        this.bowChargeTime = 0
        quiverUI.setChargeRatio(0)
      }

    } else {
      // If we stop aiming but have a charged shot, fire it (like releasing left click)
      if (this.bowChargeTime > 0.1 && this.arrows > 0) {
        this._fireArrow(cameraDirection, archeryMultiplier, equippedRanged)
        soundManager.playBowRelease()
      }

      this.swordPivot.visible = true
      this.bowPivot.visible = false
      this.bowChargeTime = 0
      quiverUI.setChargeRatio(0)

      // Restore shield to left arm
      if (this.shieldPivot.parent !== this.leftArm) {
        this.leftArm.add(this.shieldPivot)
        this.shieldPivot.position.set(0, -0.35, 0)
        this.shieldPivot.rotation.set(0, -Math.PI / 2, 0)
      }

      if (input.consumeLeftClick() && !this.isSwinging && this.stamina >= SWING_STAMINA_COST) {
        this.isSwinging = true
        this.swingTimer = 0
        this.attackHitProcessed = false
        this.stamina -= SWING_STAMINA_COST
        soundManager.playSwing()
      }
    }

    this._updateBowPose(maxChargeTime)
    this._updateSwingAnimation(dt, swingDuration)

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
        this.currentMount.velY = JUMP_VELOCITY * 1.6 // Higher jump
        this.currentMount.onGround = false
      }

      this.currentMount.finishControlledFrame(dt, obstacles)

      // Sync player to mount
      this.group.position.copy(this.currentMount.group.position)
      this.group.position.y += this.currentMount.rideHeightOffset
      
      // Ride posture
      this.group.rotation.x = this.currentMount.ridePitch
      
      // Rotation
      if (isMoving) {
        moveDir.normalize()
        const playerAngle = Math.atan2(-moveDir.x, -moveDir.z)
        const mountAngle = Math.atan2(moveDir.x, moveDir.z)
        this.currentMount.group.rotation.y = mountAngle
        this.group.rotation.y = playerAngle
      } else if (this.aiming || this.isSwinging) {
        this.group.rotation.y = cameraYaw
        this.currentMount.group.rotation.y = cameraYaw + Math.PI
      }

      // Reset player velY so when dismounting they don't fall fast
      this.velY = 0

    } else {
      // Normal Player Movement
      this.group.rotation.x = 0
      const previousPlayerPosition = this._tmpPreviousPosition.copy(this.group.position)
      const speed = MOVE_SPEED * (this.isSprinting ? SPRINT_MULTIPLIER : 1)
      this.group.position.addScaledVector(moveDir, speed * dt)
      
      if (this.aiming) {
        this.group.rotation.y = cameraYaw
      } else if (isMoving) {
        moveDir.normalize()
        const targetAngle = Math.atan2(-moveDir.x, -moveDir.z)
        this.group.rotation.y = targetAngle
      } else if (this.isSwinging) {
        this.group.rotation.y = cameraYaw
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

  private _updateBowPose(maxChargeTime = MAX_BOW_CHARGE_TIME): void {
    if (!this.aiming) return

    // Position bow on the right side (aligning with right-shoulder camera)
    this.bowPivot.position.set(0.35, 0.8, -0.5)
    this.bowPivot.rotation.set(0, 0, -0.1)

    const drawRatio = this.bowChargeTime / maxChargeTime
    const stringPullBack = drawRatio * 0.45

    let topTip = new THREE.Vector3(0, 0.82, -0.04)
    let botTip = new THREE.Vector3(0, -0.82, -0.04)
    let stringLength = 0.85
    
    if (this.currentRangedId === 'wooden_shortbow') {
      topTip.set(0, 0.52, 0.04)
      botTip.set(0, -0.52, 0.04)
      stringLength = 0.53
    } else if (this.currentRangedId === 'elven_runebow') {
      topTip.set(0, 1.0, -0.01)
      botTip.set(0, -1.0, -0.01)
      stringLength = 1.0
    }

    // Draw string straight back in local space
    const nockPos = this._tmpNockPos.set(0, 0, 0.12 + stringPullBack)

    const worldNock = this._tmpWorldNock
    this.bowPivot.localToWorld(worldNock.copy(nockPos))

    if (this.stringMeshTop) {
      this.stringMeshTop.position.copy(topTip).add(nockPos).multiplyScalar(0.5)
      this.stringMeshTop.lookAt(worldNock)
      this.stringMeshTop.rotateX(Math.PI / 2)
      this.stringMeshTop.scale.set(1, topTip.distanceTo(nockPos) / stringLength, 1)
    }

    if (this.stringMeshBottom) {
      this.stringMeshBottom.position.copy(botTip).add(nockPos).multiplyScalar(0.5)
      this.stringMeshBottom.lookAt(worldNock)
      this.stringMeshBottom.rotateX(Math.PI / 2)
      this.stringMeshBottom.scale.set(1, botTip.distanceTo(nockPos) / stringLength, 1)
    }

    if (this.nockedArrow) {
      if (this.arrows > 0) {
        this.nockedArrow.visible = true
        this.nockedArrow.position.copy(nockPos)
      } else {
        this.nockedArrow.visible = false
      }
    }
  }

  private _fireArrow(
    cameraDirection: THREE.Vector3,
    archeryMultiplier = 1.0,
    equippedRanged?: WeaponData
  ): void {
    if (this.arrows <= 0) return

    this.arrows -= 1

    const maxChargeTime = equippedRanged ? equippedRanged.speedOrCharge : MAX_BOW_CHARGE_TIME
    const speedMin = equippedRanged?.arrowSpeedMin ?? 18
    const speedMax = equippedRanged?.arrowSpeedMax ?? 48
    const dmgMin   = equippedRanged?.damageMin ?? 15
    const dmgMax   = equippedRanged?.damageMax ?? 42

    const chargeRatio = this.bowChargeTime / maxChargeTime
    const speed  = THREE.MathUtils.lerp(speedMin, speedMax, chargeRatio)
    const baseDamage = THREE.MathUtils.lerp(dmgMin, dmgMax, chargeRatio)
    const damage = Math.round(baseDamage * archeryMultiplier)

    const arrowOrigin = this.group.position.clone()
    arrowOrigin.y += 1.4

    if (this.onFireArrow) {
      this.onFireArrow({
        origin: arrowOrigin,
        direction: cameraDirection.clone(),
        speed,
        damage,
      })
    }
  }

  private _updateSwingAnimation(dt: number, swingDuration = SWING_DURATION): void {
    if (!this.isSwinging) {
      this.swordPivot.rotation.set(0, 0, 0)
      if (this.aiming) {
        this.rightArm.rotation.set(-0.55, 0, -0.18)
        this.leftArm.rotation.set(-0.35, 0, 0.18)
      } else {
        this.rightArm.rotation.set(0, 0, -0.12)
        this.leftArm.rotation.set(0, 0, 0.12)
      }
      return
    }

    this.swingTimer += dt
    const progress = Math.min(1, this.swingTimer / swingDuration)

    if (progress < 0.5) {
      const t = progress / 0.5
      const pitch = THREE.MathUtils.lerp(Math.PI / 6, -Math.PI / 3, t)
      const yaw   = THREE.MathUtils.lerp(0, Math.PI / 2, t)
      const roll  = THREE.MathUtils.lerp(-Math.PI / 12, -Math.PI / 4, t)
      this.swordPivot.rotation.set(pitch, yaw, roll)
      this.rightArm.rotation.set(pitch * 0.65, yaw * 0.3, roll)
    } else {
      const t = (progress - 0.5) / 0.5
      const pitch = THREE.MathUtils.lerp(-Math.PI / 3, Math.PI / 6, t)
      const yaw   = THREE.MathUtils.lerp(Math.PI / 2, 0, t)
      const roll  = THREE.MathUtils.lerp(-Math.PI / 4, -Math.PI / 12, t)
      this.swordPivot.rotation.set(pitch, yaw, roll)
      this.rightArm.rotation.set(pitch * 0.65, yaw * 0.3, roll)
    }

    if (this.swingTimer >= swingDuration) {
      this.isSwinging = false
    }
  }

}
