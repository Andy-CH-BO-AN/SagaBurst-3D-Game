import { applyEquipmentAttachment } from './EquipmentAttachmentContract'
/**
 * NPC.ts
 * Generic NPC AI unit (Faction System, Melee/Ranged).
 * Calibrated with getTerrainHeight(x, z) for procedural heightmap terrain.
 */
import * as THREE from 'three'
import { DeathFadeController } from './DeathFade'
import type { Player } from '../player/Player'
import type { SpatialGrid } from './SpatialGrid'
import type { HpBar } from '../ui/HpBar'
import {
  clampToPlayableWorld,
  findBlockingObstacleAlongPath,
  findBlockingProjectileObstacleAlongPath,
  findObstacleDetourPlan,
  getObstacleAvoidanceDirection,
  getTerrainHeight,
  ObstacleData,
  resolveObstacleCollision,
  type ObstacleDetourPlan,
  type ObstacleDetourSide,
} from './Terrain'
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
import { Mount } from './Mount'
import { EquipmentVisualLODController } from './EquipmentVisualLODController'
import { WeaponMeshFactory } from './WeaponMeshFactory'
import { getUnitCombatProfile, BattleUnitType } from '../battle/BattleConfig'
import { getDirectionalMovementFromVector, getEffectiveSpeedMultiplier } from '../movement/DirectionalMovement'
import type { NpcSubphaseCollector } from '../debug/NpcSubphaseProfiler'
import {
  COMBAT_BALANCE,
  getRangedCombatKind,
  getRangedDamageMultiplier,
  getNpcRangedAttackRange,
  getRangedCooldown,
  getAntiCavalryMultiplier,
  getBerserkerModifiers,
  calculateLanceChargeDamage,
} from '../combat/CombatBalance'
import type { UnitLoadout, UnitPresetId } from '../battle/UnitPresetCatalog'
import { DEFAULT_TACTICAL_ORDER, type TacticalOrder } from '../battle/TacticalOrder'
import { FORMATION_ARRIVAL_DISTANCE } from '../battle/FormationMath'
import {
  MAX_STAMINA,
  SPRINT_MULTIPLIER,
  STAMINA_DRAIN,
  STAMINA_REGEN,
  STAMINA_SPRINT_MIN,
} from '../movement/MovementBalance'
import { WEAPONS, type WeaponCombatKind } from '../rpg/WeaponDatabase'
import type { NavigationWorld } from '../navigation/NavigationWorld'
import type { ChaseTargetCoordinator } from '../navigation/ChaseTargetCoordinator'
import { NavigationPathFollower, type NavigationRouteKind } from '../navigation/NavigationPathFollower'

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
const RANGED_ATTACK_MIN = 6.0
const RANGED_AIM_LIFT_PER_METER_SQ = 0.015
const PROJECTILE_GRAVITY = 9.8
const NPC_FALLBACK_PROJECTILE_SPEED = 20.0

const CHASE_SPEED      = 4.8
const FORMATION_MOVE_SPEED = CHASE_SPEED
const PATROL_SPEED     = 2.2
const AI_ATTACK_GAP    = 0.35
const RESPAWN_TIME     = 10.0

const NPC_FOOT_OBSTACLE_RADIUS = 0.5
const NPC_FOOT_OBSTACLE_HEIGHT = 2.3
const NPC_MOUNTED_OBSTACLE_RADIUS = 1.0
const NPC_MOUNTED_OBSTACLE_HEIGHT = 2.6
const NPC_DETOUR_FOOT_LOOKAHEAD = 5.0
const NPC_DETOUR_MOUNTED_LOOKAHEAD = 8.0
const NPC_DETOUR_STUCK_SECONDS = 0.75
const NPC_DETOUR_FOOT_PROGRESS_DISTANCE = 0.25
const NPC_DETOUR_MOUNTED_PROGRESS_DISTANCE = 0.45
const NPC_RANGED_VISIBLE_TARGET_HOLD_FRAMES = 24
const RANGED_TRAJECTORY_SEGMENT_LENGTH = 3.0
const RANGED_TRAJECTORY_MAX_SEGMENTS = 16
const RANGED_AI_LAUNCH_HEIGHT = 1.25
const RANGED_AI_TARGET_HEIGHT = 1.4

export const TARGET_REACQUIRE_NEAR_DISTANCE = 50
export const TARGET_REACQUIRE_MID_DISTANCE = 100
export const TARGET_REACQUIRE_NEAR_FRAMES = 2
export const TARGET_REACQUIRE_MID_FRAMES = 8
export const TARGET_REACQUIRE_FAR_FRAMES = 16
export const NPC_SEPARATION_RADIUS = 1.2
export const NPC_NEIGHBOR_QUERY_RADIUS = 2.0

