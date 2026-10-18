import { townStationSpec } from './TownGarrison'
import * as THREE from 'three'
import { officialFollowLocalOffset } from '../battle/FollowOrder'
import { matchesArmyCommandTarget, type ArmyCommandTarget } from '../battle/CommandTarget'
import type { FormationCommandAssignment } from '../battle/FormationController'
import type { TacticalOrder } from '../battle/TacticalOrder'
import {
  cloneTownCommandSquad,
  officialActorSquadId,
  townCommandIsPlayerControlled,
  type TownCommandNativeReturnState,
  type TownCommandSquadState,
} from '../career/CareerCommandAuthority'
import { refitCommandActor, refitCommandCheckpoint, restoreCommandActor, snapshotCommandActor } from '../career/CareerCommandActorCheckpoint'
import { commanderGateDefenseSlots, commanderTownCommandMembership } from '../career/CommanderTownRoster'
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

export interface TownCommandSquadOptions {
  sceneKey?: string
  canRefit?: (actors: readonly NPC[]) => boolean
  refitEngaged?: (resident: TownCommandResident) => boolean
  canRefitNative?: (resident: TownCommandResident) => boolean
  beginNativeRefit?: (resident: TownCommandResident) => void
  nativeRefitPending?: (resident: TownCommandResident) => boolean
  /** Native movement/combat owners are checked before the durable claim is written. */
  canClaimNative?: (resident: TownCommandResident) => boolean
  /** Runs only after the claim was saved. */
  claimNative?: (resident: TownCommandResident) => boolean
  /** Describes the native physical return that will own this actor after Dismiss. */
  nativeReturnOnRelease?: (resident: TownCommandResident) => TownCommandNativeReturnState | undefined
  /** Runs only after the release was saved. */
  releaseNative?: (resident: TownCommandResident) => void
  nativeReturnState?: (actorId: string) => TownCommandNativeReturnState | undefined
  restoreNativeReturn?: (actorId: string, state: TownCommandNativeReturnState) => void
}

/** Town owns every permanent resource. Captain borrows one fixed squad; Commander records the
 * canonical eight-squad membership while claiming individual ground actors only after a command. */
export class TownCommandSquadController {
  private value?: TownCommandSquadState
  private readonly residentsById = new Map<string, TownCommandResident>()
  private readonly grid = new SpatialGrid<NPC>(8)
  private readonly nearby: NPC[] = []
  private serviceRoster?: ReturnType<typeof commanderGateDefenseSlots>
  private commanderRefitRoster() { return this.serviceRoster ??= commanderGateDefenseSlots() }

  constructor(private readonly residents: readonly TownCommandResident[], private readonly player: () => Player,
    private readonly read: () => CareerProfile, private readonly commit: (profile: CareerProfile) => boolean,
    private readonly options: TownCommandSquadOptions = {}) {
    this.synchronizeResidents()
  }

