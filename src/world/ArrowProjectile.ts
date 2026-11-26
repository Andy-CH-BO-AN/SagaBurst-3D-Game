/**
 * ArrowProjectile.ts
 * Arrow projectile with realistic parabolic gravity trajectory and hit detection on all targetable entities based on Factions.
 */
import * as THREE from 'three'
import { NPC, Faction } from './NPC'
import type { Player } from '../player/Player'
import { getScenePlayableWorldBound, type ObstacleData } from './Terrain'
import { PROJECTILE_GRAVITY, createProjectileFlightBudget, type ProjectileFlightBudget } from '../combat/ProjectileBallistics'
import { ProjectileContactQuery, type ProjectileTargetGroups, type ProjectileTargetIndex } from '../combat/ProjectileContactQuery'
import { damageMount, damageNpc, damageObstacle, damageReceiver, type DamageResult } from '../combat/DamageRouter'
import { isDamageReceiver, type DamageReceiver } from '../combat/DamageReceiver'
import { Mount } from './Mount'
import type {
  CombatActorRef,
  CombatDamageContext,
  CombatEventSink,
} from '../combat/CombatAttribution'
import { proceduralMaterial } from './ProceduralMaterials'
import type { DamageableObstacle } from './DamageableObstacle'
import { ProjectileInstanceBatch, type ProjectileInstancePart, type ProjectileInstanceSource } from './ProjectileInstanceBatch'

const ARROW_LOCAL_FORWARD = new THREE.Vector3(0, 0, -1)
export type ProjectileVisualKind = 'arrow' | 'pilum'
type ProjectileTarget = Player | NPC | Mount | DamageReceiver

/** Reused for every battle shot: Arrow.update runs for each live arrow each frame, so nothing here allocates. */
let activeArrow: ArrowProjectile | null = null
let activePlayer: Player | null = null
function acceptsActiveTarget(target: ProjectileTarget): boolean {
  const arrow = activeArrow!, player = activePlayer!
  if (target === player) return arrow.shooterFaction === Faction.ENEMY && player.targetable
  if (target instanceof NPC) return !target.dead && target.faction !== arrow.shooterFaction
  if (target instanceof Mount) return !target.dead && !target.disposed && projectileCanHitMount(target, arrow.shooterFaction)
    && !(arrow.isPlayerFired && target === player.currentMount)
    && !(target.riderNpc && target.riderNpc.combatantId === arrow.attribution?.source.actorId)
  return true
}

/** Released mounts keep their allegiance; only truly unowned mounts block every faction. */
function projectileCanHitMount(mount: Mount, shooterFaction: Faction): boolean {
  const allegiance = mount.combatOwner?.allegiance
    ?? mount.riderNpc?.faction
    ?? (mount.riderPlayer ? Faction.PLAYER : undefined)
  return allegiance !== shooterFaction
}

export interface ProjectileAttribution {
  source: CombatActorRef
  weaponId?: string
  emit?: CombatEventSink
}

interface SharedProjectileVisuals {
  woodMaterial: THREE.Material
  ironMaterial: THREE.Material
  bronzeMaterial: THREE.Material
  featherMaterial: THREE.Material
  arrowShaft: THREE.BufferGeometry
  arrowTip: THREE.BufferGeometry
  arrowFin: THREE.BufferGeometry
  pilumShaft: THREE.BufferGeometry
  pilumSocket: THREE.BufferGeometry
  pilumNeck: THREE.BufferGeometry
  pilumTip: THREE.BufferGeometry
  pilumWrap: THREE.BufferGeometry
  /** Draw parts of each projectile, in the local frame the old per-arrow Group used. */
  parts: Record<ProjectileVisualKind, readonly ProjectileInstancePart[]>
}

let sharedProjectileVisuals: SharedProjectileVisuals | null = null

