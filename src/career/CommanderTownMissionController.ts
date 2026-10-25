import { horseVariantForStableKey } from '../world/HorseAssetRegistry'
import * as THREE from 'three'
import { officialActorSquadId, officialCommandIsPlayerControlled } from './CareerCommandAuthority'
import { restoreCommandActor, snapshotCommandActor } from './CareerCommandActorCheckpoint'
import type { NpcSpawnSpec } from '../battle/BattleSpawner'
import { BattleStatsTracker, type BattleStatsSnapshot } from '../combat/BattleStatsTracker'
import { CombatEventStream, type CombatEvent } from '../combat/CombatAttribution'
import type { NavigationWorld } from '../navigation/NavigationWorld'
import type { Player } from '../player/Player'
import { civilianShouldFight, civilianWartimeWeapon, townWartimePeers } from '../town/TownWartime'
import type { TownActorSpec } from '../town/TownRules'
import { TOWN_CITY } from '../town/TownLayout'
import { TOWN_PLAYABLE_WORLD_BOUND } from '../town/TownBounds'
import { getTerrainHeight, type ObstacleData } from '../world/Terrain'
import { eagleBowEngagementRange } from '../combat/EagleRangedCombat'
import { WEAPONS } from '../rpg/WeaponDatabase'
import { gameplayNpcSpawns, trackNpcSpawn, type NpcSpawnBatch, type NpcSpawnScheduler } from '../world/NpcSpawnScheduler'
import { Faction, NPC } from '../world/NPC'
import { Mount, mountTypeFromId } from '../world/Mount'
import { XONGKORO } from '../movement/XongkoroConfig'
import { cloneCareerProfile, type CareerProfile } from './CareerProfile'
import { CareerMissionCheckpoint } from './CareerMissionCheckpoint'
import { acceptsCareerMissionStat, careerMissionCommandMeritPolicy, resolveCareerMissionOutcome, type ActiveCareerMission, type CareerMissionOutcome, type CareerMissionPhase } from './CareerMissionState'
import { createDecapitationRoster, createSkyRaidRoster, isCommanderTownMission, recordCommanderObjectiveDeath, COMMANDER_SKY_RAID_REQUIRED_KILLS } from './CommanderMissionCatalog'
import { needsDecapitationDeployment, planDecapitationDeployment, type DecapitationDeployment, type DeploymentThreat } from './CommanderDecapitationDeployment'
import { careerEaglePadOwners } from './EaglePadReservations'

export interface CommanderTownResident { spec: TownActorSpec; npc: NPC; homeMount?: Mount }

/** Commander-only enemy-Town battles. TownScene retains the shared combat/navigation loop;
 * this controller owns only roster deployment, objective identity, command state and checkpoints.
 */
export class CommanderTownMissionController {
  readonly events = new CombatEventStream()
  readonly enemies: NPC[] = []
  readonly enemyMounts: Mount[] = []
  readonly groups: never[] = []
  readonly waitingEnemies: NPC[] = []
  personalActors: () => readonly NPC[] = () => []
  civilianCommandOwns: (npc: NPC) => boolean = () => false
  private readonly officialActors: NPC[] = []
  private readonly actorMounts = new Map<NPC, Mount>()
  private readonly plannedPositions: THREE.Vector3[] = []
  private readonly playerIssuedCommands = new Set<NPC>()
  private readonly civilianCombat = new Set<NPC>()
  private tracker: BattleStatsTracker | null = null
  private spawnBatch?: NpcSpawnBatch
  private startedMissionId?: string
  private rosterCommitPending = false
  private readonly checkpoint = new CareerMissionCheckpoint(() => this.readProfile(), profile => this.commit(profile))
  private objectiveUnsubscribe?: () => void
  initialDeployment?: DecapitationDeployment

  constructor(
    private readonly scene: THREE.Scene,
    private readonly residents: readonly CommanderTownResident[],
    private readonly player: () => Player,
    private readonly readProfile: () => CareerProfile,
    private readonly commit: (profile: CareerProfile) => boolean,
    private readonly navigation: NavigationWorld,
    private readonly scheduler: NpcSpawnScheduler = gameplayNpcSpawns,
    private readonly deploymentEnvironment?: { obstacles: readonly ObstacleData[]; otherThreats: () => DeploymentThreat[] },
  ) {}

