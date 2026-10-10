import { matchesArmyCommandTarget, type ArmyCommandTarget, type SquadIdentity } from './CommandTarget'

/** Read-only display membership. A pending identity has no NPC and cannot receive orders. */
export type ArmyHudMemberState = 'deployed' | 'returning' | 'training' | 'pending' | 'dead' | 'missing' | 'reserve' | 'exited'

export interface ArmyHudMember {
  id: string
  squadId: SquadIdentity
  state: ArmyHudMemberState
}

export interface ArmyHudRoster {
  /** Must change on scene, mission, faction, authority or roster identity transitions. */
  contextId: string
  members: readonly ArmyHudMember[]
}

export interface ArmyHudCounts {
  total: number
  alive: number
  deployed: number
  returning: number
  training: number
  pending: number
  dead: number
  missing: number
  reserve: number
  exited: number
}

/** Counts people by combatant ID, not mounts or rendered objects; reserves have no field presence. */
export function countArmyHudRoster(roster: ArmyHudRoster, target: ArmyCommandTarget): ArmyHudCounts {
  const counts: ArmyHudCounts = { total: 0, alive: 0, deployed: 0, returning: 0, training: 0, pending: 0, dead: 0, missing: 0, reserve: 0, exited: 0 }
  const seen = new Set<string>()
  for (const member of roster.members) {
    if (!matchesArmyCommandTarget(member, target) || seen.has(member.id)) continue
    seen.add(member.id)
    if (member.state === 'reserve' || member.state === 'exited') {
      counts[member.state]++
      continue
    }
    counts.total++
    if (member.state === 'deployed' || member.state === 'returning' || member.state === 'training') {
      // Returning and training Town residents remain living, present soldiers.
      counts.deployed++
      counts.alive++
      if (member.state === 'returning') counts.returning++
      if (member.state === 'training') counts.training++
    } else {
      counts[member.state]++
    }
  }
  return counts
}

export function armyHudCountSummary(counts: ArmyHudCounts): string {
  return `${counts.alive}/${counts.total}${counts.pending ? ` · 部署中 ${counts.pending}` : ''}${counts.missing ? ` · 未部署 ${counts.missing}` : ''}${counts.returning ? ` · 返回中 ${counts.returning}` : ''}`
}
