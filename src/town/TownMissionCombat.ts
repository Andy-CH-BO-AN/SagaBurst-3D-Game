import * as THREE from 'three'
import type { BanditMissionController, VeteranMissionEnemySquad } from '../career/BanditMissionController'
import type { CareerDuelController } from '../career/CareerDuelController'
import type { CareerMountController } from '../career/CareerMountController'
import type { CommanderTownMissionController } from '../career/CommanderTownMissionController'
import type { CombatDamageMethod, CombatEvent } from '../combat/CombatAttribution'
import { COMBAT_BALANCE } from '../combat/CombatBalance'
import { combatAllegiancesHostile } from '../combat/CombatFaction'
import { applyMountImpactDamage, checkMountImpact } from '../combat/MountImpact'
import type { ProjectileFlightBudget } from '../combat/ProjectileBallistics'
import type { NavigationWorld } from '../navigation/NavigationWorld'
import type { TownDevProfiler } from '../debug/TownDevProfiler'
import type { Player } from '../player/Player'
import type { HpBar } from '../ui/HpBar'
import { EntityCollisionBroadPhase } from '../world/EntityCollisionBroadPhase'
import type { Mount } from '../world/Mount'
import { AIState, Faction, type NPC } from '../world/NPC'
import { SpatialGrid } from '../world/SpatialGrid'
import { getTerrainHeight, resolveObstacleCollision, type EntityCollisionBody, type ObstacleData } from '../world/Terrain'
import { TownActorUpdates, type TownActorUpdate } from './TownActorUpdates'
import { TOWN_PLAYABLE_WORLD_BOUND } from './TownBounds'
import type { TownCavalryPatrolController } from './TownCavalryPatrolController'
import { TOWN_EAGLE_ALERT_RADIUS } from './TownEagleGarrison'
import { townDefenseThreatInRange, townExternalThreatAlertRange, townStationSpec } from './TownGarrison'
import { townRampGroundExcluded } from './TownGroundStation'
import type { TownPersonalSquadController } from './TownPersonalSquadController'
import { activateTownResidentHome, townResidentAtHome } from './TownResidentHome'
import { isTownMilitary, type TownActorSpec } from './TownRules'
import { civilianWartimeWeapon, townWartimeHostile } from './TownWartime'

export interface TownCombatResident {
  spec: TownActorSpec
  npc: NPC
  homeMount?: Mount
  target?: THREE.Vector3
  cycle: number
  walkTime: number
}

interface MissionControllers {
  field: Pick<BanditMissionController, 'active' | 'fieldNpcs' | 'friendlies' | 'ambientBandits' | 'missionBandits' | 'combatPeersFor' | 'updateFlow' | 'updateDepartingCavalry' | 'departingNpcs' | 'cavalryMounts' | 'veteranEnemySquads' | 'markVeteranEnemySquadEngaged' | 'travelEncounter' | 'prepareTravelEncounter' | 'noteTravelHit' | 'engageFormalMission' | 'isMissionTarget' | 'allowsMissionCombatTarget' | 'prepareRetirementEvacuation' | 'isRetirementEvacuating' | 'updateRetirementTravel'>
  duel: Pick<CareerDuelController, 'active' | 'phase' | 'update' | 'isMissionActor' | 'fieldNpcs' | 'allMounts' | 'opponent' | 'isParkedResident' | 'combatEnabled' | 'persistRuntimeProgress' | 'setExternalCombat'>
  defense: Pick<CommanderTownMissionController, 'active' | 'phase' | 'assault' | 'updateFlow' | 'fieldNpcs' | 'peersFor' | 'updateCivilianOrder' | 'waitingEnemies' | 'enemyMounts'> & {
    readonly combatEnabled?: boolean
    isMissionActor?(npc: NPC): boolean
    updateSiege?(dt: number, grid: SpatialGrid<NPC>): void
    isEscorting?(npc: NPC): boolean
  }
}

/** Ambient warfare owns its roster and travel; mission combat only borrows its participants. */
export interface TownOutskirtsCombatRuntime {
  readonly actors: readonly NPC[]
  readonly mounts: readonly Mount[]
  synchronizeRank(): void
  prepareFrame(dt: number, participants: readonly NPC[], player: Player): void
  owns(npc: NPC): boolean
  squadMembersFor?(npc: NPC): readonly NPC[]
  combatEnabled(npc: NPC): boolean
  isRetirementEvacuating?(npc: NPC): boolean
  updateTravel(npc: NPC, dt: number, cameraPosition: THREE.Vector3): void
}

/** Live simulation inputs and the effects retained by TownScene. Built once, not once per frame. */
interface TownCombatScene {
  player(): Player
  residents: readonly TownCombatResident[]
  mounts?: readonly Mount[]
  cameraPosition: THREE.Vector3
  obstacles: ObstacleData[]
  airspaceObstacles?: ObstacleData[]
  navigation: NavigationWorld
  hp: HpBar
  careerMounts: Pick<CareerMountController, 'activeMount' | 'update'>
  outskirts?(): TownOutskirtsCombatRuntime | undefined
  airPatrol?(): TownOutskirtsCombatRuntime | undefined
  personalSquad?(): Pick<TownPersonalSquadController, 'actors' | 'mounts' | 'state' | 'owns'> | undefined
  commandActors?(): readonly NPC[]
  raceActors?(): readonly NPC[]
  raceMounts?(): readonly Mount[]
  onActorMoved?(npc: NPC): void
  patrol?(): Pick<TownCavalryPatrolController, 'prepareCombatFrame' | 'combatActors' | 'combatEnabled' | 'noteHostileHit'> & { readonly isSiegeOwned?: boolean }
  /** An individual return/refit owner keeps its actor's assigned peaceful travel until released. */
  ownsPeacefulTravel?(npc: NPC): boolean
  preparePeaceResidents?(excluded: ReadonlySet<NPC>, dt: number): void
  peaceResident(resident: TownCombatResident, dt: number): void
  updateEagleDuty?(npc: NPC, dt: number, combat: boolean): boolean
  updateCommandCue(): void
  clearCombatShots(): void
  hitNpc(target: NPC, damage: number, method: CombatDamageMethod, source?: NPC): void
  damagePlayer(source: NPC, damage: number, method: CombatDamageMethod): void
  fireNpc(origin: THREE.Vector3, direction: THREE.Vector3, kind: 'arrow' | 'pilum', source: NPC, lifecycle?: ProjectileFlightBudget): boolean | void
  /** Co-op host: the guests' bodies, targets for whoever is hostile to them; never updated here. */
  coopPartners?(): readonly NPC[]
  isInFrustum?(position: THREE.Vector3, radius?: number): boolean
  /** DEV-only segmented profiler; never populated in production builds. */
  devProfiler?: Pick<TownDevProfiler, 'isEnabled' | 'add'>
}

const EXTERNAL_GARRISON_RETURN_ID = -4401

/** Owns mission actor selection and simulation order; each mission retains its own phase rules.
 * NPC callbacks run synchronously and carry the actual actor to TownScene's damage/projectile routing.
 * Grids and neighbor storage live here. Controller roster/peer semantics and checkpoints are unchanged.
 */
type ExternalThreatAssignmentOptions = { enemyTownScouts?: readonly NPC[]; player?: Player; roamingOnly?: boolean; nativeEnemyTown?: boolean }

export class TownMissionCombat {
  private readonly grid = new SpatialGrid<NPC>(4)
  private readonly defenseEnemyGrid = new SpatialGrid<NPC>(8)
  private readonly defenseTownGrid = new SpatialGrid<NPC>(8)
  private readonly banditThreatGrid = new SpatialGrid<NPC>(20)
  private readonly externalThreatActors = new Set<NPC>()
  private readonly externalRampartActors = new Set<NPC>()
  private readonly garrisonReturnGrid = new SpatialGrid<NPC>(4)
  private readonly garrisonReturns = new Map<NPC, TownActorSpec>()
  private readonly neighbors: NPC[] = []
  private readonly engagedVeteranEnemies = new Set<NPC>()
  private readonly veteranEngagedEnemyGrid = new SpatialGrid<NPC>(8)
  private readonly enemyTownHostileActors: NPC[] = []
  private readonly warfareGrid = new SpatialGrid<NPC>(8)
  private readonly travelCombatPeers: NPC[] = []
  private readonly travelThreatGrid = new SpatialGrid<NPC>(8)
  private readonly outskirtsGrid = new SpatialGrid<NPC>(8)
  private readonly patrolThreatGrid = new SpatialGrid<NPC>(8)
  private readonly protectionCandidates: NPC[] = []
  private readonly runtimeActors: NPC[] = []
  private readonly eagleThreatCandidates = new Set<NPC | Player>()
  /** Live only while external threats are reassigned; other callers keep live roster reads. */
  private threatOwnershipSnapshot: { command: ReadonlySet<NPC>; fieldFriendlies: ReadonlySet<NPC>; defense: ReadonlySet<NPC> | null } | null = null
  private readonly eagleThreatTargets = new Map<NPC, NPC | Player>()
  private eagleSensorRemaining = 0
  private eagleSensorReady = true
  private readonly individualThreats = new Map<NPC, number>()
  private static readonly EMPTY_NPCS: NPC[] = []
  private readonly bodyCollisionBroadPhase = new EntityCollisionBroadPhase()
  private readonly bodyCollisionList: EntityCollisionBody[] = []
  private readonly bodyCollisionPool: EntityCollisionBody[] = []
  private readonly bodyCollisionActors: NPC[] = []
  private readonly bodyCollisionPrevX: number[] = []
  private readonly bodyCollisionPrevZ: number[] = []
  private readonly outskirtsParticipantsSet = new Set<NPC>()
  private readonly outskirtsParticipantsList: NPC[] = []
  private readonly previousOutskirtsSet = new Set<NPC>()
  private readonly patrolThreatsSet = new Set<NPC>()
  private outskirtsGridPopulated = false
  private fourGateTierParity = 0
  private readonly defenseCommandActors = new Set<NPC>()
  private readonly defensePeaceExcluded = new Set<NPC>()
  private readonly defensePatrolActors = new Set<NPC>()
  private readonly defenseResidentsByNpc = new Map<NPC, TownCombatResident>()
  private readonly defenseOfficialActorIds = new Set<string>()
  private readonly defenseMissionActors = new Set<NPC>()
  private readonly defenseEnemyTownScouts: NPC[] = []
  private readonly defenseActorUpdates = new TownActorUpdates<NPC>({ kind: 'defense' }, { mission: [] })
  private readonly prepActorsSet = new Set<NPC>()
  private readonly prepEnemyIds = new Set<string>()
  private activeDefenseActor: NPC | null = null
  private readonly onDefenseMeleeHit = (damage: number, isPlayer: boolean, targetNpc?: NPC): void => {
    const actor = this.activeDefenseActor!
    if (isPlayer) this.town.damagePlayer(actor, damage, 'melee')
    else if (targetNpc) this.town.hitNpc(targetNpc, damage, 'melee', actor)
  }
  private readonly onDefenseFire = (origin: THREE.Vector3, direction: THREE.Vector3, kind: 'arrow' | 'pilum', lifecycle?: ProjectileFlightBudget) =>
    this.town.fireNpc(origin, direction, kind, this.activeDefenseActor!, ...(lifecycle ? [lifecycle] as const : []))