  get active(): ActiveCareerMission | undefined {
    const mission = this.readProfile().activeMission
    return isCommanderTownMission(mission) ? mission : undefined
  }
  get spawnBatches(): readonly NpcSpawnBatch[] { return this.spawnBatch ? [this.spawnBatch] : [] }
  get ready(): boolean {
    return !this.rosterCommitPending && Boolean(this.startedMissionId)
      && (!this.spawnBatch || this.spawnBatch.pending === 0 && (this.spawnBatch.status === 'pending' || this.spawnBatch.ready))
  }
  get assault(): boolean { return true }
  get phase(): CareerMissionPhase | null { return this.active?.phase ?? null }
  get preparationRemaining(): number { return 0 }
  get reserveHasCharged(): boolean { return true }
  get servicesLocked(): boolean { return Boolean(this.active && !this.active.result) }
  get deploymentPositions(): readonly THREE.Vector3[] {
    return [...this.officialActors.filter(actor => !actor.dead).map(actor => actor.combatPosition), ...this.plannedPositions]
  }
  get fieldNpcs(): NPC[] { return [...this.officialActors] }
  get military(): NPC[] { return this.targetResidents }
  get defenders(): NPC[] { return this.officialActors }
  get civilians(): NPC[] { return this.residents.filter(resident => resident.spec.role === 'civilian').map(resident => resident.npc) }
  get civilianDeaths(): number { return this.civilians.filter(actor => actor.dead).length }
  get civilianSurvived(): number { return this.civilians.length - this.civilianDeaths }
  get playerEnemies(): NPC[] { return this.residents.map(resident => resident.npc).filter(actor => actor.faction === Faction.ENEMY) }
  get remainingEnemies(): number {
    const active = this.active
    if (!active) return 0
    if (active.kind === 'commander-sky-raid') return Math.max(0, COMMANDER_SKY_RAID_REQUIRED_KILLS - new Set(active.deadTargetActorIds ?? []).size)
    return this.targetResidents.some(actor => !actor.dead) ? 1 : 0
  }
  get personalContribution() { return this.tracker?.commandCheckpoint() }
  get officialContribution() { return this.tracker?.officialCommandCheckpoint() }

  private get targetResidents(): NPC[] {
    const targetIds = new Set(this.active?.targetActorIds ?? [])
    return this.residents.filter(resident => targetIds.has(resident.spec.id)).map(resident => resident.npc)
  }

  startActiveMission(): boolean {
    const requested = this.active
    if (!requested?.commanderMission || requested.result) return false
    if (this.startedMissionId === requested.id) return this.spawnBatch?.status !== 'failed'
    this.disposeTemporaryActors()
    this.rosterCommitPending = true
    const prepared = this.prepareNativeRoster(requested)
    if (!prepared) return false
    this.rosterCommitPending = false
    this.startedMissionId = prepared.id
    this.restoreNativeActors(prepared)
    if (needsDecapitationDeployment(prepared)) {
      if (!this.deploymentEnvironment) throw new Error('Commander Decapitation deployment requires Town obstacles and threats')
      const profile = this.readProfile()
      const members = new Map(profile.personalSquad?.members.map(member => [member.id, member]))
      const groundCount = prepared.personalSquad?.memberIds.filter(id => members.get(id)?.equipment?.mount !== 'xongkoro').length ?? 0
      const threats = this.residents.filter(({ npc }) => !npc.dead && npc.faction === Faction.ENEMY).map(({ npc, spec }) => {
        const weapon = npc.rangedWeaponId ? WEAPONS[npc.rangedWeaponId] : undefined
        // Native garrison boards on battle release: account for its mounted bow before takeoff.
        const mountedRange = spec.eagle ? eagleBowEngagementRange('xongkoro', weapon) : undefined
        return { x: spec.eagle?.home.x ?? npc.combatPosition.x, z: spec.eagle?.home.z ?? npc.combatPosition.z,
          range: Math.max(npc.maxRangedAttackDistance, mountedRange ?? 0) }
      })
      this.initialDeployment = planDecapitationDeployment({ navigation: this.navigation,
        obstacles: this.deploymentEnvironment.obstacles, threats: [...threats, ...this.deploymentEnvironment.otherThreats()],
        officialCount: prepared.friendlyActorIds.length, personalCount: groundCount,
        eagleCount: careerEaglePadOwners(profile).length, playerEagle: profile.selectedMountId === 'xongkoro' })
    }
    this.positionPlayerAtPerimeter(prepared)
    const specs = this.positionOfficialRoster(prepared,
      prepared.kind === 'commander-sky-raid' ? createSkyRaidRoster(prepared, this.readProfile().faction)
        : createDecapitationRoster(prepared, this.readProfile().faction))
    const dead = new Set(prepared.deadFriendlyActorIds ?? [])
    const batch = this.scheduler.batch(() => { this.disposeTemporaryActors(); this.spawnBatch = batch })
    this.spawnBatch = batch
    for (const spec of specs) {
      const actorId = spec.actorId!
      if (dead.has(actorId) || prepared.actorHealth?.[actorId]?.hp === 0
        || prepared.officialSquad?.members?.[actorId]?.status === 'dead') continue
      this.plannedPositions.push(new THREE.Vector3(spec.x, getTerrainHeight(spec.x, spec.z), spec.z))
      batch.enqueue(actorId, () => this.materializeOfficial(spec, prepared))
    }
    batch.seal(() => {
      this.plannedPositions.length = 0
      const deployed = this.active ?? prepared
      this.tracker = new BattleStatsTracker(this.events, true, event => acceptsCareerMissionStat(this.active ?? deployed, event),
        deployed.playerStats, careerMissionCommandMeritPolicy(deployed, () => this.active ?? deployed))
      this.objectiveUnsubscribe = this.events.subscribe(event => this.noteObjectiveEvent(event))
      for (const actor of this.officialActors) this.tracker.registerNpc(actor, true)
      if (deployed.commanderMission?.deploymentComplete) this.releaseCombat()
      this.persistRuntimeProgress(true)
    })
    return true
  }

