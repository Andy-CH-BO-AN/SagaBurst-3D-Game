/**
 * NPC.ts
 * Generic NPC AI unit (Faction System, Melee/Ranged).
 * Calibrated with getTerrainHeight(x, z) for procedural heightmap terrain.
 */
import * as THREE from 'three'
import type { Player } from '../player/Player'
import type { HpBar } from '../ui/HpBar'
import { getObstacleAvoidanceDirection, getTerrainHeight, ObstacleData, resolveObstacleCollision } from './Terrain'
import { applyCharacterMountedPose, buildCharacterVisual, polishWeaponMaterials } from './CharacterVisuals'
import type { CharacterRig, MountedPoseKind } from './CharacterVisuals'
import { HumanoidAssetRegistry } from './HumanoidAssetRegistry'
import { CharacterCombatAnimator, type CombatAction } from './CharacterCombatAnimator'
import { CharacterBowVisual } from './CharacterBowVisual'
import { DEFAULT_MOUNT_TYPE, Mount } from './Mount'
import { horseVariantForStableKey } from './HorseAssetRegistry'
import { WeaponMeshFactory } from './WeaponMeshFactory'
import { WEAPONS } from '../rpg/WeaponDatabase'

export enum AIState {
  IDLE = 'IDLE',
  ALERT = 'ALERT',
  CHASE = 'CHASE',
  ATTACK = 'ATTACK',
  DEAD = 'DEAD',
}

export enum Faction {
  PLAYER = 'PLAYER', // Allied with Player
  ENEMY = 'ENEMY',   // Hostile to Player
}

export enum AIType {
  MELEE = 'MELEE',
  RANGED = 'RANGED',
}

const DETECTION_RADIUS = 300.0
const RANGED_ATTACK_MAX = 22.0
const RANGED_ATTACK_MIN = 6.0
const RANGED_AIM_LIFT_PER_METER_SQ = 0.015

const CHASE_SPEED      = 4.8
const PATROL_SPEED     = 2.2
const RANGED_COOLDOWN  = 1.5
const AI_ATTACK_GAP    = 0.35
const RESPAWN_TIME     = 10.0

export class NPC {
  // Visuals
  group: THREE.Group
  characterVisualGroup: THREE.Group
  readonly faction: Faction
  readonly aiType: AIType
  readonly name: string
  readonly tier: 1 | 2 | 3

  public readonly meleeDamage: number
  public readonly rangedDamage: number
  public readonly generatedAsCavalry: boolean
  public mount: Mount | null = null
  public meleeAttackRadius = 1.8
  public isUsingLance = false

  private bodyMesh: THREE.Group
  private headMesh: THREE.Mesh
  private headMat: THREE.MeshStandardMaterial
  private rig: CharacterRig
  private externalPelvisHeight = 0
  private animator: CharacterCombatAnimator
  private alertSprite: THREE.Sprite

  private swordPivot: THREE.Group
  private swordGripPivot: THREE.Group
  private readonly swordTipLocal = new THREE.Vector3(0, 1.04, 0)
  private bowPivot: THREE.Group
  private bowGripPivot: THREE.Group
  private bowVisual?: CharacterBowVisual
  private shieldPivot: THREE.Group
  private shieldOnBack = false
  private readonly shieldTargetPosition = new THREE.Vector3()
  private readonly shieldTargetQuaternion = new THREE.Quaternion()
  private readonly shieldTargetEuler = new THREE.Euler()
  private readonly shieldStartPosition = new THREE.Vector3()
  private readonly shieldStartQuaternion = new THREE.Quaternion()
  private shieldTransitionElapsed = 0.15
  public shieldId: string | null = null

  private flashMat: THREE.MeshBasicMaterial

  readonly maxHp = 120
  private currentHp = 120

  private state: AIState = AIState.IDLE
  private alertTimer = 0
  private attackTimer = 0
  private attackHitProcessed = false

  private flashTimer = 0
  private respawnTimer = 0

  private spawnX: number
  private spawnZ: number
  private waypoints: THREE.Vector3[] = []
  private currentWaypointIdx = 0

  private arrows: number = 0
  private velY = 0
  private onGround = false
  private visualMovementSpeed = 0