  constructor(private readonly missions: MissionControllers, private readonly town: TownCombatScene) {}

  private isActorInFrustum(position: THREE.Vector3): boolean {
    return this.town.isInFrustum ? this.town.isInFrustum(position, 6) : true
  }

  get runtimeParticipants(): NPC[] { return this.runtimeActors }
  get runtimeGrid(): SpatialGrid<NPC> { return this.warfareGrid }

  /** A field borrower follows its live combat owner's hostile roster, rather than its home station. */
  allowsFieldMissionCombatTarget(npc: NPC, target: NPC): boolean {
    const { field } = this.missions
    const active = field.active
    if (!active || !['bandit', 'patrol', 'cavalry-sweep', 'veteran-field'].includes(active.kind ?? 'bandit')
      || !field.friendlies.includes(npc) || !combatAllegiancesHostile(npc, target)) return false
    // A settled mission can still encounter roaming enemies on its return journey.
    if ((active.phase === 'MARCHING' || active.phase === 'RETURNING')
      && field.travelEncounter.owns(npc) && field.travelEncounter.hostileActors.includes(target)) return true
    if (active.result) return false
    if (field.allowsMissionCombatTarget(npc, target)) return true
    if (active.kind !== 'veteran-field') return false
    if ((active.phase === 'ASSEMBLING' || active.phase === 'MARCHING') && this.engagedVeteranEnemies.has(target)
      && field.missionBandits.includes(target) && field.isMissionTarget(target)) return true
    return active.phase === 'ENGAGING' && active.templateId === 'veteran-tragedy-of-the-scouts'
      && this.enemyTownHostileActors.includes(target)
  }

  get externalDefenders(): readonly NPC[] {
    return [...new Set([...this.externalThreatActors, ...(this.town.patrol?.().combatActors ?? [])])].filter(npc => !npc.hostileToPlayer)
  }

  /** Already deployed command recipients can travel while enemy spawn work is pending. */
  updateCommandTravel(dt: number, actors: readonly NPC[]): void {
    this.town.navigation.sync(this.town.obstacles)
    this.town.navigation.beginFrame()
    this.grid.clear()
    for (const npc of new Set([...this.town.residents.map(r => r.npc), ...(this.town.raceActors?.() ?? []), ...actors])) if (!npc.dead) this.grid.insert(npc)
    for (const npc of actors) {
      if (npc.dead || npc.missionMovement || npc.formationCommandId === null
        || npc.tacticalOrder !== 'formation' && npc.tacticalOrder !== 'follow') continue
      npc.updateTownTravel(dt, npc.combatPosition.distanceTo(this.town.cameraPosition),
        this.grid.getNearbyInto(npc.combatPosition, 10, this.neighbors), this.actorObstacles(npc), this.town.navigation,
        undefined, this.isActorInFrustum(npc.group.position))
    }
  }

  /** Damage wakes the actual actor/squad without changing a mission party's route phase. */
  noteExternalHit(target: NPC, source?: NPC): void {
    const outskirts = this.town.outskirts?.()
    const field = this.missions.field
    if (source && outskirts && field.noteTravelHit(target, source, outskirts)) { this.prepareTravelCombat(); return }
    if (source && field.friendlies.includes(target) && field.isMissionTarget(source)) field.engageFormalMission()
    if (source && (outskirts?.owns(source) || this.town.airPatrol?.()?.owns(source)
      || field.fieldNpcs.includes(source) || field.ambientBandits.includes(source)
      || this.missions.defense.active && this.missions.defense.phase !== 'PREPARING' && this.missions.defense.fieldNpcs.includes(source)
      || this.personalPatrolCombatActors().includes(source))) {
      const patrolHit = this.town.patrol?.().noteHostileHit(target, source)
      if (!patrolHit && outskirts?.owns(source) && !outskirts.owns(target)) this.individualThreats.set(target, 10)
    }
    const squad = this.missions.field.veteranEnemySquads.find(candidate => candidate.members.includes(target))
    if (squad) this.missions.field.markVeteranEnemySquadEngaged(squad.squadId)
  }

  /** DamageRouter events prove Player attribution and effective contact, including shields and ridden mounts. */
  notePlayerContact(target: NPC, event: CombatEvent): boolean {
    if (event.source.actorType !== 'player' || !['melee', 'projectile', 'mount-impact'].includes(event.method)) return false
    const effective = event.type === 'damage_applied' && event.appliedDamage > 0
      || event.type === 'hit_blocked' && event.blockedImpact > 0
    return effective && (this.town.patrol?.().noteHostileHit(target, 'player') ?? false)
  }

  /** Called only after actual Player HP, shield or mounted contact has been resolved. */
  noteExternalPlayerHit(source: NPC): void {
    const outskirts = this.town.outskirts?.()
    if (outskirts && this.missions.field.noteTravelHit(this.town.player(), source, outskirts)) this.prepareTravelCombat()
    if (this.missions.field.isMissionTarget(source)) this.missions.field.engageFormalMission()
  }

  /** TownScene owns the hostile residents and the single navigation frame reset. */
  updateOutskirtsHostile(dt: number, elapsed: number): void {
    const outskirts = this.prepareOutskirtsFrame(dt)
    if (!outskirts?.actors.length && !this.town.airPatrol?.()?.actors.length && !this.town.personalSquad?.()?.actors.length) return
    const ambientActors = [...new Set(this.missions.field.ambientBandits)]
    for (const actor of ambientActors) if (!outskirts?.owns(actor)) this.updateRuntimeActor(actor, dt)
    for (const actor of outskirts?.actors ?? []) this.updateOutskirtsActor(actor, outskirts!, dt)
    const air = this.town.airPatrol?.()
    for (const actor of air?.actors ?? []) this.updateOutskirtsActor(actor, air!, dt)
    for (const actor of this.town.personalSquad?.()?.actors ?? []) this.updatePersonalActor(actor, dt)
    this.updateRuntimeMountImpacts([...new Set([...ambientActors, ...(outskirts?.actors ?? []), ...(this.town.airPatrol?.()?.actors ?? []), ...(this.town.personalSquad?.()?.actors ?? [])])], elapsed)
    const playerMount = this.town.player().currentMount
    if (playerMount && !playerMount.dead) for (const target of outskirts?.actors ?? []) {
      if (target.dead || target.faction === Faction.TOWN || target.faction === Faction.PLAYER
        || !checkMountImpact(playerMount, target.combatPosition, .5)) continue
      applyMountImpactDamage(playerMount, target, target.combatPosition, elapsed,
        damage => this.town.hitNpc(target, damage, 'mount-impact'))
    }
  }

  updateRaceActorsHostile(dt: number): void {
    for (const actor of this.town.raceActors?.() ?? []) this.updateRuntimeActor(actor, dt)
  }

  get enemyTownHostiles(): readonly NPC[] {
    const active = this.missions.field.active
    return active?.kind === 'veteran-field' && active.templateId === 'veteran-tragedy-of-the-scouts'
      ? this.enemyTownHostileActors
      : []
  }

  update(dt: number, cameraYaw: number, elapsed: number): void {
    this.town.navigation.sync(this.town.obstacles)
    this.town.navigation.beginFrame(this.missions.defense.active?.kind === 'commander-four-gate-defense'
      && this.missions.defense.combatEnabled)
    if (this.missions.duel.active) {
      this.missions.duel.update(dt, true)
      this.updateTownWithDuel(dt, elapsed)
      this.missions.duel.persistRuntimeProgress()
    }
    else if (this.missions.defense.active) this.updateDefense(dt, cameraYaw, elapsed)
    else this.updateField(dt, cameraYaw, elapsed)
  }

  /** Runs after either mission combat or Town hostility, preserving temporary cavalry's departure. */
  updateDepartingCavalry(dt: number): void {
    const { field } = this.missions
    field.updateDepartingCavalry()
    for (const npc of field.departingNpcs) {
      npc.update(dt, this.town.player(), [], [], this.actorObstacles(npc), this.town.hp, () => {}, () => false, false,
        npc.group.position.distanceTo(this.town.cameraPosition), null, null, this.town.navigation, null,
        this.isActorInFrustum(npc.group.position))
    }
    for (const mount of field.cavalryMounts) {
      mount.setCameraDistance(mount.group.position.distanceTo(this.town.cameraPosition))
      mount.setInFrustum?.(this.isActorInFrustum(mount.group.position))
      if (mount.dead || !mount.riderNpc) mount.update(dt, mount.isFlyingMount ? this.town.airspaceObstacles ?? this.town.obstacles : this.town.obstacles)
    }
  }

  /** Panels pause living combat, while every defeated actor completes its presentation. */
  updateDefeatedActors(dt: number): void {
    const { field, duel, defense } = this.missions
    const outskirts = this.town.outskirts?.()
    const actors = new Set([...this.town.residents.map(r => r.npc), ...(this.town.raceActors?.() ?? []), ...field.fieldNpcs,
      ...field.departingNpcs, ...duel.fieldNpcs, ...defense.fieldNpcs, ...defense.waitingEnemies, ...(outskirts?.actors ?? []), ...(this.town.airPatrol?.()?.actors ?? []), ...(this.town.personalSquad?.()?.actors ?? [])])
    for (const actor of actors) if (actor.dead) this.updateCorpse(actor, dt)
    const mounts = new Set([...(this.town.mounts ?? []), ...(this.town.raceMounts?.() ?? []), ...this.town.residents.flatMap(r => r.homeMount ? [r.homeMount] : []),
      ...field.cavalryMounts, ...duel.allMounts, ...defense.enemyMounts, ...(outskirts?.mounts ?? []), ...(this.town.airPatrol?.()?.mounts ?? []), ...(this.town.personalSquad?.()?.mounts ?? [])])
    for (const mount of mounts) if (mount.dead && !mount.disposed) mount.update(dt, mount.isFlyingMount ? this.town.airspaceObstacles ?? this.town.obstacles : this.town.obstacles)
  }

  private updateCorpse(actor: NPC, dt: number): void {
    actor.update(dt, this.town.player(), [], [], this.actorObstacles(actor), this.town.hp, () => {}, () => false,
      false, actor.group.position.distanceTo(this.town.cameraPosition), null, null, this.town.navigation)
  }