  /** Called by the common flow only after official and personal spawn batches are complete. */
  completeInitialDeployment(): void {
    if (!this.active || this.active.result) return
    if (!this.ready) throw new Error('Commander Town initial roster is not ready')
    this.finalizeDeployment()
    if (!this.active.commanderMission?.deploymentComplete) throw new Error('Commander Town deployment checkpoint could not be saved')
  }

  private finalizeDeployment(): void {
    const active = this.active
    if (!active?.commanderMission || active.commanderMission.deploymentComplete) return
    const next = cloneCareerProfile(this.readProfile())
    if (!next.activeMission?.commanderMission || next.activeMission.id !== active.id) return
    next.activeMission.commanderMission.deploymentComplete = true
    next.activeMission.phase = 'ATTACKING'
    if (!this.commit(next)) return
    this.releaseCombat()
  }

  private releaseCombat(): void {
    for (const resident of this.residents) {
      if (resident.npc.dead) continue
      resident.npc.setMissionCombatTarget(undefined)
      // Native duty and alert state belong to the Town controllers.
    }
    for (const actor of this.officialActors) {
      if (actor.dead || this.isPlayerCommanded(actor)) continue
      actor.setMissionCombatTarget(undefined)
      actor.setTacticalOrder('attack')
    }
  }

  private prepareNativeRoster(requested: ActiveCareerMission): ActiveCareerMission | null {
    const next = cloneCareerProfile(this.readProfile())
    const mission = next.activeMission
    if (!mission || mission.id !== requested.id) return null
    if (mission.kind === 'commander-sky-raid') {
      const eligible = this.residents.filter(resident => resident.spec.role !== 'cat'
        && resident.npc.faction === Faction.ENEMY).map(resident => resident.spec.id)
      if (eligible.length < COMMANDER_SKY_RAID_REQUIRED_KILLS) return null
      if (mission.targetActorIds.some(id => !eligible.includes(id))) return null
      mission.civilianActorIds ??= this.residents.filter(resident => resident.spec.role === 'civilian' || resident.spec.role === 'merchant').map(resident => resident.spec.id)
    } else if (!this.residents.some(resident => resident.spec.id === 'commander' && resident.spec.role === 'commander')) return null
    return this.commit(next) ? next.activeMission! : null
  }

