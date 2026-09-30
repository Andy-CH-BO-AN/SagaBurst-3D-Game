import * as THREE from 'three'
import { BattleStatsTracker, type BattleStatsSnapshot } from '../combat/BattleStatsTracker'
import { CombatEventStream, type CombatEvent } from '../combat/CombatAttribution'
import { NavigationWorld } from '../navigation/NavigationWorld'
import type { Player } from '../player/Player'
import { getTerrainHeight } from '../world/Terrain'
import { AIType, Faction, NPC } from '../world/NPC'
import type { TownWorld } from '../town/TownWorld'
import { townSitePoint, type TownActorSpec } from '../town/TownRules'
import { cloneCareerProfile, type CareerProfile } from './CareerProfile'
import {
  getRecruitMissionTemplate,
  type RecruitBanditMissionTemplate,
  type RecruitPatrolMissionTemplate,
} from './CareerMissionCatalog'
import { acceptsCareerMissionStat, createActiveCareerMission, resolveCareerMissionOutcome, type ActiveCareerMission, type CareerMissionOutcome, type CareerMissionPhase } from './CareerMissionState'
import { MissionGuide } from './MissionGuide'
import { followLocalOffset, returnFollowLocalOffset } from '../battle/FollowOrder'

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
const STATS_CHECKPOINT_SECONDS = 5
const PERCEPTION_INTERVAL_SECONDS = .2

export function selectLivingMissionLeader<T extends { dead: boolean }>(current: T | null, friendlies: readonly T[]): T | null {
  return current && !current.dead ? current : friendlies.find(npc => !npc.dead) ?? null
}

export function selectMissionInfantryActorIds<T extends { spec: { role: string }; npc: { dead: boolean; combatantId: string } }>(residents: readonly T[], count: number): string[] {
  return residents
    .filter(resident => (resident.spec.role === 'melee_infantry' || resident.spec.role === 'spearman_infantry') && !resident.npc.dead)
    .slice(0, Math.max(0, count))
    .map(resident => resident.npc.combatantId)
}

export function shouldPersistMissionRoute(savedStage: number, currentStage: number, lastStage: number): boolean {
  return Math.abs(currentStage - savedStage) >= 3
    || lastStage >= 0 && currentStage === lastStage && savedStage !== currentStage
}

