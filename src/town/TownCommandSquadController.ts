import * as THREE from 'three'
import { officialFollowLocalOffset } from '../battle/FollowOrder'
import { matchesArmyCommandTarget, type ArmyCommandTarget } from '../battle/CommandTarget'
import type { TacticalOrder } from '../battle/TacticalOrder'
import { cloneTownCommandSquad, type TownCommandSquadState } from '../career/CareerCommandAuthority'
import { restoreCommandActor, snapshotCommandActor } from '../career/CareerCommandActorCheckpoint'
import { emptyPersonalContribution } from '../combat/CommandMerit'
import { cloneCareerProfile, type CareerProfile } from '../career/CareerProfile'
import type { PersonalActorCheckpoint } from '../career/CareerPersonalSquadMission'
import type { NavigationWorld } from '../navigation/NavigationWorld'
import type { Player } from '../player/Player'
import { Faction, type NPC } from '../world/NPC'
import type { Mount } from '../world/Mount'
import { SpatialGrid } from '../world/SpatialGrid'
import { getTerrainHeight, type ObstacleData } from '../world/Terrain'
import { townCommandSquadRoster, type TownActorSpec } from './TownRules'

export interface TownCommandResident { spec: TownActorSpec; npc: NPC; homeMount?: Mount }
export const TOWN_COMMAND_RETURN_ID = -4400

/** Town remains the permanent resource owner. This controller only owns Captain command and travel. */
export class TownCommandSquadController {
  private value?: TownCommandSquadState
  private readonly residentsById: Map<string, TownCommandResident>
  private readonly grid = new SpatialGrid<NPC>(8)
  private readonly nearby: NPC[] = []

  constructor(private readonly residents: readonly TownCommandResident[], private readonly player: () => Player,
    private readonly read: () => CareerProfile, private readonly commit: (profile: CareerProfile) => boolean,
    private readonly options: { sceneKey?: string } = {}) {
    this.residentsById = new Map(residents.map(resident => [resident.npc.combatantId, resident]))
  }

  get state(): TownCommandSquadState['state'] | null { return this.value?.state ?? null }
  get sceneKey(): string { return this.options.sceneKey ?? 'town-home' }
  get authorizedActorIds(): readonly string[] { return this.value?.authorized ? this.value.actorIds : [] }
  get actors(): NPC[] { return this.value?.sceneKey === this.sceneKey ? this.value.actorIds.flatMap(id => this.residentsById.get(id)?.npc ?? []) : [] }
  get commandsEnabled(): boolean {
    const profile = this.read()
    return Boolean(this.value?.authorized && this.value.townFaction === profile.faction
      && !profile.activeMission && !profile.activeOutpostMission && !this.player().dead)
  }
  owns(npc: NPC): boolean { return this.actors.includes(npc) }
  accepts(npc: NPC): boolean { return Boolean(this.value?.authorized && this.owns(npc)
    && (this.townHostile || !this.isReturning(npc.combatantId))) }
  get combatActors(): NPC[] {
    return this.value?.authorized ? this.actors.filter(npc => !npc.dead
      && (this.townHostile || this.value!.members?.[npc.combatantId]?.status === 'deployed')
      && !this.ownsPeacefulTravel(npc)) : []
  }
  ownsPeacefulTravel(npc: NPC): boolean { return !this.townHostile && this.owns(npc) && this.isReturning(npc.combatantId) }
  private get townHostile(): boolean { return this.read().townEvent?.state === 'hostile' }
  isReserveAvailable(actorId: string): boolean { return this.value?.sceneKey !== this.sceneKey || !this.value?.actorIds.includes(actorId) || !this.isReturning(actorId) && !this.value.authorized }
  private isReturning(id: string): boolean {
    const saved = this.value?.members?.[id]
    return Boolean(saved?.status !== 'dead' && saved?.formation?.commandId === TOWN_COMMAND_RETURN_ID && !saved.formation.reached)
  }

  /** Initial load restores saved residents before granting. No casualty is healed here. */
  restore(): boolean {
    const saved = this.read().townCommandSquad
    if (saved?.townFaction === this.read().faction) this.applySavedState(saved, true)
    return this.grant()
  }

