import { arenaTrialCounts, type ArenaTrialActorState, type ArenaTrialCounts } from '../career/CareerArenaTrials'
import type { ActiveCareerMission } from '../career/CareerMissionState'
import type { NPC } from '../world/NPC'

export interface ArenaProgressBody {
  readonly actorId: string
  readonly npc: Pick<NPC, 'dead' | 'hp' | 'combatPosition' | 'combatAmmo'> & {
    readonly group: { readonly rotation: { readonly y: number }; readonly position: { readonly y: number } }
    readonly shield: Pick<NPC['shield'], 'shieldImpactRemaining'>
  }
}

/** The roster checkpoint: a body that is gone or knocked stays knocked, everyone else keeps HP and place. */
export function checkpointArenaActors(ids: readonly string[], bodies: readonly ArenaProgressBody[], knocked: ReadonlySet<string>): Record<string, ArenaTrialActorState> {
  const actors: Record<string, ArenaTrialActorState> = {}
  for (const id of ids) {
    const body = bodies.find(candidate => candidate.actorId === id)
    if (!body || knocked.has(id) || body.npc.dead) { actors[id] = { status: 'knocked', hp: 0, x: 0, z: 0, yaw: 0 }; continue }
    const { npc } = body
    actors[id] = { status: 'active', hp: npc.hp, x: npc.combatPosition.x, z: npc.combatPosition.z, yaw: npc.group.rotation.y,
      y: npc.group.position.y, ammo: npc.combatAmmo, shieldImpact: npc.shield.shieldImpactRemaining }
  }
  return actors
}

/** Live team counts; a living co-op partner is one more friendly body, so the team falls only when both players are down. */
export function arenaCombatCounts(mission: Pick<ActiveCareerMission, 'friendlyActorIds' | 'targetActorIds'>, bodies: readonly { actorId: string; npc: { dead: boolean } }[],
  knocked: ReadonlySet<string>, playerDown: boolean, partnerAlive: boolean): ArenaTrialCounts {
  const counts = arenaTrialCounts(mission, { actors: {}, player: { knocked: playerDown } as never },
    new Set([...knocked, ...bodies.filter(body => body.npc.dead).map(body => body.actorId)]))
  return partnerAlive ? { ...counts, friendlyActive: counts.friendlyActive + 1 } : counts
}