  /** Also checks current positions because Player attacks precede threat assignment in a frame. */
  isExternalThreatDefender(ally: NPC): boolean {
    const resident = this.town.residents.find(candidate => candidate.npc === ally)
    if (ally.hostileToPlayer || ally.dead || this.externalThreatHasOtherOwner(ally, resident?.spec.garrison?.kind === 'rampart') || this.garrisonReturns.has(ally)) return false
    if (this.town.patrol?.().combatEnabled(ally)) return true
    if (this.missions.field.active?.kind === 'veteran-field' && this.missions.field.friendlies.includes(ally)) return false
    if (this.externalThreatActors.has(ally)) return true
    if (!resident || ally.dead || !this.isMilitary(resident.spec)) return false
    const outskirts = this.town.outskirts?.()
    const alertRange = townExternalThreatAlertRange(Boolean(resident.spec.eagle), ally)
    return [...this.missions.field.ambientBandits, ...this.missions.field.missionBandits,
      ...this.outskirtsGrid.getNearbyInto(ally.combatPosition, this.externalThreatQueryRange(resident, alertRange), this.protectionCandidates)]
      .some(threat => !threat.dead && !this.isEvacuatingThreat(threat) && townWartimeHostile(ally, threat)
        && (resident.spec.duty !== 'patrol' || !outskirts?.owns(threat))
        && this.isExternalThreatInRange(resident, threat.combatPosition, alertRange))
  }

  /** Resident restoration owns the physical reset; combat only releases its threat registration. */
  releaseExternalThreat(npc: NPC): void {
    this.externalThreatActors.delete(npc)
    this.externalRampartActors.delete(npc)
    this.eagleThreatTargets.delete(npc)
    this.garrisonReturns.delete(npc)
  }

  private updateField(dt: number, cameraYaw: number, elapsed: number): void {
    const { field } = this.missions
    const commandActors = new Set([...(this.town.commandActors?.() ?? []), ...(this.town.raceActors?.() ?? [])])
    const veteranField = field.active?.kind === 'veteran-field'
    // Veteran battles have explicit, persistent rosters. Build the two membership
    // sets and shared peer lists once per frame instead of asking the controller
    // to allocate an all-roster peer array for every actor.
    const veteranFriendlies = veteranField ? new Set(field.friendlies) : null
    const outskirts = this.prepareOutskirtsFrame(dt)
    field.prepareTravelEncounter(dt, this.outskirtsGrid, outskirts ?? { owns: () => false })
    field.updateFlow(dt, cameraYaw)
    this.town.updateCommandCue()
    const warfareActive = Boolean(outskirts?.actors.length || this.town.airPatrol?.()?.actors.length || this.town.personalSquad?.()?.actors.length || commandActors.size)
    const currentVeteran = veteranField ? field.active : undefined
    const veteranSurvival = currentVeteran?.templateId === 'veteran-tragedy-of-the-scouts'
    const player = this.town.player()
    if (veteranField && veteranSurvival) this.updateExternalThreatAssignments({ enemyTownScouts: [...field.friendlies, ...(this.town.personalSquad?.()?.actors ?? [])], player })
    else this.updateExternalThreatAssignments()
    const veteranMarching = veteranField && !veteranSurvival && currentVeteran?.phase === 'MARCHING'
    let veteranCombatActive = veteranField && (veteranSurvival || currentVeteran?.phase === 'ENGAGING')
    this.engagedVeteranEnemies.clear()
    const engagedVeteranSquads = new Set(currentVeteran?.engagedEnemySquadIds ?? [])
    const veteranHostileActors = veteranField ? new Set([...field.missionBandits, ...this.enemyTownHostileActors]) : null
    const veteranActors = veteranField ? [...new Set([...field.missionBandits, ...field.friendlies])] : null
    const veteranFriendlyPeers = veteranField ? [...new Set([...field.friendlies, ...field.missionBandits, ...this.externalThreatActors])] : null
    const veteranEnemyPeers = veteranField ? [...new Set([...field.missionBandits, ...field.friendlies, ...this.externalThreatActors])] : null
    const veteranMarchingPeers = veteranField ? [...new Set([...field.friendlies, ...this.externalThreatActors])] : null
    const missionActors = new Set(veteranActors ?? field.fieldNpcs)
    for (const actor of commandActors) missionActors.add(actor)
    if (veteranField) for (const npc of this.enemyTownHostileActors) missionActors.add(npc)
    this.town.preparePeaceResidents?.(new Set([...missionActors, ...this.externalThreatActors]), dt)
    const patrol = this.town.patrol?.()
    this.preparePatrolCombatFrame(dt, outskirts)
    const patrolActors = new Set(patrol?.combatActors ?? [])
    const missionCombatActors = veteranField
      ? [...new Set([...field.missionBandits, ...field.friendlies, ...this.enemyTownHostileActors])]
      : field.fieldNpcs
    const updates = new TownActorUpdates({ kind: 'field', veteran: veteranField }, {
      mission: missionCombatActors, ambient: warfareActive ? field.ambientBandits : [], command: commandActors,
      outskirts, airPatrol: this.town.airPatrol?.(), personal: this.town.personalSquad?.(),
      external: this.externalThreatActors, patrol: patrolActors,
    }, { isRetirementEvacuating: actor => !actor.dead && Boolean(field.isRetirementEvacuating?.(actor)) })
    updates.updatePeaceResidents(this.town.residents, resident => this.updatePeaceResident(resident, dt))
    const actors = updates.actors
    this.grid.clear()
    if (veteranField) { this.defenseEnemyGrid.clear(); this.defenseTownGrid.clear() }
    for (const actor of actors) {
      if (actor.dead) continue
      this.grid.insert(actor)
      if (veteranHostileActors?.has(actor)) this.defenseEnemyGrid.insert(actor)
      else if (veteranFriendlies?.has(actor) || this.externalThreatActors.has(actor) || actor.combatOwnership === 'player-personal') this.defenseTownGrid.insert(actor)
    }
    if (veteranField) this.veteranEngagedEnemyGrid.clear()
    if (veteranField && !veteranSurvival) {
      for (const squad of field.veteranEnemySquads) {
        let engaged = engagedVeteranSquads.has(squad.squadId)
        const sensor = !squad.leader.dead ? squad.leader : squad.members.find(member => !member.dead)
        if (!engaged && sensor) {
          const nearbyFriendly = this.defenseTownGrid.getNearbyInto(sensor.combatPosition, 50, this.neighbors)
            .some(actor => !actor.dead && (veteranFriendlies!.has(actor) || actor.combatOwnership === 'player-personal'))
          const playerNearby = !player.dead && sensor.combatPosition.distanceToSquared(player.combatPosition) <= 50 * 50
          const nearbyRoaming = warfareActive && squad.members.some(member => !member.dead
            && this.outskirtsGrid.getNearbyInto(member.combatPosition, 50, this.neighbors)
              .some(actor => !actor.dead && townWartimeHostile(member, actor)))
          if (nearbyFriendly || playerNearby || nearbyRoaming) {
            engaged = field.markVeteranEnemySquadEngaged(squad.squadId)
            if (engaged) engagedVeteranSquads.add(squad.squadId)
          }
        }
        if (engaged) {
          for (const member of squad.members) if (!member.dead) this.engagedVeteranEnemies.add(member)
        } else {
          this.faceHeldVeteranSquad(squad, player)
        }
      }
    }
    if (veteranField && veteranSurvival) {
      for (const enemy of field.missionBandits) if (!enemy.dead) this.engagedVeteranEnemies.add(enemy)
      for (const guard of this.enemyTownHostileActors) if (!guard.dead) this.engagedVeteranEnemies.add(guard)
    }
    if (field.travelEncounter.active && field.active?.phase === 'MARCHING' && this.engagedVeteranEnemies.size) {
      field.engageFormalMission()
      veteranCombatActive = !field.travelEncounter.active
    }
    this.prepareTravelCombat()
    if (veteranField) for (const enemy of this.engagedVeteranEnemies) this.veteranEngagedEnemyGrid.insert(enemy)
    const veteranSquadCombatActive = veteranCombatActive || this.engagedVeteranEnemies.size > 0
    for (const actor of actors) {
      if (this.updateOwnedActor(actor, updates.take(actor), dt, outskirts)) continue
      if (field.travelEncounter.owns(actor)) {
        this.updateTravelEncounterActor(actor, dt)
        continue
      }
      const individualDefense = warfareActive && this.shouldDefendAgainstOutskirts(actor)
      const actorIsVeteranHostile = veteranField && veteranHostileActors!.has(actor)
      const veteranFriendlyTravel = veteranField && !veteranSurvival && veteranFriendlies!.has(actor)
        && currentVeteran?.phase !== 'ENGAGING' && this.engagedVeteranEnemies.size === 0
      const veteranEnemyHeld = veteranField && !veteranSurvival && veteranHostileActors!.has(actor)
        && !this.engagedVeteranEnemies.has(actor)
      if (veteranEnemyHeld) {
        this.updateFieldActorPeacefully(actor, dt)
        continue
      }
      if (veteranFriendlyTravel && !individualDefense) {
        this.updateFieldActorTravel(actor, dt)
        continue
      }
      const peers = warfareActive ? this.runtimeActors : veteranField
        ? veteranMarching && !veteranSurvival ? veteranMarchingPeers! : actorIsVeteranHostile ? veteranEnemyPeers! : veteranFriendlyPeers!
        : actor.faction === Faction.BANDIT
          ? [...new Set([...field.combatPeersFor(actor), ...this.externalThreatActors, ...this.livingCoopPartners()])]
          : this.externalThreatActors.has(actor)
            ? [...field.ambientBandits, ...field.missionBandits, ...this.externalThreatActors]
            : field.combatPeersFor(actor)
      const nearbyGrid = warfareActive ? this.warfareGrid : veteranField
        ? actorIsVeteranHostile ? this.defenseEnemyGrid : this.defenseTownGrid
        : this.grid
      const hostileGrid = warfareActive ? this.warfareGrid : veteranSquadCombatActive
        ? actorIsVeteranHostile
          ? this.defenseTownGrid
          : currentVeteran?.phase === 'ENGAGING' && !veteranSurvival
            ? this.defenseEnemyGrid
            : this.veteranEngagedEnemyGrid
        : null
      const travelOrder = individualDefense && (actor.tacticalOrder === 'formation' || actor.tacticalOrder === 'follow'
        || actor.tacticalOrder === 'defend' && actor.formationCommandId != null)
        ? actor.tacticalOrder : null
      // Temporarily release the actor's combat AI while retaining its existing route/follow intent.
      if (travelOrder) actor.tacticalOrder = 'attack'
      if (this.updateEagleCombatDuty(actor, dt)) continue
      actor.update(dt, this.town.player(), peers, nearbyGrid.getNearbyInto(actor.combatPosition, warfareActive ? 8 : 2, this.neighbors),
        this.actorObstacles(actor), this.town.hp,
        (damage, isPlayer, targetNpc) => {
          if (isPlayer) this.town.damagePlayer(actor, damage, 'melee')
          else if (targetNpc) this.town.hitNpc(targetNpc, damage, 'melee', actor)
        },
        (origin, direction, kind, lifecycle) => this.town.fireNpc(origin, direction, kind, actor, ...(lifecycle ? [lifecycle] as const : [])),
        false, actor.group.position.distanceTo(this.town.cameraPosition), null, hostileGrid, this.town.navigation, null,
        this.isActorInFrustum(actor.group.position))
      if (travelOrder && !actor.dead) actor.tacticalOrder = travelOrder
    }
    this.resolveCombatActorCollisions(actors)
    const mount = player.currentMount
    const playerImpactTargets = [...new Set([
      ...(veteranField ? [...field.missionBandits, ...this.enemyTownHostileActors] : [...field.ambientBandits, ...field.missionBandits]),
      ...(outskirts?.actors.filter(actor => actor.faction === Faction.BANDIT || actor.faction === Faction.ENEMY) ?? []),
      ...(this.town.airPatrol?.()?.actors.filter(actor => actor.hostileToPlayer) ?? []),
      ...[...patrolActors].filter(actor => actor.hostileToPlayer),
    ])]
    if ((!veteranField || veteranSquadCombatActive || warfareActive) && mount && mount === player.currentMount && !mount.dead) {
      for (const target of playerImpactTargets) {
        if (target.dead || !checkMountImpact(mount, target.combatPosition, .5)) continue
        applyMountImpactDamage(mount, target, target.combatPosition, elapsed, damage => this.town.hitNpc(target, damage, 'mount-impact'))
      }
    }
    if (warfareActive) {
      this.updateRuntimeMountImpacts(actors.filter(actor => !veteranHostileActors?.has(actor)
        || this.engagedVeteranEnemies.has(actor)), elapsed)
    } else if (veteranField && veteranSquadCombatActive) {
      for (const rider of actors) {
        const npcMount = rider.mount
        if (!npcMount || npcMount.dead || rider.dead) continue
        const riderIsEnemy = veteranHostileActors!.has(rider)
        if (!riderIsEnemy && !veteranFriendlies!.has(rider) && !this.externalThreatActors.has(rider)) continue
        for (const target of this.grid.getNearbyInto(npcMount.group.position, 2.5, this.neighbors)) {
          const isHostileTarget = townWartimeHostile(rider, target)
            && (riderIsEnemy ? veteranFriendlies!.has(target) || this.externalThreatActors.has(target) : veteranHostileActors!.has(target))
          if (!isHostileTarget || target.dead || !checkMountImpact(npcMount, target.combatPosition, .5)) continue
          applyMountImpactDamage(npcMount, target, target.combatPosition, elapsed, damage => this.town.hitNpc(target, damage, 'mount-impact', rider))
        }
        if (riderIsEnemy && rider.hostileToPlayer && !player.dead && checkMountImpact(npcMount, player.combatPosition, .6)) {
          applyMountImpactDamage(npcMount, player, player.combatPosition, elapsed, damage => this.town.damagePlayer(rider, damage, 'mount-impact'))
        }
      }
    } else if (field.active?.kind === 'cavalry-sweep') for (const rider of field.friendlies) {
      const npcMount = rider.mount
      if (!npcMount || npcMount.dead || rider.dead) continue
      for (const target of this.grid.getNearby(npcMount.group.position, 2.5)) {
        if (target.faction !== Faction.BANDIT || target.dead || !checkMountImpact(npcMount, target.combatPosition, .5)) continue
        applyMountImpactDamage(npcMount, target, target.combatPosition, elapsed, damage => this.town.hitNpc(target, damage, 'mount-impact', rider))
      }
    }
    this.town.careerMounts.update(dt)
  }

