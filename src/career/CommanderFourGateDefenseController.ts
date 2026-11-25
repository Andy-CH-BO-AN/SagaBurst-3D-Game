import * as THREE from 'three'
import type { NpcSpawnSpec } from '../battle/BattleSpawner'
import { officialFollowLocalOffset, returnFollowLocalOffset } from '../battle/FollowOrder'
import { BattleStatsTracker, type BattleStatsSnapshot } from '../combat/BattleStatsTracker'
import { CombatEventStream } from '../combat/CombatAttribution'
import { XONGKORO } from '../movement/XongkoroConfig'
import type { NavigationWorld } from '../navigation/NavigationWorld'
import type { Player } from '../player/Player'
import { WEAPONS } from '../rpg/WeaponDatabase'
import type { TownCavalryPatrolController } from '../town/TownCavalryPatrolController'
import { TOWN_GATES, type TownGateId } from '../town/TownLayout'
import type { CampaignGateState } from '../campaign/CampaignGate'
import type { FourGateHudSource } from './FourGateDefenseHudModel'
import { isAutonomousTownGuard, isTownEagleRider } from '../town/TownNativeGuardIdentity'
import { isCivilian } from '../town/TownRules'
import type { TownOutskirtsWarfareController } from '../town/TownOutskirtsWarfareController'
import { townWartimePeers } from '../town/TownWartime'
import type { Mount } from '../world/Mount'
import type { NPC } from '../world/NPC'
import { gameplayNpcSpawns, trackNpcSpawn, type NpcSpawnBatch, type NpcSpawnScheduler } from '../world/NpcSpawnScheduler'
import { SpatialGrid } from '../world/SpatialGrid'
import { getTerrainHeight, type EntityCollisionBody } from '../world/Terrain'
import { blocksPlayerSideDefeat, hasAerialCombatPower } from './CaptainEagleBattleOutcome'
import type { CaptainEagleCheckpoint } from './CaptainEagleCheckpoint'
import type { CareerActorFactory } from './CareerActorFactory'
import { restoreCommandActor, snapshotCommandActor } from './CareerCommandActorCheckpoint'
import { officialActorSquadId, officialCommandIsPlayerControlled } from './CareerCommandAuthority'
import { CareerMissionCheckpoint } from './CareerMissionCheckpoint'
import { acceptsCareerMissionStat, careerMissionCommandMeritPolicy, type ActiveCareerMission, type CareerMissionOutcome } from './CareerMissionState'
import type { PersonalActorCheckpoint } from './CareerPersonalSquadMission'
import type { CareerProfile } from './CareerProfile'
import { advanceCommanderCavalryEscort, COMMANDER_CAVALRY_ESCORT, commanderCavalryEscortAssignments, commanderCavalryEscortTarget, createCommanderCavalryEscort, isCommanderCavalryEscorting } from './CommanderCavalryEscort'
import { planCommanderFourGateDefenseDeployment } from './CommanderFourGateDefenseDeployment'
import { COMMANDER_FOUR_GATE_DEFENSE_ENEMIES, COMMANDER_FOUR_GATE_DEFENSE_ENEMY_ROSTER_VERSION, FOUR_GATE_RESERVE_SQUAD, commanderArcherScreenSide, commanderArcherScreenTarget, commanderFourGateDefenseSlots, commanderFourGateGarrisonSlots, createCommanderFourGateDefenseRoster, createCommanderFourGateGarrison, type CommanderEnemyRosterVersion } from './CommanderFourGateDefenseRoster'
import { TOWN_SIEGE_WORLD_EDGE_INSET, townSiegeRampId, withinTownSiegeSector, type TownSiegeRampPlacement } from './TownFourGateSiegePolicy'
import { advanceCommanderFourGateDefenseCombat, advanceCommanderFourGateDefensePreparation, skipCommanderFourGateDefensePreparation, COMMANDER_FOUR_GATE_DEFENSE_SURVIVAL_SECONDS, fourGateRemainingTargets, fourGateTargetsAccounted, recordNativeTownGuardCombat, resolveCommanderFourGateDefenseOutcome } from './CommanderFourGateDefenseState'
import { advanceCommanderInfantryEscort, COMMANDER_INFANTRY_ESCORT, CommanderInfantryWings, commanderInfantryEscortAssignments, commanderInfantryEscortTarget, commanderInfantryWingTarget, createCommanderInfantryEscort, isCommanderInfantryEscorting, moveCommanderInfantryEscort } from './CommanderInfantryEscort'
import type { CommanderTownResident } from './CommanderTownMissionController'
import { TownFourGateSiege, type TownFourGateSiegeOptions, type TownSiegeNavigation, type TownSiegeWorld } from './TownFourGateSiege'

export interface CommanderFourGateDefenseContext {
  world: TownSiegeWorld
  /** Builds each of the eight siege vehicles; production renders them into the Town scene. */
  createRamp: TownFourGateSiegeOptions['createRamp']
  patrol?: TownCavalryPatrolController
  outskirts?: TownOutskirtsWarfareController
  blockers?(): readonly EntityCollisionBody[]
  registerHit: TownFourGateSiegeOptions['registerHit']
  unregisterHit: TownFourGateSiegeOptions['unregisterHit']
}

/** Shelter/muster cells plus everything the siege adapter routes through. */
export type CommanderFourGateNavigation = TownSiegeNavigation & { grid: Pick<NavigationWorld['grid'], 'findNearestWalkableCell' | 'cellToWorld'> }

/** The formal home-Town mission owns deployment and Career transactions. PR7 remains
 * the sole owner of the eight vehicles, passages, convoy, topology and breach events. */
export class CommanderFourGateDefenseController {
  readonly events = new CombatEventStream()
  readonly enemies: NPC[] = []
  readonly enemyMounts: Mount[] = []
  readonly waitingEnemies: NPC[] = []
  readonly groups: { id: typeof TOWN_GATES[number]['id']; members: NPC[]; cavalry: NPC[]; leader: NPC | null }[] = []
  personalActors: () => readonly NPC[] = () => []
  civilianCommandOwns: (npc: NPC) => boolean = () => false
  fourGateSiege?: TownFourGateSiege
  /** Additional wall and gate soldiers in the eight official infantry squads. */
  readonly reinforcements: NPC[] = []
  private state?: NonNullable<ActiveCareerMission['fourGateDefense']>
  private deployment?: ReturnType<typeof planCommanderFourGateDefenseDeployment>
  private roster?: ReturnType<typeof createCommanderFourGateDefenseRoster>
  private readonly actorMounts = new Map<string, Mount>()
  private readonly actorsById = new Map<string, NPC>()
  private readonly playerIssuedCommands = new Set<string>()
  private readonly nativeReturns = new Set<string>()
  private readonly releaseNativeEventBindings: (() => void)[] = []
  private readonly originalSquads = new Map<NPC, NPC['squadId']>()
  private readonly plannedPositions: THREE.Vector3[] = []
  private tracker: BattleStatsTracker | null = null
  private nativeStatsFrozen = false
  private spawnBatch?: NpcSpawnBatch
  private startedMissionId?: string
  private friendlyReady = false
  private preparationElapsed?: number
  private missionElapsed = 0
  private escortAssignments: ReturnType<typeof commanderCavalryEscortAssignments> = []
  private infantryAssignments: ReturnType<typeof commanderInfantryEscortAssignments> = []
  private pendingEscortReleases?: readonly string[]
  private readonly infantryWings = new CommanderInfantryWings()
  private readonly checkpoint = new CareerMissionCheckpoint(() => this.readProfile(), profile => this.commit(profile))
  private cachedFieldNpcs: NPC[] | null = null
  private cachedFieldNpcSet: Set<NPC> | null = null
  private cachedFieldCounts: readonly [number, number, number] = [-1, -1, -1]

  constructor(private readonly actorFactory: CareerActorFactory, private readonly residents: readonly CommanderTownResident[],
    private readonly player: () => Player, private readonly readProfile: () => CareerProfile,
    private readonly commit: (profile: CareerProfile) => boolean, private readonly navigation: CommanderFourGateNavigation,
    private readonly context: CommanderFourGateDefenseContext, private readonly scheduler: NpcSpawnScheduler = gameplayNpcSpawns) {}