  /** Save membership first; Captain promotion and post-mission recovery use the same entry point. */
  grant(): boolean {
    const profile = this.read()
    if (!['captain', 'commander'].includes(profile.rank) || profile.activeMission || profile.activeOutpostMission
      || this.sceneKey !== 'town-home') return true
    if (this.value?.authorized && this.value.townFaction === profile.faction) return true
    const ids = this.value?.townFaction === profile.faction ? this.value.actorIds
      : townCommandSquadRoster(profile.faction, this.residents.map(resident => resident.spec)).map(spec => spec.id)
    // A partial initialization must never mint replacement soldiers or silently reduce the permanent roster.
    if (ids.length !== 30 || ids.some(id => !this.residentsById.has(id))) return false
    const value: TownCommandSquadState = { type: 'town-command', squadId: 1, townFaction: profile.faction,
      actorIds: [...ids], contribution: this.value?.contribution ?? emptyPersonalContribution(),
      sceneKey: this.sceneKey, state: this.value?.state ?? 'TRAINING', authorized: true,
      members: this.snapshotMembers(ids, this.value?.members) }
    const next = cloneCareerProfile(profile); next.townCommandSquad = value
    if (next.townEvent?.state === 'hostile' && next.townEvent.authorizedTownCommandActorIds === undefined) {
      next.townEvent.authorizedTownCommandActorIds = [...ids]
    }
    if (!this.commit(next)) return false
    this.applySavedState(value)
    return true
  }

  checkpoint(): TownCommandSquadState | undefined {
    if (!this.value) return undefined
    const value = cloneTownCommandSquad(this.value)
    // A foreign battle carries the home snapshot without materializing a second resident instance.
    if (this.sceneKey === value.sceneKey) value.members = this.snapshotMembers(value.actorIds, value.members)
    return value
  }

  /** Pure transaction staging. Caller saves this together with the accepted mission before applying it. */
  stageMissionHandoff(current: CareerProfile): CareerProfile {
    const next = cloneCareerProfile(current), saved = this.checkpoint() ?? next.townCommandSquad
    if (!saved) return next
    const value = cloneTownCommandSquad(saved)
    value.authorized = false
    value.members ??= {}
    let returning = false
    for (const id of value.actorIds) {
      const resident = this.residentsById.get(id), actor = value.members[id]
      if (!resident || !actor || actor.status === 'dead') continue
      const atHome = Math.hypot(resident.npc.combatPosition.x - resident.spec.x, resident.npc.combatPosition.z - resident.spec.z) <= 2
      if (atHome) { actor.status = 'reserve'; actor.order = 'attack'; delete actor.formation; continue }
      this.stageReturn(actor, resident.spec); returning = true
    }
    value.state = returning ? 'RETURNING' : 'TRAINING'
    next.townCommandSquad = value
    return next
  }

  /** Apply only after the containing profile transaction succeeds. Does not reposition or restore HP. */
  applySavedState(saved: TownCommandSquadState | undefined, restore = false): void {
    const previous = this.value
    this.value = saved ? cloneTownCommandSquad(saved) : undefined
    if (previous) for (const id of previous.actorIds) if (!this.value?.actorIds.includes(id)) {
      const npc = this.residentsById.get(id)?.npc
      if (npc) { npc.combatOwnership = undefined; npc.setCommandAllegiance(Faction.TOWN) }
    }
    if (!this.value || this.value.sceneKey !== this.sceneKey) return
    for (const [index, id] of this.value.actorIds.entries()) {
      const resident = this.residentsById.get(id)
      if (!resident) continue
      const npc = resident.npc, actor = this.value.members?.[id]
      if (restore && actor) restoreCommandActor(npc, actor, resident.homeMount)
      npc.combatOwnership = this.value.authorized ? 'town-command' : undefined
      npc.setCommandAllegiance(this.value.authorized ? Faction.PLAYER : Faction.TOWN)
      npc.setCommandSquad(this.value.authorized ? 1 : undefined)
      npc.setTownPeaceful()
      if (!actor || npc.dead) continue
      if (restore && this.value.authorized && this.townHostile) this.interruptReturn(npc, actor)
      if (this.isReturning(id)) this.applyReturn(npc, actor)
      else if (actor.status === 'deployed' && actor.order === 'follow') npc.assignFollowTarget(this.player(), index,
        officialFollowLocalOffset(index, npc.isMounted, Boolean(this.read().personalSquad?.members.length)))
    }
  }

