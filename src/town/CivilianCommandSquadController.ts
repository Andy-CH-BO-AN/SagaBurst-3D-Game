import { CIVILIAN_HOME_LAYOUT_VERSION, migrateCivilianHomes } from './TownCivilianLife'
import * as THREE from 'three'
import { matchesArmyCommandTarget, type ArmyCommandTarget } from '../battle/CommandTarget'
import { officialFollowLocalOffset } from '../battle/FollowOrder'
import type { TacticalOrder } from '../battle/TacticalOrder'
import { civilianCommandRoster, cloneCivilianCommandSquad, type CivilianCommandOwner, type CivilianCommandSquadState } from '../career/CivilianCommandAuthority'
import type { PersonalActorCheckpoint } from '../career/CareerPersonalSquadMission'
import { refitCommandActor, refitCommandCheckpoint, restoreCommandActor, snapshotCommandActor } from '../career/CareerCommandActorCheckpoint'
import { cloneCareerProfile, type CareerProfile } from '../career/CareerProfile'
import type { NavigationWorld } from '../navigation/NavigationWorld'
import type { Mount } from '../world/Mount'
import type { Player } from '../player/Player'
import { Faction, type NPC } from '../world/NPC'
import { getTerrainHeight, type ObstacleData } from '../world/Terrain'
import { CIVILIAN_PROFILE, townRoster, type TownActorSpec } from './TownRules'

export const CIVILIAN_COMMAND_RETURN_ID = -4500
export interface CivilianCommandResident { spec: TownActorSpec; npc: NPC; homeMount?: Mount }
/** HUD consumers need current status, HP and orders, never actor poses or formations. */
export interface CivilianCommandHudState {
  readonly sceneKey: string
  readonly townFaction: CivilianCommandSquadState['townFaction']
  readonly missionId?: string
  readonly actorIds: readonly string[]
  readonly members: Readonly<Record<string, Readonly<Pick<PersonalActorCheckpoint, 'status' | 'hp' | 'order'>>>>
}
interface CivilianCommandOptions {
  sceneKey: string
  townFaction: CareerProfile['faction']
  refitSceneKey?: string
  hasMountedCivilianClearance?(point: { x: number; z: number }, actorId: string): boolean
  canPlaceMountedCivilian?(point: { x: number; z: number }, actorId: string): boolean
  canRefit?(actors: readonly NPC[], orders: readonly TacticalOrder[]): boolean
  onClaim?(npc: NPC): void
  onRelease?(npc: NPC, owner: CivilianCommandOwner): void
}

/** Borrows resident movement, never actors, and delegates all tactical behavior to native NPC orders. */
export class CivilianCommandSquadController {
  private value?: CivilianCommandSquadState
  private readonly residentsById: Map<string, CivilianCommandResident>
  private serviceRoster?: string[]

  constructor(residents: readonly CivilianCommandResident[], private readonly player: () => Player,
    private readonly read: () => CareerProfile, private readonly commit: (profile: CareerProfile) => boolean,
    private readonly options: CivilianCommandOptions) {
    const ids = new Set(civilianCommandRoster(residents.map(resident => resident.spec)))
    this.residentsById = new Map(residents.filter(resident => ids.has(resident.spec.id)
      && resident.spec.id === resident.npc.combatantId).map(resident => [resident.spec.id, resident]))
  }

