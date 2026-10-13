import type { TownActorSpec } from './TownRules'

export const TOWN_COMMANDER_ID = 'commander'
/** Opt-in service resident: shared enemy and borrow producers never include it. */
export function townCommanderSpec(point: { x: number; z: number; yaw: number }): TownActorSpec {
  return { id: TOWN_COMMANDER_ID, role: 'commander', duty: 'service', mounted: true,
    training: false, assaultObjective: false, tier: 4, index: 0, ...point }
}
