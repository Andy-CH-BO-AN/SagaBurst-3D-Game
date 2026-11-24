import { Vector3 } from 'three'
import type { NpcSpawnSpec } from '../../src/battle/BattleSpawner'
import type { CareerActorFactory } from '../../src/career/CareerActorFactory'
import type { CombatEventSink } from '../../src/combat/CombatAttribution'
import type { Player } from '../../src/player/Player'
import { mountTypeFromId, type Mount, type MountType } from '../../src/world/Mount'
import { AIType, Faction, type NPC } from '../../src/world/NPC'
import type { TownActorSpec, TownRole } from '../../src/town/TownRules'

type Order = NPC['tacticalOrder']
interface Transform { position: Vector3; rotation: { y: number; set(x: number, y: number, z: number): void } }
const transform = (x = 0, y = 0, z = 0): Transform => {
  const rotation = { y: 0, set(_x: number, y: number) { rotation.y = y } }
  return { position: new Vector3(x, y, z), rotation }
}

/** Plain mount body with the real HP/armor rules the mission owners read; no model. */
export class MountDouble {
  readonly group: Transform
  readonly type: MountType
  maxHp = 100
  currentHp = 100
  armorImpactMax = 0
  armorImpactRemaining = 0
  baseSpeed = 10
  combatRadius = 2
  isAirborne = false
  isFlyingMount = false
  readonly flight = undefined
  visualHold = false
  reservedForTown = false
  temporaryCombatId?: string
  disposed = false
  constructor(mountId: string, x = 0, z = 0, y = 0) { this.type = mountTypeFromId(mountId); this.group = transform(x, y, z) }
  get dead(): boolean { return this.currentHp <= 0 }
  restoreArmor(value?: number): void { this.armorImpactRemaining = Math.min(this.armorImpactMax, value ?? this.armorImpactMax) }
  takeDamage(amount: number): void { this.currentHp = Math.max(0, this.currentHp - amount) }
  dispose(): void { this.disposed = true }
}

/** Plain actor with the order, health, mount and garrison state mission owners read and write; no model. */
export class ActorDouble {
  readonly group: Transform
  readonly characterFaction: 'roman' | 'viking'
  hp = 100
  maxHp = 100
  staminaValue = 100
  combatAmmo = 0
  readonly combatAmmoCapacity = 0
  readonly shield = { shieldImpactRemaining: 0, shieldImpactMax: 0,
    captureDurability: () => ({}), restoreDurability: (_value: Record<string, number>) => {} }
  readonly requestedShieldId = undefined
  mount: MountDouble | null = null
  tacticalOrder: Order = 'attack'
  missionCombatTarget: null | undefined = undefined
  missionMovement = false
  formationCommandId: number | null = null
  formationTarget?: Vector3
  followIndex?: number
  squadId?: NPC['squadId']
  respawnEnabled = true
  combatOwnership: NPC['combatOwnership']
  hostileToPlayer = false
  readonly isFalling = false
  readonly fallSnapshot = undefined
  readonly hasTacticalCombatPriority = false
  readonly hasActiveRangedWeapon: boolean
  readonly meleeWeaponId = undefined
  readonly rangedWeaponId = undefined
  readonly maxRangedAttackDistance = 0
  townRampartGarrison = false
  townRampartMounted = false
  siegeTransport: string | null = null
  siegeTransportSpeed = 0
  siegeObstacle: unknown = null
  siegeEvacuation = null
  siegeBypassTarget: Vector3 | null = null
  campaignEntranceId: string | null = null
  campaignBreachCompleted = false
  townSiegeGateId: string | null = null
  combatTargetPriority: NPC['combatTargetPriority']
  armedWith?: string
  battlefieldEngagement = false
  externalThreat = true
  disposed = false
  eventSink?: CombatEventSink
  constructor(readonly combatantId: string, options: { faction?: Faction; characterFaction?: 'roman' | 'viking'; aiType?: AIType;
    townCategory?: 'civilian'; x?: number; y?: number; z?: number; squadId?: NPC['squadId'] } = {}, readonly name = combatantId) {
    this.faction = options.faction ?? Faction.PLAYER
    this.characterFaction = options.characterFaction ?? 'roman'
    this.aiType = options.aiType ?? AIType.MELEE
    this.hasActiveRangedWeapon = this.aiType === AIType.RANGED
    this.townCategory = options.townCategory
    this.squadId = options.squadId
    this.group = transform(options.x, options.y, options.z)
  }
  faction: Faction
  readonly aiType: AIType
  readonly townCategory?: 'civilian'
  get dead(): boolean { return this.hp <= 0 }
  get position(): Vector3 { return this.group.position }
  get combatPosition(): Vector3 { return this.mount && !this.mount.isFlyingMount ? this.mount.group.position : this.group.position }
  get isMounted(): boolean { return this.mount !== null && !this.mount.dead }
  get hasFormationTarget(): boolean { return this.formationTarget !== undefined }
  get combatFormationCheckpoint(): undefined { return undefined }
  get isOutpostRampartGarrisonActive(): boolean { return false }
  get isTownRampartGarrisonActive(): boolean { return this.townRampartGarrison }
  get isMountedTownRampartGarrisonEnabled(): boolean { return this.townRampartGarrison && this.townRampartMounted }
  setTacticalOrder(order: Order): void { this.tacticalOrder = order; this.formationTarget = undefined; this.formationCommandId = null }
  setMissionCombatTarget(target: null | undefined): void { this.missionCombatTarget = target }
  restoreCombatHealth(hp: number): void { this.hp = Math.min(this.maxHp, Math.max(0, hp)) }
  restoreCombatAmmo(ammo: number): void { this.combatAmmo = ammo }
  restoreCombatStamina(value: number): void { this.staminaValue = value }
  takeDamage(amount: number): void { this.hp = Math.max(0, this.hp - amount) }
  mountVehicle(mount: MountDouble): void { if (!mount.dead) this.mount = mount }
  dismountFromMount(): void { if (this.mount) this.group.position.copy(this.mount.group.position); this.mount = null }
  setCommandSquad(squadId: NPC['squadId']): void { this.squadId = squadId }
  setCommandAllegiance(faction: Faction): void { this.faction = faction }
  bindCombatEventSink(sink: CombatEventSink): () => void { this.eventSink = sink; return () => { this.eventSink = undefined } }
  activateTownRampartGarrison(order: 'defend' | 'attack' = 'defend', mounted = false): void {
    if (this.isMounted && !mounted) return
    this.townRampartGarrison = true; this.townRampartMounted = mounted; this.tacticalOrder = order
  }
  activateOutpostRampartGarrison(): void {}
  releaseOutpostRampartGarrison(): void { this.townRampartGarrison = false; this.townRampartMounted = false }
  assignFollowTarget(_leader: unknown, index: number): void { this.followIndex = index; this.tacticalOrder = 'follow' }
  assignFormationTarget(commandId: number, position: Vector3): void {
    this.formationCommandId = commandId; this.formationTarget = position.clone(); this.tacticalOrder = 'formation'
  }
  refreshFormationTarget(commandId: number, position: Vector3): boolean {
    if (this.formationCommandId !== commandId) return false
    this.formationTarget = position.clone(); return true
  }
  isFormationTargetReached(): boolean { return false }
  assignSiegeObstacle(obstacle: unknown): void { this.siegeObstacle = obstacle }
  enableBattlefieldEngagement(): void { this.battlefieldEngagement = true }
  setEagleCruiseAltitude(): void {}
  setEagleFlightOrder(): void {}
  endExternalThreat(): void { this.externalThreat = false }
  armTownCivilian(weaponId: string): void { this.armedWith = weaponId }
  restorePendingFall(): void {}
  dispose(): void { this.disposed = true }
}