  get active(): ActiveCareerMission | undefined {
    const active = this.readProfile().activeMission
    return active?.kind === 'commander-four-gate-defense' ? active : undefined
  }
  get phase() { return this.active?.phase ?? null }
  get assault(): boolean { return false }
  get ready(): boolean { return Boolean(this.startedMissionId && this.spawnBatch?.status !== 'failed') }
  private get attackersReady(): boolean {
    return Boolean(this.startedMissionId && this.fourGateSiege?.ready && this.spawnBatch
      && this.spawnBatch.pending === 0 && (this.spawnBatch.ready || this.spawnBatch.status === 'pending'))
  }
  get combatEnabled(): boolean { return this.attackersReady && this.state?.attackStarted === true && this.active?.phase === 'ATTACKING' && !this.active.result }
  get spawnBatches(): readonly NpcSpawnBatch[] { return this.spawnBatch ? [this.spawnBatch] : [] }
  get preparationRemaining(): number { return this.state?.preparationRemainingSeconds ?? 180 }
  get survivalRemaining(): number { return Math.max(0, COMMANDER_FOUR_GATE_DEFENSE_SURVIVAL_SECONDS - (this.state?.combatElapsedSeconds ?? 0)) }
  get military(): NPC[] {
    const ids = new Set([...(this.active?.friendlyActorIds ?? []), ...(this.active?.fourGateDefense?.autonomousActorIds ?? [])])
    return [...this.residents.filter(r => ids.has(r.spec.id)).map(r => r.npc), ...this.reinforcements]
  }
  get defenders(): NPC[] { return this.military }
  get civilians(): NPC[] { return this.residents.filter(r => isCivilian(r.spec.role)).map(r => r.npc) }
  private invalidateFieldNpcCache(): void {
    this.cachedFieldNpcs = null
    this.cachedFieldNpcSet = null
  }
  private ensureFieldNpcCache(): { list: NPC[]; set: Set<NPC> } {
    const rLen = this.residents.length, rfLen = this.reinforcements.length, eLen = this.enemies.length
    if (!this.cachedFieldNpcs || !this.cachedFieldNpcSet
      || this.cachedFieldCounts[0] !== rLen || this.cachedFieldCounts[1] !== rfLen || this.cachedFieldCounts[2] !== eLen) {
      const list: NPC[] = []
      const set = new Set<NPC>()
      for (const r of this.residents) { list.push(r.npc); set.add(r.npc) }
      for (const npc of this.reinforcements) { list.push(npc); set.add(npc) }
      for (const npc of this.enemies) { list.push(npc); set.add(npc) }
      this.cachedFieldNpcs = list
      this.cachedFieldNpcSet = set
      this.cachedFieldCounts = [rLen, rfLen, eLen]
    }
    return { list: this.cachedFieldNpcs, set: this.cachedFieldNpcSet }
  }
  get fieldNpcs(): NPC[] { return this.ensureFieldNpcCache().list }
  isMissionActor(npc: NPC): boolean { return this.ensureFieldNpcCache().set.has(npc) }
  get playerEnemies(): NPC[] { return this.enemies }
  get civilianDeaths(): number { return this.civilians.filter(npc => npc.dead).length }
  get civilianSurvived(): number { return this.civilians.length - this.civilianDeaths }
  get enemyRosterVersion(): CommanderEnemyRosterVersion { return COMMANDER_FOUR_GATE_DEFENSE_ENEMY_ROSTER_VERSION }
  get enemyTotal(): number { return this.active?.targetActorIds.length ?? COMMANDER_FOUR_GATE_DEFENSE_ENEMIES }
  get remainingEnemies(): number {
    return fourGateRemainingTargets(this.active?.targetActorIds ?? [], this.active?.deadTargetActorIds ?? [], this.enemies)
  }
  get remainingAirAttackers(): number { return 0 }
  get reserveHasCharged(): boolean { return [...this.fourGateSiege?.policy.gates.values() ?? []].some(gate => gate.cavalryEventHandled) }
  get servicesLocked(): boolean { return Boolean(this.active && !this.active.result) }
  get deploymentPositions(): readonly THREE.Vector3[] { return [...this.fieldNpcs.filter(n => !n.dead).map(n => n.combatPosition), ...this.plannedPositions] }
  get personalContribution() { return this.tracker?.commandCheckpoint() }
  get officialContribution() { return this.tracker?.officialCommandCheckpoint() }

  /** HUD 唯讀來源：守軍以部署時的原始城門歸屬（城牆＋地面＋任務守軍）計算，不隨玩家調動改變；
   * 尚未生成的敵軍不在 enemies 內，但仍在 targetActorIds 中，因此不會被當成已死亡。 */
  hudSource(spectating: boolean, gateOf: (id: TownGateId) => { state: CampaignGateState; hpRatio: number } | undefined): FourGateHudSource {
    const friendly = new Set<string>()
    let friendlyAlive = this.player().dead ? 0 : 1
    for (const npc of [...this.military, ...this.personalActors()]) {
      if (npc.dead || friendly.has(npc.combatantId)) continue
      friendly.add(npc.combatantId); friendlyAlive++
    }
    const rosters = this.gateRosters()
    return {
      phase: this.phase, preparationRemaining: this.preparationRemaining, survivalRemaining: this.survivalRemaining, spectating,
      friendlyAlive, enemyAlive: this.remainingEnemies,
      gates: rosters.map(({ gateId, ids, npcs }) => {
        const gate = gateOf(gateId), ramps = this.fourGateSiege?.ramps
        const state = (side: 'left' | 'right') => ramps?.get(`town-siege-ramp:${gateId}:${side}`)?.controller.state
        return { id: gateId, defendersTotal: ids.length, defendersAlive: ids.length - npcs.reduce((n, npc) => n + (npc.dead ? 1 : 0), 0),
          gateState: gate?.state, gateHpRatio: gate?.hpRatio ?? 1, ramps: [state('left'), state('right')] as const }
      }),
    }
  }
  private gateRosterCache?: { gateId: TownGateId; ids: readonly string[]; npcs: NPC[] }[]
  /** 每門原始守軍名冊（部署時固定），NPC 實例只解析一次。 */
  private gateRosters() {
    if (!this.deployment) return []
    const cached = this.gateRosterCache
    if (cached && cached.every(g => g.npcs.length === g.ids.length)) return cached
    // 城牆（wall）與城門地面守軍（cavalry sector）合併為該門原始守軍，依 Actor ID 去重。
    return this.gateRosterCache = this.deployment.sectors.map(sector => {
      const ids = [...new Set([...sector.wallActorIds, ...sector.cavalryActorIds])]
      return { gateId: sector.gateId, ids, npcs: ids.map(id => this.actorsById.get(id)).filter((npc): npc is NPC => Boolean(npc)) }
    })
  }

