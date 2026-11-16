/** Seconds without any damage, after the player falls, before a mission with surviving aerial friendlies is lost. */
export const PLAYER_SIDE_STALEMATE_SECONDS = 60

type HpSample = { dead: boolean; hp: number; mount?: { dead: boolean; currentHp: number } | null }

/** Total live HP of every combatant and its mount; any drop means the battle is still being fought. */
export function combatHpTotal(actors: Iterable<HpSample>): number {
  let total = 0
  for (const actor of actors) {
    if (!actor.dead) total += Math.max(0, actor.hp)
    if (actor.mount && !actor.mount.dead) total += Math.max(0, actor.mount.currentHp)
  }
  return total
}

/**
 * Once the player is dead, surviving friendlies (e.g. private eagle knights out of reach of ground
 * enemies) can leave a battle that neither side can finish. A long enough stretch with no damage
 * anywhere is a stalemate, which the mission resolves as a failure. Healing never resets it.
 */
export class PlayerSideStalemate {
  private quietSeconds = 0
  private lastHp: number | undefined

  advance(dt: number, playerDead: boolean, hpTotal: number): void {
    if (!playerDead) { this.reset(); return }
    if (this.lastHp !== undefined && hpTotal < this.lastHp - 1e-3) this.quietSeconds = 0
    else if (this.lastHp !== undefined) this.quietSeconds += Math.max(0, dt)
    this.lastHp = hpTotal
  }

  get stalled(): boolean { return this.quietSeconds >= PLAYER_SIDE_STALEMATE_SECONDS }

  reset(): void { this.quietSeconds = 0; this.lastHp = undefined }
}