export class BanditMissionController {
  onMarchStarted: (() => void) | null = null
  readonly events = new CombatEventStream()
  readonly guide = new MissionGuide()
  readonly camps: CampRuntime[]
  readonly friendlies: NPC[] = []
  private tracker: BattleStatsTracker | null = null
  private leader: NPC | null = null
  private commandId = 1
  private route: THREE.Vector3[] = []
  private routeIndex = 0
  private statsCheckpointElapsed = 0
  private perceptionElapsed = PERCEPTION_INTERVAL_SECONDS

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: TownWorld,
    private readonly navigation: NavigationWorld,
    private readonly missionCaptain: NPC,
    private readonly residents: readonly { spec: TownActorSpec; npc: NPC }[],
    private readonly player: () => Player,
    private readonly readProfile: () => CareerProfile,
    private readonly commit: (profile: CareerProfile) => boolean,
  ) {
    this.camps = world.camps.map((camp, id) => ({
      id,
      center: camp.spawnPoints.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / camp.spawnPoints.length),
      ambient: [],
      mission: [],
    }))
    for (const campId of [0, 2, 4]) this.spawnAmbient(campId, 2)
  }

  get active(): ActiveCareerMission | undefined { return this.readProfile().activeMission }
  get phase(): CareerMissionPhase | null { return this.active?.phase ?? null }
  get missionLeader(): NPC | null { return this.leader }
  get missionBandits(): NPC[] { return this.camps.flatMap(camp => camp.mission) }
  get ambientBandits(): NPC[] { return this.camps.flatMap(camp => camp.ambient) }
  get fieldNpcs(): NPC[] { return [...this.ambientBandits, ...this.missionBandits, ...this.friendlies] }
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
    const template = getRecruitMissionTemplate(active.templateId)
    const camp = this.camps[active.targetCampId]
    if (!template || template.kind === 'town-defense' || !camp) return false

    this.disposeMissionEntities()
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
    this.perceptionElapsed += Math.max(0, dt)
    if (this.perceptionElapsed >= PERCEPTION_INTERVAL_SECONDS) {
      this.perceptionElapsed = 0
      this.detectCampProximity()
    }
    const active = this.active
    if (!active || active.phase === 'RESULT') { this.guide.hide(); return }
    const camp = this.camps[active.targetCampId]
    const template = getRecruitMissionTemplate(active.templateId)
    if (!camp || !template || template.kind === 'town-defense') return
    this.statsCheckpointElapsed += Math.max(0, dt)
    const hasLeader = this.ensureLivingLeader() && Boolean(this.leader)
    const leader = this.leader
    const objective = this.marchTarget(template, active, camp.center)

    if (leader && active.phase === 'ASSEMBLING' && this.player().combatPosition.distanceTo(leader.combatPosition) <= 12) {
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
    if (leader && this.phase === 'RETURNING') {
      this.advanceRoute(leader)
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
    if (template.kind === 'patrol' && this.phase === 'MARCHING' && !hasLeader) this.updatePlayerOnlyPatrol(template, camp)

    this.persistRuntimeProgress()
    const current = this.active ?? active
    const target = this.guideTarget(current, camp.center)
    this.guide.update(current.phase, this.player().combatPosition, cameraYaw, target, this.remainingEnemies, false, current.kind === 'patrol')
  }

  evaluate(playerDead: boolean): CareerMissionOutcome | null {
    const active = this.active
    if (!active || active.phase === 'RESULT' || active.result) return null
    const template = getRecruitMissionTemplate(active.templateId)
    const camp = this.camps[active.targetCampId]
    const patrolComplete = template?.kind !== 'patrol' || Boolean(camp && (active.patrolStage ?? 0) >= this.patrolWaypoints(template, camp.center).length)
    const registrationComplete = active.targetActorIds.length > 0 && (template?.kind === 'patrol' ? patrolComplete : active.phase === 'ENGAGING')
    return resolveCareerMissionOutcome(playerDead, registrationComplete, this.remainingEnemies)
  }

  snapshot(): BattleStatsSnapshot {
    return this.tracker?.snapshot(this.fieldNpcs, this.player()) ?? {
      player: { damageDealt: 0, damageTaken: 0, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: !this.player().dead },
      squads: [],
    }
  }

  startReturning(): boolean {
    const active = this.active
    const template = active ? getRecruitMissionTemplate(active.templateId) : null
    const camp = active ? this.camps[active.targetCampId] : null
    if (!active || !template || template.kind === 'town-defense' || !camp || !this.setPhase('RETURNING', 0)) return false
    if (!this.ensureLivingLeader() || !this.leader) {
      this.route = []
      this.routeIndex = 0
      return true
    }
    const start = this.marchTarget(template, active, camp.center)
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
    const camp = this.camps.find(candidate => candidate.ambient.includes(target) || candidate.mission.includes(target))
    if (camp) this.provokeCamp(camp.id)
  }

  provokeCamp(campId: number): void {
    const camp = this.camps[campId]
    if (!camp) return
    for (const bandit of [...camp.ambient, ...camp.mission]) bandit.provokeEncounter()
  }

  isMissionTarget(npc: NPC): boolean {
    return Boolean(this.active?.targetActorIds.includes(npc.combatantId))
  }

  isAmbientTarget(npc: NPC): boolean { return this.camps.some(camp => camp.ambient.includes(npc)) }

  combatPeersFor(npc: NPC): NPC[] {
    if (this.friendlies.includes(npc)) return [
      ...this.friendlies,
      ...(this.phase === 'ENGAGING' ? this.missionBandits : [...this.ambientBandits, ...this.missionBandits]),
    ]
    const camp = this.camps.find(candidate => candidate.ambient.includes(npc) || candidate.mission.includes(npc))
    if (!camp) return this.fieldNpcs
    return [...camp.ambient, ...camp.mission, ...this.friendlies]
  }

  cleanupMission(campId = this.active?.targetCampId): void {
    this.disposeMissionEntities()
    if (campId !== undefined && this.camps[campId] && this.camps[campId].ambient.length === 0) this.spawnAmbient(campId, 2)
    this.guide.hide()
  }

  dispose(): void {
    this.tracker?.dispose()
    this.tracker = null
    this.disposeMissionEntities()
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
    this.leader = this.friendlies.find(npc => npc.combatantId === this.missionCaptain.combatantId && !npc.dead)
      ?? this.friendlies.find(npc => !npc.dead)
      ?? null
    const deadFriendlies = new Set(active.deadFriendlyActorIds ?? [])
    for (const friendly of this.friendlies) if (deadFriendlies.has(friendly.combatantId) && !friendly.dead) friendly.takeDamage(999999)
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
      const objective = active && camp && template && template.kind !== 'town-defense'
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
    const profile = cloneCareerProfile(this.readProfile())
    profile.activeMission = { ...active, phase, routeStage, ...(patrolStage !== undefined ? { patrolStage } : {}), playerStats: this.tracker?.checkpoint() ?? active.playerStats, targetActorIds: [...active.targetActorIds], friendlyActorIds: [...active.friendlyActorIds] }
    const saved = this.commit(profile)
    if (saved) this.statsCheckpointElapsed = 0
    return saved
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
    if (!template || template.kind === 'town-defense') return camp
    return this.missionObjective(template, active, camp)
  }

  private disposeCamp(group: NPC[]): void { for (const npc of group) npc.dispose() }

  private disposeMissionEntities(): void {
    this.tracker?.dispose()
    this.tracker = null
    for (const camp of this.camps) { this.disposeCamp(camp.mission); camp.mission = [] }
    this.friendlies.length = 0
    this.leader = null
    this.route = []
    this.routeIndex = 0
    this.statsCheckpointElapsed = 0
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
      if (friendly.mount && !friendly.mount.dead) friendly.mount.group.position.copy(point)
      else friendly.group.position.copy(point)
    }
  }

  private persistRuntimeProgress(): void {
    const active = this.active
    if (!active || active.result && active.phase !== 'RETURNING') return
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
    const statsChanged = JSON.stringify(playerStats) !== JSON.stringify(active.playerStats)
    const statsCheckpointReached = statsChanged && this.statsCheckpointElapsed >= STATS_CHECKPOINT_SECONDS
    if (!casualtiesChanged && !routeCheckpointReached && !statsCheckpointReached) return
    const profile = cloneCareerProfile(this.readProfile())
    profile.activeMission = { ...active, deadTargetActorIds: targetIds, deadFriendlyActorIds: friendlyIds, routeStage: this.routeIndex, ...(playerStats ? { playerStats } : {}) }
    if (this.commit(profile)) this.statsCheckpointElapsed = 0
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