  // ── Reusable temporary vectors (P-1: avoid per-frame GC pressure) ──
  private readonly _tmpMoveDir = new THREE.Vector3()
  private readonly _tmpSep = new THREE.Vector3()
  private readonly _tmpPush = new THREE.Vector3()
  private readonly _tmpRangedOrigin = new THREE.Vector3()
  private readonly _tmpRangedTarget = new THREE.Vector3()
  private readonly _tmpRangedDirection = new THREE.Vector3()
  private readonly _tmpWeaponTip = new THREE.Vector3()
  private readonly _tmpPelvisWorld = new THREE.Vector3()
  private static readonly _UP = new THREE.Vector3(0, 1, 0)

  get hp(): number { return this.currentHp }
  get hpRatio(): number { return Math.max(0, this.currentHp / this.maxHp) }
  get currentState(): AIState { return this.state }
  get dead(): boolean { return this.state === AIState.DEAD }
  
  get inCombat(): boolean {
    return this.state === AIState.CHASE || this.state === AIState.ATTACK
  }
  get position(): THREE.Vector3 { return this.group.position }
  get combatPosition(): THREE.Vector3 { return this.mount ? this.mount.group.position : this.group.position }
  get isMounted(): boolean { return this.mount !== null && !this.mount.dead }
  get combatAnimationAction(): CombatAction { return this.animator.currentAction }

  getWeaponTipPosition(): THREE.Vector3 {
    return this.swordGripPivot.localToWorld(this._tmpWeaponTip.copy(this.swordTipLocal))
  }

  getWeaponGripPosition(target: THREE.Vector3): THREE.Vector3 {
    return this.swordGripPivot.getWorldPosition(target)
  }