  startActiveMission(): boolean {
    const active = this.active
    if (!active?.fourGateDefense || active.result) return false
    if (this.startedMissionId === active.id) return this.spawnBatch?.status !== 'failed'
    this.disposeRuntime()
    this.state = structuredClone(active.fourGateDefense)
    // A fresh mission creates both escorts before the enemy arrives.
    if (!this.state.attackStarted && !this.state.siege && this.state.registeredTargetActorIds.length === 0
      && !this.state.cavalryEscort) {
      this.state.cavalryEscort = createCommanderCavalryEscort(active.id)
      this.state.infantryEscort = createCommanderInfantryEscort(active.id)
    }
    this.escortAssignments = commanderCavalryEscortAssignments(active.id)
    this.infantryAssignments = commanderInfantryEscortAssignments(active.id)
    const friendlyIds = new Set(active.friendlyActorIds)
    const native = this.residents.filter(r => friendlyIds.has(r.spec.id))
    // A missing native member is a recoverable deployment error, never permission to shrink the army.
    // The mission garrison is spawned below, never a Town resident.
    const garrisonIds = new Set(commanderFourGateGarrisonSlots(active.id).map(slot => slot.actorId))
    if (new Set(native.map(r => r.spec.id)).size !== active.friendlyActorIds.filter(id => !garrisonIds.has(id)).length) return false
    const nativeById = new Map(native.map(r => [r.spec.id, r]))
    this.deployment = planCommanderFourGateDefenseDeployment(active.id, native.map(r => r.spec),
      this.context.world.fortifications.rampartLayout, this.context.world.obstacles, spec => {
        const npc = nativeById.get(spec.id)!.npc
        return { ranged: npc.hasActiveRangedWeapon,
          spear: npc.meleeWeaponId ? WEAPONS[npc.meleeWeaponId]?.combatKind === 'lance' : false }
      })
    this.roster = createCommanderFourGateDefenseRoster(active.id, this.readProfile().faction === 'roman' ? 'viking' : 'roman',
      this.enemyRosterVersion)
    const targetIds = new Set(active.targetActorIds)
    if (targetIds.size !== this.roster.all.length || this.roster.all.some(spec => !targetIds.has(spec.actorId!))) return false
    this.startedMissionId = active.id
    this.context.patrol?.recallForSiege()
    this.restoreNativeActors(active)
    this.spawnGarrison(active)
    this.tracker = new BattleStatsTracker(this.events, false, event => acceptsCareerMissionStat(this.active ?? active, event),
      active.playerStats, careerMissionCommandMeritPolicy(active, () => this.active ?? active))
    for (const npc of [...this.military, ...this.personalActors()]) this.tracker.registerNpc(npc, true)
    const nativeIds = new Set(this.military.filter(npc => isAutonomousTownGuard(npc.combatantId)).map(npc => npc.combatantId))
    this.releaseNativeEventBindings.push(this.events.subscribe(event => {
      if (!this.state || this.nativeStatsFrozen || !this.combatEnabled) return
      const stats = this.state.nativeCombatStats ??= { damageDealt: 0, damageTaken: 0, kills: 0 }
      recordNativeTownGuardCombat(stats, event, nativeIds, targetIds)
    }))
    if (this.state.phase === 'SPAWNING' || this.state.phase === 'ATTACKING') this.beginAttackers()
    return true
  }

  /** Only called after the zero-second arrival intent is durable. */
  private beginAttackers(): void {
    try { this.createAttackers() }
    catch (error) {
      // Geometry/materialization setup failures use the same visible retry owner
      // as scheduler failures, while the durable SPAWNING checkpoint stays intact.
      this.disposeAttackers()
      const failed = this.scheduler.batch(() => { this.disposeAttackers(); this.spawnBatch = failed })
      this.spawnBatch = failed
      failed.enqueue('four-gate-arrival', () => { throw error })
      failed.seal()
    }
  }

  private createAttackers(): void {
    const active = this.active
    if (!active || !this.state || !this.roster || !this.deployment || this.spawnBatch || this.fourGateSiege) return
    const crewIds = new Set(this.roster!.crew.map(slot => slot.spec.actorId!))
    const cavalryIds = new Set(this.roster!.cavalry.map(spec => spec.actorId!))
    const rangedIds = new Set(this.roster!.archers.map(spec => spec.actorId!))
    const sectors = this.deployment!.sectors.map(sector => ({ ...sector,
      attackerActorIds: this.roster!.ground.filter(spec => this.roster!.gateByActorId.get(spec.actorId!) === sector.gateId).map(spec => spec.actorId!) }))
    this.fourGateSiege = new TownFourGateSiege({ createRamp: this.context.createRamp, world: this.context.world,
      navigation: this.navigation, grid: new SpatialGrid<NPC>(), actors: () => this.fieldNpcs,
      sectors, acceptsOrders: npc => !this.playerIssuedCommands.has(npc.combatantId) && !this.civilianCommandOwns(npc),
      attackerRole: npc => cavalryIds.has(npc.combatantId) ? 'gate-cavalry'
        : rangedIds.has(npc.combatantId) ? 'ranged' : 'siege-infantry', allowMountedRamps: true, approach: 'world-edge',
      // Retain the existing rear room for the escort rows. The swept corridor keeps the
      // 50m clip near the wall (a full sweep proved illegal against real Town obstacles at west:left).
      escortClearance: {
        rear: COMMANDER_INFANTRY_ESCORT.requiredRearClearance, halfWidth: COMMANDER_CAVALRY_ESCORT.halfWidth,
        releaseDistance: COMMANDER_CAVALRY_ESCORT.clearanceEndDistance, bodyRadius: COMMANDER_CAVALRY_ESCORT.bodyRadius,
        lateralOffset: COMMANDER_CAVALRY_ESCORT.lateralOffset,
      },
      externalMovementOwns: npc => this.infantryWings.has(npc.combatantId) || this.isEscorting(npc),
      registerHit: this.context.registerHit, unregisterHit: this.context.unregisterHit, blockers: this.context.blockers,
    }, this.state!.siege)
    this.fourGateSiege.prepare(this.roster!.crew)
    const sectorIds = new Set(this.deployment.sectors.flatMap(s => [...s.wallActorIds, ...s.cavalryActorIds]))
    for (const npc of this.military) {
      if (sectorIds.has(npc.combatantId) && (!npc.dead || !this.state.siege?.actors[npc.combatantId])) this.fourGateSiege.register(npc)
      if (this.playerIssuedCommands.has(npc.combatantId)) this.fourGateSiege.notifyPlayerOrder(npc)
    }
    if (this.state.cavalryEscort) for (const spec of this.roster.cavalry) {
      if (this.state.actors[spec.actorId!]?.position) continue
      const assignment = this.escortAssignments.find(a => a.actorId === spec.actorId)!
      const ramp = this.fourGateSiege.ramps.get(assignment.rampId)!
      const target = commanderCavalryEscortTarget(assignment.slot,
        { x: ramp.surface.startX, z: ramp.surface.startZ }, { x: ramp.surface.dirX, z: ramp.surface.dirZ })
      spec.x = target.x; spec.z = target.z
    }
    for (const spec of this.roster.infantry) {
      if (this.state.actors[spec.actorId!]?.position) continue
      const assignment = this.infantryAssignments.find(a => a.actorId === spec.actorId)!
      const ramp = this.fourGateSiege.ramps.get(assignment.rampId)!
      const target = commanderInfantryEscortTarget(assignment.slot,
        { x: ramp.surface.startX, z: ramp.surface.startZ }, { x: ramp.surface.dirX, z: ramp.surface.dirZ })
      spec.x = target.x; spec.z = target.z
    }
    const archerSlots = new Map(commanderFourGateDefenseSlots(active.id, this.enemyRosterVersion)
      .filter(slot => slot.role === 'archer').map(slot => [slot.actorId, slot.slot]))
    for (const spec of this.roster.archers) {
      if (this.state.actors[spec.actorId!]?.position) continue
      const slot = archerSlots.get(spec.actorId!)!
      const gateId = this.roster.gateByActorId.get(spec.actorId!)!
      const ramp = this.fourGateSiege.ramps.get(townSiegeRampId(gateId, commanderArcherScreenSide(slot)))!
      const anchor = {
        x: ramp.position.x - ramp.surface.dirX * TOWN_SIEGE_WORLD_EDGE_INSET,
        z: ramp.position.z - ramp.surface.dirZ * TOWN_SIEGE_WORLD_EDGE_INSET,
      }
      const target = commanderArcherScreenTarget(slot, anchor, { x: ramp.surface.dirX, z: ramp.surface.dirZ })
      spec.x = target.x; spec.z = target.z
    }
    const occupied = this.roster.crew.map(slot => new THREE.Vector3(slot.spec.x, 0, slot.spec.z))
    for (const spec of [...this.roster.cavalry, ...this.roster.infantry, ...this.roster.archers, ...this.roster.vanguard]) {
      const saved = this.state.actors[spec.actorId!]
      if (saved?.position) { spec.x = saved.position.x; spec.z = saved.position.z; continue }
      // Escort slots are planned with the complete vehicle+mounted rear envelope;
      // do not scatter them through the unrelated archer muster search.
      if (this.state.cavalryEscort && this.roster.cavalry.includes(spec) || this.roster.infantry.includes(spec)) {
        occupied.push(new THREE.Vector3(spec.x, 0, spec.z)); continue
      }
      const point = this.legalGroundPoint(new THREE.Vector3(spec.x, 0, spec.z), occupied, spec.cavalry ? 4 : 2)
      spec.x = point.x; spec.z = point.z; occupied.push(point)
    }
    this.placeInfantryWings(occupied)
    const batch = this.scheduler.batch(() => { this.disposeAttackers(); this.spawnBatch = batch })
    this.spawnBatch = batch; this.startedMissionId = active.id
    for (const spec of this.roster.all) {
      const saved = this.state.actors[spec.actorId!]
      if (saved?.status === 'dead' || active.deadTargetActorIds?.includes(spec.actorId!)) {
        // A rider corpse is accounted by the ledger; its surviving orphan mount is still physical.
        if (saved?.mount && saved.mount.hp > 0 && spec.loadout?.mountId) batch.enqueue(`${spec.actorId}:mount`, () => this.materializeMount(spec, saved))
        continue
      }
      this.plannedPositions.push(new THREE.Vector3(spec.x, spec.spawnY ?? getTerrainHeight(spec.x, spec.z), spec.z))
      batch.enqueue(spec.actorId!, () => this.materializeEnemy(spec, crewIds.has(spec.actorId!)))
    }
    batch.seal(() => {
      if (!this.fourGateSiege?.ready) throw new Error('Four-gate sectors did not finish deployment')
      this.plannedPositions.length = 0
    })
  }