export function getTargetReacquireFrameInterval(distance: number | null): number {
  if (distance === null || !Number.isFinite(distance)) return TARGET_REACQUIRE_FAR_FRAMES
  if (distance <= TARGET_REACQUIRE_NEAR_DISTANCE) return TARGET_REACQUIRE_NEAR_FRAMES
  if (distance <= TARGET_REACQUIRE_MID_DISTANCE) return TARGET_REACQUIRE_MID_FRAMES
  return TARGET_REACQUIRE_FAR_FRAMES
}

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
  readonly presetId?: UnitPresetId

  private _meleeDamageOverride: number | undefined
  get meleeDamage(): number {
    return this._meleeDamageOverride ?? WEAPONS[this.meleeWeaponId ?? '']?.damageMax ?? 20
  }
  set meleeDamage(value: number) { this._meleeDamageOverride = value }
  public readonly rangedDamage: number
  public readonly generatedAsCavalry: boolean
  public mount: Mount | null = null
  public meleeAttackRadius = 1.8
  public isUsingLance = false
  public meleeWeaponId: string | null = 'steel_sword'
  public rangedWeaponId?: string
  public loadout?: UnitLoadout
  public tacticalOrder: TacticalOrder = DEFAULT_TACTICAL_ORDER

  private formationTarget: {
    commandId: number
    position: THREE.Vector3
    facing: THREE.Vector3
    reached: boolean
  } | null = null

  get meleeCombatKind(): 'sword' | 'lance' {
    const w = this.meleeWeaponId ? WEAPONS[this.meleeWeaponId] : null
    return w?.combatKind === 'lance' || this.isUsingLance ? 'lance' : 'sword'
  }

  get rangedCombatKind(): 'bow' | 'javelin' | null {
    const weapon = this.rangedWeaponId ? WEAPONS[this.rangedWeaponId] : undefined
    return getRangedCombatKind(weapon)
  }

  get hasActiveRangedWeapon(): boolean {
    return this.rangedActive && Boolean(this.rangedWeaponId) && this.arrows > 0 && !(this.shieldId && this.rangedCombatKind === 'bow')
  }

  get staminaValue(): number { return this.stamina }
  get staminaRatio(): number { return this.stamina / MAX_STAMINA }
  get sprinting(): boolean { return this.isSprinting }
  get currentLod(): number { return this.equipmentVisualLOD.currentLevel }

  get activeCombatKind(): WeaponCombatKind | null {
    if (this.hasActiveRangedWeapon && this.rangedCombatKind) {
      return this.rangedCombatKind
    }
    return this.meleeCombatKind
  }

  get maxRangedAttackDistance(): number {
    const kind = this.rangedCombatKind
    if (!kind) return 22.0
    return getNpcRangedAttackRange(kind, this.isMounted)
  }

  get rangedProjectileSpeed(): number {
    const weapon = this.rangedWeaponId ? WEAPONS[this.rangedWeaponId] : undefined
    return weapon?.arrowSpeedMax ?? NPC_FALLBACK_PROJECTILE_SPEED
  }

  private bodyMesh: THREE.Group
  private headMesh: THREE.Mesh
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

  readonly maxHp: number = COMBAT_BALANCE.hp.npcDefault
  private currentHp: number = COMBAT_BALANCE.hp.npcDefault

  private state: AIState = AIState.IDLE
  private alertTimer = 0
  private attackTimer = 0
  private attackHitProcessed = false
  public pendingLanceChargeSpeed = 0

  private respawnTimer = 0
  private readonly deathFade = new DeathFadeController()
  public respawnEnabled = true
  public readonly aimCollider: THREE.Mesh
  public readonly onDeathCallbacks: Array<(npc: NPC) => void> = []
  public readonly onRespawnCallbacks: Array<(npc: NPC) => void> = []

  private spawnX: number
  private spawnZ: number
  private waypoints: THREE.Vector3[] = []
  private currentWaypointIdx = 0

  private arrows: number = 0
  private rangedActive = false
  private stamina = MAX_STAMINA
  private isSprinting = false
  private chargeSprintLatched = false
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
  private readonly pendingPilumTarget = new THREE.Vector3()
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
  private _targetReacquireFramesRemaining: number = 0
  private _targetReacquireIntervalFrames: number = TARGET_REACQUIRE_FAR_FRAMES
  private readonly _initialStaggerPhase: number
  private readonly _detourWaypoint = new THREE.Vector3()
  private readonly _detourProgressAnchor = new THREE.Vector3()
  private _detourActive = false
  private _detourObstacle: ObstacleData | null = null
  private _detourSide: ObstacleDetourSide = 1
  private _detourStuckElapsed = 0
  private readonly _navigationPath = new NavigationPathFollower()
  private readonly _tmpNavigationTarget = new THREE.Vector3()

  // Temporary destructible blocker target. NPCs never scan for structures;
  // they only react to the first blocker on the route to their human target.
  private _siegeTargetObstacle: ObstacleData | null = null
  private readonly _tmpSiegeTarget = new THREE.Vector3()
  private readonly _tmpSiegeCandidateCenter = new THREE.Vector3()
  private readonly _tmpRangedLosTarget = new THREE.Vector3()
  private readonly _tmpRangedArcPrevious = new THREE.Vector3()
  private readonly _tmpRangedArcPoint = new THREE.Vector3()
  private readonly _rangedTargetCandidates: NPC[] = []
  private _rangedVisibleTargetHoldFrames = 0

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
  get formationCommandId(): number | null { return this.formationTarget?.commandId ?? null }

  isFormationTargetReached(commandId: number): boolean {
    return this.formationTarget?.commandId === commandId && this.formationTarget.reached
  }

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
    loadout?: UnitLoadout,
    presetId?: UnitPresetId,
  ) {
    this.spawnX = spawnX
    this.spawnZ = spawnZ
    this.faction = faction
    this.characterFaction = characterFaction
    this.aiType = aiType
    this.name = name
    this.tier = tier
    this.loadout = loadout
    this.presetId = presetId
    this.generatedAsCavalry = loadout ? Boolean(loadout.mountId) : (cavalry ?? Math.random() < 0.4)
    this._initialStaggerPhase = computeDeterministicPhase(spawnX, spawnZ, name)

    if (loadout) {
      this.meleeWeaponId = loadout.meleeWeaponId ?? null
      this.rangedWeaponId = loadout.rangedWeaponId ?? undefined
      this.shieldId = loadout.shieldId ?? null
      const meleeData = this.meleeWeaponId ? WEAPONS[this.meleeWeaponId] : null
      this.isUsingLance = meleeData?.combatKind === 'lance'
      const baseRangedDamage = this.rangedWeaponId ? (WEAPONS[this.rangedWeaponId]?.damageMax ?? 20) : 0
      const weapon = this.rangedWeaponId ? WEAPONS[this.rangedWeaponId] : undefined
      const rangedKind = getRangedCombatKind(weapon)
      this.rangedDamage = this.rangedWeaponId
        ? baseRangedDamage * getRangedDamageMultiplier(rangedKind)
        : 0
      this.arrows = this.rangedWeaponId ? 30 : 0
    } else {
      const unitType: BattleUnitType = this.generatedAsCavalry
        ? (this.aiType === AIType.RANGED ? 'horseArcher' : 'cavalry')
        : (this.aiType === AIType.RANGED ? 'archer' : 'infantry')
      const combatProfile = getUnitCombatProfile(this.characterFaction, unitType, this.tier)

      this.meleeWeaponId = combatProfile.meleeWeaponId
      this.rangedWeaponId = combatProfile.rangedWeaponId
      this.rangedDamage = combatProfile.rangedDamage ?? 0
      this.isUsingLance = combatProfile.isUsingLance
      this.shieldId = combatProfile.shieldId
      this.arrows = this.aiType === AIType.RANGED ? 30 : 0
    }

    this.rangedActive = Boolean(this.rangedWeaponId)
    this._syncActiveMeleeEquipment()

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
    const rangedKind = this.rangedCombatKind
    if (rangedKind === 'javelin') {
      applyAttachmentContract(this.rig.right.handSocket, 'r', this.bowPivot, 'ranged', 0)
      this.rig.right.handSocket.add(this.bowPivot)
      WeaponMeshFactory.buildNpcRanged(this.characterFaction, this.tier, this.bowGripPivot)
    } else {
      applyBowAttachment(this.rig.left.handSocket, this.bowPivot)
      this.rig.left.handSocket.add(this.bowPivot)
      if (rangedKind === 'bow') {
        this.bowVisual = new CharacterBowVisual(this.bowPivot, this.bowGripPivot)
        this.bowVisual.rebuild(this.rangedWeaponId || 'wooden_shortbow', true)
      }
    }

    this.shieldPivot = new THREE.Group()
    this.rig.left.handSocket.add(this.shieldPivot)
    this.shieldPivot.position.set(0, 0.124, 0.019)
    this.shieldPivot.rotation.set(-1.42, Math.PI, -0.12)

    this.animator = new CharacterCombatAnimator(this.rig, this.swordPivot, this.bowPivot)

    this._rebuildActiveMeleeVisual()
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
    this.equipmentVisualLOD.register(rangedKind === 'javelin' ? 'pilum' : 'bow', this.bowGripPivot)
    // Equipment proxies are siblings of this LOD, so its render-time selection
    // reaches the detail children before the renderer submits those proxies.
    const humanoidLOD = this.bodyMesh.children.find((child): child is THREE.LOD => child instanceof THREE.LOD)
    if (humanoidLOD) this.equipmentVisualLOD.followHumanoid(humanoidLOD)
    this.alertSprite = this._createAlertSprite()
    this.alertSprite.position.set(0, 2.3, 0)
    this.alertSprite.visible = false
    this.group.add(this.alertSprite)

    this.group.position.copy(basePos)
    scene.add(this.group)
  }

  mountVehicle(mount: Mount): void {
    this.mount = mount
    this.mount.setNpcRider(this, this.faction)
    this._alignExternalVisualToMount(true)
    this._syncToMount()
  }

  /**
   * DEV-only diagnostic hook to replace character and equipment materials with simple diagnostic materials.
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

    if (this.headMesh?.isMesh) replaceMaterial(this.headMesh)
  }

  /** Releases this NPC from its mount and returns it to a normal walking body. */
  dismountFromMount(): void {
    this.pendingLanceChargeSpeed = 0
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

  private _syncActiveMeleeEquipment(): void {
    const weapon = this.meleeWeaponId ? WEAPONS[this.meleeWeaponId] : undefined
    this.isUsingLance = weapon?.combatKind === 'lance'
    this.meleeAttackRadius = weapon?.range ?? (this.isUsingLance ? 3.9 : 1.8)
  }

  private _rebuildActiveMeleeVisual(): void {
    this.animator?.cancel()
    while (this.swordGripPivot.children.length > 0) {
      this.swordGripPivot.remove(this.swordGripPivot.children[0])
    }
    this.swordTipLocal.copy(
      WeaponMeshFactory.buildNpcMelee(
        this.characterFaction,
        this.aiType === AIType.RANGED ? 1 : this.tier,
        this.isUsingLance,
        this.swordGripPivot,
        this.meleeWeaponId ?? undefined,
      ),
    )
    this.swordGripPivot.position.set(0, 0, 0)
    this.swordGripPivot.rotation.set(0, 0, 0)
    delete this.swordPivot.userData.equipmentAttachmentOwned
    if (this.rig.equipmentGripFrames && this.isUsingLance) {
      applyEquipmentAttachment(this.rig.right.handSocket, this.swordPivot, this.swordGripPivot, this.rig.equipmentGripFrames.lanceRight, 'lance')
    } else if (this.rig.swordGripFrame) {
      applySwordAttachment(this.rig.right.handSocket, this.swordPivot, this.swordGripPivot, this.rig.swordGripFrame, this.rig.equipmentGripFrames?.lanceRight.modelRotationLocal)
    }
    polishWeaponMaterials(this.swordPivot)
    this.equipmentVisualLOD.register(this.isUsingLance ? 'lance' : 'sword', this.swordGripPivot)
  }

  private _setActiveMeleeWeapon(weaponId: string | null): void {
    if (this.meleeWeaponId === weaponId) {
      this._syncActiveMeleeEquipment()
      return
    }
    this.meleeWeaponId = weaponId
    this._meleeDamageOverride = undefined
    this._syncActiveMeleeEquipment()
    this._rebuildActiveMeleeVisual()
  }

  private _cancelEquipmentCombatState(): void {
    this.animator.cancel()
    this.bowArrowReleased = false
    this.attackTimer = 0
    this.attackHitProcessed = false
    this.pendingLanceChargeSpeed = 0
    this.bowVisual?.hideArrow()
  }

  private _isVikingFootSpecialist(): boolean {
    return this.characterFaction === 'viking'
      && !this.generatedAsCavalry
      && (this.presetId === 'viking_berserker' || this.presetId === 'viking_spearman' || this.presetId === 'viking_archer')
  }

  private _restoreVikingDefensiveStance(): void {
    if (!this._isVikingFootSpecialist() || !this.loadout) return
    this._cancelEquipmentCombatState()
    this._setActiveMeleeWeapon(this.loadout.meleeWeaponId ?? null)
    this.shieldId = this.loadout.shieldId ?? null
    this.rangedActive = Boolean(this.rangedWeaponId) && this.arrows > 0
    this.rebuildShield()
    this.swordPivot.visible = !this.hasActiveRangedWeapon
    this.bowPivot.visible = this.hasActiveRangedWeapon
  }

  private _enterVikingChargeStance(): void {
    if (!this._isVikingFootSpecialist() || !this.loadout) return
    this._cancelEquipmentCombatState()
    const chargeWeapon = this.presetId === 'viking_spearman'
      ? (this.loadout.secondaryMeleeWeaponId ?? this.loadout.meleeWeaponId ?? null)
      : (this.loadout.meleeWeaponId ?? null)
    this._setActiveMeleeWeapon(chargeWeapon)
    this.shieldId = null
    this.rangedActive = false
    this.rebuildShield()
    this.swordPivot.visible = true
    this.bowPivot.visible = false
    if (this.state === AIState.ATTACK) {
      this.state = AIState.CHASE
      this.attackTimer = 0
      this.attackHitProcessed = false
    }
  }

  setTacticalOrder(order: TacticalOrder): void {
    this.formationTarget = null
    this._clearObstacleDetour()
    this._clearSiegeFallback()
    this.tacticalOrder = order
    if (this.dead) return
    if (order === 'defend') this._restoreVikingDefensiveStance()
    else if (order === 'charge') this._enterVikingChargeStance()
  }

  assignFormationTarget(commandId: number, target: THREE.Vector3, facing: THREE.Vector3): void {
    if (this.dead) return
    this._clearObstacleDetour()
    this._clearSiegeFallback()
    this._cancelEquipmentCombatState()
    this.tacticalOrder = 'formation'
    this.formationTarget = {
      commandId,
      position: target.clone(),
      facing: facing.clone().setY(0).normalize(),
      reached: false,
    }
    this.state = AIState.CHASE
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
    const horizontalDistance = Math.sqrt(horizontalDistanceSq)

    if (this.rangedCombatKind && horizontalDistance > 1e-4) {
      const speed = this.rangedProjectileSpeed
      const speedSq = speed * speed
      const heightDelta = aimPoint.y - origin.y
      const discriminant = speedSq * speedSq
        - PROJECTILE_GRAVITY * (
          PROJECTILE_GRAVITY * horizontalDistanceSq
          + 2 * heightDelta * speedSq
        )

      if (discriminant >= 0) {
        const tanTheta = (speedSq - Math.sqrt(discriminant))
          / (PROJECTILE_GRAVITY * horizontalDistance)
        aimPoint.y = origin.y + horizontalDistance * tanTheta
        return aimPoint
      }
    }

    // Preserve the existing heuristic only as an unreachable/invalid-data fallback.
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
    if (this.state === AIState.IDLE) {
      this.state = AIState.ALERT
      this.alertTimer = 0.4
      this.alertSprite.visible = true
    }

    if (this.currentHp <= 0) {
      this.formationTarget = null
      this._clearObstacleDetour()
      this._clearSiegeFallback()
      this.dismountFromMount()
      this.state = AIState.DEAD
      this.deathFade.start(this.group)
      this.animator.cancel()
      this.animator.setEquipment(this.isUsingLance, Boolean(this.shieldId), undefined, false)
      this.rig.animation?.setEquipmentState?.({ mounted: false })
      this.rig.animation?.play('death', { fadeSeconds: 0.12, loop: false })
      this.respawnTimer = RESPAWN_TIME
      this.alertSprite.visible = false
      for (const cb of this.onDeathCallbacks) cb(this)
    }
    return true
  }

  private _movementObstacleRadius(): number {
    return this.isMounted ? NPC_MOUNTED_OBSTACLE_RADIUS : NPC_FOOT_OBSTACLE_RADIUS
  }

  private _movementObstacleHeight(): number {
    return this.isMounted ? NPC_MOUNTED_OBSTACLE_HEIGHT : NPC_FOOT_OBSTACLE_HEIGHT
  }

  private _detourLookAhead(): number {
    return this.isMounted ? NPC_DETOUR_MOUNTED_LOOKAHEAD : NPC_DETOUR_FOOT_LOOKAHEAD
  }

  private _detourProgressDistance(): number {
    return this.isMounted ? NPC_DETOUR_MOUNTED_PROGRESS_DISTANCE : NPC_DETOUR_FOOT_PROGRESS_DISTANCE
  }

  private _clearObstacleDetour(): void {
    this._detourActive = false
    this._detourObstacle = null
    this._detourStuckElapsed = 0
  }

  private _activateObstacleDetour(plan: ObstacleDetourPlan): void {
    this._detourActive = true
    this._detourObstacle = plan.obstacle
    this._detourSide = plan.side
    this._detourWaypoint.copy(plan.waypoint)
    this._detourProgressAnchor.copy(this.combatPosition)
    this._detourStuckElapsed = 0
  }

  private _applyPersistentObstacleDetour(
    moveDir: THREE.Vector3,
    target: THREE.Vector3,
    dt: number,
    obstacles: ObstacleData[],
  ): void {
    const position = this.combatPosition
    const radius = this._movementObstacleRadius()
    const height = this._movementObstacleHeight()
    const lookAhead = this._detourLookAhead()
    const arrivalDistance = this.isMounted ? 1.1 : 0.65

    if (this._detourActive) {
      // Stop following the old waypoint as soon as its obstacle is no longer the
      // first blocker on the direct route. A different farther obstacle will get
      // its own detour only when it enters local look-ahead range.
      const directBlocker = findBlockingObstacleAlongPath(
        position,
        target,
        radius,
        height,
        0,
        obstacles,
      )
      if (directBlocker !== this._detourObstacle) {
        this._clearObstacleDetour()
      } else {
        const progressDistance = this._detourProgressDistance()
        if (position.distanceToSquared(this._detourProgressAnchor) >= progressDistance * progressDistance) {
          this._detourProgressAnchor.copy(position)
          this._detourStuckElapsed = 0
        } else {
          this._detourStuckElapsed += dt
        }

        // No meaningful progress while detouring: explicitly try the opposite side.
        if (this._detourStuckElapsed >= NPC_DETOUR_STUCK_SECONDS) {
          const alternateSide: ObstacleDetourSide = this._detourSide === 1 ? -1 : 1
          const alternatePlan = findObstacleDetourPlan(
            position,
            target,
            radius,
            height,
            0,
            obstacles,
            alternateSide,
            lookAhead * 2,
          )
          if (alternatePlan) {
            this._activateObstacleDetour(alternatePlan)
          } else {
            this._clearObstacleDetour()
          }
        }

        if (
          this._detourActive
          && position.distanceToSquared(this._detourWaypoint) <= arrivalDistance * arrivalDistance
        ) {
          const nextPlan = findObstacleDetourPlan(
            position,
            target,
            radius,
            height,
            0,
            obstacles,
            this._detourSide,
            lookAhead,
          )
          if (nextPlan) this._activateObstacleDetour(nextPlan)
          else this._clearObstacleDetour()
        }
      }
    }

    if (!this._detourActive) {
      const plan = findObstacleDetourPlan(
        position,
        target,
        radius,
        height,
        0,
        obstacles,
        undefined,
        lookAhead,
      )
      if (plan) this._activateObstacleDetour(plan)
    }

    if (this._detourActive) {
      moveDir.copy(this._detourWaypoint).sub(position)
      moveDir.y = 0
      if (moveDir.lengthSq() > 0.0001) moveDir.normalize()
    }
  }

  private _clearNavigationPath(): void {
    this._navigationPath.clear()
  }

  private _resolveNavigationMoveTarget(
    humanTarget: THREE.Vector3,
    obstacles: ObstacleData[],
    navigationWorld: NavigationWorld | null,
  ): NavigationRouteKind {
    if (!navigationWorld) {
      this._tmpNavigationTarget.copy(humanTarget)
      return 'direct'
    }

    const directBlocker = findBlockingObstacleAlongPath(
      this.combatPosition,
      humanTarget,
      this._movementObstacleRadius(),
      this._movementObstacleHeight(),
      0,
      obstacles,
    )

    return this._navigationPath.resolveMoveTarget(
      this.combatPosition,
      humanTarget,
      navigationWorld,
      directBlocker !== null,
      this._tmpNavigationTarget,
    )
  }

  private _clearSiegeFallback(): void {
    this._siegeTargetObstacle = null
  }

  private _isAttackableObstacle(obstacle: ObstacleData | null): obstacle is ObstacleData {
    const damageable = obstacle?.damageable
    return Boolean(
      damageable
      && !damageable.destroyed
    )
  }

  private _activateDirectObstacle(blocker: ObstacleData | null): boolean {
    if (!this._isAttackableObstacle(blocker)) return false

    this._siegeTargetObstacle = blocker
    this._clearObstacleDetour()
    this.attackTimer = 0
    this.attackHitProcessed = false
    return true
  }

  private _findDirectDamageableBlocker(
    humanTarget: THREE.Vector3,
    obstacles: ObstacleData[],
  ): ObstacleData | null {
    const blocker = findBlockingObstacleAlongPath(
      this.combatPosition,
      humanTarget,
      this._movementObstacleRadius(),
      this._movementObstacleHeight(),
      0,
      obstacles,
      this._detourLookAhead() * 2,
    )
    return this._isAttackableObstacle(blocker) ? blocker : null
  }

  private _distanceToObstacleXZ(obstacle: ObstacleData): number {
    const position = this.combatPosition
    const closestX = THREE.MathUtils.clamp(position.x, obstacle.box.min.x, obstacle.box.max.x)
    const closestZ = THREE.MathUtils.clamp(position.z, obstacle.box.min.z, obstacle.box.max.z)
    return Math.hypot(position.x - closestX, position.z - closestZ)
  }

  private _getObstacleAttackPoint(obstacle: ObstacleData, out: THREE.Vector3): THREE.Vector3 {
    const projectileBoxes = obstacle.projectileBoxes
    if (this.hasActiveRangedWeapon && projectileBoxes && projectileBoxes.length > 0) {
      let closestDistSq = Infinity
      for (const box of projectileBoxes) {
        box.getCenter(this._tmpSiegeCandidateCenter)
        const distSq = this.combatPosition.distanceToSquared(this._tmpSiegeCandidateCenter)
        if (distSq < closestDistSq) {
          closestDistSq = distSq
          out.copy(this._tmpSiegeCandidateCenter)
        }
      }
      return out
    }

    obstacle.box.clampPoint(this.combatPosition, out)
    out.y = (obstacle.box.min.y + obstacle.box.max.y) * 0.5
    return out
  }

  private _isObstacleInMeleeRange(obstacle: ObstacleData, extraReach = 0): boolean {
    return this._distanceToObstacleXZ(obstacle) <= this.meleeAttackRadius + extraReach
  }

  private _findRangedTrajectoryBlocker(
    target: THREE.Vector3,
    obstacles: ObstacleData[],
  ): ObstacleData | null {
    // Match AI fireability to the real gravity-driven projectile instead of a
    // straight ray. The launch point is actor-stable so bow draw animation
    // cannot toggle clear/blocked between adjacent frames.
    const origin = this._tmpRangedOrigin
      .copy(this.combatPosition)
      .setY(this.combatPosition.y + RANGED_AI_LAUNCH_HEIGHT)
    const targetPoint = this._tmpRangedLosTarget
      .copy(target)
      .setY(target.y + RANGED_AI_TARGET_HEIGHT)

    const dx = targetPoint.x - origin.x
    const dz = targetPoint.z - origin.z
    const horizontalDistanceSq = dx * dx + dz * dz
    if (horizontalDistanceSq <= 1e-6) return null

    const horizontalDistance = Math.sqrt(horizontalDistanceSq)
    const speed = this.rangedProjectileSpeed
    const speedSq = speed * speed
    const heightDelta = targetPoint.y - origin.y
    const discriminant = speedSq * speedSq
      - PROJECTILE_GRAVITY * (
        PROJECTILE_GRAVITY * horizontalDistanceSq
        + 2 * heightDelta * speedSq
      )

    if (discriminant < 0) {
      return findBlockingProjectileObstacleAlongPath(origin, targetPoint, obstacles)
    }

    // Use the low-angle ballistic solution, matching the actual NPC aim helper.
    const tanTheta = (speedSq - Math.sqrt(discriminant))
      / (PROJECTILE_GRAVITY * horizontalDistance)
    const horizontalSpeed = speed / Math.sqrt(1 + tanTheta * tanTheta)
    if (horizontalSpeed <= 1e-6) {
      return findBlockingProjectileObstacleAlongPath(origin, targetPoint, obstacles)
    }

    const verticalSpeed = horizontalSpeed * tanTheta
    const unitX = dx / horizontalDistance
    const unitZ = dz / horizontalDistance
    const flightTime = horizontalDistance / horizontalSpeed
    const segmentCount = Math.min(
      RANGED_TRAJECTORY_MAX_SEGMENTS,
      Math.max(1, Math.ceil(horizontalDistance / RANGED_TRAJECTORY_SEGMENT_LENGTH)),
    )

    const previous = this._tmpRangedArcPrevious.copy(origin)
    const point = this._tmpRangedArcPoint
    for (let index = 1; index <= segmentCount; index++) {
      const t = flightTime * index / segmentCount
      point.set(
        origin.x + unitX * horizontalSpeed * t,
        origin.y + verticalSpeed * t - 0.5 * PROJECTILE_GRAVITY * t * t,
        origin.z + unitZ * horizontalSpeed * t,
      )

      const blocker = findBlockingProjectileObstacleAlongPath(
        previous,
        point,
        obstacles,
      )
      if (blocker) return blocker
      previous.copy(point)
    }

    return null
  }

  private _getActiveSiegeObstacle(
    humanTarget: THREE.Vector3,
    obstacles: ObstacleData[],
  ): ObstacleData | null {
    if (!this._isAttackableObstacle(this._siegeTargetObstacle)) {
      this._clearSiegeFallback()
      return null
    }

    const blocker = findBlockingObstacleAlongPath(
      this.combatPosition,
      humanTarget,
      this._movementObstacleRadius(),
      this._movementObstacleHeight(),
      0,
      obstacles,
      this._detourLookAhead() * 2,
    )

    if (!this._isAttackableObstacle(blocker)) {
      this._clearSiegeFallback()
      return null
    }

    // Always attack the first currently blocking destructible obstacle.
    this._siegeTargetObstacle = blocker
    return blocker
  }

  private _trySwitchToVisibleRangedTarget(
    player: Player,
    allNPCs: NPC[],
    hostileNpcGrid: SpatialGrid<NPC> | null,
    obstacles: ObstacleData[],
  ): boolean {
    const range = this.maxRangedAttackDistance
    const minRangeSq = RANGED_ATTACK_MIN * RANGED_ATTACK_MIN
    const maxRangeSq = range * range
    let bestIsPlayer = false
    let bestNpc: NPC | null = null
    let bestDistSq = Infinity

    if (
      this.faction === Faction.ENEMY
      && !this._cachedTargetIsPlayer
      && player.targetable
      && !player.dead
    ) {
      const playerPos = this._getPlayerPosition(player, this._tmpTargetPosition)
      const distSq = this.combatPosition.distanceToSquared(playerPos)
      if (
        distSq >= minRangeSq
        && distSq <= maxRangeSq
        && this._findRangedTrajectoryBlocker(playerPos, obstacles) === null
      ) {
        bestIsPlayer = true
        bestDistSq = distSq
      }
    }

    const considerNpc = (candidate: NPC): void => {
      if (
        candidate === this
        || candidate.dead
        || candidate.faction === this.faction
        || candidate === this._cachedTargetNpc
      ) return

      const distSq = this.combatPosition.distanceToSquared(candidate.combatPosition)
      if (distSq < minRangeSq || distSq > maxRangeSq || distSq >= bestDistSq) return
      if (this._findRangedTrajectoryBlocker(candidate.combatPosition, obstacles) !== null) return

      bestIsPlayer = false
      bestNpc = candidate
      bestDistSq = distSq
    }

    if (hostileNpcGrid) {
      hostileNpcGrid.getNearbyInto(
        this.combatPosition,
        range,
        this._rangedTargetCandidates,
      )
      for (const candidate of this._rangedTargetCandidates) considerNpc(candidate)
    } else {
      for (const candidate of allNPCs) considerNpc(candidate)
    }

    if (!bestIsPlayer && bestNpc === null) return false

    this._cachedTargetIsPlayer = bestIsPlayer
    this._cachedTargetNpc = bestNpc
    this._rangedVisibleTargetHoldFrames = NPC_RANGED_VISIBLE_TARGET_HOLD_FRAMES
    this._clearObstacleDetour()
    this._clearNavigationPath()
    this._clearSiegeFallback()
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

  private _acquireTarget(
    player: Player,
    allNPCs: NPC[],
    hostileNpcGrid: SpatialGrid<NPC> | null,
    chaseTargetCoordinator: ChaseTargetCoordinator | null,
  ): void {
    const previousIsPlayer = this._cachedTargetIsPlayer
    const previousNpc = this._cachedTargetNpc
    const target = this._findTarget(
      player,
      allNPCs,
      hostileNpcGrid,
      chaseTargetCoordinator,
    )
    if (target === null) {
      this._cachedTargetIsPlayer = false
      this._cachedTargetNpc = null
    } else {
      this._cachedTargetIsPlayer = target.isPlayer
      this._cachedTargetNpc = target.npc ?? null
    }

    if (
      previousIsPlayer !== this._cachedTargetIsPlayer
      || previousNpc !== this._cachedTargetNpc
    ) {
      this._clearObstacleDetour()
      this._clearNavigationPath()
      this._clearSiegeFallback()
    }
  }

  private _getCachedTargetDistance(player: Player): number | null {
    if (this._cachedTargetIsPlayer && player.targetable && !player.dead) {
      return this.combatPosition.distanceTo(this._getPlayerPosition(player, this._tmpTargetPosition))
    }
    if (this._cachedTargetNpc !== null && !this._cachedTargetNpc.dead) {
      return this.combatPosition.distanceTo(this._cachedTargetNpc.combatPosition)
    }
    return null
  }

  private _staggeredTargetReacquireDelay(intervalFrames: number): number {
    return 1 + Math.floor(this._initialStaggerPhase * intervalFrames)
  }

  private _scheduleTargetReacquire(player: Player, staggered: boolean): void {
    const intervalFrames = getTargetReacquireFrameInterval(this._getCachedTargetDistance(player))
    this._targetReacquireIntervalFrames = intervalFrames
    this._targetReacquireFramesRemaining = staggered
      ? this._staggeredTargetReacquireDelay(intervalFrames)
      : intervalFrames
  }

  private _getTarget(
    _dt: number,
    player: Player,
    allNPCs: NPC[],
    hostileNpcGrid: SpatialGrid<NPC> | null = null,
    chaseTargetCoordinator: ChaseTargetCoordinator | null = null,
  ): { position: THREE.Vector3; isDead: boolean; isPlayer: boolean; npc?: NPC } | null {
    if (!this._targetAcquisitionInitialized) {
      this._targetAcquisitionInitialized = true
      this._acquireTarget(player, allNPCs, hostileNpcGrid, chaseTargetCoordinator)
      this._scheduleTargetReacquire(player, true)
    } else {
      const hadTarget = this._cachedTargetIsPlayer || this._cachedTargetNpc !== null
      const targetValid = this._isCachedTargetValid(player)

      if (hadTarget && !targetValid) {
        // Invalid targets are never delayed by the AI LOD cadence.
        this._rangedVisibleTargetHoldFrames = 0
        this._acquireTarget(player, allNPCs, hostileNpcGrid, chaseTargetCoordinator)
        this._scheduleTargetReacquire(player, true)
      } else if (targetValid && this._rangedVisibleTargetHoldFrames > 0) {
        // A visible alternate target should not immediately snap back to the
        // nearer but wall-blocked target on the next reacquisition frame.
        this._rangedVisibleTargetHoldFrames -= 1
      } else {
        const intervalFrames = getTargetReacquireFrameInterval(this._getCachedTargetDistance(player))

        // Moving into a closer band raises AI decision frequency immediately.
        // Moving farther away does not postpone an already-scheduled near-term scan.
        if (intervalFrames < this._targetReacquireIntervalFrames) {
          this._targetReacquireFramesRemaining = Math.min(
            this._targetReacquireFramesRemaining,
            intervalFrames,
          )
        }
        this._targetReacquireIntervalFrames = intervalFrames
        this._targetReacquireFramesRemaining -= 1

        if (this._targetReacquireFramesRemaining <= 0) {
          this._acquireTarget(player, allNPCs, hostileNpcGrid, chaseTargetCoordinator)
          this._scheduleTargetReacquire(player, false)
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

  private _findTarget(
    player: Player,
    allNPCs: NPC[],
    hostileNpcGrid: SpatialGrid<NPC> | null = null,
    chaseTargetCoordinator: ChaseTargetCoordinator | null = null,
  ): { position: THREE.Vector3, isDead: boolean, isPlayer: boolean, npc?: NPC } | null {
    let closestTarget = null
    let closestDistSq = Infinity

    // Check Player separately because Player is not stored in the NPC spatial grids.
    if (this.faction === Faction.ENEMY && player.targetable) {
      const playerPos = this._getPlayerPosition(player, this._tmpTargetPosition)
      const dSq = this.combatPosition.distanceToSquared(playerPos)
      if (dSq < closestDistSq) {
        closestDistSq = dSq
        closestTarget = { position: playerPos, isDead: player.dead, isPlayer: true }
      }
    }

    if (hostileNpcGrid) {
      // Units inside the same 4m chase group share one nearest-hostile lookup.
      const npc = chaseTargetCoordinator
        ? chaseTargetCoordinator.findGroupTarget(this, hostileNpcGrid)
        : hostileNpcGrid.findNearest(
          this.combatPosition,
          candidate => !candidate.dead && candidate.faction !== this.faction,
        )
      if (npc) {
        const dSq = this.combatPosition.distanceToSquared(npc.combatPosition)
        if (dSq < closestDistSq) {
          closestDistSq = dSq
          closestTarget = { position: npc.combatPosition, isDead: npc.dead, isPlayer: false, npc }
        }
      }
    } else {
      // Compatibility fallback for isolated tests/dev callers that do not own a grid.
      for (let i = 0; i < allNPCs.length; i++) {
        const npc = allNPCs[i]
        if (npc === this || npc.dead || npc.faction === this.faction) continue
        const dSq = this.combatPosition.distanceToSquared(npc.combatPosition)
        if (dSq < closestDistSq) {
          closestDistSq = dSq
          closestTarget = { position: npc.combatPosition, isDead: npc.dead, isPlayer: false, npc }
        }
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
    _collector: NpcSubphaseCollector | null = null,
    hostileNpcGrid: SpatialGrid<NPC> | null = null,
    navigationWorld: NavigationWorld | null = null,
    chaseTargetCoordinator: ChaseTargetCoordinator | null = null,
  ): void {
    if (this.state === AIState.DEAD) {
      if (import.meta.env.DEV && _collector) { var _tDead = performance.now() }
      const hidden = this.deathFade.update(this.group, dt)
      if (!hidden) this.animator.update(dt, cameraDistance)
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
    this.isSprinting = false
    if (this.tacticalOrder !== 'charge' || this.state !== AIState.CHASE) {
      this.chargeSprintLatched = false
    }
    let animationAdvanced = false
    const previousMountSpeed = this.mount ? this.mount.movementSpeed : 0
    if (this.mount) this.mount.beginControlledFrame()
    const recoveringBow = this.animator.currentAction === 'bowRelease' && this.bowArrowReleased
    const recoveringPilum = this.animator.currentAction === 'pilumThrow'
    this.rebuildShield()
    this.animator.setEquipment(this.isUsingLance, Boolean(this.shieldId), this.mount?.type as MountedPoseKind | undefined, true)
    this.rig.animation?.setEquipmentState?.({ mounted: this.isMounted })
    if (!this.animator.busy && this.isUsingLance) this.animator.poseLanceReady(this.isMounted)

    if (this.tacticalOrder === 'formation' && this.formationTarget) {
      this._updateFormationMovement(dt, nearbyNPCs, obstacles, skipBoidsAndObstacles)
    } else {
      if (import.meta.env.DEV && _collector) { var _tTargetAI = performance.now() }
      const targetInfo = this._getTarget(
        dt,
        player,
        allNPCs,
        hostileNpcGrid,
        chaseTargetCoordinator,
      )
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
    } else if (recoveringPilum) {
      const events = this.animator.update(dt, cameraDistance)
      animationAdvanced = true
      if (events.projectileRelease) {
        const origin = this._tmpRangedOrigin
        const direction = this._tmpRangedDirection
        origin.copy(this.bowGripPivot.getWorldPosition(origin))
        direction.copy(this.pendingPilumTarget).sub(origin).normalize()
        onFireArrow(origin, direction, 'pilum')
        this.bowPivot.visible = false
        this.arrows -= 1
        this.attackTimer = 0
      }
      if (events.actionCompleted) {
        if (this.arrows === 0) this._switchToMelee(true, false)
        this.state = AIState.CHASE
      }
    } else switch (this.state) {
      case AIState.IDLE: {
        this.alertSprite.visible = false
        if (this.tacticalOrder !== 'defend') {
          this._updatePatrol(dt, obstacles, skipBoidsAndObstacles)
        }

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
          if (this.tacticalOrder === 'defend') {
            this.state = targetInfo && this._isTargetInDefendRange(targetInfo.position) ? AIState.ATTACK : AIState.ALERT
            this.attackTimer = 0
          } else {
            this.state = AIState.CHASE
          }
        }
        break
      }

      case AIState.CHASE: {
        this.alertSprite.visible = false
        if (!targetInfo || targetInfo.isDead) {
          this._clearObstacleDetour()
          this._clearNavigationPath()
          this._clearSiegeFallback()
          this.state = AIState.IDLE
          break
        }

        if (this.tacticalOrder === 'defend') {
          this._clearObstacleDetour()
          this._clearNavigationPath()
          this._clearSiegeFallback()
          this.animator.cancel()
          this.state = this._isTargetInDefendRange(targetInfo.position)
            ? AIState.ATTACK
            : AIState.ALERT
          break
        }

        const distSq = this.combatPosition.distanceToSquared(targetInfo.position)
        const maxDetectionDistance = DETECTION_RADIUS * 1.5
        if (distSq > maxDetectionDistance * maxDetectionDistance) {
          this._clearObstacleDetour()
          this._clearNavigationPath()
          this._clearSiegeFallback()
          this.state = AIState.IDLE
          break
        }

        // Ranged fast path: if the current target is already shootable, attack
        // immediately and skip blocker/pathfinding work for this CHASE frame.
        if (this.hasActiveRangedWeapon) {
          const maxRange = this.maxRangedAttackDistance
          if (
            distSq <= maxRange * maxRange
            && distSq >= RANGED_ATTACK_MIN * RANGED_ATTACK_MIN
            && this._findRangedTrajectoryBlocker(targetInfo.position, obstacles) === null
          ) {
            this._clearObstacleDetour()
            this._clearNavigationPath()
            this._clearSiegeFallback()
            this.state = AIState.ATTACK
            this.attackTimer = 0
            break
          }
        }

        const dist = Math.sqrt(distSq)
        const navigationRoute = !skipBoidsAndObstacles
          ? this._resolveNavigationMoveTarget(
            targetInfo.position,
            obstacles,
            navigationWorld,
          )
          : 'direct'
        if (skipBoidsAndObstacles) this._tmpNavigationTarget.copy(targetInfo.position)

        // A normal walkable route always wins over obstacle combat.
        if (navigationRoute !== 'unreachable') {
          this._clearSiegeFallback()
        }
        let siegeObstacle = navigationRoute === 'unreachable'
          ? this._getActiveSiegeObstacle(targetInfo.position, obstacles)
          : null

        // Ranged units only draw melee against a genuinely close human target.
        // A wall between them and that human remains a navigation/siege problem.
        if (!siegeObstacle && this.hasActiveRangedWeapon && dist < RANGED_ATTACK_MIN) {
          this._switchToMelee()
        }

        // A* gets first refusal. Existing obstacle combat is only the
        // temporary fallback when the blocked grid has no walkable route.
        if (
          !skipBoidsAndObstacles
          && navigationRoute === 'unreachable'
          && !siegeObstacle
          && !this.hasActiveRangedWeapon
        ) {
          const directObstacle = this._findDirectDamageableBlocker(
            targetInfo.position,
            obstacles,
          )
          if (directObstacle && this._activateDirectObstacle(directObstacle)) {
            siegeObstacle = directObstacle
          }
        }

        const moveDir = this._tmpMoveDir
        const movementTarget = siegeObstacle
          ? this._getObstacleAttackPoint(siegeObstacle, this._tmpSiegeTarget)
          : navigationRoute === 'unreachable'
            ? targetInfo.position
            : this._tmpNavigationTarget

        if (siegeObstacle) {
          const obstacleDistance = this._distanceToObstacleXZ(siegeObstacle)
          if (this.hasActiveRangedWeapon) {
            if (obstacleDistance <= this.maxRangedAttackDistance) {
              this._clearObstacleDetour()
              this.state = AIState.ATTACK
              this.attackTimer = 0
              break
            }
          } else if (this._isObstacleInMeleeRange(siegeObstacle, 0.35)) {
            this._clearObstacleDetour()
            this.state = AIState.ATTACK
            this.attackTimer = 0
            this.attackHitProcessed = false
            break
          }

          moveDir.copy(movementTarget).sub(this.combatPosition)
        } else if (this.hasActiveRangedWeapon) {
          if (dist <= this.maxRangedAttackDistance && dist >= RANGED_ATTACK_MIN) {
            const rangedBlocker = this._findRangedTrajectoryBlocker(targetInfo.position, obstacles)
            if (rangedBlocker === null) {
              // Enemy first: if the current human is actually shootable, never
              // spend an arrow on a wall/tree instead.
              this._clearObstacleDetour()
              this._clearSiegeFallback()
              this.state = AIState.ATTACK
              this.attackTimer = 0
              break
            }

            // Current human is blocked. Prefer another visible human before any
            // structure becomes a fallback target.
            if (
              this._trySwitchToVisibleRangedTarget(
                player,
                allNPCs,
                hostileNpcGrid,
                obstacles,
              )
            ) {
              this.state = AIState.CHASE
              break
            }

            if (
              navigationRoute === 'unreachable'
              && this._isAttackableObstacle(rangedBlocker)
            ) {
              this._activateDirectObstacle(rangedBlocker)
              siegeObstacle = rangedBlocker
              const obstacleDistance = this._distanceToObstacleXZ(rangedBlocker)
              if (obstacleDistance <= this.maxRangedAttackDistance) {
                this.state = AIState.ATTACK
                this.attackTimer = 0
                break
              }
              moveDir.copy(
                this._getObstacleAttackPoint(rangedBlocker, this._tmpSiegeTarget),
              ).sub(this.combatPosition)
            } else {
              moveDir.copy(movementTarget).sub(this.combatPosition)
            }
          } else {
            moveDir.copy(movementTarget).sub(this.combatPosition)
          }
        } else {
          if (
            navigationRoute === 'direct'
            && this._isTargetInMeleeRange(targetInfo.position)
          ) {
            this._clearObstacleDetour()
            this._clearSiegeFallback()
            this.state = AIState.ATTACK
            this.attackTimer = 0
            this.attackHitProcessed = false
            if (this.isMounted && this.isUsingLance) {
              this.pendingLanceChargeSpeed = previousMountSpeed
            }
            break
          }
          moveDir.copy(movementTarget).sub(this.combatPosition)
        }

        moveDir.y = 0
        if (moveDir.lengthSq() > 0.0001) moveDir.normalize()

        // A* path following replaces corner detours whenever a global route exists.
        // Keep the old local detour only as a no-route fallback until breach A*
        // is introduced in the next PR.
        if (!skipBoidsAndObstacles) {
          if (
            !siegeObstacle
            && (navigationRoute === 'unreachable' || navigationRoute === 'pending')
          ) {
            if (import.meta.env.DEV && _collector) { var _tObs = performance.now() }
            this._applyPersistentObstacleDetour(moveDir, targetInfo.position, dt, obstacles)
            if (import.meta.env.DEV && _collector) { _collector.endPhase('obstacleAvoid', _tObs!) }
          } else if (navigationRoute !== 'unreachable') {
            this._clearObstacleDetour()
          }

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

          // Once a structure has become the explicit fallback target, do not
          // steer away from that same structure. Collision keeps the attacker at
          // its edge and the next frame transitions into melee/ranged attack.
          if (
            !siegeObstacle
            && (navigationRoute === 'unreachable' || navigationRoute === 'pending')
          ) {
            moveDir.copy(getObstacleAvoidanceDirection(
              this.combatPosition,
              moveDir,
              this._movementObstacleRadius(),
              this._movementObstacleHeight(),
              0,
              obstacles,
            ))
          }
        }

        if (import.meta.env.DEV && _collector) { var _tMvF = performance.now() }
        this._faceTarget(movementTarget)
        this._moveByDirection(
          moveDir,
          this.mount ? this.mount.baseSpeed : CHASE_SPEED,
          dt,
          this.tacticalOrder === 'charge' && !siegeObstacle,
        )

        clampToPlayableWorld(this.group.position)
        if (import.meta.env.DEV && _collector) { _collector.endPhase('moveFace', _tMvF!) }
        break
      }

      case AIState.ATTACK: {
        if (!targetInfo || targetInfo.isDead) {
          this._clearSiegeFallback()
          this.state = AIState.CHASE
          this.pendingLanceChargeSpeed = 0
          break
        }

        let siegeObstacle: ObstacleData | null = null
        if (this._siegeTargetObstacle) {
          const navigationRoute = !skipBoidsAndObstacles
            ? this._resolveNavigationMoveTarget(
              targetInfo.position,
              obstacles,
              navigationWorld,
            )
            : 'unreachable'
          if (navigationRoute === 'unreachable') {
            siegeObstacle = this._getActiveSiegeObstacle(targetInfo.position, obstacles)
          } else {
            // Another unit may have opened a route while this NPC was attacking.
            // Stop hitting the obstacle and return to chase/path following.
            this._clearSiegeFallback()
            this.animator.cancel()
            this.state = AIState.CHASE
            break
          }
        }

        const attackTargetPosition = siegeObstacle
          ? this._getObstacleAttackPoint(siegeObstacle, this._tmpSiegeTarget)
          : targetInfo.position
        const dist = siegeObstacle
          ? this._distanceToObstacleXZ(siegeObstacle)
          : this.combatPosition.distanceTo(targetInfo.position)

        if (
          !siegeObstacle
          && this.tacticalOrder === 'defend'
          && !this._isTargetInDefendRange(targetInfo.position)
        ) {
          this.animator.cancel()
          this.pendingLanceChargeSpeed = 0
          this.state = AIState.ALERT
          break
        }

        // Human target got too close: ranged units draw melee as before.
        if (!siegeObstacle && this.hasActiveRangedWeapon && dist < RANGED_ATTACK_MIN) {
          this._switchToMelee()
          this.state = AIState.CHASE
          break
        }

        if (this.hasActiveRangedWeapon && dist > this.maxRangedAttackDistance) {
          this.animator.cancel()
          this.state = this.tacticalOrder === 'defend' ? AIState.ALERT : AIState.CHASE
          break
        }

        // A human that becomes blocked again is no longer a viable shot.
        if (
          !siegeObstacle
          && this.hasActiveRangedWeapon
          && this._findRangedTrajectoryBlocker(targetInfo.position, obstacles) !== null
        ) {
          this.animator.cancel()
          this.state = AIState.CHASE
          break
        }

        if (import.meta.env.DEV && _collector) { var _tFaceAtk = performance.now() }
        this._faceTarget(attackTargetPosition)
        if (import.meta.env.DEV && _collector) { _collector.endPhase('moveFace', _tFaceAtk!) }

        // Mounted ranged units orbit humans, but hold position while deliberately
        // attacking a structure fallback.
        if (
          !siegeObstacle
          && this.isMounted
          && this.hasActiveRangedWeapon
          && this.tacticalOrder !== 'defend'
        ) {
          const moveDir = this._tmpMoveDir
          moveDir.copy(targetInfo.position).sub(this.group.position).cross(NPC._UP)
          moveDir.y = 0
          if (moveDir.lengthSq() > 0.001) {
            moveDir.normalize()
            if (!skipBoidsAndObstacles) {
              if (import.meta.env.DEV && _collector) { var _tObsOrbit = performance.now() }
              moveDir.copy(getObstacleAvoidanceDirection(
                this.combatPosition,
                moveDir,
                this._movementObstacleRadius(),
                this._movementObstacleHeight(),
                0,
                obstacles,
              ))
              if (import.meta.env.DEV && _collector) { _collector.endPhase('obstacleAvoid', _tObsOrbit!) }
            }
            if (import.meta.env.DEV && _collector) { var _tOrbitMove = performance.now() }
            this._moveByDirection(moveDir, this.mount ? this.mount.baseSpeed : CHASE_SPEED, dt)
            if (import.meta.env.DEV && _collector) { _collector.endPhase('moveFace', _tOrbitMove!) }
          }
        }

        if (import.meta.env.DEV && _collector) { var _tCombat = performance.now() }
        if (this.hasActiveRangedWeapon) {
          const rangedKind = this.rangedCombatKind ?? 'bow'
          const cooldown = getRangedCooldown(rangedKind)
          const isBow = rangedKind === 'bow'
          const windup = isBow ? 0.04 : (this.rig.animation?.getDuration('pilumThrow') ?? 0.45)

          this.attackTimer += dt
          const progress = Math.min(1, this.attackTimer / cooldown)

          if (isBow) {
            if (!this.animator.busy) {
              this.bowArrowReleased = false
              this.animator.poseBow(progress, Math.min(1, this.attackTimer / 0.18))
            }
            if (this.attackTimer >= cooldown - windup && this.animator.currentAction === 'bowAim') {
              this.animator.start('bowRelease')
            }
          } else {
            if (!this.animator.busy && this.attackTimer >= cooldown - windup) {
              this.pendingPilumTarget.copy(this._getElevatedRangedAimPoint(targetInfo.position))
              this.animator.start('pilumThrow')
            }
          }

          if (import.meta.env.DEV && _collector) { _collector.endPhase('combatLogic', _tCombat!) }
          if (import.meta.env.DEV && _collector) { var _tAnimAtk = performance.now() }
          const rangedEvents = this.animator.update(dt, cameraDistance)
          if (import.meta.env.DEV && _collector) { _collector.endPhase('humanoidAnim', _tAnimAtk!) }
          if (isBow) this._updateBowVisual(progress, attackTargetPosition)
          animationAdvanced = true
          const shouldFire = rangedEvents.projectileRelease
          if (shouldFire) {
            const origin = this._tmpRangedOrigin
            const dir = this._tmpRangedDirection
            const aimPoint = this._getElevatedRangedAimPoint(attackTargetPosition)
            if (isBow && this.bowVisual) {
              this.bowVisual.writeLaunch(origin, dir, aimPoint)
            } else {
              dir.copy(aimPoint).sub(origin).normalize()
            }
            onFireArrow(origin, dir, isBow ? 'arrow' : 'pilum')
            this.bowVisual?.hideArrow()

            this.arrows -= 1
            this.attackTimer = 0
            if (!isBow) this.bowPivot.visible = false
            if (isBow && !rangedEvents.actionCompleted) {
              this.bowArrowReleased = true
            }
          }
          if (!isBow && rangedEvents.actionCompleted) {
            if (this.arrows === 0) this._switchToMelee(true, true)
            this.state = AIState.CHASE
          }
        } else {
          const berserker = getBerserkerModifiers(
            this.characterFaction,
            this.isMounted,
            this.activeCombatKind,
            Boolean(this.shieldId),
          )
          if (!this.animator.busy && this.attackTimer <= 0) {
            this.animator.start(this._meleeAction())
            this.attackHitProcessed = false
          }

          this.animator.setLocomotion(this.visualMovementSpeed, this.isMounted, this.isSprinting)
          if (import.meta.env.DEV && _collector) { _collector.endPhase('combatLogic', _tCombat!) }
          if (import.meta.env.DEV && _collector) { var _tAnimMelee = performance.now() }
          const meleeEvents = this.animator.update(
            dt * berserker.meleeAttackRateMultiplier,
            cameraDistance,
          )
          if (import.meta.env.DEV && _collector) { _collector.endPhase('humanoidAnim', _tAnimMelee!) }
          animationAdvanced = true

          if (meleeEvents.hitActiveStarted && !this.attackHitProcessed) {
            if (siegeObstacle) {
              if (this._isObstacleInMeleeRange(siegeObstacle, 0.4)) {
                this.attackHitProcessed = true
                const finalDamage = Math.round(
                  this.meleeDamage * berserker.meleeDamageMultiplier,
                )
                const result = siegeObstacle.damageable!.takeDamage(finalDamage)
                if (result.destroyed) {
                  this._clearSiegeFallback()
                  this.state = AIState.CHASE
                  this.pendingLanceChargeSpeed = 0
                }
              }
            } else if (this._isTargetInMeleeRange(targetInfo.position, 0.4)) {
              this.attackHitProcessed = true
              const targetIsMounted = targetInfo.isPlayer
                ? Boolean(player?.isMounted)
                : Boolean(targetInfo.npc?.isMounted)
              const finalDamage = this._calcLanceDamage(this.meleeDamage, targetIsMounted)
              onHitEntity(finalDamage, targetInfo.isPlayer, targetInfo.npc)
            }
          }

          if (meleeEvents.actionCompleted) {
            this.attackTimer = AI_ATTACK_GAP / berserker.meleeAttackRateMultiplier
            this.pendingLanceChargeSpeed = 0
          }

          if (!meleeEvents.actionCompleted && !this.animator.busy && this.attackTimer > 0) {
            this.attackTimer -= dt
            const stillInRange = siegeObstacle
              ? this._isObstacleInMeleeRange(siegeObstacle)
              : this._isTargetInMeleeRange(targetInfo.position)
            if (this.attackTimer <= 0 && !stillInRange) {
              this.state = AIState.CHASE
              this.pendingLanceChargeSpeed = 0
            }
          }
        }
        break
      }
      }
    }

    if (this.isSprinting) {
      this.stamina = Math.max(0, this.stamina - STAMINA_DRAIN * dt)
    } else {
      this.stamina = Math.min(MAX_STAMINA, this.stamina + STAMINA_REGEN * dt)
    }

    this.rig.animation?.setSwordHandShape?.(this.swordPivot.visible && (this.swordPivot.userData.swordAttachmentOwned === true || this.swordPivot.userData.equipmentAttachmentOwned === 'lance'))
    if (!this.animator.busy && !animationAdvanced) {
      if (this.bowPivot.visible && this.characterFaction === 'viking') this.animator.poseBow(0)
      else if (!this.isUsingLance && (this.visualMovementSpeed <= 0.1 || this.animator.currentAction === 'bowAim')) this.animator.poseIdle()
    }
    this.animator.setLocomotion(this.visualMovementSpeed, this.isMounted, this.isSprinting)
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
        dir.copy(getObstacleAvoidanceDirection(
          this.combatPosition,
          dir,
          this._movementObstacleRadius(),
          this._movementObstacleHeight(),
          0,
          obstacles,
        ))
      }
      this._faceTarget(target)
      this._moveByDirection(dir, this.mount ? this.mount.baseSpeed * 0.5 : PATROL_SPEED, dt)
    }
  }

  private _updateFormationMovement(
    dt: number,
    nearbyNPCs: NPC[],
    obstacles: ObstacleData[],
    skipBoidsAndObstacles: boolean,
  ): void {
    const target = this.formationTarget
    if (!target) return

    this.alertSprite.visible = false
    const moveDir = this._tmpMoveDir.copy(target.position).sub(this.combatPosition)
    moveDir.y = 0
    const distance = moveDir.length()
    if (distance <= FORMATION_ARRIVAL_DISTANCE) {
      target.reached = true
      this._faceDirection(target.facing)
      this.state = AIState.IDLE
      return
    }
    moveDir.normalize()

    if (!skipBoidsAndObstacles) {
      this._tmpSep.set(0, 0, 0)
      let sepCount = 0
      for (const other of nearbyNPCs) {
        if (other === this || other.dead) continue
        const separationDistance = this.combatPosition.distanceTo(other.combatPosition)
        if (separationDistance < NPC_SEPARATION_RADIUS) {
          this._tmpPush.copy(this.group.position).sub(other.position)
          this._tmpPush.y = 0
          this._tmpSep.add(this._tmpPush.normalize().multiplyScalar(1.5 / Math.max(0.1, separationDistance)))
          sepCount++
        }
      }
      if (sepCount > 0) moveDir.add(this._tmpSep.divideScalar(sepCount)).normalize()
      moveDir.copy(getObstacleAvoidanceDirection(
        this.group.position,
        moveDir,
        this.mount ? 1 : 0.5,
        this.mount ? 2.6 : 2.3,
        0,
        obstacles,
      ))
    }

    // Face the travel direction while moving so directional movement does not
    // classify a distant slot behind the final formation facing as backward.
    this._faceDirection(moveDir)
    this._moveByDirection(moveDir, this.mount ? this.mount.baseSpeed : FORMATION_MOVE_SPEED, dt)
    clampToPlayableWorld(this.mount ? this.mount.group.position : this.group.position)
  }

  private _moveByDirection(direction: THREE.Vector3, baseSpeed: number, dt: number, allowSprint = false): void {
    if (direction.lengthSq() <= 0.0001) return
    direction.normalize()

    const facingYaw = this.mount ? this.mount.group.rotation.y : this.group.rotation.y
    const facing = this._tmpFacing.set(Math.sin(facingYaw), 0, Math.cos(facingYaw))
    const policy = getDirectionalMovementFromVector(facing, direction)
    const multiplier = getEffectiveSpeedMultiplier(policy, Boolean(this.mount))
    const berserker = getBerserkerModifiers(this.characterFaction, this.isMounted, this.activeCombatKind, Boolean(this.shieldId))
    if (allowSprint && policy.canSprint) {
      if (!this.chargeSprintLatched && this.stamina >= STAMINA_SPRINT_MIN) {
        this.chargeSprintLatched = true
      }
      if (this.stamina <= 0) this.chargeSprintLatched = false
    } else {
      this.chargeSprintLatched = false
    }
    this.isSprinting = this.chargeSprintLatched && this.stamina > 0
    const sprintMultiplier = this.isSprinting ? SPRINT_MULTIPLIER : 1
    const effectiveSpeed = baseSpeed * multiplier * berserker.moveSpeedMultiplier * sprintMultiplier

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
      this._faceDirection(dir)
    }
  }

  private _faceDirection(direction: THREE.Vector3): void {
    const targetAngle = Math.atan2(direction.x, direction.z)
    this.group.rotation.y = targetAngle
    if (this.mount) this.mount.group.rotation.y = targetAngle
  }

  /** Returns damage after applying lance charge, anti-cavalry, and berserker multipliers. */
  private _calcLanceDamage(baseDamage: number, targetIsMounted: boolean): number {
    const combatKind = this.meleeCombatKind
    const hasShield = Boolean(this.shieldId)
    const berserker = getBerserkerModifiers(this.characterFaction, this.isMounted, combatKind, hasShield)

    let dmg = baseDamage * berserker.meleeDamageMultiplier

    // Lance charge (mounted)
    const chargeSpeed = Math.max(this.mount?.movementSpeed ?? 0, this.pendingLanceChargeSpeed)
    this.pendingLanceChargeSpeed = 0

    const chargeResult = calculateLanceChargeDamage(baseDamage, combatKind, this.isMounted, chargeSpeed)
    if (chargeResult.isCharge) {
      if (this.mount && chargeResult.skipImpact) {
        this.mount.skipImpactThisFrame = true
      }
      dmg = chargeResult.damage * berserker.meleeDamageMultiplier
    }

    // Anti-cavalry (foot lance vs mounted target)
    const antiCav = getAntiCavalryMultiplier(combatKind, this.isMounted, targetIsMounted)
    dmg *= antiCav

    return Math.round(dmg)
  }

  private _isTargetInDefendRange(targetPos: THREE.Vector3): boolean {
    if (this.hasActiveRangedWeapon && this.combatPosition.distanceTo(targetPos) < RANGED_ATTACK_MIN) {
      this._switchToMelee()
    }
    if (this.hasActiveRangedWeapon) {
      return this.combatPosition.distanceTo(targetPos) <= this.maxRangedAttackDistance
    }
    return this._isTargetInMeleeRange(targetPos)
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

  private _switchToMelee(consumeRemainingAmmo = true, cancelAnimation = true): void {
    if (consumeRemainingAmmo) this.arrows = 0
    this.rangedActive = false
    this.pendingLanceChargeSpeed = 0
    this.swordPivot.visible = true
    this.bowPivot.visible = false
    if (cancelAnimation) this.animator.cancel()
  }

  respawn(): void {
    this.deathFade.reset(this.group)
    this.formationTarget = null
    this._clearObstacleDetour()
    this._clearSiegeFallback()
    this.pendingLanceChargeSpeed = 0
    this.state = AIState.IDLE
    this.currentHp = this.maxHp
    if (this.aiType === AIType.RANGED) {
      this.arrows = 1
      this.rangedActive = Boolean(this.rangedWeaponId)
      this.swordPivot.visible = !this.hasActiveRangedWeapon
      this.bowPivot.visible = this.hasActiveRangedWeapon
    } else {
      this.arrows = 0
      this.rangedActive = false
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
    this._rangedVisibleTargetHoldFrames = 0
    this._targetAcquisitionInitialized = false
    this._targetReacquireTimer = 0
    for (const cb of this.onRespawnCallbacks) cb(this)
  }
}
