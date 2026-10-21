import { isAutonomousTownGuard } from '../town/TownNativeGuardIdentity'
import type { ArmyHudMember, ArmyHudMemberState, ArmyHudRoster } from '../battle/ArmyCommandHudRoster'
import type { TacticalOrder } from '../battle/TacticalOrder'
import { officialCommandSquads, type OfficialCommandAuthority } from './CareerCommandAuthority'
import type { PersonalActorCheckpoint, PersonalSquadMission } from './CareerPersonalSquadMission'
import { armyHudUnitType, type ArmyHudUnitSource, type ArmyHudUnitType } from '../battle/ArmyCommandHudRoster'
import type { CareerPersonalSquadMember } from './CareerPersonalSquad'
import { personalMemberLoadout } from './PersonalSquadRuntime'
import type { CareerRetirementState } from './CareerRetirementState'
import { isTownCommandRevokedByRetirement } from './CareerRetirementCommand'

interface HudActor extends ArmyHudUnitSource {
  combatantId: string
  dead: boolean
  tacticalOrder?: TacticalOrder
}

export interface CareerCommandHudSource {
  careerRetirement?: CareerRetirementState
  unitTypes?: Readonly<Record<string, ArmyHudUnitType>>
  personalMembers?: readonly CareerPersonalSquadMember[]
  sceneKey: string
  faction: 'roman' | 'viking'
  missionId?: string
  official?: OfficialCommandAuthority
  /** Only missing official actors in a still-running deployment are pending. */
  officialPending?: boolean
  /** Currently present, living official soldiers whose genuine return travel blocks commands. */
  officialReturningIds?: readonly string[]
  /** Present Town residents training peacefully, as reported by their live owner. */
  officialTrainingIds?: readonly string[]
  personal?: PersonalSquadMission
  /** IDs actually queued by the active runtime, not persisted stale pendingMemberIds. */
  personalPendingIds?: readonly string[]
  /** Living private actors currently following their runtime-owned return destinations. */
  personalReturningIds?: readonly string[]
  /** Independently accepted residents, never part of the official or HR capacity. */
  civilians?: {
    actorIds: readonly string[]
    members?: Record<string, PersonalActorCheckpoint>
    sceneKey: string
    townFaction: 'roman' | 'viking'
    missionId?: string
  }
  civilianReturningIds?: readonly string[]
  /** Legacy input retained for compatibility; native air is never commandable. */
  townAirActorIds?: readonly string[]
  actors: readonly HudActor[]
}

/** Only the current authority and accepted HR/resident snapshots contribute to a Career HUD. */
export function careerCommandHudRoster(source: CareerCommandHudSource): ArmyHudRoster {
  const revoked = isTownCommandRevokedByRetirement(source)
  const official = !revoked && source.official?.townFaction === source.faction
    && (source.official.type !== 'mission-official' || Boolean(source.missionId && source.official.missionId === source.missionId))
    ? source.official : undefined
  const personal = source.personal
  const civilians = !revoked && source.civilians?.townFaction === source.faction
    && source.civilians.sceneKey === source.sceneKey && source.civilians.missionId === source.missionId
    ? source.civilians : undefined
  const live = new Map(source.actors.map(actor => [actor.combatantId, actor]))
  const personalTypes = new Map(source.personalMembers?.map(member => [member.id,
    member.type === 'ranger' && !member.equipment ? undefined : armyHudUnitType(personalMemberLoadout(member, source.faction))]))
  const pendingPersonal = new Set(source.personalPendingIds ?? [])
  const returningPersonal = new Set(source.personalReturningIds ?? [])
  const returningOfficial = new Set(source.officialReturningIds ?? [])
  const returningCivilians = new Set(source.civilianReturningIds ?? [])
  const trainingOfficial = new Set(official?.type === 'town-command' ? source.officialTrainingIds ?? [] : [])
  const personalIds = new Set(personal?.memberIds ?? [])
  const civilianIds = new Set(civilians?.actorIds ?? [])
  const members: ArmyHudMember[] = []
  const seen = new Set<string>()
  const squads = official ? officialCommandSquads(official) : []

  for (const squad of squads) for (const id of squad.actorIds) {
    if (isAutonomousTownGuard(id) || seen.has(id) || personalIds.has(id) || civilianIds.has(id)) continue
    seen.add(id)
    const actor = live.get(id)
    const saved = official?.members?.[id]
    const state: ArmyHudMemberState = saved?.status === 'exited' ? 'exited'
      : saved?.status === 'dead' || saved?.hp === 0 || actor?.dead ? 'dead'
      : actor ? returningOfficial.has(id) ? 'returning' : trainingOfficial.has(id) ? 'training' : 'deployed'
      : source.officialPending ? 'pending' : 'missing'
    members.push({ id, squadId: squad.squadId, state, order: actor ? actor.tacticalOrder : saved?.order,
      unitType: source.unitTypes?.[id] ?? (actor && armyHudUnitType(actor)) })
  }

  for (const id of personalIds) {
    if (seen.has(id) || civilianIds.has(id)) continue
    seen.add(id)
    const actor = live.get(id)
    const saved = personal?.members[id]
    const state: ArmyHudMemberState = saved?.status === 'exited' ? 'exited'
      : saved?.status === 'dead' || saved?.hp === 0 || actor?.dead ? 'dead'
      : actor ? returningPersonal.has(id) ? 'returning' : 'deployed'
      : pendingPersonal.has(id) ? 'pending'
      : saved?.status === 'reserve' || !saved ? 'reserve' : 'missing'
    members.push({ id, squadId: 'personal', state, order: actor ? actor.tacticalOrder : saved?.order,
      unitType: personalTypes.get(id) ?? (actor && armyHudUnitType(actor)) })
  }

  for (const id of civilianIds) {
    if (seen.has(id)) continue
    seen.add(id)
    const actor = live.get(id)
    const saved = civilians?.members?.[id]
    const state: ArmyHudMemberState = saved?.status === 'exited' ? 'exited'
      : saved?.status === 'dead' || saved?.hp === 0 || actor?.dead ? 'dead'
      : actor ? returningCivilians.has(id) ? 'returning' : 'deployed' : 'missing'
    members.push({ id, squadId: 'civilians', state, order: actor ? actor.tacticalOrder : saved?.order, unitType: 'civilian' })
  }

  // Include identities and saved assignments: equal headcounts do not imply the same authority.
  const contextId = JSON.stringify([source.sceneKey, source.faction, source.missionId ?? null,
    official?.type ?? null, official?.missionId ?? null, squads.map(squad => [squad.squadId, squad.actorIds]),
    personal?.memberIds ?? [], civilians?.actorIds ?? [], source.townAirActorIds ?? []])
  return { contextId, members }
}
