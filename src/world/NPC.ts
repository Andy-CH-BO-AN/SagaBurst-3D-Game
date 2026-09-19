import { applyEquipmentAttachment } from './EquipmentAttachmentContract'
/**
 * NPC.ts
 * Generic NPC AI unit (Faction System, Melee/Ranged).
 * Calibrated with getTerrainHeight(x, z) for procedural heightmap terrain.
 */
import * as THREE from 'three'
import type { Player } from '../player/Player'
import type { HpBar } from '../ui/HpBar'
import { clampToPlayableWorld, getObstacleAvoidanceDirection, getTerrainHeight, ObstacleData, resolveObstacleCollision } from './Terrain'
import { applyCharacterMountedPose, buildCharacterVisual, polishWeaponMaterials } from './CharacterVisuals'
import type { CharacterRig, MountedPoseKind, CharacterFaction } from './CharacterVisuals'
import { HumanoidAssetRegistry } from './HumanoidAssetRegistry'
import { AIM_RAYCAST_LAYER } from './AimTargetRegistry'

const NPC_AIM_GEOMETRY = new THREE.CylinderGeometry(0.45, 0.45, 1.85, 8)
const AIM_PROXY_MATERIAL = new THREE.MeshBasicMaterial()
import { CharacterCombatAnimator, type CombatAction } from './CharacterCombatAnimator'
import { CharacterBowVisual } from './CharacterBowVisual'
import { applyAttachmentContract } from './HumanoidAttachmentContract'
import { applySwordAttachment, weaponGripWorld } from './SwordAttachmentContract'
import { applyBowAttachment } from './BowAttachmentContract'
import { DEFAULT_MOUNT_TYPE, Mount } from './Mount'
import { horseVariantForStableKey } from './HorseAssetRegistry'
import { EquipmentVisualLODController } from './EquipmentVisualLODController'
import { WeaponMeshFactory } from './WeaponMeshFactory'
import { getUnitCombatProfile, BattleUnitType } from '../battle/BattleConfig'
import { getDirectionalMovementFromVector, getEffectiveSpeedMultiplier } from '../movement/DirectionalMovement'
import type { NpcSubphaseCollector } from '../debug/NpcSubphaseProfiler'

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

export const TARGET_REACQUIRE_INTERVAL = 0.1
export const NPC_SEPARATION_RADIUS = 1.2
export const NPC_NEIGHBOR_QUERY_RADIUS = 2.0

export function computeDeterministicPhase(spawnX: number, spawnZ: number, name: string): number {
  let hash = 2166136261 >>> 0
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i)
    hash = Math.imul(hash, 16777619) >>> 0
  }
  const xInt = Math.round(spawnX * 100) | 0
  const zInt = Math.round(spawnZ * 100) | 0
  hash ^= xInt
  hash = Math.imul(hash, 16777619) >>> 0
  hash ^= zInt
  hash = Math.imul(hash, 16777619) >>> 0
  return (hash >>> 0) / 4294967296
}

export class NPC {
  // Visuals
  group: THREE.Group
  characterVisualGroup: THREE.Group
  readonly faction: Faction
  readonly characterFaction: CharacterFaction
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
  public shieldId: string | null = null
  readonly equipmentVisualLOD = new EquipmentVisualLODController()
  private builtShieldId: string | null | undefined = undefined

  private flashMat: THREE.MeshBasicMaterial
  private _isFlashing = false
  private _flashTargets: Array<{ mesh: THREE.Mesh; originalMat: THREE.Material | THREE.Material[] }> = []

  readonly maxHp = 120
  private currentHp = 120

  private state: AIState = AIState.IDLE
  private alertTimer = 0
  private attackTimer = 0
  private attackHitProcessed = false

  private flashTimer = 0
  private respawnTimer = 0
  public respawnEnabled = true
  public readonly aimCollider: THREE.Mesh
  public readonly onDeathCallbacks: Array<(npc: NPC) => void> = []
  public readonly onRespawnCallbacks: Array<(npc: NPC) => void> = []

  private spawnX: number
  private spawnZ: number
  private waypoints: THREE.Vector3[] = []
  private currentWaypointIdx = 0

