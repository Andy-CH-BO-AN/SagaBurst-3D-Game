import { combatAllegiancesHostile } from '../combat/CombatFaction'
import { CIVILIAN_PROFILE } from '../town/TownRules'
import { applyEquipmentAttachment } from './EquipmentAttachmentContract'
/**
 * NPC.ts
 * Generic NPC AI unit (Faction System, Melee/Ranged).
 * Calibrated with getTerrainHeight(x, z) for procedural heightmap terrain.
 */
import * as THREE from 'three'
import { ShieldState, ShieldCollider, WeaponSweep } from '../combat/ShieldBlocking'
import { DeathFadeController } from './DeathFade'
import type { Player } from '../player/Player'
import type { SpatialGrid } from './SpatialGrid'
import type { HpBar } from '../ui/HpBar'
import {
  clampToPlayableWorld,
  getScenePlayableWorldBound,
  findBlockingObstacleAlongPath,
  findBlockingProjectileObstacleAlongPath,
  findObstacleDetourPlan,
  getObstacleAvoidanceDirection,
  getTerrainHeight,
  ObstacleData,
  resolveObstacleCollision,
  resolveEntityCollision,
  type ObstacleDetourPlan,
  type ObstacleDetourSide,
} from './Terrain'
import { applyCharacterMountedPose, buildCharacterVisual, polishWeaponMaterials } from './CharacterVisuals'
import type { CharacterRig, MountedPoseKind, CharacterFaction } from './CharacterVisuals'
import { HumanoidAssetRegistry } from './HumanoidAssetRegistry'
import type { HeroAssetId } from './HeroAssetCatalog'
import { resolveMakiEquipmentMode } from './MakiRangerEquipment'
import { applyHeroIncomingDamage, applyHeroOutgoingDamage, getT4HeroCombatModifiers, resolveT4UnitLoadout, type T4CombatProfileId } from '../battle/T4HeroCatalog'
import { AIM_RAYCAST_LAYER } from './AimTargetRegistry'

const NPC_AIM_GEOMETRY = new THREE.CylinderGeometry(0.45, 0.45, 1.85, 8)
const AIM_PROXY_MATERIAL = new THREE.MeshBasicMaterial()
import { CharacterCombatAnimator, meleeActionTimeScale, type CombatAction } from './CharacterCombatAnimator'
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
import type { SquadIdentity as SquadId } from '../battle/CommandTarget'
import { DEFAULT_TACTICAL_ORDER, type TacticalOrder } from '../battle/TacticalOrder'
import { FOLLOW_THRESHOLDS, followLocalOffset, followSlotWorldPosition } from '../battle/FollowOrder'
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
import { damageObstacle, damageNpc, damageMount } from '../combat/DamageRouter'
import { createNpcCombatActorRef, type CombatEventSink, type CombatDamageContext } from '../combat/CombatAttribution'
import { FallingRider, riderFallDamage, type FallingRiderSnapshot } from '../movement/FallingRider'
import { EagleFlightAI, type EagleFlightCommand, type EagleTactic } from '../movement/EagleFlightAI'
import { eagleBowEngagementRange } from '../combat/EagleRangedCombat'
import { BallisticIntercept, createProjectileFlightBudget, type ProjectileFlightBudget } from '../combat/ProjectileBallistics'
import { XONGKORO } from '../movement/XongkoroConfig'
import type { PhysicalCombatTarget } from '../combat/ShieldBlocking'
import { fitStandingRider } from './StandingRider'

export enum AIState {
  IDLE = 'IDLE',
  ALERT = 'ALERT',
  CHASE = 'CHASE',
  ATTACK = 'ATTACK',
  DEAD = 'DEAD',
}

export { Faction } from '../combat/CombatFaction'
import { Faction } from '../combat/CombatFaction'

export enum AIType {
  MELEE = 'MELEE',
  RANGED = 'RANGED',
}

export type NpcEagleFlightOrder = { kind: 'return'; target: THREE.Vector3; cruiseAltitude?: number; landingYaw: number } | { kind: 'hold'; cruiseAltitude?: number }

export type BanditAggroState = 'idle' | 'alerted' | 'provoked' | 'returning'

const DETECTION_RADIUS = 300.0
const RANGED_ATTACK_MIN = 6.0
const RANGED_AIM_LIFT_PER_METER_SQ = 0.015
const PROJECTILE_GRAVITY = 9.8
const NPC_FALLBACK_PROJECTILE_SPEED = 20.0

const CHASE_SPEED      = 4.8
const FORMATION_MOVE_SPEED = CHASE_SPEED
const PATROL_SPEED     = 2.2
const AI_ATTACK_GAP    = 0.35
const MELEE_CONTACT_MARGIN = 0.2
const MELEE_MISS_APPROACH_STEP = 0.3
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

interface CombatEquipmentSnapshot {
  tier: 1 | 2 | 3 | 4
  squadId?: SquadId
  presetId?: UnitPresetId
  meleeWeaponId: string | null
  meleeDamageOverride: number | undefined
  rangedWeaponId: string | undefined
  rangedDamage: number
  shieldId: string | null
  ammo: number
  rangedActive: boolean
}

export class NPC {
  readonly pendingFall = new FallingRider()
  private fallContext: CombatDamageContext | undefined
  private readonly eaglePilot = new EagleFlightAI()
  private readonly eagleNeighbors: THREE.Vector3[] = []
  private readonly eagleTargets: PhysicalCombatTarget[] = []
  private readonly eagleNpcCandidates: NPC[] = []
  private readonly eagleGoal = new THREE.Vector3()
  private readonly eagleAnchor = new THREE.Vector3()
  private eagleAnchorSet = false
  private eagleFlightOrder: NpcEagleFlightOrder | null = null
  private readonly eagleCommand: EagleFlightCommand = { kind: 'cruise', destination: this.eagleGoal }
  private readonly eagleTargetVelocity = new THREE.Vector3()
  private readonly eagleLastTargetPosition = new THREE.Vector3()
  private eagleLastTarget: object | undefined
  private readonly eagleMountNeighbors: Mount[] = []
  private readonly eagleNeighborPoints: THREE.Vector3[] = []

  get eagleTactic(): EagleTactic | null { return this.eaglePilot.tactic }
  setEagleCruiseAltitude(altitude: number): void { this.eaglePilot.setCruiseAltitude(altitude) }
  setEagleFlightOrder(order: NpcEagleFlightOrder | null): void {
    this.eagleFlightOrder = order?.kind === 'return' ? { ...order, target: order.target.clone() } : order
    if (order?.cruiseAltitude !== undefined) this.eaglePilot.setCruiseAltitude(order.cruiseAltitude)
    this.eaglePilot.reset()
    this.eagleAnchorSet = false
  }
  private fallObstacles: ObstacleData[] = []
  get isFalling(): boolean { return this.pendingFall.active }
  get fallSnapshot(): FallingRiderSnapshot | undefined { return this.pendingFall.active ? this.pendingFall.snapshot() : undefined }
  restorePendingFall(value: FallingRiderSnapshot): void { this.pendingFall.restore(value) }
  private static nextCombatantSerial = 1

  // Visuals
  group: THREE.Group
  characterVisualGroup: THREE.Group
  private _faction: Faction
  get faction(): Faction { return this._faction }
  readonly characterFaction: CharacterFaction
  readonly aiType: AIType
  readonly name: string
  private _tier: 1 | 2 | 3 | 4
  get tier(): 1 | 2 | 3 | 4 { return this._tier }
  readonly visualAssetId?: HeroAssetId
  readonly combatProfileId?: T4CombatProfileId
  readonly specialCombatProfile?: 'maki-ranger'
  presetId?: UnitPresetId
  private _squadId?: SquadId
  get squadId(): SquadId | undefined { return this._squadId }
  /** Command membership changes independently of weapons, HP and mount state. */
  setCommandSquad(squadId: SquadId | undefined): void { this._squadId = squadId }
  combatOwnership?: import('../combat/CombatFaction').CombatOwnership
  readonly combatantId: string
  private readonly combatEventSink?: CombatEventSink

  private _meleeDamageOverride: number | undefined
  get meleeDamage(): number {
    return this._meleeDamageOverride ?? WEAPONS[this.meleeWeaponId ?? '']?.damageMax ?? 20
  }
  set meleeDamage(value: number) { this._meleeDamageOverride = value }
  private _rangedDamage: number
  get rangedDamage(): number { return this._rangedDamage }
  public readonly generatedAsCavalry: boolean
  public mount: Mount | null = null
  public meleeAttackRadius = 1.8
  public isUsingLance = false
  public meleeWeaponId: string | null = 'steel_sword'
  public rangedWeaponId?: string
  public loadout?: UnitLoadout
  private originalCombatEquipment: CombatEquipmentSnapshot | null = null
  public tacticalOrder: TacticalOrder = DEFAULT_TACTICAL_ORDER

  private formationTarget: {
    commandId: number
    position: THREE.Vector3
    facing: THREE.Vector3
    reached: boolean
    speedLimit?: number
    arrivalOrder?: TacticalOrder
  } | null = null
  private followTarget: NPC | Player | null = null
  private followSlotIndex = -1
  private followLocalOffset = new THREE.Vector3()
  private readonly followSmoothedLeaderPosition = new THREE.Vector3()
  private followSmoothedLeaderYaw = 0
  private followCombatActive = false
  private followNavigationActive = false
  private followNavigationCheckRemaining = 0
  private followGoalSyncRemaining = 0
  private readonly followNavigationGoal = new THREE.Vector3()

  get meleeCombatKind(): 'sword' | 'lance' {
    const w = this.meleeWeaponId ? WEAPONS[this.meleeWeaponId] : null
    return w?.combatKind === 'lance' || this.isUsingLance ? 'lance' : 'sword'
  }

  get rangedCombatKind(): 'bow' | 'javelin' | null {
    const weapon = this.rangedWeaponId ? WEAPONS[this.rangedWeaponId] : undefined
    return getRangedCombatKind(weapon)
  }

  get hasActiveRangedWeapon(): boolean {
    return this.rangedActive && Boolean(this.rangedWeaponId) && this.arrows > 0 && !this.shieldId
  }

  get combatAmmo(): number { return this.arrows }

  /** Restores saved ammunition after selecting a runtime loadout, without changing its canonical equipment. */
  restoreCombatAmmo(ammo: number): void {
    this._cancelEquipmentCombatState()
    this.arrows = this.rangedWeaponId && Number.isFinite(ammo) ? Math.max(0, Math.floor(ammo)) : 0
    this.rangedActive = Boolean(this.rangedWeaponId) && this.arrows > 0
    this.swordPivot.visible = !this.hasActiveRangedWeapon && this.meleeWeaponId !== null && this.specialCombatProfile !== 'maki-ranger'
    this.bowPivot.visible = this.hasActiveRangedWeapon || this.specialCombatProfile === 'maki-ranger'
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
    const eagleRange = eagleBowEngagementRange(this.isMounted ? this.mount?.type : undefined, this.rangedWeaponId ? WEAPONS[this.rangedWeaponId] : undefined)
    return eagleRange ?? getNpcRangedAttackRange(kind, this.isMounted) * (getT4HeroCombatModifiers(this.combatProfileId)?.rangedAttackRangeMultiplier ?? 1)
  }

  get rangedProjectileSpeed(): number {
    const weapon = this.rangedWeaponId ? WEAPONS[this.rangedWeaponId] : undefined
    return weapon?.arrowSpeedMax ?? NPC_FALLBACK_PROJECTILE_SPEED
  }

  private readonly eagleBallisticIntercept = new BallisticIntercept()
  private readonly eagleRangedOrigin = new THREE.Vector3()
  private readonly eagleRangedAim = new THREE.Vector3()
  private readonly eagleRangedTarget = new THREE.Vector3()
  private readonly eagleRangedVelocity = new THREE.Vector3()
  private readonly eagleRangedCandidates: NPC[] = []
  private eagleShotCheckRemaining = 0
  private eagleShotClear = false

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
  readonly shield = new ShieldState()
  shieldCollider!: ShieldCollider
  readonly weaponSweep = new WeaponSweep()
  combatMountGrid: SpatialGrid<Mount> | null = null
  private readonly combatMountCandidates: Mount[] = []
  bodyHitNodes: THREE.Object3D[] = []
  private readonly sweepGrip = new THREE.Vector3()
  private rangedTargetHeightOffset = 0
  public shieldId: string | null = null
  readonly equipmentVisualLOD = new EquipmentVisualLODController()
  private builtShieldId: string | null | undefined = undefined

  readonly maxHp: number
  private currentHp: number