const PART_QUATERNION = new THREE.Quaternion()
const PART_SCALE = new THREE.Vector3(1, 1, 1)
function projectilePart(geometry: THREE.BufferGeometry, material: THREE.Material, z: number, rotationX: number,
  castsPlayerShadow = false): ProjectileInstancePart {
  PART_QUATERNION.setFromAxisAngle(new THREE.Vector3(1, 0, 0), rotationX)
  return { geometry, material, castsPlayerShadow,
    local: new THREE.Matrix4().compose(new THREE.Vector3(0, 0, z), PART_QUATERNION, PART_SCALE) }
}

/** Projectiles are frequent transient objects; their immutable render assets must be shared. */
function getSharedProjectileVisuals(): SharedProjectileVisuals {
  if (sharedProjectileVisuals) return sharedProjectileVisuals
  sharedProjectileVisuals = {
    woodMaterial: proceduralMaterial({ kind: 'wood', color: 0x6e4722, roughness: 0.78, repeat: [2, 7] }),
    ironMaterial: proceduralMaterial({ kind: 'iron', color: 0xa8adae, metalness: 0.9, roughness: 0.3 }),
    bronzeMaterial: proceduralMaterial({ kind: 'bronze', color: 0xa77d43, roughness: 0.42, metalness: 0.7 }),
    featherMaterial: new THREE.MeshBasicMaterial({ color: 0xe8e0d0 }),
    arrowShaft: new THREE.CylinderGeometry(0.004, 0.004, 0.95, 6),
    arrowTip: new THREE.ConeGeometry(0.014, 0.09, 6),
    arrowFin: new THREE.BoxGeometry(0.003, 0.035, 0.09),
    pilumShaft: new THREE.CylinderGeometry(0.022, 0.026, 1.5, 10),
    pilumSocket: new THREE.CylinderGeometry(0.032, 0.025, 0.18, 10),
    pilumNeck: new THREE.CylinderGeometry(0.008, 0.015, 0.48, 8),
    pilumTip: new THREE.ConeGeometry(0.052, 0.2, 4),
    pilumWrap: new THREE.TorusGeometry(0.032, 0.008, 6, 10),
    parts: { arrow: [], pilum: [] },
  }
  const v = sharedProjectileVisuals
  v.parts = {
    arrow: [
      projectilePart(v.arrowShaft, v.woodMaterial, 0, Math.PI / 2, true),
      projectilePart(v.arrowTip, v.ironMaterial, ARROW_TIP_LOCAL_Z, -Math.PI / 2),
      projectilePart(v.arrowFin, v.featherMaterial, 0.4, 0),
    ],
    pilum: [
      projectilePart(v.pilumShaft, v.woodMaterial, 0, Math.PI / 2, true),
      projectilePart(v.pilumSocket, v.ironMaterial, -0.79, Math.PI / 2),
      projectilePart(v.pilumNeck, v.ironMaterial, -1.08, Math.PI / 2),
      projectilePart(v.pilumTip, v.ironMaterial, PILUM_TIP_LOCAL_Z, -Math.PI / 2),
      projectilePart(v.pilumWrap, v.bronzeMaterial, 0.62, 0),
    ],
  }
  return v
}

/** Prewarms shared projectile procedural textures, materials, and geometries ahead of time. */
export function prewarmProjectileVisuals(): void {
  getSharedProjectileVisuals()
}

/** Creates a representative group containing all projectile materials & geometries for GPU compilation.
 * Live projectiles are instanced, so the warmup compiles the instancing shader variants. */
export function createProjectileWarmupGroup(): THREE.Group {
  const shared = getSharedProjectileVisuals()
  const group = new THREE.Group()
  group.name = 'projectile-warmup-group'
  for (const part of [...shared.parts.arrow, ...shared.parts.pilum]) {
    const mesh = new THREE.InstancedMesh(part.geometry, part.material, 1)
    mesh.setMatrixAt(0, part.local)
    group.add(mesh)
  }
  return group
}

const ARROW_TIP_LOCAL_Z = -0.52
const PILUM_TIP_LOCAL_Z = -1.4