  private placeInfantryWings(occupied: THREE.Vector3[]): void {
    const ramps = this.fourGateSiege!.ramps
    const placements = [...ramps.values()].map(ramp => ramp.placement as TownSiegeRampPlacement)
    const clearances = placements.flatMap(placement => [placement.clearance, placement.escortClearance])
      .filter((box): box is THREE.Box3 => Boolean(box)).map(box => box.clone().expandByScalar(2))
    for (const { slot, formationSlot, spec } of this.roster!.flanks) {
      const id = slot.actorId, saved = this.state!.actors[id]
      if (saved?.status === 'dead') continue
      const side = slot.side!, rampId = townSiegeRampId(slot.gateId, side), { surface } = ramps.get(rampId)!
      if (saved?.position) { spec.x = saved.position.x; spec.z = saved.position.z }
      else {
        const inward = { x: surface.dirX, z: surface.dirZ }
        const rear = { x: surface.startX, z: surface.startZ }
        const p = commanderInfantryWingTarget(formationSlot, side, rear, inward)
        const point = this.legalGroundPoint(new THREE.Vector3(p.x, 0, p.z), occupied, 2, candidate => {
          const dx = candidate.x - rear.x, dz = candidate.z - rear.z
          const behind = -dx * inward.x - dz * inward.z
          const outside = (dz * inward.x - dx * inward.z) * side
          return behind >= 14 && behind <= 33 && outside >= 7 && outside <= 18
            && withinTownSiegeSector(candidate, slot.gateId, 0)
            && clearances.every(box => candidate.x < box.min.x || candidate.x > box.max.x || candidate.z < box.min.z || candidate.z > box.max.z)
        })
        spec.x = point.x; spec.z = point.z; occupied.push(point)
      }
      this.infantryWings.enlist(rampId, id, formationSlot, saved)
    }
  }

  private restoreNativeActors(active: ActiveCareerMission): void {
    const sectorIds = new Set(this.deployment!.sectors.flatMap(s => [...s.wallActorIds, ...s.cavalryActorIds]))
    const officialIds = new Set(active.officialSquad?.actorIds)
    for (const { npc, spec, homeMount } of this.residents) {
      this.releaseNativeEventBindings.push(npc.bindCombatEventSink(this.events.emit))
      this.actorsById.set(spec.id, npc)
      if (homeMount ?? npc.mount) this.actorMounts.set(spec.id, (homeMount ?? npc.mount)!)
      npc.respawnEnabled = false
      if (active.officialSquad && officialIds.has(spec.id) && !isAutonomousTownGuard(spec.id)) {
        this.originalSquads.set(npc, npc.squadId)
        npc.setCommandSquad(officialActorSquadId(active.officialSquad, spec.id)); npc.combatOwnership = 'mission-official'
      }
      const saved = this.state!.actors[spec.id] ?? active.officialSquad?.members?.[spec.id]
      if (saved) restoreCommandActor(npc, saved, homeMount)
      if (active.deadFriendlyActorIds?.includes(spec.id) || active.deadCivilianActorIds?.includes(spec.id)) npc.restoreCombatHealth(0)
      const station = this.deployment!.stations.get(spec.id)
      if (!this.state!.deploymentComplete && !this.state!.actors[spec.id] && station && !npc.dead) {
        const mount = npc.mount
        if (mount) { mount.group.position.set(station.x, station.y, station.z); mount.group.rotation.y = station.yaw }
        npc.group.position.set(station.x, station.y, station.z); npc.group.rotation.y = station.yaw
        npc.setTacticalOrder('defend')
        if (station.kind === 'wall') npc.activateTownRampartGarrison('defend', true)
      }
      if (sectorIds.has(spec.id) && (!npc.dead || !this.state!.siege?.actors[spec.id])) this.fourGateSiege?.register(npc)
      if (!isAutonomousTownGuard(spec.id)
        && (this.state!.siege?.playerCommandedActorIds.includes(spec.id) || saved && this.isPlayerCommanded(npc))) {
        this.playerIssuedCommands.add(spec.id); this.fourGateSiege?.notifyPlayerOrder(npc)
        if (saved?.order === 'follow') this.assignOfficialFollow(npc)
      }
      if (spec.duty === 'watchtower_guard') npc.activateTownRampartGarrison()
      if (station?.kind === 'reserve' && isCivilian(spec.role) && npc.meleeWeaponId) npc.armTownCivilian(npc.meleeWeaponId)
      npc.setMissionCombatTarget(null)
    }
    for (const sector of this.deployment!.sectors) this.groups.push({ id: sector.gateId,
      members: sector.wallActorIds.map(id => this.actorsById.get(id)!).filter(Boolean),
      cavalry: sector.cavalryActorIds.map(id => this.actorsById.get(id)!).filter(Boolean), leader: null })

  }

  /** The mission garrison stands at its planned posts; a saved battle restores its exact bodies. */
  private spawnGarrison(active: ActiveCareerMission): void {
    const sectorIds = new Set(this.deployment!.sectors.flatMap(s => [...s.wallActorIds, ...s.cavalryActorIds]))
    const officialIds = new Set(active.officialSquad?.actorIds)
    for (const spec of createCommanderFourGateGarrison(active.id, this.readProfile().faction)) {
      const id = spec.actorId!, saved = this.state!.actors[id], station = this.deployment!.stations.get(id)!
      spec.x = station.x; spec.z = station.z
      const npc = trackNpcSpawn(this.actorFactory.npc(spec, id, this.events.emit, { y: station.y }))
      npc.enableBattlefieldEngagement()
      npc.respawnEnabled = false
      // Commanded through the gate's official squad, exactly like the native members.
      if (active.officialSquad && officialIds.has(id)) {
        npc.setCommandSquad(officialActorSquadId(active.officialSquad, id)); npc.combatOwnership = 'mission-official'
      }
      if (saved) restoreCommandActor(npc, saved)
      else {
        npc.group.rotation.y = station.yaw
        npc.setTacticalOrder('defend')
        if (station.kind === 'wall') npc.activateTownRampartGarrison('defend', true)
      }
      npc.setMissionCombatTarget(null)
      this.reinforcements.push(npc); this.actorsById.set(id, npc); this.invalidateFieldNpcCache()
      if (sectorIds.has(id) && !npc.dead) this.fourGateSiege?.register(npc)
      if (this.state!.siege?.playerCommandedActorIds.includes(id) || saved && this.isPlayerCommanded(npc)) {
        this.playerIssuedCommands.add(id); this.fourGateSiege?.notifyPlayerOrder(npc)
        if (saved?.order === 'follow') this.assignOfficialFollow(npc)
      }
    }
  }