  get hasCheckpoint(): boolean { return Boolean(this.value) }
  /** Cheap save trigger; full 210-member resource checkpoints are built only on actual saves. */
  get criticalSignature(): string {
    return JSON.stringify([this.value?.authorized, this.value?.state, this.value?.commandedActorIds,
      this.value?.actorIds.map(id => {
        const resident = this.residentsById.get(id)
        return [id, resident?.npc.dead, resident?.homeMount?.dead, this.value?.members?.[id]?.status,
          this.options.nativeReturnState?.(id), this.value?.refittingActorIds?.includes(id)
            && (resident ? this.options.nativeRefitPending?.(resident) : true)]
      })])
  }
  get state(): TownCommandSquadState['state'] | null { return this.value?.state ?? null }
  get sceneKey(): string { return this.options.sceneKey ?? 'town-home' }
  get authorizedActorIds(): readonly string[] { return this.value?.authorized ? this.value.actorIds : [] }
  /** Read-only HUD view of living residents physically returning through either real owner. */
  get returningActorIds(): readonly string[] {
    return this.commandsEnabled
      ? this.actors.filter(npc => !npc.dead && (this.ownsPeacefulTravel(npc) || this.isNativeReturning(npc.combatantId)))
        .map(npc => npc.combatantId)
      : []
  }
  /** Only the legacy Captain residents use the authored practice lifecycle. */
  get trainingActorIds(): readonly string[] {
    if (this.value?.commandRank === 'commander') return []
    return this.commandsEnabled && !this.townHostile
      ? this.actors.filter(npc => !npc.dead && !this.isReturning(npc.combatantId)
        && (this.value?.state === 'TRAINING' || this.value?.members?.[npc.combatantId]?.status === 'reserve'))
        .map(npc => npc.combatantId)
      : []
  }
  get actors(): NPC[] {
    this.synchronizeResidents()
    return this.value?.sceneKey === this.sceneKey
      ? this.value.actorIds.flatMap(id => this.residentsById.get(id)?.npc ?? []) : []
  }
  get commandsEnabled(): boolean {
    const profile = this.read()
    return Boolean(this.value?.authorized && this.value.townFaction === profile.faction
      && !profile.activeMission && !profile.activeOutpostMission && !this.player().dead)
  }
  owns(npc: NPC): boolean {
    return this.value?.sceneKey === this.sceneKey && this.residentsById.get(npc.combatantId)?.npc === npc
      && this.value.actorIds.includes(npc.combatantId)
  }
  accepts(npc: NPC): boolean {
    if (!this.commandsEnabled || npc.dead || !this.owns(npc)) return false
    const resident = this.residentsById.get(npc.combatantId)!
    if (this.delegatesRuntime(resident) || this.value?.refittingActorIds?.includes(resident.spec.id)
      && (this.options.nativeRefitPending?.(resident) ?? true)) return false
    if (this.townHostile) return true
    if (this.isReturning(npc.combatantId) || this.isNativeReturning(npc.combatantId)) return false
    if (this.isPlayerClaimed(npc.combatantId)) return true
    return this.canClaimNative(resident)
  }
  get combatActors(): NPC[] {
    if (!this.value?.authorized) return []
    return this.actors.filter(npc => {
      const resident = this.residentsById.get(npc.combatantId)!
      return !npc.dead && !this.delegatesRuntime(resident) && !this.ownsPeacefulTravel(npc)
        && !this.isNativeReturning(npc.combatantId)
        && (this.townHostile || this.isPlayerClaimed(npc.combatantId)
          && this.value!.members?.[npc.combatantId]?.status === 'deployed')
    })
  }
  ownsPeacefulTravel(npc: NPC): boolean { return !this.townHostile && this.owns(npc) && this.isReturning(npc.combatantId) }
  private get townHostile(): boolean { return this.read().townEvent?.state === 'hostile' }
  isReserveAvailable(actorId: string): boolean {
    if (this.value?.sceneKey !== this.sceneKey || !this.value.actorIds.includes(actorId)) return true
    if (this.isReturning(actorId) || this.isNativeReturning(actorId)) return false
    if (this.value.commandRank === 'commander') return !this.isPlayerClaimed(actorId)
    return !this.value.authorized
  }
  hasPlayerCommand(target: ArmyCommandTarget): boolean {
    if (!this.value?.authorized) return false
    const ids = this.value.commandRank === 'commander' ? this.value.commandedActorIds ?? [] : this.value.actorIds
    return ids.some(id => {
      const squadId = officialActorSquadId(this.value!, id)
      return squadId !== undefined && matchesArmyCommandTarget({ squadId }, target)
    })
  }
  private isReturning(id: string): boolean {
    const saved = this.value?.members?.[id]
    return Boolean(saved?.status !== 'dead' && saved?.formation?.commandId === TOWN_COMMAND_RETURN_ID && !saved.formation.reached)
  }
  private isNativeReturning(id: string): boolean { return Boolean(this.value?.nativeReturnStates?.[id]) }
  private isPlayerClaimed(id: string): boolean {
    return Boolean(this.value && townCommandIsPlayerControlled(this.value, id))
  }
  private delegatesRuntime(resident: TownCommandResident): boolean { return Boolean(resident.spec.eagle) }
  private canClaimNative(resident: TownCommandResident): boolean {
    const npc = resident.npc
    if (this.delegatesRuntime(resident) || npc.hostileToPlayer
      || npc.combatOwnership && npc.combatOwnership !== 'town-command'
      || npc.faction !== Faction.TOWN && npc.faction !== Faction.PLAYER) return false
    return this.options.canClaimNative?.(resident) ?? true
  }
  private synchronizeResidents(): void {
    for (const resident of this.residents) if (resident.spec.id === resident.npc.combatantId) {
      this.residentsById.set(resident.spec.id, resident)
    }
  }

  /** Initial load restores saved residents before granting. No casualty is healed here. */
  restore(): boolean {
    const saved = this.read().townCommandSquad
    if (saved?.townFaction === this.read().faction) this.applySavedState(saved, true)
    return this.grant()
  }