  constructor(
    scene: THREE.Scene,
    spawnX: number,
    spawnZ: number,
    faction: Faction,
    aiType: AIType,
    name: string,
    tier: 1 | 2 | 3,
    cavalry?: boolean,
  ) {
    this.spawnX = spawnX
    this.spawnZ = spawnZ
    this.faction = faction
    this.aiType = aiType
    this.name = name
    this.tier = tier
    this.generatedAsCavalry = cavalry ?? Math.random() < 0.4

    if (this.aiType === AIType.RANGED) {
      this.arrows = 30
    } else {
      this.arrows = 0
    }

    // Assign Damages
    if (this.faction === Faction.ENEMY) {
      // Ranged units' fallback melee weapon is always Tier 1
      const meleeT = this.aiType === AIType.RANGED ? 1 : this.tier
      this.meleeDamage = WEAPONS[meleeT === 1 ? 'gladius_rusty' : meleeT === 2 ? 'gladius_standard' : 'centurion_blade'].damageMax
      this.rangedDamage = WEAPONS[this.tier === 1 ? 'pilum_basic' : this.tier === 2 ? 'pilum_standard' : 'legionary_pilum'].damageMax
    } else {
      // Viking Ally fallback fixed tiers
      this.meleeDamage = WEAPONS['steel_sword'].damageMax
      this.rangedDamage = WEAPONS['recurve_longbow'].damageMax
    }

    if (this.generatedAsCavalry && this.aiType === AIType.MELEE) {
      this.isUsingLance = true
      this.meleeAttackRadius = 3.0
      this.meleeDamage = this.meleeDamage * 1.5 // Extra damage for lance
    }

    // Calibrate waypoints to terrain height
    const baseTerrainY = getTerrainHeight(spawnX, spawnZ)
    // Spawn 20 units in the air so they drop down
    const basePos = new THREE.Vector3(spawnX, baseTerrainY + 20, spawnZ)

    const wp1 = new THREE.Vector3(spawnX - 10, getTerrainHeight(spawnX - 10, spawnZ - 8), spawnZ - 8)
    const wp2 = new THREE.Vector3(spawnX + 8, getTerrainHeight(spawnX + 8, spawnZ - 12), spawnZ - 12)
    this.waypoints = [basePos.clone(), wp1, wp2]

    this.group = new THREE.Group()
    this.group.name = `npc_${faction}_${aiType}`

    this.characterVisualGroup = new THREE.Group()
    this.characterVisualGroup.rotation.y = 0 // Shared +Z gameplay heading; no per-faction flip.
    this.group.add(this.characterVisualGroup)

    this.flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
    const visualConfig = {
      faction: this.faction === Faction.ENEMY ? 'roman' : 'viking',
      tier: this.tier,
      isPlayer: false,
    } as const
    const allowLegacyFixture = import.meta.env.MODE === 'test'
      || (import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('legacyhumanoids'))
    const visual = HumanoidAssetRegistry.ready
      ? HumanoidAssetRegistry.createCharacterVisual(this.characterVisualGroup, visualConfig)
      : allowLegacyFixture
        ? buildCharacterVisual(this.characterVisualGroup, visualConfig)
        : (() => { throw new Error(`${visualConfig.faction} humanoid assets were not preloaded`) })()
    this.bodyMesh = visual.bodyMesh as THREE.Group
    this.headMesh = visual.headMesh as THREE.Mesh
    this.headMat = visual.headMaterial
    this.rig = visual.rig
    if (HumanoidAssetRegistry.ready && this.rig.pelvis) {
      this.characterVisualGroup.updateWorldMatrix(true, true)
      this.rig.pelvis.getWorldPosition(this._tmpPelvisWorld)
      this.externalPelvisHeight = this.characterVisualGroup.worldToLocal(this._tmpPelvisWorld).y
    }

    // Create Weapon Pivots
    this.swordPivot = new THREE.Group()
    this.swordGripPivot = new THREE.Group()
    this.swordPivot.add(this.swordGripPivot)
    this.rig.right.handSocket.add(this.swordPivot)

    this.bowPivot = new THREE.Group()
    this.bowGripPivot = new THREE.Group()
    this.bowPivot.add(this.bowGripPivot)
    if (this.faction === Faction.ENEMY) this.rig.right.handSocket.add(this.bowPivot)
    else this.rig.left.handSocket.add(this.bowPivot)

    this.shieldPivot = new THREE.Group()
    this.rig.left.handSocket.add(this.shieldPivot)
    this.shieldPivot.position.set(0, 0.124, 0.019)
    this.shieldPivot.rotation.set(-1.42, Math.PI, -0.12)
    this.shieldTargetPosition.copy(this.shieldPivot.position)
    this.shieldTargetQuaternion.copy(this.shieldPivot.quaternion)

    this.animator = new CharacterCombatAnimator(this.rig, this.swordPivot, this.bowPivot)

    this.swordTipLocal.copy(
      WeaponMeshFactory.buildNpcMelee(
        this.faction,
        this.aiType === AIType.RANGED ? 1 : this.tier,
        this.isUsingLance,
        this.swordGripPivot,
      ),
    )
    this.swordGripPivot.position.set(0, 0.05, 0)
    this.swordGripPivot.rotation.set(0, 0, Math.PI)
    if (this.faction === Faction.PLAYER) {
      this.bowVisual = new CharacterBowVisual(this.bowPivot, this.bowGripPivot)
      const bowId = this.tier === 1
        ? 'wooden_shortbow'
        : this.tier === 2
          ? 'recurve_longbow'
          : 'elven_runebow'
      this.bowVisual.rebuild(bowId)
    } else {
      WeaponMeshFactory.buildNpcRanged(this.faction, this.tier, this.bowGripPivot)
    }
    polishWeaponMaterials(this.swordPivot)
    polishWeaponMaterials(this.bowPivot)

    if (this.arrows > 0) {
      this.swordPivot.visible = false
      this.bowPivot.visible = true
      this._setShieldPlacement(true, true)
    } else {
      this.swordPivot.visible = true
      this.bowPivot.visible = false
      if (this.shieldId && this.aiType !== AIType.RANGED) {
        this._setShieldPlacement(false, true)
      }
    }

    this.rebuildShield()

    this.alertSprite = this._createAlertSprite()
    this.alertSprite.position.set(0, 2.3, 0)
    this.alertSprite.visible = false
    this.group.add(this.alertSprite)

    this.group.position.copy(basePos)
    scene.add(this.group)

    if (this.generatedAsCavalry) {
      const horseVariant = horseVariantForStableKey(`${this.faction}:${this.name}:${this.tier}`)
      this.mount = new Mount(scene, DEFAULT_MOUNT_TYPE, spawnX, spawnZ, basePos.y, horseVariant)
      this.mount.setNpcRider(this, this.faction)
      this._syncToMount()
    }
  }

