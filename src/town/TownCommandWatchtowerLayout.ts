import { TOWN_CITY, TOWN_PRIVATE_EAGLE_SITES, TOWN_GARRISON_EAGLE_SITES, townRoadIntersectsBox, type TownRoad } from './TownLayout'
import { isEagleLandingClear } from '../world/EagleLanding'
import { isEagleApproachClear } from '../world/EagleApproach'
import { TOWN_PLAYABLE_WORLD_BOUND } from './TownBounds'
import { Box3, Vector3 } from 'three'
import { getTerrainHeight, type ObstacleData, type WalkRampSurface } from '../world/Terrain'
import { surfaceBox } from './TownRamparts'

/** Measured hall crowns include the 7m walls, 5m roof and projecting bar ends:
 * Roman 12.437m / Viking 12.629m above the authored ground origin. */
export const TOWN_COMMAND_WATCHTOWER = {
  x: -29, z: -41, platformHeight: 33.5, totalHeight: 37.5,
  rampWidth: 5, landingWidth: 6, slabThickness: .35, railHeight: 1.1,
} as const
export interface CommandWatchtowerLayout {
  groundY: number; platformY: number; totalHeight: number
  footprint: Box3; core: Box3; entrance: WalkRampSurface
  ramps: WalkRampSurface[]; landings: WalkRampSurface[]; platform: WalkRampSurface[]
}
/** Axis-aligned production surfaces also drive the batched mesh and physical slabs. */
export function watchtowerSurface(ax: number, az: number, ay: number, bx: number, bz: number, by: number, width: number): WalkRampSurface {
  const length = Math.hypot(bx - ax, bz - az)
  return { startX: ax, startZ: az, startY: ay, topY: by, dirX: (bx - ax) / length, dirZ: (bz - az) / length,
    length, landing: 0, halfWidth: width / 2, mounted: true }
}
/** One placement shared by both factions. Its entire 22.4x32.4m envelope sits
 * west of the armoury/stable, east of the -57m eagle corridor, south of -75m pads.
 * The separate east entrance opens in the existing gap between both shops. */
export function getTownCommandWatchtowerLayout(): CommandWatchtowerLayout {
  const c = TOWN_COMMAND_WATCHTOWER, x = c.x, z = c.z
  const entryGround = getTerrainHeight(x + 17.2, z + 13)
  // Start above the highest terrain in the base landing, avoiding a buried ramp.
  const groundY = Math.max(entryGround, ...[-3, 0, 3].flatMap(dx => [-3, 0, 3].map(dz => getTerrainHeight(x + 8 + dx, z + 13 + dz)))) + .03
  const platformY = groundY + c.platformHeight
  const flat = (cx: number, cz: number, y: number, width: number, depth: number) => watchtowerSurface(cx, cz - depth / 2, y, cx, cz + depth / 2, y, width)
  const corners = [[x + 8, z + 13], [x + 8, z - 13], [x - 8, z - 13], [x - 8, z + 13]]
  const ramps: WalkRampSurface[] = [], landings: WalkRampSurface[] = []
  let y = groundY
  landings.push(flat(...corners[0] as [number, number], y, 6, 6))
  for (let i = 0; i < 8; i++) {
    const a = corners[i % 4], b = corners[(i + 1) % 4]
    const distance = Math.hypot(b[0] - a[0], b[1] - a[1]), dx = (b[0] - a[0]) / distance, dz = (b[1] - a[1]) / distance
    const run = distance - 6, nextY = y + run / 120 * c.platformHeight
    ramps.push(watchtowerSurface(a[0] + dx * 3, a[1] + dz * 3, y, b[0] - dx * 3, b[1] - dz * 3, nextY, c.rampWidth))
    landings.push(flat(...b as [number, number], nextY, 6, 6)); y = nextY
  }
  const entrance = watchtowerSurface(x + 17.2, z + 13, entryGround + .03, x + 11, z + 13, groundY, 5)
  // Do not cover the last rising flight with a solid deck. The open central
  // platform connects via the east side, above a much lower (second-circuit) ramp.
  const platform = [flat(x, z, platformY, 10, 20), flat(x + 8, z + 7, platformY, 6, 6), flat(x + 4, z + 6, platformY, 8, 6)]
  return { groundY, platformY, totalHeight: c.totalHeight, entrance, ramps, landings, platform,
    footprint: new Box3(new Vector3(x - 11.2, Math.min(groundY, getTerrainHeight(x, z)) - 1, z - 16.2), new Vector3(x + 11.2, groundY + c.totalHeight, z + 16.2)),
    core: new Box3(new Vector3(x - 5, Math.min(groundY, getTerrainHeight(x, z)) - 1, z - 10), new Vector3(x + 5, platformY - c.slabThickness, z + 10)) }
}
export function watchtowerFootprints(layout: CommandWatchtowerLayout): Box3[] {
  const entrance = surfaceBox(layout.entrance)
  entrance.min.z -= .3; entrance.max.z += .3
  entrance.max.y += TOWN_COMMAND_WATCHTOWER.railHeight
  return [layout.footprint, entrance]
}

/** Validate against the built world before adding the tower's own physical slabs.
 * Full-height bounds reserve decorations as well as the walkable structure. */
export function validateWatchtowerPlacement(layout: CommandWatchtowerLayout, obstacles: readonly ObstacleData[], roads: readonly TownRoad[]): void {
  const footprints = watchtowerFootprints(layout)
  for (const box of footprints) {
    if (box.min.x < TOWN_CITY.minX || box.max.x > TOWN_CITY.maxX || box.min.z < TOWN_CITY.minZ || box.max.z > TOWN_CITY.maxZ
      || obstacles.some(obstacle => obstacle.box.intersectsBox(box))
      || roads.some(road => townRoadIntersectsBox(road, box, 2))) throw new Error('Blocked command watchtower footprint or entrance')
  }
  const tower = footprints.map(box => ({ box, isBarricade: false }))
  for (const pad of [...TOWN_PRIVATE_EAGLE_SITES, ...TOWN_GARRISON_EAGLE_SITES]) {
    if (!isEagleLandingClear(pad, tower, [], TOWN_PLAYABLE_WORLD_BOUND)
      || !isEagleApproachClear(pad, tower, [], TOWN_PLAYABLE_WORLD_BOUND)) throw new Error('Command watchtower blocks an eagle landing or approach')
  }
}
