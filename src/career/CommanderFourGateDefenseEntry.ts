import type { TownEagleGarrisonState } from '../town/TownEagleGarrisonState'
import type { ActiveCareerMission } from './CareerMissionState'

export interface FourGateEntryActorMax { hp: number; mountHp?: number }

/** A freshly accepted Four-Gate defense starts at full strength. Town wounds, casualties,
 * spent career mounts and private-squad injuries never carry into the battle checkpoint.
 * The restarted Town rebuilds every native, private and player body with full resources,
 * so omitting their live snapshots is the full-health state. Mutates the cloned mission. */
export function freshCommanderFourGateDefenseEntry(mission: ActiveCareerMission): void {
  if (mission.kind !== 'commander-four-gate-defense') return
  delete mission.playerHp
  delete mission.playerStamina
  delete mission.actorHealth
  delete mission.deadFriendlyActorIds
  if (mission.officialSquad) delete mission.officialSquad.members
  if (mission.mountState) {
    const { activeMountId, armorImpact } = mission.mountState
    mission.mountState = { ...(activeMountId ? { activeMountId } : {}), hp: {}, ...(armorImpact ? { armorImpact } : {}), unavailable: [] }
  }
  const personal = mission.personalSquad
  if (personal) personal.members = Object.fromEntries(personal.memberIds.map(id => [id, { status: 'reserve' as const,
    ...(personal.members[id]?.eaglePadId ? { eaglePadId: personal.members[id].eaglePadId } : {}) }]))
}

/** Living eagle riders and their eagles enter the Four-Gate defense at full health. */
export function healFourGateEagleGarrison(state: TownEagleGarrisonState,
  maxFor: (riderId: string) => FourGateEntryActorMax | undefined): TownEagleGarrisonState {
  return { ...state, pairs: state.pairs.map(pair => {
    const max = pair.hp > 0 ? maxFor(pair.riderId) : undefined
    return max ? { ...pair, hp: max.hp, mount: { ...pair.mount, hp: max.mountHp ?? pair.mount.hp } } : pair
  }) }
}