  private restoreNativeActors(active: ActiveCareerMission): void {
    const dead = new Set(active.deadTargetActorIds ?? [])
    for (const resident of this.residents) {
      const actor = resident.npc
      actor.respawnEnabled = false
      actor.setMissionCombatTarget(active.commanderMission?.deploymentComplete ? undefined : null)
      // Autonomous native patrol generations own their own resources, not the objective ledger.
      if (resident.spec.duty === 'patrol') continue
      const health = active.actorHealth?.[actor.combatantId]
      const position = active.actorPositions?.[actor.combatantId]
      if (position) {
        const y = position.y ?? resident.spec.y ?? getTerrainHeight(position.x, position.z)
        const mount = actor.mount ?? resident.homeMount
        if (mount && !mount.dead) { mount.group.position.set(position.x, y, position.z); mount.group.rotation.y = position.yaw }
        actor.group.position.set(position.x, y, position.z); actor.group.rotation.y = position.yaw
      }
      if (health && !actor.dead) actor.restoreCombatHealth(health.hp)
      const mount = actor.mount ?? resident.homeMount
      if (mount && health?.mountHp !== undefined) {
        if (health.mountHp <= 0 && !mount.dead) { mount.takeDamage(mount.maxHp + 1); if (actor.mount === mount) actor.dismountFromMount() }
        else if (!mount.dead) mount.currentHp = Math.min(mount.maxHp, health.mountHp)
      }
      if ((dead.has(actor.combatantId) || health?.hp === 0) && !actor.dead) actor.takeDamage(actor.maxHp + 1)
    }
  }

  private positionOfficialRoster(active: ActiveCareerMission, specs: NpcSpawnSpec[]): NpcSpawnSpec[] {
    if (active.kind === 'commander-sky-raid') {
      return specs.map((spec, index) => {
        const squad = index < 25 ? 0 : 1
        const local = index % 25
        const x = (squad === 0 ? -72 : 72) + (local % 5 - 2) * 20
        const z = TOWN_CITY.minZ - 72 - Math.floor(local / 5) * 20
        return { ...spec, x, z }
      })
    }
    return specs.map((spec, index) => {
      const saved = active.officialSquad?.members?.[spec.actorId!]?.position ?? active.actorPositions?.[spec.actorId!]
      const planned = this.initialDeployment?.official[index]
      if (saved || planned) return { ...spec, x: (saved ?? planned!).x, z: (saved ?? planned!).z }
      const row = Math.floor(index / 6), column = index % 6
      return { ...spec, x: (column - 2.5) * 5, z: TOWN_CITY.minZ - 48 - row * 6 }
    })
  }

  private materializeOfficial(spec: NpcSpawnSpec, active: ActiveCareerMission): void {
    const actorId = spec.actorId!
    const npc = trackNpcSpawn(new NPC(this.scene, spec.x, spec.z, spec.faction, spec.characterFaction, spec.aiType,
      spec.name, spec.tier, spec.cavalry, spec.loadout, spec.presetId, spec.squadId, actorId, this.events.emit,
      spec.visualAssetId, spec.combatProfileId, spec.specialCombatProfile, undefined, undefined, undefined, undefined,
      spec.characterTier, spec.heroArchetype))
    npc.respawnEnabled = false
    npc.combatOwnership = 'mission-official'
    const squadId = active.officialSquad && officialActorSquadId(active.officialSquad, actorId)
    if (squadId !== undefined) npc.setCommandSquad(squadId)
    let mount: Mount | undefined
    if (spec.loadout?.mountId) {
      mount = trackNpcSpawn(new Mount(this.scene, mountTypeFromId(spec.loadout.mountId), spec.x, spec.z, undefined, horseVariantForStableKey(actorId)))
      mount.temporaryCombatId = `${actorId}:mount`
      npc.mountVehicle(mount)
      this.enemyMounts.push(mount); this.actorMounts.set(npc, mount)
    }
    const saved = active.officialSquad?.members?.[actorId]
    if (saved) restoreCommandActor(npc, saved, mount)
    else if (active.kind === 'commander-sky-raid' && mount?.flight) {
      const altitude = 50 + ((spec.squadId ?? 1) - 1) * 8
      const y = getTerrainHeight(spec.x, spec.z) + altitude
      mount.group.position.set(spec.x, y, spec.z)
      const yaw = 0
      mount.flight.restore({ phase: 'cruise', yaw, pitch: 0, bank: 0, speed: XONGKORO.cruiseSpeed,
        velocity: { x: 0, y: 0, z: XONGKORO.cruiseSpeed } })
      mount.group.rotation.set(0, yaw, 0)
      npc.setEagleCruiseAltitude(altitude)
      npc.setEagleFlightOrder({ kind: 'hold', cruiseAltitude: altitude })
    }
    const health = active.actorHealth?.[actorId]
    const position = active.actorPositions?.[actorId]
    if (!saved && position) {
      const point = new THREE.Vector3(position.x, getTerrainHeight(position.x, position.z), position.z)
      if (mount) { mount.group.position.copy(point); mount.group.rotation.y = position.yaw }
      npc.group.position.copy(point); npc.group.rotation.y = position.yaw
    }
    if (!saved && !position && this.initialDeployment) {
      npc.group.rotation.y = this.initialDeployment.player.yaw
      if (mount) mount.group.rotation.y = this.initialDeployment.player.yaw
    }
    if (health && !npc.dead) npc.restoreCombatHealth(health.hp)
    if (mount && health?.mountHp !== undefined) {
      if (health.mountHp <= 0) { mount.takeDamage(mount.maxHp + 1); npc.dismountFromMount() }
      else mount.currentHp = Math.min(mount.maxHp, health.mountHp)
    }
    npc.setMissionCombatTarget(active.commanderMission?.deploymentComplete ? undefined : null)
    npc.setTacticalOrder(active.commanderMission?.deploymentComplete ? 'attack' : 'defend')
    this.officialActors.push(npc)
  }

