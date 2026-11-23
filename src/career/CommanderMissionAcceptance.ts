import type { TownActorSpec } from '../town/TownRules'
import { commanderGateDefenseSquads } from './CaptainMissionCatalog'
import { createMissionCommandAuthority,type OfficialCommandAuthority,type OfficialCommandSquad } from './CareerCommandAuthority'
import type { ActiveCareerMission } from './CareerMissionState'
import type { CareerProfile } from './CareerProfile'
import { createSweepRoster } from './CavalrySweep'
import { commandSquadsFromActorIds,commandSquadsFromSlots } from './MissionCommandRoster'
import { createVeteranRoster,getVeteranMissionDefinition } from './VeteranMission'

/** Fresh acceptance only. Call before saving; never use a current rank to upgrade a loaded mission. */
export function buildCommanderAuthorityForMission(profile: Pick<CareerProfile, 'rank' | 'faction'>,
  mission: ActiveCareerMission, residentSpecs?: readonly TownActorSpec[]): OfficialCommandAuthority | undefined {
  if (profile.rank !== 'commander' || mission.officialSquad || mission.kind === 'duel'
    || mission.phase === 'RETURNING' || mission.phase === 'RESULT' || mission.result) return undefined
  let squads: OfficialCommandSquad[]
  if (mission.kind === 'commander-four-gate-defense') {
    if (!residentSpecs) return undefined
    squads = commanderGateDefenseSquads(residentSpecs, mission.friendlyActorIds,
      new Set(mission.deadFriendlyActorIds), mission.id)
  } else if (mission.kind === 'cavalry-sweep') {
    squads = commandSquadsFromSlots(mission.friendlyActorIds, createSweepRoster(profile.faction))
  } else {
    const veteran = getVeteranMissionDefinition(mission.templateId)
    if (veteran) {
      const roster = createVeteranRoster(veteran.id, profile.faction, mission.id, mission.veteranRosterVersion ?? 2)
      const initial = commandSquadsFromSlots(mission.friendlyActorIds, roster.friendly)
      const lastSquadId = Math.max(0, ...initial.map(squad => squad.squadId))
      squads = [...initial, ...commandSquadsFromSlots(mission.reinforcementActorIds ?? [],
        roster.reinforcements.map(unit => ({ squadId: unit.squadId + lastSquadId })))]
    } else {
      squads = commandSquadsFromActorIds([...mission.friendlyActorIds, ...(mission.reinforcementActorIds ?? [])])
    }
  }
  return squads.length ? createMissionCommandAuthority(mission.id, profile.faction, profile.rank, [], squads) : undefined
}
