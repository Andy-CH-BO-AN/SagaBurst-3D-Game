import { cloneCareerProfile, type CareerProfile } from './CareerProfile'
import type { PersonalActorCheckpoint } from './CareerPersonalSquadMission'
import { civilianCommandRoster } from './CivilianCommandAuthority'
import { TOWN_COMMANDER_ID } from '../town/TownCommanderIdentity'
import type { TownActorSpec } from '../town/TownRules'
import { refitTownCommandForSceneChange } from './SquadRefit'
import { returnPersonalMissionToHR, snapshotPersonalMission } from './CareerPersonalSquadMission'

export interface MissionReturnHome {
  spec: Pick<TownActorSpec, 'id' | 'role' | 'x' | 'z' | 'yaw'> & Partial<Pick<TownActorSpec, 'duty' | 'y'>>
  checkpoint?: PersonalActorCheckpoint
}

export function isMissionReturnResident(spec: Pick<TownActorSpec, 'role'> & Partial<Pick<TownActorSpec, 'duty'>>): boolean {
  return spec.role === 'civilian' || spec.role === 'merchant' || spec.duty === 'service' || spec.duty === 'watchtower_guard'
}

/** A missing resource field means the freshly constructed actor's full loadout resources.
 * Live callers supply full refit checkpoints; map returns discard obsolete combat poses.
 * Call only at a completed formal mission's durable return boundary, never on ordinary load.
 */
export function stageMissionReturnResidents(current: CareerProfile, homes: readonly MissionReturnHome[]): CareerProfile {
  const next = cloneCareerProfile(current)
  const recovered = (home?: MissionReturnHome): PersonalActorCheckpoint => {
    const member: PersonalActorCheckpoint = { ...home?.checkpoint, status: 'deployed', order: 'attack' }
    delete member.formation; delete member.fall; delete member.outpostRampartGarrison; delete member.townRampartGarrison
    if (home?.checkpoint) {
      member.position = { x: home.spec.x, z: home.spec.z, yaw: home.spec.yaw ?? Math.PI,
        ...(home.spec.y !== undefined ? { y: home.spec.y } : {}) }
      if (member.mount) member.mount = { ...member.mount, mounted: true, position: { ...member.position } }
      if (member.mount) delete member.mount.flight
    }
    return member
  }
  const civilianHomes = homes.filter(home => home.spec.role === 'civilian' || home.spec.role === 'merchant')
  if (civilianHomes.length && (next.civilianCommandSquad || next.rank === 'commander')) {
    const actorIds = civilianCommandRoster(civilianHomes.map(home => home.spec))
    next.civilianCommandSquad = { type: 'civilian-command', squadId: 'civilians', townFaction: next.faction,
      sceneKey: `town:${next.faction}`, homeLayoutVersion: next.civilianCommandSquad?.homeLayoutVersion,
      actorIds, owners: Object.fromEntries(actorIds.map(id => [id, 'daily' as const])),
      members: Object.fromEntries(civilianHomes.map(home => [home.spec.id, recovered(home)])) }
  }
  const town = next.townCommandSquad
  if (town?.townFaction === next.faction) {
    const services = new Map(homes.filter(home => home.spec.duty === 'service').map(home => [home.spec.id, home]))
    // Dynamic services get their legal positions from the rebuilt scene, never a stale checkpoint.
    const dynamicServices = new Set([TOWN_COMMANDER_ID, 'hr-officer', 'eagle-trainer'])
    const ids = town.actorIds.filter(id => services.has(id) || dynamicServices.has(id))
    town.members ??= {}
    for (const id of ids) {
      town.members[id] = { ...recovered(services.get(id)), status: 'reserve' }
      if (town.nativeReturnStates) delete town.nativeReturnStates[id]
    }
    const released = new Set(ids)
    town.commandedActorIds = town.commandedActorIds?.filter(id => !released.has(id))
    town.refittingActorIds = town.refittingActorIds?.filter(id => !released.has(id))
  }
  return next
}

/** Explicit completed mission return only. Ordinary town reloads retain all checkpoints. */
export function stageMissionReturnRebuild(current: CareerProfile,
  homes: readonly MissionReturnHome[], personal = current.personalSquadRuntime): CareerProfile {
  const next = stageMissionReturnResidents(refitTownCommandForSceneChange(current), homes.map(({ spec }) => ({ spec })))
  if (next.townCommandSquad?.townFaction === next.faction) {
    next.townCommandSquad.commandedActorIds = []
    next.townCommandSquad.refittingActorIds = []
    delete next.townCommandSquad.nativeReturnStates
  }
  if (next.townAirCommandSquad?.townFaction === next.faction) delete next.townAirCommandSquad
  // Reconstruct native riders at their pads; their existing patrol owner starts the next cycle.
  if (next.townEagleGarrisons) delete next.townEagleGarrisons[next.faction]
  delete next.playerAerialState
  // Return the whole owned roster, including reserves or members absent from this mission.
  const roster = snapshotPersonalMission(next)
  if (roster) for (const id of roster.memberIds) {
    const padId = personal?.members[id]?.eaglePadId
    if (padId) roster.members[id].eaglePadId = padId
  }
  next.personalSquadRuntime = returnPersonalMissionToHR(roster)
  return next
}