  /** Save canonical membership first. Promotion expands the old 30 without claiming the other 180. */
  grant(): boolean {
    this.synchronizeResidents()
    const profile = this.read()
    if (!['captain', 'commander'].includes(profile.rank) || profile.activeMission || profile.activeOutpostMission
      || this.sceneKey !== 'town-home') return true
    if (profile.rank === 'captain') {
      if (this.value?.authorized && this.value.townFaction === profile.faction && this.value.commandRank !== 'commander') return true
      const ids = this.value?.townFaction === profile.faction && this.value.commandRank !== 'commander' ? this.value.actorIds
        : townCommandSquadRoster(profile.faction, this.residents.map(resident => resident.spec)).map(spec => spec.id)
      // A partial initialization must never mint replacement soldiers or silently reduce the permanent roster.
      if (ids.length !== 30 || ids.some(id => !this.residentsById.has(id))) return false
      const value: TownCommandSquadState = { type: 'town-command', squadId: 1, townFaction: profile.faction,
        actorIds: [...ids], contribution: this.value?.contribution ?? emptyPersonalContribution(),
        sceneKey: this.sceneKey, state: this.value?.state ?? 'TRAINING', authorized: true,
        members: this.snapshotMembers(ids, this.value?.members) }
      return this.commitGrant(profile, value)
    }

    const membership = commanderTownCommandMembership(this.value?.townFaction === profile.faction ? this.value : undefined)
    const squads = membership.squads!
    const ids = membership.actorIds
    const sizes = [30, 30, 30, 30, 30, 30, 25, 5]
    if (squads.length !== 8 || ids.length !== 210 || new Set(ids).size !== ids.length
      || squads.some((squad, index) => squad.squadId !== index + 1 || squad.actorIds.length !== sizes[index])
      || ids.some(id => !this.residentsById.has(id))) return false
    if (this.value?.authorized && this.value.commandRank === 'commander'
      && this.value.townFaction === profile.faction && this.value.sceneKey === this.sceneKey
      && this.sameCommanderRoster(this.value, squads)) return true

    const previous = this.value?.townFaction === profile.faction ? this.value : undefined
    const value: TownCommandSquadState = { type: 'town-command', squadId: 1, townFaction: profile.faction,
      ...membership,
      contribution: previous?.contribution ?? emptyPersonalContribution(), sceneKey: this.sceneKey,
      state: previous?.state ?? 'TRAINING', authorized: true,
      members: this.snapshotMembers(ids, previous?.members),
    }
    return this.commitGrant(profile, value)
  }

  private commitGrant(profile: CareerProfile, value: TownCommandSquadState): boolean {
    const next = cloneCareerProfile(profile); next.townCommandSquad = value
    if (next.townEvent?.state === 'hostile'
      && (value.commandRank === 'commander' || next.townEvent.authorizedTownCommandActorIds === undefined)) {
      next.townEvent.authorizedTownCommandActorIds = [...value.actorIds]
    }
    if (!this.commit(next)) return false
    this.applySavedState(value)
    return true
  }

  private sameCommanderRoster(value: TownCommandSquadState, squads: NonNullable<TownCommandSquadState['squads']>): boolean {
    const actorIds = squads.flatMap(squad => squad.actorIds)
    return value.actorIds.length === actorIds.length
      && value.actorIds.every((id, index) => id === actorIds[index])
      && value.squads?.length === squads.length
      && squads.every((squad, index) => value.squads?.[index]?.squadId === squad.squadId
        && value.squads[index].actorIds.length === squad.actorIds.length
        && value.squads[index].actorIds.every((id, actorIndex) => id === squad.actorIds[actorIndex]))
  }

  checkpoint(): TownCommandSquadState | undefined {
    if (!this.value) return undefined
    const value = cloneTownCommandSquad(this.value)
    if (this.sceneKey !== value.sceneKey) return value
    value.members ??= {}
    for (const id of value.actorIds) {
      const resident = this.residentsById.get(id)
      if (!resident) continue
      value.members[id] = this.snapshotMember(resident, value.members[id])
    }
    if (value.commandRank === 'commander') {
      const nativeReturnStates: Record<string, TownCommandNativeReturnState> = {}
      for (const id of Object.keys(value.nativeReturnStates ?? {})) {
        const state = this.options.nativeReturnState?.(id)
        if (state) nativeReturnStates[id] = state
      }
      value.nativeReturnStates = Object.keys(nativeReturnStates).length ? nativeReturnStates : undefined
    }
    value.refittingActorIds = value.refittingActorIds?.filter(id => {
      const resident = this.residentsById.get(id)
      return resident && (this.options.nativeRefitPending?.(resident) ?? true)
    })
    if (!value.refittingActorIds?.length) delete value.refittingActorIds
    return value
  }