  private materializeMount(spec: NpcSpawnSpec, saved?: PersonalActorCheckpoint): Mount | undefined {
    if (!spec.loadout?.mountId) return undefined
    const mount = trackNpcSpawn(this.actorFactory.mount(spec.loadout.mountId, spec.x, spec.z, undefined, spec.actorId!))
    mount.temporaryCombatId = `${spec.actorId}:mount`
    this.enemyMounts.push(mount); this.actorMounts.set(spec.actorId!, mount)
    if (saved?.mount) {
      const state = saved.mount, p = state.position
      mount.restoreArmor(state.armorImpactRemaining)
      mount.group.position.set(p.x, p.y ?? getTerrainHeight(p.x, p.z), p.z); mount.group.rotation.y = p.yaw
      if (state.hp <= 0) mount.takeDamage(mount.maxHp + 1)
      else mount.currentHp = Math.min(mount.maxHp, state.hp)
      if (state.flight && mount.flight) mount.flight.restore(state.flight)
    }
    return mount
  }

  private materializeEnemy(spec: NpcSpawnSpec, crew: boolean): void {
    const id = spec.actorId!, saved = this.state!.actors[id]
    const npc = trackNpcSpawn(this.actorFactory.npc(spec, id, this.events.emit, spec.spawnY === undefined ? undefined : { y: spec.spawnY }))
    npc.enableBattlefieldEngagement()
    npc.respawnEnabled = false
    const mount = this.materializeMount(spec)
    if (mount) npc.mountVehicle(mount)
    if (saved) restoreCommandActor(npc, saved, mount)
    else if (mount?.flight) {
      const altitude = XONGKORO.aiCruiseHeight
      const yaw = this.roster!.gateByActorId.get(id) === 'north' ? 0 : this.roster!.gateByActorId.get(id) === 'south' ? Math.PI
        : this.roster!.gateByActorId.get(id) === 'east' ? -Math.PI / 2 : Math.PI / 2
      mount.group.position.y = getTerrainHeight(spec.x, spec.z) + altitude
      mount.group.rotation.y = yaw
      mount.flight.restore({ phase: 'cruise', yaw, pitch: 0, bank: 0, speed: XONGKORO.cruiseSpeed,
        velocity: { x: Math.sin(yaw) * XONGKORO.cruiseSpeed, y: 0, z: Math.cos(yaw) * XONGKORO.cruiseSpeed } })
      npc.setEagleCruiseAltitude(altitude)
    }
    if (!mount?.isFlyingMount) this.fourGateSiege?.register(npc)
    this.enemies.push(npc); this.actorsById.set(id, npc); this.invalidateFieldNpcCache()
    npc.setMissionCombatTarget(null)
    if (!crew && !saved) npc.setTacticalOrder('defend')
    if (mount?.isFlyingMount) npc.setEagleFlightOrder({ kind: 'hold', cruiseAltitude: XONGKORO.aiCruiseHeight })
  }

  /** One atomic deployment acknowledgement; failure leaves the saved mission retryable. */
  completeInitialDeployment(): void {
    if (!this.ready || !this.active || !this.state) throw new Error('Four-gate deployment is incomplete')
    this.friendlyReady = true
    const previous = this.state
    if (previous.phase === 'DEPLOYING') this.state = { ...previous, phase: 'PREPARING' }
    if (!this.saveProgress(true)) { this.state = previous; throw new Error('Four-gate deployment checkpoint could not be saved') }
    if (this.state.attackStarted && this.attackersReady) this.releaseCombat(true)
    for (const npc of this.military) {
      if (npc.formationCommandId === -4801 && !this.isPlayerCommanded(npc)) this.nativeReturns.add(npc.combatantId)
      if (!this.isPlayerCommanded(npc) && this.state.actors[npc.combatantId]?.order === 'defend'
        && !this.state.actors[npc.combatantId]?.formation && !npc.isTownRampartGarrisonActive) this.returnPlayerCommand(npc)
    }
  }

  setPreparationElapsed(seconds: number): void { this.preparationElapsed = seconds }

  /** Ends the remaining PREPARING countdown; the next updateFlow saves SPAWNING and starts the attackers. */
  skipPreparation(): boolean {
    if (!this.ready || !this.friendlyReady || !this.state || !this.active || this.active.result) return false
    const next = skipCommanderFourGateDefensePreparation(this.state)
    if (next === this.state) return false
    this.state = next
    return true
  }

  updateFlow(dt: number, _cameraYaw: number): void {
    const elapsed = this.preparationElapsed ?? dt
    this.preparationElapsed = undefined
    this.missionElapsed = elapsed
    if (!this.ready || !this.friendlyReady || !this.state || !this.active || this.active.result) return
    this.checkpoint.advance(elapsed)
    const previous = this.state
    // Only an already released battle earns this frame. Preparation/loading and
    // the SPAWNING -> ATTACKING transaction cannot consume survival time.
    this.state = advanceCommanderFourGateDefenseCombat(previous, elapsed, this.combatEnabled)
    this.state = advanceCommanderFourGateDefensePreparation(this.state, elapsed, true)
    if (this.state.phase === 'SPAWNING' && previous.phase === 'PREPARING') {
      if (!this.saveProgress(true)) { this.state = { ...previous, preparationRemainingSeconds: 0 }; return }
      this.state = structuredClone(this.active.fourGateDefense!)
      this.beginAttackers()
    }
    if (this.state.phase === 'SPAWNING' && this.attackersReady) {
      const spawning = this.state
      this.state = { ...spawning, phase: 'ATTACKING', attackStarted: true, deploymentComplete: true,
        registeredTargetActorIds: [...this.active.targetActorIds] }
      if (!this.saveProgress(true)) { this.state = spawning; return }
      this.releaseCombat(false)
    }
    this.saveProgress(false)
  }

  updateSiege(dt: number, grid: SpatialGrid<NPC>): void {
    if (!this.combatEnabled) return
    for (const id of this.nativeReturns) {
      const npc = this.actorsById.get(id), station = this.deployment?.stations.get(id)
      if (!npc || npc.dead || !station || this.isPlayerCommanded(npc)) { this.nativeReturns.delete(id); continue }
      if (npc.formationCommandId === -4801 && !npc.isFormationTargetReached(-4801)) continue
      this.nativeReturns.delete(id)
      npc.setTacticalOrder('defend')
      if (station.kind === 'reserve') { npc.setMissionCombatTarget(null); continue }
      const gate = this.fourGateSiege!.policy.gates.get(station.gateId)!
      if (station.kind === 'wall') {
        npc.activateTownRampartGarrison('defend', true)
        if (gate.wallEventHandled) { npc.releaseOutpostRampartGarrison(); npc.setTacticalOrder('attack') }
        npc.setMissionCombatTarget(undefined)
      } else if (gate.cavalryEventHandled) { npc.setMissionCombatTarget(undefined); npc.setTacticalOrder('charge') }
    }
    this.fourGateSiege!.setGrid(grid)
    this.fourGateSiege!.update(dt)
    this.updateCavalryEscort(this.missionElapsed)
    this.updateInfantryEscort(this.missionElapsed)
    const siege = this.fourGateSiege!
    this.infantryWings.update(siege.ramps, id => this.actorsById.get(id), (npc, rampId) => siege.resumeExternalMovement(npc, rampId))
  }

  isEscorting(npc: NPC): boolean {
    return !npc.dead && (isCommanderCavalryEscorting(this.state?.cavalryEscort, npc.combatantId)
      || isCommanderInfantryEscorting(this.state?.infantryEscort, npc.combatantId))
  }