  private state: AIState = AIState.IDLE
  private encounterOrigin: THREE.Vector3 | null = null
  private encounterAggro: BanditAggroState = 'alerted'
  private playerHitFocus = 0
  private encounterLeash = Infinity
  private alertTimer = 0
  private attackTimer = 0
  private attackHitProcessed = false
  private meleeApproachLimit = Infinity
  private meleeApproachTarget: Player | NPC | null = null
  private meleeApproachMounted = false
  private meleeApproachTargetMounted = false
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
  /** Urgent mission travel: sprint to the destination, defending immediate contact without abandoning the order. */
  missionMovement = false
  /** Siege attackers may answer aircraft while retaining their assigned march. */
  missionAerialDefense = false
  /** undefined uses normal AI; null holds fire; an actor restricts mission combat to that target. */
  private missionCombatTarget: NPC | Player | null | undefined = undefined
  setMissionCombatTarget(target: NPC | Player | null | undefined): void {
    if (this.missionCombatTarget === target) return
    this.missionCombatTarget = target
    this._targetAcquisitionInitialized = false
    this._cachedTargetIsPlayer = false
    this._cachedTargetNpc = null
    this._rangedVisibleTargetHoldFrames = 0
    this._clearNavigationPath()
    this._clearObstacleDetour()
    this._clearSiegeFallback()
  }
  private assignedSiegeObstacle: ObstacleData | null = null
  get hasSiegeObstacle(): boolean { return this._isAttackableObstacle(this.assignedSiegeObstacle) }
  assignSiegeObstacle(obstacle: ObstacleData | null): void {
    if (this.assignedSiegeObstacle === obstacle) return
    this.assignedSiegeObstacle = obstacle
    this._clearNavigationPath(); this._clearSiegeFallback()
    if (obstacle) { this._siegeTargetObstacle = obstacle; this.state = AIState.CHASE }
  }
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
  /** Completion comes from the death update, never normal visibility or visual LOD. */
  get deathPresentationComplete(): boolean { return this.dead && this.deathFade.completed }
  
  get inCombat(): boolean {
    return this.state === AIState.CHASE || this.state === AIState.ATTACK
  }
  get position(): THREE.Vector3 { return this.group.position }
  get combatPosition(): THREE.Vector3 { return this.mount && !this.mount.isFlyingMount ? this.mount.group.position : this.group.position }
  get isMounted(): boolean { return this.mount !== null && !this.mount.dead }
  get combatAnimationAction(): CombatAction { return this.animator.currentAction }
  get formationCommandId(): number | null { return this.formationTarget?.commandId ?? null }
  get activeFollowTarget(): NPC | Player | null { return this.followTarget }
  get activeFollowSlotIndex(): number { return this.followSlotIndex }
  get activeFollowLocalOffset(): THREE.Vector3 { return this.followLocalOffset.clone() }
  get combatFormationCheckpoint(): { commandId: number; position: { x: number; z: number; yaw: number }; reached: boolean; speedLimit?: number; arrivalOrder?: TacticalOrder } | undefined {
    const target = this.formationTarget
    if (!target || this.tacticalOrder === 'follow') return undefined
    return { commandId: target.commandId,
      position: { x: target.position.x, z: target.position.z, yaw: Math.atan2(target.facing.x, target.facing.z) },
      reached: target.reached, speedLimit: target.speedLimit, arrivalOrder: target.arrivalOrder }
  }
  get encounterIsAlerted(): boolean { return this.encounterOrigin !== null && this.encounterAggro !== 'idle' }
  get encounterAggroState(): BanditAggroState { return this.encounterAggro }

  /** Keeps camp Bandits on the existing combat AI while gating target knowledge until alert. */
  configureBanditEncounter(origin: THREE.Vector3, patrolWaypoints: readonly THREE.Vector3[] = [], leash = 58): void {
    this.encounterOrigin = origin.clone()
    this.encounterLeash = leash
    this.encounterAggro = 'idle'
    this.playerHitFocus = 0
    if (patrolWaypoints.length > 0) {
      this.waypoints = patrolWaypoints.map(point => point.clone())
      this.currentWaypointIdx = 0
    }
    if (!this.dead) this.state = AIState.IDLE
    this._cachedTargetIsPlayer = false
    this._cachedTargetNpc = null
    this._targetAcquisitionInitialized = false
  }

  /** Release encounter targeting before another owner takes over travel or Town hostility. */
  clearEncounter(): void {
    this.encounterOrigin = null
    this.encounterLeash = Infinity
    this.encounterAggro = 'idle'
    this.playerHitFocus = 0
    this._cachedTargetIsPlayer = false
    this._cachedTargetNpc = null
    this._targetAcquisitionInitialized = false
    this.alertSprite.visible = false
    if (!this.dead) this.state = AIState.IDLE
  }

  triggerEncounterAlert(): void {
    if (this.dead) return
    if (this.encounterAggro === 'provoked' || this.encounterAggro === 'alerted') return
    if (this.encounterAggro === 'returning') return
    this.encounterAggro = 'alerted'
    this.formationTarget = null
    this.tacticalOrder = 'attack'
    if (this.state === AIState.IDLE) {
      this.state = AIState.ALERT
      this.alertTimer = .4
      this.alertSprite.visible = true
    }
    this._targetAcquisitionInitialized = false
  }

  provokeEncounter(): void {
    if (this.dead || !this.encounterOrigin) return
    const firstDetection = this.encounterAggro === 'idle'
    this.encounterAggro = 'provoked'
    this.formationTarget = null
    this.tacticalOrder = 'attack'
    if (firstDetection && this.state === AIState.IDLE) {
      this.state = AIState.ALERT
      this.alertTimer = .2
      this.alertSprite.visible = true
    }
    this._targetAcquisitionInitialized = false
    this._clearNavigationPath()
  }

  /** Squad controllers share the same encounter return semantics as camp Bandits. */
  returnFromEncounter(): void { this._beginEncounterReturn() }

  /** An effective Player hit interrupts a stale NPC target and makes Player the combat target. */
  retaliateAgainstPlayer(): void {
    if (this.dead || !this.targetsPlayer) return
    this.playerHitFocus = 10
    this._cachedTargetIsPlayer = true
    this._cachedTargetNpc = null
    this._targetAcquisitionInitialized = true
    this._targetReacquireFramesRemaining = 0
    if (this.missionMovement) return
    this.formationTarget = null
    if (this.state === AIState.IDLE) this.state = AIState.CHASE
    this._clearNavigationPath()
  }

  isFormationTargetReached(commandId: number): boolean {
    return this.formationTarget?.commandId === commandId && this.formationTarget.reached
  }

  getWeaponTipPosition(): THREE.Vector3 {
    if (this.banditHammerTip) return this.banditHammerTip.getWorldPosition(this._tmpWeaponTip)
    if (this.specialCombatProfile === 'maki-ranger' && this.bowVisual) return this.bowVisual.getTopTipPosition(this._tmpWeaponTip)
    return this.swordGripPivot.localToWorld(this._tmpWeaponTip.copy(this.swordTipLocal))
  }

  getWeaponGripPosition(target: THREE.Vector3): THREE.Vector3 {
    if (this.banditHammerGrip) return this.banditHammerGrip.getWorldPosition(target)
    if (this.specialCombatProfile === 'maki-ranger' && this.bowVisual) return this.bowVisual.getGripPosition(target)
    return weaponGripWorld(this.swordGripPivot, target)
  }

  private readonly playableWorldBound: number

  constructor(
    scene: THREE.Scene,
    spawnX: number,
    spawnZ: number,
    faction: Faction,
    characterFaction: CharacterFaction,
    aiType: AIType,
    name: string,
    tier: 1 | 2 | 3 | 4,
    cavalry?: boolean,
    loadout?: UnitLoadout,
    presetId?: UnitPresetId,
    squadId?: SquadId,
    combatantId?: string,
    combatEventSink?: CombatEventSink,
    visualAssetId?: HeroAssetId,
    combatProfileId?: T4CombatProfileId,
    specialCombatProfile?: 'maki-ranger',
    readonly townCategory?: 'civilian',
    civilianStyle?: CharacterFaction,
  ) {
    this.playableWorldBound = getScenePlayableWorldBound(scene)
    this.spawnX = spawnX
    this.spawnZ = spawnZ
    this._faction = faction
    this.characterFaction = characterFaction
    this.aiType = aiType
    this.name = name
    this._tier = tier
    this.visualAssetId = visualAssetId
    this.combatProfileId = combatProfileId
    this.specialCombatProfile = specialCombatProfile
    this.maxHp = townCategory === 'civilian' ? CIVILIAN_PROFILE.hp : getT4HeroCombatModifiers(combatProfileId)?.maxHp ?? COMBAT_BALANCE.hp.npcDefault
    this.currentHp = this.maxHp
    this.loadout = loadout
    this.presetId = presetId
    this._squadId = squadId
    this.combatantId = combatantId ?? `npc-${NPC.nextCombatantSerial++}`
    this.combatEventSink = combatEventSink
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
      this._rangedDamage = this.rangedWeaponId
        ? applyHeroOutgoingDamage(baseRangedDamage * getRangedDamageMultiplier(rangedKind), combatProfileId)
        : 0
      this.arrows = this.rangedWeaponId ? 30 : 0
    } else {
      const unitType: BattleUnitType = this.generatedAsCavalry
        ? (this.aiType === AIType.RANGED ? 'horseArcher' : 'cavalry')
        : (this.aiType === AIType.RANGED ? 'archer' : 'infantry')
      const combatProfile = getUnitCombatProfile(this.characterFaction, unitType, this.tier === 4 ? 3 : this.tier)

      this.meleeWeaponId = combatProfile.meleeWeaponId
      this.rangedWeaponId = specialCombatProfile === 'maki-ranger'
        ? resolveT4UnitLoadout(`${characterFaction}_archer`).rangedWeaponId ?? undefined
        : combatProfile.rangedWeaponId
      const canonicalRangerBow = specialCombatProfile === 'maki-ranger' && this.rangedWeaponId ? WEAPONS[this.rangedWeaponId] : undefined
      this._rangedDamage = canonicalRangerBow
        ? applyHeroOutgoingDamage(canonicalRangerBow.damageMax * getRangedDamageMultiplier('bow'), combatProfileId)
        : combatProfile.rangedDamage ?? 0
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
      tier: this.tier === 4 ? 3 : this.tier,
      isPlayer: false,
      civilian: townCategory === 'civilian',
      civilianStyle,
    } as const
    const allowLegacyFixture = import.meta.env.MODE === 'test'
      || (import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('legacyhumanoids'))
    const visual = HumanoidAssetRegistry.ready
      ? HumanoidAssetRegistry.createCharacterVisual(this.characterVisualGroup, visualConfig, faction === Faction.BANDIT ? 'bandit' : this.visualAssetId)
      : allowLegacyFixture
        ? buildCharacterVisual(this.characterVisualGroup, visualConfig)
        : (() => { throw new Error(`${visualConfig.faction} humanoid assets were not preloaded`) })()
    this.bodyMesh = visual.bodyMesh as THREE.Group
    this.headMesh = visual.headMesh as THREE.Mesh
    this.rig = visual.rig
    this.bodyHitNodes = [this.rig.left.elbow, this.rig.left.wrist, this.rig.right.elbow, this.rig.right.wrist, this.rig.leftLeg.ankle, this.rig.rightLeg.ankle]
    if (faction === Faction.BANDIT) {
      this.banditHammerTip = this.bodyMesh.getObjectByName('hammer_tip')
      this.banditHammerGrip = this.bodyMesh.getObjectByName('hammer_grip')
    }
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
    this._rebuildActiveRangedVisual()

    this.shieldPivot = new THREE.Group()
    this.shieldCollider = new ShieldCollider(this.shieldPivot, this.shield)
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

