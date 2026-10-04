import * as THREE from 'three'
import { Mount, mountTypeFromId } from '../world/Mount'
import { MountedMissionMarchController } from './MountedMissionMarch'
import { findSafeCareerMountPosition } from './CareerMountController'
import { createSweepRoster, sweepBanditPosition, sweepPlayerSpawn, SWEEP_CENTER, SWEEP_CAPTAIN_START, SWEEP_CHARGE_DISTANCE, SWEEP_DETECTION_RANGE, SWEEP_YAW } from './CavalrySweep'
import { BattleStatsTracker, type BattleStatsSnapshot } from '../combat/BattleStatsTracker'
import { CombatEventStream, type CombatEvent } from '../combat/CombatAttribution'
import { NavigationWorld } from '../navigation/NavigationWorld'
import type { Player } from '../player/Player'
import { PLAYABLE_WORLD_BOUND, getTerrainHeight, isObstaclePathClear } from '../world/Terrain'
import { AIType, Faction, NPC } from '../world/NPC'
import type { TownWorld } from '../town/TownWorld'
import { isCivilian, townSitePoint, type TownActorSpec } from '../town/TownRules'
import { TOWN_MOUNTED_MISSION_MUSTER } from '../town/TownLayout'
import { TOWN_PLAYABLE_WORLD_BOUND } from '../town/TownBounds'
import { selectTownCavalryReserve, type TownCavalryMissionSlot } from '../town/TownCavalryReserve'
import { cloneCareerProfile, type CareerProfile } from './CareerProfile'
import { CareerMissionCheckpoint } from './CareerMissionCheckpoint'
import {
  getRecruitMissionTemplate,
  type RecruitBanditMissionTemplate,
  type RecruitPatrolMissionTemplate,
} from './CareerMissionCatalog'
import { acceptsCareerMissionStat, createActiveCareerMission, resolveCareerMissionOutcome, type ActiveCareerMission, type CareerMissionOutcome, type CareerMissionPhase } from './CareerMissionState'
import { MissionGuide } from './MissionGuide'
import { followLocalOffset, returnFollowLocalOffset } from '../battle/FollowOrder'
import { createVeteranRoster, createVeteranSpawnSpec, getVeteranMissionDefinition, restoreVeteranTownCavalryReserveRoster, type VeteranMissionTemplateId, type VeteranRosterUnit } from './VeteranMission'
import type { MountedMissionSquad } from './MountedMissionMarch'
import type { NpcSpawnSpec } from '../battle/BattleSpawner'

export interface VeteranFieldActorFactories {
  createNpc?: (spec: NpcSpawnSpec, actorId: string) => NPC
  createMount?: (spec: NpcSpawnSpec) => Mount
}

export interface VeteranMissionEnemySquad {
  squadId: number
  leader: NPC
  members: readonly NPC[]
}

interface CampRuntime {
  id: number
  center: THREE.Vector3
  ambient: NPC[]
  mission: NPC[]
}

const BANDIT_LOADOUT = { meleeWeaponId: 'rusty_dagger', rangedWeaponId: null, shieldId: null, mountId: null } as const
const DETECTION_RANGE = 18
const MISSION_LEADER_MARCH_SPEED = 7.5
const LEADER_RETURN_RADIUS = 5
const PLAYER_RETURN_RADIUS = 12
const PERCEPTION_INTERVAL_SECONDS = .2
const VETERAN_SAFE_WORLD_BOUND = TOWN_PLAYABLE_WORLD_BOUND - 20
const VETERAN_ASSEMBLY_RADIUS = 12
const MOUNTED_ASSEMBLY_RATIO = .9
const VETERAN_ASSEMBLY_COMMAND_ID = 9000
const VETERAN_SUPPORT_ENTRY_COMMAND_ID = 9001

export const VETERAN_FIELD_LAYOUT = Object.freeze({
  rally: new THREE.Vector3(TOWN_MOUNTED_MISSION_MUSTER.x, 0, TOWN_MOUNTED_MISSION_MUSTER.z),
  enemy: new THREE.Vector3(TOWN_PLAYABLE_WORLD_BOUND - 28, 0, 20),
  supportApproach: new THREE.Vector3(-288, 0, 0),
  townEntry: new THREE.Vector3(-65, 0, 0),
  scoutRally: new THREE.Vector3(8, 0, TOWN_PLAYABLE_WORLD_BOUND - 40),
  scoutEnemyApproach: new THREE.Vector3(TOWN_PLAYABLE_WORLD_BOUND - 28, 0, 20),
  scoutEnemyCourtyard: new THREE.Vector3(8, 0, 40),
})

export function veteranPlayerYaw(templateId: string): number {
  const survival = templateId === 'veteran-tragedy-of-the-scouts'
  const from = survival ? VETERAN_FIELD_LAYOUT.scoutRally : VETERAN_FIELD_LAYOUT.rally
  const to = survival ? VETERAN_FIELD_LAYOUT.scoutEnemyCourtyard : VETERAN_FIELD_LAYOUT.enemy
  return Math.atan2(to.x - from.x, to.z - from.z)
}

export function veteranPlayerSpawn(templateId: string, anchor?: THREE.Vector3): THREE.Vector3 {
  const survival = templateId === 'veteran-tragedy-of-the-scouts'
  const squadCount = getVeteranMissionDefinition(templateId)?.squadSizes.length ?? 4
  const muster = anchor ?? (survival ? VETERAN_FIELD_LAYOUT.scoutRally : VETERAN_FIELD_LAYOUT.rally)
    .clone().add(veteranSquadOffset(0, squadCount))
  return sweepPlayerSpawn(muster, veteranPlayerYaw(templateId))
}

export function resolveVeteranFieldMissionOutcome(
  templateId: string,
  playerDead: boolean,
  rosterComplete: boolean,
  remainingEnemies: number,
  friendlyAlive: number,
  survivalElapsed: number,
): CareerMissionOutcome | null {
  const definition = getVeteranMissionDefinition(templateId)
  if (!definition) return null
  if (definition.objective.kind === 'survive') {
    if (playerDead && friendlyAlive === 0) return 'failure'
    if (survivalElapsed >= definition.objective.seconds) return playerDead && friendlyAlive === 0 ? 'failure' : 'victory'
    return null
  }
  if (rosterComplete && remainingEnemies === 0) return 'victory'
  if (playerDead && friendlyAlive === 0 && remainingEnemies > 0) return 'failure'
  return null
}

function veteranSquadOffset(index: number, count = 4): THREE.Vector3 {
  return new THREE.Vector3(0, 0, (index - (count - 1) / 2) * 18)
}

export function veteranFieldPosition(
  anchor: THREE.Vector3,
  unit: VeteranRosterUnit,
  slot: number,
  side: 'friendly' | 'enemy',
  squadCount: number,
): THREE.Vector3 {
  const point = anchor.clone().add(veteranSquadOffset(unit.squadId - 1, squadCount))
  const column = slot === 0 ? 0 : ((slot - 1) % 5 - 2)
  const row = slot === 0 ? 0 : Math.floor((slot - 1) / 5) + 1
  point.x += column * 3.2
  point.z += (side === 'friendly' ? 1 : -1) * row * 3.2
  point.y = getTerrainHeight(point.x, point.z)
  return point
}

export function selectLivingMissionLeader<T extends { dead: boolean }>(current: T | null, friendlies: readonly T[]): T | null {
  return current && !current.dead ? current : friendlies.find(npc => !npc.dead) ?? null
}

export function selectMissionInfantryActorIds<T extends { spec: { role: string }; npc: { dead: boolean; combatantId: string } }>(residents: readonly T[], count: number): string[] {
  return residents
    .filter(resident => (resident.spec.role === 'melee_infantry' || resident.spec.role === 'spearman_infantry') && !resident.npc.dead)
    .slice(0, Math.max(0, count))
    .map(resident => resident.npc.combatantId)
}

export function selectMissionCavalryActorIds(
  residents: readonly { spec: TownActorSpec; npc: NPC; homeMount?: Mount }[], count: number,
  unavailableActorIds?: ReadonlySet<string>,
): (string | undefined)[] {
  const roster = createSweepRoster('roman')
  const slots: TownCavalryMissionSlot[] = Array.from({ length: Math.max(0, count) }, (_, slot) => ({
    unitType: roster[slot]?.presetId?.endsWith('_lancer') ? 'lancer' : slot === 29 ? 'horse_archer' : 'sword_cavalry',
    ...(slot === 0 || slot === 29 ? {
      officer: slot === 0 ? 'captain' as const : 'ranger' as const,
      preferredActorId: residents.find(({ spec }) => spec.role === (slot === 0 ? 'captain' : 'ranger'))?.npc.combatantId,
    } : {}),
  }))
  return selectTownCavalryReserve(residents, slots, unavailableActorIds)
}

export function shouldPersistMissionRoute(savedStage: number, currentStage: number, lastStage: number): boolean {
  return Math.abs(currentStage - savedStage) >= 3
    || lastStage >= 0 && currentStage === lastStage && savedStage !== currentStage
}

export class BanditMissionController {
  onMarchStarted: (() => void) | null = null
  onSweepCharge: (() => void) | null = null
  onBorrowMountedActor: ((actorId: string) => void) | null = null
  readonly cavalryMounts: Mount[] = []

