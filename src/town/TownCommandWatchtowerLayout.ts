import { TOWN_CITY, TOWN_PRIVATE_EAGLE_SITES, TOWN_GARRISON_EAGLE_SITES, townRoadIntersectsBox, type TownRoad } from './TownLayout'
import { isEagleLandingClear } from '../world/EagleLanding'
import { isEagleApproachClear } from '../world/EagleApproach'
import { TOWN_PLAYABLE_WORLD_BOUND } from './TownBounds'
import { Box3, Vector3 } from 'three'
import { getTerrainHeight, getWalkRampHeight, type ObstacleData, type WalkRampSurface } from '../world/Terrain'
import { surfaceBox, townRampFoundation } from './TownRamparts'

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
/** The full envelope protects wings, not arrows; physical core, slabs and rails
 * are supplied separately and retain their projectile collision policy. */
export function createTownCommandWatchtowerAirspaceObstacle(layout: CommandWatchtowerLayout): ObstacleData {
  return { box: layout.footprint.clone(), isBarricade: false, projectilePassable: true }
}
/** Shared top-deck posts also locate physical firing openings in the railing. */
export function getTownWatchtowerGuardStations(layout: CommandWatchtowerLayout) {
  const deck = layout.platform[0]
  return [[.9, -1, Math.PI], [.9, 1, Math.PI], [deck.length / 2, 1, -Math.PI / 2],
    [deck.length - .9, 1, 0], [deck.length * .3, -1, Math.PI / 2]].map(([along, side, yaw], index) => {
    const lateral = side * (deck.halfWidth - (index === 2 || index === 4 ? .9 : 1.9))
    const x = deck.startX + deck.dirX * along - deck.dirZ * lateral
    const z = deck.startZ + deck.dirZ * along + deck.dirX * lateral
    const y = getWalkRampHeight(deck, x, z)
    if (y === null || Math.abs(y - layout.platformY) > .001) throw new Error('Unsupported watchtower guard station')
    return { x, y, z, yaw }
  })
}

/** The first circuit is a solid foundation. The second circuit fills down to
 * 3.2m above its matching lower floor, retaining mounted headroom throughout. */
export function getTownCommandWatchtowerUnderfill(layout: CommandWatchtowerLayout): ObstacleData[] {
  const foundations = [townRampFoundation(layout.entrance), ...layout.ramps.map((surface, index) =>
    index < 4 ? townRampFoundation(surface, undefined, false, .5) : townRampFoundation(surface,
      { startY: layout.ramps[index - 4].startY + 3.2, topY: layout.ramps[index - 4].topY + 3.2 }, true, .5))]
  for (let index = 0; index < layout.landings.length; index++) {
    const lower = layout.landings[index - 4]
    foundations.push(lower ? townRampFoundation(layout.landings[index], lower.topY + 3.2, true) : townRampFoundation(layout.landings[index]))
  }
  const ground = foundations.filter(obstacle => !obstacle.navigationPassable)
  const recovery = ground.reduce((box, obstacle) => box.union(obstacle.box), layout.core.clone())
  for (const obstacle of ground) obstacle.solidRecoveryBounds = recovery
  return foundations
}

export interface CommandWatchtowerRail { surface: WalkRampSurface; obstacles: ObstacleData[] }
/** Shared rail data keeps ground navigation aligned with the physical slices,
 * while leaving the upper flights open underneath for foot and mounted actors. */
export function getTownCommandWatchtowerRails(layout: CommandWatchtowerLayout): CommandWatchtowerRail[] {
  const rails: CommandWatchtowerRail[] = [], c = TOWN_COMMAND_WATCHTOWER
  const rail = (surface: WalkRampSurface) => {
    const count = Math.max(1, Math.ceil(Math.abs(surface.topY - surface.startY) / .16))
    const point = (at: number) => new Vector3(surface.startX + surface.dirX * at,
      surface.startY + (surface.topY - surface.startY) * at / surface.length + c.railHeight, surface.startZ + surface.dirZ * at)
    const obstacles: ObstacleData[] = []
    for (let i = 0; i < count; i++) {
      const a = point(i / count * surface.length), b = point((i + 1) / count * surface.length)
      const box = surfaceBox(watchtowerSurface(a.x, a.z, a.y, b.x, b.z, b.y, surface.halfWidth * 2), c.railHeight)
      // The shared ground grid must accommodate the tallest ground collision
      // body (mounted: 2.6m high, 1m radius), including terrain beside each rail.
      let groundTop = -Infinity
      for (const x of [box.min.x - 1, (box.min.x + box.max.x) / 2, box.max.x + 1]) {
        for (const z of [box.min.z - 1, (box.min.z + box.max.z) / 2, box.max.z + 1]) groundTop = Math.max(groundTop, getTerrainHeight(x, z) + 2.6)
      }
      obstacles.push({ box, isBarricade: false, navigationPassable: box.min.y >= groundTop })
    }
    rails.push({ surface, obstacles })
  }
  const all = [layout.entrance, ...layout.ramps, ...layout.landings, ...layout.platform]
  for (const s of [layout.entrance, ...layout.ramps]) for (const side of [-1, 1]) {
    const lateral = side * (s.halfWidth + .15)
    rail({ ...s, startX: s.startX - s.dirZ * lateral, startZ: s.startZ + s.dirX * lateral, halfWidth: .15 })
  }
  // Flat patches share a boundary only at the same height. Split their perimeter
  // at real connections, leaving all ramp mouths and platform links unobstructed.
  for (const s of [...layout.landings, ...layout.platform]) {
    const b = surfaceBox(s), y = s.topY
    for (const axis of ['x', 'z'] as const) for (const side of [-1, 1]) {
      const other = axis === 'x' ? 'z' : 'x', fixed = side < 0 ? b.min[axis] : b.max[axis]
      const min = b.min[other], max = b.max[other]
      const openings: [number, number][] = []
      if (s === layout.platform[0]) {
        // Real 0.6m-wide embrasures align with native bows. The opening is narrower
        // than a foot actor (Player diameter .76m), so bodies still hit its sides.
        for (const post of getTownWatchtowerGuardStations(layout)) {
          const facing = axis === 'x' ? Math.sin(post.yaw) : Math.cos(post.yaw)
          if (Math.abs(facing - side) > .001) continue
          openings.push([post[other] - .3, post[other] + .3])
        }
      }
      for (const adjacent of all) {
        if (adjacent === s) continue
        // Probe the boundary against endpoint height, so an overhead crossing
        // never erases the lower floor's safety rail.
        const a = surfaceBox(adjacent)
        if (fixed < a.min[axis] - .001 || fixed > a.max[axis] + .001) continue
        const lo = Math.max(min, a.min[other]), hi = Math.min(max, a.max[other])
        if (hi <= lo) continue
        const x = axis === 'x' ? fixed : (lo + hi) / 2, z = axis === 'z' ? fixed : (lo + hi) / 2
        const h = getWalkRampHeight(adjacent, x, z)
        if (h !== null && Math.abs(h - y) < .001) openings.push([lo, hi])
      }
      const cuts = [...new Set([min, max, ...openings.flat()])].sort((a, b) => a - b)
      for (let i = 1; i < cuts.length; i++) {
        const lo = cuts[i - 1], hi = cuts[i], mid = (lo + hi) / 2
        if (hi - lo < .001 || openings.some(([a, b]) => mid > a - .001 && mid < b + .001)) continue
        rail(axis === 'x' ? watchtowerSurface(fixed, lo, y, fixed, hi, y, .3) : watchtowerSurface(lo, fixed, y, hi, fixed, y, .3))
      }
    }
  }
  return rails
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