/** Contact scratch state never outlives one synchronous find(), so every arrow shares one query. */
const sharedContacts = new ProjectileContactQuery()
const NO_OBSTACLES: readonly ObstacleData[] = []
const EMPTY_TARGET_GROUPS: ProjectileTargetGroups<ProjectileTarget> = { groups: [] }
const MAX_ARROW_POOL = 1024

export class ArrowProjectile implements ProjectileInstanceSource {
  private static readonly pool: ArrowProjectile[] = []
  private static nextFlightId = 1

  static acquire(
    scene: THREE.Scene,
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    speed: number,
    damage: number,
    shooterFaction: Faction,
    isPlayerFired: boolean = false,
    visualKind: ProjectileVisualKind = 'arrow',
    attribution?: ProjectileAttribution,
    flightBudget?: ProjectileFlightBudget,
  ): ArrowProjectile {
    const reused = ArrowProjectile.pool.pop()
    if (reused) {
      reused.init(scene, origin, direction, speed, damage, shooterFaction, isPlayerFired, visualKind, attribution, flightBudget)
      return reused
    }
    return new ArrowProjectile(scene, origin, direction, speed, damage, shooterFaction, isPlayerFired, visualKind, attribution, flightBudget)
  }

  static prewarm(): void {
    prewarmProjectileVisuals()
  }

  static getSharedVisuals(): SharedProjectileVisuals {
    return getSharedProjectileVisuals()
  }

  /** Pose holder only: the visible geometry is a slot in the scene's shared InstancedMeshes. */
  readonly mesh: THREE.Group
  instanceSlot = -1
  private _flightId = 0
  private readonly velocity = new THREE.Vector3()
  private alive = false
  private stuck = false
  private stuckTimer = 0
  private travelledDistance = 0
  private flightAge = 0
  private worldBound = 0
  private _maxFlightLifetimeSeconds = 0
  private maxTravelDistance = 0
  private tipLocalZ = ARROW_TIP_LOCAL_Z
  private visualKind: ProjectileVisualKind = 'arrow'
  private batch: ProjectileInstanceBatch | null = null

  // ── Reusable temporary vectors (P-1: avoid per-frame GC pressure) ──
  private readonly _tmpTargetPos = new THREE.Vector3()
  private readonly previousPosition = new THREE.Vector3()
  private readonly flightStep = { from: this.previousPosition, to: undefined as unknown as THREE.Vector3 }
  private readonly battleWorld = { kind: 'battle' as const, travelledDistance: 0 }
  private readonly battleQuery: {
    world: { kind: 'battle'; travelledDistance: number }
    obstacles: readonly ObstacleData[]
    targets: ProjectileTargetGroups<ProjectileTarget> | ProjectileTargetIndex<ProjectileTarget>
    acceptsTarget(target: ProjectileTarget): boolean
  } = { world: this.battleWorld, obstacles: NO_OBSTACLES, targets: EMPTY_TARGET_GROUPS, acceptsTarget: acceptsActiveTarget }
  // Only used when the caller supplies no shared target index.
  private playerTarget: Player[] | null = null
  private targetGroups: (readonly ProjectileTarget[])[] | null = null
  private targetGroupsInput: ProjectileTargetGroups<ProjectileTarget> | null = null

  private _damage = 0
  private _shooterFaction: Faction = Faction.PLAYER
  private _isPlayerFired = false
  private _attribution?: ProjectileAttribution
  private pooled = false

  get damage(): number { return this._damage }
  get shooterFaction(): Faction { return this._shooterFaction }
  get isPlayerFired(): boolean { return this._isPlayerFired }
  get attribution(): ProjectileAttribution | undefined { return this._attribution }
  get maxFlightLifetimeSeconds(): number { return this._maxFlightLifetimeSeconds }
  get flightId(): number { return this._flightId }
  get isAlive(): boolean { return this.alive }
  get isStuck(): boolean { return this.stuck }

  /** The mesh is not in the scene graph, so its matrixWorld is not maintained: use the pose directly. */
  getTipPosition(target: THREE.Vector3): THREE.Vector3 {
    return target.set(0, 0, this.tipLocalZ).applyQuaternion(this.mesh.quaternion).add(this.mesh.position)
  }