  /** Formal Town missions borrow the same identities; outpost transitions first return peaceful claims. */
  stageMissionHandoff(current: CareerProfile): CareerProfile {
    const next = cloneCareerProfile(current), saved = this.checkpoint() ?? next.townCommandSquad
    if (!saved) return next
    const value = cloneTownCommandSquad(saved)
    value.authorized = false
    value.members ??= {}
    if (value.commandRank === 'commander' && current.activeMission) {
      next.townCommandSquad = value
      return next
    }
    let returning = false
    for (const id of value.commandRank === 'commander' ? value.commandedActorIds ?? [] : value.actorIds) {
      const resident = this.residentsById.get(id), actor = value.members[id]
      if (!resident || !actor || this.delegatesRuntime(resident)) continue
      const native = value.commandRank === 'commander' ? this.options.nativeReturnOnRelease?.(resident) : undefined
      if (native) {
        value.commandedActorIds = value.commandedActorIds?.filter(actorId => actorId !== id)
        ;(value.nativeReturnStates ??= {})[id] = native
        delete actor.formation
        continue
      }
      if (actor.status === 'dead') {
        if (value.commandRank === 'commander') value.commandedActorIds = value.commandedActorIds?.filter(actorId => actorId !== id)
        continue
      }
      const atHome = Math.hypot(resident.npc.combatPosition.x - resident.spec.x, resident.npc.combatPosition.z - resident.spec.z) <= 2
      if (atHome) {
        actor.status = 'reserve'; actor.order = 'attack'; delete actor.formation
        if (value.commandRank === 'commander') value.commandedActorIds = value.commandedActorIds?.filter(actorId => actorId !== id)
        continue
      }
      this.stageReturn(actor, this.homeStation(resident)); returning = true
    }
    value.state = returning ? 'RETURNING' : 'TRAINING'
    next.townCommandSquad = value
    return next
  }

  /** Apply only after the containing profile transaction succeeds. */
  applySavedState(saved: TownCommandSquadState | undefined, restore = false): void {
    this.synchronizeResidents()
    const previous = this.value
    const previousClaims = new Set(previous?.commandRank === 'commander'
      ? previous.commandedActorIds ?? [] : previous?.authorized ? previous.actorIds : [])
    this.value = saved ? cloneTownCommandSquad(saved) : undefined
    if (previous) for (const id of previous.actorIds) if (!this.value?.actorIds.includes(id)) {
      const npc = this.residentsById.get(id)?.npc
      if (npc?.combatOwnership === 'town-command') { npc.combatOwnership = undefined; npc.setCommandAllegiance(Faction.TOWN) }
    }
    if (!this.value || this.value.sceneKey !== this.sceneKey) return
    const activeOfficialIds = new Set(this.read().activeMission?.officialSquad?.actorIds ?? [])
    for (const [index, id] of this.value.actorIds.entries()) {
      const resident = this.residentsById.get(id)
      if (!resident) continue
      const npc = resident.npc, actor = this.value.members?.[id]
      if (!restore && previous?.authorized === this.value.authorized && previous.sceneKey === this.value.sceneKey
        && previous.commandRank === this.value.commandRank
        && previousClaims.has(id) === this.isPlayerClaimed(id)
        && previous.nativeReturnStates?.[id] === this.value.nativeReturnStates?.[id]
        && JSON.stringify(previous.members?.[id]) === JSON.stringify(actor)) continue
      if (!restore && activeOfficialIds.has(id)) continue
      const squadId = officialActorSquadId(this.value, id) ?? 1
      if (this.delegatesRuntime(resident)) {
        if (this.commandsEnabled && !npc.combatOwnership) npc.setCommandSquad(squadId)
        continue
      }
      if (restore && actor && this.value.commandRank === 'commander' && !this.isPlayerClaimed(id)
        && resident.spec.duty !== 'patrol') restoreCommandActor(npc, actor, resident.homeMount)
      const nativeReturn = this.value.nativeReturnStates?.[id]
      if (nativeReturn) {
        if (restore && actor) restoreCommandActor(npc, actor, resident.homeMount)
        if (restore) this.options.restoreNativeReturn?.(id, nativeReturn)
        else if (previousClaims.has(id) || npc.combatOwnership === 'town-command') this.options.releaseNative?.(resident)
        if (npc.combatOwnership === 'town-command') npc.combatOwnership = undefined
        npc.setCommandAllegiance(Faction.TOWN); npc.setCommandSquad(this.commandsEnabled ? squadId : undefined); npc.setTownPeaceful()
        continue
      }
      const claimed = this.townHostile && this.value.authorized || this.isPlayerClaimed(id)
      const travel = this.isReturning(id)
      if (restore && travel && actor?.formation) actor.formation.position = {
        x: resident.spec.x, y: resident.spec.y ?? getTerrainHeight(resident.spec.x, resident.spec.z), z: resident.spec.z, yaw: resident.spec.yaw ?? Math.PI,
      }
      if (claimed || travel) {
        const nativeClaimed = npc.combatOwnership === 'town-command'
          || this.value.commandRank !== 'commander'
          || (restore || !previousClaims.has(id) ? this.options.claimNative?.(resident) ?? true : true)
        if (!nativeClaimed) continue
        if (restore && actor) restoreCommandActor(npc, actor, resident.homeMount)
        npc.combatOwnership = 'town-command'
        npc.setCommandAllegiance(claimed ? Faction.PLAYER : Faction.TOWN)
        npc.setCommandSquad(squadId); npc.setTownPeaceful()
        if (!actor || npc.dead) continue
        if (restore && this.value.authorized && this.townHostile) this.interruptReturn(npc, actor)
        if (this.isReturning(id)) this.applyReturn(npc, actor)
        else if (actor.status === 'deployed' && actor.order === 'follow') npc.assignFollowTarget(this.player(), index,
          officialFollowLocalOffset(index, npc.isMounted, Boolean(this.read().personalSquad?.members.length)))
        else if (actor.status === 'deployed' && actor.order && actor.order !== 'formation') npc.setTacticalOrder(actor.order)
        continue
      }
      if (previousClaims.has(id) || npc.combatOwnership === 'town-command') {
        if (npc.combatOwnership === 'town-command') npc.combatOwnership = undefined
        npc.setCommandAllegiance(Faction.TOWN); npc.setTownPeaceful()
      }
      npc.setCommandSquad(this.commandsEnabled ? squadId : undefined)
    }
  }