  private prepareTravelCombat(): void {
    this.travelThreatGrid.clear()
    this.travelCombatPeers.length = 0
    if (!this.missions.field.travelEncounter.active) return
    const threats = this.missions.field.travelEncounter.hostileActors
    this.travelCombatPeers.push(...this.missions.field.friendlies, ...threats)
    for (const threat of threats) if (!threat.dead) this.travelThreatGrid.insert(threat)
  }

  private updateTravelEncounterActor(actor: NPC, dt: number): void {
    // Outside members use the common navigation budget to support; only in-range threats are targets.
    if (actor.tacticalOrder === 'formation') { this.updateFieldActorTravel(actor, dt); return }
    actor.update(dt, this.town.player(), this.travelCombatPeers,
      this.warfareGrid.getNearbyInto(actor.combatPosition, 8, this.neighbors), this.actorObstacles(actor), this.town.hp,
      (damage, isPlayer, target) => {
        if (isPlayer) this.town.damagePlayer(actor, damage, 'melee')
        else if (target) this.town.hitNpc(target, damage, 'melee', actor)
      }, (origin, direction, kind, lifecycle) => this.town.fireNpc(origin, direction, kind, actor, ...(lifecycle ? [lifecycle] as const : [])),
      false, actor.group.position.distanceTo(this.town.cameraPosition), null, this.travelThreatGrid, this.town.navigation, null,
      this.isActorInFrustum(actor.group.position))
  }

  private prepareOutskirtsFrame(dt: number, buildWarfareGrid = true): TownOutskirtsCombatRuntime | undefined {
    this.missions.field.prepareRetirementEvacuation?.(this.runtimeActors)
    this.eagleSensorRemaining -= dt
    this.eagleSensorReady = this.eagleSensorRemaining <= 0
    if (this.eagleSensorReady) this.eagleSensorRemaining = .25
    const outskirts = this.town.outskirts?.()
    outskirts?.synchronizeRank()
    const air = this.town.airPatrol?.()
    air?.synchronizeRank()
    const previousOutskirts = this.previousOutskirtsSet
    previousOutskirts.clear()
    if (outskirts?.actors) for (const npc of outskirts.actors) previousOutskirts.add(npc)
    if (air?.actors) for (const npc of air.actors) previousOutskirts.add(npc)
    const participantSet = this.outskirtsParticipantsSet
    const participants = this.outskirtsParticipantsList
    participantSet.clear()
    participants.length = 0
    const addParticipant = (npc: NPC): void => {
      if (!participantSet.has(npc)) { participantSet.add(npc); participants.push(npc) }
    }
    for (const resident of this.town.residents) {
      if (!this.missions.duel.isParkedResident?.(resident.npc)) addParticipant(resident.npc)
    }
    for (const npc of this.town.raceActors?.() ?? []) addParticipant(npc)
    for (const npc of this.missions.field.fieldNpcs) addParticipant(npc)
    if (outskirts?.actors.length || air?.actors.length || this.town.personalSquad?.()?.actors.length || this.missions.defense.active) {
      for (const npc of this.missions.field.ambientBandits) addParticipant(npc)
    }
    for (const npc of this.missions.defense.fieldNpcs) addParticipant(npc)
    for (const npc of this.missions.duel.fieldNpcs) addParticipant(npc)
    for (const npc of outskirts?.actors ?? []) addParticipant(npc)
    for (const npc of air?.actors ?? []) addParticipant(npc)
    for (const npc of this.town.personalSquad?.()?.actors ?? []) addParticipant(npc)
    outskirts?.prepareFrame(dt, participants, this.town.player())
    air?.prepareFrame(dt, participants, this.town.player())
    // A wiped squad may have been replaced during prepareFrame; never retain its old generation.
    this.runtimeActors.length = 0
    participantSet.clear()
    for (const npc of participants) {
      if (!previousOutskirts.has(npc) && !participantSet.has(npc)) {
        participantSet.add(npc)
        this.runtimeActors.push(npc)
      }
    }
    for (const npc of outskirts?.actors ?? []) {
      if (!participantSet.has(npc)) { participantSet.add(npc); this.runtimeActors.push(npc) }
    }
    for (const npc of air?.actors ?? []) {
      if (!participantSet.has(npc)) { participantSet.add(npc); this.runtimeActors.push(npc) }
    }
    // Hostile actors acquire the co-op guests like any other foe; their own movement comes from the network.
    this.runtimeActors.push(...this.livingCoopPartners())
    if (buildWarfareGrid) {
      this.warfareGrid.clear()
      for (const actor of this.runtimeActors) if (!actor.dead) this.warfareGrid.insert(actor)
    }
    const hasOutskirtsOrAir = Boolean(outskirts?.actors.length || air?.actors.length)
    if (hasOutskirtsOrAir) {
      this.outskirtsGrid.clear()
      for (const actor of outskirts?.actors ?? []) if (!actor.dead && !this.isEvacuatingThreat(actor)) this.outskirtsGrid.insert(actor)
      for (const actor of air?.actors ?? []) if (!actor.dead && !this.isEvacuatingThreat(actor)) this.outskirtsGrid.insert(actor)
      this.outskirtsGridPopulated = true
    } else if (this.outskirtsGridPopulated) {
      this.outskirtsGrid.clear()
      this.outskirtsGridPopulated = false
    }
    participantSet.clear()
    previousOutskirts.clear()
    participants.length = 0
    for (const [actor, remaining] of this.individualThreats) {
      if (actor.dead || remaining <= dt) this.individualThreats.delete(actor)
      else this.individualThreats.set(actor, remaining - dt)
    }
    return outskirts
  }

  private isEvacuatingThreat(actor: NPC): boolean {
    return Boolean(this.missions.field.isRetirementEvacuating?.(actor)
      || this.town.outskirts?.()?.isRetirementEvacuating?.(actor)
      || this.town.airPatrol?.()?.isRetirementEvacuating?.(actor))
  }

  private shouldDefendAgainstOutskirts(actor: NPC): boolean {
    return !actor.dead && (this.individualThreats.has(actor) || this.outskirtsGrid.getNearbyInto(actor.combatPosition, 8, this.neighbors)
      .some(threat => !threat.dead && townWartimeHostile(actor, threat)))
  }

  /** HR sensing and hit wake retain the personal owner's return/preparation restrictions. */
  private personalPatrolCombatActors(): readonly NPC[] {
    const personal = this.town.personalSquad?.()
    return personal && personal.state !== 'RETURNING' && this.missions.defense.phase !== 'PREPARING'
      ? personal.actors.filter(actor => personal.owns(actor)) : []
  }

  private preparePatrolCombatFrame(dt: number, outskirts: TownOutskirtsCombatRuntime | undefined): void {
    const patrol = this.town.patrol?.()
    if (!patrol || patrol.isSiegeOwned) return
    const { field, defense } = this.missions
    const threats = this.patrolThreatsSet
    threats.clear()
    for (const npc of field.fieldNpcs) threats.add(npc)
    for (const npc of field.ambientBandits) threats.add(npc)
    if (defense.active && defense.phase !== 'PREPARING') for (const npc of defense.fieldNpcs) threats.add(npc)
    if (outskirts?.actors) for (const npc of outskirts.actors) threats.add(npc)
    const airActors = this.town.airPatrol?.()?.actors
    if (airActors) for (const npc of airActors) threats.add(npc)
    for (const npc of this.personalPatrolCombatActors()) threats.add(npc)
    this.patrolThreatGrid.clear()
    for (const actor of threats) if (!actor.dead && !this.isEvacuatingThreat(actor)) this.patrolThreatGrid.insert(actor)
    patrol.prepareCombatFrame(dt, this.patrolThreatGrid, {
      player: this.town.player(),
      owns: actor => threats.has(actor) && !this.isEvacuatingThreat(actor),
      squadMembersFor: actor => outskirts?.owns(actor) ? outskirts.squadMembersFor?.(actor) ?? [actor]
        : field.veteranEnemySquads.find(squad => squad.members.includes(actor))?.members ?? [actor],
    })
  }