  private positionPlayerAtPerimeter(active: ActiveCareerMission): void {
    if (active.playerDead) return
    const saved = active.commanderMission?.playerPosition
    if (saved) {
      const player = this.player()
      player.group.position.set(saved.x, getTerrainHeight(saved.x, saved.z) + .9, saved.z)
      player.faceDirection(Math.sin(saved.yaw), Math.cos(saved.yaw))
      return
    }
    if (active.commanderMission?.deploymentComplete) return
    const point = this.initialDeployment?.player ?? this.walkable(0, TOWN_CITY.minZ - (active.kind === 'commander-sky-raid' ? 125 : 62))
    const player = this.player()
    player.group.position.set(point.x, getTerrainHeight(point.x, point.z) + .9, point.z)
    const yaw = this.initialDeployment?.player.yaw ?? 0
    player.faceDirection(Math.sin(yaw), Math.cos(yaw))
  }

  private deployAirborne(mount: Mount, x: number, z: number, altitude: number, npc?: NPC): void {
    if (!mount.flight || mount.dead) return
    mount.group.position.set(x, getTerrainHeight(x, z) + altitude, z)
    mount.flight.restore({ phase: 'cruise', yaw: 0, pitch: 0, bank: 0, speed: XONGKORO.cruiseSpeed,
      velocity: { x: 0, y: 0, z: XONGKORO.cruiseSpeed } })
    mount.group.rotation.set(0, 0, 0)
    if (npc) { npc.setEagleCruiseAltitude(altitude); npc.setEagleFlightOrder({ kind: 'hold', cruiseAltitude: altitude }) }
  }

  /** Called during scene setup, before the Player can move; deployment completion
   * never teleports an already controllable mount.
   */
  preparePlayerDeployment(): void {
    const active = this.active
    if (active?.kind !== 'commander-sky-raid' || active.commanderMission?.deploymentComplete || active.playerDead) return
    const player = this.player(), mount = player.currentMount
    if (!mount?.isFlyingMount) return
    this.deployAirborne(mount, 0, TOWN_CITY.minZ - 132, 66)
    player.faceDirection(0, 1)
    player.syncMountTransform()
  }

  private preparePersonalDeployment(npc: NPC): void {
    const active = this.active
    if (active?.kind !== 'commander-sky-raid' || active.commanderMission?.deploymentComplete
      || npc.dead || !npc.mount?.isFlyingMount) return
    const index = Math.max(0, active.personalSquad?.memberIds.indexOf(npc.combatantId) ?? 0)
    const x = -45 + (index % 5) * 18
    const z = TOWN_CITY.minZ - 145 - Math.floor(index / 5) * 20
    this.deployAirborne(npc.mount, x, z, 58, npc)
  }

  private walkable(x: number, z: number): THREE.Vector3 {
    const requested = new THREE.Vector3(x, 0, z)
    const cell = this.navigation.grid.findNearestWalkableCell(requested, 20)
    const point = cell ? this.navigation.grid.cellToWorld(cell) : requested
    point.x = THREE.MathUtils.clamp(point.x, -TOWN_PLAYABLE_WORLD_BOUND + 5, TOWN_PLAYABLE_WORLD_BOUND - 5)
    point.z = THREE.MathUtils.clamp(point.z, -TOWN_PLAYABLE_WORLD_BOUND + 5, TOWN_PLAYABLE_WORLD_BOUND - 5)
    point.y = getTerrainHeight(point.x, point.z)
    return point
  }