  private get scopeAllowed(): boolean {
    const profile = this.read(), mission = profile.activeMission
    return profile.rank === 'commander' && profile.faction === this.options.townFaction
      && profile.townEvent?.state !== 'hostile' && !profile.activeOutpostMission
      && (!mission || mission.kind === 'town-defense' && !mission.result && mission.phase !== 'RETURNING'
        && mission.phase !== 'RESULT' && mission.phase !== 'RESET')
  }
  private get matchesScene(): boolean {
    return this.value?.sceneKey === this.options.sceneKey && this.value.townFaction === this.options.townFaction
  }
  get commandsEnabled(): boolean {
    return this.scopeAllowed && this.matchesScene && this.value?.missionId === this.read().activeMission?.id && !this.player().dead
  }
  get actors(): NPC[] { return this.matchesScene ? this.value!.actorIds.flatMap(id => this.residentsById.get(id)?.npc ?? []) : [] }
  get hudState(): CivilianCommandHudState | undefined {
    if (!this.commandsEnabled) return undefined
    const value = this.value!, members: Record<string, Pick<PersonalActorCheckpoint, 'status' | 'hp' | 'order'>> = {}
    const actorIds = value.actorIds.filter(id => {
      const npc = this.residentsById.get(id)?.npc
      if (!npc || !this.validIdentity(npc)) return false
      members[id] = { status: npc.dead ? 'dead' : value.members[id]?.status === 'exited' ? 'exited' : 'deployed',
        hp: npc.hp, order: npc.tacticalOrder }
      return true
    })
    return { sceneKey: value.sceneKey, townFaction: value.townFaction, missionId: value.missionId, actorIds, members }
  }
  get hasCheckpoint(): boolean { return this.value !== undefined }
  private get refitIds(): readonly string[] { return this.serviceRoster ??= civilianCommandRoster(townRoster()) }
  /** Permanent production membership keeps even an entirely dead squad visible. */
  get refitSquad(): { alive: number; total: number } {
    return { alive: this.refitIds.filter(id => this.residentsById.get(id)?.npc.dead === false).length, total: this.refitIds.length }
  }
  canRefit(): boolean {
    const profile = this.read()
    if (!this.commandsEnabled || this.options.refitSceneKey !== 'town-home'
      || profile.activeMission || profile.activeOutpostMission || profile.townEvent?.state === 'hostile') return false
    if (this.refitIds.some(id => !this.value!.actorIds.includes(id)
      || !this.residentsById.has(id) || !this.validIdentity(this.residentsById.get(id)!.npc))) return false
    const mounts = new Set<Mount>()
    for (const id of this.refitIds) {
      const { npc, homeMount } = this.residentsById.get(id)!
      if (!homeMount) continue
      if (mounts.has(homeMount) || homeMount.disposed || homeMount.riderPlayer
        || homeMount.riderNpc && homeMount.riderNpc !== npc || npc.mount && npc.mount !== homeMount) return false
      if (this.options.canPlaceMountedCivilian && this.residentsById.get(id)!.spec.role === 'civilian'
        && (homeMount.dead || npc.dead || npc.isFalling)) {
        const point = npc.dead || npc.isFalling ? this.residentsById.get(id)!.spec : npc.combatPosition
        if (!this.options.canPlaceMountedCivilian(point, id)
          && (this.owner(npc) !== 'daily' || !this.options.canPlaceMountedCivilian(this.residentsById.get(id)!.spec, id))) return false
      }
      mounts.add(homeMount)
    }
    const actors = this.refitIds.map(id => this.residentsById.get(id)!.npc)
    // Daily AI's attack default is not a player command. Retain all actors for contact cooldowns.
    const orders = actors.filter(npc => !npc.dead && this.owner(npc) === 'player').map(npc => npc.tacticalOrder)
    return this.options.canRefit?.(actors, orders) ?? false
  }
  /** Stage existing identities, save once, then revive the same borrowed objects. */
  refit(): boolean {
    if (!this.canRefit()) return false
    const value = this.checkpoint()!
    for (const id of this.refitIds) {
      const { npc, spec, homeMount } = this.residentsById.get(id)!, previous = this.value!.members[id]
      const member = value.members[id] = refitCommandCheckpoint(npc, homeMount)
      const respawnAtHome = homeMount?.dead && spec.role === 'civilian' && value.owners[id] === 'daily'
        && this.options.canPlaceMountedCivilian && !this.options.canPlaceMountedCivilian(npc.combatPosition, id)
      if (npc.dead || npc.isFalling || respawnAtHome) {
        member.position = {
          x: spec.x, y: spec.y ?? getTerrainHeight(spec.x, spec.z), z: spec.z, yaw: spec.yaw ?? 0,
        }
      }
      if (spec.role === 'civilian' && member.mount?.mounted && member.position && (npc.dead || npc.isFalling || homeMount?.dead)) {
        member.mount.position = { ...member.position }
      }
      if (value.owners[id] === 'returning') this.stageReturn(value, id, spec)
      else if (value.owners[id] === 'player') {
        // A dead squad cannot accept a new order; don't revive an obsolete Attack/Charge.
        if (npc.dead && (member.order === 'attack' || member.order === 'charge')) {
          member.order = 'defend'; delete member.formation
        }
        if (member.order === 'formation' && !member.formation) {
          if (previous?.formation) member.formation = previous.formation
          else member.order = 'defend'
        }
      } else {
        value.owners[id] = 'daily'; member.order = 'attack'; delete member.formation
      }
    }
    const next = cloneCareerProfile(this.read()); next.civilianCommandSquad = value
    if (!this.commit(next)) return false
    this.value = cloneCivilianCommandSquad(value)
    for (const id of this.refitIds) {
      const { npc, homeMount } = this.residentsById.get(id)!
      refitCommandActor(npc, homeMount)
      restoreCommandActor(npc, value.members[id], homeMount)
    }
    this.applyOwners(true)
    return true
  }
  /** Per-frame gate reads scalar lifecycle state; pose and nonlethal damage use the periodic save. */
  get criticalSignature(): string | undefined {
    const value = this.value
    if (!value) return undefined
    return JSON.stringify([value.sceneKey, value.townFaction, value.missionId, value.actorIds.map(id => {
      const npc = this.residentsById.get(id)?.npc, saved = value.members[id]
      const returningFormation = value.owners[id] === 'returning' ? saved?.formation : undefined
      const liveFormationId = npc?.formationCommandId, formationId = liveFormationId ?? returningFormation?.commandId
      const reached = liveFormationId != null ? npc!.isFormationTargetReached(liveFormationId) : returningFormation?.reached
      const status = npc ? npc.dead ? 'dead' : saved?.status === 'exited' ? 'exited' : 'deployed' : saved?.status
      return [id, value.owners[id], status,
        (npc?.hp ?? saved?.hp) === 0, npc?.tacticalOrder ?? saved?.order, formationId, reached]
    })])
  }
  get returningActorIds(): readonly string[] { return this.actors.filter(npc => this.ownsPeacefulTravel(npc)).map(npc => npc.combatantId) }
  get combatActors(): NPC[] { return this.actors.filter(npc => !npc.dead && this.ownsPlayerCommand(npc)) }
  owns(npc: NPC): boolean { return this.matchesScene && this.residentsById.get(npc.combatantId)?.npc === npc && Boolean(this.value?.actorIds.includes(npc.combatantId)) }
  owner(npc: NPC): CivilianCommandOwner | undefined { return this.owns(npc) ? this.value?.owners[npc.combatantId] : undefined }
  ownsPlayerCommand(npc: NPC): boolean { return this.scopeAllowed && this.matchesScene && this.value?.missionId === this.read().activeMission?.id
    && this.owner(npc) === 'player' && this.validActor(npc) }
  ownsPeacefulTravel(npc: NPC): boolean { return this.owns(npc) && this.owner(npc) === 'returning' && this.validActor(npc) }
  accepts(npc: NPC): boolean { return this.commandsEnabled && this.owns(npc) && this.validActor(npc) && this.owner(npc) !== 'returning' && this.value?.members[npc.combatantId]?.status !== 'exited' }
  private validActor(npc: NPC): boolean { return !npc.dead && this.validIdentity(npc) }
  private validIdentity(npc: NPC): boolean {
    return !npc.hostileToPlayer && npc.townCategory === 'civilian'
      && (npc.faction === Faction.TOWN && !npc.combatOwnership
        || npc.faction === Faction.PLAYER && npc.combatOwnership === 'player-civilian'
          && this.value?.actorIds.includes(npc.combatantId) === true)
  }

