import { matchesArmyCommandTarget, type ArmyCommandTarget } from '../battle/CommandTarget'
import type { FormationCommandAssignment } from '../battle/FormationController'
import { officialFollowLocalOffset } from '../battle/FollowOrder'
import type { TacticalOrder } from '../battle/TacticalOrder'
import { cloneCareerProfile, type CareerProfile } from '../career/CareerProfile'
import { restoreCommandActor, snapshotCommandActor } from '../career/CareerCommandActorCheckpoint'
import { cloneTownAirCommandSquad, type TownAirCommandSquadState } from '../career/TownAirCommandAuthority'
import type { Player } from '../player/Player'
import { Faction, type NPC } from '../world/NPC'
import type { Mount } from '../world/Mount'
import type { TownActorSpec } from './TownRules'
import { TOWN_EAGLE_PAIRS } from './TownEagleGarrison'
import type { TownEagleGarrisonController } from './TownEagleGarrisonController'

interface Resident { spec: TownActorSpec; npc: NPC; homeMount?: Mount }
/** Only borrows the existing five pairs; their garrison remains the resource/lifecycle owner. */
export class TownAirCommandSquadController {
  private value?: TownAirCommandSquadState
  private readonly residents: Map<string, Resident>
  constructor(residents: readonly Resident[], private readonly player: () => Player,
    private readonly read: () => CareerProfile, private readonly garrison: TownEagleGarrisonController,
    private readonly townFaction: CareerProfile['faction']) {
    this.residents = new Map(TOWN_EAGLE_PAIRS.flatMap(pair => {
      const resident = residents.find(resident => resident.spec.id === pair.riderId && resident.npc.combatantId === pair.riderId
        && resident.spec.eagle?.mountId === pair.mountId && resident.spec.eagle.homePadId === pair.homePadId && resident.homeMount)
      return resident ? [[pair.riderId, resident] as const] : []
    }))
  }
  private allowed(profile = this.read()): boolean {
    return profile.rank === 'commander' && profile.faction === this.townFaction
      && !profile.activeMission && !profile.activeOutpostMission && profile.townEvent?.state !== 'hostile'
  }
  get commandsEnabled(): boolean { return this.allowed() && !this.player().dead }
  get actors(): NPC[] { return [...this.residents.values()].map(resident => resident.npc) }
  private valid(npc: NPC): boolean {
    return this.residents.get(npc.combatantId)?.npc === npc && !npc.hostileToPlayer
      && (npc.faction === Faction.TOWN && !npc.combatOwnership
        || npc.faction === Faction.PLAYER && npc.combatOwnership === 'town-eagle-command')
  }
  ownsPlayerCommand(npc: NPC): boolean {
    return this.allowed() && this.valid(npc) && Boolean(this.value?.commandedActorIds.includes(npc.combatantId))
  }
  accepts(npc: NPC): boolean { return this.commandsEnabled && !npc.dead && this.valid(npc) }
  get combatActors(): NPC[] { return this.actors.filter(npc => !npc.dead && this.ownsPlayerCommand(npc)) }
  get hudActorIds(): readonly string[] { return this.commandsEnabled ? this.actors.filter(npc => this.valid(npc)).map(npc => npc.combatantId) : [] }

