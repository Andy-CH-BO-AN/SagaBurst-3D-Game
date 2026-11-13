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
  if (id === 'roman-colosseum') return original.filter(({ box }) => !(box.max.z < -19 && box.min.z > -30
    && box.min.x < 1.5 && box.max.x > -1.5 && box.min.y < 2.1))
  return original.flatMap(wall => {
    const b = wall.box
    if (!(b.min.z === VALHALLA.frontZ - VALHALLA.wallThickness && b.max.z === VALHALLA.frontZ && b.min.x < -VALHALLA.halfWidth && b.max.x > VALHALLA.halfWidth)) return [wall]
    return [
      { ...wall, box: new Box3(new Vector3(b.min.x, 0, b.min.z), new Vector3(-1.5, b.max.y, b.max.z)) },
      { ...wall, box: new Box3(new Vector3(1.5, 0, b.min.z), b.max.clone()) },
      { ...wall, box: new Box3(new Vector3(-1.5, 3.2, b.min.z), new Vector3(1.5, b.max.y, b.max.z)) },
    ]
  })
}
