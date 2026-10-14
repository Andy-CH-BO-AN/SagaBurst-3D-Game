import { parseCommandActorCheckpoint } from '../career/CareerCommandAuthority'
import type { PersonalActorCheckpoint } from '../career/CareerPersonalSquadMission'
import { ENEMY_EAGLE_SLOTS } from './EnemyEaglePatrolRules'
import { TOWN_PLAYABLE_WORLD_BOUND } from './TownBounds'
export const ENEMY_EAGLE_STATES = [
  'SPAWNING',
  'WAITING',
  'PATROLLING',
  'ENGAGING',
  'RETURN_QUEUE',
  'RETURNING',
  'RESTING',
  'RESPAWN_COOLDOWN',
] as const
export type EnemyEagleState = (typeof ENEMY_EAGLE_STATES)[number]
export interface EnemyEaglePairCheckpoint {
  id: number
  generation: number
  state: EnemyEagleState
  arrivalState?: EnemyEagleState
  waypoint: number
  elapsed: number
  restRemaining: number
  respawnRemaining: number
  home: {
    x: number
    z: number
    yaw: number
  }
  member?: PersonalActorCheckpoint
}
export interface EnemyEaglePatrolCheckpoint {
  version: 1
  pairs: EnemyEaglePairCheckpoint[]
  nextTakeoffRemaining?: number
}
/** Optional extension: absent old saves start grounded; malformed/duplicate generations never materialize. */
export function parseEnemyEaglePatrolCheckpoint(value: unknown): EnemyEaglePatrolCheckpoint | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Partial<EnemyEaglePatrolCheckpoint>
  if (
    raw.version !== 1 ||
    !Array.isArray(raw.pairs) ||
    raw.pairs.length > 3 ||
    (raw.nextTakeoffRemaining !== undefined &&
      (!Number.isFinite(raw.nextTakeoffRemaining) || raw.nextTakeoffRemaining < 0 || raw.nextTakeoffRemaining > 1.5))
  )
    return undefined
  const pairs: EnemyEaglePairCheckpoint[] = [],
    seen = new Set<number>()
  for (const p of raw.pairs) {
    if (
      !p ||
      !ENEMY_EAGLE_SLOTS.some((id) => id === p.id) ||
      seen.has(p.id) ||
      !Number.isSafeInteger(p.generation) ||
      p.generation < 0 ||
      !ENEMY_EAGLE_STATES.includes(p.state) ||
      (p.arrivalState !== undefined &&
        (!ENEMY_EAGLE_STATES.includes(p.arrivalState) || p.arrivalState === 'SPAWNING')) ||
      !Number.isInteger(p.waypoint) ||
      p.waypoint < 0 ||
      p.waypoint >= 4 ||
      ![p.elapsed, p.restRemaining, p.respawnRemaining].every((n) => Number.isFinite(n) && n >= 0) ||
      p.respawnRemaining > 60 ||
      !p.home ||
      ![p.home.x, p.home.z, p.home.yaw].every(Number.isFinite) ||
      Math.abs(p.home.x) > TOWN_PLAYABLE_WORLD_BOUND - 15 ||
      Math.abs(p.home.z) > TOWN_PLAYABLE_WORLD_BOUND - 15 ||
      Math.hypot(p.home.x, p.home.z) < 195
    )
      return undefined
    const member = p.member === undefined ? undefined : parseCommandActorCheckpoint(p.member)
    if (p.member !== undefined && (!member || !member.mount?.flight)) return undefined
    seen.add(p.id)
    pairs.push({ ...p, home: { ...p.home }, ...(member ? { member } : {}) })
  }
  return {
    version: 1,
    pairs,
    ...(raw.nextTakeoffRemaining !== undefined ? { nextTakeoffRemaining: raw.nextTakeoffRemaining } : {}),
  }
}