  /** Automatic map-transition repair retains its historical Captain boundary. Manual service is per squad. */
  private get refitActors(): NPC[] {
    if (this.value?.commandRank !== 'commander') return this.actors
    const ids = new Set(townCommandSquadRoster(this.value.townFaction, this.residents.map(resident => resident.spec)).map(spec => spec.id))
    return this.actors.filter(npc => ids.has(npc.combatantId))
  }
  private isNativeRefit(resident: TownCommandResident): boolean { return Boolean(resident.spec.eagle || resident.spec.duty === 'patrol') }
  /** Permanent membership, not living actors or HUD caches, defines the service menu. */
  get refitSquads(): { squadId: number; alive: number; total: number; pending: boolean }[] {
    const squads = this.value?.commandRank === 'commander' ? this.commanderRefitRoster()
      : this.value ? [{ squadId: 1, actorIds: this.value.actorIds }] : []
    return squads.map(squad => ({ squadId: squad.squadId, total: squad.actorIds.length,
      alive: squad.actorIds.filter(id => { const npc = this.residentsById.get(id)?.npc; return npc ? !npc.dead : this.value?.members?.[id]?.status !== 'dead' && (this.value?.members?.[id]?.hp ?? 0) > 0 }).length,
      pending: squad.actorIds.some(id => this.value?.refittingActorIds?.includes(id)
        && (this.options.nativeRefitPending?.(this.residentsById.get(id)!) ?? true)),
    }))
  }
  private refitIds(squadId: number): readonly string[] | undefined {
    if (!this.value || !Number.isInteger(squadId)) return undefined
    if (this.value.commandRank === 'commander') return this.commanderRefitRoster().find(s => s.squadId === squadId)?.actorIds
    const canonical = townCommandSquadRoster(this.value.townFaction, this.residents.map(r => r.spec)).map(a => a.id)
    return squadId === 1 && canonical.length === 30 && this.value.actorIds.length === 30
      && this.value.actorIds.every(id => canonical.includes(id)) ? this.value.actorIds : undefined
  }
  canRefitSquad(squadId: number): boolean {
    const ids = this.refitIds(squadId), profile = this.read()
    if (!['captain', 'commander'].includes(profile.rank) || this.value?.commandRank === 'commander' && profile.rank !== 'commander') return false
    if (!ids || !this.commandsEnabled || this.sceneKey !== 'town-home' || this.townHostile
      || ids.some(id => !this.value!.actorIds.includes(id) || !this.residentsById.has(id))) return false
    const residents = ids.map(id => this.residentsById.get(id)!), actors = residents.map(r => r.npc)
    return !this.refitSquads.find(s => s.squadId === squadId)?.pending
      && !residents.some(r => r.npc.combatOwnership && !['town-command', 'town-eagle-command'].includes(r.npc.combatOwnership)
        || r.homeMount?.riderPlayer || r.homeMount?.riderNpc && r.homeMount.riderNpc !== r.npc
        || r.homeMount && r.npc.mount && r.npc.mount !== r.homeMount
        || this.isReturning(r.spec.id) || this.isNativeReturning(r.spec.id)
        || !r.npc.dead && ((this.options.refitEngaged?.(r) ?? r.npc.inCombat) || this.value?.members?.[r.spec.id]?.status === 'deployed' && this.isPlayerClaimed(r.spec.id) && ['attack', 'charge'].includes(r.npc.tacticalOrder))
        || this.isNativeRefit(r) && !(this.options.canRefitNative?.(r) ?? false))
      && (this.options.canRefit?.(actors) ?? true)
  }
  get canRefit(): boolean { return this.canRefitSquad(1) }
  refit(squadId = 1): boolean {
    if (!this.canRefitSquad(squadId)) return false
    const ids = this.refitIds(squadId)!, next = cloneCareerProfile(this.read())
    const value = cloneTownCommandSquad(next.townCommandSquad ?? this.value!)
    value.members ??= {}
    for (const id of ids) {
      const resident = this.residentsById.get(id)!
      if (this.isNativeRefit(resident)) {
        value.members[id] = this.snapshotMember(resident, value.members[id])
        value.refittingActorIds = [...(value.refittingActorIds ?? []).filter(other => other !== id), id]
        if (resident.spec.duty === 'patrol') {
          ;(value.nativeReturnStates ??= {})[id] = 'RETURN_TO_BARRACKS'
          value.commandedActorIds = value.commandedActorIds?.filter(other => other !== id)
        }
        continue
      }
      value.members[id] = this.refitMember(resident, value.members[id])
    }
    next.townCommandSquad = value
    // Refit releases only selected native air claims; other squads keep their exact intent.
    if (next.townAirCommandSquad) next.townAirCommandSquad.commandedActorIds = next.townAirCommandSquad.commandedActorIds.filter(id => !ids.includes(id))
    if (!this.commit(next)) return false
    this.applySavedState(value)
    for (const id of ids) {
      const resident = this.residentsById.get(id)!
      if (this.isNativeRefit(resident)) this.options.beginNativeRefit?.(resident)
      else {
        refitCommandActor(resident.npc, resident.homeMount)
        restoreCommandActor(resident.npc, value.members[id], resident.homeMount)
        if (value.members[id].status === 'reserve') resident.npc.setTownPeaceful()
      }
    }
    // Reapply selected Follow intent after resurrection without touching other squads.
    this.applySelectedOrders(ids)
    return true
  }
  private refitMember(resident: TownCommandResident, previous?: PersonalActorCheckpoint): PersonalActorCheckpoint {
    const { npc, homeMount } = resident
    const spec = this.homeStation(resident)
    const claimed = this.isPlayerClaimed(spec.id)
    const member = refitCommandCheckpoint(npc, homeMount, claimed && previous?.status === 'deployed' ? 'deployed' : 'reserve')
    if (npc.dead || npc.isFalling || homeMount?.dead) {
      member.position = { x: spec.x, y: spec.y ?? getTerrainHeight(spec.x, spec.z), z: spec.z, yaw: spec.yaw ?? Math.PI }
      member.status = claimed && previous?.status === 'deployed' ? 'deployed' : 'reserve'; member.order = 'attack'; delete member.formation
      if (member.mount) { member.mount.position = { ...member.position }; member.mount.mounted = true }
      if (spec.garrison?.kind === 'rampart' && !homeMount) member.townRampartGarrison = true
    }
    return member
  }
  private applySelectedOrders(ids: readonly string[]): void {
    for (const id of ids) {
      const npc = this.residentsById.get(id)!.npc, actor = this.value?.members?.[id]
      if (actor?.status === 'deployed' && actor.order === 'follow' && !this.isNativeRefit(this.residentsById.get(id)!))
        npc.assignFollowTarget(this.player(), this.value!.actorIds.indexOf(id), officialFollowLocalOffset(this.value!.actorIds.indexOf(id), npc.isMounted, Boolean(this.read().personalSquad?.members.length)))
    }
  }
  /** Native requests survive reload; each physical owner resumes its own saved lifecycle. */
  resumeRefits(): void {
    for (const id of this.value?.refittingActorIds ?? []) {
      const resident = this.residentsById.get(id)
      if (resident && this.isNativeRefit(resident)) this.options.beginNativeRefit?.(resident)
    }
  }

