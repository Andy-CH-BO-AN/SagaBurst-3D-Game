import type { ArmyHudMember, ArmyHudMemberState, ArmyHudRoster } from '../battle/ArmyCommandHudRoster'
import type { OfficialCommandAuthority } from './CareerCommandAuthority'
import type { PersonalSquadMission } from './CareerPersonalSquadMission'

interface HudActor {
  combatantId: string
  dead: boolean
}

export interface CareerCommandHudSource {
  sceneKey: string
  faction: 'roman' | 'viking'
  missionId?: string
  official?: OfficialCommandAuthority
  /** Only missing official actors in a still-running deployment are pending. */
  officialPending?: boolean
  /** Currently present, living Town soldiers whose genuine return travel blocks commands. */
  officialReturningIds?: readonly string[]
  /** Present Town residents training peacefully, as reported by their live owner. */
  officialTrainingIds?: readonly string[]
  personal?: PersonalSquadMission
  /** IDs actually queued by the active runtime, not persisted stale pendingMemberIds. */
  personalPendingIds?: readonly string[]
  /** Living private actors currently following their runtime-owned return destinations. */
  personalReturningIds?: readonly string[]
  actors: readonly HudActor[]
}

/** Only the current authority and accepted HR snapshot can contribute to a Career command HUD. */
export function careerCommandHudRoster(source: CareerCommandHudSource): ArmyHudRoster {
  const { official, personal } = source
  const live = new Map(source.actors.map(actor => [actor.combatantId, actor]))
  const pendingPersonal = new Set(source.personalPendingIds ?? [])
  const returningPersonal = new Set(source.personalReturningIds ?? [])
  const returningOfficial = new Set(official?.type === 'town-command' ? source.officialReturningIds ?? [] : [])
  const trainingOfficial = new Set(official?.type === 'town-command' ? source.officialTrainingIds ?? [] : [])
  const members: ArmyHudMember[] = []

  for (const id of new Set(official?.actorIds ?? [])) {
    const actor = live.get(id)
    const saved = official?.members?.[id]
    const state: ArmyHudMemberState = actor ? actor.dead ? 'dead' : returningOfficial.has(id) ? 'returning' : trainingOfficial.has(id) ? 'training' : 'deployed'
      : saved?.status === 'dead' || saved?.hp === 0 ? 'dead'
      : saved?.status === 'exited' ? 'exited'
      : source.officialPending ? 'pending' : 'missing'
    members.push({ id, squadId: 1, state })
  }

  for (const id of new Set(personal?.memberIds ?? [])) {
    const actor = live.get(id)
    const saved = personal?.members[id]
    const state: ArmyHudMemberState = saved?.status === 'exited' ? 'exited'
      : actor ? actor.dead ? 'dead' : returningPersonal.has(id) ? 'returning' : 'deployed'
      : saved?.status === 'dead' || saved?.hp === 0 ? 'dead'
      : pendingPersonal.has(id) ? 'pending'
      : saved?.status === 'reserve' || !saved ? 'reserve' : 'missing'
    members.push({ id, squadId: 'personal', state })
  }

  // Include identities, not just counts: two 29-person missions are not the same command context.
  const contextId = JSON.stringify([source.sceneKey, source.faction, source.missionId ?? null,
    official?.type ?? null, official?.missionId ?? null, official?.actorIds ?? [],
    personal?.memberIds ?? []])
  return { contextId, members }
}