  constructor(
    scene: THREE.Scene,
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    speed: number,
    damage: number,
    shooterFaction: Faction,
    isPlayerFired: boolean = false,
    visualKind: ProjectileVisualKind = 'arrow',
    attribution?: ProjectileAttribution,
    flightBudget?: ProjectileFlightBudget,
  ) {
    this.mesh = new THREE.Group()
    this.mesh.userData.ignoreAimRaycast = true
    this.flightStep.to = this.mesh.position
    this.init(scene, origin, direction, speed, damage, shooterFaction, isPlayerFired, visualKind, attribution, flightBudget)
  }

  private init(
    scene: THREE.Scene,
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    speed: number,
    damage: number,
    shooterFaction: Faction,
    isPlayerFired: boolean,
    visualKind: ProjectileVisualKind,
    attribution?: ProjectileAttribution,
    flightBudget?: ProjectileFlightBudget,
  ): void {
    this.pooled = false
    this._flightId = ArrowProjectile.nextFlightId++
    this.alive = true
    this.stuck = false
    this.stuckTimer = 0
    this.travelledDistance = 0
    this.flightAge = 0
    this.instanceSlot = -1
    this._damage = damage
    this._shooterFaction = shooterFaction
    this._isPlayerFired = isPlayerFired
    this._attribution = attribution
    this.visualKind = visualKind
    this.worldBound = getScenePlayableWorldBound(scene) + 24
    // Bound an ordinary shot by its physical return time. Aerial intent supplies
    // a tighter, shot-specific budget; neither depends on world-origin radius.
    const defaultFlight = (speed + Math.sqrt(speed * speed + 2 * PROJECTILE_GRAVITY * Math.max(0, origin.y + 20))) / PROJECTILE_GRAVITY
    const budget = flightBudget ?? createProjectileFlightBudget(speed, defaultFlight)
    this._maxFlightLifetimeSeconds = Number.isFinite(budget.maxLifetimeSeconds)
      ? Math.max(.01, Math.min(28, budget.maxLifetimeSeconds)) : 0
    this.maxTravelDistance = Number.isFinite(budget.maxTravelDistance)
      ? Math.max(0, budget.maxTravelDistance) : 0
    this.mesh.name = `${visualKind}-projectile`
    this.tipLocalZ = visualKind === 'pilum' ? PILUM_TIP_LOCAL_Z : ARROW_TIP_LOCAL_Z

    this.mesh.position.copy(origin)
    this.velocity.copy(direction).normalize().multiplyScalar(speed)

    // Arrow geometry points down local -Z. Align that axis—not Object3D's
    // generic +Z lookAt axis—with the physical velocity.
    this._tmpTargetPos.copy(this.velocity).normalize()
    this.mesh.quaternion.setFromUnitVectors(ARROW_LOCAL_FORWARD, this._tmpTargetPos)
    this.batch = ProjectileInstanceBatch.for(scene, getSharedProjectileVisuals().parts)
    this.batch.add(visualKind, isPlayerFired, this)
    if (!Number.isFinite(speed) || speed <= 0 || !Number.isFinite(origin.x + origin.y + origin.z)
      || !Number.isFinite(direction.x + direction.y + direction.z) || direction.lengthSq() < 1e-12) this.destroy()
  }

