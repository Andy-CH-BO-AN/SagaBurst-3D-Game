import type { NPC } from '../world/NPC'
import type { Player } from '../player/Player'

type AerialCombatant = { dead: boolean; mount: { isFlyingMount: boolean; dead: boolean } | null }

/** Aerial combat power: alive and riding a living flying mount. Ground units and fallen riders do not count. */
export function hasAerialCombatPower(actor: Pick<NPC, 'dead'> & { mount: AerialCombatant['mount'] }): boolean {
  return !actor.dead && actor.mount?.isFlyingMount === true && !actor.mount.dead
}

/**
 * Private eagle knights still riding a living eagle never block a defeat: ground enemies
 * cannot reach them, so once the player and every other friendly falls the mission fails.
 */
export function blocksPlayerSideDefeat(actor: Pick<NPC, 'dead'> & { mount: AerialCombatant['mount'] }): boolean {
  return !actor.dead && !hasAerialCombatPower(actor)
}

export function hasPlayerAerialCombatPower(player: Pick<Player, 'dead'> & { currentMount?: AerialCombatant['mount'] }): boolean {
  const mount = player.currentMount
  return !player.dead && mount?.isFlyingMount === true && !mount.dead
}

/** Eagle Battle ends when either side's aerial force is gone; a simultaneous wipe-out is a failure. */
export function resolveCaptainEagleBattleOutcome(enemyAir: number, friendlyAir: number): 'victory' | 'failure' | null {
  if (friendlyAir <= 0) return 'failure'
  return enemyAir <= 0 ? 'victory' : null
}
