import * as THREE from 'three'
import { BattleStatsTracker, type BattleStatsSnapshot } from '../combat/BattleStatsTracker'
import { officialFollowLocalOffset } from '../battle/FollowOrder'
import { CombatEventStream, type CombatEvent, type CombatTargetRef } from '../combat/CombatAttribution'
import { Faction, type NPC } from '../world/NPC'
import type { Player } from '../player/Player'
import type { TownCavalryPatrolController, PatrolResident } from '../town/TownCavalryPatrolController'
import { cloneCareerProfile, type CareerProfile } from './CareerProfile'
import { snapshotCommandActor, restoreCommandActor } from './CareerCommandActorCheckpoint'
import { cloneOfficialCommandAuthority, officialMissionSourcePolicy } from './CareerCommandAuthority'
import { personalMissionSourcePolicy } from './CareerPersonalSquadMission'
import { acceptsCareerMissionStat, careerMissionCommandMeritPolicy, type ActiveCareerMission, type CareerMissionOutcome } from './CareerMissionState'
import { townSitePoint } from '../town/TownRules'
import { getTerrainHeight } from '../world/Terrain'

export const CAPTAIN_PATROL_KILL_TARGET = 30

/** Actual event targets and accepted membership determine objective progress; dead flags never synthesize kills. */
export function acceptsCaptainPatrolKill(mission: ActiveCareerMission, event: CombatEvent,
  isEligibleTarget: (target: CombatTargetRef) => boolean): boolean {
  if (mission.kind !== 'captain-patrol-command' || mission.result || mission.phase === 'RESULT'
    || event.type !== 'actor_killed' || event.target.targetType !== 'npc' || !isEligibleTarget(event.target)) return false
  return event.source.actorType === 'player'
    || Boolean(mission.officialSquad && officialMissionSourcePolicy(mission.officialSquad)(event.source))
    || personalMissionSourcePolicy(mission)(event.source)
}

export function resolveCaptainPatrolCommandOutcome(kills: number, playerDead: boolean,
  officialAlive: number, deployedPrivateAlive: number): CareerMissionOutcome | null {
  if (kills >= CAPTAIN_PATROL_KILL_TARGET) return 'victory'
  return playerDead && officialAlive === 0 && deployedPrivateAlive === 0 ? 'failure' : null
}

export interface CaptainPatrolRuntimeOptions {
  personalActors?(): readonly NPC[]
  /** The existing formation owner chooses an unoccupied, navigable slot. */
  resumeFormation?(npc: NPC, reference: NPC): boolean
  /** Scene supplies the actual Bandit/roaming enemy actors, including mount owners. */
  isEligibleTarget?(target: CombatTargetRef): boolean
}

/** Keeps the official identities while Patrol retains ownership of individual refit travel. */
export class CaptainPatrolCommandController {
  readonly events = new CombatEventStream()
  private readonly residentsById: Map<string, PatrolResident>
  private readonly eligibleTargetIds = new Set<string>()
  private readonly killed = new Set<string>()
  private readonly seen = new WeakSet<CombatEvent>()
  private tracker?: BattleStatsTracker
  private missionId?: string
  private saveElapsed = 0
  private readonly previousSquads = new Map<string, NPC['squadId']>()
  private readonly officialActors: NPC[] = []
  private returned = false
  private readonly refittingActors = new Set<string>()

  constructor(residents: readonly PatrolResident[], private readonly patrol: TownCavalryPatrolController,
    private readonly player: () => Player, private readonly read: () => CareerProfile,
    private readonly commit: (profile: CareerProfile) => boolean, private readonly options: CaptainPatrolRuntimeOptions = {}) {
    this.residentsById = new Map(residents.map(resident => [resident.npc.combatantId, resident]))
  }