  get battlefieldMounts(): Mount[] {
    return [...new Set([...this.cavalryMounts, ...this.fieldActorMounts.values(),
      ...this.borrowedTemporaryMounts.map(entry => entry.mount)].filter((mount): mount is Mount => Boolean(mount)))]
  }
  private readonly temporaryCavalry: { npc: NPC; mount?: Mount }[] = []
  private readonly departingCavalry: { npc: NPC; mount: Mount }[] = []
  private mountedMarch: MountedMissionMarchController | null = null
  private veteranSurvivalElapsed = 0
  private readonly veteranTargetActorIds = new Set<string>()
  private readonly veteranFriendlyActorIds = new Set<string>()
  private readonly borrowedMissionActors = new Set<NPC>()
  private readonly borrowedRespawnEnabled = new Map<NPC, boolean>()
  private readonly borrowedTemporaryMounts: Array<{ npc: NPC; mount: Mount }> = []
  private readonly fieldActorMounts = new Map<string, Mount | null>()
  private readonly veteranEnemies: NPC[] = []
  private readonly veteranEnemySquadList: VeteranMissionEnemySquad[] = []
  private readonly veteranMusterPositions = new Map<string, THREE.Vector3>()
  private readonly veteranSupportEntryPositions = new Map<string, THREE.Vector3>()
  private readonly veteranEnemyTownActorIds = new Set<string>()
  private readonly veteranEnemySquadByActorId = new Map<string, number>()
  private veteranDamageActivationUnsubscribe: (() => void) | null = null
  private veteranPlayerAnchor = VETERAN_FIELD_LAYOUT.rally.clone()
  private veteranMarchTarget = VETERAN_FIELD_LAYOUT.enemy.clone()
  readonly events = new CombatEventStream()
  readonly guide = new MissionGuide()
  readonly camps: CampRuntime[]
  readonly friendlies: NPC[] = []
  private tracker: BattleStatsTracker | null = null
  private leader: NPC | null = null
  private commandId = 1
  private route: THREE.Vector3[] = []
  private routeIndex = 0
  private readonly checkpoint = new CareerMissionCheckpoint(() => this.readProfile(), profile => this.commit(profile))
  private perceptionElapsed = PERCEPTION_INTERVAL_SECONDS

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: TownWorld,
    private readonly navigation: NavigationWorld,
    private readonly missionCaptain: NPC,
    private readonly residents: readonly { spec: TownActorSpec; npc: NPC; homeMount?: Mount }[],
    private readonly player: () => Player,
    private readonly readProfile: () => CareerProfile,
    private readonly commit: (profile: CareerProfile) => boolean,
    private readonly veteranFieldFactories: VeteranFieldActorFactories = {},
  ) {
    this.camps = world.camps.map((camp, id) => ({
      id,
      center: camp.spawnPoints.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / camp.spawnPoints.length),
      ambient: [],
      mission: [],
    }))
    const foreignVeteranField = this.active?.kind === 'veteran-field'
      && this.active.templateId === 'veteran-tragedy-of-the-scouts'
    if (!foreignVeteranField) for (const campId of [0, 2, 4]) this.spawnAmbient(campId, 2)
  }

  get active(): ActiveCareerMission | undefined { return this.readProfile().activeMission }
  get phase(): CareerMissionPhase | null { return this.active?.phase ?? null }
  get missionLeader(): NPC | null { return this.leader }
  get missionBandits(): NPC[] { return this.active?.kind === 'veteran-field' ? this.veteranEnemies : this.camps.flatMap(camp => camp.mission) }
  get veteranEnemySquads(): readonly VeteranMissionEnemySquad[] { return this.veteranEnemySquadList }
  get ambientBandits(): NPC[] { return this.camps.flatMap(camp => camp.ambient) }
  get fieldNpcs(): NPC[] { return this.active?.kind === 'veteran-field' ? [...this.missionBandits, ...this.friendlies] : [...this.ambientBandits, ...this.missionBandits, ...this.friendlies] }
  get survivalElapsedSeconds(): number {
    const definition = this.active?.kind === 'veteran-field' ? getVeteranMissionDefinition(this.active.templateId) : null
    return definition?.objective.kind === 'survive' ? Math.min(definition.objective.seconds, Math.max(0, this.veteranSurvivalElapsed)) : 0
  }
  markVeteranEnemySquadEngaged(squadId: number): boolean {
    const active = this.active
    if (!active || active.kind !== 'veteran-field' || !this.veteranEnemySquadList.some(squad => squad.squadId === squadId)) return false
    if (active.engagedEnemySquadIds?.includes(squadId)) return true
    const engagedEnemySquadIds = [...(active.engagedEnemySquadIds ?? []), squadId].sort((a, b) => a - b)
    return this.checkpoint.persist(() => ({
      ...active,
      engagedEnemySquadIds,
      actorPositions: this.snapshotVeteranActorPositions(),
      actorHealth: this.snapshotVeteranActorHealth(),
    }), { immediate: true })
  }
  get departingNpcs(): NPC[] { return (this.departingCavalry ?? []).map(rider => rider.npc) }
  get remainingEnemies(): number { return this.missionBandits.filter(npc => !npc.dead).length }
  get partyReturned(): boolean {
    if (this.phase !== 'RETURNING') return false
    const living = this.friendlies.filter(npc => !npc.dead)
    if (living.length === 0) return true
    const leader = this.leader && !this.leader.dead ? this.leader : living[0]
    const assembly = this.assemblyPoint()
    return leader.combatPosition.distanceTo(assembly) < LEADER_RETURN_RADIUS
  }
  get playerReturned(): boolean { return this.phase === 'RETURNING' && this.player().combatPosition.distanceTo(this.assemblyPoint()) < PLAYER_RETURN_RADIUS }
  get returnComplete(): boolean { return this.partyReturned && this.playerReturned }

  chooseCamp(preferred: number): number | null {
    const order = [preferred, ...this.camps.map(camp => camp.id).filter(id => id !== preferred)]
    for (const id of order) {
      const camp = this.camps[id]
      const busy = camp.ambient.some(npc => !npc.dead && (npc.inCombat || npc.encounterIsAlerted))
      if (!busy && this.player().combatPosition.distanceTo(camp.center) > 28) return id
    }
    return null
  }

  createMission(template: RecruitBanditMissionTemplate | RecruitPatrolMissionTemplate, campId: number): ActiveCareerMission {
    const enemyCount = template.kind === 'patrol' ? template.encounterBanditCount : template.banditCount
    const friendlySoldiers = Math.max(0, template.friendlyCombatants - 2)
    const available = selectMissionInfantryActorIds(this.residents, friendlySoldiers)
    const mission = createActiveCareerMission(template.id, campId, enemyCount, 0, undefined, template.kind, this.missionCaptain.combatantId)
    mission.friendlyActorIds = [this.missionCaptain.combatantId, ...available]
    return mission
  }

  startActiveMission(): boolean {
    const active = this.active
    if (!active) return false
    if (active.kind === 'veteran-field') {
      if (!getVeteranMissionDefinition(active.templateId)) return false
      this.disposeMissionEntities()
      return this.startVeteranField(active)
    }
    const template = getRecruitMissionTemplate(active.templateId)
    const camp = this.camps[active.targetCampId]
    if (!template || (template.kind === 'town-defense' || template.kind === 'enemy-town-assault') || !camp) return false

    this.disposeMissionEntities()
    if (template.kind === 'cavalry-sweep') return this.startSweep(active, camp)
    this.disposeCamp(camp.ambient)
    camp.ambient = []
    const encounterCenter = template.kind === 'patrol' ? this.patrolEncounterPoint(template, active.id, camp.center) : undefined
    const deadTargets = new Set(active.deadTargetActorIds ?? [])
    active.targetActorIds.forEach((actorId, index) => {
      if (active.result) return
      if (!deadTargets.has(actorId)) camp.mission.push(this.spawnBandit(camp, actorId, index, encounterCenter))
    })
    this.spawnFriendlyParty(active)
    this.tracker = new BattleStatsTracker(this.events, false, event => this.acceptMissionEvent(active, event), active.playerStats)
    for (const friendly of this.friendlies) this.tracker.registerNpc(friendly)
    const routeStage = active.routeStage ?? 0
    if (active.phase === 'RETURNING') {
      const departure = this.marchTarget(template, active, camp.center)
      this.setRoute(this.buildRoute(departure, this.assemblyPoint()), departure, routeStage)
      this.positionPartyForReload(routeStage)
      this.assignLeader(this.assemblyPoint())
      this.assignFollowers()
    } else if (active.phase === 'RESULT' && active.result) {
      const objective = this.marchTarget(template, active, camp.center)
      this.setRoute(this.buildRoute(objective, this.assemblyPoint()), objective)
      this.positionPartyForReload(0)
    } else {
      const objective = this.marchTarget(template, active, camp.center)
      const segmentStart = this.missionSegmentStart(template, active, camp.center)
      this.setRoute(this.buildRoute(segmentStart, objective), segmentStart, routeStage)
      if (active.phase === 'ASSEMBLING') this.assignAssembly()
      else if (active.phase === 'MARCHING') {
        this.positionPartyForReload(routeStage)
        this.assignLeader(objective)
        this.assignFollowers()
      } else if (active.phase === 'ENGAGING') {
        this.positionPartyForReload(this.route.length - 1)
        for (const friendly of this.friendlies) if (!friendly.dead) friendly.setTacticalOrder('charge')
      }
    }
    return true
  }

  updateFlow(dt: number, cameraYaw: number): void {
    if (this.phase === 'RETURNING') {
      this.checkpoint.advance(dt)
      if (this.ensureLivingLeader() && this.leader) this.advanceRoute(this.leader)
      this.persistRuntimeProgress()
      this.guide.update('RETURNING', this.player().combatPosition, cameraYaw, this.assemblyPoint(), this.remainingEnemies, false, this.active?.kind === 'patrol')
      return
    }
    if (this.active?.kind === 'cavalry-sweep') { this.updateSweep(dt, cameraYaw); return }
    if (this.active?.kind === 'veteran-field') { this.updateVeteranField(dt, cameraYaw); return }
    this.perceptionElapsed += Math.max(0, dt)
    if (this.perceptionElapsed >= PERCEPTION_INTERVAL_SECONDS) {
      this.perceptionElapsed = 0
      this.detectCampProximity()
    }
    const active = this.active
    if (!active || active.phase === 'RESULT') { this.guide.hide(); return }
    const camp = this.camps[active.targetCampId]
    const template = getRecruitMissionTemplate(active.templateId)
    if (!camp || !template || (template.kind === 'town-defense' || template.kind === 'enemy-town-assault' || template.kind === 'cavalry-sweep')) return
    this.checkpoint.advance(dt)
    const hasLeader = this.ensureLivingLeader() && Boolean(this.leader)
    const leader = this.leader
    const objective = this.marchTarget(template, active, camp.center)

    if (!hasLeader && !this.player().dead && active.phase === 'ASSEMBLING') this.setPhase('MARCHING')
    if (leader && active.phase === 'ASSEMBLING' && (this.player().dead || this.player().combatPosition.distanceTo(leader.combatPosition) <= 12)) {
      if (this.setPhase('MARCHING')) {
        this.assignLeader(objective)
        this.assignFollowers()
        this.onMarchStarted?.()
      }
    }
    if (leader && this.phase === 'MARCHING') {
      this.advanceRoute(leader)
      const campAlerted = camp.mission.some(npc => npc.encounterIsAlerted)
      if (template.kind === 'patrol') this.updatePatrolMarch(template, camp, leader, campAlerted)
      else if (campAlerted || leader.combatPosition.distanceTo(objective) < 8 && this.partyRegrouped(objective)) {
        if (this.setPhase('ENGAGING')) {
          for (const bandit of camp.mission) if (!bandit.dead) bandit.triggerEncounterAlert()
          for (const friendly of this.friendlies) friendly.setTacticalOrder('charge')
        }
      }
    }
    if (this.phase === 'ENGAGING') {
      for (const friendly of this.friendlies) {
        if (!friendly.dead && friendly.tacticalOrder !== 'charge') friendly.setTacticalOrder('charge')
      }
      if (template.kind === 'patrol' && this.remainingEnemies === 0) {
        if (hasLeader && leader) this.resumePatrol(template, camp, leader)
        else this.resumePlayerOnlyPatrol()
      }
    }
    if (template.kind === 'patrol' && this.phase === 'MARCHING' && !hasLeader && !this.player().dead) this.updatePlayerOnlyPatrol(template, camp)

    this.persistRuntimeProgress()
    const current = this.active ?? active
    const target = this.guideTarget(current, camp.center)
    this.guide.update(current.phase, this.player().combatPosition, cameraYaw, target, this.remainingEnemies, false, current.kind === 'patrol')
  }

  evaluate(playerDead: boolean): CareerMissionOutcome | null {
    const active = this.active
    if (!active || active.phase === 'RESULT' || active.result) return null
    if (active.kind === 'veteran-field') {
      const definition = getVeteranMissionDefinition(active.templateId)
      if (definition?.objective.kind === 'survive' && this.survivalElapsedSeconds >= definition.objective.seconds
        && (active.survivalElapsed ?? 0) < definition.objective.seconds && !this.persistRuntimeProgress(true)) return null
      const current = this.active ?? active
      const accounted = new Set([...this.missionBandits.map(npc => npc.combatantId), ...(current.deadTargetActorIds ?? [])])
      const registrationComplete = current.targetActorIds.every(id => accounted.has(id))
      const friendlyAlive = this.friendlies.reduce((alive, npc) => alive + Number(!npc.dead), 0)
      return resolveVeteranFieldMissionOutcome(current.templateId, playerDead || Boolean(current.playerDead), registrationComplete, this.remainingEnemies, friendlyAlive, this.survivalElapsedSeconds)
    }
    const template = getRecruitMissionTemplate(active.templateId)
    const camp = this.camps[active.targetCampId]
    const patrolComplete = template?.kind !== 'patrol' || Boolean(camp && (active.patrolStage ?? 0) >= this.patrolWaypoints(template, camp.center).length)
    const accountedIds = new Set([
      ...this.missionBandits.map(npc => npc.combatantId),
      ...(active.deadTargetActorIds ?? []),
    ])
    const registrationComplete = active.targetActorIds.length > 0 && active.targetActorIds.every(id => accountedIds.has(id))
    const friendlyIds = new Set(active.friendlyActorIds)
    const friendlyAlive = this.friendlies.filter(npc => friendlyIds.has(npc.combatantId) && !npc.dead).length
    return resolveCareerMissionOutcome(playerDead, registrationComplete, this.remainingEnemies, friendlyAlive, patrolComplete)
  }

  snapshot(): BattleStatsSnapshot {
    return this.tracker?.snapshot(this.fieldNpcs, this.player()) ?? {
      player: { damageDealt: 0, damageTaken: 0, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: !this.player().dead },
      squads: [],
    }
  }

  startReturning(): boolean {
    const active = this.active
    const veteranField = active?.kind === 'veteran-field'
      && getVeteranMissionDefinition(active.templateId)?.objective.kind === 'eliminate-all'
    const template = active ? getRecruitMissionTemplate(active.templateId) : null
    const camp = active ? this.camps[active.targetCampId] : null
    if (!active || (!veteranField && (!template || template.kind === 'town-defense' || template.kind === 'enemy-town-assault' || !camp))) return false
    if (veteranField && (active.result?.outcome !== 'victory' || !active.result.stats.survived || this.player().dead)) return false
    if (!this.setPhase('RETURNING', 0)) return false
    this.mountedMarch = null
    if (!this.ensureLivingLeader() || !this.leader) {
      this.route = []
      this.routeIndex = 0
      return true
    }
    const start = !veteranField && camp && template && (template.kind === 'bandit' || template.kind === 'patrol')
      ? this.marchTarget(template, active, camp.center)
      : this.leader.combatPosition
    this.setRoute(this.buildRoute(start, this.assemblyPoint()), start)
    this.assignLeader(this.assemblyPoint())
    this.assignFollowers()
    return true
  }

  alertGroupFor(target: NPC): void {
    const camp = this.camps.find(candidate => candidate.ambient.includes(target) || candidate.mission.includes(target))
    if (!camp) return
    for (const bandit of [...camp.ambient, ...camp.mission]) bandit.triggerEncounterAlert()
  }

  provokeGroupFor(target: NPC): void {
    if (this.active?.kind === 'cavalry-sweep') { this.alertGroupFor(target); return }
    const camp = this.camps.find(candidate => candidate.ambient.includes(target) || candidate.mission.includes(target))
    if (camp) this.provokeCamp(camp.id)
  }

  provokeCamp(campId: number): void {
    const camp = this.camps[campId]
    if (!camp) return
    for (const bandit of [...camp.ambient, ...camp.mission]) bandit.provokeEncounter()
  }

  isMissionTarget(npc: NPC): boolean {
    return this.active?.kind === 'veteran-field'
      ? this.veteranTargetActorIds.has(npc.combatantId)
      : Boolean(this.active?.targetActorIds.includes(npc.combatantId))
  }

  isAmbientTarget(npc: NPC): boolean { return this.camps.some(camp => camp.ambient.includes(npc)) }

  combatPeersFor(npc: NPC): NPC[] {
    if (this.departingCavalry?.some(rider => rider.npc === npc)) return []
    if (this.active?.kind === 'veteran-field') return this.veteranFriendlyActorIds.has(npc.combatantId)
      ? [...this.friendlies, ...this.missionBandits] : [...this.missionBandits, ...this.friendlies]
    if (this.friendlies.includes(npc)) return [
      ...this.friendlies,
      ...(this.phase === 'ENGAGING' ? this.missionBandits : [...this.ambientBandits, ...this.missionBandits]),
    ]
    const camp = this.camps.find(candidate => candidate.ambient.includes(npc) || candidate.mission.includes(npc))
    if (!camp) return this.fieldNpcs
    return [...camp.ambient, ...camp.mission, ...this.friendlies]
  }

  cleanupMission(campId = this.active?.targetCampId, departTemporaryCavalry = false): void {
    this.disposeMissionEntities(departTemporaryCavalry)
    if (campId !== undefined && this.camps[campId] && this.camps[campId].ambient.length === 0) this.spawnAmbient(campId, 2)
    this.guide.hide()
  }

  dispose(): void {
    this.tracker?.dispose()
    this.tracker = null
    this.disposeMissionEntities()
    for (const rider of this.departingCavalry ?? []) this.disposeCavalry(rider)
    if (this.departingCavalry) this.departingCavalry.length = 0
    for (const camp of this.camps) this.disposeCamp(camp.ambient)
    this.guide.dispose()
  }

  private spawnAmbient(campId: number, count: number): void {
    const camp = this.camps[campId]
    if (!camp) return
    for (let index = 0; index < count; index++) camp.ambient.push(this.spawnBandit(camp, `ambient:${campId}:${index}`, index))
  }

  private spawnBandit(camp: CampRuntime, actorId: string, index: number, encounterCenter?: THREE.Vector3): NPC {
    const source = encounterCenter ?? this.world.camps[camp.id].spawnPoints[index % this.world.camps[camp.id].spawnPoints.length]
    const ring = encounterCenter ? 1 + Math.floor(index / 6) : Math.floor(index / this.world.camps[camp.id].spawnPoints.length)
    const angle = index * 2.399
    const radius = encounterCenter ? 4 + index % 3 * 1.7 : ring * 4
    const x = source.x + Math.sin(angle) * radius
    const z = source.z + Math.cos(angle) * radius
    const npc = new NPC(this.scene, x, z, Faction.BANDIT, 'viking', AIType.MELEE, 'Bandit', 1, false, BANDIT_LOADOUT, undefined, undefined, actorId, this.events.emit)
    npc.respawnEnabled = false
    const origin = encounterCenter ?? camp.center
    npc.configureBanditEncounter(origin, this.banditPatrolRoute(origin, camp.id, index))
    return npc
  }

  private spawnFriendlyParty(active: ActiveCareerMission): void {
    const residentsById = new Map(this.residents.map(resident => [resident.npc.combatantId, resident.npc]))
    for (const actorId of active.friendlyActorIds) {
      const npc = residentsById.get(actorId)
      if (npc) this.friendlies.push(npc)
    }
    const deadFriendlies = new Set(active.deadFriendlyActorIds ?? [])
    for (const friendly of this.friendlies) if (deadFriendlies.has(friendly.combatantId) && !friendly.dead) friendly.takeDamage(999999)
    this.leader = this.friendlies.find(npc => npc.combatantId === this.missionCaptain.combatantId && !npc.dead)
      ?? this.friendlies.find(npc => !npc.dead)
      ?? null
  }

  private acceptMissionEvent(active: ActiveCareerMission, event: CombatEvent): boolean {
    return acceptsCareerMissionStat(active, event)
  }

  private detectCampProximity(): void {
    const player = this.player()
    const observers = [...(player.dead ? [] : [player.combatPosition]), ...this.friendlies.filter(npc => !npc.dead).map(npc => npc.combatPosition)]
    if (observers.length === 0) return
    for (const camp of this.camps) {
      const bandits = [...camp.ambient, ...camp.mission].filter(npc => !npc.dead)
      if (bandits.length === 0) continue
      const detected = bandits.some(bandit => observers.some(observer => (
        observer.distanceTo(bandit.combatPosition) <= DETECTION_RANGE && this.hasLineOfSight(observer, bandit.combatPosition)
      )))
      if (detected) for (const bandit of bandits) if (bandit.encounterAggroState !== 'provoked') bandit.triggerEncounterAlert()
    }
  }

  private hasLineOfSight(from: THREE.Vector3, to: THREE.Vector3): boolean {
    const start = from.clone().add(new THREE.Vector3(0, 1, 0))
    const end = to.clone().add(new THREE.Vector3(0, 1, 0))
    const ray = new THREE.Ray(start, end.clone().sub(start).normalize())
    const distance = start.distanceTo(end)
    return !this.world.obstacles.some(obstacle => {
      const hit = ray.intersectBox(obstacle.box, new THREE.Vector3())
      return Boolean(hit && hit.distanceTo(start) < distance - .8)
    })
  }

  private assemblyPoint(): THREE.Vector3 {
    const point = townSitePoint('barracks', 0, 15)
    return new THREE.Vector3(point.x, getTerrainHeight(point.x, point.z), point.z)
  }

  private assignAssembly(): void {
    const center = this.assemblyPoint()
    for (let index = 0; index < this.friendlies.length; index++) {
      const offset = new THREE.Vector3((index % 3 - 1) * 1.8, 0, Math.floor(index / 3) * 1.8)
      this.friendlies[index].assignFormationTarget(this.commandId++, center.clone().add(offset), new THREE.Vector3(-1, 0, 0), MISSION_LEADER_MARCH_SPEED)
    }
  }

  private assignLeader(target: THREE.Vector3): void {
    this.leader?.assignFormationTarget(this.commandId++, target, target.clone().sub(this.leader?.combatPosition ?? target).setY(0).normalize(), MISSION_LEADER_MARCH_SPEED)
  }

  private assignFollowers(): void {
    if (!this.leader) return
    const followerCount = this.friendlies.filter(npc => npc !== this.leader && !npc.dead).length
    let slot = 0
    for (const follower of this.friendlies) {
      if (follower === this.leader || follower.dead) continue
      const offset = this.phase === 'RETURNING'
        ? returnFollowLocalOffset(slot, followerCount, follower.isMounted)
        : followLocalOffset(slot, follower.isMounted)
      follower.assignFollowTarget(this.leader, slot++, offset, MISSION_LEADER_MARCH_SPEED)
    }
  }

  private ensureLivingLeader(): boolean {
    const fallback = selectLivingMissionLeader(this.leader, this.friendlies)
    if (fallback === this.leader) return true
    if (!fallback) { this.leader = null; return false }
    this.leader = fallback
    if (this.phase === 'MARCHING') {
      const active = this.active
      const camp = this.camps[active?.targetCampId ?? -1]
      const template = active ? getRecruitMissionTemplate(active.templateId) : null
      const objective = active && camp && template && template.kind !== 'town-defense' && template.kind !== 'enemy-town-assault' && template.kind !== 'cavalry-sweep'
        ? this.marchTarget(template, active, camp.center)
        : this.assemblyPoint()
      this.assignLeader(objective)
      this.assignFollowers()
    } else if (this.phase === 'RETURNING') {
      this.assignLeader(this.assemblyPoint())
      this.assignFollowers()
    } else {
      for (const friendly of this.friendlies) if (!friendly.dead) friendly.setTacticalOrder('charge')
    }
    return true
  }

  private setPhase(phase: CareerMissionPhase, routeStage = this.routeIndex, patrolStage = this.active?.patrolStage): boolean {
    const active = this.active
    if (!active) return false
    if (active.phase === phase && (active.patrolStage ?? 0) === (patrolStage ?? 0) && (active.routeStage ?? 0) === routeStage) return true
    return this.checkpoint.persist(() => ({ ...active, phase, routeStage, ...(patrolStage !== undefined ? { patrolStage } : {}),
      ...(active.kind === 'cavalry-sweep' && this.leader && !this.leader.dead ? { mountedMarchPosition: { x: this.leader.combatPosition.x, z: this.leader.combatPosition.z } } : {}),
      ...((active.kind === 'veteran-field' && phase === 'RETURNING') || active.kind === 'cavalry-sweep' ? {
        actorPositions: this.snapshotVeteranActorPositions(),
        actorHealth: this.snapshotVeteranActorHealth(),
        deadTargetActorIds: this.deadActorIds(active.targetActorIds, this.missionBandits, active.deadTargetActorIds),
        deadFriendlyActorIds: this.deadActorIds(active.friendlyActorIds, this.friendlies, active.deadFriendlyActorIds),
        mountedMarchPosition: this.mountedMarchAnchor(active),
      } : {}),
      playerStats: this.tracker?.checkpoint() ?? active.playerStats, targetActorIds: [...active.targetActorIds], friendlyActorIds: [...active.friendlyActorIds] }), { immediate: true })
  }

  private buildRoute(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] {
    this.navigation.beginFrame()
    const result = this.navigation.queryPath(from, to)
    if (result.status !== 'path') return [to.clone()]
    const raw = result.path.map(cell => {
      const point = this.navigation.grid.cellToWorld(cell)
      point.y = getTerrainHeight(point.x, point.z)
      return point
    })
    const route: THREE.Vector3[] = []
    for (const point of raw) {
      if (route.length === 0 || route[route.length - 1].distanceToSquared(point) >= 324) route.push(point)
    }
    if (!route.length || route[route.length - 1].distanceToSquared(to) > 1) route.push(to.clone())
    return route
  }

  private patrolWaypoints(template: RecruitPatrolMissionTemplate, camp: THREE.Vector3): THREE.Vector3[] {
    const via = template.routeId === 'south-road'
      ? [new THREE.Vector3(15, 0, -75), new THREE.Vector3(95, 0, -105)]
      : [new THREE.Vector3(0, 0, 90), new THREE.Vector3(-42, 0, 155)]
    return [...via, camp].map(point => point.clone().setY(getTerrainHeight(point.x, point.z)))
  }

  private patrolEncounterPoint(template: RecruitPatrolMissionTemplate, missionId: string, camp: THREE.Vector3): THREE.Vector3 {
    const candidates = this.patrolWaypoints(template, camp).slice(0, -1)
    const stableIndex = [...missionId].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0) % candidates.length
    return candidates[stableIndex].clone()
  }

  private patrolEncounterStage(template: RecruitPatrolMissionTemplate, missionId: string, camp: THREE.Vector3): number {
    const encounter = this.patrolEncounterPoint(template, missionId, camp)
    return Math.max(0, this.patrolWaypoints(template, camp).findIndex(point => point.distanceToSquared(encounter) < 1))
  }

  private missionSegmentStart(
    template: RecruitBanditMissionTemplate | RecruitPatrolMissionTemplate,
    active: ActiveCareerMission,
    camp: THREE.Vector3,
  ): THREE.Vector3 {
    if (template.kind !== 'patrol') return this.assemblyPoint()
    const objectives = this.patrolWaypoints(template, camp)
    const stage = Math.min(active.patrolStage ?? 0, objectives.length)
    return stage <= 0 ? this.assemblyPoint() : objectives[Math.min(stage - 1, objectives.length - 1)]
  }

  private updatePatrolMarch(template: RecruitPatrolMissionTemplate, camp: CampRuntime, leader: NPC, campAlerted: boolean): void {
    const active = this.active
    if (!active) return
    const objectives = this.patrolWaypoints(template, camp.center)
    const stage = Math.min(active.patrolStage ?? 0, objectives.length)
    if (campAlerted && this.remainingEnemies > 0) {
      if (this.setPhase('ENGAGING', this.routeIndex, stage)) for (const friendly of this.friendlies) if (!friendly.dead) friendly.setTacticalOrder('charge')
      return
    }
    const objective = objectives[stage]
    if (!objective || leader.combatPosition.distanceToSquared(objective) > 64) return
    if (stage === this.patrolEncounterStage(template, active.id, camp.center) && this.remainingEnemies > 0) {
      for (const bandit of camp.mission) if (!bandit.dead) bandit.triggerEncounterAlert()
      if (this.setPhase('ENGAGING', this.routeIndex, stage)) for (const friendly of this.friendlies) if (!friendly.dead) friendly.setTacticalOrder('charge')
      return
    }
    const nextStage = stage + 1
    if (!this.setPhase('MARCHING', 0, nextStage) || nextStage >= objectives.length) return
    const nextObjective = objectives[nextStage]
    this.setRoute(this.buildRoute(leader.combatPosition, nextObjective), leader.combatPosition)
    this.assignLeader(nextObjective)
  }

  private resumePatrol(template: RecruitPatrolMissionTemplate, camp: CampRuntime, leader: NPC): void {
    const active = this.active
    if (!active) return
    const objectives = this.patrolWaypoints(template, camp.center)
    const stage = Math.min(active.patrolStage ?? 0, objectives.length)
    if (!this.setPhase('MARCHING', 0, stage) || stage >= objectives.length) return
    const objective = objectives[stage]
    this.setRoute(this.buildRoute(leader.combatPosition, objective), leader.combatPosition)
    this.assignLeader(objective)
    this.assignFollowers()
  }

  private resumePlayerOnlyPatrol(): void {
    const active = this.active
    if (!active) return
    this.route = []
    this.routeIndex = 0
    this.setPhase('MARCHING', 0, active.patrolStage ?? 0)
  }

  private updatePlayerOnlyPatrol(template: RecruitPatrolMissionTemplate, camp: CampRuntime): void {
    const active = this.active
    if (!active) return
    const objectives = this.patrolWaypoints(template, camp.center)
    const stage = Math.min(active.patrolStage ?? 0, objectives.length)
    const campAlerted = camp.mission.some(npc => npc.encounterIsAlerted)
    if (campAlerted && this.remainingEnemies > 0) {
      this.setPhase('ENGAGING', 0, stage)
      return
    }
    const objective = objectives[stage]
    if (!objective || this.player().combatPosition.distanceToSquared(objective) > 64) return
    if (stage === this.patrolEncounterStage(template, active.id, camp.center) && this.remainingEnemies > 0) {
      for (const bandit of camp.mission) if (!bandit.dead) bandit.triggerEncounterAlert()
      this.setPhase('ENGAGING', 0, stage)
      return
    }
    this.setPhase('MARCHING', 0, stage + 1)
  }

  private setRoute(route: THREE.Vector3[], from: THREE.Vector3, routeStage = 0): void {
    this.route = route.filter((point, index) => index === route.length - 1 || point.distanceToSquared(from) > 16)
    this.routeIndex = Math.min(Math.max(0, routeStage), Math.max(0, this.route.length - 1))
  }

  private advanceRoute(leader: NPC): void {
    const target = this.route[this.routeIndex]
    if (!target) return
    if (leader.combatPosition.distanceToSquared(target) > 16 || this.routeIndex >= this.route.length - 1) return
    this.routeIndex++
  }

  private guideTarget(active: ActiveCareerMission, camp: THREE.Vector3): THREE.Vector3 | null {
    if (active.phase === 'ASSEMBLING') return this.assemblyPoint()
    if (active.phase === 'RETURNING') return this.assemblyPoint()
    const template = getRecruitMissionTemplate(active.templateId)
    if (!template || (template.kind === 'town-defense' || template.kind === 'enemy-town-assault' || template.kind === 'cavalry-sweep')) return camp
    return this.missionObjective(template, active, camp)
  }

  private disposeCamp(group: NPC[]): void { for (const npc of group) npc.dispose() }

  private startVeteranField(active: ActiveCareerMission): boolean {
    const definition = getVeteranMissionDefinition(active.templateId)
    if (!definition || definition.kind !== 'veteran-field') return false
    const templateId = active.templateId as VeteranMissionTemplateId
    const faction = this.readProfile().faction
    const roster = createVeteranRoster(templateId, faction, active.id, active.veteranRosterVersion ?? 1, active.borrowedActorIds)
    restoreVeteranTownCavalryReserveRoster(roster, active)
    if (roster.friendlyTotal !== definition.friendlyCombatants
      || roster.enemyTotal !== definition.enemyCombatants
      || roster.friendly.length + 1 !== roster.friendlyTotal
      || roster.enemy.length !== active.targetActorIds.length
      || roster.friendly.length !== active.friendlyActorIds.length) return false

    const residentsById = new Map(this.residents.map(resident => [resident.npc.combatantId, resident]))
    if (roster.friendly.some(unit => unit.source === 'town' && !residentsById.has(unit.actorId))) return false
    this.veteranSurvivalElapsed = Math.min(definition.objective.kind === 'survive' ? definition.objective.seconds : Infinity,
      Math.max(0, active.survivalElapsed ?? 0))
    this.veteranEnemies.length = 0
    this.veteranTargetActorIds.clear()
    this.veteranFriendlyActorIds.clear()
    this.borrowedMissionActors.clear()
    this.borrowedRespawnEnabled.clear()
    this.borrowedTemporaryMounts.length = 0
    this.fieldActorMounts.clear()
    this.veteranEnemySquadList.length = 0
    this.veteranMusterPositions.clear()
    this.veteranSupportEntryPositions.clear()
    this.veteranEnemyTownActorIds.clear()
    this.veteranEnemySquadByActorId.clear()
    this.friendlies.length = 0

    const deadTargets = new Set(active.deadTargetActorIds ?? [])
    const deadFriendlies = new Set(active.deadFriendlyActorIds ?? [])
    const survival = definition.objective.kind === 'survive'
    if (survival) {
      for (const resident of this.residents) {
        if (resident.npc.faction === Faction.ENEMY && resident.npc.combatantId.startsWith('enemy-town:')
          && !isCivilian(resident.spec.role) && resident.spec.role !== 'cat') {
          this.veteranEnemyTownActorIds.add(resident.npc.combatantId)
        }
      }
    }
    const squadCount = roster.squadSizes.length
    const legacyMarchAnchor = !survival && !active.actorPositions && active.phase !== 'ASSEMBLING' && active.mountedMarchPosition
      ? new THREE.Vector3(
        THREE.MathUtils.clamp(active.mountedMarchPosition.x, -PLAYABLE_WORLD_BOUND + 100, PLAYABLE_WORLD_BOUND - 100),
        0,
        THREE.MathUtils.clamp(active.mountedMarchPosition.z, -PLAYABLE_WORLD_BOUND + 100, PLAYABLE_WORLD_BOUND - 100),
      )
      : null
    const friendlyAnchor = survival ? VETERAN_FIELD_LAYOUT.scoutRally.clone()
      : legacyMarchAnchor ? legacyMarchAnchor.clone().sub(veteranSquadOffset(0, squadCount))
        : VETERAN_FIELD_LAYOUT.rally.clone()
    const enemyAnchor = survival ? VETERAN_FIELD_LAYOUT.scoutEnemyApproach.clone() : VETERAN_FIELD_LAYOUT.enemy.clone()
    this.veteranPlayerAnchor = friendlyAnchor.clone().add(veteranSquadOffset(0, squadCount))
    this.veteranMarchTarget = enemyAnchor.clone()
    const friendlyYaw = survival ? veteranPlayerYaw(active.templateId)
      : Math.atan2(enemyAnchor.x - friendlyAnchor.x, enemyAnchor.z - friendlyAnchor.z)
    const enemyYaw = Math.atan2(friendlyAnchor.x - enemyAnchor.x, friendlyAnchor.z - enemyAnchor.z)
    const friendlySlots = new Map<number, number>()
    const enemySlots = new Map<number, number>()
    const friendlySquadCount = Math.max(1, ...roster.friendly.map(unit => unit.squadId))
    const enemySquadCount = Math.max(1, ...roster.enemy.map(unit => unit.squadId))
    const friendlyUnitsById = new Map(roster.friendly.map(unit => [unit.actorId, unit]))
    const enemyUnitsById = new Map(roster.enemy.map(unit => [unit.actorId, unit]))
    const occupiedMuster: THREE.Vector3[] = []
    const occupiedSupportEntry: THREE.Vector3[] = []
    const occupiedSupportApproach: THREE.Vector3[] = []
    const occupiedEnemy: THREE.Vector3[] = []
    const enemyActivationIds = new Set(active.engagedEnemySquadIds ?? [])

    for (const unit of roster.friendly) {
      const spec = createVeteranSpawnSpec(unit, faction, 'friendly')
      const slot = friendlySlots.get(unit.squadId) ?? 0
      friendlySlots.set(unit.squadId, slot + 1)
      const muster = this.safeMountedMissionSlot(veteranFieldPosition(friendlyAnchor, unit, slot, 'friendly', friendlySquadCount), occupiedMuster)
      const supportEntry = !survival && unit.source !== 'town'
        ? this.safeMountedMissionSlot(veteranFieldPosition(VETERAN_FIELD_LAYOUT.townEntry, unit, slot, 'friendly', friendlySquadCount), occupiedSupportEntry)
        : undefined
      const supportApproach = !survival && unit.source !== 'town'
        ? this.safeMountedMissionSlot(veteranFieldPosition(VETERAN_FIELD_LAYOUT.supportApproach, unit, slot, 'friendly', friendlySquadCount), occupiedSupportApproach, PLAYABLE_WORLD_BOUND - 4)
        : undefined
      const resident = unit.source === 'town' ? residentsById.get(unit.actorId) : undefined
      const saved = this.savedMountedActorPosition(active, unit.actorId)
      const homePosition = resident?.npc.combatPosition.clone()
      const savedSupportPassedEntry = Boolean(saved && supportEntry && saved.position.x >= supportEntry.x - VETERAN_ASSEMBLY_RADIUS)
      const initialPosition = saved?.position
        ?? (legacyMarchAnchor ? muster : resident && !survival ? homePosition! : survival
          ? this.safeMountedMissionSlot(veteranFieldPosition(VETERAN_FIELD_LAYOUT.scoutRally, unit, slot, 'friendly', friendlySquadCount), occupiedSupportApproach)
          : supportApproach ?? muster)
      spec.x = initialPosition.x; spec.z = initialPosition.z
      const npc = resident?.npc ?? this.createVeteranNpc(spec, unit.actorId)
      if (resident) {
        this.borrowMountedMissionActor(npc, spec, unit.tier)
      }
      npc.respawnEnabled = false
      const previousMount = npc.mount
      const mount = unit.mounted ? this.resolveVeteranMount(spec, npc, resident?.homeMount, unit.source !== 'town') : null
      if (resident && mount && mount !== resident.homeMount && mount !== previousMount) {
        this.borrowedTemporaryMounts.push({ npc, mount })
      }
      if (saved || legacyMarchAnchor || !resident || survival) this.positionVeteranActor(npc, mount, initialPosition, saved?.yaw ?? friendlyYaw)
      else if (mount && npc.mount !== mount) {
        const current = npc.group.position.clone()
        current.y = getTerrainHeight(current.x, current.z)
        mount.group.position.copy(current)
        mount.group.rotation.y = npc.group.rotation.y
        npc.mountVehicle(mount)
      }
      this.restoreVeteranActorHealth(npc, mount, active, unit.actorId, deadFriendlies.has(unit.actorId))
      this.fieldActorMounts.set(unit.actorId, mount ?? resident?.homeMount ?? npc.mount)
      this.veteranFriendlyActorIds.add(unit.actorId)
      this.friendlies.push(npc)
      this.veteranMusterPositions.set(unit.actorId, muster)
      if (!survival && active.phase === 'ASSEMBLING' && !npc.dead) {
        const entryStage = Boolean(supportEntry && !savedSupportPassedEntry)
        if (entryStage) this.veteranSupportEntryPositions.set(unit.actorId, supportEntry!)
        npc.assignFormationTarget(entryStage ? VETERAN_SUPPORT_ENTRY_COMMAND_ID : VETERAN_ASSEMBLY_COMMAND_ID,
          entryStage ? supportEntry! : muster,
          new THREE.Vector3(Math.sin(friendlyYaw), 0, Math.cos(friendlyYaw)), mount?.baseSpeed ?? MISSION_LEADER_MARCH_SPEED)
      }
      if (!resident && mount) {
        this.temporaryCavalry.push({ npc, mount })
        this.cavalryMounts.push(mount)
      } else if (!resident) {
        this.temporaryCavalry.push({ npc })
      }
    }

    for (const unit of roster.enemy) {
      this.veteranTargetActorIds.add(unit.actorId)
      if (active.result || deadTargets.has(unit.actorId)) continue
      const spec = createVeteranSpawnSpec(unit, faction, 'enemy')
      const slot = enemySlots.get(unit.squadId) ?? 0
      enemySlots.set(unit.squadId, slot + 1)
      const fallback = veteranFieldPosition(enemyAnchor, unit, slot, 'enemy', enemySquadCount)
      const saved = this.savedMountedActorPosition(active, unit.actorId)
      const position = saved?.position ?? this.safeMountedMissionSlot(fallback, occupiedEnemy)
      spec.x = position.x; spec.z = position.z
      const npc = this.createVeteranNpc(spec, unit.actorId)
      npc.respawnEnabled = false
      const mount = unit.mounted ? this.resolveVeteranMount(spec, npc, undefined, true) : null
      this.positionVeteranActor(npc, mount, position, saved?.yaw ?? enemyYaw)
      this.restoreVeteranActorHealth(npc, mount, active, unit.actorId, false)
      this.fieldActorMounts.set(unit.actorId, mount)
      this.veteranEnemies.push(npc)
      if (mount) {
        this.temporaryCavalry.push({ npc, mount })
        this.cavalryMounts.push(mount)
      } else this.temporaryCavalry.push({ npc })
      if (survival) npc.setTacticalOrder('charge')
      else if (enemyActivationIds.has(unit.squadId)) npc.setTacticalOrder('attack')
    }

    const friendliesBySquad = new Map<number, NPC[]>()
    for (const npc of this.friendlies) {
      const members = friendliesBySquad.get(npc.squadId ?? 0) ?? []
      members.push(npc)
      friendliesBySquad.set(npc.squadId ?? 0, members)
    }
    const squadGroups: MountedMissionSquad[] = roster.squadSizes.map((_, index) => {
      const squadId = index + 1
      const members = friendliesBySquad.get(squadId) ?? []
      return {
        leader: members.find(npc => friendlyUnitsById.get(npc.combatantId)?.leader),
        members,
        leaderOffset: veteranSquadOffset(index, squadCount),
      }
    })
    const enemiesBySquad = new Map<number, NPC[]>()
    for (const npc of this.veteranEnemies) {
      const members = enemiesBySquad.get(npc.squadId ?? 0) ?? []
      members.push(npc)
      enemiesBySquad.set(npc.squadId ?? 0, members)
    }
    for (let squadId = 1; squadId <= enemySquadCount; squadId++) {
      const members = enemiesBySquad.get(squadId) ?? []
      if (!members.length) continue
      const squadLeader = members.find(npc => enemyUnitsById.get(npc.combatantId)?.leader) ?? members[0]
      this.veteranEnemySquadList.push({ squadId, leader: squadLeader, members })
      for (const member of members) this.veteranEnemySquadByActorId.set(member.combatantId, squadId)
    }
    this.leader = squadGroups[0]?.leader ?? this.friendlies.find(npc => !npc.dead) ?? null
    this.tracker = new BattleStatsTracker(this.events, true, event => {
      if (this.acceptMissionEvent(active, event)) return true
      const sourceFriendly = this.veteranFriendlyActorIds.has(event.source.actorId)
      const targetFriendly = this.veteranFriendlyActorIds.has(event.target.targetId)
        || Boolean(event.target.ownerActorId && this.veteranFriendlyActorIds.has(event.target.ownerActorId))
      const sourceTownGuard = this.veteranEnemyTownActorIds.has(event.source.actorId)
      const targetTownGuard = this.veteranEnemyTownActorIds.has(event.target.targetId)
        || Boolean(event.target.ownerActorId && this.veteranEnemyTownActorIds.has(event.target.ownerActorId))
      return sourceFriendly || targetFriendly || sourceTownGuard || targetTownGuard
    }, active.playerStats)
    for (const friendly of this.friendlies) this.tracker.registerNpc(friendly, true)
    this.veteranDamageActivationUnsubscribe?.()
    this.veteranDamageActivationUnsubscribe = this.events.subscribe(event => {
      if (event.type !== 'damage_applied' || event.appliedDamage <= 0) return
      const squadId = this.veteranEnemySquadByActorId.get(event.target.targetId)
        ?? (event.target.ownerActorId ? this.veteranEnemySquadByActorId.get(event.target.ownerActorId) : undefined)
      if (squadId !== undefined) this.markVeteranEnemySquadEngaged(squadId)
    })

    if (active.phase === 'RETURNING') {
      this.mountedMarch = null
      if (this.ensureLivingLeader() && this.leader) {
        const start = this.leader.combatPosition
        this.setRoute(this.buildRoute(start, this.assemblyPoint()), start)
        this.assignLeader(this.assemblyPoint())
        this.assignFollowers()
      }
      return true
    }
    if (active.result) return true

    if (survival) {
      this.mountedMarch = null
      if (active.phase !== 'ENGAGING') this.setPhase('ENGAGING', 0)
      return true
    }
    const chargedSquads = new Set(active.chargedSquadIds ?? [])
    const resumeCharged = active.phase === 'ENGAGING' || chargedSquads.size >= roster.squadSizes.length
    this.mountedMarch = new MountedMissionMarchController(
      this.friendlies, this.veteranMarchTarget,
      onFinished => {
        const current = this.active
        if (!current || current.followVoicePlayed) { onFinished?.(); return }
        const next = cloneCareerProfile(this.readProfile())
        if (next.activeMission) next.activeMission.followVoicePlayed = true
        if (!this.commit(next)) return
        this.onMarchStarted?.()
        onFinished?.()
      },
      () => this.persistVeteranCharge(active, roster.squadSizes.length),
      () => this.onSweepCharge?.(),
      resumeCharged,
      {
        chargeDistance: SWEEP_CHARGE_DISTANCE,
        playFollow: !active.followVoicePlayed,
        marchTarget: this.veteranMarchTarget,
        squads: squadGroups,
        leaderMode: 'independent',
        playerSquadIndex: 0,
      },
    )
    if (resumeCharged || active.phase === 'MARCHING') this.mountedMarch.start()
    return true
  }

  private safeMountedMissionSlot(origin: THREE.Vector3, occupied: THREE.Vector3[], worldBound = VETERAN_SAFE_WORLD_BOUND): THREE.Vector3 {
    const pointClear = (point: THREE.Vector3): boolean => {
      if (Math.abs(point.x) > worldBound || Math.abs(point.z) > worldBound) return false
      const blocked = this.world.obstacles.some(obstacle => {
        const expanded = obstacle.box.clone().expandByScalar(1.05)
        return expanded.containsPoint(new THREE.Vector3(point.x, Math.max(point.y + .8, expanded.min.y), point.z))
      })
      return !blocked && occupied.every(other => Math.hypot(other.x - point.x, other.z - point.z) >= 2.1)
    }
    const ground = origin.clone()
    ground.y = getTerrainHeight(ground.x, ground.z)
    if (pointClear(ground)) {
      occupied.push(ground)
      return ground
    }
    const clear = findSafeCareerMountPosition(ground, this.world.obstacles, occupied)
    if (clear && pointClear(clear)) {
      occupied.push(clear)
      return clear
    }
    for (let ring = 1; ring <= 12; ring++) {
      const radius = 5.6 + ring * 2.4
      for (let index = 0; index < 16; index++) {
        const angle = index / 16 * Math.PI * 2
        const point = new THREE.Vector3(ground.x + Math.sin(angle) * radius, 0, ground.z + Math.cos(angle) * radius)
        point.y = getTerrainHeight(point.x, point.z)
        if (!pointClear(point)) continue
        occupied.push(point)
        return point
      }
    }
    throw new Error('Mounted mission has no clear in-bounds formation slot')
  }

  private savedMountedActorPosition(active: ActiveCareerMission, actorId: string): { position: THREE.Vector3; yaw: number } | undefined {
    const saved = active.actorPositions?.[actorId]
    if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.z) || !Number.isFinite(saved.yaw)
      || saved.x < this.navigation.grid.minX || saved.x > this.navigation.grid.maxX
      || saved.z < this.navigation.grid.minZ || saved.z > this.navigation.grid.maxZ) return undefined
    return { position: new THREE.Vector3(saved.x, getTerrainHeight(saved.x, saved.z), saved.z), yaw: saved.yaw }
  }

  private borrowMountedMissionActor(npc: NPC, spec: NpcSpawnSpec, tier?: NPC['tier']): void {
    this.onBorrowMountedActor?.(npc.combatantId)
    this.borrowedRespawnEnabled.set(npc, this.borrowedRespawnEnabled.get(npc) ?? npc.respawnEnabled)
    this.borrowedMissionActors.add(npc)
    npc.applyTemporaryCombatLoadout(spec.loadout ?? {}, tier, spec.squadId)
  }

  private createVeteranNpc(spec: NpcSpawnSpec, actorId: string): NPC {
    if (this.veteranFieldFactories.createNpc) return this.veteranFieldFactories.createNpc(spec, actorId)
    return new NPC(this.scene, spec.x, spec.z, spec.faction, spec.characterFaction, spec.aiType, spec.name, spec.tier,
      spec.cavalry, spec.loadout, spec.presetId, spec.squadId, actorId, this.events.emit,
      spec.visualAssetId, spec.combatProfileId, spec.specialCombatProfile)
  }

  private resolveVeteranMount(spec: NpcSpawnSpec, npc: NPC, homeMount: Mount | undefined, temporary: boolean): Mount | null {
    const active = this.active
    const savedMountHp = active?.actorHealth?.[npc.combatantId]?.mountHp
    const existing = npc.mount && !npc.mount.dead ? npc.mount : homeMount && !homeMount.dead ? homeMount : null
    const mount = existing ?? (temporary || !homeMount ? this.createVeteranMount(spec) : null)
    if (!mount) return null
    const hp = savedMountHp
    if (hp !== undefined) {
      if (hp <= 0 && !mount.dead) mount.takeDamage(mount.currentHp + 1)
      else if (!mount.dead) mount.currentHp = Math.min(mount.maxHp, hp)
    }
    return mount
  }

  private createVeteranMount(spec: NpcSpawnSpec): Mount {
    if (this.veteranFieldFactories.createMount) return this.veteranFieldFactories.createMount(spec)
    return new Mount(this.scene, mountTypeFromId(spec.loadout?.mountId), spec.x, spec.z)
  }

  private positionVeteranActor(npc: NPC, mount: Mount | null, point: THREE.Vector3, yaw: number): void {
    const position = point.clone(); position.y = getTerrainHeight(point.x, point.z)
    if (npc.mount && npc.mount !== mount) npc.dismountFromMount()
    if (mount && !mount.dead) {
      mount.group.position.copy(position); mount.group.rotation.y = yaw
      if (npc.mount !== mount) npc.mountVehicle(mount)
      npc.group.position.copy(position); npc.group.rotation.y = yaw
    } else {
      npc.group.position.copy(position); npc.group.rotation.y = yaw
    }
  }

  private restoreVeteranActorHealth(npc: NPC, mount: Mount | null, active: ActiveCareerMission, actorId: string, recordedDead: boolean): void {
    const saved = active.actorHealth?.[actorId]
    npc.restoreCombatHealth(recordedDead ? 0 : saved?.hp ?? npc.maxHp)
    if (mount && saved?.mountHp !== undefined && saved.mountHp <= 0 && npc.mount === mount) npc.dismountFromMount()
  }

  private persistVeteranCharge(mission: ActiveCareerMission, squadCount: number): boolean {
    const active = this.active
    if (!active || active.id !== mission.id || active.kind !== 'veteran-field') return false
    const chargedSquadIds = Array.from({ length: squadCount }, (_, index) => index + 1)
    return this.checkpoint.persist(() => ({
      ...active,
      phase: 'ENGAGING',
      chargedSquadIds,
      followVoicePlayed: true,
      deadTargetActorIds: this.deadActorIds(active.targetActorIds, this.missionBandits, active.deadTargetActorIds),
      deadFriendlyActorIds: this.deadActorIds(active.friendlyActorIds, this.friendlies, active.deadFriendlyActorIds),
      actorHealth: this.snapshotVeteranActorHealth(),
      actorPositions: this.snapshotVeteranActorPositions(),
      survivalElapsed: this.veteranSurvivalElapsed,
      mountedMarchPosition: this.mountedMarchAnchor(active),
      playerDead: this.player().dead,
      playerHp: this.player().hp,
      playerStamina: this.player().staminaValue,
      playerStats: this.tracker?.checkpoint() ?? active.playerStats,
    }), { immediate: true })
  }

  private snapshotVeteranActorHealth(): NonNullable<ActiveCareerMission['actorHealth']> {
    const health: NonNullable<ActiveCareerMission['actorHealth']> = {}
    for (const npc of [...this.friendlies, ...this.missionBandits]) {
      const mount = this.fieldActorMounts.get(npc.combatantId) ?? npc.mount
      health[npc.combatantId] = {
        hp: npc.dead ? 0 : npc.hp,
        ...(mount ? { mountHp: mount.dead ? 0 : mount.currentHp } : {}),
      }
    }
    return health
  }

  private snapshotVeteranActorPositions(): NonNullable<ActiveCareerMission['actorPositions']> {
    const positions: NonNullable<ActiveCareerMission['actorPositions']> = {}
    for (const npc of [...this.friendlies, ...this.missionBandits]) {
      positions[npc.combatantId] = { x: npc.combatPosition.x, z: npc.combatPosition.z, yaw: npc.group.rotation.y }
    }
    return positions
  }

  private deadActorIds(ids: readonly string[], npcs: readonly NPC[], previous: readonly string[] = []): string[] {
    const dead = new Set(previous)
    for (const npc of npcs) if (npc.dead) dead.add(npc.combatantId)
    return [...dead].filter(id => ids.includes(id)).sort()
  }

  private mountedMarchAnchor(active: ActiveCareerMission): { x: number; z: number } | undefined {
    const leader = this.leader && !this.leader.dead ? this.leader : this.friendlies.find(npc => !npc.dead)
    return leader ? { x: leader.combatPosition.x, z: leader.combatPosition.z } : active.mountedMarchPosition
  }

  private startSweep(active: ActiveCareerMission, camp: CampRuntime): boolean {
    if (active.targetActorIds.length !== 40 || active.friendlyActorIds.length !== 59) return false
    const residentsById = new Map(this.residents.map(resident => [resident.npc.combatantId, resident]))
    if (active.borrowedActorIds?.some(id => !residentsById.has(id))) return false
    const saved = active.mountedMarchPosition
    const returning = active.phase === 'RETURNING'
    const routeStart = returning ? saved ? new THREE.Vector3(saved.x, 0, saved.z) : SWEEP_CENTER : SWEEP_CAPTAIN_START
    this.setRoute(this.buildRoute(routeStart, returning ? this.assemblyPoint() : SWEEP_CENTER), routeStart, returning ? 0 : active.routeStage ?? 0)
    const anchor = active.phase === 'ASSEMBLING' ? SWEEP_CAPTAIN_START
      : saved ? new THREE.Vector3(saved.x, 0, saved.z)
        : active.phase === 'ENGAGING' || active.result ? SWEEP_CENTER : this.route[this.routeIndex] ?? SWEEP_CAPTAIN_START
    const yaw = active.phase === 'ASSEMBLING' ? SWEEP_YAW : Math.atan2(SWEEP_CENTER.x - anchor.x, SWEEP_CENTER.z - anchor.z)
    active.targetActorIds.forEach((id, index) => {
      if (active.result) return
      if (active.deadTargetActorIds?.includes(id)) return
      const savedEnemy = this.savedMountedActorPosition(active, id)
      const point = savedEnemy?.position ?? sweepBanditPosition(index)
      const npc = new NPC(this.scene, point.x, point.z, Faction.BANDIT, 'viking', AIType.MELEE, 'Bandit', 1, false, BANDIT_LOADOUT, undefined, undefined, id, this.events.emit)
      npc.respawnEnabled = false
      npc.configureBanditEncounter(SWEEP_CENTER, [point], Infinity)
      if (savedEnemy) npc.group.rotation.y = savedEnemy.yaw
      if (active.actorHealth?.[id]) this.restoreVeteranActorHealth(npc, null, active, id, false)
      if (active.sweepAlerted || active.phase === 'ENGAGING') npc.triggerEncounterAlert()
      camp.mission.push(npc)
    })
    const occupiedMuster: THREE.Vector3[] = []
    const occupiedApproach: THREE.Vector3[] = []
    const occupiedEntry: THREE.Vector3[] = []
    const entryRoster = createSweepRoster(this.readProfile().faction, VETERAN_FIELD_LAYOUT.townEntry, Math.PI / 2)
    const legacyRoster = active.phase !== 'ASSEMBLING' ? createSweepRoster(this.readProfile().faction, anchor, yaw) : undefined
    createSweepRoster(this.readProfile().faction, SWEEP_CAPTAIN_START, SWEEP_YAW).forEach((spec, index) => {
      const id = active.friendlyActorIds[index]
      const resident = residentsById.get(id)
      const recordedDead = active.deadFriendlyActorIds?.includes(id) ?? false
      if (recordedDead && !resident) return
      const muster = this.safeMountedMissionSlot(new THREE.Vector3(spec.x, 0, spec.z), occupiedMuster)
      const entrySpec = entryRoster[index]
      const approach = veteranFieldPosition(VETERAN_FIELD_LAYOUT.supportApproach,
        { squadId: spec.squadId ?? 1 } as VeteranRosterUnit, index < 29 ? index : index - 29, 'friendly', 2)
      const entry = !resident ? this.safeMountedMissionSlot(new THREE.Vector3(entrySpec.x, 0, entrySpec.z), occupiedEntry) : undefined
      const savedActor = this.savedMountedActorPosition(active, id)
      // Legacy saves have only a march anchor. Keep borrowed residents where they are;
      // only temporary actors need a fallback location when no individual checkpoint exists.
      const legacySpec = !savedActor && !resident ? legacyRoster?.[index] : undefined
      const initialPosition = savedActor?.position ?? resident?.npc.combatPosition.clone()
        ?? (legacySpec ? new THREE.Vector3(legacySpec.x, getTerrainHeight(legacySpec.x, legacySpec.z), legacySpec.z)
          : this.safeMountedMissionSlot(approach, occupiedApproach, PLAYABLE_WORLD_BOUND - 4))
      spec.x = initialPosition.x; spec.z = initialPosition.z
      const npc = resident?.npc ?? this.createVeteranNpc(spec, id)
      if (resident) {
        if (resident.spec.role === 'ranger') spec.loadout = {
          ...spec.loadout, meleeWeaponId: npc.meleeWeaponId, rangedWeaponId: npc.rangedWeaponId ?? null, shieldId: npc.shieldId,
        }
        this.borrowMountedMissionActor(npc, spec)
      }
      npc.respawnEnabled = false
      const previousMount = npc.mount
      const mount = this.resolveVeteranMount(spec, npc, resident?.homeMount, !resident)
      if (resident && mount && mount !== resident.homeMount && mount !== previousMount) this.borrowedTemporaryMounts.push({ npc, mount })
      if (savedActor || !resident) this.positionVeteranActor(npc, mount, initialPosition, savedActor?.yaw ?? (legacySpec ? yaw : Math.PI / 2))
      else if (mount && npc.mount !== mount) {
        mount.group.position.copy(initialPosition); mount.group.rotation.y = npc.group.rotation.y
        npc.mountVehicle(mount)
      }
      if (recordedDead || active.actorHealth?.[id]) this.restoreVeteranActorHealth(npc, mount, active, id, recordedDead)
      this.fieldActorMounts.set(id, mount ?? resident?.homeMount ?? npc.mount)
      if (!resident) {
        this.temporaryCavalry.push({ npc, ...(mount ? { mount } : {}) })
        if (mount) this.cavalryMounts.push(mount)
      }
      this.friendlies.push(npc)
      this.veteranMusterPositions.set(id, muster)
      if (active.phase === 'ASSEMBLING' && !npc.dead) {
        const entryStage = entry && (!savedActor || savedActor.position.x < entry.x - VETERAN_ASSEMBLY_RADIUS)
        if (entryStage) this.veteranSupportEntryPositions.set(id, entry)
        npc.assignFormationTarget(entryStage ? VETERAN_SUPPORT_ENTRY_COMMAND_ID : VETERAN_ASSEMBLY_COMMAND_ID,
          entryStage ? entry : muster, new THREE.Vector3(0, 0, -1), mount?.baseSpeed ?? MISSION_LEADER_MARCH_SPEED)
      }
    })
    const firstSquad = this.friendlies.filter(npc => active.friendlyActorIds.indexOf(npc.combatantId) < 29)
    const secondSquad = this.friendlies.filter(npc => active.friendlyActorIds.indexOf(npc.combatantId) >= 29)
    this.leader = this.friendlies.find(npc => npc.combatantId === active.friendlyActorIds[0] && !npc.dead) ?? null
    if (returning || active.result) this.leader ??= this.friendlies.find(npc => !npc.dead) ?? null
    this.tracker = new BattleStatsTracker(this.events, true, event => this.acceptMissionEvent(active, event), active.playerStats)
    for (const friendly of this.friendlies) this.tracker.registerNpc(friendly)
    if (returning) {
      this.assignLeader(this.assemblyPoint()); this.assignFollowers()
      return true
    }
    if (active.result) return true
    this.mountedMarch = new MountedMissionMarchController(
      this.friendlies, SWEEP_CENTER,
      () => {
        const profile = cloneCareerProfile(this.readProfile())
        if (!profile.activeMission || profile.activeMission.followVoicePlayed) return
        profile.activeMission.followVoicePlayed = true
        if (this.commit(profile)) this.onMarchStarted?.()
      },
      () => { this.persistRuntimeProgress(true); return this.setPhase('ENGAGING') },
      () => this.onSweepCharge?.(), active.phase === 'ENGAGING', {
        chargeDistance: SWEEP_CHARGE_DISTANCE, followerCount: 29, playFollow: !active.followVoicePlayed,
        marchTarget: SWEEP_CENTER,
        squads: [
          { leader: firstSquad.find(npc => npc.combatantId === active.friendlyActorIds[0]), members: firstSquad },
          { leader: secondSquad.find(npc => npc.combatantId === active.friendlyActorIds[29]), members: secondSquad },
        ],
      },
    )
    if (active.phase !== 'ASSEMBLING') this.mountedMarch.start()
    return true
  }

  private updateSweep(dt: number, cameraYaw: number): void {
    const active = this.active
    if (!active || active.result) { this.guide.hide(); return }
    this.checkpoint.advance(dt)
    if (active.phase === 'ASSEMBLING') this.updateMountedAssembly(SWEEP_YAW, { assemblyRadius: VETERAN_ASSEMBLY_RADIUS })
    if (this.phase === 'MARCHING' && this.leader) this.advanceRoute(this.leader)
    const observers = [...this.friendlies.filter(npc => !npc.dead).map(npc => npc.combatPosition), ...(this.player().dead ? [] : [this.player().combatPosition])]
    const alert = active.sweepAlerted || this.missionBandits.some(npc => npc.encounterIsAlerted)
      || observers.some(point => Math.hypot(point.x - SWEEP_CENTER.x, point.z - SWEEP_CENTER.z) <= SWEEP_DETECTION_RANGE)
    if (alert) {
      for (const bandit of this.missionBandits) if (!bandit.dead) bandit.triggerEncounterAlert()
      if (!active.sweepAlerted) {
        const profile = cloneCareerProfile(this.readProfile()); profile.activeMission!.sweepAlerted = true; this.commit(profile)
      }
    }
    if (this.phase !== 'ASSEMBLING') this.mountedMarch?.update()
    this.persistRuntimeProgress()
    this.guide.update(this.phase!, this.player().combatPosition, cameraYaw,
      this.phase === 'ASSEMBLING' ? SWEEP_CAPTAIN_START : this.leader?.combatPosition ?? SWEEP_CENTER, this.remainingEnemies)
  }

  private updateMountedAssembly(yaw: number, { assemblyRadius = 0 } = {}): void {
    for (const npc of this.friendlies) {
      const entry = this.veteranSupportEntryPositions.get(npc.combatantId)
      const muster = this.veteranMusterPositions.get(npc.combatantId)
      if (npc.dead || !entry || !muster) continue
      if (npc.isFormationTargetReached(VETERAN_SUPPORT_ENTRY_COMMAND_ID)
        || npc.combatPosition.distanceToSquared(entry) <= VETERAN_ASSEMBLY_RADIUS ** 2) {
        this.veteranSupportEntryPositions.delete(npc.combatantId)
        npc.assignFormationTarget(VETERAN_ASSEMBLY_COMMAND_ID, muster,
          new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)),
          npc.mount?.baseSpeed ?? MISSION_LEADER_MARCH_SPEED)
      }
    }
    const living = this.friendlies.filter(npc => !npc.dead)
    const assembledCount = living.filter(npc => {
      const muster = this.veteranMusterPositions.get(npc.combatantId)
      return npc.isFormationTargetReached(VETERAN_ASSEMBLY_COMMAND_ID)
        || Boolean(assemblyRadius > 0 && muster && npc.combatPosition.distanceToSquared(muster) <= assemblyRadius ** 2)
    }).length
    if (assembledCount >= Math.ceil(living.length * MOUNTED_ASSEMBLY_RATIO) && this.setPhase('MARCHING', 0)) this.mountedMarch?.start()
  }

  private updateVeteranField(dt: number, cameraYaw: number): void {
    const active = this.active
    const definition = active ? getVeteranMissionDefinition(active.templateId) : null
    if (!active || !definition || active.result || active.phase === 'RESULT') { this.guide.hide(); return }
    this.checkpoint.advance(dt)
    if (definition.objective.kind === 'survive') {
      this.veteranSurvivalElapsed = Math.min(definition.objective.seconds, this.veteranSurvivalElapsed + Math.max(0, dt))
    } else if (active.phase === 'ASSEMBLING') {
      this.updateMountedAssembly(veteranPlayerYaw(active.templateId))
    }
    if (definition.objective.kind !== 'survive' && this.phase !== 'ASSEMBLING') this.mountedMarch?.update()
    this.persistRuntimeProgress()
    const current = this.active ?? active
    if (definition.objective.kind === 'survive') this.guide.hide()
    else this.guide.update(current.phase, this.player().combatPosition, cameraYaw,
      current.phase === 'ASSEMBLING' ? this.veteranPlayerAnchor : this.leader?.combatPosition ?? this.veteranMarchTarget,
      this.remainingEnemies, false, false, 'mounted-field')
  }

  updateDepartingCavalry(): void {
    for (let index = (this.departingCavalry?.length ?? 0) - 1; index >= 0; index--) {
      const rider = this.departingCavalry[index]
      if (!rider.npc.dead && rider.npc.combatPosition.x > -280) continue
      this.disposeCavalry(rider)
      this.departingCavalry.splice(index, 1)
    }
  }

  private disposeCavalry(rider: { npc: NPC; mount?: Mount }): void {
    rider.npc.dispose()
    if (!rider.mount) return
    rider.mount.dispose()
    const index = this.cavalryMounts.indexOf(rider.mount)
    if (index >= 0) this.cavalryMounts.splice(index, 1)
  }

  private disposeMissionEntities(departTemporaryCavalry = false): void {
    this.veteranDamageActivationUnsubscribe?.()
    this.veteranDamageActivationUnsubscribe = null
    this.tracker?.dispose()
    this.tracker = null
    for (const camp of this.camps) { this.disposeCamp(camp.mission); camp.mission = [] }
    for (const { npc, mount } of this.borrowedTemporaryMounts) {
      if (npc.mount === mount) npc.dismountFromMount()
      mount.dispose()
    }
    this.borrowedTemporaryMounts.length = 0
    for (const npc of this.borrowedMissionActors) {
      // Patrol owns restoration at the barracks, after physical return. Other residents
      // keep the existing settlement restoration; scene disposal still restores everyone.
      if (!departTemporaryCavalry || !this.residents.some(resident => resident.npc === npc && resident.spec.duty === 'patrol')) {
        npc.restoreCombatLoadout()
      }
      npc.respawnEnabled = this.borrowedRespawnEnabled.get(npc) ?? false
    }
    this.borrowedMissionActors.clear()
    this.borrowedRespawnEnabled.clear()
    for (const rider of this.temporaryCavalry ?? []) {
      if (departTemporaryCavalry && this.friendlies.includes(rider.npc) && rider.mount && !rider.npc.dead) {
        const exit = new THREE.Vector3(-290, 0, THREE.MathUtils.clamp(rider.npc.combatPosition.z, -290, -255))
        rider.npc.assignFormationTarget(this.commandId++, exit, new THREE.Vector3(-1, 0, 0))
        this.departingCavalry.push({ npc: rider.npc, mount: rider.mount })
      } else this.disposeCavalry(rider)
    }
    if (this.temporaryCavalry) this.temporaryCavalry.length = 0
    this.veteranEnemies.length = 0
    this.veteranEnemySquadList.length = 0
    this.veteranMusterPositions.clear()
    this.veteranSupportEntryPositions.clear()
    this.veteranEnemyTownActorIds.clear()
    this.veteranSurvivalElapsed = 0
    this.veteranTargetActorIds.clear()
    this.veteranFriendlyActorIds.clear()
    this.veteranEnemySquadByActorId.clear()
    this.fieldActorMounts.clear()
    this.mountedMarch = null
    this.friendlies.length = 0
    this.leader = null
    this.route = []
    this.routeIndex = 0
    this.checkpoint.reset()
  }

  private missionObjective(
    template: RecruitBanditMissionTemplate | RecruitPatrolMissionTemplate,
    active: ActiveCareerMission,
    camp: THREE.Vector3,
  ): THREE.Vector3 {
    if (template.kind !== 'patrol') return camp
    const objectives = this.patrolWaypoints(template, camp)
    return objectives[Math.min(active.patrolStage ?? 0, objectives.length - 1)] ?? camp
  }

  private marchTarget(
    template: RecruitBanditMissionTemplate | RecruitPatrolMissionTemplate,
    active: ActiveCareerMission,
    camp: THREE.Vector3,
  ): THREE.Vector3 {
    return template.kind === 'patrol' ? this.missionObjective(template, active, camp) : this.marchObjective(camp)
  }

  private marchObjective(camp: THREE.Vector3): THREE.Vector3 {
    const towardTown = this.assemblyPoint().clone().sub(camp).setY(0).normalize()
    const stage = camp.clone().addScaledVector(towardTown, 42)
    if (this.navigation?.grid) {
      if (this.world?.obstacles) this.navigation.sync(this.world.obstacles)
      const cell = this.navigation.grid.findNearestWalkableCell(stage, 4)
      if (cell) stage.copy(this.navigation.grid.cellToWorld(cell))
    }
    stage.y = getTerrainHeight(stage.x, stage.z)
    return stage
  }

  private partyRegrouped(stage: THREE.Vector3): boolean {
    const living = this.friendlies.filter(friendly => !friendly.dead)
    if (living.length === 0) return true
    const nearStage = living.filter(friendly => friendly.combatPosition.distanceTo(stage) <= 18).length
    return nearStage >= Math.ceil(living.length * .75)
  }

  private positionPartyForReload(stage: number): void {
    if (!this.leader || this.friendlies.length === 0) return
    const anchor = this.route[Math.min(Math.max(0, stage), Math.max(0, this.route.length - 1))] ?? this.assemblyPoint()
    let slot = 0
    for (const friendly of this.friendlies) {
      if (friendly.dead) continue
      const offset = friendly === this.leader ? new THREE.Vector3() : new THREE.Vector3((slot++ % 3 - 1) * 1.8, 0, Math.floor(slot / 3) * 1.8)
      const point = anchor.clone().add(offset)
      point.y = getTerrainHeight(point.x, point.z)
      // A saved waypoint index resumes on the rebuilt route. Snap formation
      // offsets out of new scenery without changing phase, casualties or campId.
      if (!isObstaclePathClear(point, point, friendly.mount ? 1 : .4, 2.6, 0, this.world.obstacles)) {
        const cell = this.navigation.grid.findNearestWalkableCell(point, 4)
        if (cell) point.copy(this.navigation.grid.cellToWorld(cell))
      }
      point.y = getTerrainHeight(point.x, point.z)
      if (friendly.mount && !friendly.mount.dead) friendly.mount.group.position.copy(point)
      else friendly.group.position.copy(point)
    }
  }

  persistRuntimeProgress(forceStats = false): boolean {
    const active = this.active
    if (!active || active.result && active.phase !== 'RETURNING') return false
    const deadTargets = new Set(active.deadTargetActorIds ?? [])
    for (const target of this.missionBandits) if (target.dead) deadTargets.add(target.combatantId)
    const deadFriendlies = new Set(active.deadFriendlyActorIds ?? [])
    for (const friendly of this.friendlies) if (friendly.dead) deadFriendlies.add(friendly.combatantId)
    const targetIds = [...deadTargets].filter(id => active.targetActorIds.includes(id)).sort()
    const friendlyIds = [...deadFriendlies].filter(id => active.friendlyActorIds.includes(id)).sort()
    const sameTargets = targetIds.join('|') === [...(active.deadTargetActorIds ?? [])].sort().join('|')
    const sameFriendlies = friendlyIds.join('|') === [...(active.deadFriendlyActorIds ?? [])].sort().join('|')
    const casualtiesChanged = !sameTargets || !sameFriendlies
    const savedRouteStage = active.routeStage ?? 0
    const routeCheckpointReached = shouldPersistMissionRoute(savedRouteStage, this.routeIndex, this.route.length - 1)
    const playerStats = this.tracker?.checkpoint() ?? active.playerStats
    const mountedMarchPosition = active.kind === 'cavalry-sweep' && active.phase !== 'ASSEMBLING' && this.leader && !this.leader.dead
      ? { x: this.leader.combatPosition.x, z: this.leader.combatPosition.z } : active.mountedMarchPosition
    const marchChanged = JSON.stringify(mountedMarchPosition) !== JSON.stringify(active.mountedMarchPosition)
    const statsChanged = JSON.stringify(playerStats) !== JSON.stringify(active.playerStats)
    const playerDead = this.player().dead
    const veteranField = active.kind === 'veteran-field'
    const mountedField = veteranField || active.kind === 'cavalry-sweep'
    const actorHealth = mountedField ? this.snapshotVeteranActorHealth() : active.actorHealth
    const actorHealthChanged = mountedField && JSON.stringify(actorHealth) !== JSON.stringify(active.actorHealth)
    const actorPositions = mountedField ? this.snapshotVeteranActorPositions() : active.actorPositions
    const actorPositionsChanged = mountedField && JSON.stringify(actorPositions) !== JSON.stringify(active.actorPositions)
    const survivalElapsed = veteranField ? this.survivalElapsedSeconds : active.survivalElapsed
    const survivalChanged = veteranField && survivalElapsed !== active.survivalElapsed
    const fieldMarchPosition = veteranField && this.leader && !this.leader.dead
      ? { x: this.leader.combatPosition.x, z: this.leader.combatPosition.z } : mountedMarchPosition
    const fieldMarchChanged = veteranField && JSON.stringify(fieldMarchPosition) !== JSON.stringify(active.mountedMarchPosition)
    const playerHp = veteranField ? this.player().hp : active.playerHp
    const playerStamina = veteranField ? this.player().staminaValue : active.playerStamina
    const playerVitalChanged = veteranField && (playerHp !== active.playerHp || playerStamina !== active.playerStamina)
    return this.checkpoint.persist(() => ({
      ...active,
      playerDead,
      deadTargetActorIds: targetIds,
      deadFriendlyActorIds: friendlyIds,
      ...(fieldMarchPosition ? { mountedMarchPosition: fieldMarchPosition } : {}),
      routeStage: this.routeIndex,
      ...(playerStats ? { playerStats } : {}),
      ...(mountedField ? { actorHealth, actorPositions } : {}),
      ...(veteranField ? {
        survivalElapsed,
        playerHp,
        playerStamina,
        chargedSquadIds: [...(active.chargedSquadIds ?? [])],
        borrowedActorIds: [...(active.borrowedActorIds ?? [])],
      } : {}),
    }), {
      immediate: casualtiesChanged || routeCheckpointReached || Boolean(active.playerDead) !== playerDead,
      periodic: statsChanged || marchChanged || actorHealthChanged || actorPositionsChanged || survivalChanged || fieldMarchChanged || playerVitalChanged,
      force: forceStats,
    })
  }

  private banditPatrolRoute(origin: THREE.Vector3, campId: number, actorIndex: number): THREE.Vector3[] {
    const points: THREE.Vector3[] = []
    const phase = campId * .73 + actorIndex * .31
    for (let index = 0; index < 5; index++) {
      const angle = phase + index * Math.PI * 2 / 5
      const candidate = new THREE.Vector3(origin.x + Math.sin(angle) * 18, 0, origin.z + Math.cos(angle) * 18)
      const cell = this.navigation.grid.findNearestWalkableCell(candidate, 8)
      if (!cell) continue
      const point = this.navigation.grid.cellToWorld(cell)
      point.y = getTerrainHeight(point.x, point.z)
      if (!points.some(existing => existing.distanceToSquared(point) < 9)) points.push(point)
    }
    return points.length >= 2 ? points : [origin.clone()]
  }
}