  private noteObjectiveEvent(event: CombatEvent): void {
    const active = this.active
    if (!active) return
    const next = cloneCareerProfile(this.readProfile()), mission = next.activeMission
    if (!mission || mission.id !== active.id) return
    if (!recordCommanderObjectiveDeath(mission, event)) return
    this.commit(next)
  }

  updateFlow(_dt: number, _cameraYaw: number): void {
    if (!this.ready) return
    this.finalizeDeployment()
    if (!this.active?.commanderMission?.deploymentComplete) return
    this.checkpoint.advance(_dt)
    this.saveProgress(false)
  }

  evaluate(playerDead: boolean, personalAlive = 0): CareerMissionOutcome | null {
    const active = this.active
    if (!this.ready || !active?.commanderMission?.deploymentComplete || active.result) return null
    const friendlyAlive = this.officialActors.filter(actor => !actor.dead).length + personalAlive
    if (active.kind === 'commander-sky-raid') {
      const kills = new Set(active.deadTargetActorIds ?? []).size
      return resolveCareerMissionOutcome(playerDead, active.targetActorIds.length >= COMMANDER_SKY_RAID_REQUIRED_KILLS,
        Math.max(0, COMMANDER_SKY_RAID_REQUIRED_KILLS - kills), friendlyAlive, kills >= COMMANDER_SKY_RAID_REQUIRED_KILLS)
    }
    const targetAlive = this.targetResidents.some(actor => !actor.dead)
    return resolveCareerMissionOutcome(playerDead, this.targetResidents.length === 1, targetAlive ? 1 : 0, friendlyAlive, !targetAlive)
  }

  snapshot(): BattleStatsSnapshot {
    for (const actor of this.personalActors()) this.tracker?.registerNpc(actor, true)
    return this.tracker?.snapshot([...this.residents.map(resident => resident.npc), ...this.fieldNpcs, ...this.personalActors()], this.player()) ?? {
      player: { damageDealt: 0, damageTaken: 0, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: !this.player().dead }, squads: [],
    }
  }

  freezeStats(): void { this.tracker?.freeze() }
  registerPersonalActor(npc: NPC): void {
    this.preparePersonalDeployment(npc)
    this.tracker?.registerNpc(npc, true)
  }
  peersFor(npc: NPC): NPC[] { return townWartimePeers(npc, this.fieldNpcs) }
  noteEffectiveFriendlyDamage(_target: NPC): void {}
  claimCivilianCommand(_npc: NPC): void {}
  returnCivilianCommand(_npc: NPC): void {}

  updateCivilianOrder(npc: NPC): void {
    if (npc.townCategory !== 'civilian' || npc.dead) return
    const distances = this.peersFor(npc).map(target => npc.combatPosition.distanceTo(target.combatPosition))
    if (!this.player().dead) distances.push(npc.combatPosition.distanceTo(this.player().combatPosition))
    const fight = civilianShouldFight(Math.min(Infinity, ...distances), !this.active?.commanderMission?.deploymentComplete)
    if (fight) {
      const enemyFaction = this.readProfile().faction === 'roman' ? 'viking' : 'roman'
      npc.armTownCivilian(civilianWartimeWeapon(enemyFaction))
      if (!this.civilianCombat.has(npc)) npc.setTacticalOrder('attack')
      this.civilianCombat.add(npc)
    }
  }

  private isPlayerCommanded(npc: NPC): boolean {
    const active = this.active, authority = active?.officialSquad
    return Boolean(active && authority?.missionId === active.id && officialCommandIsPlayerControlled(authority, npc.combatantId))
  }
  releasePlayerCommand(npc: NPC): void {
    if (!this.isPlayerCommanded(npc) || npc.dead || !this.officialActors.includes(npc)) return
    this.playerIssuedCommands.add(npc); npc.missionMovement = false; npc.setMissionCombatTarget(undefined)
  }
  returnPlayerCommand(npc: NPC): void {
    if (this.isPlayerCommanded(npc) || npc.dead || !this.officialActors.includes(npc)) return
    this.playerIssuedCommands.delete(npc); npc.missionMovement = false; npc.setMissionCombatTarget(undefined); npc.setTacticalOrder('attack')
  }
  snapshotCommandActor(npc: NPC): ReturnType<typeof snapshotCommandActor> | undefined {
    const active = this.active
    if (!active?.officialSquad?.actorIds.includes(npc.combatantId) || !this.officialActors.includes(npc)) return undefined
    return snapshotCommandActor(npc, this.actorMounts.get(npc))
  }

