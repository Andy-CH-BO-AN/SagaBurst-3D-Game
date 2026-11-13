import type { TownActorSpec } from './TownRules'

export const TOWN_COMMANDER_ID = 'commander'
/** Indoor service post: world XZ, floor height and facing. */
export interface TownServiceStation { x: number; y?: number; z: number; yaw: number }
export const TOWN_COMMANDER_MOUNT_ID = 'snow-leopard' as const
/** Opt-in service resident: shared enemy and borrow producers never include it. */
export function townCommanderSpec(point: { x: number; y?: number; z: number; yaw: number }): TownActorSpec {
  return { id: TOWN_COMMANDER_ID, role: 'commander', duty: 'service', mounted: true,
    training: false, assaultObjective: false, tier: 4, index: 0, ...point }
}