  private updateOutskirtsActor(actor: NPC, outskirts: TownOutskirtsCombatRuntime, dt: number): void {
    if (!actor.dead && !outskirts.combatEnabled(actor)) {
      outskirts.updateTravel(actor, dt, this.town.cameraPosition)
      return
    }
    this.updateRuntimeActor(actor, dt)
  }

  private updatePersonalActor(actor: NPC, dt: number): void {
    const personal = this.town.personalSquad?.()
    if (!actor.dead && (personal?.state === 'RETURNING' || this.missions.defense.phase === 'PREPARING')) {
      actor.updateTownTravel(dt, actor.group.position.distanceTo(this.town.cameraPosition),
        this.warfareGrid.getNearbyInto(actor.combatPosition, 10, this.neighbors), this.actorObstacles(actor), this.town.navigation,
        undefined, this.isActorInFrustum(actor.group.position))
    } else this.updateRuntimeActor(actor, dt)
  }

  private updateOwnedActor(actor: NPC, owner: TownActorUpdate | undefined, dt: number,
    outskirts: TownOutskirtsCombatRuntime | undefined, resident?: TownCombatResident): boolean {
    switch (owner) {
      case 'mission': return false
      case 'runtime': this.updateRuntimeActor(actor, dt); break
      case 'retirement': this.updateRetirementActor(actor, dt); break
      case 'personal': this.updatePersonalActor(actor, dt); break
      case 'air-patrol': this.updateOutskirtsActor(actor, this.town.airPatrol!()!, dt); break
      case 'outskirts': this.updateOutskirtsActor(actor, outskirts!, dt); break
      case 'peace': this.updatePeaceResident(resident!, dt); break
      case 'escort':
        actor.updateTownTravel(dt, actor.combatPosition.distanceTo(this.town.cameraPosition),
          this.grid.getNearbyInto(actor.combatPosition, 8, this.neighbors), this.actorObstacles(actor), this.town.navigation,
          undefined, this.isActorInFrustum(actor.group.position))
        break
    }
    return true
  }

  private livingCoopPartners(): NPC[] {
    return (this.town.coopPartners?.() ?? []).filter(partner => !partner.dead)
  }

  private actorObstacles(actor: NPC): ObstacleData[] {
    return actor.mount?.isFlyingMount ? this.town.airspaceObstacles ?? this.town.obstacles : this.town.obstacles
  }

  private updateEagleCombatDuty(actor: NPC, dt: number): boolean {
    if (this.town.updateEagleDuty?.(actor, dt, true)) return true
    const target = this.eagleThreatTargets.get(actor)
    if (target && this.externalThreatActors.has(actor)) actor.setMissionCombatTarget(target)
    return false
  }

  private updateRetirementActor(actor: NPC, dt: number): boolean {
    const field = this.missions.field
    if (actor.dead || !field.isRetirementEvacuating?.(actor)) return false
    field.updateRetirementTravel(actor, dt, this.town.cameraPosition,
      this.warfareGrid.getNearbyInto(actor.combatPosition, 4, this.neighbors))
    return true
  }

  private updateRuntimeActor(actor: NPC, dt: number): void {
    if (this.updateRetirementActor(actor, dt)) return
    if (this.updateEagleCombatDuty(actor, dt)) return
    actor.update(dt, this.town.player(), this.runtimeActors,
      this.warfareGrid.getNearbyInto(actor.combatPosition, 8, this.neighbors), this.actorObstacles(actor), this.town.hp,
      (damage, isPlayer, target) => {
        if (isPlayer) this.town.damagePlayer(actor, damage, 'melee')
        else if (target) this.town.hitNpc(target, damage, 'melee', actor)
      }, (origin, direction, kind, lifecycle) => this.town.fireNpc(origin, direction, kind, actor, ...(lifecycle ? [lifecycle] as const : [])),
      false, actor.group.position.distanceTo(this.town.cameraPosition), null, this.warfareGrid, this.town.navigation, null,
      this.isActorInFrustum(actor.group.position))
    this.town.onActorMoved?.(actor)
  }

  private updateRuntimeMountImpacts(actors: readonly NPC[], elapsed: number): void {
    const outskirts = this.town.outskirts?.()
    const player = this.town.player()
    for (const actor of actors) {
      const mount = actor.mount
      if (!mount || mount.dead || actor.dead || actor.combatOwnership === 'player-personal' && this.missions.defense.phase === 'PREPARING' || outskirts?.owns(actor) && !outskirts.combatEnabled(actor)
        || this.town.airPatrol?.()?.owns(actor) && !this.town.airPatrol?.()?.combatEnabled(actor)) continue
      for (const target of this.warfareGrid.getNearbyInto(mount.group.position, 2.5, this.neighbors)) {
        if (target.dead || !townWartimeHostile(actor, target) || !checkMountImpact(mount, target.combatPosition, .5)) continue
        applyMountImpactDamage(mount, target, target.combatPosition, elapsed,
          damage => this.town.hitNpc(target, damage, 'mount-impact', actor))
      }
      if (actor.hostileToPlayer && !player.dead && checkMountImpact(mount, player.combatPosition, .6)) {
        applyMountImpactDamage(mount, player, player.combatPosition, elapsed,
          damage => this.town.damagePlayer(actor, damage, 'mount-impact'))
      }
    }
  }

  private updateFieldActorPeacefully(actor: NPC, dt: number): void {
    const inFrustum = this.isActorInFrustum(actor.group.position)
    if (actor.mount) {
      actor.mount.setInFrustum?.(inFrustum)
      actor.mount.beginControlledFrame()
      actor.mount.finishControlledFrame(dt, this.town.obstacles)
    }
    actor.updateTownPeace(dt, actor.group.position.distanceTo(this.town.cameraPosition), false, false, 0, 0, inFrustum)
  }

  private updateFieldActorTravel(actor: NPC, dt: number): void {
    actor.update(dt, this.town.player(), [], [], this.actorObstacles(actor), this.town.hp, () => {}, () => false,
      false, actor.group.position.distanceTo(this.town.cameraPosition), null, null, this.town.navigation, null,
      this.isActorInFrustum(actor.group.position))
  }

  private faceHeldVeteranSquad(squad: VeteranMissionEnemySquad, player: Player): void {
    const nearestFriendly = this.defenseTownGrid.findNearest(squad.leader.combatPosition)
    let target: THREE.Vector3 | null = nearestFriendly?.combatPosition ?? null
    if (!player.dead && (!target
      || player.combatPosition.distanceToSquared(squad.leader.combatPosition) < target.distanceToSquared(squad.leader.combatPosition))) {
      target = player.combatPosition
    }
    if (!target) return
    for (const actor of squad.members) {
      if (actor.dead) continue
      const position = actor.combatPosition
      const yaw = Math.atan2(target.x - position.x, target.z - position.z)
      actor.group.rotation.y = yaw
      if (actor.mount && !actor.mount.dead) actor.mount.group.rotation.y = yaw
    }
  }

  private updateTownWithDuel(dt: number, elapsed: number): void {
    const { duel, field } = this.missions
    const outskirts = this.prepareOutskirtsFrame(dt)
    this.updateExternalThreatAssignments()
    const duelActors = new Set(duel.fieldNpcs)
    // A parked resident is frozen out of every update, not merely hidden.
    const parked = this.town.residents.filter(resident => duel.isParkedResident?.(resident.npc)).map(resident => resident.npc)
    this.town.preparePeaceResidents?.(new Set([...duelActors, ...parked, ...this.externalThreatActors]), dt)
    this.preparePatrolCombatFrame(dt, outskirts)
    const patrolActors = new Set(this.town.patrol?.().combatActors ?? [])
    const updates = new TownActorUpdates({ kind: 'duel' }, {
      mission: duel.fieldNpcs, field: field.fieldNpcs, ambient: field.ambientBandits,
      outskirts, airPatrol: this.town.airPatrol?.(), external: this.externalThreatActors, patrol: patrolActors,
    })
    updates.updatePeaceResidents(this.town.residents.filter(resident => !parked.includes(resident.npc)), resident => this.updatePeaceResident(resident, dt))
    const actors = updates.actors
    for (const actor of actors) {
      if (this.updateOwnedActor(actor, updates.take(actor), dt, outskirts)) continue
      if (actor.dead) { this.updateCorpse(actor, dt); continue }
      const combatant = actor === duel.opponent && duel.combatEnabled
      const externalCombat = this.warfareGrid.getNearbyInto(actor.combatPosition, 20, this.neighbors)
        .some(target => !target.dead && townWartimeHostile(actor, target))
      duel.setExternalCombat(actor, externalCombat)
      if (combatant || externalCombat) this.updateRuntimeActor(actor, dt)
      else {
        const inFrustum = this.isActorInFrustum(actor.group.position)
        // Every non-combat Duel phase uses travel, including MARCHING/RETURNING.
        // Keep Follow updating after a temporary hold at the moving leader's slot.
        if (actor.formationCommandId != null && (actor.tacticalOrder === 'follow' || !actor.isFormationTargetReached(actor.formationCommandId))) {
          actor.updateTownTravel(dt, actor.group.position.distanceTo(this.town.cameraPosition),
            this.warfareGrid.getNearbyInto(actor.combatPosition, 10, this.neighbors), this.town.obstacles, this.town.navigation,
            undefined, inFrustum)
          continue
        }
        if (actor.mount) { actor.mount.setInFrustum?.(inFrustum); actor.mount.beginControlledFrame(); actor.mount.finishControlledFrame(dt, this.town.obstacles) }
        actor.updateTownPeace(dt, actor.group.position.distanceTo(this.town.cameraPosition), false, false, 0, 0, inFrustum)
      }
    }
    this.resolveCombatActorCollisions(actors)
    // TownScene owns global/Outskirts mounts; the career controller owns its active mount.
    for (const mount of new Set(duel.allMounts)) {
      if (this.town.mounts?.includes(mount) || outskirts?.mounts.includes(mount) || mount === this.town.careerMounts.activeMount) continue
      mount.setCameraDistance(mount.group.position.distanceTo(this.town.cameraPosition))
      mount.setInFrustum?.(this.isActorInFrustum(mount.group.position))
      if (mount.dead || !mount.riderNpc && !mount.riderPlayer) mount.update(dt, this.town.obstacles)
    }
    this.updateRuntimeMountImpacts(actors, elapsed)
    const player = this.town.player(), playerMount = player.currentMount
    if (playerMount && !playerMount.dead) for (const target of this.runtimeActors) {
      if (target.dead || !(target.hostileToPlayer || target === duel.opponent && duel.combatEnabled)
        || !checkMountImpact(playerMount, target.combatPosition, .5)) continue
      applyMountImpactDamage(playerMount, target, target.combatPosition, elapsed, damage => this.town.hitNpc(target, damage, 'mount-impact'))
    }
    this.town.careerMounts.update(dt)
  }

  private updateExternalThreatAssignments(options: ExternalThreatAssignmentOptions = {}): void {
    // This pass reassigns threats only (no combat, deaths or command changes), so
    // per-resident ownership checks may share one roster snapshot.
    this.threatOwnershipSnapshot = {
      command: new Set(this.town.commandActors?.() ?? []),
      fieldFriendlies: new Set(this.missions.field.friendlies),
      defense: this.missions.defense.active ? new Set(this.missions.defense.fieldNpcs) : null,
    }
    try { this.assignExternalThreats(options) } finally { this.threatOwnershipSnapshot = null }
  }