  persistRuntimeProgress(forceStats = false, mountState?: ActiveCareerMission['mountState']): void {
    this.saveProgress(forceStats, mountState, true)
  }

  /** Early flow saves keep death pending until the post-combat runtime entry succeeds. */
  private saveProgress(forceStats: boolean, mountState?: ActiveCareerMission['mountState'], completeRuntime = false): void {
    const active = this.active
    if (!active || active.result || !this.ready) return
    const player = this.player()
    this.checkpoint.persist(() => {
      const actorHealth = { ...(active.actorHealth ?? {}) }
      const actorPositions = { ...(active.actorPositions ?? {}) }
      const deadTargets = new Set(active.deadTargetActorIds ?? [])
      const deadFriendlies = new Set(active.deadFriendlyActorIds ?? [])
      for (const resident of this.residents) {
        const actor = resident.npc
        if (!active.targetActorIds.includes(actor.combatantId)) continue
        if (active.kind === 'commander-sky-raid' && actor.dead) deadTargets.add(actor.combatantId)
        if (resident.spec.duty === 'patrol') continue
        const mount = actor.mount ?? resident.homeMount
        actorHealth[actor.combatantId] = { hp: actor.dead ? 0 : actor.hp, ...(mount ? { mountHp: mount.dead ? 0 : mount.currentHp } : {}) }
        actorPositions[actor.combatantId] = { x: actor.combatPosition.x, y: actor.combatPosition.y, z: actor.combatPosition.z, yaw: actor.group.rotation.y }
      }
      const authority = active.officialSquad ? { ...active.officialSquad, members: { ...active.officialSquad.members } } : undefined
      for (const actor of this.officialActors) {
        const mount = this.actorMounts.get(actor) ?? actor.mount ?? undefined
        actorHealth[actor.combatantId] = { hp: actor.dead ? 0 : actor.hp, ...(mount ? { mountHp: mount.dead ? 0 : mount.currentHp } : {}) }
        actorPositions[actor.combatantId] = { x: actor.combatPosition.x, z: actor.combatPosition.z, yaw: actor.group.rotation.y }
        if (actor.dead) deadFriendlies.add(actor.combatantId)
        if (authority) authority.members![actor.combatantId] = snapshotCommandActor(actor, mount)
      }
      const playerStats = this.tracker?.checkpoint() ?? active.playerStats
      return { ...active,
        ...(active.commanderMission ? { commanderMission: { ...active.commanderMission,
          playerPosition: { x: player.combatPosition.x, z: player.combatPosition.z, yaw: player.facingYaw } } } : {}),
        ...(authority ? { officialSquad: authority } : {}),
        ...(mountState ? { mountState } : {}), actorHealth, actorPositions,
        deadTargetActorIds: [...deadTargets], deadFriendlyActorIds: [...deadFriendlies],
        playerDead: player.dead || Boolean(active.playerDead), playerHp: player.hp, playerStamina: player.staminaValue,
        ...(playerStats ? { playerStats } : {}),
      }
    }, { immediate: forceStats, periodic: true, force: forceStats,
      deathMissionId: completeRuntime && player.dead ? active.id : undefined })
  }

  cleanupMission(): void {
    for (const resident of this.residents) { resident.npc.setMissionCombatTarget(undefined); resident.npc.endExternalThreat() }
    this.disposeTemporaryActors()
  }

  private disposeTemporaryActors(): void {
    this.spawnBatch?.cancel(); this.spawnBatch = undefined; this.startedMissionId = undefined
    this.objectiveUnsubscribe?.(); this.objectiveUnsubscribe = undefined
    this.tracker?.dispose(); this.tracker = null
    for (const actor of this.officialActors) actor.dispose()
    for (const mount of this.enemyMounts) mount.dispose()
    this.officialActors.length = 0; this.enemyMounts.length = 0; this.plannedPositions.length = 0
    this.actorMounts.clear(); this.playerIssuedCommands.clear(); this.civilianCombat.clear(); this.checkpoint.reset()
    this.initialDeployment = undefined
  }
  dispose(): void { this.disposeTemporaryActors() }
}