  get active(): ActiveCareerMission | undefined {
    const active = this.read().activeMission
    return active?.kind === 'captain-patrol-command' ? active : undefined
  }
  get actors(): readonly NPC[] { return this.officialActors }
  get fieldNpcs(): readonly NPC[] { return this.active?.phase === 'RETURNING' ? [] : this.officialActors.filter(npc => !this.refittingActors.has(npc.combatantId)) }
  get friendlyActors(): readonly NPC[] { return this.officialActors }
  get returningActorIds(): readonly string[] { return [...this.refittingActors] }
  get ready(): boolean { return Boolean(this.active && this.missionId === this.active.id && this.officialActors.length === 20) }
  get commandsEnabled(): boolean { return this.ready && !this.active?.result && !this.player().dead }
  get killCount(): number { return this.killed.size }
  get aliveCombatants(): number { return this.officialActors.filter(actor => !actor.dead).length }
  owns(npc: NPC): boolean { return this.active?.phase !== 'RETURNING' && !this.refittingActors.has(npc.combatantId) && this.officialActors.includes(npc) }
  accepts(npc: NPC): boolean { return this.commandsEnabled && this.owns(npc) }
  selectAvailableSquad() { return this.patrol.selectAvailableSquad() }
  get unavailableReason(): string { return this.patrol.unavailableReason }
  get guideTarget(): THREE.Vector3 | null {
    const active = this.active
    if (!active || !this.ready) return null
    if (active.phase === 'RETURNING') {
      const p = townSitePoint('barracks', 0, 15)
      return new THREE.Vector3(p.x, getTerrainHeight(p.x, p.z), p.z)
    }
    if (active.result) return null
    // Accepted order puts the canonical Captain first; casualties elect the next official member.
    return this.fieldNpcs.find(npc => !npc.dead)?.combatPosition ?? null
  }
  get returnComplete(): boolean {
    const target = this.guideTarget
    return this.active?.phase === 'RETURNING' && !this.player().dead && Boolean(target && this.player().combatPosition.distanceTo(target) < 12)
  }

  private fighting(npc: NPC): boolean { return npc.inCombat || npc.encounterIsAlerted || this.patrol.combatEnabled(npc) }

  /** Attach original positions, health and mounts to the same transaction as mission acceptance. */
  captureForMission(mission: ActiveCareerMission): ActiveCareerMission | null {
    const authority = mission.officialSquad
    if (!authority || authority.actorIds.length !== 20 || new Set(authority.actorIds).size !== 20
      || authority.actorIds.some(id => !this.residentsById.has(id))) return null
    const official = cloneOfficialCommandAuthority(authority)
    official.members = Object.fromEntries(official.actorIds.map(id => {
      const resident = this.residentsById.get(id)!, actor = snapshotCommandActor(resident.npc, resident.homeMount)
      // End peaceful route orders only; ongoing combat remains the actor's responsibility.
      if (!this.fighting(resident.npc) && !this.patrol.isRefitting(id)) { actor.order = 'attack'; delete actor.formation }
      return [id, actor]
    }))
    return { ...mission, officialSquad: official, friendlyActorIds: [...official.actorIds], patrolKilledActorIds: [...(mission.patrolKilledActorIds ?? [])],
      patrolReturnStates: Object.fromEntries(official.actorIds.filter(id => this.patrol.isRefitting(id)).map(id => [id, this.patrol.returnStateFor(id)!])) }
  }

  /** Post-save bind; saved membership may contain casualties and unavailable mounts on reload. */
  resume(restore = true): boolean {
    const active = this.active, authority = active?.officialSquad
    if (!active || !authority || authority.actorIds.length !== 20) return false
    if (this.missionId === active.id) return true
    if (restore && active.phase !== 'RETURNING') for (const id of authority.actorIds) {
      const state = active.patrolReturnStates?.[id]
      if (state === 'RETURN_TO_BARRACKS' || state === 'REFIT') this.patrol.restoreMissionReturn(id, state)
    }
    const fighting = new Set(authority.actorIds.filter(id => {
      const resident = this.residentsById.get(id)
      return resident && this.fighting(resident.npc)
    }))
    if (!this.patrol.resumeSquad(authority.actorIds, !restore)) return false
    this.tracker?.dispose(); this.officialActors.length = 0; this.previousSquads.clear(); this.killed.clear()
    this.returned = false
    this.refittingActors.clear()
    for (const id of active.patrolKilledActorIds ?? []) this.killed.add(id)
    for (const id of authority.actorIds) {
      const resident = this.residentsById.get(id)
      if (!resident) return false
      const npc = resident.npc
      this.previousSquads.set(id, npc.squadId)
      if (restore && authority.members?.[id]) restoreCommandActor(npc, authority.members[id], resident.homeMount)
      if (active.phase !== 'RETURNING' && this.patrol.isRefitting(id)) {
        this.refittingActors.add(id); this.officialActors.push(npc); continue
      }
      npc.combatOwnership = 'mission-official'; npc.setCommandAllegiance(Faction.TOWN); npc.setCommandSquad(1)
      npc.respawnEnabled = false
      if (restore || !fighting.has(id)) {
        if (!authority.members?.[id]?.order || authority.members[id].order === 'attack') npc.setTacticalOrder('attack')
        else if (authority.members[id].order === 'follow') npc.assignFollowTarget(this.player(), this.officialActors.length,
          officialFollowLocalOffset(this.officialActors.length, npc.isMounted, Boolean(this.read().personalSquad?.members.length)))
      }
      this.officialActors.push(npc)
    }
    this.missionId = active.id
    this.tracker = new BattleStatsTracker(this.events, false, event => acceptsCareerMissionStat(this.active ?? active, event),
      active.playerStats, careerMissionCommandMeritPolicy(active, () => this.active ?? active))
    for (const npc of this.officialActors) this.tracker.registerNpc(npc, true)
    for (const npc of this.options.personalActors?.() ?? []) this.tracker.registerNpc(npc, true)
    if (active.result) this.tracker.freeze()
    if (active.phase === 'RETURNING') this.returnOfficialSquad(true)
    return true
  }