  private assignExternalThreats(options: ExternalThreatAssignmentOptions): void {
    const { field } = this.missions
    const enemyTownScouts = options.enemyTownScouts
    const outskirts = this.town.outskirts?.()
    const threatActors = [...(enemyTownScouts ?? (options.roamingOnly ? [] : [...field.ambientBandits, ...field.missionBandits])),
      ...(outskirts?.actors ?? []), ...(this.town.airPatrol?.()?.actors ?? [])].filter(npc => !npc.dead && !this.isEvacuatingThreat(npc))
    this.eagleThreatCandidates.clear()
    for (const actor of threatActors) this.eagleThreatCandidates.add(actor)
    if (options.player && !options.player.dead) this.eagleThreatCandidates.add(options.player)
    this.banditThreatGrid.clear()
    for (const actor of threatActors) if (!actor.dead) this.banditThreatGrid.insert(actor)
    const missionFriendlies = new Set([...field.friendlies, ...this.missions.duel.fieldNpcs, ...(this.missions.defense.active ? this.missions.defense.fieldNpcs : [])])
    for (const resident of this.town.residents) {
      const { npc, spec } = resident
      if (this.missions.duel.isParkedResident?.(npc)) { this.externalThreatActors.delete(npc); this.eagleThreatTargets.delete(npc); continue }
      if (spec.eagle && this.missions.duel.active) {
        this.eagleThreatTargets.delete(npc)
        if (this.externalThreatActors.delete(npc) && !npc.dead && !this.missions.duel.isMissionActor(npc)) npc.endExternalThreat()
        continue
      }
      if (this.externalThreatHasOtherOwner(npc, spec.garrison?.kind === 'rampart')) {
        this.releaseExternalThreat(npc)
        continue
      }
      if (spec.garrison && !npc.dead && !missionFriendlies.has(npc) && !this.externalThreatActors.has(npc) && !this.garrisonReturns.has(npc)) {
        const station = townStationSpec(spec, npc.isMounted, Boolean(npc.rangedWeaponId))
        const layout = this.town.navigation.townNav?.layout, p = npc.combatPosition
        const resting = !npc.hasFormationTarget || npc.formationCommandId !== null && npc.isFormationTargetReached(npc.formationCommandId)
        const staleGroundHome = station.garrison?.kind !== 'rampart' && resting && layout
          && Math.abs(p.y - getTerrainHeight(p.x, p.z)) < .6 && townRampGroundExcluded(layout, p, npc.isMounted ? 1.8 : .7)
        const wrongHomeLayer = station.garrison?.kind === 'rampart' && resting
          && Math.hypot(p.x - station.x, p.z - station.z) <= 2 && !townResidentAtHome(npc, station, 2)
        if (staleGroundHome || wrongHomeLayer || station.garrison?.kind !== spec.garrison.kind || station.x !== spec.x || station.y !== spec.y || station.z !== spec.z) {
          // Equipment changes update home intent, then use the ordinary physical return.
          resident.spec = station
          this.garrisonReturns.set(npc, station)
          npc.assignFormationTarget(EXTERNAL_GARRISON_RETURN_ID, new THREE.Vector3(station.x, station.y, station.z),
            new THREE.Vector3(Math.sin(station.yaw ?? Math.PI), 0, Math.cos(station.yaw ?? Math.PI)), undefined, 'attack')
        }
      }
      if (this.garrisonReturns.has(npc)) {
        // Only immediate, valid contact interrupts return; a distant old target cannot oscillate it.
        const range = townExternalThreatAlertRange(Boolean(spec.eagle), npc)
        const contact = threatActors.some(threat => townWartimeHostile(npc, threat)
          && npc.combatPosition.distanceToSquared(threat.combatPosition) <= 8 * 8
          && this.isExternalThreatInRange(resident, threat.combatPosition, range))
          || options.player && !options.player.dead && npc.hostileToPlayer
            && npc.combatPosition.distanceToSquared(options.player.combatPosition) <= 8 * 8
            && this.isExternalThreatInRange(resident, options.player.combatPosition, range)
        if (!contact) continue
        this.garrisonReturns.delete(npc)
      }
      if (spec.duty === 'patrol' && this.town.patrol?.()) {
        this.externalThreatActors.delete(npc)
        continue
      }
      if (this.town.patrol?.().combatEnabled(npc)) {
        this.externalThreatActors.delete(npc)
        continue
      }
      const military = enemyTownScouts === undefined
        ? this.isMilitary(spec)
        : spec.role !== 'cat'
      const eligible = military && !npc.dead && !missionFriendlies.has(npc)
        && (enemyTownScouts === undefined
          ? true
          : (options.nativeEnemyTown || spec.id.startsWith('enemy-town:')) && npc.faction === Faction.ENEMY)
      const alertRange = townExternalThreatAlertRange(Boolean(spec.eagle), npc)
      const threatRange = spec.eagle && this.externalThreatActors.has(npc)
        ? Math.max(alertRange, npc.maxRangedAttackDistance) : alertRange
      let eagleTarget = this.eagleThreatTargets.get(npc)
      if (spec.eagle) {
        if (!eligible || eagleTarget?.dead || eagleTarget && (!this.eagleThreatCandidates.has(eagleTarget)
          || eagleTarget !== options.player && (!townWartimeHostile(npc, eagleTarget as NPC) || this.missions.duel.isMissionActor(eagleTarget as NPC))
          || !this.isExternalThreatInRange(resident, eagleTarget.combatPosition, threatRange))) {
          this.eagleThreatTargets.delete(npc); eagleTarget = undefined
        }
        if (eligible && this.eagleSensorReady) {
          let nearest = Infinity, airborne = false
          eagleTarget = undefined
          for (const threat of this.banditThreatGrid.getNearbyInto(npc.combatPosition, threatRange, this.neighbors)) {
            if (threat.dead || !townWartimeHostile(npc, threat)
              || this.missions.duel.isMissionActor(threat)
              || !this.isExternalThreatInRange(resident, threat.combatPosition, threatRange)) continue
            const air = Boolean(threat.mount?.isAirborne)
            const distance = npc.combatPosition.distanceToSquared(threat.combatPosition)
            if (air && !airborne || air === airborne && distance < nearest) { eagleTarget = threat; nearest = distance; airborne = air }
          }
          if (eagleTarget) this.eagleThreatTargets.set(npc, eagleTarget)
          else this.eagleThreatTargets.delete(npc)
        }
      }
      let groundTarget: NPC | undefined
      if (eligible && !spec.eagle) {
        let nearest = Infinity
        for (const threat of this.banditThreatGrid.getNearbyInto(npc.combatPosition, this.externalThreatQueryRange(resident, threatRange), this.neighbors)) {
          if (threat.dead || !townWartimeHostile(npc, threat)
            || !this.isExternalThreatInRange(resident, threat.combatPosition, threatRange)) continue
          const distance = npc.combatPosition.distanceToSquared(threat.combatPosition)
          // Keep the first equal-distance candidate, as the previous stable sort did.
          if (distance < nearest) { groundTarget = threat; nearest = distance }
        }
      }
      const nearbyMissionActor = eligible && (spec.eagle ? Boolean(eagleTarget) : Boolean(groundTarget))
      const nearbyPlayer = eligible && enemyTownScouts !== undefined && options.player !== undefined
        && !options.player.dead && this.isExternalThreatInRange(resident, options.player.combatPosition, threatRange)
      if (spec.eagle && nearbyPlayer && !eagleTarget) this.eagleThreatTargets.set(npc, options.player!)
      const threatened = Boolean(nearbyMissionActor || nearbyPlayer)
      if (threatened) {
        if (!spec.eagle) {
          npc.setMissionCombatTarget(groundTarget ?? options.player!)
          if (npc.townCategory === 'civilian') npc.armTownCivilian(civilianWartimeWeapon(npc.characterFaction))
        }
        if (!this.externalThreatActors.has(npc)) {
          if (npc.isTownRampartGarrisonActive) this.externalRampartActors.add(npc)
          npc.beginExternalThreat()
          if (enemyTownScouts !== undefined) npc.respawnEnabled = false
        }
        this.externalThreatActors.add(npc)
      } else if (this.externalThreatActors.delete(npc)) {
        this.externalRampartActors.delete(npc)
        // A mission borrower already owns this actor's orders and physical position.
        if (npc.dead || missionFriendlies.has(npc)) continue
        this.eagleThreatTargets.delete(npc)
        const heldRampart = npc.isTownRampartGarrisonActive
        npc.setMissionCombatTarget(undefined)
        npc.endExternalThreat()
        if (heldRampart && (spec.garrison?.kind === 'rampart' || spec.duty === 'watchtower_guard')) {
          const station = townStationSpec(spec, npc.isMounted, Boolean(npc.rangedWeaponId))
          const point = new THREE.Vector3(station.x, station.y ?? getTerrainHeight(station.x, station.z), station.z)
          if (npc.combatPosition.distanceToSquared(point) <= .25) {
            // Already at its legal elevated station: never reset its physical position.
            if (station.garrison?.kind === 'rampart' || station.duty === 'watchtower_guard') npc.activateTownRampartGarrison()
          } else {
            this.garrisonReturns.set(npc, station)
            npc.assignFormationTarget(EXTERNAL_GARRISON_RETURN_ID, point,
              new THREE.Vector3(Math.sin(station.yaw ?? Math.PI), 0, Math.cos(station.yaw ?? Math.PI)), undefined, 'attack')
          }
          continue
        }
        // Patrol resumes its own navigation from the actual position, including a
        // recently released mission actor travelling to barracks. It owns arrival.
        if (spec.duty === 'patrol' || spec.duty === 'eagle_garrison') continue
        const station = townStationSpec(spec, npc.isMounted, Boolean(npc.rangedWeaponId))
        const point = new THREE.Vector3(station.x, station.y ?? getTerrainHeight(station.x, station.z), station.z)
        this.garrisonReturns.set(npc, station)
        npc.assignFormationTarget(EXTERNAL_GARRISON_RETURN_ID, point,
          new THREE.Vector3(Math.sin(station.yaw ?? Math.PI), 0, Math.cos(station.yaw ?? Math.PI)), undefined, 'attack')
      }
    }
    this.garrisonReturnGrid.clear()
    if (this.garrisonReturns.size) for (const { npc } of this.town.residents) if (!npc.dead) this.garrisonReturnGrid.insert(npc)
    this.enemyTownHostileActors.length = 0
    if (enemyTownScouts !== undefined) for (const npc of this.externalThreatActors) {
      if (npc.combatantId.startsWith('enemy-town:') && !npc.dead) this.enemyTownHostileActors.push(npc)
    }
  }

