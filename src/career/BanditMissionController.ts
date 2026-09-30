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
import { FOLLOW_THRESHOLDS, followSlotWorldPosition } from '../battle/FollowOrder'

interface CampRuntime {
  id: number
  center: THREE.Vector3
  ambient: NPC[]
  mission: NPC[]
}

const BANDIT_LOADOUT = { meleeWeaponId: 'rusty_dagger', rangedWeaponId: null, shieldId: null, mountId: null } as const
const DETECTION_RANGE = 18
const MISSION_LEADER_MARCH_SPEED = 4.4

export function selectLivingMissionLeader<T extends { dead: boolean }>(current: T | null, friendlies: readonly T[]): T | null {
  return current && !current.dead ? current : friendlies.find(npc => !npc.dead) ?? null
}

export function selectMissionInfantryActorIds<T extends { spec: { role: string }; npc: { dead: boolean; combatantId: string } }>(residents: readonly T[], count: number): string[] {
  return residents
    .filter(resident => resident.spec.role === 'melee_infantry' && !resident.npc.dead)
    .slice(0, Math.max(0, count))
    .map(resident => resident.npc.combatantId)
}

export class BanditMissionController {
  readonly events = new CombatEventStream()
  readonly guide = new MissionGuide()
  readonly camps: CampRuntime[]
  readonly friendlies: NPC[] = []
  private tracker: BattleStatsTracker | null = null
  private leader: NPC | null = null
  private commandId = 1
  private waitingForFollowers = false
  private route: THREE.Vector3[] = []
  private routeIndex = 0

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
  get returnComplete(): boolean {
    return this.phase === 'RETURNING'
      && Boolean(this.leader && this.leader.combatPosition.distanceTo(this.assemblyPoint()) < 5)
  }

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
    this.tracker = new BattleStatsTracker(this.events, false, event => this.acceptMissionEvent(active, event))
    for (const friendly of this.friendlies) this.tracker.registerNpc(friendly)
    const routeStage = active.routeStage ?? 0
    if (active.phase === 'RETURNING') {
      this.setRoute(this.buildRoute(this.missionObjective(template, active, camp.center), this.assemblyPoint()), this.missionObjective(template, active, camp.center), routeStage)
      this.positionPartyForReload(routeStage)
      this.assignLeader(this.assemblyPoint())
      this.assignFollowers()
    } else if (active.phase === 'RESULT' && active.result) {
      const objective = this.missionObjective(template, active, camp.center)
      this.setRoute(this.buildRoute(objective, this.assemblyPoint()), objective)
      this.positionPartyForReload(0)
    } else {
      this.setRoute(this.buildMissionRoute(template, this.assemblyPoint(), camp.center), this.assemblyPoint(), routeStage)
      if (active.phase === 'ASSEMBLING') this.assignAssembly()
      else if (active.phase === 'MARCHING') {
        this.positionPartyForReload(routeStage)
        this.assignLeader(camp.center)
        this.assignFollowers()
      } else if (active.phase === 'ENGAGING') {
        this.positionPartyForReload(this.route.length - 1)
        for (const friendly of this.friendlies) if (!friendly.dead) friendly.setTacticalOrder('charge')
      }
    }
    return true
  }

  updateFlow(_dt: number, cameraYaw: number): void {
    const active = this.active
    if (!active || active.phase === 'RESULT') { this.guide.hide(); return }
    const camp = this.camps[active.targetCampId]
    if (!camp || !this.ensureLivingLeader() || !this.leader) return
    const leader = this.leader
    this.detectCampProximity()

    if (active.phase === 'ASSEMBLING' && this.player().combatPosition.distanceTo(leader.combatPosition) <= 12) {
      if (this.setPhase('MARCHING')) {
        this.assignLeader(camp.center)
        this.assignFollowers()
      }
    }
    if (this.phase === 'MARCHING') {
      if (!this.waitingForFollowers) this.advanceRoute(leader)
      const followersReady = this.followersReadyRatio() >= .75
      if (!followersReady && !this.waitingForFollowers) {
        this.waitingForFollowers = true
        this.assignLeader(leader.combatPosition.clone())
      } else if (followersReady && this.waitingForFollowers) {
        this.waitingForFollowers = false
        this.assignLeader(camp.center)
      }
      const campAlerted = camp.mission.some(npc => npc.encounterIsAlerted)
      if (campAlerted || !this.waitingForFollowers && leader.combatPosition.distanceTo(camp.center) < 24) {
        if (this.setPhase('ENGAGING')) {
          for (const friendly of this.friendlies) friendly.setTacticalOrder('charge')
        }
      }
    }
    if (this.phase === 'RETURNING') {
      this.advanceRoute(leader)
    }
    if (this.phase === 'ENGAGING') {
      for (const friendly of this.friendlies) {
        if (!friendly.dead && friendly.tacticalOrder !== 'charge') friendly.setTacticalOrder('charge')
      }
    }

    this.persistRuntimeProgress()
    const current = this.active ?? active
    const target = this.guideTarget(current, camp.center)
    this.guide.update(current.phase, this.player().combatPosition, cameraYaw, target, this.remainingEnemies, false, current.kind === 'patrol')
  }

  evaluate(playerDead: boolean): CareerMissionOutcome | null {
    const active = this.active
    if (!active || active.phase === 'RESULT' || active.result) return null
    return resolveCareerMissionOutcome(playerDead, active.phase === 'ENGAGING' && active.targetActorIds.length > 0, this.remainingEnemies)
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
    if (!active || !template || template.kind === 'town-defense' || !camp || !this.ensureLivingLeader() || !this.leader || !this.setPhase('RETURNING', 0)) return false
    const start = this.missionObjective(template, active, camp.center)
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

  cleanupMission(): void {
    const active = this.active
    if (!active) return
    const campId = active.targetCampId
    this.disposeMissionEntities()
    if (this.camps[campId] && this.camps[campId].ambient.length === 0) this.spawnAmbient(campId, 2)
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
    const observers = [this.player().combatPosition, ...this.friendlies.filter(npc => !npc.dead).map(npc => npc.combatPosition)]
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
    let slot = 0
    for (const follower of this.friendlies) {
      if (follower === this.leader || follower.dead) continue
      follower.assignFollowTarget(this.leader, slot++)
    }
  }

  private ensureLivingLeader(): boolean {
    const fallback = selectLivingMissionLeader(this.leader, this.friendlies)
    if (fallback === this.leader) return true
    if (!fallback) { this.leader = null; return false }
    this.leader = fallback
    if (this.phase === 'MARCHING') {
      this.assignLeader(this.camps[this.active?.targetCampId ?? -1]?.center ?? this.assemblyPoint())
      this.assignFollowers()
    } else if (this.phase === 'RETURNING') {
      this.assignLeader(this.assemblyPoint())
      this.assignFollowers()
    } else {
      for (const friendly of this.friendlies) if (!friendly.dead) friendly.setTacticalOrder('charge')
    }
    return true
  }

  private followersReadyRatio(): number {
    if (!this.leader) return 0
    const followers = this.friendlies.filter(npc => npc !== this.leader && !npc.dead)
    if (followers.length === 0) return 1
    let ready = 0
    const slot = new THREE.Vector3()
    for (const follower of followers) {
      followSlotWorldPosition(this.leader.combatPosition, this.leader.group.rotation.y, follower.activeFollowLocalOffset, slot)
      if (follower.combatPosition.distanceTo(slot) <= FOLLOW_THRESHOLDS.regroupDistance) ready++
    }
    return ready / followers.length
  }

  private setPhase(phase: CareerMissionPhase, routeStage = this.routeIndex): boolean {
    const active = this.active
    if (!active || active.phase === phase) return true
    const profile = cloneCareerProfile(this.readProfile())
    profile.activeMission = { ...active, phase, routeStage, targetActorIds: [...active.targetActorIds], friendlyActorIds: [...active.friendlyActorIds] }
    return this.commit(profile)
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

  private buildMissionRoute(
    template: RecruitBanditMissionTemplate | RecruitPatrolMissionTemplate,
    from: THREE.Vector3,
    camp: THREE.Vector3,
  ): THREE.Vector3[] {
    if (template.kind === 'bandit') return this.buildRoute(from, camp)
    const stops = this.patrolWaypoints(template, camp)
    const route: THREE.Vector3[] = []
    let cursor = from
    for (const stop of stops) {
      const leg = this.buildRoute(cursor, stop)
      route.push(...(route.length > 0 ? leg.slice(1) : leg))
      cursor = stop
    }
    return route
  }

  private patrolWaypoints(template: RecruitPatrolMissionTemplate, camp: THREE.Vector3): THREE.Vector3[] {
    const via = template.routeId === 'south-road'
      ? [new THREE.Vector3(0, 0, 95), new THREE.Vector3(90, 0, -80)]
      : [new THREE.Vector3(70, 0, 85), new THREE.Vector3(30, 0, 160)]
    return [...via, camp].map(point => point.clone().setY(getTerrainHeight(point.x, point.z)))
  }

  private patrolEncounterPoint(template: RecruitPatrolMissionTemplate, missionId: string, camp: THREE.Vector3): THREE.Vector3 {
    const candidates = this.patrolWaypoints(template, camp).slice(0, -1)
    const stableIndex = [...missionId].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0) % candidates.length
    return candidates[stableIndex].clone()
  }

  private setRoute(route: THREE.Vector3[], from: THREE.Vector3, routeStage = 0): void {
    this.route = route.filter((point, index) => index === route.length - 1 || point.distanceToSquared(from) > 16)
    this.routeIndex = Math.min(Math.max(0, routeStage), Math.max(0, this.route.length - 1))
  }

  private currentRouteTarget(fallback: THREE.Vector3): THREE.Vector3 {
    return this.route[this.routeIndex] ?? fallback
  }

  private advanceRoute(leader: NPC): void {
    const target = this.route[this.routeIndex]
    if (!target) return
    if (leader.combatPosition.distanceToSquared(target) > 16 || this.routeIndex >= this.route.length - 1) return
    this.routeIndex++
    this.persistRuntimeProgress()
  }

  private guideTarget(active: ActiveCareerMission, camp: THREE.Vector3): THREE.Vector3 | null {
    if (active.phase === 'ASSEMBLING') return this.assemblyPoint()
    if (active.phase === 'ENGAGING') return camp
    return this.currentRouteTarget(active.phase === 'RETURNING' ? this.assemblyPoint() : camp)
  }

  private disposeCamp(group: NPC[]): void { for (const npc of group) npc.dispose() }

  private disposeMissionEntities(): void {
    this.tracker?.dispose()
    this.tracker = null
    for (const camp of this.camps) { this.disposeCamp(camp.mission); camp.mission = [] }
    this.friendlies.length = 0
    this.leader = null
    this.waitingForFollowers = false
    this.route = []
    this.routeIndex = 0
  }

  private missionObjective(
    template: RecruitBanditMissionTemplate | RecruitPatrolMissionTemplate,
    active: ActiveCareerMission,
    camp: THREE.Vector3,
  ): THREE.Vector3 {
    return template.kind === 'patrol' ? this.patrolEncounterPoint(template, active.id, camp) : camp
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
    if (sameTargets && sameFriendlies && (active.routeStage ?? 0) === this.routeIndex) return
    const profile = cloneCareerProfile(this.readProfile())
    profile.activeMission = { ...active, deadTargetActorIds: targetIds, deadFriendlyActorIds: friendlyIds, routeStage: this.routeIndex }
    this.commit(profile)
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
