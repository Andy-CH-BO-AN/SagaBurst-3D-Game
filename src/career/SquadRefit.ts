import { cloneCareerProfile, type CareerProfile } from './CareerProfile'
import type { CombatEvent } from '../combat/CombatAttribution'
import type { NPC } from '../world/NPC'
import type { Player } from '../player/Player'
import type { TacticalOrder } from '../battle/TacticalOrder'

/** Successful combat contact keeps services unavailable briefly after the last exchange. */
export class SquadRefitSafety {
  private readonly contacts = new Map<string, number>()
  note(event: CombatEvent, now = performance.now()): void {
    if (event.type !== 'damage_applied' && event.type !== 'actor_killed' && event.type !== 'structure_damaged') return
    this.contacts.set(event.source.actorId, now)
    this.contacts.set(event.target.targetId, now)
    if ('ownerActorId' in event.target && event.target.ownerActorId) this.contacts.set(event.target.ownerActorId, now)
  }
  allows(player: Player, actors: readonly NPC[], orders: readonly TacticalOrder[], now = performance.now()): boolean {
    if (player.dead || player.swinging || player.isAiming || player.combatAnimationAction !== 'idle'
      || orders.some(order => order === 'attack' || order === 'charge') || actors.some(actor => !actor.dead && actor.inCombat)) return false
    return ['player', ...actors.map(actor => actor.combatantId)]
      .every(id => now - (this.contacts.get(id) ?? -Infinity) >= 5000)
  }
}

/** A real map transition refits the home roster; reloading the current scene retains casualties. */
export function refitTownCommandForSceneChange(profile: CareerProfile): CareerProfile {
  const next = cloneCareerProfile(profile)
  if (next.townCommandSquad) {
    next.townCommandSquad.members = {}
    next.townCommandSquad.state = 'TRAINING'
  }
  return next
}