  setEligibleTargets(actors: readonly NPC[]): void {
    this.eligibleTargetIds.clear()
    for (const npc of actors) if (npc.faction === Faction.BANDIT || npc.faction === Faction.ENEMY) this.eligibleTargetIds.add(npc.combatantId)
  }
  private isEligibleTarget = (target: CombatTargetRef): boolean => this.options.isEligibleTarget?.(target)
    ?? this.eligibleTargetIds.has(target.ownerActorId ?? target.targetId)

  /** The scene sends a single actual CombatEvent here. Result locking freezes both stats and objective. */
  recordEvent(event: CombatEvent): boolean {
    const active = this.active
    if (!this.ready || !active || active.result || this.seen.has(event)) return false
    this.seen.add(event)
    if (event.type === 'structure_damaged' || event.type === 'structure_destroyed') return false
    const incoming = event.type === 'damage_applied'
      && (event.target.targetId === 'player' || event.target.targetType === 'npc'
        && Boolean(active.officialSquad?.actorIds.includes(event.target.targetId)
          || active.personalSquad?.memberIds.includes(event.target.targetId)))
      && event.source.actorType === 'npc'
      && this.isEligibleTarget({ targetId: event.source.actorId, targetType: 'npc', name: event.source.actorId,
        allegiance: event.source.allegiance, characterFaction: event.source.characterFaction })
    if (!incoming && !this.isEligibleTarget(event.target)) return false
    if (event.type === 'actor_killed') {
      if (!acceptsCaptainPatrolKill(active, event, this.isEligibleTarget) || this.killed.has(event.target.targetId)) return false
      this.killed.add(event.target.targetId)
    }
    this.events.emit(event)
    if (event.type === 'actor_killed') this.persist(true)
    return true
  }