  /** Automatic refit shares the service's resource staging, without its peace-only gate. */
  stageRefit(current: CareerProfile, defenseStart = false): CareerProfile {
    const next = cloneCareerProfile(current), value = this.checkpoint() ?? next.townCommandSquad
    if (!value) return next
    value.members ??= {}
    for (const npc of this.refitActors) {
      const resident = this.residentsById.get(npc.combatantId)!
      const status = defenseStart || value.members[npc.combatantId]?.status === 'reserve' ? 'reserve' : 'deployed'
      const member = refitCommandCheckpoint(npc, resident.homeMount, status)
      if (defenseStart) {
        member.order = 'attack'; delete member.formation
        const spec = this.homeStation(resident)
        member.position = { x: spec.x, y: spec.y, z: spec.z, yaw: spec.yaw ?? Math.PI }
        if (member.mount) member.mount.position = { ...member.position }
      }
      value.members[npc.combatantId] = member
    }
    if (defenseStart) { value.authorized = false; value.state = 'TRAINING' }
    next.townCommandSquad = value
    return next
  }

  /** Call only after saving and completing the Player's return, or a manual refit. */
  applyRefit(value: TownCommandSquadState | undefined): void {
    for (const npc of this.refitActors) refitCommandActor(npc, this.residentsById.get(npc.combatantId)!.homeMount)
    this.applySavedState(value)
  }