  /** Releases this NPC from its mount and returns it to a normal walking body. */
  dismountFromMount(): void {
    if (!this.mount) return
    const mountPosition = this.mount.group.position.clone()
    this.mount.releaseRider()
    this.mount = null
    applyCharacterMountedPose(this.rig, false)
    this._alignExternalVisualToMount(false)
    this.group.position.copy(mountPosition)
  }

  rebuildShield(): void {
    while (this.shieldPivot.children.length > 0) {
      this.shieldPivot.remove(this.shieldPivot.children[0])
    }
    if (this.shieldId) {
      WeaponMeshFactory.buildShield(this.shieldId, this.shieldPivot)
      polishWeaponMaterials(this.shieldPivot)
    }
  }

  private _meleeAction(): Exclude<CombatAction, 'idle' | 'bowAim' | 'bowRelease'> {
    if (this.isUsingLance) return this.isMounted ? 'mountedLance' : 'lanceThrust'
    if (this.faction === Faction.ENEMY && this.tier === 1) return 'daggerSlash'
    return 'swordSlash'
  }

  private _setShieldPlacement(onBack: boolean, immediate = false): void {
    const targetParent = onBack ? this.bodyMesh : this.rig.left.handSocket
    if (this.shieldOnBack !== onBack || this.shieldPivot.parent !== targetParent) {
      this.shieldOnBack = onBack
      if (onBack) {
        this.bodyMesh.attach(this.shieldPivot)
        this.shieldTargetPosition.set(0, 0.3, 0.45)
        this.shieldTargetEuler.set(0, Math.PI, Math.PI / 8)
      } else {
        this.rig.left.handSocket.attach(this.shieldPivot)
        // The socket is the rear grip; the shared arm guard pose moves the
        // hand and shield forward together.
        this.shieldTargetPosition.set(0, 0.124, 0.019)
        this.shieldTargetEuler.set(-1.42, Math.PI, -0.12)
      }
      this.shieldTargetQuaternion.setFromEuler(this.shieldTargetEuler)
      this.shieldStartPosition.copy(this.shieldPivot.position)
      this.shieldStartQuaternion.copy(this.shieldPivot.quaternion)
      this.shieldTransitionElapsed = 0
    }
    if (immediate) {
      this.shieldPivot.position.copy(this.shieldTargetPosition)
      this.shieldPivot.quaternion.copy(this.shieldTargetQuaternion)
      this.shieldTransitionElapsed = 0.15
    }
  }

  private _updateShieldTransition(dt: number): void {
    this.shieldTransitionElapsed = Math.min(0.15, this.shieldTransitionElapsed + dt)
    const blend = this.shieldTransitionElapsed / 0.15
    this.shieldPivot.position.lerpVectors(this.shieldStartPosition, this.shieldTargetPosition, blend)
    this.shieldPivot.quaternion.slerpQuaternions(this.shieldStartQuaternion, this.shieldTargetQuaternion, blend)
  }

  private _getElevatedRangedAimPoint(targetWorld: THREE.Vector3): THREE.Vector3 {
    const origin = this._tmpRangedOrigin
    if (this.bowVisual) this.bowVisual.getNockPosition(origin)
    else origin.copy(this.group.position).setY(this.group.position.y + 1.0)

    const aimPoint = this._tmpRangedTarget.copy(targetWorld)
    aimPoint.y += 1.4
    const dx = aimPoint.x - origin.x
    const dz = aimPoint.z - origin.z
    const horizontalDistanceSq = dx * dx + dz * dz
    aimPoint.y += horizontalDistanceSq * RANGED_AIM_LIFT_PER_METER_SQ
    return aimPoint
  }

  private _updateBowVisual(drawRatio: number, targetWorld: THREE.Vector3): void {
    this.bowVisual?.update(drawRatio, this._getElevatedRangedAimPoint(targetWorld), this.arrows > 0)
  }

