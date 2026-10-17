import { Box3, Matrix4, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { getTownCommandWatchtowerLayout, getTownCommandWatchtowerRails, validateWatchtowerPlacement, watchtowerFootprints } from '../../src/town/TownCommandWatchtowerLayout'
import { surfaceBox } from '../../src/town/TownRamparts'
import { TOWN_CITY_ROADS, TOWN_CENTER, townHousing, type TownRoad } from '../../src/town/TownLayout'
import { townRoster, townPatrolRefitPoint, townPlayerEntryPoint } from '../../src/town/TownRules'
import { resolveTownHRLayout } from '../../src/town/TownHRLayout'
import { townPatrolDeparture, townPatrolRoute } from '../../src/town/TownPatrolRoute'
import { findBlockingObstacleAlongPath, getTerrainHeight, type WalkRampSurface } from '../../src/world/Terrain'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'

function rectangle(x: number, z: number, width: number, depth: number, yaw = 0): Box3 {
  return new Box3(new Vector3(-width / 2, -100, -depth / 2), new Vector3(width / 2, 100, depth / 2))
    .applyMatrix4(new Matrix4().makeRotationY(yaw)).translate(new Vector3(x, 0, z))
}
function endpoint(surface: WalkRampSurface, end: boolean): Vector3 {
  return new Vector3(surface.startX + (end ? surface.dirX * surface.length : 0), end ? surface.topY : surface.startY,
    surface.startZ + (end ? surface.dirZ * surface.length : 0))
}

// The additional plaza/housing roads are authored directly by TownWorld. These
// independent values also protect the data-only layout without building a scene.
const roads: readonly TownRoad[] = [...TOWN_CITY_ROADS,
  { ax: 32, az: 12, bx: 74, bz: 12, width: 32 },
  { ax: 30, az: -58, bx: 125, bz: -58, width: 6 },
  { ax: 80, az: -58, bx: 80, bz: 42, width: 6 },
  { ax: 80, az: 56, bx: 136, bz: 56, width: 5 },
  { ax: 80, az: 80, bx: 138, bz: 80, width: 4 },
]

describe('Town command watchtower', () => {
  it('connects its mounted entrance, eight wide flights, turn landings and upper platform without height gaps', () => {
    const layout = getTownCommandWatchtowerLayout()
    expect(layout.ramps).toHaveLength(8)
    expect(layout.landings).toHaveLength(9)
    expect(layout.platformY - layout.groundY).toBeCloseTo(33.5)
    expect(layout.totalHeight).toBe(37.5)
    for (const [index, ramp] of layout.ramps.entries()) {
      expect(ramp.halfWidth * 2).toBeGreaterThanOrEqual(5)
      expect(ramp.mounted).toBe(true)
      expect((ramp.topY - ramp.startY) / ramp.length).toBeLessThanOrEqual(.4)
      const before = layout.landings[index], after = layout.landings[index + 1]
      expect(before.startY).toBeCloseTo(ramp.startY)
      expect(after.startY).toBeCloseTo(ramp.topY)
      expect(surfaceBox(before).expandByScalar(1e-8).containsPoint(endpoint(ramp, false))).toBe(true)
      expect(surfaceBox(after).expandByScalar(1e-8).containsPoint(endpoint(ramp, true))).toBe(true)
    }
    for (const landing of layout.landings) {
      expect(landing.halfWidth * 2).toBeGreaterThanOrEqual(6)
      expect(landing.length).toBeGreaterThanOrEqual(6)
      expect(landing.startY).toBe(landing.topY)
    }
    expect(surfaceBox(layout.landings[0]).expandByScalar(1e-8).containsPoint(endpoint(layout.entrance, true))).toBe(true)
    expect(layout.entrance.topY).toBeCloseTo(layout.groundY)
    expect(Math.abs(layout.entrance.topY - layout.entrance.startY) / layout.entrance.length).toBeLessThanOrEqual(.4)
    const connected = [surfaceBox(layout.landings.at(-1)!)]
    expect(layout.landings.at(-1)!.topY).toBeCloseTo(layout.platformY)
    const remaining = layout.platform.map(surface => {
      expect(surface.startY).toBeCloseTo(layout.platformY)
      expect(surface.topY).toBeCloseTo(layout.platformY)
      return surfaceBox(surface)
    })
    for (let pass = 0; pass < layout.platform.length; pass++) {
      for (let index = remaining.length - 1; index >= 0; index--) {
        if (connected.some(box => box.intersectsBox(remaining[index]))) connected.push(...remaining.splice(index, 1))
      }
    }
    expect(remaining).toHaveLength(0)
  })

  it('routes ground actors around the solid core and low entrance rails', () => {
    const layout = getTownCommandWatchtowerLayout()
    const obstacles = [{ box: layout.core, isBarricade: false }, ...getTownCommandWatchtowerRails(layout).flatMap(rail => rail.obstacles)]
    const world = new NavigationWorld({ minX: -43, maxX: -8, minZ: -62, maxZ: -20, cellSize: .5 })
    world.rebuild(obstacles)
    // This strip lies outside the entrance slab, but inside its safety rail.
    expect(world.grid.isBlocked(world.grid.worldToCell({ x: -15, z: -25.25 })!)).toBe(true)
    expect(world.grid.isBlocked(world.grid.worldToCell({ x: -29, z: -41 })!)).toBe(true)
    expect(world.grid.isBlocked(world.grid.worldToCell({ x: -18.35, z: -33 })!)).toBe(true)
    expect(world.grid.isBlocked(world.grid.worldToCell({ x: -18.35, z: -48 })!)).toBe(false)
    const start = new Vector3(-40, getTerrainHeight(-40, -41), -41), goal = new Vector3(-10, getTerrainHeight(-10, -25.25), -25.25)
    expect(findBlockingObstacleAlongPath(start, goal, .5, 2.3, 0, obstacles)).not.toBeNull()
    const route = world.queryPath(start, goal)
    expect(route.status).toBe('path')
    if (route.status !== 'path') return
    expect(route.path[0]).toEqual(world.grid.worldToCell(start))
    expect(route.path.at(-1)).toEqual(world.grid.worldToCell(goal))
    for (const cell of route.path) expect(world.grid.isBlocked(cell)).toBe(false)
    // Local NPC steering also sees the rail instead of retrying a direct move.
    const across = new Vector3(-15, getTerrainHeight(-15, -24), -24)
    expect(findBlockingObstacleAlongPath(across, new Vector3(-15, across.y, -27), .5, 2.3, 0, obstacles)).not.toBeNull()
  })

  it('keeps ground routes beneath raised guardrails open', () => {
    const layout = getTownCommandWatchtowerLayout()
    const obstacles = getTownCommandWatchtowerRails(layout).flatMap(rail => rail.obstacles)
    const world = new NavigationWorld({ minX: -34, maxX: -24, minZ: -60, maxZ: -50, cellSize: .5 })
    world.rebuild(obstacles)
    const start = new Vector3(-29, getTerrainHeight(-29, -59), -59), goal = new Vector3(-29, start.y, -51)
    // The first circuit's north flight is overhead here; mounted bodies fit.
    expect(obstacles.some(obstacle => obstacle.box.min.x <= -29 && obstacle.box.max.x >= -29
      && obstacle.box.min.z < -56.65 && obstacle.box.max.z > -56.65)).toBe(true)
    expect(findBlockingObstacleAlongPath(start, goal, 1, 2.6, 0, obstacles)).toBeNull()
    const route = world.queryPath(start, goal)
    expect(route.status).toBe('path')
    if (route.status !== 'path') return
    expect(route.path.every(cell => cell.x === 10)).toBe(true)
    expect(route.path.at(-1)).toEqual({ x: 10, z: 18 })
  })

  it('reserves both-faction buildings, residents, roads, HR and eagle approaches, rejecting a blocked site', () => {
    const layout = getTownCommandWatchtowerLayout(), footprints = watchtowerFootprints(layout)
    const residents = townRoster()
    const positions = [
      ...residents.map(actor => actor.garrison ?? actor),
      ...residents.filter(actor => actor.patrolId).map(townPatrolRefitPoint), townPlayerEntryPoint(),
    ]
    expect(positions.filter(point => footprints.some(box => box.intersectsBox(rectangle(point.x, point.z, 6, 6))))).toEqual([])
    const patrol = [...townPatrolRoute(), ...townPatrolDeparture('A').waypoints, ...townPatrolDeparture('B').waypoints]
    expect(patrol.filter(point => footprints.some(box => box.intersectsBox(rectangle(point.x, point.z, 10, 10))))).toEqual([])
    for (const faction of ['roman', 'viking'] as const) {
      // Expanded hulls include foundations, eaves and the front-facing shop porches.
      const obstacles = [
        ...townHousing(faction).map(home => rectangle(home.x, home.z, home.width + 3, home.depth + 3, home.yaw)),
        rectangle(TOWN_CENTER.x, TOWN_CENTER.z, 27, 27),
        rectangle(-6, -17, 14, 16, Math.PI / 2), rectangle(-5, -39, 16, 17, Math.PI / 2),
      ].map(box => ({ box, isBarricade: false }))
      const hr = resolveTownHRLayout(faction, obstacles, roads)
      obstacles.push(...[
        rectangle(hr.site.x, hr.site.z, hr.width + 4, hr.depth + 6, hr.site.yaw),
        rectangle(hr.officer.x, hr.officer.z, 6, 6),
        ...hr.muster.map(point => rectangle(point.x, point.z, 6, 6)),
      ].map(box => ({ box, isBarricade: false })))
      expect(() => validateWatchtowerPlacement(layout, obstacles, roads)).not.toThrow()
    }
    expect(() => validateWatchtowerPlacement(layout, [{ box: rectangle(-29, -41, 1, 1), isBarricade: false }], roads)).toThrow('Blocked command watchtower')
    expect(() => validateWatchtowerPlacement(layout, [], [...roads, { ax: -29, az: -60, bx: -29, bz: -20, width: 5 }])).toThrow('Blocked command watchtower')
    const blocksApproach = { ...layout, footprint: layout.footprint.clone().translate(new Vector3(-17, 0, 0)) }
    expect(() => validateWatchtowerPlacement(blocksApproach, [], [])).toThrow('eagle landing or approach')
  })
})