  /** Restore only the same existing objects, including deaths, before resuming ownership. */
  restore(): boolean {
    const saved = this.read().civilianCommandSquad
    if (saved?.sceneKey === this.options.sceneKey && saved.townFaction === this.options.townFaction) {
      let restored = saved
      const profile = this.read()
      if (!profile.activeMission && !profile.activeOutpostMission && profile.townEvent?.state !== 'hostile') {
        const migrated = migrateCivilianHomes(saved, [...this.residentsById.values()].map(r => r.spec), this.options.canPlaceMountedCivilian, this.options.hasMountedCivilianClearance)
        if (migrated !== saved) {
          const next = cloneCareerProfile(profile); next.civilianCommandSquad = migrated
          // A denied save falls back to the original checkpoint, including its deaths.
          if (this.commit(next)) restored = migrated
        }
      }
      this.value = cloneCivilianCommandSquad(restored)
      this.value.actorIds = saved.actorIds.filter(id => this.residentsById.has(id))
      for (const npc of this.actors) {
        const member = this.value.members[npc.combatantId]
        if (member && this.validIdentity(npc)) restoreCommandActor(npc, member, this.residentsById.get(npc.combatantId)?.homeMount)
      }
      if (saved.missionId === this.read().activeMission?.id && this.scopeAllowed) this.applyOwners(true)
    }
    return this.synchronize()
  }

