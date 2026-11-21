import type { Vector3 } from 'three'
import type { OutpostLayeredNavigation } from '../navigation/OutpostLayeredNavigation'
import type { ObstacleData } from '../world/Terrain'

/**
 * Support point for a melee contact query. Combat keeps its aim/root coordinates;
 * only the support query moves a raised root (Player body base) down to its feet.
 * Returns `targetPos` itself when no offset applies, otherwise writes `out`.
 */
export function meleeSupportPosition(targetPos: Vector3, targetBodyBaseOffset: number, out: Vector3): Vector3 {
  return targetBodyBaseOffset === 0 ? targetPos : out.copy(targetPos).setY(targetPos.y + targetBodyBaseOffset)
}

/** Local melee contact across Outpost walkway layers; live fall obstacles (rails) block it. */
export function hasOutpostMeleeConnection(
  nav: Pick<OutpostLayeredNavigation, 'hasDirectMeleeConnection'>,
  attacker: Vector3,
  targetPos: Vector3,
  targetBodyBaseOffset: number,
  bodyHeight: number,
  obstacles: ObstacleData[],
  scratch: Vector3,
): boolean {
  return nav.hasDirectMeleeConnection(attacker, meleeSupportPosition(targetPos, targetBodyBaseOffset, scratch),
    bodyHeight, obstacles)
}
