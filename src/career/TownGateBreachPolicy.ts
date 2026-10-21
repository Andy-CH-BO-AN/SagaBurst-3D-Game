import type { CampaignGateState } from '../campaign/CampaignGate'
import type { TownGateId } from '../town/TownLayout'
import { TOWN_GATES } from '../town/TownLayout'
import { townSiegeRampId } from './TownFourGateSiegePolicy'
import type { TownSiegeRampId } from '../campaign/MobileSiegeRampPolicy'

export interface TownGateBreachState {
  gateId: TownGateId
  gateState: CampaignGateState
  dockedRampIds: TownSiegeRampId[]
  wallEventHandled: boolean
  cavalryEventHandled: boolean
  releasedWallActorIds: string[]
  releasedCavalryActorIds: string[]
}
export type TownGateBreachEvent = { gateId: TownGateId; kind: 'wall' | 'cavalry' }

/** One-shot orders are local to a sector; physical entrances have their own live lifetime. */
export class TownGateBreachPolicy {
  readonly gates = new Map<TownGateId, TownGateBreachState>()
  constructor(private readonly dispatch: (event: TownGateBreachEvent) => readonly string[], saved?: readonly TownGateBreachState[]) {
    for (const gate of TOWN_GATES) this.gates.set(gate.id, saved
      ? structuredClone(saved.find(state => state.gateId === gate.id)!)
      : { gateId: gate.id, gateState: 'closed', dockedRampIds: [], wallEventHandled: false, cavalryEventHandled: false,
        releasedWallActorIds: [], releasedCavalryActorIds: [] })
  }
  ramp(gateId: TownGateId, side: -1 | 1, docked: boolean): void {
    const state = this.gates.get(gateId)!, id = townSiegeRampId(gateId, side)
    state.dockedRampIds = state.dockedRampIds.filter(rampId => rampId !== id)
    if (docked) state.dockedRampIds.push(id)
    if (docked && !state.wallEventHandled) {
      state.wallEventHandled = true
      state.releasedWallActorIds = [...this.dispatch({ gateId, kind: 'wall' })]
    }
  }
  gate(gateId: TownGateId, value: CampaignGateState): void {
    const state = this.gates.get(gateId)!
    state.gateState = value
    if (value === 'destroyed' && !state.cavalryEventHandled) {
      state.cavalryEventHandled = true
      state.releasedCavalryActorIds = [...this.dispatch({ gateId, kind: 'cavalry' })]
    }
  }
  snapshot(): TownGateBreachState[] { return [...this.gates.values()].map(gate => structuredClone(gate)) }
}