  private townArmed = false
  private banditHammerTip?: THREE.Object3D
  private banditHammerGrip?: THREE.Object3D
  private townHostile = false
  private duelHostile = false
  armTownCivilian(weaponId: string): void {
    if (this.townCategory !== 'civilian' || this.dead) return
    this.townArmed = true
    this._setActiveMeleeWeapon(weaponId)
    this.swordPivot.visible = true
  }
  private get targetsPlayer(): boolean { return this.duelHostile || this.faction === Faction.ENEMY || this.faction === Faction.BANDIT || this.faction === Faction.TOWN && this.townHostile }
  get hostileToPlayer(): boolean { return this.targetsPlayer }
  /** Only town resident command handoffs change allegiance; appearance and identity stay intact. */
  setCommandAllegiance(faction: Faction.PLAYER | Faction.TOWN): void {
    if (this._faction !== Faction.PLAYER && this._faction !== Faction.TOWN) return
    if (this._faction === faction) return
    this._faction = faction
    this._cachedTargetIsPlayer = false
    this._cachedTargetNpc = null
    this._targetAcquisitionInitialized = false
    this._rangedVisibleTargetHoldFrames = 0
    this.playerHitFocus = 0
    if (this.mount) this.mount.setNpcRider(this, faction)
  }
  /** Local duel hostility never activates Town retaliation or targets other actors. */
  setDuelHostility(active: boolean): void {
    if (this.duelHostile === active) return
    this.duelHostile = active
    // Duel resolution releases hostility after lethal damage; preserve the death clip.
    if (this.dead) return
    this._cancelEquipmentCombatState()
    this.setTacticalOrder('attack')
    this._cachedTargetIsPlayer = false
    this._cachedTargetNpc = null
    this._targetAcquisitionInitialized = false
    this._rangedVisibleTargetHoldFrames = 0
    this.playerHitFocus = 0
    this.alertSprite.visible = false
    if (!this.dead) this.state = active ? AIState.CHASE : AIState.IDLE
    this._restoreCombatReadyRangedVisual()
  }
  setTownPeaceful(): void {
    this.townHostile = false
    this.duelHostile = false
    this.respawnEnabled = false
    this.animator.cancel()
    if (this.townCategory === 'civilian') { this.swordPivot.visible = false; this.bowPivot.visible = false }
  }
  beginExternalThreat(): void {
    if (this.dead || this.townHostile || this.duelHostile) return
    this.animator.cancel()
    this.setTacticalOrder('charge')
    this.state = AIState.CHASE
    this._targetAcquisitionInitialized = false
    this._restoreCombatReadyRangedVisual()
  }
  endExternalThreat(): void {
    if (this.dead || this.townHostile || this.duelHostile) return
    this.setTownPeaceful()
    this.setTacticalOrder('attack')
    this.state = AIState.IDLE
    this._cachedTargetIsPlayer = false
    this._cachedTargetNpc = null
    this._targetAcquisitionInitialized = false
  }
  beginTownHostility(): void {
    this.townHostile = true
    this.respawnEnabled = false
    if (this.dead) return
    this.clearEncounter()
    this.setMissionCombatTarget(undefined)
    this.missionMovement = false
    this.animator.cancel()
    this.setTacticalOrder('charge')
    this.state = AIState.CHASE
    this._restoreCombatReadyRangedVisual()
    if (this.townCategory === 'civilian' && !this.townArmed) {
      this.townArmed = true
      this._setActiveMeleeWeapon(CIVILIAN_PROFILE.retaliationWeapon)
      this.swordPivot.visible = true
    }
  }
  /** Peace uses animation and assigned motion only: no battle target search or A*. */
  updateTownPeace(dt: number, distance: number, training: boolean, startAttack: boolean, speed = 0, trainingPhase = 0): boolean {
    if (this.pendingFall.active) {
      this._updateRiderFall(dt, this.fallObstacles)
      this.animator.update(dt, distance)
      return false
    }
    if (this.dead) {
      if (!this.deathFade.update(this.group, dt)) this.animator.update(dt, distance)
      return false
    }
    this.animator.setEquipment(this.isUsingLance, Boolean(this.shieldId), this.mount?.type as MountedPoseKind)
    this.animator.setLocomotion(speed, this.isMounted)
    if (training && startAttack && !this.animator.busy) {
      if (this.rangedCombatKind === 'javelin') this._restoreCombatReadyRangedVisual()
      this.animator.start(this.hasActiveRangedWeapon ? (this.rangedCombatKind === 'javelin' ? 'pilumThrow' : 'bowRelease') : this._meleeAction())
    }
    if (training && this.hasActiveRangedWeapon && this.rangedCombatKind === 'bow' && !this.animator.busy) {
      const charge = Math.min(1, trainingPhase / 1.3)
      this.animator.poseBow(charge)
      this._tmpRangedTarget.set(0, 1.3, 4).applyQuaternion(this.group.quaternion).add(this.group.position)
      this.bowVisual?.update(charge, this._tmpRangedTarget, true)
    }
    const events = this.animator.update(dt, distance)
    if (training && this.rangedCombatKind === 'javelin' && events.projectileRelease) this.bowPivot.visible = false
    if (this.isMounted) this._syncToMount()
    if (this.townCategory === 'civilian') { this.swordPivot.visible = false; this.bowPivot.visible = false }
    return events.projectileRelease
  }
  /** Reuses tactical formation/follow movement without combat acquisition or attacks. */
  updateTownTravel(dt: number, distance: number, nearby: NPC[], obstacles: ObstacleData[], navigation: NavigationWorld,
    followAnchor?: { position: THREE.Vector3; yaw: number }): void {
    this.fallObstacles = obstacles
    if (this.pendingFall.active) { this._updateRiderFall(dt, obstacles); this.animator.update(dt, distance); return }
    if (this.dead) { this.updateTownPeace(dt, distance, false, false); return }
    if (this.mount?.dead) this.dismountFromMount()
    if (this.mount?.flight) {
      this._updateEagleTravel(dt, nearby, obstacles, followAnchor)
      this.updateTownPeace(dt, distance, false, false, this.mount.movementSpeed)
      return
    }
    const previousPosition = this._tmpPreviousPosition.copy(this.group.position)
    this.visualMovementSpeed = 0
    this.isSprinting = false
    this.mount?.setCameraDistance(distance)
    this.mount?.beginControlledFrame()
    this._updateFormationMovement(dt, nearby, obstacles, false, navigation, followAnchor)
    for (const other of nearby) {
      if (other === this || other.dead) continue
      resolveEntityCollision(
        { position: this.combatPosition, radius: this.isMounted ? 1 : .5, height: this.isMounted ? 2.6 : 2.3, bottomOffset: 0 },
        { position: other.combatPosition, radius: other.isMounted ? 1 : .42, height: other.isMounted ? 2.6 : 1.8, bottomOffset: 0, anchored: true },
        obstacles,
      )
    }
    if (this.mount) this.mount.finishControlledFrame(dt, obstacles)
    else this._updateFootPhysics(previousPosition, dt, obstacles)
    this.updateTownPeace(dt, distance, false, false, this.mount?.movementSpeed ?? this.visualMovementSpeed)
  }

  dispose(): void {
    this.pendingFall.clear()
    this.fallContext = undefined
    this.mount?.releaseRider()
    this.mount = null
    this.animator.cancel()
    this.rig.animation?.stop()
    this.alertSprite.material.map?.dispose()
    this.alertSprite.material.dispose()
    this.group.removeFromParent()
  }