  /** Shared numeric flight step; false when the arrow is dead, expired this step, or stuck. */
  private advanceFlight(dt: number): boolean {
    if (!this.alive) return false
    if (!Number.isFinite(dt) || dt < 0) { this.destroy(); return false }

    // If stuck in ground or wall, countdown decay
    if (this.stuck) {
      this.stuckTimer += dt
      if (this.stuckTimer >= 5.0) {
        this.destroy()
      }
      return false
    }

    this.previousPosition.copy(this.mesh.position)
    // Exact constant-acceleration integration matches the AI's verified arc.
    // Semi-implicit Euler accumulated metres of drop over a long flight.
    this.mesh.position.addScaledVector(this.velocity, dt)
    this.mesh.position.y -= 0.5 * PROJECTILE_GRAVITY * dt * dt
    this.velocity.y -= PROJECTILE_GRAVITY * dt
    this.travelledDistance += this.previousPosition.distanceTo(this.mesh.position)
    this.flightAge += dt

    // Town uses visualOnly movement and owns collision/damage separately, but
    // still consumes exactly the same finite flight budget and scene bounds.
    if (!Number.isFinite(this.mesh.position.x + this.mesh.position.y + this.mesh.position.z)
      || Math.abs(this.mesh.position.x) > this.worldBound || Math.abs(this.mesh.position.z) > this.worldBound
      || this.flightAge > this.maxFlightLifetimeSeconds || this.travelledDistance > this.maxTravelDistance) {
      this.destroy()
      return false
    }

    // Orient arrow towards velocity
    this._tmpTargetPos.copy(this.velocity).normalize()
    this.mesh.quaternion.setFromUnitVectors(ARROW_LOCAL_FORWARD, this._tmpTargetPos)
    return true
  }

  /** Advance flight only (no collision/damage). Null when the arrow expired or was already dead.
   * The returned segment is reused: consume it before stepping this arrow again. */
  stepFlight(dt: number): { from: THREE.Vector3; to: THREE.Vector3 } | null {
    if (!this.alive) return null
    if (!this.advanceFlight(dt)) {
      if (!this.alive) return null
      // Stuck arrows report a stationary segment, as before.
      this.previousPosition.copy(this.mesh.position)
    }
    return this.flightStep
  }

  update(
    dt: number,
    player: Player,
    npcs: NPC[],
    obstacles: ObstacleData[],
    onHitTarget: (damage: number, hitPos: THREE.Vector3, targetName: string, hpRatio: number, isPlayerHit: boolean, npc?: NPC, isMountHit?: boolean) => void,
    onDamagePlayer: (damage: number, context?: CombatDamageContext) => DamageResult,
    onHitObstacle?: (
      damage: number,
      hitPos: THREE.Vector3,
      obstacle: DamageableObstacle,
      hpRatio: number,
    ) => void,
    visualOnly = false,
    mounts: readonly Mount[] = [],
    receivers: readonly DamageReceiver[] = [],
    /** Same player/npcs/mounts/receivers groups, indexed once per frame by the caller. */
    targetIndex?: ProjectileTargetIndex<Player | NPC | Mount | DamageReceiver>,
  ): void {
    if (!this.advanceFlight(dt)) return

    if (visualOnly) return

    const query = this.battleQuery
    this.battleWorld.travelledDistance = this.travelledDistance
    query.obstacles = obstacles
    query.targets = targetIndex ?? this.orderedTargets(player, npcs, mounts, receivers)
    activeArrow = this; activePlayer = player
    let hit: ReturnType<typeof sharedContacts.find<ProjectileTarget>>
    try { hit = sharedContacts.find(this.previousPosition, this.mesh.position, query) }
    finally { activeArrow = null; activePlayer = null; query.obstacles = NO_OBSTACLES }
    if (hit) {
      this.mesh.position.copy(hit.point)
      if (hit.kind === 'actor') {
        const hitNpc = hit.target instanceof NPC ? hit.target : undefined
        const hitMount = hit.target instanceof Mount ? hit.target : undefined
        const hitReceiver = isDamageReceiver(hit.target) ? hit.target : undefined
        const hitPlayer = hit.target === player
        const context = this._damageContext()
        if (context) context.contact = hit.contact
        // Unattributed projectiles still physically block, but never award XP.
        const physicalContext = context ?? {
          source: { actorId: 'unattributed-projectile', actorType: 'npc' as const, allegiance: this.shooterFaction, characterFaction: player.characterFaction },
          method: 'projectile' as const, contact: hit.contact, hostileToTarget: false,
        }
        const playerMountHit = hitMount === player.currentMount
        // Damage may move or reseat the target and whoever it rides or carries; remember them
        // before the hit can detach them, then re-sample only those cells for later shots.
        const relatedMount = hitNpc ? hitNpc.mount : hitPlayer ? player.currentMount : undefined
        const relatedRider = hitMount ? hitMount.riderNpc : undefined
        const relatedPlayerRider = hitMount ? hitMount.riderPlayer : undefined
        const result = hitReceiver ? damageReceiver(hitReceiver, this.damage, physicalContext)
          : hitMount ? damageMount(hitMount, this.damage, physicalContext)
          : hitNpc ? damageNpc(hitNpc, this.damage, physicalContext) : onDamagePlayer(this.damage, physicalContext)
        if (result.hitSuccess) onHitTarget(result.appliedDamage, this.mesh.position.clone(), result.targetName, result.hpRatio, hitPlayer || playerMountHit, hitNpc, result.isMountHit)
        if (targetIndex) {
          targetIndex.updateTarget(hit.target)
          if (relatedMount) targetIndex.updateTarget(relatedMount)
          if (relatedRider) targetIndex.updateTarget(relatedRider)
          if (relatedPlayerRider) targetIndex.updateTarget(relatedPlayerRider)
          // A mount or rider attached by the hit itself.
          if (hitNpc?.mount) targetIndex.updateTarget(hitNpc.mount)
          if (hitMount?.riderNpc) targetIndex.updateTarget(hitMount.riderNpc)
        }
        this.destroy()
        return
      }
      if (hit.kind === 'obstacle') {
        const damageable = hit.obstacle.damageable
        const canDamageObstacle = damageable
          && !damageable.destroyed
          && (
            !this.isPlayerFired && this.attribution?.source.ownership !== 'player-personal'
            || damageable.isDamageableBy(this.attribution?.source.characterFaction ?? player.characterFaction)
          )
        if (canDamageObstacle) {
          const result = damageObstacle(damageable, this.damage, this._damageContext())
          if (result.appliedDamage > 0) {
            onHitObstacle?.(
              result.appliedDamage,
              this.mesh.position.clone(),
              damageable,
              result.hpRatio,
            )
          }
        }

      }
      this.stuck = true
      return
    }

  }