  /** A new owner wins even between assignment and the next peaceful update. */
  private externalThreatHasOtherOwner(npc: NPC, respectOrders = false): boolean {
    const returning = this.garrisonReturns.has(npc)
      && npc.formationCommandId === EXTERNAL_GARRISON_RETURN_ID
    const snapshot = this.threatOwnershipSnapshot
    return Boolean(this.externalRampartActors.has(npc) && !npc.isTownRampartGarrisonActive
      || (snapshot ? snapshot.command.has(npc) : this.town.commandActors?.().includes(npc)) || this.town.ownsPeacefulTravel?.(npc)
      || (snapshot ? snapshot.fieldFriendlies.has(npc) : this.missions.field.friendlies.includes(npc)) || this.missions.duel.isMissionActor(npc)
      || this.missions.defense.active && (snapshot?.defense ? snapshot.defense.has(npc) : this.missions.defense.fieldNpcs.includes(npc))
      || respectOrders && !returning && (npc.missionMovement || npc.formationCommandId != null
        || npc.tacticalOrder === 'follow' || npc.tacticalOrder === 'formation'
        || npc.tacticalOrder === 'charge' && !this.externalThreatActors.has(npc)))
  }

  private updatePeaceResident(resident: TownCombatResident, dt: number): void {
    const { npc } = resident, station = this.garrisonReturns.get(npc)
    if (station) {
      if (npc.dead || this.externalThreatHasOtherOwner(npc, true) || npc.formationCommandId !== EXTERNAL_GARRISON_RETURN_ID) {
        // Do not clear the new owner's movement, formation or equipment state.
        this.garrisonReturns.delete(npc)
      } else {
        npc.updateTownTravel(dt, npc.combatPosition.distanceTo(this.town.cameraPosition),
          this.garrisonReturnGrid.getNearbyInto(npc.combatPosition, 10, this.neighbors), this.town.obstacles, this.town.navigation,
          undefined, this.isActorInFrustum(npc.group.position))
        if (townResidentAtHome(npc, station) && npc.isFormationTargetReached(EXTERNAL_GARRISON_RETURN_ID)) {
          this.garrisonReturns.delete(npc)
          npc.setTacticalOrder('attack')
          npc.setTownPeaceful()
          activateTownResidentHome(npc, station)
        }
        return
      }
    }
    this.town.peaceResident(resident, dt)
  }

  /** Broaden candidates only beside this reachable structure; final eligibility
   * still applies the resident's unchanged horizontal radius and home-sector leash. */
  private externalThreatQueryRange({ spec, npc }: TownCombatResident, range: number): number {
    const tower = this.town.navigation.townNav?.watchtower
    return !spec.eagle && this.isMilitary(spec) && tower?.near(npc.combatPosition, range)
      ? Math.hypot(range, tower.layout.totalHeight + 2) : range
  }

  private isExternalThreatInRange({ spec, npc }: TownCombatResident, position: THREE.Vector3, range: number): boolean {
    if (!spec.eagle) return townDefenseThreatInRange(spec, npc, position, range, this.town.navigation.townNav?.watchtower)
    if (!(npc.combatPosition.distanceToSquared(position) <= range * range)) return false
    // Patrol sorties defend the town and their local sector; the leash is centered
    // on the town, never on a distant home pad or an unbounded enemy position.
    return Number.isFinite(position.x + position.y + position.z)
      && Math.abs(position.x) <= TOWN_PLAYABLE_WORLD_BOUND && Math.abs(position.z) <= TOWN_PLAYABLE_WORLD_BOUND
      && Math.hypot(position.x, position.z) <= TOWN_EAGLE_ALERT_RADIUS * 2
  }

  private isMilitary(spec: TownActorSpec): boolean { return isTownMilitary(spec) }

  /** Deployment/preparation has no threat acquisition, combat callbacks or ramp advancement.
   * Explicit friendly formations/follow orders still use the production travel pipeline. */
  private updateFourGatePreparation(dt: number): void {
    const devProf = import.meta.env.DEV && this.town.devProfiler?.isEnabled() ? this.town.devProfiler : null
    const defense = this.missions.defense
    const actorSet = this.prepActorsSet
    actorSet.clear()
    for (const resident of this.town.residents) actorSet.add(resident.npc)
    for (const npc of defense.fieldNpcs) actorSet.add(npc)
    for (const npc of defense.waitingEnemies) actorSet.add(npc)
    for (const npc of this.town.commandActors?.() ?? []) actorSet.add(npc)
    for (const npc of this.town.personalSquad?.()?.actors ?? []) actorSet.add(npc)
    const enemies = this.prepEnemyIds
    enemies.clear()
    for (const id of defense.active?.targetActorIds ?? []) enemies.add(id)
    const actors = this.runtimeActors
    actors.length = 0
    for (const actor of actorSet) actors.push(actor)
    const tGrid = devProf ? performance.now() : 0
    this.grid.clear(); this.warfareGrid.clear()
    for (const actor of actors) if (!actor.dead) { this.grid.insert(actor); this.warfareGrid.insert(actor) }
    if (devProf) devProf.add('gridBuildMs', performance.now() - tGrid)
    const tActors = devProf ? performance.now() : 0
    for (const actor of actors) {
      if (actor.dead) { this.updateCorpse(actor, dt); continue }
      const distance = actor.combatPosition.distanceTo(this.town.cameraPosition)
      const inFrustum = this.isActorInFrustum(actor.group.position)
      if (!enemies.has(actor.combatantId)) {
        if (this.town.updateEagleDuty?.(actor, dt, false)) continue
        actor.updateTownTravel(dt, distance, this.grid.getNearbyInto(actor.combatPosition, actor.mount?.isFlyingMount ? 60 : 4, this.neighbors),
          this.actorObstacles(actor), this.town.navigation, undefined, inFrustum)
      } else if (actor.mount?.isFlyingMount) {
        actor.updateTownTravel(dt, distance, this.grid.getNearbyInto(actor.combatPosition, 60, this.neighbors),
          this.actorObstacles(actor), this.town.navigation, undefined, inFrustum)
      } else {
        if (actor.mount) {
          actor.mount.setCameraDistance(distance)
          actor.mount.setInFrustum?.(inFrustum)
          actor.mount.beginControlledFrame(); actor.mount.finishControlledFrame(dt, this.town.obstacles)
        }
        actor.updateTownPeace(dt, distance, false, false, 0, 0, inFrustum)
      }
    }
    if (devProf) devProf.add('actorUpdateMs', performance.now() - tActors)
    for (const mount of defense.enemyMounts) if (mount.dead || !mount.riderNpc && !mount.riderPlayer) {
      mount.setCameraDistance(mount.group.position.distanceTo(this.town.cameraPosition))
      mount.setInFrustum?.(this.isActorInFrustum(mount.group.position))
      mount.update(dt, mount.isFlyingMount ? this.town.airspaceObstacles ?? this.town.obstacles : this.town.obstacles)
    }
    this.town.careerMounts.update(dt)
  }