  /** Rear guard of each vehicle: follows its own ramp tail, released only by that ramp (docked/destroyed/abandoned/stalled). */
  private updateInfantryEscort(dt: number): void {
    const previous = this.state?.infantryEscort
    if (!previous || !this.fourGateSiege) return
    const actors = new Map(this.enemies.map(npc => [npc.combatantId, { dead: npc.dead }]))
    for (const assignment of this.infantryAssignments) if (!actors.has(assignment.actorId)
      && this.state!.actors[assignment.actorId]?.status === 'dead') actors.set(assignment.actorId, { dead: true })
    const ramps = new Map([...this.fourGateSiege.ramps].map(([id, ramp]) => [id, {
      state: ramp.controller.state, position: ramp.position,
      distance: ramp.controller.distance, alivePushers: ramp.controller.alivePushers }]))
    const advanced = advanceCommanderInfantryEscort(previous, dt, actors, ramps)
    this.state!.infantryEscort = advanced.checkpoint
    if (advanced.releasedActorIds.length) {
      // Same one-shot receipt transaction as the cavalry; a failed save restores the previous owner.
      this.pendingEscortReleases = [...(this.pendingEscortReleases ?? []), ...advanced.releasedActorIds]
      const saved = this.saveProgress(true)
      this.pendingEscortReleases = undefined
      if (!saved) this.state!.infantryEscort = previous
      else for (const id of advanced.releasedActorIds) {
        const npc = this.actorsById.get(id)
        if (!npc || npc.dead) continue
        npc.missionMovement = false; npc.setMissionCombatTarget(undefined); npc.setTacticalOrder('charge')
        this.fourGateSiege.resumeExternalMovement(npc)
      }
    }
    for (const assignment of this.infantryAssignments) {
      const npc = this.actorsById.get(assignment.actorId)
      if (!npc || npc.dead || !isCommanderInfantryEscorting(this.state!.infantryEscort, assignment.actorId)) continue
      const ramp = this.fourGateSiege.ramps.get(assignment.rampId)
      if (!ramp) continue
      const target = commanderInfantryEscortTarget(assignment.slot,
        { x: ramp.surface.startX, z: ramp.surface.startZ }, { x: ramp.surface.dirX, z: ramp.surface.dirZ })
      const commandId = -5000 - this.infantryAssignments.indexOf(assignment)
      npc.missionMovement = false; npc.setMissionCombatTarget(null); npc.assignSiegeObstacle(null)
      moveCommanderInfantryEscort(npc, ramp, target, commandId, 'defend')
    }
  }

  private updateCavalryEscort(dt: number): void {
    const previous = this.state?.cavalryEscort
    if (!previous || !this.fourGateSiege) return
    const actors = new Map(this.enemies.map(npc => [npc.combatantId, { dead: npc.dead, position: npc.combatPosition }]))
    for (const assignment of this.escortAssignments) if (!actors.has(assignment.actorId)
      && this.state!.actors[assignment.actorId]?.status === 'dead') {
      const saved = this.state!.actors[assignment.actorId].position!
      actors.set(assignment.actorId, { dead: true, position: new THREE.Vector3(saved.x, saved.y ?? 0, saved.z) })
    }
    const ramps = new Map([...this.fourGateSiege.ramps].map(([id, ramp]) => [id, {
      state: ramp.controller.state, position: ramp.position,
      distance: ramp.controller.distance, alivePushers: ramp.controller.alivePushers }]))
    const advanced = advanceCommanderCavalryEscort(previous, dt, actors, ramps, COMMANDER_CAVALRY_ESCORT.releaseDistance)
    this.state!.cavalryEscort = advanced.checkpoint
    if (advanced.releasedActorIds.length) {
      // Stage the one-shot receipt and gate orders together before changing live AI.
      this.pendingEscortReleases = advanced.releasedActorIds
      const saved = this.saveProgress(true)
      this.pendingEscortReleases = undefined
      if (!saved) this.state!.cavalryEscort = previous
      else for (const id of advanced.releasedActorIds) {
        const npc = this.actorsById.get(id)
        if (!npc || npc.dead) continue
        npc.missionMovement = false; npc.setMissionCombatTarget(undefined); npc.setTacticalOrder('charge')
        this.fourGateSiege.resumeExternalMovement(npc)
      }
    }
    for (const assignment of this.escortAssignments) {
      const npc = this.actorsById.get(assignment.actorId)
      if (!npc || !this.isEscorting(npc)) continue
      const ramp = this.fourGateSiege.ramps.get(assignment.rampId)
      if (!ramp) continue
      const target = commanderCavalryEscortTarget(assignment.slot,
        { x: ramp.surface.startX, z: ramp.surface.startZ }, { x: ramp.surface.dirX, z: ramp.surface.dirZ })
      const saved = npc.combatFormationCheckpoint
      const commandId = -4900 - this.escortAssignments.indexOf(assignment)
      npc.missionMovement = false; npc.setMissionCombatTarget(null); npc.assignSiegeObstacle(null)
      // Keep navigation paths between meaningful carrier advances, including reload.
      if (saved?.commandId === commandId && Math.hypot(saved.position.x - target.x, saved.position.z - target.z) < 1) continue
      const position = new THREE.Vector3(target.x, getTerrainHeight(target.x, target.z), target.z)
      const facing = new THREE.Vector3(ramp.surface.dirX, 0, ramp.surface.dirZ)
      const speed = Math.max(.1, ramp.controller.currentSpeed)
      if (!npc.refreshFormationTarget(commandId, position, facing, speed, 'defend')) {
        npc.assignFormationTarget(commandId, position, facing, speed, 'defend')
      }
    }
  }

  private releaseCombat(restoring: boolean): void {
    for (const npc of this.fieldNpcs) {
      if (npc.dead) continue
      if (this.isEscorting(npc) || this.infantryWings.has(npc.combatantId)) { npc.setMissionCombatTarget(null); continue }
      const station = this.deployment?.stations.get(npc.combatantId)
      const cavalryHeld = station?.kind === 'cavalry' && !this.fourGateSiege?.policy.gates.get(station.gateId)?.cavalryEventHandled
        && !this.playerIssuedCommands.has(npc.combatantId)
      const reserveHeld = station?.kind === 'reserve' && !this.playerIssuedCommands.has(npc.combatantId)
      npc.setMissionCombatTarget(cavalryHeld || reserveHeld ? null : undefined)
      if (this.enemies.includes(npc) && !npc.siegeTransport) {
        if (!restoring) npc.setTacticalOrder(npc.hasActiveRangedWeapon ? 'attack' : 'charge')
        if (npc.mount?.isFlyingMount) npc.setEagleFlightOrder(null)
      }
    }
  }

  evaluate(playerDead: boolean, personalAlive = 0): CareerMissionOutcome | null {
    if (!this.combatEnabled || !this.state || !this.active) return null
    const complete = fourGateTargetsAccounted(this.active.targetActorIds, this.state.registeredTargetActorIds,
      this.active.deadTargetActorIds ?? [], this.enemies.map(npc => npc.combatantId))
    const aliveTownPeople = new Set(this.residents
      .filter(r => !r.npc.dead
        && !isTownEagleRider(r.npc.combatantId)
        && r.spec?.duty !== 'eagle_garrison'
        && !r.spec?.eagle
        && !hasAerialCombatPower(r.npc))
      .map(r => r.npc.combatantId)).size + this.reinforcements.filter(npc => !npc.dead).length
    return resolveCommanderFourGateDefenseOutcome(playerDead, complete, this.remainingEnemies,
      aliveTownPeople, personalAlive, this.state.combatElapsedSeconds ?? 0)
  }