/** The single unsafe seam: these plain bodies stand in for the rendered NPC/Mount classes. */
export const asNpc = (actor: ActorDouble): NPC => actor as unknown as NPC
export const asMount = (mount: MountDouble): Mount => mount as unknown as Mount

/** Records every body a mission controller materializes, keyed by its stable identity. */
export function recordingActorFactory(): CareerActorFactory & { actors: Map<string, ActorDouble>; mounts: Map<string, MountDouble> } {
  const actors = new Map<string, ActorDouble>(), mounts = new Map<string, MountDouble>()
  return {
    actors, mounts,
    npc(spec: NpcSpawnSpec, actorId: string, emit: CombatEventSink, placement?: { y: number }) {
      const actor = new ActorDouble(actorId, { faction: spec.faction, characterFaction: spec.characterFaction, aiType: spec.aiType,
        x: spec.x, y: placement?.y, z: spec.z, squadId: spec.squadId }, spec.name)
      actor.eventSink = emit
      actors.set(actorId, actor)
      return asNpc(actor)
    },
    mount(mountId: string, x: number, z: number, y: number | undefined, stableKey: string) {
      const mount = new MountDouble(mountId, x, z, y)
      mounts.set(stableKey, mount)
      return asMount(mount)
    },
  }
}

/** Player body with the transform, resources and mount state Town mission owners save and restore. */
export class PlayerDouble {
  readonly group = transform()
  hp = 100
  maxHp = 100
  staminaValue = 100
  arrowCount = 0
  readonly shield = { shieldImpactRemaining: 0, shieldImpactMax: 0 }
  readonly isFalling = false
  readonly fallSnapshot = undefined
  currentMount: MountDouble | null = null
  facingYaw = 0
  get dead(): boolean { return this.hp <= 0 }
  get position(): Vector3 { return this.group.position }
  get combatPosition(): Vector3 { return this.currentMount ? this.currentMount.group.position.clone() : this.group.position }
  get isMounted(): boolean { return this.currentMount !== null && !this.currentMount.dead }
  faceDirection(x: number, z: number): void { this.facingYaw = Math.atan2(x, z) }
  syncMountTransform(): void { if (this.currentMount) this.group.position.copy(this.currentMount.group.position) }
  mountVehicle(mount: MountDouble): void { this.currentMount = mount; this.group.position.copy(mount.group.position) }
  dismountFromMount(): void { this.currentMount = null }
  setStamina(value: number): void { this.staminaValue = value }
  setHp(value: number): void { this.hp = value }
  setArrowCount(value: number): void { this.arrowCount = value }
  takeDamage(amount: number): void { this.hp = Math.max(0, this.hp - amount) }
  restorePendingFall(): void {}
}
export const asPlayer = (player: PlayerDouble): Player => player as unknown as Player

/** Minimal authored resident identity for Town mission rosters that are not about placement. */
export function residentSpec(id: string, role: TownRole, overrides: Partial<TownActorSpec> = {}): TownActorSpec {
  return { id, role, duty: role === 'civilian' ? 'civilian' : 'service', mounted: false, training: false,
    assaultObjective: false, tier: 3, x: 0, z: 0, index: 0, ...overrides }
}
