import type { CareerProfile } from '../career/CareerProfile'
import { isTownCommandRevokedByRetirement } from '../career/CareerRetirementCommand'
import { cloneTownAirCommandSquad, type TownAirCommandSquadState } from '../career/TownAirCommandAuthority'
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
  constructor(residents: readonly Resident[],
    private readonly read: () => CareerProfile, private readonly garrison: TownEagleGarrisonController,
    private readonly townFaction: CareerProfile['faction']) {
    this.residents = residents.filter(resident => resident.spec.eagle)
  }
  restore(): void { this.applySavedState(this.read().townAirCommandSquad) }
  checkpoint(): TownAirCommandSquadState | undefined {
    return this.value ? cloneTownAirCommandSquad(this.value) : undefined
  }
  stageContext(next: CareerProfile): CareerProfile {
    if (next.townAirCommandSquad) next.townAirCommandSquad.commandedActorIds = []
    return next
  }
  applySavedState(value: TownAirCommandSquadState | undefined): void {
    this.value = value?.townFaction === this.townFaction
      ? { ...cloneTownAirCommandSquad(value), commandedActorIds: [] } : undefined
    for (const { npc } of this.residents) {
      if (this.garrison.isPlayerCommandOwned(npc)) this.garrison.releasePlayerCommand(npc,
        !isTownCommandRevokedByRetirement(this.read()) && !this.read().activeMission)
      if (npc.combatOwnership === 'town-eagle-command'
        || isTownCommandRevokedByRetirement(this.read()) && npc.combatOwnership === 'mission-official') {
        npc.combatOwnership = undefined; npc.setCommandAllegiance(Faction.TOWN)
      }
      npc.setCommandSquad(undefined)
    }
  }
}