  /** Pure command staging lets ALL commit official, HR, civilian and air ownership exactly once. */
  stageCommand(current: CareerProfile, order: TacticalOrder | 'dismiss', target: ArmyCommandTarget,
    participants: readonly NPC[], assignments: readonly FormationCommandAssignment[] = []): CareerProfile | undefined {
    if (!this.commandsEnabled || !this.value) return undefined
    const value = this.checkpoint()!
    value.members ??= {}
    if (value.commandRank !== 'commander') {
      const selected = participants.filter(npc => this.accepts(npc) && matchesArmyCommandTarget(npc, target))
      if (!selected.length) return undefined
      for (const npc of selected) {
        const resident = this.residentsById.get(npc.combatantId)!, actor = value.members[npc.combatantId]
        if (order === 'dismiss') this.stageReturn(actor, this.homeStation(resident))
        else this.stageOrder(actor, npc, order, assignments)
      }
      value.state = order === 'dismiss' ? 'RETURNING' : 'FOLLOWING'
    } else if (order === 'dismiss') {
      const commanded = new Set(value.commandedActorIds ?? [])
      const selectedIds = [...commanded].filter(id => {
        const squadId = officialActorSquadId(value, id), resident = this.residentsById.get(id)
        return squadId !== undefined && resident && !this.delegatesRuntime(resident)
          && matchesArmyCommandTarget({ squadId }, target)
      })
      if (!selectedIds.length) return undefined
      for (const id of selectedIds) {
        const resident = this.residentsById.get(id)!, actor = value.members[id]
        value.members[id] = this.snapshotMember(resident, actor)
        const member = value.members[id]
        const native = this.options.nativeReturnOnRelease?.(resident)
        if (native) {
          commanded.delete(id); (value.nativeReturnStates ??= {})[id] = native
          delete member.formation
        } else if (resident.npc.dead || member.status === 'dead') {
          commanded.delete(id); member.status = 'dead'; delete member.formation
        } else this.stageReturn(member, this.homeStation(resident))
      }
      value.commandedActorIds = value.actorIds.filter(id => commanded.has(id))
      value.state = value.commandedActorIds.some(id => value.members?.[id]?.formation?.commandId === TOWN_COMMAND_RETURN_ID)
        ? 'RETURNING' : value.commandedActorIds.length ? 'FOLLOWING' : 'TRAINING'
    } else {
      const selected = participants.filter(npc => this.accepts(npc) && matchesArmyCommandTarget(npc, target))
      if (!selected.length) return undefined
      const commanded = new Set(value.commandedActorIds ?? [])
      let accepted = false
      for (const npc of selected) {
        const resident = this.residentsById.get(npc.combatantId)!
        if (this.delegatesRuntime(resident)) continue
        value.members[npc.combatantId] = this.snapshotMember(resident, value.members[npc.combatantId])
        this.stageOrder(value.members[npc.combatantId], npc, order, assignments)
        commanded.add(npc.combatantId); accepted = true
        if (value.nativeReturnStates) delete value.nativeReturnStates[npc.combatantId]
      }
      if (!accepted) return undefined
      value.commandedActorIds = value.actorIds.filter(id => commanded.has(id))
      if (value.nativeReturnStates && !Object.keys(value.nativeReturnStates).length) delete value.nativeReturnStates
      value.state = 'FOLLOWING'
    }
    const next = cloneCareerProfile(current); next.townCommandSquad = value
    return next
  }

  issue(order: TacticalOrder | 'dismiss', target: ArmyCommandTarget = 'all'): boolean {
    if (!this.commandsEnabled) return false
    const participants = this.actors.filter(npc => !npc.dead && this.accepts(npc) && matchesArmyCommandTarget(npc, target))
    const next = this.stageCommand(this.read(), order, target, participants)
    if (!next || !this.commit(next)) return false
    this.applySavedState(next.townCommandSquad)
    return true
  }

  /** A restored historical hostile event retains the saved loyal Town army. */
  beginHostility(): void {
    if (!this.value?.authorized) return
    if (this.value.commandRank === 'commander') {
      this.value.commandedActorIds = this.value.actorIds.filter(id => {
        const resident = this.residentsById.get(id)
        return resident && !this.delegatesRuntime(resident)
      })
      delete this.value.nativeReturnStates
    }
    for (const npc of this.actors) {
      const resident = this.residentsById.get(npc.combatantId)!
      if (this.delegatesRuntime(resident)) continue
      npc.setTownPeaceful(); npc.setCommandAllegiance(Faction.PLAYER); npc.combatOwnership = 'town-command'
      npc.setCommandSquad(officialActorSquadId(this.value, npc.combatantId) ?? 1)
      const actor = this.value.members?.[npc.combatantId]
      if (actor && !npc.dead) this.interruptReturn(npc, actor)
    }
  }

  private interruptReturn(npc: NPC, actor: PersonalActorCheckpoint): void {
    if (!this.isReturning(npc.combatantId)) return
    actor.status = 'deployed'; actor.order = 'attack'; delete actor.formation
    this.value!.state = 'FOLLOWING'
    npc.missionMovement = false
    npc.setTacticalOrder('attack')
  }

  beginFrame(): void {
    this.grid.clear()
    for (const resident of this.residents) if (!resident.npc.dead) this.grid.insert(resident.npc)
  }

