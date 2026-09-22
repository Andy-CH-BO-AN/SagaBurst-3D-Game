import * as THREE from 'three'
import type { CharacterFaction } from '../world/CharacterVisuals'
import type { DamageableObstacleKind } from '../world/DamageableObstacle'
import type { ObstacleData } from '../world/Terrain'

export const SIEGE_STRUCTURE_STUCK_SECONDS = 3.0
export const SIEGE_TREE_STUCK_SECONDS = 6.0

/**
 * Attackers prefer the shared main gate when reaching it costs only a modest
 * detour. Units already far out on a flank may instead open a local palisade.
 */
export const SIEGE_GATE_EXTRA_TRAVEL_BUDGET = 16.0

export function isFortificationKind(kind: DamageableObstacleKind): boolean {
  return kind === 'gate'
    || kind === 'palisade'
    || kind === 'chevaux_de_frise'
}

/**
 * Destruction fallback delay for non-fortification obstacles.
 * Trees intentionally take twice as long as tents/campfires to become eligible.
 *
 * Enemy fortifications do not use this timer: they are deliberate breach targets.
 */
export function getSiegeFallbackDelay(kind: DamageableObstacleKind): number {
  return kind === 'tree'
    ? SIEGE_TREE_STUCK_SECONDS
    : SIEGE_STRUCTURE_STUCK_SECONDS
}

function isAttackableFortification(
  obstacle: ObstacleData | null,
  attackerFaction: CharacterFaction,
): obstacle is ObstacleData {
  const damageable = obstacle?.damageable
  return Boolean(
    damageable
    && !damageable.destroyed
    && damageable.isDamageableBy(attackerFaction)
    && isFortificationKind(damageable.kind),
  )
}

function distanceToObstacleXZ(position: THREE.Vector3, obstacle: ObstacleData): number {
  const closestX = THREE.MathUtils.clamp(position.x, obstacle.box.min.x, obstacle.box.max.x)
  const closestZ = THREE.MathUtils.clamp(position.z, obstacle.box.min.z, obstacle.box.max.z)
  return Math.hypot(position.x - closestX, position.z - closestZ)
}

interface GateCacheEntry {
  obstacleCount: number
  gates: ObstacleData[]
}

/**
 * Obstacle arrays are shared by the whole battle. Cache gate discovery by array
 * identity so hundreds of NPCs do not repeatedly scan every structure.
 * Destruction changes array length and invalidates the cache once.
 */
const GATE_CACHE = new WeakMap<ObstacleData[], GateCacheEntry>()

function getCachedGates(obstacles: ObstacleData[]): ObstacleData[] {
  const cached = GATE_CACHE.get(obstacles)
  if (cached && cached.obstacleCount === obstacles.length) return cached.gates

  const gates = obstacles.filter(obstacle => obstacle.damageable?.kind === 'gate')
  GATE_CACHE.set(obstacles, {
    obstacleCount: obstacles.length,
    gates,
  })
  return gates
}

/**
 * Chooses a deliberate breach target from the current local fortification blocker.
 *
 * - Gate/direct chevaux-de-frise are attacked immediately.
 * - Palisade attackers converge on the main gate when it is reasonably nearby.
 * - Flank attackers do not cross half the battlefield just to reach the gate;
 *   they open a local palisade instead.
 */
export function selectFortificationBreachTarget(
  attackerFaction: CharacterFaction,
  position: THREE.Vector3,
  blocker: ObstacleData | null,
  obstacles: ObstacleData[],
): ObstacleData | null {
  if (!isAttackableFortification(blocker, attackerFaction)) return null

  const kind = blocker.damageable!.kind
  if (kind === 'gate' || kind === 'chevaux_de_frise') return blocker

  const blockerDistance = distanceToObstacleXZ(position, blocker)
  let bestGate: ObstacleData | null = null
  let bestGateDistance = Infinity

  for (const gate of getCachedGates(obstacles)) {
    if (!isAttackableFortification(gate, attackerFaction)) continue
    const gateDistance = distanceToObstacleXZ(position, gate)
    if (gateDistance < bestGateDistance) {
      bestGate = gate
      bestGateDistance = gateDistance
    }
  }

  if (
    bestGate
    && bestGateDistance <= blockerDistance + SIEGE_GATE_EXTRA_TRAVEL_BUDGET
  ) {
    return bestGate
  }

  return blocker
}