  /** A scene/mission transition releases claims; saving must succeed before any handoff. */
  synchronize(): boolean {
    const profile = this.read()
    if (profile.faction !== this.options.townFaction) return true
    if (!this.value) {
      if (!this.scopeAllowed) return true
      const actorIds = [...this.residentsById.keys()].filter(id => this.validIdentity(this.residentsById.get(id)!.npc)).sort()
      if (!actorIds.length) return true
      const value: CivilianCommandSquadState = { type: 'civilian-command', squadId: 'civilians',
        townFaction: profile.faction, sceneKey: this.options.sceneKey, homeLayoutVersion: CIVILIAN_HOME_LAYOUT_VERSION, ...(profile.activeMission ? { missionId: profile.activeMission.id } : {}),
        actorIds, owners: {}, members: {} }
      for (const id of actorIds) {
        value.owners[id] = this.defaultOwner(this.residentsById.get(id)!.spec)
        value.members[id] = snapshotCommandActor(this.residentsById.get(id)!.npc, this.residentsById.get(id)!.homeMount)
      }
      return this.save(value)
    }
    const contextChanged = this.value.missionId !== profile.activeMission?.id
    if (!contextChanged && (this.scopeAllowed || !Object.values(this.value.owners).includes('player'))) return true
    const value = this.checkpoint()!
    if (profile.activeMission) value.missionId = profile.activeMission.id
    else delete value.missionId
    for (const id of value.actorIds) {
      const resident = this.residentsById.get(id)
      if (!resident) continue
      if (resident.npc.dead) { value.owners[id] = this.defaultOwner(resident.spec); continue }
      const owner = value.owners[id]
      if (profile.activeMission?.kind === 'town-defense' && !profile.activeMission.result && resident.spec.role === 'civilian') {
        value.owners[id] = 'evacuation'; delete value.members[id].formation
      } else if (owner === 'player' || owner === 'evacuation') this.stageReturn(value, id, resident.spec)
    }
    return this.save(value)
  }

  checkpoint(): CivilianCommandSquadState | undefined {
    if (!this.value) return undefined
    const value = { ...this.value, members: { ...this.value.members } }
    for (const npc of this.actors) {
      const saved = value.members[npc.combatantId]
      value.members[npc.combatantId] = snapshotCommandActor(npc, this.residentsById.get(npc.combatantId)?.homeMount, saved?.status === 'exited' ? 'exited' : 'deployed')
      if (value.owners[npc.combatantId] === 'returning' && !npc.dead && !value.members[npc.combatantId].formation) {
        value.members[npc.combatantId].formation = saved?.formation
      }
    }
    // Keep the same canonical representation as profile clones so staged-change
    // detection cannot mistake snapshot property order for a new command transaction.
    return cloneCivilianCommandSquad(value)
  }

  /** Called before shared ArmyCommandController mutates Attack/Charge/Defend/Formation. */
  beforeIssue(order: TacticalOrder, target: ArmyCommandTarget, participants: readonly NPC[]): boolean {
    const selected = participants.filter(npc => this.accepts(npc) && matchesArmyCommandTarget(npc, target))
    if (!selected.length) return true
    return this.claim(order, selected)
  }
  /** Stages with other squad claims so ALL has one successful profile transaction. */
  stageCommand(current: CareerProfile, order: TacticalOrder | 'dismiss', target: ArmyCommandTarget,
    participants: readonly NPC[] = this.actors): CareerProfile | undefined {
    const selected = participants.filter(npc => this.accepts(npc) && matchesArmyCommandTarget(npc, target))
    if (!selected.length) return undefined
    const value = this.checkpoint()!
    for (const npc of selected) {
      const id = npc.combatantId, spec = this.residentsById.get(id)!.spec
      if (order === 'dismiss') {
        if (this.defaultOwner(spec) === 'evacuation') {
          value.owners[id] = 'evacuation'; value.members[id].order = 'attack'; delete value.members[id].formation
        } else this.stageReturn(value, id, spec)
      } else {
        value.owners[id] = 'player'; value.members[id].status = 'deployed'; value.members[id].order = order
        if (order !== 'formation') delete value.members[id].formation
      }
    }
    const next = cloneCareerProfile(current); next.civilianCommandSquad = value
    return next
  }
  /** Caller applies only after saving the staged profile, with no restoration/healing. */
  applySavedState(value: CivilianCommandSquadState | undefined): void {
    this.value = value ? cloneCivilianCommandSquad(value) : undefined
    this.applyOwners()
  }
  issue(order: TacticalOrder | 'dismiss', target: ArmyCommandTarget = 'all'): boolean {
    const next = this.stageCommand(this.read(), order, target)
    if (!next || !this.commit(next)) return false
    this.applySavedState(next.civilianCommandSquad)
    return true
  }
  private claim(order: TacticalOrder, selected: readonly NPC[]): boolean {
    const next = this.stageCommand(this.read(), order, 'squad:civilians', selected)
    if (!next || !this.commit(next)) return false
    this.applySavedState(next.civilianCommandSquad)
    return true
  }

