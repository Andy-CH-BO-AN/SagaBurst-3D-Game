import type { ArmyCommandTarget } from '../battle/CommandTarget'
import type { FormationCommandAssignment } from '../battle/FormationController'
import type { TacticalOrder } from '../battle/TacticalOrder'
import type { CareerProfile } from '../career/CareerProfile'
import { cloneTownAirCommandSquad, type TownAirCommandSquadState } from '../career/TownAirCommandAuthority'
import type { Player } from '../player/Player'
import { Faction, type NPC } from '../world/NPC'
import type { Mount } from '../world/Mount'
import type { TownActorSpec } from './TownRules'
import type { TownEagleGarrisonController } from './TownEagleGarrisonController'

interface Resident { spec: TownActorSpec; npc: NPC; homeMount?: Mount }
/** Read-only compatibility adapter for pre-eight-gate air checkpoints.
 * The garrison owns resource restore, autonomous flight and the replacement clock. */
export class TownAirCommandSquadController {
  private value?: TownAirCommandSquadState
  private readonly residents: readonly Resident[]
  constructor(residents: readonly Resident[], _player: () => Player,
    private readonly read: () => CareerProfile, private readonly garrison: TownEagleGarrisonController,
    private readonly townFaction: CareerProfile['faction']) {
    this.residents = residents.filter(resident => resident.spec.eagle)
  }
  get commandsEnabled(): boolean { return false }
  get actors(): NPC[] { return this.residents.map(resident => resident.npc) }
  ownsPlayerCommand(_npc: NPC): boolean { return false }
  accepts(_npc: NPC): boolean { return false }
  get combatActors(): NPC[] { return [] }
  get hudActorIds(): readonly string[] { return [] }
  restore(): void { this.applySavedState(this.read().townAirCommandSquad) }
  checkpoint(): TownAirCommandSquadState | undefined {
    return this.value ? cloneTownAirCommandSquad(this.value) : undefined
  }
  stageContext(next: CareerProfile): CareerProfile {
    if (next.townAirCommandSquad) next.townAirCommandSquad.commandedActorIds = []
    return next
  }
  stageCommand(_current: CareerProfile, _order: TacticalOrder | 'dismiss', _target: ArmyCommandTarget,
    _participants: readonly NPC[], _assignments: readonly FormationCommandAssignment[] = []): undefined { return undefined }
  applySavedState(value: TownAirCommandSquadState | undefined): void {
    this.value = value?.townFaction === this.townFaction
      ? { ...cloneTownAirCommandSquad(value), commandedActorIds: [] } : undefined
    for (const { npc } of this.residents) {
      if (this.garrison.isPlayerCommandOwned(npc)) this.garrison.releasePlayerCommand(npc, !this.read().activeMission)
      if (npc.combatOwnership === 'town-eagle-command') {
        npc.combatOwnership = undefined; npc.setCommandAllegiance(Faction.TOWN)
      }
      npc.setCommandSquad(undefined)
    }
  }
}
