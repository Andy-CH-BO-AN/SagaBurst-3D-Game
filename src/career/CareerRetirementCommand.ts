import type { CareerProfile } from './CareerProfile'
import type { PersonalActorCheckpoint } from './CareerPersonalSquadMission'

/** Acceptance keeps Town authority until the saved first-exit transition succeeds. */
export function isTownCommandRevokedByRetirement(profile: Pick<CareerProfile, 'careerRetirement'>): boolean {
  const phase = profile.careerRetirement?.phase
  return phase === 'mobilizing' || phase === 'final-stand' || phase === 'completed'
}

/** Mutates only the caller's staged profile, before saving. Resources, identities and HR stay intact. */
export function revokeRetirementTownCommandClaims(profile: CareerProfile): void {
  if (!isTownCommandRevokedByRetirement(profile)) return
  const clearOrders = (members: Record<string, PersonalActorCheckpoint> | undefined) => {
    for (const member of Object.values(members ?? {})) {
      member.order = 'defend'
      delete member.formation
    }
  }
  const town = profile.townCommandSquad
  if (town) {
    const commanded = town.authorized || Boolean(town.commandedActorIds?.length || town.commandedSquadIds?.length
      || Object.keys(town.nativeReturnStates ?? {}).length)
    town.authorized = false
    if (town.commandRank === 'commander') town.commandedActorIds = []
    delete town.commandedSquadIds
    town.state = 'TRAINING'
    delete town.nativeReturnStates
    delete town.refittingActorIds
    // Reconciliation also runs on later snapshots. Native staging formations are
    // not player orders and must survive after the old claims have been removed.
    if (commanded) clearOrders(town.members)
  }
  if (profile.townAirCommandSquad) profile.townAirCommandSquad.commandedActorIds = []
  const civilians = profile.civilianCommandSquad
  if (civilians) {
    for (const id of civilians.actorIds) {
      if (civilians.owners[id] !== 'daily' && civilians.members[id]) clearOrders({ [id]: civilians.members[id] })
      civilians.owners[id] = 'daily'
    }
  }
  for (const mission of [profile.activeMission, profile.activeOutpostMission]) {
    if (mission?.officialSquad) {
      const commanded = mission.officialSquad.commandedSquadIds?.length
        ?? (mission.officialSquad.commandRank !== 'commander')
      mission.officialSquad.commandedSquadIds = []
      if (commanded) clearOrders(mission.officialSquad.members)
    }
  }
  const siege = profile.activeMission?.fourGateDefense?.siege
  if (siege) siege.playerCommandedActorIds = []
  if (profile.townEvent?.authorizedTownCommandActorIds) profile.townEvent.authorizedTownCommandActorIds = []
}
