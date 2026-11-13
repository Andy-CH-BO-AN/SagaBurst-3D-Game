import { Box3, Vector3 } from 'three'
import { VALHALLA } from './ValhallaLayout'
import type { DuelArenaId } from './DuelArenaCatalog'
import type { ArenaTrialFormation } from './ArenaTrialFormation'
import type { ObstacleData } from '../world/Terrain'

/** Inner arena gate / hall entrance, independent of the player's culture. */
export function prisonExitPlan(id: DuelArenaId) {
  return id === 'roman-colosseum'
    ? { gateZ: -19.92, crossingZ: -20.45, height: 2.35, halfWidth: 1.5 }
    : { gateZ: -38.05, crossingZ: -38.65, height: 3.2, halfWidth: 1.5 }
}
/** The closed gate fills exactly the floor passage cut from the arena shell. */
export function prisonGateObstacle(id: DuelArenaId): ObstacleData {
  const { gateZ, height, halfWidth } = prisonExitPlan(id)
  return { box: new Box3(new Vector3(-halfWidth, 0, gateZ - .18), new Vector3(halfWidth, height, gateZ + .18)), isBarricade: false }
}
export function prisonFormation(id: DuelArenaId): ArenaTrialFormation {
  const gateZ = id === 'roman-colosseum' ? -20 : -38
  return {
    player: { x: 0, z: 4, yaw: Math.PI },
    friendly: Array.from({ length: 30 }, (_, i) => ({ x: [-8, -5, -2, 2, 5, 8][i % 6], z: -8 + Math.floor(i / 6) * 5, yaw: Math.PI })),
    enemy: Array.from({ length: 5 }, (_, i) => ({ x: [-4, 4, 0, -3, 3][i], z: gateZ + [6, 6, 4, 2, 2][i], yaw: 0 })),
  }
}
/** Open only the floor passage belonging to this encounter; ordinary arenas retain their complete shell. */
export function prisonExitObstacles(id: DuelArenaId, original: readonly ObstacleData[]): ObstacleData[] {
  const { halfWidth, height } = prisonExitPlan(id)
  return original.flatMap(wall => {
    const b = wall.box
    const atExit = id === 'roman-colosseum'
      ? b.max.z < -19 && b.min.z > -30 && b.min.x < halfWidth && b.max.x > -halfWidth && b.min.y < height
      : b.min.z === VALHALLA.frontZ - VALHALLA.wallThickness && b.max.z === VALHALLA.frontZ && b.min.x < -VALHALLA.halfWidth && b.max.x > VALHALLA.halfWidth
    if (!atExit) return [wall]
    // Keep the part of every curved wall box outside the doorway. Dropping an
    // intersecting box whole makes the physical opening wider than its exit rule.
    const pieces: ObstacleData[] = []
    if (b.min.x < -halfWidth) {
      const box = b.clone(); box.max.x = -halfWidth
      pieces.push({ ...wall, box })
    }
    if (b.max.x > halfWidth) {
      const box = b.clone(); box.min.x = halfWidth
      pieces.push({ ...wall, box })
    }
    if (b.max.y > height) {
      const box = b.clone()
      box.min.x = Math.max(b.min.x, -halfWidth); box.max.x = Math.min(b.max.x, halfWidth); box.min.y = height
      pieces.push({ ...wall, box })
    }
    return pieces
  })
}