  /** Common scene combat owns claimed actors; this controller updates only its generic home travel. */
  updateResident(resident: TownCommandResident, dt: number, camera: THREE.Vector3,
    obstacles: ObstacleData[], navigation: NavigationWorld): boolean {
    if (!this.ownsPeacefulTravel(resident.npc) || this.sceneKey !== this.value?.sceneKey) return false
    const npc = resident.npc, actor = this.value.members![npc.combatantId]
    if (npc.dead) { actor.status = 'dead'; return true }
    if (npc.formationCommandId !== TOWN_COMMAND_RETURN_ID) this.applyReturn(npc, actor)
    npc.updateTownTravel(dt, npc.combatPosition.distanceTo(camera), this.grid.getNearbyInto(npc.combatPosition, 10, this.nearby), obstacles, navigation)
    if (npc.isFormationTargetReached(TOWN_COMMAND_RETURN_ID)) {
      npc.missionMovement = false
      actor.status = 'reserve'; actor.order = 'attack'; delete actor.formation
      npc.setTacticalOrder('attack'); npc.setTownPeaceful()
      resident.spec = this.homeStation(resident)
      if (resident.spec.garrison?.kind === 'rampart' && !npc.isMounted && npc.hasActiveRangedWeapon) npc.activateTownRampartGarrison()
      if (this.value.commandRank === 'commander') {
        this.value.commandedActorIds = this.value.commandedActorIds?.filter(id => id !== npc.combatantId)
        if (npc.combatOwnership === 'town-command') npc.combatOwnership = undefined
        npc.setCommandAllegiance(Faction.TOWN)
        npc.setCommandSquad(officialActorSquadId(this.value, npc.combatantId))
      }
      if (!this.value.actorIds.some(id => this.isReturning(id))) {
        this.value.state = this.value.commandRank === 'commander' && this.value.commandedActorIds?.length ? 'FOLLOWING' : 'TRAINING'
      }
    }
    return true
  }

  private stageOrder(actor: PersonalActorCheckpoint, npc: NPC, order: TacticalOrder,
    assignments: readonly FormationCommandAssignment[]): void {
    actor.status = 'deployed'; actor.order = order
    if (order !== 'formation') delete actor.formation
    const formation = assignments.find(assignment => assignment.npc === npc)
    if (order === 'formation' && formation) actor.formation = {
      commandId: formation.commandId, position: { ...formation.position }, reached: formation.reached,
    }
  }
  private homeStation(resident: TownCommandResident): TownActorSpec {
    return townStationSpec(resident.spec, Boolean(resident.homeMount && !resident.homeMount.dead || resident.npc.isMounted), Boolean(resident.npc.rangedWeaponId))
  }
  private stageReturn(actor: PersonalActorCheckpoint, spec: TownActorSpec): void {
    actor.status = 'deployed'; actor.order = 'formation'
    actor.formation = { commandId: TOWN_COMMAND_RETURN_ID,
      position: { x: spec.x, y: spec.y ?? getTerrainHeight(spec.x, spec.z), z: spec.z, yaw: spec.yaw ?? Math.PI },
      reached: false, arrivalOrder: 'attack' }
  }
  private applyReturn(npc: NPC, actor: PersonalActorCheckpoint): void {
    const f = actor.formation!
    const resident = this.residentsById.get(npc.combatantId)
    if (resident?.spec.garrison) {
      const station = this.homeStation(resident)
      f.position = { x: station.x, y: station.y, z: station.z, yaw: station.yaw ?? Math.PI }
    }
    const p = f.position
    npc.clearEncounter()
    npc.missionMovement = true
    npc.assignFormationTarget(TOWN_COMMAND_RETURN_ID, new THREE.Vector3(p.x, p.y ?? getTerrainHeight(p.x, p.z), p.z),
      new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw)), undefined, 'attack')
  }
  private snapshotMember(resident: TownCommandResident, previous?: PersonalActorCheckpoint): PersonalActorCheckpoint {
    const actor = snapshotCommandActor(resident.npc, resident.homeMount,
      previous?.status === 'dead' && !resident.npc.dead ? 'reserve' : previous?.status ?? 'reserve')
    // Return travel completes into attack and then training; do not recreate a completed return from old state.
    if (previous?.formation?.commandId === TOWN_COMMAND_RETURN_ID && actor.status !== 'reserve') {
      actor.formation = resident.npc.combatFormationCheckpoint ?? previous.formation
    }
    return actor
  }
  private snapshotMembers(ids: readonly string[], previous: TownCommandSquadState['members']): Record<string, PersonalActorCheckpoint> {
    return Object.fromEntries(ids.flatMap(id => {
      const resident = this.residentsById.get(id)
      if (!resident) return previous?.[id] ? [[id, previous[id]]] : []
      return [[id, this.snapshotMember(resident, previous?.[id])]]
    }))
  }
}