  update(dt: number): void {
    if (!this.ready || this.active?.result && this.active.phase !== 'RETURNING') return
    for (const id of this.refittingActors) {
      if (this.patrol.isRefitting(id)) continue
      const npc = this.residentsById.get(id)!.npc
      if (!this.patrol.relinquish(id)) continue
      const peers = this.fieldNpcs.filter(actor => !actor.dead)
      this.refittingActors.delete(id)
      npc.combatOwnership = 'mission-official'; npc.setCommandAllegiance(Faction.TOWN); npc.setCommandSquad(1)
      npc.respawnEnabled = false
      this.resumeSquadOrder(npc, peers)
    }
    this.saveElapsed += Math.max(0, dt)
    if (this.saveElapsed >= 1) { this.saveElapsed = 0; this.persist() }
  }
  /** Inherit the applicable live command only after Patrol releases the refitted actor. */
  private resumeSquadOrder(npc: NPC, peers: readonly NPC[]): void {
    const reference = peers.find(actor => actor.presetId === npc.presetId) ?? peers[0]
    if (!reference) return
    if (reference.tacticalOrder === 'follow') {
      const target = reference.activeFollowTarget ?? this.player()
      const occupied = new Set(peers.filter(actor => actor.tacticalOrder === 'follow' && actor.activeFollowTarget === target)
        .map(actor => actor.activeFollowSlotIndex))
      let slot = 0
      while (occupied.has(slot)) slot++
      npc.assignFollowTarget(target, slot, officialFollowLocalOffset(slot, npc.isMounted, Boolean(this.read().personalSquad?.members.length)))
    } else if (reference.combatFormationCheckpoint) {
      if (!this.options.resumeFormation?.(npc, reference)) npc.setTacticalOrder('defend')
    } else npc.setTacticalOrder(reference.tacticalOrder)
  }
  evaluateOutcome(): CareerMissionOutcome | null {
    if (!this.ready || this.active?.result) return null
    return resolveCaptainPatrolCommandOutcome(this.killCount, this.player().dead, this.aliveCombatants,
      (this.options.personalActors?.() ?? []).filter(npc => !npc.dead).length)
  }
  registerPersonalActor(npc: NPC): void { this.tracker?.registerNpc(npc, true) }
  get statsSnapshot(): BattleStatsSnapshot | undefined { return this.tracker?.snapshot([...this.officialActors, ...(this.options.personalActors?.() ?? [])], this.player()) }
  freezeStats(): void { this.tracker?.freeze() }
  checkpoint(): ActiveCareerMission | undefined {
    const active = this.active
    if (!active || !this.ready) return active
    const next = { ...active, patrolKilledActorIds: [...this.killed], playerDead: this.player().dead,
      playerStats: this.tracker?.checkpoint() ?? active.playerStats,
      officialSquad: cloneOfficialCommandAuthority(active.officialSquad!),
      deadFriendlyActorIds: this.officialActors.filter(npc => npc.dead).map(npc => npc.combatantId) }
    next.officialSquad.members = Object.fromEntries(next.officialSquad.actorIds.map(id => {
      const resident = this.residentsById.get(id)!
      return [id, snapshotCommandActor(resident.npc, resident.homeMount)]
    }))
    if (active.phase === 'RETURNING') next.patrolReturnStates = Object.fromEntries(next.officialSquad.actorIds.map(id =>
      [id, this.patrol.returnStateFor(id) ?? 'REJOIN_PATROL']))
    else next.patrolReturnStates = Object.fromEntries([...this.refittingActors].map(id => [id, this.patrol.returnStateFor(id)!]))
    const official = this.tracker?.officialCommandCheckpoint(), personal = this.tracker?.commandCheckpoint()
    if (official) next.officialSquad.contribution = official
    if (personal && next.personalSquad) next.personalSquad = { ...next.personalSquad, contribution: personal }
    return next
  }
  persist(force = false): boolean {
    const saved = this.checkpoint(), current = this.active
    if (!saved || !current || current.result && current.phase !== 'RETURNING') return false
    if (!force && JSON.stringify(saved) === JSON.stringify(current)) return true
    const next = cloneCareerProfile(this.read()); next.activeMission = saved
    return this.commit(next)
  }

  startReturning(): boolean {
    const active = this.active
    if (!active?.result || active.result.outcome !== 'victory' || this.player().dead) return false
    if (active.phase === 'RETURNING') return true
    const next = cloneCareerProfile(this.read())
    next.activeMission = { ...this.checkpoint()!, phase: 'RETURNING',
      patrolReturnStates: Object.fromEntries(active.officialSquad!.actorIds.map(id => [id, 'RETURN_TO_BARRACKS' as const])) }
    if (!this.commit(next)) return false
    this.returnOfficialSquad(false)
    this.persist(true)
    return true
  }

  private returnOfficialSquad(restore: boolean): void {
    for (const npc of this.officialActors) {
      if (this.refittingActors.has(npc.combatantId)) {
        if (restore && this.active?.patrolReturnStates?.[npc.combatantId]) this.patrol.restoreMissionReturn(npc.combatantId, this.active.patrolReturnStates[npc.combatantId])
        continue
      }
      npc.combatOwnership = undefined; npc.setCommandSquad(this.previousSquads.get(npc.combatantId)); npc.setTownPeaceful()
      const state = restore ? this.active?.patrolReturnStates?.[npc.combatantId] : undefined
      if (state) this.patrol.restoreMissionReturn(npc.combatantId, state)
      else this.patrol.beginMissionReturn(npc.combatantId)
    }
    this.returned = true
  }

  /** Invoke after settlement/cancellation is saved. Autonomous ownership resumes through physical refit. */
  release(): void {
    this.tracker?.dispose(); this.tracker = undefined
    if (!this.returned) {
      const actors = this.officialActors.filter(npc => !this.refittingActors.has(npc.combatantId))
      const ids = actors.map(npc => npc.combatantId)
      for (const npc of actors) {
        npc.combatOwnership = undefined; npc.setCommandAllegiance(Faction.TOWN)
        npc.setCommandSquad(this.previousSquads.get(npc.combatantId)); npc.setTownPeaceful()
      }
      this.patrol.returnSquad(ids)
    }
    this.officialActors.length = 0; this.previousSquads.clear(); this.refittingActors.clear(); this.missionId = undefined
  }
  dispose(): void { this.tracker?.dispose(); this.tracker = undefined }
}