  peersFor(npc: NPC): NPC[] { return townWartimePeers(npc, this.fieldNpcs) }
  registerPersonalActor(npc: NPC): void { this.tracker?.registerNpc(npc, true) }
  freezeStats(): void { this.nativeStatsFrozen = true; this.tracker?.freeze() }
  snapshot(): BattleStatsSnapshot {
    for (const npc of this.personalActors()) this.tracker?.registerNpc(npc, true)
    const snapshot = this.tracker?.snapshot([...this.fieldNpcs, ...this.personalActors()], this.player()) ?? {
      player: { damageDealt: 0, damageTaken: 0, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: !this.player().dead }, squads: [] }
    const native = this.military.filter(npc => isAutonomousTownGuard(npc.combatantId))
    return { ...snapshot, nativeDefenders: { startingMembers: native.length, survivors: native.filter(npc => !npc.dead).length,
      casualties: native.filter(npc => npc.dead).length, ...(this.state?.nativeCombatStats ?? { damageDealt: 0, damageTaken: 0, kills: 0 }) } }
  }
  private isPlayerCommanded(npc: NPC): boolean {
    const authority = this.active?.officialSquad
    return Boolean(authority && authority.missionId === this.active?.id && officialCommandIsPlayerControlled(authority, npc.combatantId))
  }
  assignOfficialFollow(npc: NPC): void {
    const authority = this.active?.officialSquad, actorId = npc.combatantId
    const index = authority?.actorIds.indexOf(actorId) ?? -1
    if (index < 0) return
    const mounted = npc.isMounted, hasPersonal = Boolean(this.readProfile().personalSquad?.members.length)
    const reserve = authority?.squads?.find(squad => squad.squadId === FOUR_GATE_RESERVE_SQUAD)
    const localIndex = reserve?.actorIds.indexOf(actorId) ?? -1
    const offset = localIndex >= 0 ? returnFollowLocalOffset(localIndex, reserve!.actorIds.length, mounted)
      : officialFollowLocalOffset(index, mounted, hasPersonal)
    if (localIndex >= 0 && hasPersonal) offset.x += 12
    npc.assignFollowTarget(this.player(), index, offset)
  }
  releasePlayerCommand(npc: NPC): void {
    if (!this.isPlayerCommanded(npc) || npc.dead || this.actorsById.get(npc.combatantId) !== npc) return
    this.nativeReturns.delete(npc.combatantId)
    this.playerIssuedCommands.add(npc.combatantId); this.fourGateSiege?.notifyPlayerOrder(npc)
    npc.releaseOutpostRampartGarrison()
    npc.missionMovement = false; npc.assignSiegeObstacle(null); npc.setMissionCombatTarget(undefined)
  }
  returnPlayerCommand(npc: NPC): void {
    const id = npc.combatantId
    if (this.isPlayerCommanded(npc) || npc.dead || this.actorsById.get(id) !== npc) return
    const station = this.deployment?.stations.get(id)
    if (!station || npc.mount?.isFlyingMount) return
    this.playerIssuedCommands.delete(id); this.fourGateSiege?.notifyPlayerReturn(npc)
    const gate = station.kind === 'reserve' ? undefined : this.fourGateSiege?.policy.gates.get(station.gateId)
    const released = station.kind === 'cavalry' ? gate?.cavalryEventHandled : station.kind === 'wall' && gate?.wallEventHandled
    npc.setMissionCombatTarget(this.combatEnabled && (station.kind === 'wall' || released) ? undefined : null)
    if (this.combatEnabled && released) npc.setTacticalOrder(station.kind === 'cavalry' ? 'charge' : 'attack')
    else {
      this.nativeReturns.add(npc.combatantId)
      npc.assignFormationTarget(-4801, new THREE.Vector3(station.x, station.y, station.z),
        new THREE.Vector3(Math.sin(station.yaw), 0, Math.cos(station.yaw)), undefined, 'defend')
    }
  }
  snapshotCommandActor(npc: NPC): PersonalActorCheckpoint | undefined {
    return this.active?.officialSquad?.actorIds.includes(npc.combatantId)
      ? snapshotCommandActor(npc, this.actorMounts.get(npc.combatantId)) : undefined
  }
  // Slot 0 is governed by official commands. Civilian evacuation cannot take its actors.
  claimCivilianCommand(_npc: NPC): void {}
  returnCivilianCommand(_npc: NPC): void {}
  noteEffectiveFriendlyDamage(_target: NPC): void {}
  updateCivilianOrder(_npc: NPC): void {}