  private _createAlertSprite(): THREE.Sprite {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const ctx = canvas.getContext('2d')!

    ctx.fillStyle = '#ffeb3b'
    ctx.font = 'bold 52px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('!', 32, 32)

    const texture = new THREE.CanvasTexture(canvas)
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true })
    const sprite = new THREE.Sprite(mat)
    sprite.scale.set(0.8, 0.8, 1)
    return sprite
  }

  takeDamage(amount: number): boolean {
    if (this.state === AIState.DEAD) return false

    this.currentHp = Math.max(0, this.currentHp - amount)
    this.flashTimer = 0.15

    if (this.state === AIState.IDLE) {
      this.state = AIState.ALERT
      this.alertTimer = 0.4
      this.alertSprite.visible = true
    }

    if (this.currentHp <= 0) {
      this.dismountFromMount()
      this.state = AIState.DEAD
      this.respawnTimer = RESPAWN_TIME
      this.alertSprite.visible = false
    }
    return true
  }

  private _findTarget(player: Player, allNPCs: NPC[]): { position: THREE.Vector3, isDead: boolean, isPlayer: boolean, npc?: NPC } | null {
    let closestTarget = null
    let closestDistSq = Infinity

    // Check Player
    if (this.faction === Faction.ENEMY && !player.dead) {
      const dSq = this.combatPosition.distanceToSquared(player.combatPosition)
      if (dSq < closestDistSq) {
        closestDistSq = dSq
        closestTarget = { position: player.combatPosition, isDead: player.dead, isPlayer: true }
      }
    }

    // Check NPCs
    for (let i = 0; i < allNPCs.length; i++) {
      const npc = allNPCs[i]
      if (npc === this || npc.dead || npc.faction === this.faction) continue
      const dSq = this.combatPosition.distanceToSquared(npc.combatPosition)
      if (dSq < closestDistSq) {
        closestDistSq = dSq
        closestTarget = { position: npc.combatPosition, isDead: npc.dead, isPlayer: false, npc }
      }
    }

    return closestTarget
  }


  update(
    dt: number,
    player: Player,
    allNPCs: NPC[],
    nearbyNPCs: NPC[],
    obstacles: ObstacleData[],
    _playerHpBar: HpBar,
    onHitEntity: (damage: number, isPlayer: boolean, targetNpc?: NPC) => void,
    onFireArrow: (origin: THREE.Vector3, direction: THREE.Vector3, visualKind: 'arrow' | 'pilum') => void,
    skipBoidsAndObstacles: boolean = false
  ): void {
    const previousPosition = this.group.position.clone()
    this.visualMovementSpeed = 0
    if (this.mount) this.mount.beginControlledFrame()
    const startsWithShieldOnBack = this.arrows > 0 || (this.isUsingLance && !this.isMounted)
    this.animator.setShieldGuard(Boolean(this.shieldId) && !startsWithShieldOnBack)
    if (!this.animator.busy) {
      if (this.isUsingLance) this.animator.poseLanceReady(this.isMounted)
      else if (this.state !== AIState.ATTACK && this.state !== AIState.DEAD) this.animator.poseIdle()
    }

    if (this.flashTimer > 0) {
      this.flashTimer -= dt
      this.bodyMesh.traverse((child) => {
        if (this.shieldPivot.getObjectById(child.id)) return
        if ((child as THREE.Mesh).isMesh) (child as THREE.Mesh).material = this.flashMat
      })
      this.headMesh.material = this.flashMat
    } else {
      this.bodyMesh.traverse((child) => {
        if (this.shieldPivot.getObjectById(child.id)) return
        if ((child as THREE.Mesh).isMesh && child.userData.originalMat) {
          (child as THREE.Mesh).material = child.userData.originalMat
        }
      })
      this.headMesh.material = this.headMat
    }

    const targetInfo = this._findTarget(player, allNPCs)

    switch (this.state) {
      case AIState.IDLE: {
        this.alertSprite.visible = false
        this._updatePatrol(dt, obstacles, skipBoidsAndObstacles)

        if (targetInfo && !targetInfo.isDead) {
          const dist = this.combatPosition.distanceTo(targetInfo.position)
          if (dist <= DETECTION_RADIUS) {
            this.state = AIState.ALERT
            this.alertTimer = 0.6
            this.alertSprite.visible = true
          }
        }
        break
      }

      case AIState.ALERT: {
        this.alertTimer -= dt
        if (targetInfo) this._faceTarget(targetInfo.position)

        if (this.alertTimer <= 0) {
          this.alertSprite.visible = false
          this.state = AIState.CHASE
        }
        break
      }

      case AIState.CHASE: {
        this.alertSprite.visible = false
        if (!targetInfo || targetInfo.isDead) {
          this.state = AIState.IDLE
          break
        }

        const dist = this.combatPosition.distanceTo(targetInfo.position)
        if (dist > DETECTION_RADIUS * 1.5) {
          this.state = AIState.IDLE
          break
        }

        // Mounted archers draw swords and charge when enemy gets close
        if (this.arrows > 0 && this.isMounted && dist < RANGED_ATTACK_MIN) {
          this._switchToMelee()
        }

        const moveDir = this._tmpMoveDir

        if (this.arrows > 0) {
          // Ranged behavior
          if (dist <= RANGED_ATTACK_MAX && dist >= RANGED_ATTACK_MIN) {
            this.state = AIState.ATTACK
            this.attackTimer = 0
            break
          } else if (dist < RANGED_ATTACK_MIN) {
            // Flee (move backwards)
            moveDir.copy(this.group.position).sub(targetInfo.position)
          } else {
            // Approach
            moveDir.copy(targetInfo.position).sub(this.group.position)
          }
        } else {
          // Melee behavior
          if (dist <= this.meleeAttackRadius) {
            this.state = AIState.ATTACK
            this.attackTimer = 0
            this.attackHitProcessed = false
            break
          }
          // Approach
          moveDir.copy(targetInfo.position).sub(this.group.position)
        }

        moveDir.y = 0
        moveDir.normalize()

        // Boid separation & Obstacles
        if (!skipBoidsAndObstacles) {
          this._tmpSep.set(0, 0, 0)
          let sepCount = 0
          for (const other of nearbyNPCs) {
            if (other === this || other.dead) continue
            const d = this.group.position.distanceTo(other.position)
            if (d < 1.2) {
              this._tmpPush.copy(this.group.position).sub(other.position)
              this._tmpPush.y = 0
              this._tmpSep.add(this._tmpPush.normalize().multiplyScalar(1.5 / Math.max(0.1, d)))
              sepCount++
            }
          }
          if (sepCount > 0) {
            this._tmpSep.divideScalar(sepCount)
            moveDir.add(this._tmpSep).normalize()
          }

          moveDir.copy(getObstacleAvoidanceDirection(this.group.position, moveDir, 0.5, 2.3, 0, obstacles))
        }

        // Move towards target / flee + separation
        this._moveByDirection(moveDir, this.mount ? this.mount.baseSpeed : CHASE_SPEED, dt)
        
        // Map boundary clamp
        this.group.position.x = THREE.MathUtils.clamp(this.group.position.x, -95, 95)
        this.group.position.z = THREE.MathUtils.clamp(this.group.position.z, -95, 95)
        
        this._faceTarget(targetInfo.position)
        break
      }

      case AIState.ATTACK: {
        if (!targetInfo || targetInfo.isDead) {
          this.state = AIState.CHASE
          break
        }
        
        const dist = this.combatPosition.distanceTo(targetInfo.position)

        // Mounted archers draw swords and charge when enemy gets close
        if (this.arrows > 0 && this.isMounted && dist < RANGED_ATTACK_MIN) {
          this._switchToMelee()
          this.state = AIState.CHASE
          break
        }

        this._faceTarget(targetInfo.position)
        
        // Mounted Archers can move while attacking
        if (this.isMounted && this.arrows > 0) {
          const dist = this.combatPosition.distanceTo(targetInfo.position)
          const moveDir = this._tmpMoveDir
          if (dist < RANGED_ATTACK_MIN) {
            moveDir.copy(this.group.position).sub(targetInfo.position)
          } else if (dist > RANGED_ATTACK_MAX) {
            moveDir.copy(targetInfo.position).sub(this.group.position)
          } else {
            // Orbit target
            moveDir.copy(targetInfo.position).sub(this.group.position).cross(NPC._UP)
          }
          moveDir.y = 0
          if (moveDir.lengthSq() > 0.001) {
             moveDir.normalize()
             if (!skipBoidsAndObstacles) {
               moveDir.copy(getObstacleAvoidanceDirection(this.group.position, moveDir, 0.5, 2.3, 0, obstacles))
             }
             this._moveByDirection(moveDir, this.mount ? this.mount.baseSpeed : CHASE_SPEED, dt)
          }
        }

        if (this.arrows > 0) {
          this.attackTimer += dt
          const progress = Math.min(1, this.attackTimer / RANGED_COOLDOWN)

          if (this.faction === Faction.PLAYER) {
            if (!this.animator.busy) this.animator.poseBow(progress, Math.min(1, this.attackTimer / 0.18))
            this._updateBowVisual(progress, targetInfo.position)
            if (this.attackTimer >= RANGED_COOLDOWN && this.animator.currentAction === 'bowAim') {
              this.animator.start('bowRelease')
            }
          } else {
            this.animator.posePilum(progress)
          }

          const rangedEvents = this.animator.update(dt)
          const shouldFire = this.faction === Faction.PLAYER
            ? rangedEvents.projectileRelease
            : this.attackTimer >= RANGED_COOLDOWN
          if (shouldFire) {
            const origin = this._tmpRangedOrigin
            const dir = this._tmpRangedDirection
            const aimPoint = this._getElevatedRangedAimPoint(targetInfo.position)
            if (this.faction === Faction.PLAYER && this.bowVisual) {
              // Bow NPCs launch from the same nock and along the same visual
              // target line as the player-controlled bow.
              this.bowVisual.writeLaunch(origin, dir, aimPoint)
            } else {
              dir.copy(aimPoint).sub(origin).normalize()
            }
            onFireArrow(origin, dir, this.faction === Faction.ENEMY ? 'pilum' : 'arrow')
            this.bowVisual?.hideArrow()

            this.arrows -= 1
            if (this.arrows === 0) this._switchToMelee()

            this.attackTimer = 0
            this.state = AIState.CHASE
            this.animator.cancel()
          }
        } else {
          if (!this.animator.busy && this.attackTimer <= 0) {
            this.animator.start(this._meleeAction())
            this.attackHitProcessed = false
          }

          const meleeEvents = this.animator.update(dt)
          if (meleeEvents.hitActiveStarted && !this.attackHitProcessed) {
            const currentDist = this.combatPosition.distanceTo(targetInfo.position)
            if (currentDist <= this.meleeAttackRadius + 0.4) {
              this.attackHitProcessed = true
              const finalDamage = this._calcLanceDamage(this.meleeDamage)
              onHitEntity(finalDamage, targetInfo.isPlayer, targetInfo.npc)
            }
          }
          if (meleeEvents.actionCompleted) this.attackTimer = AI_ATTACK_GAP

          if (!this.animator.busy && this.attackTimer > 0) {
            this.attackTimer -= dt
            if (this.attackTimer <= 0 && this.combatPosition.distanceTo(targetInfo.position) > this.meleeAttackRadius) {
              this.state = AIState.CHASE
            }
          }
        }
        break
      }

      case AIState.DEAD: {
        this.rig.animation?.play('death', 0.12, false)
        this.group.rotation.z = THREE.MathUtils.lerp(this.group.rotation.z, Math.PI / 2, dt * 8)
        this.respawnTimer -= dt
        if (this.respawnTimer <= 0) {
          this.respawn()
        }
        break
      }
    }

    const needsShieldOnBack = this.arrows > 0 || (this.isUsingLance && !this.isMounted)
    if (this.state !== AIState.DEAD) this.animator.setLocomotion(this.visualMovementSpeed, this.isMounted)
    this._setShieldPlacement(needsShieldOnBack)
    this._updateShieldTransition(dt)

    if (this.state !== AIState.DEAD && this.isMounted && this.mount) {
      this.mount.finishControlledFrame(dt, obstacles)
      this._syncToMount()
    } else if (this.state !== AIState.DEAD) {
      this.group.rotation.x = 0 // reset posture
      // NPCs use the same terrain/platform gravity as the player and mounts.
      const terrainY = getTerrainHeight(this.group.position.x, this.group.position.z)
      this.velY += -22 * dt
      this.group.position.y += this.velY * dt
      if (this.group.position.y <= terrainY) {
        this.group.position.y = terrainY
        this.velY = 0
        this.onGround = true
      } else {
        this.onGround = false
      }

      const collision = resolveObstacleCollision(
        this.group.position,
        previousPosition,
        this.velY,
        this.onGround,
        0.5,
        2.3,
        0,
        obstacles,
      )
      this.velY = collision.velocityY
      this.onGround = collision.onGround
      
      // Global Map boundary clamp for foot NPCs
      this.group.position.x = THREE.MathUtils.clamp(this.group.position.x, -95, 95)
      this.group.position.z = THREE.MathUtils.clamp(this.group.position.z, -95, 95)
    }
  }

  private _updatePatrol(dt: number, obstacles: ObstacleData[], skipBoidsAndObstacles: boolean): void {
    const target = this.waypoints[this.currentWaypointIdx]
    const dist = this.group.position.distanceTo(target)

    if (dist < 0.5) {
      this.currentWaypointIdx = (this.currentWaypointIdx + 1) % this.waypoints.length
    } else {
      const dir = target.clone().sub(this.group.position)
      dir.y = 0
      dir.normalize()
      if (!skipBoidsAndObstacles) {
        dir.copy(getObstacleAvoidanceDirection(this.group.position, dir, 0.5, 2.3, 0, obstacles))
      }
      this._moveByDirection(dir, this.mount ? this.mount.baseSpeed * 0.5 : PATROL_SPEED, dt)
      this._faceTarget(target)
    }
  }

  private _moveByDirection(direction: THREE.Vector3, speed: number, dt: number): void {
    this.visualMovementSpeed = Math.max(this.visualMovementSpeed, speed)
    if (this.mount) {
      this.mount.addControlledMovement(direction, speed, dt)
    } else {
      this.group.position.addScaledVector(direction, speed * dt)
    }
  }

  private _syncToMount(): void {
    if (!this.mount) return
    applyCharacterMountedPose(this.rig, true, this.mount.type as MountedPoseKind)
    this._alignExternalVisualToMount(true)
    this.mount.getSaddleSeatWorld(this.group.position)
    this.group.rotation.x = this.mount.ridePitch
    this.group.rotation.y = this.mount.group.rotation.y
  }

  private _alignExternalVisualToMount(mounted: boolean): void {
    if (this.externalPelvisHeight <= 0) return
    this.characterVisualGroup.position.y = mounted ? -this.externalPelvisHeight : 0
  }

  private _faceTarget(targetPos: THREE.Vector3): void {
    const dir = targetPos.clone().sub(this.group.position)
    dir.y = 0
    if (dir.lengthSq() > 0.001) {
      const targetAngle = Math.atan2(dir.x, dir.z)
      this.group.rotation.y = targetAngle
      if (this.mount) this.mount.group.rotation.y = targetAngle
    }
  }

  /** Returns damage after applying lance charge multiplier (3x while galloping). */
  private _calcLanceDamage(baseDamage: number): number {
    if (this.isUsingLance && this.isMounted && this.mount && this.mount.movementSpeed > 10) {
      this.mount.skipImpactThisFrame = true
      return baseDamage * 3.0
    }
    return baseDamage
  }

  private _switchToMelee(): void {
    this.arrows = 0
    this.swordPivot.visible = true
    this.bowPivot.visible = false
    this.animator.cancel()
    this._setShieldPlacement(this.isUsingLance && !this.isMounted)
  }

  respawn(): void {
    this.state = AIState.IDLE
    this.currentHp = this.maxHp
    if (this.aiType === AIType.RANGED) {
      this.arrows = 1
      this.swordPivot.visible = false
      this.bowPivot.visible = true
      this._setShieldPlacement(true, true)
    } else {
      this.arrows = 0
      this.swordPivot.visible = true
      this.bowPivot.visible = false
      this._setShieldPlacement(this.isUsingLance && !this.isMounted, true)
    }

    const terrainY = getTerrainHeight(this.spawnX, this.spawnZ)
    this.group.position.set(this.spawnX, terrainY, this.spawnZ)
    this.velY = 0
    this.onGround = true
    this.group.rotation.set(0, 0, 0)
    this._alignExternalVisualToMount(false)
    this.animator.cancel()
    this.alertSprite.visible = false
  }
}