  mountVehicle(mount: Mount): void {
    if (this.pendingFall.active || this.mount?.isAirborne || mount.isAirborne || mount.dead || mount.disposed || mount.riderPlayer || mount.riderNpc && mount.riderNpc !== this) return
    if (this.mount && this.mount !== mount) this.dismountFromMount()
    if (this.mount && this.mount !== mount) return
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
  dismountFromMount({ forceFall = false }: { forceFall?: boolean } = {}): void {
    this.pendingLanceChargeSpeed = 0
    if (!this.mount) return
    const oldMount = this.mount
    // HP reaches zero before this actor's normal death state/callback transition.
    const airborne = oldMount.isFlyingMount && (oldMount.isAirborne || oldMount.dead || this.currentHp <= 0 || forceFall)
    const mountPosition = this._tmpDismountPosition.copy(airborne ? this.group.position : oldMount.group.position)
    if (oldMount.isFlyingMount && !airborne && !oldMount.findGroundDismountPosition(mountPosition, this.fallObstacles)) return
    if (airborne && oldMount.flight) {
      oldMount.getRiderStandingSeatWorld(mountPosition)
      this.pendingFall.begin(mountPosition, oldMount.flight.velocity)
      this.fallContext = oldMount.knockdownContext
    }
    this.mount.releaseRider()
    this.mount = null
    if (!this.rig.equipmentGripFrames) applyCharacterMountedPose(this.rig, false)
    this.rig.animation?.setEquipmentState?.({ mounted: false })
    this.animator.setLocomotion(0, false)
    this.rig.animation?.update(0)
    this._alignExternalVisualToMount(false)
    this.group.position.copy(mountPosition)
    this.group.rotation.x = this.group.rotation.z = 0
  }

  rebuildShield(): void {
    if (this.faction === Faction.BANDIT) return
    // Ranged loadouts (bows and javelins) cannot also carry an active shield.
    if (this.rangedWeaponId) this.shieldId = null
    if (this.builtShieldId === this.shieldId) return
    this.builtShieldId = this.shieldId
    this.shield.equip(this.shieldId)
    this.shieldCollider.setModel(this.shieldId)
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
    this.meleeApproachLimit = Infinity
  }

  private _rebuildActiveMeleeVisual(): void {
    this.animator?.cancel()
    while (this.swordGripPivot.children.length > 0) {
      this.swordGripPivot.remove(this.swordGripPivot.children[0])
    }
    // A new weapon must not inherit the old blade's mounted/foot attachment.
    this.swordPivot.userData.swordAttachmentOwned = false
    delete this.swordPivot.userData.equipmentAttachmentOwned
    if (!this.meleeWeaponId || this.specialCombatProfile === 'maki-ranger' || this.faction === Faction.BANDIT) return
    this.swordTipLocal.copy(
      WeaponMeshFactory.buildNpcMelee(
        this.characterFaction,
        this.aiType === AIType.RANGED ? 1 : this.tier === 4 ? 3 : this.tier,
        this.isUsingLance,
        this.swordGripPivot,
        this.meleeWeaponId ?? undefined,
      ),
    )
    this.swordGripPivot.position.set(0, 0, 0)
    this.swordGripPivot.rotation.set(0, 0, 0)
    if (this.rig.equipmentGripFrames && this.isUsingLance) {
      applyEquipmentAttachment(this.rig.right.handSocket, this.swordPivot, this.swordGripPivot, this.rig.equipmentGripFrames.lanceRight, 'lance')
    } else if (this.rig.swordGripFrame) {
      applySwordAttachment(this.rig.right.handSocket, this.swordPivot, this.swordGripPivot, this.rig.swordGripFrame, this.rig.equipmentGripFrames?.lanceRight.modelRotationLocal, this.rig.equipmentGripFrames?.lanceRight.axeMountedRotationLocal)
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

  private _rebuildActiveRangedVisual(): void {
    this.bowVisual?.hideArrow()
    this.bowVisual = undefined
    this.bowGripPivot.clear()
    this.bowGripPivot.position.set(0, 0, 0)
    this.bowGripPivot.rotation.set(0, 0, 0)
    this.bowGripPivot.scale.set(1, 1, 1)
    const kind = this.rangedCombatKind
    if (kind === 'javelin') {
      this.rig.right.handSocket.add(this.bowPivot)
      applyAttachmentContract(this.rig.right.handSocket, 'r', this.bowPivot, 'ranged', 0)
      // The chosen weapon's tier controls its visual, independently of actor tier.
      WeaponMeshFactory.buildNpcRanged('roman', WEAPONS[this.rangedWeaponId!].tier, this.bowGripPivot)
    } else {
      this.rig.left.handSocket.add(this.bowPivot)
      applyBowAttachment(this.rig.left.handSocket, this.bowPivot)
      if (kind === 'bow') {
        this.bowVisual = new CharacterBowVisual(this.bowPivot, this.bowGripPivot)
        this.bowVisual.rebuild(this.specialCombatProfile === 'maki-ranger' ? 'maki-ranger-bow' : this.rangedWeaponId!, true)
        this.bowVisual.hideArrow()
      }
    }
    polishWeaponMaterials(this.bowPivot)
    this.equipmentVisualLOD.register(kind === 'javelin' ? 'pilum' : 'bow', this.bowGripPivot)
  }

  /** Synchronizes combat values and visuals without replacing the Town loadout. Mounts are owned by the caller. */
  applyTemporaryCombatLoadout(loadout: UnitLoadout, tier?: 1 | 2 | 3 | 4, squadId?: SquadId, presetId?: UnitPresetId): void {
    if (!this.originalCombatEquipment) {
      this.originalCombatEquipment = {
        tier: this.tier,
        squadId: this.squadId,
        presetId: this.presetId,
        meleeWeaponId: this.meleeWeaponId,
        meleeDamageOverride: this._meleeDamageOverride,
        rangedWeaponId: this.rangedWeaponId,
        rangedDamage: this.rangedDamage,
        shieldId: this.shieldId,
        ammo: this.arrows,
        rangedActive: this.rangedActive,
      }
    }
    this._cancelEquipmentCombatState()
    if (tier !== undefined) this._tier = tier
    if (squadId !== undefined) this._squadId = squadId
    if (presetId !== undefined) this.presetId = presetId
    this._meleeDamageOverride = undefined
    this._setActiveMeleeWeapon(loadout.meleeWeaponId ?? null)
    this.rangedWeaponId = loadout.rangedWeaponId ?? undefined
    const rangedWeapon = this.rangedWeaponId ? WEAPONS[this.rangedWeaponId] : undefined
    this._rangedDamage = rangedWeapon
      ? applyHeroOutgoingDamage(rangedWeapon.damageMax * getRangedDamageMultiplier(this.rangedCombatKind), this.combatProfileId)
      : 0
    this.arrows = this.rangedWeaponId ? 30 : 0
    this.rangedActive = Boolean(this.rangedWeaponId)
    this._rebuildActiveRangedVisual()
    this.shieldId = loadout.shieldId ?? null
    this.rebuildShield()
    this.swordPivot.visible = !this.hasActiveRangedWeapon && this.meleeWeaponId !== null
    this.bowPivot.visible = this.hasActiveRangedWeapon
    if (this.state === AIState.ATTACK) this.state = AIState.CHASE
    this.animator.setEquipment(this.isUsingLance, Boolean(this.shieldId), this.mount?.type as MountedPoseKind)
    this.rig.animation?.update(0)
  }

  /** Multiple temporary selections still restore the equipment held before the first override. */
  restoreCombatLoadout(): void {
    const original = this.originalCombatEquipment
    if (!original) return
    this._cancelEquipmentCombatState()
    this._tier = original.tier
    this._squadId = original.squadId
    this.presetId = original.presetId
    this._setActiveMeleeWeapon(original.meleeWeaponId)
    this._meleeDamageOverride = original.meleeDamageOverride
    this.rangedWeaponId = original.rangedWeaponId
    this._rangedDamage = original.rangedDamage
    this.arrows = original.ammo
    this.rangedActive = original.rangedActive
    this._rebuildActiveRangedVisual()
    this.shieldId = original.shieldId
    this.rebuildShield()
    this.swordPivot.visible = !this.hasActiveRangedWeapon && this.meleeWeaponId !== null
    this.bowPivot.visible = this.hasActiveRangedWeapon
    this.originalCombatEquipment = null
    this.animator.setEquipment(this.isUsingLance, Boolean(this.shieldId), this.mount?.type as MountedPoseKind)
    this.rig.animation?.update(0)
  }

  private _cancelEquipmentCombatState(): void {
    this.animator.cancel()
    this.bowArrowReleased = false
    this.attackTimer = 0
    this.attackHitProcessed = false
    this.meleeApproachLimit = Infinity
    this.meleeApproachTarget = null
    this.pendingLanceChargeSpeed = 0
    this.bowVisual?.hideArrow()
  }

  private _restoreCombatReadyRangedVisual(): void {
    if (!this.hasActiveRangedWeapon) return
    this.swordPivot.visible = false
    this.bowPivot.visible = true
  }

  private _isVikingFootSpecialist(): boolean {
    return this.originalCombatEquipment === null && this.specialCombatProfile !== 'maki-ranger' && this.characterFaction === 'viking'
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
    if (this.mount?.isFlyingMount) this.setEagleFlightOrder(null)
    this.formationTarget = null
    this.followTarget = null
    this.followSlotIndex = -1
    this.followCombatActive = false
    this._resetFollowNavigation()
    this._clearNavigationPath()
    this._clearObstacleDetour()
    this._clearSiegeFallback()
    this.tacticalOrder = order
    this.shield.shieldRaised = this.shield.active && order === 'defend'
    if (this.dead) return
    if (order === 'defend') this._restoreVikingDefensiveStance()
    else if (order === 'charge') {
      this._enterVikingChargeStance()
      this._targetAcquisitionInitialized = false
      if (this.state === AIState.IDLE || this.state === AIState.ALERT) this.state = AIState.CHASE
    }
    this._restoreCombatReadyRangedVisual()
  }

  assignFormationTarget(commandId: number, target: THREE.Vector3, facing: THREE.Vector3, speedLimit?: number, arrivalOrder?: TacticalOrder, reached = false): void {
    if (this.dead) return
    this._clearNavigationPath()
    this._clearObstacleDetour()
    this._clearSiegeFallback()
    this._cancelEquipmentCombatState()
    this.tacticalOrder = arrivalOrder ?? 'formation'
    this.followTarget = null
    this.followSlotIndex = -1
    this.followCombatActive = false
    this._resetFollowNavigation()
    this.formationTarget = {
      commandId,
      position: target.clone(),
      facing: facing.clone().setY(0).normalize(),
      reached,
      speedLimit,
      arrivalOrder,
    }
    this.state = AIState.CHASE
    this._restoreCombatReadyRangedVisual()
  }

  assignFollowTarget(target: NPC | Player, slotIndex: number, localOffset = followLocalOffset(slotIndex, this.isMounted), marchSpeed?: number,
    anchor?: { position: THREE.Vector3; yaw: number }): void {
    if (this.dead || target === this) return
    if (this.mount?.isFlyingMount) this.setEagleFlightOrder(null)
    this._clearNavigationPath()
    this._clearObstacleDetour()
    this._clearSiegeFallback()
    this._cancelEquipmentCombatState()
    this.tacticalOrder = 'follow'
    this.followTarget = target
    this.followSlotIndex = Math.max(0, Math.floor(slotIndex))
    this.followLocalOffset.copy(localOffset)
    this.followSmoothedLeaderPosition.copy(anchor?.position ?? target.combatPosition)
    this.followSmoothedLeaderYaw = anchor?.yaw ?? target.group.rotation.y
    this.followCombatActive = false
    this._resetFollowNavigation()
    this.followNavigationCheckRemaining = this._initialStaggerPhase * .6
    const position = followSlotWorldPosition(this.followSmoothedLeaderPosition, this.followSmoothedLeaderYaw, this.followLocalOffset)
    this.formationTarget = {
      commandId: -1,
      position,
      facing: new THREE.Vector3(Math.sin(target.group.rotation.y), 0, Math.cos(target.group.rotation.y)),
      reached: false,
      speedLimit: marchSpeed,
    }
    this.state = AIState.IDLE
    this._restoreCombatReadyRangedVisual()
  }

  private _meleeAction(): Exclude<CombatAction, 'idle' | 'bowAim' | 'bowRelease'> {
    if (this.faction === Faction.BANDIT) return 'swordSlash'
    if (this.specialCombatProfile === 'maki-ranger') return 'axeAttack2H'
    if (this.isUsingLance) return this.isMounted ? 'mountedLance' : 'lanceThrust'
    if (WEAPONS[this.meleeWeaponId ?? '']?.animationKind === 'axe') return this.shieldId ? 'axeAttack1H' : 'axeAttack2H'
    return 'swordSlash'
  }

  private _getElevatedRangedAimPoint(targetWorld: THREE.Vector3): THREE.Vector3 {
    const origin = this._tmpRangedOrigin
    if (this.bowVisual) this.bowVisual.getNockPosition(origin)
    else origin.copy(this.group.position).setY(this.group.position.y + 1.0)

    const aimPoint = this._tmpRangedTarget.copy(targetWorld)
    aimPoint.y += 1.4 + this.rangedTargetHeightOffset
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

  /** Applies an exact saved combat HP value without reapplying T4 damage modifiers. */
  restoreCombatHealth(hp: number): void {
    const restoredHp = Math.min(this.maxHp, Math.max(0, Number.isFinite(hp) ? hp : this.maxHp))
    if (restoredHp === 0) {
      if (!this.dead) this.takeDamage(this.maxHp * 100)
      return
    }
    if (!this.dead) this.currentHp = restoredHp
  }

  takeDamage(amount: number): boolean {
    return this._applyDamage(amount, false)
  }

  takeFallDamage(amount: number): boolean { return this._applyDamage(amount, true) }

  private _applyDamage(amount: number, environmental: boolean): boolean {
    if (this.state === AIState.DEAD) return false

    this.currentHp = Math.max(0, this.currentHp - (environmental ? amount : applyHeroIncomingDamage(amount, this.combatProfileId)))
    if (this.currentHp > 0 && amount > 0 && this.faction === Faction.BANDIT) this.rig.animation?.playHitReaction?.()
    if (this.state === AIState.IDLE && !this.encounterOrigin) {
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

  private _resetFollowNavigation(): void {
    this.followNavigationActive = false
    this.followNavigationCheckRemaining = 0
    this.followGoalSyncRemaining = 0
    this.followNavigationGoal.set(0, 0, 0)
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
      !this.duelHostile
      && damageable
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

  /** Real launch position, finite constant-velocity lead, low ballistic arc and physical clearance. */
  private _prepareEagleRangedShot(
    target: { position: THREE.Vector3; isDead: boolean; isPlayer: boolean; npc?: NPC },
    targetVelocity: THREE.Vector3,
    obstacles: ObstacleData[],
  ): boolean {
    const flight = this.mount?.flight
    if (!flight || target.isDead || !this.hasActiveRangedWeapon || !this._isEagleTargetInBounds(target.position)
      || this.combatPosition.distanceToSquared(target.position) > this.maxRangedAttackDistance ** 2) return false
    const origin = this.eagleRangedOrigin
    if (this.bowVisual && this.rangedCombatKind === 'bow') this.bowVisual.getNockPosition(origin)
    else this.bowGripPivot.getWorldPosition(origin)
    this.eagleRangedTarget.copy(target.position).setY(target.position.y + RANGED_AI_TARGET_HEIGHT)
    // Bound prediction by physically supported actor speeds; observed motion is
    // sampled by the pilot, never used to steer an already-released projectile.
    this.eagleRangedVelocity.copy(targetVelocity).clampLength(0, XONGKORO.sprintSpeed)
    const solution = this.eagleBallisticIntercept
    if (!solution.solve(origin, this.eagleRangedTarget, this.eagleRangedVelocity, this.rangedProjectileSpeed)) return false
    if (Math.abs(solution.impactPoint.x) > this.playableWorldBound || Math.abs(solution.impactPoint.z) > this.playableWorldBound) return false
    const direction = solution.direction
    const aimYaw = Math.atan2(direction.x, direction.z)
    const yawError = Math.atan2(Math.sin(aimYaw - flight.yaw), Math.cos(aimYaw - flight.yaw))
    const pitchError = Math.atan2(direction.y, Math.hypot(direction.x, direction.z)) - flight.pitch
    if (Math.abs(yawError) > XONGKORO.rangedYawArc || Math.abs(pitchError) > XONGKORO.rangedPitchArc
      || !solution.isPathClear(origin, this.rangedProjectileSpeed, obstacles)) return false
    this.eagleRangedAim.copy(origin).addScaledVector(direction, this.rangedProjectileSpeed * solution.flightTime)
    return true
  }

  private _getActiveSiegeObstacle(
    humanTarget: THREE.Vector3,
    obstacles: ObstacleData[],
  ): ObstacleData | null {
    if (this._isAttackableObstacle(this.assignedSiegeObstacle)) { this._siegeTargetObstacle = this.assignedSiegeObstacle; return this.assignedSiegeObstacle }
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
    if (this.missionCombatTarget !== undefined) return false
    const range = this.maxRangedAttackDistance
    const minRangeSq = RANGED_ATTACK_MIN * RANGED_ATTACK_MIN
    const maxRangeSq = range * range
    let bestIsPlayer = false
    let bestNpc: NPC | null = null
    let bestDistSq = Infinity

    if (
      this.targetsPlayer
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
        || !combatAllegiancesHostile(this, candidate)
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
    if (player.isMounted && player.currentMount && !player.currentMount.isFlyingMount) {
      return out.copy(player.currentMount.group.position)
    }
    return out.copy(player.group.position)
  }

  private _isCachedTargetValid(player: Player): boolean {
    if (this.mount?.isFlyingMount) {
      const position = this._cachedTargetIsPlayer ? this._getPlayerPosition(player, this._tmpTargetPosition) : this._cachedTargetNpc?.combatPosition
      if (position && !this._isEagleTargetInBounds(position)) return false
    }
    if (this._cachedTargetIsPlayer) {
      return this.targetsPlayer && player.targetable && !player.dead
    }
    if (this._cachedTargetNpc !== null) {
      return !this._cachedTargetNpc.dead && combatAllegiancesHostile(this, this._cachedTargetNpc)
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
    if (this.missionCombatTarget !== undefined) return this._findTarget(player, allNPCs)
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

  /** Eagle sensors keep the scene's hostile grid/mission policy, with a bounded 3D search. */
  private _isEagleTargetInBounds(position: THREE.Vector3): boolean {
    const range = this.hasActiveRangedWeapon ? Math.max(DETECTION_RADIUS, this.maxRangedAttackDistance) : DETECTION_RADIUS
    return Number.isFinite(position.x + position.y + position.z)
      && Math.abs(position.x) <= this.playableWorldBound && Math.abs(position.z) <= this.playableWorldBound
      && this.combatPosition.distanceToSquared(position) <= range * range
  }

  private _findEagleTarget(player: Player, allNPCs: NPC[], grid: SpatialGrid<NPC> | null):
    { position: THREE.Vector3; isDead: boolean; isPlayer: boolean; npc?: NPC } | null {
    const range = this.hasActiveRangedWeapon ? Math.max(DETECTION_RADIUS, this.maxRangedAttackDistance) : DETECTION_RADIUS
    let nearest: NPC | null = null
    let distanceSq = range * range + 1e-6
    let playerTarget = false
    const playerPosition = this._getPlayerPosition(player, this._tmpTargetPosition)
    if (this.targetsPlayer && player.targetable && !player.dead && this._isEagleTargetInBounds(playerPosition)) {
      playerTarget = true
      distanceSq = this.combatPosition.distanceToSquared(playerPosition)
      if (this.playerHitFocus > 0) return { position: playerPosition, isDead: false, isPlayer: true }
    }
    const candidates = grid?.getNearbyInto(this.combatPosition, range, this.eagleRangedCandidates) ?? allNPCs
    for (const candidate of candidates) {
      if (candidate === this || candidate.dead || !combatAllegiancesHostile(this, candidate)
        || !this._isEagleTargetInBounds(candidate.combatPosition)) continue
      const candidateDistanceSq = this.combatPosition.distanceToSquared(candidate.combatPosition)
      if (candidateDistanceSq < distanceSq) { nearest = candidate; distanceSq = candidateDistanceSq; playerTarget = false }
    }
    return playerTarget ? { position: playerPosition, isDead: false, isPlayer: true }
      : nearest ? { position: nearest.combatPosition, isDead: false, isPlayer: false, npc: nearest } : null
  }

  private _findTarget(
    player: Player,
    allNPCs: NPC[],
    hostileNpcGrid: SpatialGrid<NPC> | null = null,
    chaseTargetCoordinator: ChaseTargetCoordinator | null = null,
  ): { position: THREE.Vector3, isDead: boolean, isPlayer: boolean, npc?: NPC } | null {
    if (this.missionCombatTarget !== undefined) {
      const target = this.missionCombatTarget
      if (!target || target.dead) return null
      if (this.mount?.isFlyingMount && !this._isEagleTargetInBounds(target.combatPosition)) return null
      if (target === player) return this.targetsPlayer && player.targetable
        ? { position: this._getPlayerPosition(player, this._tmpTargetPosition), isDead: false, isPlayer: true } : null
      if (target instanceof NPC && combatAllegiancesHostile(this, target)) return { position: target.combatPosition, isDead: false, isPlayer: false, npc: target }
      return null
    }
    if (this.mount?.isFlyingMount) return this._findEagleTarget(player, allNPCs, hostileNpcGrid)
    let closestTarget = null
    let closestDistSq = Infinity

    if (this.playerHitFocus > 0 && this.targetsPlayer && player.targetable && !player.dead) {
      const playerPos = this._getPlayerPosition(player, this._tmpTargetPosition)
      return { position: playerPos, isDead: false, isPlayer: true }
    }

    // Check Player separately because Player is not stored in the NPC spatial grids.
    if (this.targetsPlayer && player.targetable && !player.dead) {
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
          candidate => !candidate.dead && combatAllegiancesHostile(this, candidate),
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
        if (npc === this || npc.dead || !combatAllegiancesHostile(this, npc)) continue
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
    _playerHpBar: Pick<HpBar, 'setFill'>,
    onHitEntity: (damage: number, isPlayer: boolean, targetNpc?: NPC) => void,
    onFireArrow: (origin: THREE.Vector3, direction: THREE.Vector3, visualKind: 'arrow' | 'pilum', flightBudget?: ProjectileFlightBudget) => void,
    skipBoidsAndObstacles: boolean = false,
    cameraDistance: number = 0,
    _collector: NpcSubphaseCollector | null = null,
    hostileNpcGrid: SpatialGrid<NPC> | null = null,
    navigationWorld: NavigationWorld | null = null,
    chaseTargetCoordinator: ChaseTargetCoordinator | null = null,
  ): void {
    this.fallObstacles = obstacles
    if (this.pendingFall.active) {
      this._updateRiderFall(dt, obstacles)
      this.animator.update(dt, cameraDistance)
      return
    }
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

    if (this.mount?.flight && !this.mount.dead) {
      this._updateEagleCombat(dt, player, allNPCs, nearbyNPCs, obstacles, onHitEntity, onFireArrow, cameraDistance, hostileNpcGrid)
      return
    }

    this.playerHitFocus = Math.max(0, this.playerHitFocus - dt)

    if (this.encounterOrigin && this.encounterAggro === 'provoked' && player.dead) this._beginEncounterReturn()
    if (
      this.encounterOrigin
      && this.encounterAggro === 'alerted'
      && this.combatPosition.distanceToSquared(this.encounterOrigin) > this.encounterLeash * this.encounterLeash
    ) this._beginEncounterReturn()
    if (
      this.encounterOrigin
      && this.encounterAggro === 'returning'
      && this.combatPosition.distanceToSquared(this.encounterOrigin) <= 9
    ) {
      this.encounterAggro = 'idle'
      this.playerHitFocus = 0
      this.formationTarget = null
      this.tacticalOrder = 'attack'
      this.state = AIState.IDLE
      this._clearNavigationPath()
      this._clearObstacleDetour()
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
    this.shield.shieldRaised = this.shield.active && this.tacticalOrder === 'defend'
    this.shieldCollider.refreshVisibility()
    this.animator.setEquipment(this.isUsingLance, this.shield.active, this.mount?.type as MountedPoseKind | undefined, true)
    this.animator.setShieldRaised(this.shield.shieldRaised)
    this.rig.animation?.setEquipmentState?.({ mounted: this.isMounted })
    if (!this.animator.busy && this.isUsingLance) this.animator.poseLanceReady(this.isMounted)

    if (this.tacticalOrder === 'follow') {
      const contact = nearbyNPCs.some(other => other !== this && !other.dead && combatAllegiancesHostile(this, other) && other.combatPosition.distanceToSquared(this.combatPosition) <= 64
        && (this.combatOwnership !== 'player-personal' || this.meleeWeaponId || this.hasActiveRangedWeapon && other.combatPosition.distanceToSquared(this.combatPosition) >= RANGED_ATTACK_MIN ** 2))
      if (this.combatOwnership === 'player-personal' && !this.meleeWeaponId && !contact) this.followCombatActive = false
      if (contact) {
        this.followCombatActive = true
        this._targetAcquisitionInitialized = false
      } else if (this.followCombatActive) {
        const targetGone = this._cachedTargetNpc?.dead ?? !this._cachedTargetIsPlayer
        const targetFar = this._cachedTargetNpc ? this._cachedTargetNpc.combatPosition.distanceToSquared(this.combatPosition) > 36 * 36 : false
        if (targetGone || targetFar) {
          this.followCombatActive = false
          this.state = AIState.IDLE
        }
      }
    }
    const missionOrder = this.missionMovement ? this.tacticalOrder : null
    const missionTarget = this.missionMovement ? this._findTarget(player, allNPCs, hostileNpcGrid) : null
    const missionTargetMount = missionTarget?.isPlayer ? player.currentMount : missionTarget?.npc?.mount
    // Marching archers cannot get within the ground-contact radius of a flying
    // target. Use their existing 3D weapon range for that target only, preserving
    // the 20m interruption policy for ground combat and the march destination.
    const missionRangedRange = this.missionAerialDefense && missionTargetMount?.isFlyingMount && missionTargetMount.isAirborne
      ? this.maxRangedAttackDistance : Math.min(20, this.maxRangedAttackDistance)
    const missionContact = missionTarget && !missionTarget.isDead
      && (this.hasActiveRangedWeapon ? this.combatPosition.distanceToSquared(missionTarget.position) <= missionRangedRange ** 2 : this._isTargetInDefendRange(missionTarget.position))
      && this._findRangedTrajectoryBlocker(missionTarget.position, obstacles) === null
    if (missionContact) {
      this.tacticalOrder = 'defend'
      if (this.state !== AIState.ATTACK) this.state = AIState.ATTACK
    }
    if (!missionContact && ((this.tacticalOrder === 'formation'  || this.tacticalOrder === 'defend' && this.formationTarget?.arrivalOrder === 'defend' || this.tacticalOrder === 'follow' && !this.followCombatActive) && this.formationTarget)) {
      this._updateFormationMovement(dt, nearbyNPCs, obstacles, skipBoidsAndObstacles, navigationWorld)
    } else {
      if (import.meta.env.DEV && _collector) { var _tTargetAI = performance.now() }
      let targetInfo = missionContact ? missionTarget : this._getTarget(
        dt,
        player,
        allNPCs,
        hostileNpcGrid,
        chaseTargetCoordinator,
      )
      if (this.combatOwnership === 'player-personal' && !this.meleeWeaponId
        && (!this.hasActiveRangedWeapon || targetInfo && this.combatPosition.distanceToSquared(targetInfo.position) < RANGED_ATTACK_MIN ** 2)) targetInfo = null
      if (this.hasSiegeObstacle && (this.combatOwnership !== 'player-personal' || this.meleeWeaponId || this.hasActiveRangedWeapon)) {
        targetInfo = { position: this.assignedSiegeObstacle!.box.getCenter(this._tmpTargetPosition), isDead: false, isPlayer: false }
        this._siegeTargetObstacle = this.assignedSiegeObstacle
      }
      const meleeTarget = targetInfo?.isPlayer ? player : targetInfo?.npc ?? null
      if (
        meleeTarget !== this.meleeApproachTarget
        || this.isMounted !== this.meleeApproachMounted
        || Boolean(meleeTarget?.isMounted) !== this.meleeApproachTargetMounted
      ) {
        this.meleeApproachLimit = Infinity
        this.meleeApproachTarget = meleeTarget
        this.meleeApproachMounted = this.isMounted
        this.meleeApproachTargetMounted = Boolean(meleeTarget?.isMounted)
      }
      // Correct aim height only; movement/range/target selection retain existing coordinates.
      this.rangedTargetHeightOffset = targetInfo?.isPlayer && !player.isMounted ? player.bodyBaseOffset ?? 0 : 0
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
        const aimPoint = targetInfo
          ? this._getElevatedRangedAimPoint(targetInfo.position)
          : this.pendingPilumTarget
        origin.copy(this.bowGripPivot.getWorldPosition(origin))
        direction.copy(aimPoint).sub(origin).normalize()
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
        // Personal Attack holds its actual position when no hostile is available;
        // constructor patrol waypoints belong to Town/field NPCs, not the Player's party.
        const personalAttack = this.combatOwnership === 'player-personal' && this.tacticalOrder === 'attack'
        if (!personalAttack && this.tacticalOrder !== 'defend' && this.tacticalOrder !== 'charge') {
          this._updatePatrol(dt, obstacles, skipBoidsAndObstacles, navigationWorld)
        }

        if ((!this.encounterOrigin || this.encounterAggro === 'alerted' || this.encounterAggro === 'provoked') && targetInfo && !targetInfo.isDead) {
          const dist = this.combatPosition.distanceTo(targetInfo.position)
          const detectionRadius = this.tacticalOrder === 'charge' ? Infinity : this.tacticalOrder === 'follow' ? 24 : DETECTION_RADIUS
          if (dist <= detectionRadius) {
            if (this.encounterOrigin) {
              // Awareness was already announced by idle -> alerted/provoked.
              this.state = AIState.CHASE
            } else {
              this.state = AIState.ALERT
              this.alertTimer = 0.6
              this.alertSprite.visible = true
            }
          }
        }
        break
      }

      case AIState.ALERT: {
        this.alertTimer -= dt
        if (!this.hasActiveRangedWeapon) this.attackTimer = Math.max(0, this.attackTimer - dt)
        if (targetInfo) this._faceTarget(targetInfo.position)

        if (this.alertTimer <= 0) {
          this.alertSprite.visible = false
          if (this.tacticalOrder === 'defend') {
            this.state = targetInfo && this._isTargetInDefendRange(targetInfo.position) ? AIState.ATTACK : AIState.ALERT
            if (this.hasActiveRangedWeapon) this.attackTimer = 0
          } else {
            this.state = AIState.CHASE
          }
        }
        break
      }

      case AIState.CHASE: {
        this.alertSprite.visible = false
        if (!this.hasActiveRangedWeapon) this.attackTimer = Math.max(0, this.attackTimer - dt)
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
        const maxDetectionDistance = this.tacticalOrder === 'follow' ? 36 : DETECTION_RADIUS * 1.5
        if (this.tacticalOrder !== 'charge' && distSq > maxDetectionDistance * maxDetectionDistance) {
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
        const navigationRoute = this.hasSiegeObstacle ? 'unreachable' : !skipBoidsAndObstacles
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
          if (this.combatOwnership === 'player-personal' && !this.meleeWeaponId) { this.state = AIState.ALERT; break }
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
          if (dist <= this.maxRangedAttackDistance && (dist >= RANGED_ATTACK_MIN || this.specialCombatProfile === 'maki-ranger')) {
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
            && this._isTargetInMeleeApproachRange(targetInfo.position)
          ) {
            this._clearObstacleDetour()
            this._clearSiegeFallback()
            this.state = AIState.ATTACK
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
            // The physical body solver keeps combatants apart. Boids must not
            // repel the chosen melee opponent before our weapon can reach them.
            if (!this.hasActiveRangedWeapon && other === targetInfo.npc) continue
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

        clampToPlayableWorld(this.group.position, this.playableWorldBound)
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
          const navigationRoute = this.hasSiegeObstacle ? 'unreachable' : !skipBoidsAndObstacles
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
        if (!siegeObstacle && this.hasActiveRangedWeapon && dist < RANGED_ATTACK_MIN && this.specialCombatProfile !== 'maki-ranger') {
          if (this.combatOwnership === 'player-personal' && !this.meleeWeaponId) { this.animator.cancel(); this.state = AIState.ALERT; break }
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
        if (!siegeObstacle && !this.hasActiveRangedWeapon && this.isUsingLance) {
          // The authored spear is held beside the torso. Aim its actual forward
          // tip at the opponent rather than sending a parallel thrust past them.
          const tip = this.getWeaponTipPosition()
          const yaw = this.group.rotation.y
          const dx = tip.x - this.group.position.x, dz = tip.z - this.group.position.z
          const localX = dx * Math.cos(yaw) - dz * Math.sin(yaw)
          const localZ = dx * Math.sin(yaw) + dz * Math.cos(yaw)
          if (localZ > 0.1) {
            this.group.rotation.y -= Math.atan2(localX, localZ)
            if (this.mount) this.mount.group.rotation.y = this.group.rotation.y
          }
        }
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
          const cooldown = getRangedCooldown(rangedKind) / (getT4HeroCombatModifiers(this.combatProfileId)?.attackSpeedMultiplier ?? 1)
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
              this.animator.start('bowRelease', getT4HeroCombatModifiers(this.combatProfileId)?.attackSpeedMultiplier ?? 1)
            }
          } else {
            if (!this.animator.busy && this.attackTimer >= cooldown - windup) {
              this.pendingPilumTarget.copy(this._getElevatedRangedAimPoint(targetInfo.position))
              if (this.animator.start('pilumThrow', getT4HeroCombatModifiers(this.combatProfileId)?.attackSpeedMultiplier ?? 1)) this.bowPivot.visible = true
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
              origin.copy(this.bowGripPivot.getWorldPosition(origin))
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
          // A target can leave physical reach during recovery. Recheck before
          // starting the next swing rather than attacking at the old data range.
          if (!siegeObstacle && !this.animator.busy && !this._isTargetInMeleeApproachRange(targetInfo.position)) {
            this.state = this.tacticalOrder === 'defend' ? AIState.ALERT : AIState.CHASE
            this.pendingLanceChargeSpeed = 0
            break
          }
          const berserker = getBerserkerModifiers(
            this.characterFaction,
            this.isMounted,
            this.activeCombatKind,
            Boolean(this.shieldId),
          )
          if (!this.animator.busy && this.attackTimer <= 0) {
            this.animator.start(this._meleeAction(), meleeActionTimeScale(this._meleeAction(), WEAPONS[this.meleeWeaponId ?? ''], getT4HeroCombatModifiers(this.combatProfileId)?.attackSpeedMultiplier ?? 1))
            this.attackHitProcessed = false
          }

          this.animator.setLocomotion(this.visualMovementSpeed, this.isMounted, this.isSprinting)
          if (import.meta.env.DEV && _collector) { _collector.endPhase('combatLogic', _tCombat!) }
          if (import.meta.env.DEV && _collector) { var _tAnimMelee = performance.now() }
          const attackSpeed = getT4HeroCombatModifiers(this.combatProfileId)?.attackSpeedMultiplier ?? 1
          this.weaponSweep.capture(this.getWeaponGripPosition(this.sweepGrip), this.getWeaponTipPosition())
          const meleeEvents = this.animator.update(
            dt * berserker.meleeAttackRateMultiplier,
            cameraDistance,
          )
          if (import.meta.env.DEV && _collector) { _collector.endPhase('humanoidAnim', _tAnimMelee!) }
          animationAdvanced = true

          this.weaponSweep.capture(this.getWeaponGripPosition(this.sweepGrip), this.getWeaponTipPosition())
          if ((meleeEvents.hitActiveStarted || this.animator.meleeHitActive) && !this.attackHitProcessed) {
            if (siegeObstacle) {
              if (this._isObstacleInMeleeRange(siegeObstacle, 0.4)) {
                this.attackHitProcessed = true
                const finalDamage = applyHeroOutgoingDamage(
                  Math.round(this.meleeDamage * berserker.meleeDamageMultiplier),
                  this.combatProfileId,
                )
                const result = damageObstacle(siegeObstacle.damageable!, finalDamage, {
                  source: createNpcCombatActorRef(this),
                  method: 'siege',
                  weaponId: this.meleeWeaponId ?? undefined,
                  emit: this.combatEventSink,
                })
                if (result.destroyed) {
                  this._clearSiegeFallback()
                  this.state = AIState.CHASE
                  this.pendingLanceChargeSpeed = 0
                }
              }
            } else if (this._isTargetInMeleeRange(targetInfo.position, 0.4)) {
              const targetIsMounted = targetInfo.isPlayer
                ? Boolean(player?.isMounted)
                : Boolean(targetInfo.npc?.isMounted)
              const physicalTarget = targetInfo.isPlayer ? player : targetInfo.npc
              const mounts = this.combatMountGrid?.getNearbyInto(this.combatPosition, this.meleeAttackRadius + 4, this.combatMountCandidates) ?? []
              const contact = physicalTarget && this.weaponSweep.traceFirst([physicalTarget], mounts, this.mount)
              if (contact) {
                const finalDamage = this._calcLanceDamage(this.meleeDamage, targetIsMounted || contact.kind === 'mount')
                this.attackHitProcessed = true
                onHitEntity(finalDamage, targetInfo.isPlayer, targetInfo.npc)
              }
            }
          }

          if (meleeEvents.actionCompleted) {
            this.attackTimer = AI_ATTACK_GAP / (berserker.meleeAttackRateMultiplier * attackSpeed)
            this.pendingLanceChargeSpeed = 0
            if (!siegeObstacle && !this.attackHitProcessed) {
              // Weapon length is only an initial estimate: actual arcs, shields
              // and hand offsets can require a closer position. A complete miss
              // must make progress instead of repeating the same stationary swing.
              if (this._isTargetInMeleeRange(targetInfo.position)) {
                this.meleeApproachLimit = Math.max(this._meleeBodySpacing(), Math.min(
                  this._meleeApproachDistance(),
                  Math.hypot(
                    targetInfo.position.x - this.combatPosition.x,
                    targetInfo.position.z - this.combatPosition.z,
                  ),
                ) - MELEE_MISS_APPROACH_STEP)
              }
              this.state = this.tacticalOrder === 'defend' ? AIState.ALERT : AIState.CHASE
            }
          }

          if (!meleeEvents.actionCompleted && !this.animator.busy && this.attackTimer > 0) {
            this.attackTimer -= dt
            const stillInRange = siegeObstacle
              ? this._isObstacleInMeleeRange(siegeObstacle)
              : this._isTargetInMeleeApproachRange(targetInfo.position)
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

    if (missionOrder) this.tacticalOrder = missionOrder
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
      this._updateFootPhysics(previousPosition, dt, obstacles)
      if (import.meta.env.DEV && _collector) { _collector.endPhase('footPhysics', _tFoot!) }
    }
  }

  private _updateRiderFall(dt: number, obstacles: ObstacleData[]): void {
    const height = this.pendingFall.update(this.group.position, dt, obstacles, this.playableWorldBound)
    this.velY = this.pendingFall.velocity.y
    this.onGround = !this.pendingFall.active
    if (height === null) return
    const context = this.fallContext
    this.fallContext = undefined
    if (this.dead) return
    const damage = riderFallDamage(this.maxHp, height)
    if (context) damageNpc(this, damage, { ...context, method: 'fall', contact: undefined, weaponId: undefined, attackSource: undefined })
    else this.takeFallDamage(damage)
  }

  private _addEagleNeighbor(other: Mount): void {
    const mount = this.mount!
    const position = mount.group.position, point = other.group.position
    const ownVelocity = mount.flight!.velocity, velocity = other.flight!.velocity
    const x = point.x - position.x, y = point.y - position.y, z = point.z - position.z
    const vx = velocity.x - ownVelocity.x, vy = velocity.y - ownVelocity.y, vz = velocity.z - ownVelocity.z
    const speedSq = vx * vx + vy * vy + vz * vz
    const time = speedSq > .01 ? THREE.MathUtils.clamp(-(x * vx + y * vy + z * vz) / speedSq, 0, 2) : 0
    const px = x + vx * time, py = y + vy * time, pz = z + vz * time
    if (Math.min(x * x + y * y + z * z, px * px + py * py + pz * pz) >= XONGKORO.aiSeparationRadius ** 2) return
    const index = this.eagleNeighbors.length
    const neighbor = this.eagleNeighborPoints[index] ?? (this.eagleNeighborPoints[index] = new THREE.Vector3())
    neighbor.set(position.x + px, position.y + py, position.z + pz)
    if (neighbor.distanceToSquared(position) < .01) {
      // Both members derive the same lateral axis and opposite signs. Exact
      // coincidence and head-on predicted crossings cannot choose one escape side.
      const lower = mount.group.id < other.group.id
      const yaw = lower ? mount.flight!.yaw : other.flight!.yaw
      neighbor.set(position.x + Math.cos(yaw) * (lower ? 1 : -1), position.y,
        position.z - Math.sin(yaw) * (lower ? 1 : -1))
    }
    this.eagleNeighbors.push(neighbor)
  }

  /** Physical neighbors are independent of hostility, target acquisition and ground boid throttles. */
  private _collectEagleNeighbors(nearby: NPC[], player?: Player, attackMount?: Mount | null): void {
    const mount = this.mount!
    this.eagleNeighbors.length = 0
    const mounts = this.combatMountGrid?.getNearbyInto(mount.group.position,
      XONGKORO.aiSeparationRadius + XONGKORO.sprintSpeed * 2, this.eagleMountNeighbors)
    if (mounts) {
      for (const other of mounts) if (other !== mount && other !== attackMount && other.isFlyingMount && !other.dead && !other.disposed) this._addEagleNeighbor(other)
    } else {
      // Isolated/dev callers have no scene index; production uses the all-mount spatial grid.
      for (const other of nearby) if (other !== this && !other.dead && other.mount?.isFlyingMount && other.mount !== attackMount) this._addEagleNeighbor(other.mount)
    }
    const playerMount = player?.currentMount
    if (playerMount?.isFlyingMount && !playerMount.dead && playerMount !== mount && playerMount !== attackMount
      && (!mounts || !mounts.includes(playerMount))) this._addEagleNeighbor(playerMount)
  }

  private _updateEagleTravel(dt: number, nearby: NPC[], obstacles: ObstacleData[],
    followAnchor?: { position: THREE.Vector3; yaw: number }, player?: Player): void {
    const mount = this.mount!
    const flight = mount.flight!
    this._collectEagleNeighbors(nearby, player)
    const formation = this.formationTarget
    const follow = this.tacticalOrder === 'follow' && this.followTarget && !this.followTarget.dead
    const order = this.eagleFlightOrder
    const command = this.eagleCommand
    command.target = undefined; command.altitude = undefined; command.landingYaw = undefined
    if (order?.kind === 'return') {
      command.kind = 'return'; this.eagleGoal.copy(order.target); command.landingYaw = order.landingYaw
    } else if (follow) {
      command.kind = 'follow'
      const leader = this.followTarget!
      const leaderMount = leader instanceof NPC ? leader.mount : leader.currentMount
      const anchor = followAnchor?.position ?? (leaderMount?.isFlyingMount ? leaderMount.group.position : leader.combatPosition)
      followSlotWorldPosition(anchor, followAnchor?.yaw ?? leader.group.rotation.y, this.followLocalOffset, this.eagleGoal)
      if (leaderMount?.isAirborne) command.altitude = leaderMount.group.position.y + this.followLocalOffset.y
    } else if (formation) {
      command.kind = this.tacticalOrder === 'defend' ? 'defend' : 'formation'
      this.eagleGoal.copy(formation.position)
      if (formation.position.y > getTerrainHeight(formation.position.x, formation.position.z) + 10) command.altitude = formation.position.y
    } else {
      if (!this.eagleAnchorSet) { this.eagleAnchor.copy(mount.group.position); this.eagleAnchorSet = true }
      this.eagleGoal.copy(this.eagleAnchor)
      command.kind = order?.kind === 'hold' ? 'hold' : this.tacticalOrder === 'defend' ? 'defend' : 'cruise'
    }
    if (order?.kind === 'hold') command.kind = 'hold'
    mount.beginControlledFrame()
    mount.setFlightIntent(this.eaglePilot.update(dt, flight, mount.group.position, command, this.eagleNeighbors, obstacles, this.playableWorldBound))
    mount.finishControlledFrame(dt, obstacles)
    this._syncToMount()
    if (formation && order?.kind !== 'return' && Math.hypot(mount.group.position.x - formation.position.x, mount.group.position.z - formation.position.z) < XONGKORO.aiOrbitRadius + 5) {
      formation.reached = true
      if (formation.arrivalOrder) this.tacticalOrder = formation.arrivalOrder
    }
    this.visualMovementSpeed = mount.movementSpeed
  }

  private _updateEagleCombat(dt: number, player: Player, allNPCs: NPC[], nearby: NPC[], obstacles: ObstacleData[],
    onHitEntity: (damage: number, isPlayer: boolean, targetNpc?: NPC) => void,
    onFireArrow: (origin: THREE.Vector3, direction: THREE.Vector3, visualKind: 'arrow' | 'pilum', flightBudget?: ProjectileFlightBudget) => void,
    cameraDistance: number, grid: SpatialGrid<NPC> | null): void {
    const mount = this.mount!
    const flight = mount.flight!
    let target = this.eagleFlightOrder ? null : this._getTarget(dt, player, allNPCs, grid)
    const follow = this.tacticalOrder === 'follow' && this.followTarget && !this.followTarget.dead
    if (this.tacticalOrder === 'defend') {
      if (!this.eagleAnchorSet) { this.eagleAnchor.copy(this.formationTarget?.position ?? mount.group.position); this.eagleAnchorSet = true }
      if (target && this.eagleAnchor.distanceToSquared(target.position) > Math.max(80, this.maxRangedAttackDistance) ** 2) target = null
    }
    const orderedTravel = Boolean(this.eagleFlightOrder || this.tacticalOrder === 'formation' && this.formationTarget
      || follow && (!target || this.followTarget!.combatPosition.distanceToSquared(target.position) > 80 ** 2))
    const targetMount = target?.npc?.mount ?? (target?.isPlayer ? player.currentMount : null)
    const targetIdentity = target?.npc ?? (target?.isPlayer ? player : undefined)
    this.eagleTargetVelocity.set(0, 0, 0)
    if (target) {
      if (targetMount?.flight) this.eagleTargetVelocity.copy(targetMount.flight.velocity)
      else if (this.eagleLastTarget === targetIdentity && dt > 0) this.eagleTargetVelocity.copy(target.position).sub(this.eagleLastTargetPosition).divideScalar(dt).clampLength(0, 30)
      this.eagleLastTargetPosition.copy(target.position)
    }
    this.eagleLastTarget = targetIdentity
    this._collectEagleNeighbors(nearby, player, this.eaglePilot.canUseMelee || this.eaglePilot.maneuver === 'pass' ? targetMount : null)
    this.eagleTargets.length = 0
    const combatCandidates = grid?.getNearbyInto(mount.group.position,
      XONGKORO.aiSeparationRadius + mount.movementSpeed * dt, this.eagleNpcCandidates) ?? nearby
    for (const other of combatCandidates) if (other !== this && !other.dead && combatAllegiancesHostile(this, other)) this.eagleTargets.push(other)
    if (target?.npc && !this.eagleTargets.includes(target.npc)) this.eagleTargets.push(target.npc)
    if (this.targetsPlayer && player.targetable && !player.dead) this.eagleTargets.push(player)
    this.rebuildShield()
    this.shield.shieldRaised = false
    this.shieldCollider.refreshVisibility()
    this.animator.setEquipment(this.isUsingLance, this.shield.active, mount.type as MountedPoseKind, true)
    this.animator.setLocomotion(0, true, false)
    const ranged = this.hasActiveRangedWeapon && this.arrows > 0
    const kind = this.rangedCombatKind ?? 'bow'
    if (orderedTravel || !target) this._updateEagleTravel(dt, nearby, obstacles, undefined, player)
    else {
      this.eagleAnchorSet = this.tacticalOrder === 'defend' && this.eagleAnchorSet
      const command = this.eagleCommand
      this.eagleGoal.copy(targetMount?.isFlyingMount ? targetMount.group.position : target.position)
      command.kind = 'combat'; command.target = targetIdentity; command.targetAirborne = targetMount?.isAirborne === true
      command.targetVelocity = this.eagleTargetVelocity; command.rangedAvailable = ranged && this.maxRangedAttackDistance >= this.eaglePilot.cruiseAltitude; command.rangedDistance = this.maxRangedAttackDistance
      command.altitude = undefined
      mount.beginControlledFrame()
      mount.setFlightIntent(this.eaglePilot.update(dt, flight, mount.group.position, command, this.eagleNeighbors, obstacles, this.playableWorldBound))
      const targetYaw = Math.atan2(this.eagleGoal.x - mount.group.position.x, this.eagleGoal.z - mount.group.position.z)
      const headingError = Math.abs(Math.atan2(Math.sin(targetYaw - flight.yaw), Math.cos(targetYaw - flight.yaw)))
      if ((!ranged || kind === 'bow') && this.eaglePilot.canUseMelee && headingError < .6 && mount.group.position.distanceTo(this.eagleGoal) < XONGKORO.aiAttackRange
        && mount.startEagleAttack()) this.eaglePilot.attacked()
      mount.finishControlledFrame(dt, obstacles)
      this._syncToMount()
    }
    mount.setCameraDistance(cameraDistance)
    this.state = target ? AIState.ATTACK : AIState.IDLE
    this.eagleShotCheckRemaining -= dt
    const eligible = Boolean(target && ranged && (this.eaglePilot.canUseRanged || kind === 'javelin' && this.eaglePilot.canUseMelee)
      && this.combatPosition.distanceToSquared(target.position) <= this.maxRangedAttackDistance ** 2)
    if (!eligible) this.eagleShotClear = false
    else if (this.eagleShotCheckRemaining <= 0) {
      this.eagleShotClear = this._prepareEagleRangedShot(target!, this.eagleTargetVelocity, obstacles)
      this.eagleShotCheckRemaining = .15
    }
    const canShoot = eligible && this.eagleShotClear
    const cooldown = getRangedCooldown(kind) / (getT4HeroCombatModifiers(this.combatProfileId)?.attackSpeedMultiplier ?? 1)
    if (ranged && kind === 'javelin') this.attackTimer = Math.min(cooldown, this.attackTimer + dt)
    if (canShoot && target) {
      if (kind === 'bow') this.attackTimer += dt
      if (!this.animator.busy) {
        if (kind === 'bow') {
          this.bowArrowReleased = false
          this.animator.poseBow(Math.min(1, this.attackTimer / cooldown), Math.min(1, this.attackTimer / .18))
        } else if (this.attackTimer >= cooldown - (this.rig.animation?.getDuration('pilumThrow') ?? .45)) {
          if (this.animator.start('pilumThrow')) this.bowPivot.visible = true
        }
      }
      if (kind === 'bow' && this.attackTimer >= cooldown - .04 && this.animator.currentAction === 'bowAim') this.animator.start('bowRelease')
    }
    const events = this.animator.update(dt, cameraDistance)
    this._syncToMount()
    if (target && canShoot) this.bowVisual?.update(Math.min(1, this.attackTimer / cooldown), this.eagleRangedAim, !this.bowArrowReleased)
    // Re-solve from the animated nock at release. A cached clear shot never
    // authorizes firing through a newly encountered wall or an unreachable target.
    if (events.projectileRelease && ranged && canShoot && target
      && this._prepareEagleRangedShot(target, this.eagleTargetVelocity, obstacles)) {
      const lifecycle = kind === 'bow'
        ? createProjectileFlightBudget(this.rangedProjectileSpeed, this.eagleBallisticIntercept.flightTime) : undefined
      onFireArrow(this.eagleRangedOrigin, this.eagleBallisticIntercept.direction, kind === 'bow' ? 'arrow' : 'pilum', lifecycle)
      this.arrows--
      this.attackTimer = 0
      this.bowArrowReleased = true
      if (kind === 'javelin') this.eaglePilot.attacked()
      this.bowVisual?.hideArrow()
      if (kind === 'javelin') this.bowPivot.visible = false
    }
    if (events.actionCompleted && this.arrows === 0) this._switchToMelee()
    const mounts = this.combatMountGrid?.getNearbyInto(mount.group.position, 12 + mount.movementSpeed * dt, this.combatMountCandidates) ?? []
    // Physical avoidance includes allies; an NPC attack only damages legal enemies.
    for (let i = mounts.length - 1; i >= 0; i--) {
      const other = mounts[i]
      if (other.riderNpc ? !combatAllegiancesHostile(this, other.riderNpc)
        : other.riderPlayer ? !this.targetsPlayer || !other.riderPlayer.targetable : other !== targetMount) mounts.splice(i, 1)
    }
    for (const contact of mount.traceEagleAttack(this.eagleTargets, mounts, obstacles)) {
      Object.assign(this.weaponSweep.contact, contact)
      if (contact.target === player) onHitEntity(XONGKORO.attackDamage, true)
      else if (contact.target instanceof NPC) onHitEntity(XONGKORO.attackDamage, false, contact.target)
      else if (contact.mount) damageMount(contact.mount, XONGKORO.attackDamage,
        { source: createNpcCombatActorRef(this), method: 'melee', attackSource: 'xongkoro', contact, emit: this.combatEventSink })
    }
  }

  /** Shared by combat and peaceful travel, including a rider walking home after losing its Horse. */
  private _updateFootPhysics(previousPosition: THREE.Vector3, dt: number, obstacles: ObstacleData[]): void {
    this.group.rotation.x = 0
    const terrainY = getTerrainHeight(this.group.position.x, this.group.position.z)
    this.velY += -22 * dt
    this.group.position.y += this.velY * dt
    if (this.group.position.y <= terrainY) {
      this.group.position.y = terrainY
      this.velY = 0
      this.onGround = true
    } else this.onGround = false
    const collision = resolveObstacleCollision(this.group.position, previousPosition, this.velY, this.onGround, .5, 2.3, 0, obstacles)
    this.velY = collision.velocityY
    this.onGround = collision.onGround
    clampToPlayableWorld(this.group.position, this.playableWorldBound)
  }

  private _beginEncounterReturn(): void {
    if (!this.encounterOrigin || this.dead) return
    this.encounterAggro = 'returning'
    this._cachedTargetIsPlayer = false
    this._cachedTargetNpc = null
    this._targetAcquisitionInitialized = false
    this.assignFormationTarget(-2, this.encounterOrigin, this.encounterOrigin.clone().sub(this.combatPosition).setY(0).normalize())
    this.encounterAggro = 'returning'
  }

  private _updatePatrol(dt: number, obstacles: ObstacleData[], skipBoidsAndObstacles: boolean, navigationWorld: NavigationWorld | null): void {
    const target = this.waypoints[this.currentWaypointIdx]
    const dist = this.group.position.distanceTo(target)

    if (dist < 0.5) {
      this.currentWaypointIdx = (this.currentWaypointIdx + 1) % this.waypoints.length
    } else {
      const dir = this._tmpPatrolDir.copy(target).sub(this.group.position)
      dir.y = 0
      dir.normalize()
      if (!skipBoidsAndObstacles) {
        const route = this._resolveNavigationMoveTarget(target, obstacles, navigationWorld)
        if (route === 'path') dir.copy(this._tmpNavigationTarget).sub(this.combatPosition).setY(0).normalize()
        else dir.copy(getObstacleAvoidanceDirection(
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
    navigationWorld: NavigationWorld | null,
    followAnchor?: { position: THREE.Vector3; yaw: number },
  ): void {
    const target = this.formationTarget
    if (!target) return

    if (this.tacticalOrder === 'follow') {
      const leader = this.followTarget
      if (!leader || leader.dead) {
        this.state = AIState.IDLE
        return
      }
      const leaderPosition = followAnchor?.position ?? leader.combatPosition
      const leaderYaw = followAnchor?.yaw ?? leader.group.rotation.y
      if (this.followSmoothedLeaderPosition.distanceToSquared(leaderPosition) > 1600) {
        this.followSmoothedLeaderPosition.copy(leaderPosition)
        this.followSmoothedLeaderYaw = leaderYaw
      } else {
        const blend = 1 - Math.exp(-dt / .35)
        this.followSmoothedLeaderPosition.lerp(leaderPosition, blend)
        const yawDelta = Math.atan2(Math.sin(leaderYaw - this.followSmoothedLeaderYaw), Math.cos(leaderYaw - this.followSmoothedLeaderYaw))
        this.followSmoothedLeaderYaw += yawDelta * blend
      }
      followSlotWorldPosition(this.followSmoothedLeaderPosition, this.followSmoothedLeaderYaw, this.followLocalOffset, target.position)
      target.facing.set(Math.sin(this.followSmoothedLeaderYaw), 0, Math.cos(this.followSmoothedLeaderYaw))
      target.reached = false
    }

    this.alertSprite.visible = false
    const moveDir = this._tmpMoveDir.copy(target.position).sub(this.combatPosition)
    moveDir.y = 0
    const distance = moveDir.length()
    const arrivalDistance = this.tacticalOrder === 'follow'
      ? FOLLOW_THRESHOLDS.holdDistance
      : this.mount
        ? target.reached ? 2.4 : 1.2
        : target.reached ? 1 : FORMATION_ARRIVAL_DISTANCE
    if (distance <= arrivalDistance) {
      target.reached = true
      if (target.arrivalOrder === 'defend') {
        this.formationTarget = null
        this._restoreVikingDefensiveStance()
      }
      if (this.tacticalOrder === 'follow' && this.followNavigationActive) {
        this.followNavigationActive = false
        this._clearNavigationPath()
      }
      this._faceDirection(target.facing)
      this.state = AIState.IDLE
      return
    }
    moveDir.normalize()

    let navigationRoute: NavigationRouteKind = 'direct'
    let navigationGoal = target.position
    if (!skipBoidsAndObstacles && this.tacticalOrder === 'follow') {
      this.followNavigationCheckRemaining -= dt
      if (this.followNavigationCheckRemaining <= 0) {
        this.followNavigationCheckRemaining = .65 + this._initialStaggerPhase * .35
        const blocked = distance > FOLLOW_THRESHOLDS.runDistance && findBlockingObstacleAlongPath(
          this.combatPosition,
          target.position,
          this._movementObstacleRadius(),
          this._movementObstacleHeight(),
          0,
          obstacles,
        ) !== null
        if (blocked) {
          if (!this.followNavigationActive) {
            this.followNavigationActive = true
            this.followNavigationGoal.copy(target.position)
            this.followGoalSyncRemaining = 2
            this._clearNavigationPath()
          }
        } else if (this.followNavigationActive) {
          this.followNavigationActive = false
          this._clearNavigationPath()
        }
      }
      if (this.followNavigationActive && navigationWorld) {
        this.followGoalSyncRemaining -= dt
        if (this.followGoalSyncRemaining <= 0) {
          this.followGoalSyncRemaining = 2
          if (this.followNavigationGoal.distanceToSquared(target.position) >= 16) {
            this.followNavigationGoal.copy(target.position)
          }
        }
        navigationGoal = this.followNavigationGoal
        if (this.combatPosition.distanceToSquared(navigationGoal) <= 9) {
          this.followNavigationActive = false
          this._clearNavigationPath()
        } else {
          navigationRoute = this._navigationPath.resolveMoveTarget(
            this.combatPosition,
            navigationGoal,
            navigationWorld,
            true,
            this._tmpNavigationTarget,
          )
        }
      }
    } else if (!skipBoidsAndObstacles) {
      navigationRoute = this._resolveNavigationMoveTarget(target.position, obstacles, navigationWorld)
    }
    if (navigationRoute === 'path') {
      moveDir.copy(this._tmpNavigationTarget).sub(this.combatPosition).setY(0).normalize()
      this._clearObstacleDetour()
    } else if (navigationRoute === 'pending' || navigationRoute === 'unreachable') {
      this._applyPersistentObstacleDetour(moveDir, navigationGoal, dt, obstacles)
    } else {
      this._clearObstacleDetour()
    }

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
      if (navigationRoute !== 'path') {
        moveDir.copy(getObstacleAvoidanceDirection(
          this.group.position,
          moveDir,
          this.mount ? 1 : 0.5,
          this.mount ? 2.6 : 2.3,
          0,
          obstacles,
        ))
      }
    }

    // Face the travel direction while moving so directional movement does not
    // classify a distant slot behind the final formation facing as backward.
    this._faceDirection(moveDir)
    const followCatchUp = this.tacticalOrder === 'follow' && distance > FOLLOW_THRESHOLDS.runDistance
    const followSprint = this.tacticalOrder === 'follow' && distance > FOLLOW_THRESHOLDS.regroupDistance
    const baseSpeed = this.mount
      ? Math.min(this.mount.baseSpeed, target.speedLimit ?? Infinity)
      : target.speedLimit ?? FORMATION_MOVE_SPEED
    this._moveByDirection(moveDir, followCatchUp ? baseSpeed * 1.15 : baseSpeed, dt, followSprint || this.missionMovement)
    clampToPlayableWorld(this.mount ? this.mount.group.position : this.group.position, this.playableWorldBound)
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
    const effectiveSpeed = baseSpeed * multiplier * berserker.moveSpeedMultiplier * sprintMultiplier * (getT4HeroCombatModifiers(this.combatProfileId)?.moveSpeedMultiplier ?? 1)

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
    if (this.mount.isFlyingMount) this.mount.getRiderStandingSeatWorld(this.group.position)
    else this.mount.getRiderPelvisSeatWorld(this.group.position)
    if (import.meta.env.DEV && collector) { collector.endPhase('mountSaddleTransform', _tSaddle!) }

    if (import.meta.env.DEV && collector) { var _tRiderTransform = performance.now() }
    if (this.mount.isFlyingMount) {
      this.group.quaternion.copy(this.mount.group.quaternion)
      this.characterVisualGroup.position.set(0, 0, 0)
      if (this.mount.eagleVisual) fitStandingRider(this.characterVisualGroup, this.rig, this.mount.eagleVisual.standingSocket)
    }
    else {
      this.group.rotation.x = this.mount.ridePitch
      this.group.rotation.y = this.mount.group.rotation.y
    }
    if (import.meta.env.DEV && collector) { collector.endPhase('mountRiderTransform', _tRiderTransform!) }
  }

  /** Run after the mount animation, before render; keeps the contact on this frame's seat. */
  fitCorgiSeat(): void {
    if (!this.mount?.corgiVisual || this.dead) return
    this.mount.corgiVisual.fitRider(this.characterVisualGroup)
  }

  private _alignExternalVisualToMount(mounted: boolean): void {
    if (!mounted || this.mount?.isFlyingMount) this.characterVisualGroup.position.set(0, 0, 0)
    if (this.externalPelvisHeight <= 0) return
    this.characterVisualGroup.position.y = mounted && !this.mount?.isFlyingMount ? -this.externalPelvisHeight : 0
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

    return applyHeroOutgoingDamage(Math.round(dmg), this.combatProfileId)
  }

  private _isTargetInDefendRange(targetPos: THREE.Vector3): boolean {
    if (this.hasActiveRangedWeapon && this.combatPosition.distanceTo(targetPos) < RANGED_ATTACK_MIN && this.specialCombatProfile !== 'maki-ranger') {
      if (this.combatOwnership === 'player-personal' && !this.meleeWeaponId) return false
      this._switchToMelee()
    }
    if (this.hasActiveRangedWeapon) {
      return this.combatPosition.distanceTo(targetPos) <= this.maxRangedAttackDistance
    }
    if (this.combatOwnership === 'player-personal' && !this.meleeWeaponId) return false
    return this._isTargetInMeleeApproachRange(targetPos)
  }

  private _meleeBodySpacing(): number {
    const ownRadius = this.isMounted ? 1 : 0.5
    const targetRadius = this.meleeApproachTarget?.isMounted ? 1 : 0.5
    // Shared battles use the largest body radii; leave room to enter ATTACK
    // without requiring either combatant to move inside the other's collider.
    return ownRadius + targetRadius + 0.05
  }

  private _meleeApproachDistance(): number {
    // Database range remains the broad phase for damage. Use the same world
    // endpoints as WeaponSweep to choose a conservative physical stopping point;
    // leave 0.1m inside the target's 0.3m torso rather than stopping at its edge.
    const grip = this.getWeaponGripPosition(this.sweepGrip)
    const weaponLength = grip.distanceTo(this.getWeaponTipPosition())
    const handReach = Math.hypot(grip.x - this.group.position.x, grip.z - this.group.position.z)
    const bodySpacing = this._meleeBodySpacing()
    return Math.min(
      Math.max(this.meleeAttackRadius, bodySpacing),
      Math.max(bodySpacing, weaponLength + handReach + MELEE_CONTACT_MARGIN),
      this.meleeApproachLimit,
    )
  }

  private _isTargetInMeleeApproachRange(targetPos: THREE.Vector3): boolean {
    return this._isTargetInMeleeRange(targetPos, Math.max(0, this._meleeBodySpacing() - this.meleeAttackRadius))
      && Math.hypot(targetPos.x - this.combatPosition.x, targetPos.z - this.combatPosition.z) <= this._meleeApproachDistance()
  }

  private _isTargetInMeleeRange(targetPos: THREE.Vector3, extraReach = 0): boolean {
    if (Math.abs(targetPos.y - this.combatPosition.y) > this.meleeAttackRadius + extraReach) return false
    if (this.combatOwnership === 'player-personal' && !this.meleeWeaponId) return false
    if (this.specialCombatProfile === 'maki-ranger' && this.bowVisual) {
      if (this.combatPosition.distanceTo(targetPos) > this.meleeAttackRadius + extraReach) return false
      const top = this.bowVisual.getTopTipPosition(new THREE.Vector3())
      const bottom = this.bowVisual.getBottomTipPosition(new THREE.Vector3())
      const targetCenter = targetPos.clone().add(new THREE.Vector3(0, 1, 0))
      const contact = new THREE.Line3(bottom, top).closestPointToPoint(targetCenter, true, new THREE.Vector3())
      return contact.distanceTo(targetCenter) <= 1.3 + extraReach
    }
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
    if (this.specialCombatProfile === 'maki-ranger' && resolveMakiEquipmentMode(this.arrows) === 'ranged') return
    if (consumeRemainingAmmo) this.arrows = 0
    this.rangedActive = false
    this.pendingLanceChargeSpeed = 0
    this.swordPivot.visible = this.specialCombatProfile !== 'maki-ranger'
    this.bowPivot.visible = this.specialCombatProfile === 'maki-ranger'
    if (cancelAnimation) this.animator.cancel()
  }

  respawn(destination?: { x: number; z: number; yaw?: number }): void {
    this.shield.reset()
    this.weaponSweep.reset()
    this.meleeApproachLimit = Infinity
    this.meleeApproachTarget = null
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

    const x = destination?.x ?? this.spawnX, z = destination?.z ?? this.spawnZ
    const terrainY = getTerrainHeight(x, z)
    this.group.position.set(x, terrainY, z)
    this.velY = 0
    this.onGround = true
    this.group.rotation.set(0, destination?.yaw ?? 0, 0)
    this._alignExternalVisualToMount(false)
    this.animator.cancel()
    this.alertSprite.visible = false
    this._cachedTargetIsPlayer = false
    this._cachedTargetNpc = null
    this._rangedVisibleTargetHoldFrames = 0
    this._targetAcquisitionInitialized = false
    for (const cb of this.onRespawnCallbacks) cb(this)
  }

  restoreForTown(destination?: { x: number; z: number; yaw?: number }): void {
    this.restoreCombatLoadout()
    this.respawn(destination)
    this._cancelEquipmentCombatState()
    this.townArmed = false
    if (this.loadout) {
      this._setActiveMeleeWeapon(this.loadout.meleeWeaponId ?? null)
      this.shieldId = this.loadout.shieldId ?? null
      this.rebuildShield()
    }
    this.arrows = this.rangedWeaponId ? 30 : 0
    this.rangedActive = Boolean(this.rangedWeaponId)
    this.swordPivot.visible = !this.hasActiveRangedWeapon
    this.bowPivot.visible = this.hasActiveRangedWeapon
    this.stamina = MAX_STAMINA
    this.isSprinting = false
    this.chargeSprintLatched = false
    this.setTacticalOrder('attack')
    this.setTownPeaceful()
    this.rig.animation?.update(0)
  }
}