  private legalGroundPoint(requested: THREE.Vector3, occupied: readonly THREE.Vector3[], spacing: number,
    allowed?: (candidate: THREE.Vector3) => boolean): THREE.Vector3 {
    for (let i = 0; i < 120; i++) {
      const radius = Math.floor(i / 12) * 3, angle = i * Math.PI / 6
      const sample = requested.clone().add(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius))
      const cell = this.navigation.grid.findNearestWalkableCell(sample, 2)
      if (!cell) continue
      const point = this.navigation.grid.cellToWorld(cell)
      if (allowed && !allowed(point)) continue
      if (occupied.some(other => Math.hypot(other.x - point.x, other.z - point.z) < spacing)) continue
      if ([...this.fourGateSiege!.ramps.values()].some(ramp => {
        const s = ramp.surface, dx = point.x - s.startX, dz = point.z - s.startZ
        const along = dx * s.dirX + dz * s.dirZ, lateral = dx * s.dirZ - dz * s.dirX
        return along >= -6 && along <= s.length + s.landing + ramp.controller.travelDistance + 4 && Math.abs(lateral) < s.halfWidth + spacing
      })) continue
      point.y = getTerrainHeight(point.x, point.z); return point
    }
    throw new Error(`No legal four-gate attacker muster near (${requested.x.toFixed(1)}, ${requested.z.toFixed(1)})`)
  }

  private playerCheckpoint(): CaptainEagleCheckpoint['player'] {
    const player = this.player(), mount = player.currentMount, position = player.position
    const mountActorId = mount ? [...this.actorMounts].find(([, owned]) => owned === mount)?.[0]
      ?? this.personalActors().find(npc => npc.mount === mount)?.combatantId : undefined
    return { hp: player.hp, stamina: player.staminaValue, dead: player.dead,
      position: { x: position.x, y: position.y, z: position.z, yaw: player.facingYaw },
      ammo: player.arrowCount, shieldImpact: player.shield.shieldImpactRemaining,
      ...(player.isFalling ? { fall: player.fallSnapshot } : {}), ...(mountActorId ? { mountActorId } : {}),
      ...(mount ? { mountHp: mount.dead ? 0 : mount.currentHp, mount: { armorImpactRemaining: mount.armorImpactRemaining, hp: mount.dead ? 0 : mount.currentHp, mounted: true,
        position: { x: mount.group.position.x, y: mount.group.position.y, z: mount.group.position.z, yaw: mount.group.rotation.y },
        ...(mount.flight ? { flight: mount.flight.snapshot() } : {}) } } : {}) }
  }
  preparePlayerDeployment(): void {
    const saved = this.state?.player
    if (!saved) return
    const player = this.player()
    if (!saved.dead) player.setHp(saved.hp)
    player.setStamina(saved.stamina); player.setArrowCount(saved.ammo)
    player.shield.shieldImpactRemaining = Math.min(player.shield.shieldImpactMax, saved.shieldImpact)
    const mount = saved.mountActorId ? this.actorMounts.get(saved.mountActorId)
      ?? this.personalActors().find(npc => npc.combatantId === saved.mountActorId)?.mount : player.currentMount
    if (mount && saved.mount) {
      mount.restoreArmor(saved.mount.armorImpactRemaining)
      const p = saved.mount.position
      if (saved.mount.hp <= 0) { if (!mount.dead) mount.takeDamage(mount.maxHp + 1); player.dismountFromMount() }
      else {
        if (saved.mount.mounted && !saved.dead && player.currentMount !== mount) {
          const owner = this.actorsById.get(saved.mountActorId ?? '') ?? this.personalActors().find(npc => npc.combatantId === saved.mountActorId)
          if (owner?.mount === mount) owner.dismountFromMount()
          if (mount.flight) mount.flight.restore({ phase: 'grounded', yaw: p.yaw, pitch: 0, bank: 0, speed: 0, velocity: { x: 0, y: 0, z: 0 } })
          player.mountVehicle(mount)
        }
        mount.currentHp = Math.min(mount.maxHp, saved.mount.hp)
        mount.group.position.set(p.x, p.y ?? getTerrainHeight(p.x, p.z), p.z); mount.group.rotation.y = p.yaw
        if (saved.mount.flight && mount.flight) mount.flight.restore(saved.mount.flight)
      }
    } else if (!saved.mount && player.currentMount) player.dismountFromMount({ preserveWorldPosition: true })
    const p = saved.position
    player.position.set(p.x, p.y ?? getTerrainHeight(p.x, p.z) + .9, p.z); player.faceDirection(Math.sin(p.yaw), Math.cos(p.yaw))
    if (saved.fall) player.restorePendingFall(saved.fall)
    if (player.currentMount) player.syncMountTransform()
  }

  persistRuntimeProgress(forceStats = false, mountState?: ActiveCareerMission['mountState']): void { this.saveProgress(forceStats, mountState, true) }
  /** Phase transactions and early flow saves cannot acknowledge the later combat frame. */
  private saveProgress(force: boolean, mountState?: ActiveCareerMission['mountState'], completeRuntime = false): boolean {
    const active = this.active
    if (!this.ready || !this.state || !active || active.result) return false
    return this.checkpoint.persist(() => this.snapshotActiveMission(mountState),
      { immediate: force, periodic: true, force,
        deathMissionId: completeRuntime && this.player().dead ? active.id : undefined })
  }

  /** Stage the final frame into the same save transaction as result/reward claim. */
  snapshotActiveMission(mountState?: ActiveCareerMission['mountState']): ActiveCareerMission {
    const active = this.active
    if (!this.ready || !this.state || !active) throw new Error('Four-gate mission is not ready to snapshot')
    const state = structuredClone(this.state!)
    // Partial scheduler work is transient: retain the durable arrival intent until every enemy actor exist.
    if (this.attackersReady) {
      state.siege = this.fourGateSiege!.snapshot()
      state.registeredTargetActorIds = [...active.targetActorIds]
    }
    state.player = this.playerCheckpoint()
    for (const npc of [...this.residents.map(r => r.npc), ...this.reinforcements, ...(this.attackersReady ? this.enemies : []), ...this.personalActors()]) {
      state.actors[npc.combatantId] = snapshotCommandActor(npc, this.actorMounts.get(npc.combatantId))
      const mount = state.actors[npc.combatantId].mount
      if (mount?.hp === 0) mount.mounted = false
    }
    // A saved SPAWNING batch can still be materializing on reload. Keep its
    // native rows synchronized while allies can receive new orders.
    if (state.siege && !this.attackersReady) {
      for (const { npc } of this.residents) {
        const ground = state.siege.actors[npc.combatantId]
        if (ground) Object.assign(ground, state.actors[npc.combatantId])
      }
      state.siege.playerCommandedActorIds = [...this.playerIssuedCommands].filter(id => Boolean(state.siege!.actors[id]))
    }
    if (state.siege) state.siege.playerCommandedActorIds = state.siege.playerCommandedActorIds.filter(id => !isAutonomousTownGuard(id))
    // The durable start transaction includes initial AI intent before any live combat is released.
    // Reload can then retain those orders without replaying the start or gate events.
    if (state.attackStarted && !active.fourGateDefense?.attackStarted) {
      for (const npc of this.enemies) if (!npc.siegeTransport && !npc.dead) {
        const order = this.isEscorting(npc) || this.infantryWings.has(npc.combatantId) ? 'defend' : npc.hasActiveRangedWeapon ? 'attack' : 'charge'
        state.actors[npc.combatantId].order = order
        const ground = state.siege?.actors[npc.combatantId]
        if (ground) ground.order = order
      }
    }
    for (const id of this.pendingEscortReleases ?? []) {
      for (const actor of [state.actors[id], state.siege?.actors[id]]) if (actor && actor.status !== 'dead') {
        actor.order = 'charge'; delete actor.formation
      }
    }
    // Preserve orphan mounts owned by killed riders without creating a second NPC.
    for (const [id, mount] of this.actorMounts) if (state.actors[id]?.status === 'dead') state.actors[id].mount = {
      hp: mount.dead ? 0 : mount.currentHp, mounted: false,
      position: { x: mount.group.position.x, y: mount.group.position.y, z: mount.group.position.z, yaw: mount.group.rotation.y },
      ...(mount.flight ? { flight: mount.flight.snapshot() } : {}) }
    // Capture the reason in the same final-frame transaction as casualties/reward.
    // The store verifies the deadline, living defenders and remaining enemies.
    if (this.evaluate(this.player().dead, this.personalActors().filter(blocksPlayerSideDefeat).length) === 'victory') {
      state.victoryReason = this.remainingEnemies === 0 ? 'elimination' : 'survival'
    } else delete state.victoryReason
    const authority = active.officialSquad ? structuredClone(active.officialSquad) : undefined
    if (authority) {
      authority.members = { ...authority.members }
      for (const npc of this.military) if (authority.actorIds.includes(npc.combatantId)) authority.members[npc.combatantId] = state.actors[npc.combatantId]
      authority.contribution = this.officialContribution ?? authority.contribution
      const contributions = new Map(this.tracker?.officialSquadCheckpoints().map(s => [s.squadId, s.contribution]))
      for (const squad of authority.squads ?? []) squad.contribution = contributions.get(squad.squadId) ?? squad.contribution
    }
    const deadTargets = active.targetActorIds.filter(id => state.actors[id]?.status === 'dead' || active.deadTargetActorIds?.includes(id))
    const playerStats = this.tracker?.checkpoint() ?? active.playerStats
    return { ...active, phase: state.phase, fourGateDefense: state,
      commanderMission: { ...active.commanderMission!, deploymentComplete: state.deploymentComplete },
      ...(authority ? { officialSquad: authority } : {}), ...(mountState ? { mountState } : {}),
      deadTargetActorIds: deadTargets, deadFriendlyActorIds: this.military.filter(n => n.dead && active.friendlyActorIds.includes(n.combatantId)).map(n => n.combatantId),
      deadCivilianActorIds: this.civilians.filter(n => n.dead).map(n => n.combatantId),
      civilianActorIds: this.civilians.map(n => n.combatantId), playerDead: this.player().dead || active.playerDead,
      playerHp: this.player().hp, playerStamina: this.player().staminaValue, ...(playerStats ? { playerStats } : {}) }
  }

  cleanupMission(): void {
    this.disposeRuntime()
    for (const [npc, squad] of this.originalSquads) { npc.setCommandSquad(squad); npc.combatOwnership = undefined }
    this.originalSquads.clear()
    for (const { npc } of this.residents) { npc.setMissionCombatTarget(undefined); npc.missionMovement = false; npc.assignSiegeObstacle(null); npc.endExternalThreat() }
    this.context.patrol?.releaseSiegeOwnership(); this.context.outskirts?.releaseSiegeOwnership()
  }
  /** Co-op guest: the host simulates the attack; this page's own vehicles and attackers give way to its mirror. */
  releaseForCoopGuest(): void { this.disposeAttackers() }
  private disposeAttackers(): void {
    this.spawnBatch?.cancel(); this.spawnBatch = undefined
    this.fourGateSiege?.dispose(); this.fourGateSiege = undefined
    for (const npc of this.enemies) { this.actorsById.delete(npc.combatantId); this.actorMounts.delete(npc.combatantId); npc.dispose() }
    for (const mount of this.enemyMounts) mount.dispose()
    this.enemies.length = 0; this.enemyMounts.length = 0; this.plannedPositions.length = 0
    this.invalidateFieldNpcCache()
    this.infantryWings.clear()
  }
  private disposeRuntime(): void {
    this.disposeAttackers(); this.startedMissionId = undefined; this.friendlyReady = false; this.preparationElapsed = undefined; this.escortAssignments = []; this.infantryAssignments = []; this.pendingEscortReleases = undefined
    this.tracker?.dispose(); this.tracker = null; this.nativeStatsFrozen = false
    for (const release of this.releaseNativeEventBindings.splice(0)) release()
    for (const npc of this.reinforcements) npc.dispose()
    this.reinforcements.length = 0
    this.enemies.length = 0; this.enemyMounts.length = 0; this.groups.length = 0; this.plannedPositions.length = 0
    this.invalidateFieldNpcCache()
    this.gateRosterCache = undefined
    this.actorsById.clear(); this.actorMounts.clear(); this.playerIssuedCommands.clear(); this.nativeReturns.clear(); this.checkpoint.reset()
  }
  dispose(): void { this.disposeRuntime() }
}