  /** Player, NPCs, mounts, then receivers: the order that breaks equal contacts. Reused per shot. */
  private orderedTargets(player: Player, npcs: readonly NPC[], mounts: readonly Mount[], receivers: readonly DamageReceiver[]):
    ProjectileTargetGroups<ProjectileTarget> {
    const playerTarget = this.playerTarget ??= []
    const groups = this.targetGroups ??= [playerTarget, [], [], []]
    playerTarget[0] = player
    groups[1] = npcs; groups[2] = mounts; groups[3] = receivers
    return this.targetGroupsInput ??= { groups }
  }

  private _damageContext(): CombatDamageContext | undefined {
    if (!this.attribution) return undefined
    return {
      source: this.attribution.source,
      method: 'projectile',
      weaponId: this.attribution.weaponId,
      emit: this.attribution.emit,
    }
  }

  destroy(): void {
    if (!this.alive) return
    this.alive = false
    this.batch?.remove(this.visualKind, this._isPlayerFired, this)
    this.batch = null
    this._attribution = undefined
    this.battleQuery.obstacles = NO_OBSTACLES
    this.battleQuery.targets = EMPTY_TARGET_GROUPS
    if (this.playerTarget) this.playerTarget.length = 0
    if (this.targetGroups) {
      this.targetGroups[1] = NO_OBSTACLES as unknown as readonly ProjectileTarget[]
      this.targetGroups[2] = NO_OBSTACLES as unknown as readonly ProjectileTarget[]
      this.targetGroups[3] = NO_OBSTACLES as unknown as readonly ProjectileTarget[]
    }
    if (this.mesh.parent) {
      this.mesh.parent.remove(this.mesh)
    }
    if (!this.pooled && ArrowProjectile.pool.length < MAX_ARROW_POOL) {
      this.pooled = true
      ArrowProjectile.pool.push(this)
    }
  }
}