  /** Returns are updated once by the scene's peaceful-resident path, never by a second simulation loop. */
  updateResident(resident: CivilianCommandResident, dt: number, camera: THREE.Vector3,
    obstacles: ObstacleData[], navigation: NavigationWorld): boolean {
    const npc = resident.npc
    if (this.ownsPlayerCommand(npc)) return true
    if (!this.ownsPeacefulTravel(npc)) return false
    if (npc.formationCommandId !== CIVILIAN_COMMAND_RETURN_ID) this.applyReturn(npc, this.value!.members[npc.combatantId])
    npc.updateTownTravel(dt, npc.combatPosition.distanceTo(camera), this.actors.filter(other => other !== npc && !other.dead), obstacles, navigation)
    if (npc.isFormationTargetReached(CIVILIAN_COMMAND_RETURN_ID)) {
      if (resident.spec.role === 'civilian' && Math.hypot(npc.combatPosition.x - resident.spec.x, npc.combatPosition.z - resident.spec.z) > 2) {
        const value = this.checkpoint()!; this.stageReturn(value, npc.combatantId, resident.spec); this.save(value); return true
      }
      const value = this.checkpoint()!, id = npc.combatantId
      value.owners[id] = this.defaultOwner(resident.spec)
      value.members[id].order = 'attack'; delete value.members[id].formation
      this.save(value)
    }
    return true
  }

  private defaultOwner(spec: TownActorSpec): CivilianCommandOwner {
    const mission = this.read().activeMission
    return spec.role === 'civilian' && mission?.kind === 'town-defense' && !mission.result ? 'evacuation' : 'daily'
  }
  private stageReturn(value: CivilianCommandSquadState, id: string, spec: TownActorSpec): void {
    const member = value.members[id]
    value.owners[id] = 'returning'; member.order = 'formation'
    member.formation = { commandId: CIVILIAN_COMMAND_RETURN_ID,
      position: { x: spec.x, y: getTerrainHeight(spec.x, spec.z), z: spec.z, yaw: spec.yaw ?? 0 },
      reached: false }
  }
  private applyReturn(npc: NPC, member: PersonalActorCheckpoint): void {
    if (!member.formation) return
    const f = member.formation, p = f.position
    npc.missionMovement = true; npc.setMissionCombatTarget(null); npc.clearEncounter(); npc.disarmTownCivilian(); npc.setTownPeaceful()
    npc.assignFormationTarget(CIVILIAN_COMMAND_RETURN_ID, new THREE.Vector3(p.x, p.y ?? getTerrainHeight(p.x, p.z), p.z),
      new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw)), undefined, undefined, f.reached)
  }
  private save(value: CivilianCommandSquadState): boolean {
    const next = cloneCareerProfile(this.read()); next.civilianCommandSquad = value
    if (!this.commit(next)) return false
    this.value = cloneCivilianCommandSquad(value)
    this.applyOwners()
    return true
  }
  private applyOwners(restore = false): void {
    for (const [index, npc] of this.actors.entries()) {
      if (npc.dead || !this.validActor(npc)) continue
      const id = npc.combatantId, owner = this.value!.owners[id], member = this.value!.members[id]
      npc.setCommandSquad('civilians')
      if (owner === 'player' && this.commandsEnabled) {
        npc.combatOwnership = 'player-civilian'; npc.setCommandAllegiance(Faction.PLAYER)
        npc.missionMovement = false; npc.setMissionCombatTarget(undefined); npc.assignSiegeObstacle(null)
        this.options.onClaim?.(npc)
        npc.armTownCivilian(CIVILIAN_PROFILE.retaliationWeapon)
        if (member.order === 'follow') npc.assignFollowTarget(this.player(), index, officialFollowLocalOffset(index, false, true))
        else if (member.order && member.order !== 'formation') npc.setTacticalOrder(member.order)
        else if (restore && member.formation) restoreCommandActor(npc, member, this.residentsById.get(npc.combatantId)?.homeMount)
      } else {
        npc.combatOwnership = undefined; npc.setCommandAllegiance(Faction.TOWN)
        if (owner === 'returning' && member.formation) this.applyReturn(npc, member)
        else if (owner === 'daily') { npc.missionMovement = false; npc.setTacticalOrder('attack'); npc.disarmTownCivilian(); npc.setTownPeaceful() }
        this.options.onRelease?.(npc, owner)
      }
    }
  }
}