  private arrows: number = 0
  private bowArrowReleased = false
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
  private readonly _tmpFacing = new THREE.Vector3()
  private readonly _tmpToTarget = new THREE.Vector3()
  private readonly _tmpPreviousPosition = new THREE.Vector3()
  private readonly _tmpPatrolDir = new THREE.Vector3()
  private readonly _tmpFaceDir = new THREE.Vector3()
  private readonly _tmpDismountPosition = new THREE.Vector3()
  private readonly _tmpTargetPosition = new THREE.Vector3()
  private readonly _liveTargetInfo: { position: THREE.Vector3; isDead: boolean; isPlayer: boolean; npc?: NPC } = {
    position: new THREE.Vector3(),
    isDead: false,
    isPlayer: false,
    npc: undefined,
  }
  private _cachedTargetIsPlayer: boolean = false
  private _cachedTargetNpc: NPC | null = null
  private _targetAcquisitionInitialized: boolean = false
  private _targetReacquireTimer: number = 0
  private readonly _initialStaggerPhase: number
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
    return weaponGripWorld(this.swordGripPivot, target)
  }

  constructor(
    scene: THREE.Scene,
    spawnX: number,
    spawnZ: number,
    faction: Faction,
    characterFaction: CharacterFaction,
    aiType: AIType,
    name: string,
    tier: 1 | 2 | 3,
    cavalry?: boolean,
  ) {
    this.spawnX = spawnX
    this.spawnZ = spawnZ
    this.faction = faction
    this.characterFaction = characterFaction
    this.aiType = aiType
    this.name = name
    this.tier = tier
    this.generatedAsCavalry = cavalry ?? Math.random() < 0.4
    this._initialStaggerPhase = computeDeterministicPhase(spawnX, spawnZ, name)

    if (this.aiType === AIType.RANGED) {
      this.arrows = 30
    } else {
      this.arrows = 0
    }

    // Assign authoritative combat profile & damages from BattleConfig
    const unitType: BattleUnitType = this.generatedAsCavalry
      ? (this.aiType === AIType.RANGED ? 'horseArcher' : 'cavalry')
      : (this.aiType === AIType.RANGED ? 'archer' : 'infantry')
    const combatProfile = getUnitCombatProfile(this.characterFaction, unitType, this.tier)

    this.meleeDamage = combatProfile.finalMeleeDamage
    this.rangedDamage = combatProfile.rangedDamage ?? 0
    this.isUsingLance = combatProfile.isUsingLance
    this.shieldId = combatProfile.shieldId
    if (this.isUsingLance) {
      this.meleeAttackRadius = 3.9
    }

    // Calibrate waypoints to terrain height
    const baseTerrainY = getTerrainHeight(spawnX, spawnZ)
    const basePos = new THREE.Vector3(spawnX, baseTerrainY, spawnZ)

    const wp1 = new THREE.Vector3(spawnX - 10, getTerrainHeight(spawnX - 10, spawnZ - 8), spawnZ - 8)
    const wp2 = new THREE.Vector3(spawnX + 8, getTerrainHeight(spawnX + 8, spawnZ - 12), spawnZ - 12)
    this.waypoints = [basePos.clone(), wp1, wp2]

    this.group = new THREE.Group()
    this.group.name = `npc_${faction}_${aiType}`

    this.characterVisualGroup = new THREE.Group()
    this.characterVisualGroup.rotation.y = 0 // Shared +Z gameplay heading; no per-faction flip.
    this.group.add(this.characterVisualGroup)

    this.aimCollider = new THREE.Mesh(NPC_AIM_GEOMETRY, AIM_PROXY_MATERIAL)
    this.aimCollider.name = `aim_proxy_${faction}_${name}`
    this.aimCollider.position.set(0, 0.925, 0)
    this.aimCollider.layers.set(AIM_RAYCAST_LAYER)
    this.group.add(this.aimCollider)

    this.flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
    const visualConfig = {
      faction: this.characterFaction,
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
    applyAttachmentContract(this.rig.right.handSocket, 'r', this.swordPivot, 'melee', this.characterFaction === 'viking' ? 0.15 : 0.10)
    this.swordPivot.userData.swordAttachmentOwned = false
    this.rig.right.handSocket.add(this.swordPivot)

    this.bowPivot = new THREE.Group()
    this.bowGripPivot = new THREE.Group()
    this.bowPivot.add(this.bowGripPivot)
    if (this.characterFaction === 'roman') {
      applyAttachmentContract(this.rig.right.handSocket, 'r', this.bowPivot, 'ranged', 0)
      this.rig.right.handSocket.add(this.bowPivot)
    } else {
      applyBowAttachment(this.rig.left.handSocket, this.bowPivot)
      this.rig.left.handSocket.add(this.bowPivot)
    }

    this.shieldPivot = new THREE.Group()
    this.rig.left.handSocket.add(this.shieldPivot)
    this.shieldPivot.position.set(0, 0.124, 0.019)
    this.shieldPivot.rotation.set(-1.42, Math.PI, -0.12)

    this.animator = new CharacterCombatAnimator(this.rig, this.swordPivot, this.bowPivot)

    this.swordTipLocal.copy(
      WeaponMeshFactory.buildNpcMelee(
        this.characterFaction,
        this.aiType === AIType.RANGED ? 1 : this.tier,
        this.isUsingLance,
        this.swordGripPivot,
      ),
    )
    this.swordGripPivot.position.set(0, 0, 0)
    this.swordGripPivot.rotation.set(0, 0, 0)
    if (this.rig.equipmentGripFrames && this.isUsingLance) applyEquipmentAttachment(this.rig.right.handSocket, this.swordPivot, this.swordGripPivot, this.rig.equipmentGripFrames.lanceRight, 'lance')
    if (this.rig.swordGripFrame && !this.isUsingLance) {
      applySwordAttachment(this.rig.right.handSocket, this.swordPivot, this.swordGripPivot, this.rig.swordGripFrame, this.rig.equipmentGripFrames?.lanceRight.modelRotationLocal)
    }
    if (this.characterFaction === 'viking') {
      this.bowVisual = new CharacterBowVisual(this.bowPivot, this.bowGripPivot)
      this.bowVisual.rebuild(combatProfile.rangedWeaponId || 'wooden_shortbow', true)
    } else {
      WeaponMeshFactory.buildNpcRanged(this.characterFaction, this.tier, this.bowGripPivot)
    }
    polishWeaponMaterials(this.swordPivot)
    polishWeaponMaterials(this.bowPivot)

    if (this.hasActiveRangedWeapon) {
      this.swordPivot.visible = false
      this.bowPivot.visible = true
    } else {
      this.swordPivot.visible = true
      this.bowPivot.visible = false
      if (this.isUsingLance) {
        this.animator.poseMountedLanceReady()
      }
    }

    this.rebuildShield()
    this.equipmentVisualLOD.register(this.isUsingLance ? 'lance' : 'sword', this.swordGripPivot)
    this.equipmentVisualLOD.register(this.bowVisual ? 'bow' : 'pilum', this.bowGripPivot)
    // Equipment proxies are siblings of this LOD, so its render-time selection
    // reaches the detail children before the renderer submits those proxies.
    const humanoidLOD = this.bodyMesh.children.find((child): child is THREE.LOD => child instanceof THREE.LOD)
    if (humanoidLOD) this.equipmentVisualLOD.followHumanoid(humanoidLOD)
    this._initFlashTargets()

    this.alertSprite = this._createAlertSprite()
    this.alertSprite.position.set(0, 2.3, 0)
    this.alertSprite.visible = false
    this.group.add(this.alertSprite)

    this.group.position.copy(basePos)
    scene.add(this.group)

    if (this.generatedAsCavalry) {
      const horseVariant = horseVariantForStableKey(`${this.characterFaction}:${this.name}:${this.tier}`)
      this.mount = new Mount(scene, DEFAULT_MOUNT_TYPE, spawnX, spawnZ, basePos.y, horseVariant)
      this.mount.setNpcRider(this, this.faction)
      this._syncToMount()
    }
  }

  private _initFlashTargets(): void {
    this._flashTargets = []
    this.bodyMesh.traverse((child) => {
      if (this.shieldPivot.getObjectById(child.id)) return
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh
        const originalMat = (mesh.userData.originalMat ?? mesh.material) as THREE.Material | THREE.Material[]
        mesh.userData.originalMat = originalMat
        this._flashTargets.push({ mesh, originalMat })
      }
    })
  }

  private _applyDamageFlash(): void {
    for (let i = 0; i < this._flashTargets.length; i++) {
      this._flashTargets[i].mesh.material = this.flashMat
    }
    this.headMesh.material = this.flashMat
  }

  private _restoreDamageFlash(): void {
    for (let i = 0; i < this._flashTargets.length; i++) {
      this._flashTargets[i].mesh.material = this._flashTargets[i].originalMat
    }
    this.headMesh.material = this.headMat
  }

  /**
   * DEV-only diagnostic hook to replace character and equipment materials with simple diagnostic materials.
   * Updates _flashTargets and headMat so that hit flash restoration returns to simple materials.
   */
  devApplySimpleMaterials(getDiagnosticMaterial: (sourceMat: THREE.Material, isSkinned: boolean) => THREE.Material): void {
    if (!import.meta.env.DEV) return

    const replaceMaterial = (mesh: THREE.Mesh): void => {
      const isSkinned = (mesh as THREE.SkinnedMesh).isSkinnedMesh === true
      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map((mat) => getDiagnosticMaterial(mat, isSkinned))
      } else if (mesh.material) {
        mesh.material = getDiagnosticMaterial(mesh.material, isSkinned)
      }
    }

    const roots = [this.bodyMesh, this.swordPivot, this.bowPivot, this.shieldPivot]
    for (const root of roots) {
      if (!root) continue
      root.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          replaceMaterial(child as THREE.Mesh)
        }
      })
    }

    if (this.headMesh && (this.headMesh as THREE.Mesh).isMesh) {
      const isSkinned = (this.headMesh as THREE.SkinnedMesh).isSkinnedMesh === true
      this.headMat = getDiagnosticMaterial(this.headMat, isSkinned) as THREE.MeshStandardMaterial
      this.headMesh.material = this.headMat
    }

    for (const target of this._flashTargets) {
      target.originalMat = target.mesh.material
    }
  }

  /** Releases this NPC from its mount and returns it to a normal walking body. */
  dismountFromMount(): void {
    if (!this.mount) return
    const mountPosition = this._tmpDismountPosition.copy(this.mount.group.position)
    this.mount.releaseRider()
    this.mount = null
    if (!this.rig.equipmentGripFrames) applyCharacterMountedPose(this.rig, false)
    this.rig.animation?.setEquipmentState?.({ mounted: false })
    this.animator.setLocomotion(0, false)
    this.rig.animation?.update(0)
    this._alignExternalVisualToMount(false)
    this.group.position.copy(mountPosition)
  }

  rebuildShield(): void {
    if (this.builtShieldId === this.shieldId) return
    this.builtShieldId = this.shieldId
    this.animator?.cancel()
    if (this.bowVisual) {
      this.bowArrowReleased = false
      this.attackTimer = 0
      this.bowVisual.hideArrow()
      this.bowPivot.visible = this.hasActiveRangedWeapon
      this.swordPivot.visible = !this.hasActiveRangedWeapon
    }

    while (this.shieldPivot.children.length > 0) {
      this.shieldPivot.remove(this.shieldPivot.children[0])
    }
    if (this.shieldId) {
      WeaponMeshFactory.buildShield(this.shieldId, this.shieldPivot)
      polishWeaponMaterials(this.shieldPivot)
      if (this.rig.equipmentGripFrames) applyEquipmentAttachment(this.rig.left.handSocket, this.shieldPivot, this.shieldPivot, this.rig.equipmentGripFrames.shieldLeft, 'shield')
    }
    this.equipmentVisualLOD.register('shield', this.shieldPivot)
  }

  private get hasActiveRangedWeapon(): boolean {
    return this.arrows > 0 && !(this.shieldId && this.bowVisual)
  }

  private _meleeAction(): Exclude<CombatAction, 'idle' | 'bowAim' | 'bowRelease'> {
    if (this.isUsingLance) return this.isMounted ? 'mountedLance' : 'lanceThrust'
    return 'swordSlash'
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
    this.bowVisual?.update(drawRatio, this._getElevatedRangedAimPoint(targetWorld), this.hasActiveRangedWeapon && !this.bowArrowReleased)
  }

  private _createAlertSprite(): THREE.Sprite {
    if (typeof document === 'undefined') {
      return new THREE.Sprite()
    }
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
    if (!this._isFlashing) {
      this._isFlashing = true
      this._applyDamageFlash()
    }

    if (this.state === AIState.IDLE) {
      this.state = AIState.ALERT
      this.alertTimer = 0.4
      this.alertSprite.visible = true
    }

    if (this.currentHp <= 0) {
      this.dismountFromMount()
      this.state = AIState.DEAD
      this.animator.setEquipment(this.isUsingLance, Boolean(this.shieldId), undefined, false)
      this.rig.animation?.setEquipmentState?.({ mounted: false })
      this.respawnTimer = RESPAWN_TIME
      this.alertSprite.visible = false
      for (const cb of this.onDeathCallbacks) cb(this)
    }
    return true
  }

  private _getPlayerPosition(player: Player, out: THREE.Vector3): THREE.Vector3 {
    if (player.isMounted && player.currentMount) {
      return out.copy(player.currentMount.group.position)
    }
    return out.copy(player.group.position)
  }

  private _isCachedTargetValid(player: Player): boolean {
    if (this._cachedTargetIsPlayer) {
      return this.faction === Faction.ENEMY && player.targetable && !player.dead
    }
    if (this._cachedTargetNpc !== null) {
      return !this._cachedTargetNpc.dead && this._cachedTargetNpc.faction !== this.faction
    }
    return false
  }

  private _acquireTarget(player: Player, allNPCs: NPC[]): void {
    const target = this._findTarget(player, allNPCs)
    if (target === null) {
      this._cachedTargetIsPlayer = false
      this._cachedTargetNpc = null
    } else {
      this._cachedTargetIsPlayer = target.isPlayer
      this._cachedTargetNpc = target.npc ?? null
    }
  }

  private _getTarget(
    dt: number,
    player: Player,
    allNPCs: NPC[],
  ): { position: THREE.Vector3; isDead: boolean; isPlayer: boolean; npc?: NPC } | null {
    if (!this._targetAcquisitionInitialized) {
      this._targetAcquisitionInitialized = true
      this._acquireTarget(player, allNPCs)
      this._targetReacquireTimer = this._initialStaggerPhase * TARGET_REACQUIRE_INTERVAL
    } else {
      const hadTarget = this._cachedTargetIsPlayer || this._cachedTargetNpc !== null
      const targetValid = this._isCachedTargetValid(player)

      if (hadTarget && !targetValid) {
        this._acquireTarget(player, allNPCs)
        this._targetReacquireTimer = this._initialStaggerPhase * TARGET_REACQUIRE_INTERVAL
      } else {
        this._targetReacquireTimer -= dt
        if (this._targetReacquireTimer <= 0) {
          this._acquireTarget(player, allNPCs)
          this._targetReacquireTimer += TARGET_REACQUIRE_INTERVAL
          while (this._targetReacquireTimer <= 0) {
            this._targetReacquireTimer += TARGET_REACQUIRE_INTERVAL
          }
        }
      }
    }

    if (this._cachedTargetIsPlayer) {
      this._getPlayerPosition(player, this._tmpTargetPosition)
      this._liveTargetInfo.position = this._tmpTargetPosition
      this._liveTargetInfo.isDead = player.dead
      this._liveTargetInfo.isPlayer = true
      this._liveTargetInfo.npc = undefined
      return this._liveTargetInfo
    }
    if (this._cachedTargetNpc !== null) {
      this._liveTargetInfo.position = this._cachedTargetNpc.combatPosition
      this._liveTargetInfo.isDead = this._cachedTargetNpc.dead
      this._liveTargetInfo.isPlayer = false
      this._liveTargetInfo.npc = this._cachedTargetNpc
      return this._liveTargetInfo
    }
    return null
  }

  private _findTarget(player: Player, allNPCs: NPC[]): { position: THREE.Vector3, isDead: boolean, isPlayer: boolean, npc?: NPC } | null {
    let closestTarget = null
    let closestDistSq = Infinity

    // Check Player
    if (this.faction === Faction.ENEMY && player.targetable) {
      const playerPos = this._getPlayerPosition(player, this._tmpTargetPosition)
      const dSq = this.combatPosition.distanceToSquared(playerPos)
      if (dSq < closestDistSq) {
        closestDistSq = dSq
        closestTarget = { position: playerPos, isDead: player.dead, isPlayer: true }
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
    skipBoidsAndObstacles: boolean = false,
    cameraDistance: number = 0,
    _collector: NpcSubphaseCollector | null = null
  ): void {
    if (this.state === AIState.DEAD) {
      if (import.meta.env.DEV && _collector) { var _tDead = performance.now() }
      if (this._isFlashing) {
        this.flashTimer -= dt
        if (this.flashTimer <= 0) {
          this.flashTimer = 0
          this._isFlashing = false
          this._restoreDamageFlash()
        }
      }
      this.rig.animation?.play('death', { fadeSeconds: 0.12, loop: false })
      this.group.rotation.z = THREE.MathUtils.lerp(this.group.rotation.z, Math.PI / 2, dt * 8)
      this.animator.update(dt, cameraDistance)
      if (this.respawnEnabled) {
        this.respawnTimer -= dt
        if (this.respawnTimer <= 0) {
          this.respawn()
        }
      }
      if (import.meta.env.DEV && _collector) { _collector.endPhase('deadUpdate', _tDead!) }
      return
    }

    const previousPosition = this._tmpPreviousPosition.copy(this.group.position)
    this.visualMovementSpeed = 0
    let animationAdvanced = false
    if (this.mount) this.mount.beginControlledFrame()
    const recoveringBow = this.animator.currentAction === 'bowRelease' && this.bowArrowReleased
    this.rebuildShield()
    this.animator.setEquipment(this.isUsingLance, Boolean(this.shieldId), this.mount?.type as MountedPoseKind | undefined, true)
    this.rig.animation?.setEquipmentState?.({ mounted: this.isMounted })
    if (!this.animator.busy && this.isUsingLance) this.animator.poseLanceReady(this.isMounted)

    if (this._isFlashing) {
      this.flashTimer -= dt
      if (this.flashTimer <= 0) {
        this.flashTimer = 0
        this._isFlashing = false
        this._restoreDamageFlash()
      }
    }

    if (import.meta.env.DEV && _collector) { var _tTargetAI = performance.now() }
    const targetInfo = this._getTarget(dt, player, allNPCs)
    if (import.meta.env.DEV && _collector) { _collector.endPhase('targetAI', _tTargetAI!) }

    // Releasing the projectile does not end the imported release clip. Keep its
    // recovery, even if this was the last arrow or the target disappears.
    if (recoveringBow) {
      if (import.meta.env.DEV && _collector) { var _tAnimBowRec = performance.now() }
      const events = this.animator.update(dt, cameraDistance)
      if (import.meta.env.DEV && _collector) { _collector.endPhase('humanoidAnim', _tAnimBowRec!) }
      animationAdvanced = true
      if (targetInfo) this._updateBowVisual(0, targetInfo.position)
      else this.bowVisual?.update(0, undefined, false)
      if (events.actionCompleted) {
        if (this.arrows === 0) this._switchToMelee()
        this.state = AIState.CHASE
      }
    } else switch (this.state) {
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

        // Ranged NPCs (both foot and mounted) switch to melee when enemy gets close (< 6m)
        if (this.hasActiveRangedWeapon && dist < RANGED_ATTACK_MIN) {
          this._switchToMelee()
        }

        const moveDir = this._tmpMoveDir

        if (this.hasActiveRangedWeapon) {
          // Ranged behavior (6 <= dist <= 22)
          if (dist <= RANGED_ATTACK_MAX && dist >= RANGED_ATTACK_MIN) {
            this.state = AIState.ATTACK
            this.attackTimer = 0
            break
          } else {
            // Approach when dist > 22
            moveDir.copy(targetInfo.position).sub(this.group.position)
          }
        } else {
          // Melee behavior
          if (this._isTargetInMeleeRange(targetInfo.position)) {
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
          if (import.meta.env.DEV && _collector) { var _tSep = performance.now() }
          this._tmpSep.set(0, 0, 0)
          let sepCount = 0
          for (const other of nearbyNPCs) {
            if (other === this || other.dead) continue
            const d = this.group.position.distanceTo(other.position)
            if (d < NPC_SEPARATION_RADIUS) {
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
          if (import.meta.env.DEV && _collector) { _collector.endPhase('separation', _tSep!) }

          if (import.meta.env.DEV && _collector) { var _tObs = performance.now() }
          moveDir.copy(getObstacleAvoidanceDirection(this.group.position, moveDir, 0.5, 2.3, 0, obstacles))
          if (import.meta.env.DEV && _collector) { _collector.endPhase('obstacleAvoid', _tObs!) }
        }

        // Face target before applying directional movement
        if (import.meta.env.DEV && _collector) { var _tMvF = performance.now() }
        this._faceTarget(targetInfo.position)

        // Move towards target / charge + separation
        this._moveByDirection(moveDir, this.mount ? this.mount.baseSpeed : CHASE_SPEED, dt)
        
        // Keep chase movement inside the shared playable world boundary.
        clampToPlayableWorld(this.group.position)
        if (import.meta.env.DEV && _collector) { _collector.endPhase('moveFace', _tMvF!) }
        break
      }

      case AIState.ATTACK: {
        if (!targetInfo || targetInfo.isDead) {
          this.state = AIState.CHASE
          break
        }
        
        const dist = this.combatPosition.distanceTo(targetInfo.position)

        // Ranged NPCs (both foot and mounted) draw swords and commit to melee when enemy gets close (< 6m)
        if (this.hasActiveRangedWeapon && dist < RANGED_ATTACK_MIN) {
          this._switchToMelee()
          this.state = AIState.CHASE
          break
        }

        // Target retreated beyond max ranged attack distance (> 22m), approach in CHASE
        if (this.hasActiveRangedWeapon && dist > RANGED_ATTACK_MAX) {
          this.animator.cancel()
          this.state = AIState.CHASE
          break
        }

        if (import.meta.env.DEV && _collector) { var _tFaceAtk = performance.now() }
        this._faceTarget(targetInfo.position)
        if (import.meta.env.DEV && _collector) { _collector.endPhase('moveFace', _tFaceAtk!) }

        // Mounted Archers orbit target while attacking within 6m <= dist <= 22m
        if (this.isMounted && this.hasActiveRangedWeapon) {
          const moveDir = this._tmpMoveDir
          // Orbit target
          moveDir.copy(targetInfo.position).sub(this.group.position).cross(NPC._UP)
          moveDir.y = 0
          if (moveDir.lengthSq() > 0.001) {
             moveDir.normalize()
             if (!skipBoidsAndObstacles) {
               if (import.meta.env.DEV && _collector) { var _tObsOrbit = performance.now() }
               moveDir.copy(getObstacleAvoidanceDirection(this.group.position, moveDir, 0.5, 2.3, 0, obstacles))
               if (import.meta.env.DEV && _collector) { _collector.endPhase('obstacleAvoid', _tObsOrbit!) }
             }
             if (import.meta.env.DEV && _collector) { var _tOrbitMove = performance.now() }
             this._moveByDirection(moveDir, this.mount ? this.mount.baseSpeed : CHASE_SPEED, dt)
             if (import.meta.env.DEV && _collector) { _collector.endPhase('moveFace', _tOrbitMove!) }
          }
        }

        if (import.meta.env.DEV && _collector) { var _tCombat = performance.now() }
        if (this.hasActiveRangedWeapon) {
          this.attackTimer += dt
          const progress = Math.min(1, this.attackTimer / RANGED_COOLDOWN)

          if (this.characterFaction === 'viking') {
            if (!this.animator.busy) {
              this.bowArrowReleased = false
              this.animator.poseBow(progress, Math.min(1, this.attackTimer / 0.18))
            }
            if (this.attackTimer >= RANGED_COOLDOWN && this.animator.currentAction === 'bowAim') {
              this.animator.start('bowRelease')
            }
          } else {
            if (!this.animator.busy) this.animator.start('pilumThrow')
          }

          if (import.meta.env.DEV && _collector) { _collector.endPhase('combatLogic', _tCombat!) }
          if (import.meta.env.DEV && _collector) { var _tAnimAtk = performance.now() }
          const rangedEvents = this.animator.update(dt, cameraDistance)
          if (import.meta.env.DEV && _collector) { _collector.endPhase('humanoidAnim', _tAnimAtk!) }
          if (this.characterFaction === 'viking') this._updateBowVisual(progress, targetInfo.position)
          animationAdvanced = true
          const shouldFire = rangedEvents.projectileRelease
          if (shouldFire) {
            const origin = this._tmpRangedOrigin
            const dir = this._tmpRangedDirection
            const aimPoint = this._getElevatedRangedAimPoint(targetInfo.position)
            if (this.characterFaction === 'viking' && this.bowVisual) {
              // Bow NPCs launch from the same nock and along the same visual
              // target line as the player-controlled bow.
              this.bowVisual.writeLaunch(origin, dir, aimPoint)
            } else {
              dir.copy(aimPoint).sub(origin).normalize()
            }
            onFireArrow(origin, dir, this.characterFaction === 'roman' ? 'pilum' : 'arrow')
            this.bowVisual?.hideArrow()

            this.arrows -= 1
            this.attackTimer = 0
            if (this.characterFaction === 'viking' && !rangedEvents.actionCompleted) {
              this.bowArrowReleased = true
            } else {
              if (this.arrows === 0) this._switchToMelee()
              this.state = AIState.CHASE
              this.animator.cancel()
            }
          }
        } else {
          if (!this.animator.busy && this.attackTimer <= 0) {
            this.animator.start(this._meleeAction())
            this.attackHitProcessed = false
          }

          this.animator.setLocomotion(this.visualMovementSpeed, this.isMounted)
          if (import.meta.env.DEV && _collector) { _collector.endPhase('combatLogic', _tCombat!) }
          if (import.meta.env.DEV && _collector) { var _tAnimMelee = performance.now() }
          const meleeEvents = this.animator.update(dt, cameraDistance)
          if (import.meta.env.DEV && _collector) { _collector.endPhase('humanoidAnim', _tAnimMelee!) }
          animationAdvanced = true
          if (meleeEvents.hitActiveStarted && !this.attackHitProcessed) {
            if (this._isTargetInMeleeRange(targetInfo.position, 0.4)) {
              this.attackHitProcessed = true
              const finalDamage = this._calcLanceDamage(this.meleeDamage)
              onHitEntity(finalDamage, targetInfo.isPlayer, targetInfo.npc)
            }
          }
          if (meleeEvents.actionCompleted) this.attackTimer = AI_ATTACK_GAP

          if (!meleeEvents.actionCompleted && !this.animator.busy && this.attackTimer > 0) {
            this.attackTimer -= dt
            if (this.attackTimer <= 0 && !this._isTargetInMeleeRange(targetInfo.position)) {
              this.state = AIState.CHASE
            }
          }
        }
        break
      }
    }

    this.rig.animation?.setSwordHandShape?.(this.swordPivot.visible && (this.swordPivot.userData.swordAttachmentOwned === true || this.swordPivot.userData.equipmentAttachmentOwned === 'lance'))
    if (!this.animator.busy && !animationAdvanced) {
      if (this.bowPivot.visible && this.characterFaction === 'viking') this.animator.poseBow(0)
      else if (!this.isUsingLance && (this.visualMovementSpeed <= 0.1 || this.animator.currentAction === 'bowAim')) this.animator.poseIdle()
    }
    this.animator.setLocomotion(this.visualMovementSpeed, this.isMounted)
    // Patrol/chase previously selected walk/run after the only possible mixer
    // update, while those states did not update the animator at all. Advance
    // exactly once here for every non-combat frame (including death clips).
    if (!animationAdvanced) {
      if (import.meta.env.DEV && _collector) { var _tAnimIdle = performance.now() }
      this.animator.update(dt, cameraDistance)
      if (import.meta.env.DEV && _collector) { _collector.endPhase('humanoidAnim', _tAnimIdle!) }
    }
    if (!animationAdvanced && this.bowPivot.visible && this.characterFaction === 'viking') {
      this._tmpRangedTarget.set(0, 0, 10).applyQuaternion(this.group.quaternion).add(this.group.position)
      this._tmpRangedTarget.y += 1.4
      this.bowVisual?.update(0, this._tmpRangedTarget, false)
    }

    if (this.isMounted && this.mount) {
      if (import.meta.env.DEV && _collector) { var _tMount = performance.now() }
      this.mount.finishControlledFrame(dt, obstacles, _collector)
      this._syncToMount(_collector)
      if (import.meta.env.DEV && _collector) { _collector.endPhase('mountUpdate', _tMount!) }
    } else {
      if (import.meta.env.DEV && _collector) { var _tFoot = performance.now() }
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
      
      // Re-apply after terrain / obstacle resolution for foot NPCs.
      clampToPlayableWorld(this.group.position)
      if (import.meta.env.DEV && _collector) { _collector.endPhase('footPhysics', _tFoot!) }
    }
  }

  private _updatePatrol(dt: number, obstacles: ObstacleData[], skipBoidsAndObstacles: boolean): void {
    const target = this.waypoints[this.currentWaypointIdx]
    const dist = this.group.position.distanceTo(target)

    if (dist < 0.5) {
      this.currentWaypointIdx = (this.currentWaypointIdx + 1) % this.waypoints.length
    } else {
      const dir = this._tmpPatrolDir.copy(target).sub(this.group.position)
      dir.y = 0
      dir.normalize()
      if (!skipBoidsAndObstacles) {
        dir.copy(getObstacleAvoidanceDirection(this.group.position, dir, 0.5, 2.3, 0, obstacles))
      }
      this._faceTarget(target)
      this._moveByDirection(dir, this.mount ? this.mount.baseSpeed * 0.5 : PATROL_SPEED, dt)
    }
  }

  private _moveByDirection(direction: THREE.Vector3, baseSpeed: number, dt: number): void {
    if (direction.lengthSq() <= 0.0001) return
    direction.normalize()

    const facingYaw = this.mount ? this.mount.group.rotation.y : this.group.rotation.y
    const facing = this._tmpFacing.set(Math.sin(facingYaw), 0, Math.cos(facingYaw))
    const policy = getDirectionalMovementFromVector(facing, direction)
    const multiplier = getEffectiveSpeedMultiplier(policy, Boolean(this.mount))
    const effectiveSpeed = baseSpeed * multiplier

    this.visualMovementSpeed = Math.max(this.visualMovementSpeed, effectiveSpeed)
    if (this.mount) {
      this.mount.addControlledMovement(direction, effectiveSpeed, dt)
    } else {
      this.group.position.addScaledVector(direction, effectiveSpeed * dt)
    }
  }

  private _syncToMount(collector: NpcSubphaseCollector | null = null): void {
    if (!this.mount) return
    if (import.meta.env.DEV && collector) { var _tRiderEquipment = performance.now() }
    if (!this.rig.equipmentGripFrames) applyCharacterMountedPose(this.rig, true, this.mount.type as MountedPoseKind)
    this.rig.animation?.setEquipmentState?.({ mounted: true, mountKind: this.mount.type as MountedPoseKind })
    this._alignExternalVisualToMount(true)
    if (import.meta.env.DEV && collector) { collector.endPhase('mountRiderEquipment', _tRiderEquipment!) }

    if (import.meta.env.DEV && collector) { var _tSaddle = performance.now() }
    this.mount.getRiderPelvisSeatWorld(this.group.position)
    if (import.meta.env.DEV && collector) { collector.endPhase('mountSaddleTransform', _tSaddle!) }

    if (import.meta.env.DEV && collector) { var _tRiderTransform = performance.now() }
    this.group.rotation.x = this.mount.ridePitch
    this.group.rotation.y = this.mount.group.rotation.y
    if (import.meta.env.DEV && collector) { collector.endPhase('mountRiderTransform', _tRiderTransform!) }
  }

  private _alignExternalVisualToMount(mounted: boolean): void {
    if (this.externalPelvisHeight <= 0) return
    this.characterVisualGroup.position.y = mounted ? -this.externalPelvisHeight : 0
  }

  private _faceTarget(targetPos: THREE.Vector3): void {
    const dir = this._tmpFaceDir.copy(targetPos).sub(this.group.position)
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

  private _isTargetInMeleeRange(targetPos: THREE.Vector3, extraReach = 0): boolean {
    if (this.isUsingLance) {
      const facingYaw = this.mount ? this.mount.group.rotation.y : this.group.rotation.y
      const forward = this._tmpFacing.set(Math.sin(facingYaw), 0, Math.cos(facingYaw))
      const toTarget = this._tmpToTarget.copy(targetPos).sub(this.combatPosition)
      toTarget.y = 0
      const forwardDist = toTarget.dot(forward)
      const lateralDist = Math.sqrt(Math.max(0, toTarget.lengthSq() - forwardDist * forwardDist))
      return forwardDist > 0 && forwardDist <= this.meleeAttackRadius + extraReach && lateralDist <= 1.4
    }
    return this.combatPosition.distanceTo(targetPos) <= this.meleeAttackRadius + extraReach
  }

  private _switchToMelee(): void {
    this.arrows = 0
    this.swordPivot.visible = true
    this.bowPivot.visible = false
    this.animator.cancel()
  }

  respawn(): void {
    if (this._isFlashing) {
      this.flashTimer = 0
      this._isFlashing = false
      this._restoreDamageFlash()
    }
    this.state = AIState.IDLE
    this.currentHp = this.maxHp
    if (this.aiType === AIType.RANGED) {
      this.arrows = 1
      this.swordPivot.visible = !this.hasActiveRangedWeapon
      this.bowPivot.visible = this.hasActiveRangedWeapon
    } else {
      this.arrows = 0
      this.swordPivot.visible = true
      this.bowPivot.visible = false
    }

    const terrainY = getTerrainHeight(this.spawnX, this.spawnZ)
    this.group.position.set(this.spawnX, terrainY, this.spawnZ)
    this.velY = 0
    this.onGround = true
    this.group.rotation.set(0, 0, 0)
    this._alignExternalVisualToMount(false)
    this.animator.cancel()
    this.alertSprite.visible = false
    this._cachedTargetIsPlayer = false
    this._cachedTargetNpc = null
    this._targetAcquisitionInitialized = false
    this._targetReacquireTimer = 0
    for (const cb of this.onRespawnCallbacks) cb(this)
  }
}