  /** Follow and Dismiss remain physical movement. Other orders are subsequently assigned by the common command UI. */
  issue(order: TacticalOrder | 'dismiss', target: ArmyCommandTarget = 'all'): boolean {
    if (!this.commandsEnabled) return false
    const selected = this.actors.filter(npc => !npc.dead && this.accepts(npc) && matchesArmyCommandTarget(npc, target))
    if (!selected.length) return false
    const value = this.checkpoint()!
    value.members ??= {}
    for (const npc of selected) {
      const resident = this.residentsById.get(npc.combatantId)!, actor = value.members[npc.combatantId]
      if (order === 'dismiss') this.stageReturn(actor, resident.spec)
      else { actor.status = 'deployed'; actor.order = order; if (order !== 'formation') delete actor.formation }
    }
    value.state = order === 'dismiss' ? 'RETURNING' : 'FOLLOWING'
    const next = cloneCareerProfile(this.read()); next.townCommandSquad = value
    if (!this.commit(next)) return false
    this.applySavedState(value)
    return true
  }

  /** Hostility keeps Player allegiance and hands returning soldiers back to normal command/combat. */
  beginHostility(): void {
    if (!this.value?.authorized) return
    for (const npc of this.actors) {
      npc.setTownPeaceful(); npc.setCommandAllegiance(Faction.PLAYER)
      const actor = this.value.members?.[npc.combatantId]
      if (actor && !npc.dead) this.interruptReturn(npc, actor)
    }
  }

  private interruptReturn(npc: NPC, actor: PersonalActorCheckpoint): void {
    if (!this.isReturning(npc.combatantId)) return
    actor.status = 'deployed'; actor.order = 'attack'; delete actor.formation
    this.value!.state = 'FOLLOWING'
    npc.setTacticalOrder('attack')
  }

  beginFrame(): void {
    this.grid.clear()
    for (const resident of this.residents) if (!resident.npc.dead) this.grid.insert(resident.npc)
  }

  /** Common scene combat owns deployed actors; only asynchronous home returns are updated here. */
  updateResident(resident: TownCommandResident, dt: number, camera: THREE.Vector3,
    obstacles: ObstacleData[], navigation: NavigationWorld): boolean {
    if (!this.ownsPeacefulTravel(resident.npc) || this.sceneKey !== this.value?.sceneKey) return false
    const npc = resident.npc, actor = this.value.members![npc.combatantId]
    if (npc.dead) { actor.status = 'dead'; return true }
    if (npc.formationCommandId !== TOWN_COMMAND_RETURN_ID) this.applyReturn(npc, actor)
    npc.updateTownTravel(dt, npc.combatPosition.distanceTo(camera), this.grid.getNearbyInto(npc.combatPosition, 4, this.nearby), obstacles, navigation)
    if (npc.isFormationTargetReached(TOWN_COMMAND_RETURN_ID)) {
      actor.status = 'reserve'; actor.order = 'attack'; delete actor.formation
      npc.setTacticalOrder('attack'); npc.setTownPeaceful()
      if (!this.value.actorIds.some(id => this.isReturning(id))) this.value.state = 'TRAINING'
    }
    return true
  }

  private stageReturn(actor: PersonalActorCheckpoint, spec: TownActorSpec): void {
    actor.status = 'deployed'; actor.order = 'formation'
    actor.formation = { commandId: TOWN_COMMAND_RETURN_ID,
      position: { x: spec.x, y: getTerrainHeight(spec.x, spec.z), z: spec.z, yaw: spec.yaw ?? Math.PI },
      reached: false, speedLimit: spec.mounted ? 7.5 : 2.2, arrivalOrder: 'attack' }
  }
  private applyReturn(npc: NPC, actor: PersonalActorCheckpoint): void {
    const f = actor.formation!, p = f.position
    npc.clearEncounter()
    npc.assignFormationTarget(TOWN_COMMAND_RETURN_ID, new THREE.Vector3(p.x, p.y ?? getTerrainHeight(p.x, p.z), p.z),
      new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw)), npc.isMounted ? f.speedLimit : 2.2, 'attack')
  }
  private snapshotMembers(ids: readonly string[], previous: TownCommandSquadState['members']): Record<string, PersonalActorCheckpoint> {
    return Object.fromEntries(ids.flatMap(id => {
      const resident = this.residentsById.get(id)
      if (!resident) return previous?.[id] ? [[id, previous[id]]] : []
      const saved = previous?.[id]
      const actor = snapshotCommandActor(resident.npc, resident.homeMount, saved?.status === 'reserve' ? 'reserve' : saved?.status ?? 'reserve')
      // Return travel completes into attack and then training; do not recreate a completed return from old state.
      if (saved?.formation?.commandId === TOWN_COMMAND_RETURN_ID && actor.status !== 'reserve') actor.formation = resident.npc.combatFormationCheckpoint ?? saved.formation
      return [[id, actor]]
    }))
  }
}