  private updateDefense(dt: number, cameraYaw: number, elapsed: number): void {
    const devProf = import.meta.env.DEV && this.town.devProfiler?.isEnabled() ? this.town.devProfiler : null
    const tFlow = devProf ? performance.now() : 0
    const { defense } = this.missions
    const commandActors = this.defenseCommandActors
    commandActors.clear()
    for (const actor of this.town.commandActors?.() ?? []) commandActors.add(actor)
    for (const actor of this.town.raceActors?.() ?? []) commandActors.add(actor)
    defense.updateFlow(dt, cameraYaw)
    this.town.updateCommandCue()
    if (defense.active?.kind === 'commander-four-gate-defense' && !defense.combatEnabled) {
      if (devProf) devProf.add('missionFlowMs', performance.now() - tFlow)
      this.town.navigation.resumePathSearches()
      this.updateFourGatePreparation(dt)
      return
    }
    const livingTown = defense.active?.kind === 'commander-sky-raid' || defense.active?.kind === 'commander-decapitation'
    const patrol = this.town.patrol?.()
    const externalWarfare = Boolean(
      this.town.outskirts?.()?.actors.length
      || this.town.airPatrol?.()?.actors.length
      || this.missions.field.ambientBandits.length
      || this.externalThreatActors.size,
    )
    const needWarfareGrid = livingTown || externalWarfare || Boolean(this.town.personalSquad?.()?.actors.length)
      || Boolean(patrol && !patrol.isSiegeOwned)
    const outskirts = this.prepareOutskirtsFrame(dt, needWarfareGrid)
    const warfareActive = Boolean(outskirts?.actors.length || this.town.airPatrol?.()?.actors.length || defense.active)
    const defenseFieldNpcs = defense.fieldNpcs
    if (livingTown) {
      const scouts = this.defenseEnemyTownScouts
      scouts.length = 0
      for (const npc of defenseFieldNpcs) scouts.push(npc)
      for (const npc of this.town.personalSquad?.()?.actors ?? []) scouts.push(npc)
      this.updateExternalThreatAssignments({ nativeEnemyTown: true, enemyTownScouts: scouts, player: this.town.player() })
    } else if (warfareActive && (externalWarfare || this.garrisonReturns.size > 0 || this.externalThreatActors.size > 0)) {
      this.updateExternalThreatAssignments({ roamingOnly: true })
    }
    const excluded = this.defensePeaceExcluded
    excluded.clear()
    for (const npc of defenseFieldNpcs) excluded.add(npc)
    for (const npc of this.externalThreatActors) excluded.add(npc)
    for (const npc of commandActors) excluded.add(npc)
    this.town.preparePeaceResidents?.(excluded, dt)
    this.preparePatrolCombatFrame(dt, outskirts)
    const patrolActors = this.defensePatrolActors
    patrolActors.clear()
    for (const npc of patrol?.combatActors ?? []) patrolActors.add(npc)
    let isMissionActor: (actor: NPC) => boolean
    if (defense.isMissionActor) {
      isMissionActor = actor => defense.isMissionActor!(actor)
    } else {
      const missionSet = this.defenseMissionActors
      missionSet.clear()
      for (const npc of defenseFieldNpcs) missionSet.add(npc)
      isMissionActor = actor => defense.fieldNpcs === defenseFieldNpcs ? missionSet.has(actor) : defense.fieldNpcs.includes(actor)
    }
    const updates = this.defenseActorUpdates.reset({ kind: 'defense' }, warfareActive ? {
      mission: defenseFieldNpcs, command: commandActors, patrol: patrolActors,
      ambient: this.missions.field.ambientBandits, outskirts,
      airPatrol: this.town.airPatrol?.(), personal: this.town.personalSquad?.(), external: this.externalThreatActors,
    } : {
      mission: defenseFieldNpcs, command: commandActors, patrol: patrolActors,
    }, { isEscorting: actor => Boolean(defense.isEscorting?.(actor)),
      isMissionActor,
      ownsPeacefulTravel: actor => Boolean(this.town.ownsPeacefulTravel?.(actor)) })
    updates.updatePeaceResidents(this.town.residents, resident => this.updatePeaceResident(resident, dt))
    const actors = updates.actors
    const residents = this.defenseResidentsByNpc
    residents.clear()
    for (const resident of this.town.residents) residents.set(resident.npc, resident)
    const officialIds = this.defenseOfficialActorIds
    officialIds.clear()
    for (const id of defense.active?.officialSquad?.actorIds ?? []) officialIds.add(id)
    if (devProf) devProf.add('missionFlowMs', performance.now() - tFlow)
    const tGrid = devProf ? performance.now() : 0
    this.grid.clear(); this.defenseEnemyGrid.clear(); this.defenseTownGrid.clear()
    for (const actor of actors) {
      if (actor.dead) continue
      this.grid.insert(actor)
      if (actor.faction === Faction.ENEMY) this.defenseEnemyGrid.insert(actor)
      else this.defenseTownGrid.insert(actor)
    }
    if (devProf) devProf.add('gridBuildMs', performance.now() - tGrid)
    // PR7 owns carrier motion, dock topology, per-gate releases and convoy routing.
    // The scene's existing grid is shared by all eight ramps.
    const tSiege = devProf ? performance.now() : 0
    defense.updateSiege?.(dt, this.grid)
    if (devProf) devProf.add('siegeMs', performance.now() - tSiege)
    this.town.navigation.resumePathSearches()
    const tActors = devProf ? performance.now() : 0
    const isFourGateCombat = defense.active?.kind === 'commander-four-gate-defense' && Boolean(defense.combatEnabled)
    if (isFourGateCombat) this.fourGateTierParity = (this.fourGateTierParity + 1) % 12
    const playerRef = this.town.player()
    const cameraPos = this.town.cameraPosition
    const playerPos = playerRef.combatPosition
    const playerAlive = !playerRef.dead
    for (let actorIndex = 0; actorIndex < actors.length; actorIndex++) {
      const actor = actors[actorIndex]
      const resident = residents.get(actor)
      if (this.updateOwnedActor(actor, updates.take(actor, Boolean(resident)), dt, outskirts, resident)) continue
      if (this.town.updateEagleDuty?.(actor, dt, defense.phase !== 'PREPARING' && defense.phase !== 'RESULT' && defense.phase !== 'RESET' && !defense.active?.result)) continue
      defense.updateCivilianOrder(actor)
      const individualDefense = !officialIds.has(actor.combatantId)
        && !actor.missionMovement && warfareActive && this.shouldDefendAgainstOutskirts(actor)
      const travelOrder = individualDefense && (actor.tacticalOrder === 'formation' || actor.tacticalOrder === 'follow'
        || actor.tacticalOrder === 'defend' && actor.formationCommandId != null)
        ? actor.tacticalOrder : null
      if (travelOrder) actor.tacticalOrder = 'attack'
      const distance = actor.group.position.distanceTo(cameraPos)
      const inFrustum = this.isActorInFrustum(actor.group.position)
      if (isFourGateCombat && !travelOrder) {
        if (((this.fourGateTierParity + actorIndex) & 3) !== 0
          && actor.canSkipHeldStationaryFrame?.(distance, inFrustum)) {
          actor.stepHeldStationaryFrame?.(dt, distance, inFrustum)
          continue
        }
        if (((this.fourGateTierParity + actorIndex) % 3) !== 0
          && actor.canTierOuterSiegeStep?.(distance, inFrustum)) {
          actor.stepTieredOuterSiege?.(dt, this.actorObstacles(actor), distance, inFrustum)
          continue
        }
      }
      const hostileGrid = externalWarfare ? this.warfareGrid : actor.faction === Faction.ENEMY ? this.defenseTownGrid : this.defenseEnemyGrid
      const nearbyGrid = externalWarfare ? this.warfareGrid : this.grid
      const nearbyRadius = externalWarfare ? 8 : 2
      const needsNearby = actor.currentState === AIState.CHASE
        || actor.tacticalOrder === 'follow'
        || actor.hasFormationTarget
        || Boolean(actor.mount?.isFlyingMount)
        || (actor.isMounted && actor.hasActiveRangedWeapon)
      this.activeDefenseActor = actor
      actor.update(dt, playerRef, warfareActive ? this.runtimeActors : defense.peersFor(actor),
        needsNearby ? nearbyGrid.getNearbyInto(actor.combatPosition, nearbyRadius, this.neighbors) : TownMissionCombat.EMPTY_NPCS,
        this.actorObstacles(actor), this.town.hp,
        this.onDefenseMeleeHit,
        this.onDefenseFire,
        false, distance, null, hostileGrid, this.town.navigation, null,
        inFrustum)
      if (travelOrder && !actor.dead) actor.tacticalOrder = travelOrder
      if (isFourGateCombat && typeof actor.armOuterSiegeTier === 'function') {
        let safeFrames = 0
        if (((!inFrustum && distance > 42) || distance > 64)
          && !actor.dead && !actor.isFalling && !actor.mount?.isFlyingMount
          && actor.canArmOuterSiegeTier) {
          if (actor.suppressesMissionTargetAcquisition) {
            safeFrames = 3
          } else {
            const checkRadius = actor.hasActiveRangedWeapon
              ? Math.min(64, actor.maxRangedAttackDistance + 6)
              : 26
            const playerTooClose = playerAlive && actor.combatPosition.distanceToSquared(playerPos) <= checkRadius * checkRadius
            if (!playerTooClose && hostileGrid.getNearbyInto(actor.combatPosition, checkRadius, this.neighbors).length === 0) {
              safeFrames = actor.currentState === AIState.IDLE ? 3 : 2
            }
          }
        }
        actor.armOuterSiegeTier(safeFrames)
      }
    }
    this.activeDefenseActor = null
    if (devProf) devProf.add('actorUpdateMs', performance.now() - tActors)
    const tCol = devProf ? performance.now() : 0
    this.resolveCombatActorCollisions(actors)
    if (devProf) devProf.add('collisionMs', performance.now() - tCol)
    for (const enemy of defense.waitingEnemies) {
      if (enemy.dead) continue
      const inFrustum = this.isActorInFrustum(enemy.group.position)
      const mount = enemy.mount
      if (mount && !mount.dead) {
        mount.setCameraDistance(mount.group.position.distanceTo(this.town.cameraPosition))
        mount.setInFrustum?.(inFrustum)
        mount.beginControlledFrame()
        mount.finishControlledFrame(dt, mount.isFlyingMount ? this.town.airspaceObstacles ?? this.town.obstacles : this.town.obstacles)
      }
      enemy.updateTownPeace(dt, enemy.group.position.distanceTo(this.town.cameraPosition), false, false, 0, 0, inFrustum)
    }
    // Lethal damage immediately releases the rider; keep mission mounts' collapse advancing.
    for (const mount of defense.enemyMounts) {
      mount.setCameraDistance(mount.group.position.distanceTo(this.town.cameraPosition))
      mount.setInFrustum?.(this.isActorInFrustum(mount.group.position))
      if (mount.dead || !mount.riderNpc && !mount.riderPlayer) mount.update(dt, mount.isFlyingMount ? this.town.airspaceObstacles ?? this.town.obstacles : this.town.obstacles)
    }
    const player = this.town.player(), mount = player.currentMount
    if (mount && mount === player.currentMount && !mount.dead) {
      for (const target of this.grid.getNearbyInto(mount.group.position, 2.5, this.neighbors)) {
        if ((target.faction !== Faction.ENEMY && (!warfareActive || target.faction !== Faction.BANDIT))
          || target.dead || !checkMountImpact(mount, target.combatPosition, .5)) continue
        applyMountImpactDamage(mount, target, target.combatPosition, elapsed, damage => this.town.hitNpc(target, damage, 'mount-impact'))
      }
    }
    if (warfareActive) this.updateRuntimeMountImpacts(actors, elapsed)
    else for (const actor of actors) {
      const npcMount = actor.mount
      if (!npcMount || npcMount.dead || actor.dead) continue
      for (const target of this.grid.getNearbyInto(npcMount.group.position, 2.5, this.neighbors)) {
        if (target.dead || !townWartimeHostile(actor, target) || !checkMountImpact(npcMount, target.combatPosition, .5)) continue
        applyMountImpactDamage(npcMount, target, target.combatPosition, elapsed, damage => this.town.hitNpc(target, damage, 'mount-impact', actor))
      }
      if (actor.hostileToPlayer && !player.dead && checkMountImpact(npcMount, player.combatPosition, .6)) {
        applyMountImpactDamage(npcMount, player, player.combatPosition, elapsed, damage => this.town.damagePlayer(actor, damage, 'mount-impact'))
      }
    }
    this.town.careerMounts.update(dt)
  }

  private resolveCombatActorCollisions(actors: readonly NPC[]): void {
    const obstacles = this.town.obstacles
    if (!obstacles || actors.length < 2) return
    const bodies = this.bodyCollisionList
    const pool = this.bodyCollisionPool
    const refs = this.bodyCollisionActors
    const prevX = this.bodyCollisionPrevX
    const prevZ = this.bodyCollisionPrevZ
    bodies.length = 0
    refs.length = 0
    prevX.length = 0
    prevZ.length = 0
    for (const actor of actors) {
      if (actor.dead || actor.isFalling || actor.mount?.isFlyingMount) continue
      const mounted = Boolean(actor.isMounted && actor.mount && !actor.mount.dead)
      const position = mounted ? actor.mount?.group?.position : actor.combatPosition
      if (!position) continue
      const index = bodies.length
      let body = pool[index]
      if (!body) {
        body = { position, anchored: false, radius: 0.5, height: 2.3, bottomOffset: 0, pushWeight: 1.0 }
        pool[index] = body
      }
      body.position = position
      body.anchored = Boolean(actor.siegeTransport)
      if (mounted) {
        body.radius = 1.0
        body.height = 2.6
        body.bottomOffset = 0
        body.mountedSurfaces = true
        body.walkSurfaces = undefined
        body.pushWeight = (actor.mount!.movementSpeed ?? 0) > COMBAT_BALANCE.mountImpact.minSpeed ? 4.0 : 2.0
      } else {
        body.radius = 0.5
        body.height = 2.3
        body.bottomOffset = 0
        body.walkSurfaces = true
        body.mountedSurfaces = undefined
        body.pushWeight = 1.0
      }
      bodies.push(body)
      refs.push(actor)
      prevX.push(position.x)
      prevZ.push(position.z)
    }
    if (bodies.length < 2) return
    this.bodyCollisionBroadPhase.resolve(bodies, obstacles)
    for (let i = 0; i < bodies.length; i++) {
      const body = bodies[i]
      const actor = refs[i]
      const moved = body.position.x !== prevX[i] || body.position.z !== prevZ[i]
      if (!body.anchored && moved) {
        const mount = body.mountedSurfaces ? actor.mount : null
        const collision = resolveObstacleCollision(body.position, body.position, mount?.velY ?? 0, mount?.onGround ?? true,
          body.radius, body.height, body.bottomOffset, obstacles, { walkSurfaces: body.walkSurfaces, mountedSurfaces: body.mountedSurfaces })
        if (collision.recovered) mount?.applyObstacleRecovery(collision)
      }
      if (body.mountedSurfaces && actor.group?.position && moved) {
        const dx = body.position.x - prevX[i]
        const dz = body.position.z - prevZ[i]
        actor.group.position.x += dx
        actor.group.position.z += dz
      }
    }
  }
}
