import type { FormationCommandAssignment } from '../battle/FormationController'
import type { TacticalOrder } from '../battle/TacticalOrder'
import type { NPC } from '../world/NPC'
import { cloneCareerProfile, type CareerProfile } from './CareerProfile'
import { officialActorSquadId, officialCommandAcceptsActor, officialCommandSquads, officialCommandIsPlayerControlled, type OfficialCommandAuthority } from './CareerCommandAuthority'
import type { PersonalActorCheckpoint } from './CareerPersonalSquadMission'
import { snapshotCommandActor } from './CareerCommandActorCheckpoint'

/** Legacy Captain saves retain their original owner until an explicit command handoff is saved. */
export function officialPlayerOwnsActor(authority: OfficialCommandAuthority | undefined, actorId: string): boolean {
  return authority ? officialCommandIsPlayerControlled(authority, actorId) : false
}

/** Stage the complete selected squad handoff; callers save once before touching any live owner. */
export function stageOfficialCommandOrder(current: CareerProfile, participants: readonly NPC[],
  order: TacticalOrder | 'dismiss', assignments: readonly FormationCommandAssignment[] = [],
  snapshotActor: (actor: NPC) => PersonalActorCheckpoint = snapshotCommandActor): CareerProfile | undefined {
  const mission = current.activeMission ?? current.activeOutpostMission, authority = mission?.officialSquad
  if (!mission || current.activeMission?.result || current.claimedBattleIds.includes(mission.id) || !authority || authority.missionId !== mission.id
    || authority.townFaction !== current.faction || authority.commandRank === 'commander' && current.rank !== 'commander') return undefined
  const actors = participants.filter(actor => officialCommandAcceptsActor(authority, actor))
  if (!actors.length) return undefined
  const next = cloneCareerProfile(current), staged = (next.activeMission ?? next.activeOutpostMission)!.officialSquad!
  const owned = new Set(staged.commandedSquadIds ?? (staged.commandRank === 'commander' ? [] : officialCommandSquads(staged).map(squad => squad.squadId)))
  staged.members = { ...staged.members }
  for (const actor of actors) {
    const squad = officialActorSquadId(staged, actor.combatantId)!
    if (order === 'dismiss') {
      owned.delete(squad)
      if (mission.kind === 'captain-patrol-command') {
        next.activeMission!.patrolReturnStates = { ...next.activeMission!.patrolReturnStates, [actor.combatantId]: next.activeMission!.patrolReturnStates?.[actor.combatantId] ?? 'RETURN_TO_BARRACKS' }
      }
    }
    else owned.add(squad)
    const checkpoint = snapshotActor(actor)
    if (order === 'dismiss' && mission.kind === 'captain-patrol-command') checkpoint.status = 'exited'
    // A detached original mount remains this actor's resource, including its death.
    checkpoint.mount ??= staged.members[actor.combatantId]?.mount
    if (order !== 'dismiss') {
      checkpoint.order = order
      if (order !== 'formation') delete checkpoint.formation
    }
    const formation = assignments.find(assignment => assignment.npc === actor)
    if (order === 'formation' && formation) checkpoint.formation = { commandId: formation.commandId, position: { ...formation.position }, reached: formation.reached }
    staged.members[actor.combatantId] = checkpoint
    // Duplicate battlefield checkpoints must commit the same accepted order atomically.
    const battleActor = (next.activeMission ?? next.activeOutpostMission)?.battle?.actors[actor.combatantId]
    if (battleActor) battleActor.checkpoint = checkpoint
    const eagleActors = next.activeMission?.eagleBattle?.actors
    if (eagleActors?.[actor.combatantId]) eagleActors[actor.combatantId] = checkpoint
  }
  if (order === 'dismiss' && mission.kind === 'captain-patrol-command') {
    const selectedSquads = new Set(actors.map(actor => officialActorSquadId(staged, actor.combatantId)))
    for (const squad of officialCommandSquads(staged)) if (selectedSquads.has(squad.squadId)) {
      for (const id of squad.actorIds) if (staged.members[id]?.status !== 'dead') {
        staged.members[id] = { ...staged.members[id], status: 'exited' }
        next.activeMission!.patrolReturnStates = { ...next.activeMission!.patrolReturnStates, [id]: next.activeMission!.patrolReturnStates?.[id] ?? 'RETURN_TO_BARRACKS' }
      }
    }
  }
  staged.commandedSquadIds = [...owned].sort((a, b) => a - b)
  return next
}