  /** Runtime resources are restored by the garrison first, then only saved player intent wins. */
  restore(): void {
    const saved = this.read().townAirCommandSquad
    this.value = saved?.townFaction === this.townFaction && saved.sceneKey === `town:${this.townFaction}`
      ? cloneTownAirCommandSquad(saved) : undefined
    this.applySavedState(this.value, true)
    if (this.commandsEnabled) for (const npc of this.actors) if (this.valid(npc)) npc.setCommandSquad(8)
  }
  checkpoint(): TownAirCommandSquadState | undefined {
    if (!this.value) return undefined
    const value = cloneTownAirCommandSquad(this.value)
    for (const id of value.actorIds) {
      const resident = this.residents.get(id)
      if (resident) value.members[id] = snapshotCommandActor(resident.npc, resident.homeMount)
    }
    return cloneTownAirCommandSquad(value)
  }
  /** Context changes revoke old peaceful claims in the same durable transaction. */
  stageContext(next: CareerProfile): CareerProfile {
    if (next.townAirCommandSquad && next.townAirCommandSquad.townFaction !== next.faction) {
      delete next.townAirCommandSquad
      return next
    }
    if (this.allowed(next) || !next.townAirCommandSquad?.commandedActorIds.length) return next
    next.townAirCommandSquad = { ...next.townAirCommandSquad, commandedActorIds: [] }
    return next
  }
  stageCommand(current: CareerProfile, order: TacticalOrder | 'dismiss', target: ArmyCommandTarget,
    participants: readonly NPC[], assignments: readonly FormationCommandAssignment[] = []): CareerProfile | undefined {
    if (!this.commandsEnabled || !matchesArmyCommandTarget({ squadId: 8 }, target)) return undefined
    const selected = participants.filter(npc => this.accepts(npc))
    // Dismiss releases the whole fixed squad, including dead riders whose lifecycle was suspended.
    if (!selected.length && !(order === 'dismiss' && this.value?.commandedActorIds.length)) return undefined
    const value: TownAirCommandSquadState = this.checkpoint() ?? { type: 'town-air-command', squadId: 8,
      townFaction: this.townFaction, sceneKey: `town:${this.townFaction}`, actorIds: this.actors.filter(npc => this.valid(npc)).map(npc => npc.combatantId), commandedActorIds: [], members: {} }
    for (const id of value.actorIds) {
      const resident = this.residents.get(id)
      if (resident) value.members[id] = snapshotCommandActor(resident.npc, resident.homeMount)
    }
    if (order === 'dismiss') value.commandedActorIds = []
    else {
      const ids = new Set([...value.commandedActorIds, ...selected.map(npc => npc.combatantId)])
      value.commandedActorIds = value.actorIds.filter(id => ids.has(id))
      for (const npc of selected) {
        const member = value.members[npc.combatantId]
        member.order = order
        if (order !== 'formation') delete member.formation
        const assignment = assignments.find(assignment => assignment.npc === npc)
        if (order === 'formation' && assignment) member.formation = { commandId: assignment.commandId, position: { ...assignment.position }, reached: assignment.reached }
      }
    }
    const next = cloneCareerProfile(current); next.townAirCommandSquad = value
    return next
  }
  /** Saved ownership only; live handoff never restores resources or moves an actor. */
  applySavedState(value: TownAirCommandSquadState | undefined, restore = false): void {
    const previous = this.value
    this.value = value ? cloneTownAirCommandSquad(value) : undefined
    for (const [index, npc] of this.actors.entries()) {
      const claimed = this.ownsPlayerCommand(npc)
      if (claimed) {
        if (restore) {
          const saved = this.value?.members[npc.combatantId]
          if (saved) restoreCommandActor(npc, saved, this.residents.get(npc.combatantId)?.homeMount)
        }
        this.garrison.claimPlayerCommand(npc)
        npc.combatOwnership = 'town-eagle-command'; npc.setCommandAllegiance(Faction.PLAYER); npc.setCommandSquad(8)
        npc.missionMovement = false; npc.setMissionCombatTarget(undefined); npc.assignSiegeObstacle(null)
        const member = this.value!.members[npc.combatantId]
        if (!npc.dead && member?.order === 'follow') npc.assignFollowTarget(this.player(), index, officialFollowLocalOffset(index, npc.isMounted, true))
        else if (!npc.dead && member?.order && member.order !== 'formation') npc.setTacticalOrder(member.order)
      } else if (previous?.commandedActorIds.includes(npc.combatantId) || this.garrison.isPlayerCommandOwned(npc)) {
        // An active formal mission may already own this same resident.
        if (npc.combatOwnership !== 'town-eagle-command' && npc.combatOwnership !== undefined) continue
        this.garrison.releasePlayerCommand(npc, this.allowed())
        npc.combatOwnership = undefined; npc.setCommandAllegiance(Faction.TOWN)
        npc.setCommandSquad(this.commandsEnabled ? 8 : undefined)
      } else if (this.commandsEnabled && this.valid(npc)) npc.setCommandSquad(8)
    }
  }
}
