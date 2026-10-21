import { NPC, RANGED_AI_LAUNCH_HEIGHT } from '../../src/world/NPC'
import { getNpcRangedAttackRange } from '../../src/combat/CombatBalance'
import { townAuthoredRoster, townMilitaryEquipment } from '../../src/town/TownRules'
import { townWatchtowerGuardRoster } from '../../src/town/TownWatchtowerGuardPolicy'
import { siegeDefensePlans } from '../../src/career/TownDefenseRoster'
import { TownWatchtowerNavigation } from '../../src/navigation/TownWatchtowerNavigation'
import { TownProjectileObstacles } from '../../src/town/TownProjectileObstacles'
import { townDefenseThreatResponse } from '../../src/town/TownGarrison'
import { Box3, Matrix4, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { createTownCommandWatchtowerAirspaceObstacle, getTownCommandWatchtowerLayout, getTownCommandWatchtowerRails, getTownCommandWatchtowerUnderfill, validateWatchtowerPlacement } from '../../src/town/TownCommandWatchtowerLayout'
import { surfaceBox } from '../../src/town/TownRamparts'
import { TOWN_CITY_ROADS, TOWN_CENTER, TOWN_HR_REGION, townHousing, type TownRoad } from '../../src/town/TownLayout'
import { findBlockingObstacleAlongPath, findBlockingProjectileObstacleAlongPath, getTerrainHeight, resolveObstacleCollision, type ObstacleData, type WalkRampSurface } from '../../src/world/Terrain'
import { BallisticIntercept } from '../../src/combat/ProjectileBallistics'
import { EagleFlightAI } from '../../src/movement/EagleFlightAI'
import { EagleFlightController } from '../../src/movement/EagleFlightController'
import { XONGKORO } from '../../src/movement/XongkoroConfig'
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
  it('keeps five real T3 native archers on clear supported top posts, outside gate allocation and the stair exit', () => {
    const layout = getTownCommandWatchtowerLayout(), roster = townAuthoredRoster()
    const guards = roster.filter(actor => actor.duty === 'watchtower_guard')
    expect(guards.map(actor => actor.id)).toEqual(['watchtower-archer:1', 'watchtower-archer:2', 'watchtower-archer:3', 'watchtower-archer:4', 'watchtower-archer:5'])
    expect(townWatchtowerGuardRoster(layout)).toEqual(guards)
    expect(new Set(roster.map(actor => actor.id)).size).toBe(roster.length)
    const gateIds = siegeDefensePlans(roster).flatMap(plan => [...plan.infantry, ...plan.cavalry])
    const navigation = new TownWatchtowerNavigation(layout)
    const rails = getTownCommandWatchtowerRails(layout).flatMap(rail => rail.obstacles)
    for (const guard of guards) {
      expect(guard.y).toBe(layout.platformY)
      expect(navigation.surfaceAt({ ...guard, y: guard.y! })).toBeGreaterThanOrEqual(0)
      expect(gateIds).not.toContain(guard.id)
      const body = new Box3(new Vector3(guard.x - .6, guard.y! + .01, guard.z - .6), new Vector3(guard.x + .6, guard.y! + 2.3, guard.z + .6))
      expect(rails.some(rail => rail.box.intersectsBox(body))).toBe(false)
      expect(body.intersectsBox(layout.core)).toBe(false)
      const edge = new Vector3(guard.x + Math.sin(guard.yaw!) * .9, guard.y! + .1, guard.z + Math.cos(guard.yaw!) * .9)
      const crossingBody = new Box3(edge.clone().add(new Vector3(-.35, 0, -.35)), edge.clone().add(new Vector3(.35, 1.8, .35)))
      expect(rails.some(rail => rail.box.intersectsBox(crossingBody))).toBe(true)
      expect(guard.x > -29 && guard.z > -38).toBe(false) // East stair/platform connection remains open.
      const equipment = townMilitaryEquipment('roman', guard)
      expect(equipment).toMatchObject({ presetId: 'roman_archer', tier: 3, level: 3 })
      expect(townMilitaryEquipment('viking', guard)).toMatchObject({ presetId: 'viking_archer', tier: 3, level: 3 })
      const npc = { isMounted: false, rangedWeaponId: equipment.loadout.rangedWeaponId ?? undefined,
        combatPosition: new Vector3(guard.x, guard.y, guard.z) }
      const target = new Vector3(guard.x, layout.groundY, guard.z - 35)
      expect(townDefenseThreatResponse(guard, npc, target, getNpcRangedAttackRange('bow', false), navigation)).toBe('defend')
    }
    // A clear outward shot reaches ground level using the unchanged ballistic/solid-volume policy.
    const guard = guards[0], origin = new Vector3(guard.x, guard.y! + RANGED_AI_LAUNCH_HEIGHT, guard.z)
    const target = new Vector3(guard.x, layout.groundY + 1.4, guard.z - 35), arc = new BallisticIntercept()
    expect(arc.solve(origin, target, new Vector3(), 65)).toBe(true)
    expect(arc.isPathClear(origin, 65, [{ box: layout.core, isBarricade: false }, ...rails], () => layout.groundY)).toBe(true)
    type RangedPort = { combatPosition: Vector3; rangedProjectileSpeed: number; isMountedTownRampartGarrisonEnabled: boolean;
      _tmpRangedOrigin: Vector3; _tmpRangedLosTarget: Vector3; _tmpRangedArcPrevious: Vector3; _tmpRangedArcPoint: Vector3;
      _rangedPathBounds: Box3; _rangedPathObstacles: ObstacleData[] }
    const methods = NPC.prototype as unknown as { _findRangedTrajectoryBlocker(this: RangedPort, target: Vector3, obstacles: ObstacleData[]): ObstacleData | null }
    const actor: RangedPort = { combatPosition: new Vector3(guard.x, guard.y, guard.z), rangedProjectileSpeed: 65,
      isMountedTownRampartGarrisonEnabled: false, _tmpRangedOrigin: new Vector3(), _tmpRangedLosTarget: new Vector3(),
      _tmpRangedArcPrevious: new Vector3(), _tmpRangedArcPoint: new Vector3(), _rangedPathBounds: new Box3(), _rangedPathObstacles: [] }
    const obstacles = [{ box: layout.core, isBarricade: false }, ...rails,
      ...layout.platform.map(surface => ({ box: surfaceBox(surface), isBarricade: false }))]
    expect(methods._findRangedTrajectoryBlocker.call(actor, target.clone().add(new Vector3(0, -1.4, 0)), obstacles)).toBeNull()
    // The live-shot candidate query retained from dev must preserve this real
    // opening and still deliver physical blockers to the shared exact trace.
    const live = new TownProjectileObstacles()
    expect(findBlockingProjectileObstacleAlongPath(origin, target, live.query(origin, target, obstacles))).toBeNull()
    const wall: ObstacleData = { box: new Box3(new Vector3(guard.x - 1, -100, guard.z - 10), new Vector3(guard.x + 1, 100, guard.z - 9)), isBarricade: false }
    expect(methods._findRangedTrajectoryBlocker.call(actor, target, [...obstacles, wall])).toBe(wall)
    expect(findBlockingProjectileObstacleAlongPath(origin, target, live.query(origin, target, [...obstacles, wall]))).toBe(wall)
    type ContactPort = { combatPosition: Vector3; _activeNavigationWorld: { townNav: { watchtower: TownWatchtowerNavigation } } }
    const contact = NPC.prototype as unknown as { _isRampartMeleeThreat(this: ContactPort, target: Vector3): boolean }
    const defender: ContactPort = { combatPosition: actor.combatPosition, _activeNavigationWorld: { townNav: { watchtower: navigation } } }
    expect(contact._isRampartMeleeThreat.call(defender, actor.combatPosition.clone().add(new Vector3(0, 0, .5)))).toBe(true)
    expect(contact._isRampartMeleeThreat.call(defender, new Vector3(guard.x, layout.groundY, guard.z))).toBe(false)


  })

  it('allows shots through the flight envelope above the deck while keeping the physical core solid', () => {
    const layout = getTownCommandWatchtowerLayout()
    const envelope = createTownCommandWatchtowerAirspaceObstacle(layout)
    const core: ObstacleData = { box: layout.core, isBarricade: false }
    const rails = getTownCommandWatchtowerRails(layout).flatMap(rail => rail.obstacles)
    const deck = layout.platform.map(surface => ({ box: surfaceBox(surface), isBarricade: false }))
    const obstacles = [envelope, core, ...rails, ...deck]
    const target = new Vector3(-29, layout.platformY + 1.4, -41)
    const origin = new Vector3(-29, layout.platformY + 3.6, -101)
    const arc = new BallisticIntercept()
    expect(envelope.box).toEqual(layout.footprint)
    expect(arc.solve(origin, target, new Vector3(), 65)).toBe(true)
    expect(arc.isPathClear(origin, 65, obstacles, () => layout.groundY)).toBe(true)
    // Same physical blocker policy still rejects a shot into the tower body.
    target.y = layout.platformY - 5
    expect(arc.solve(origin, target, new Vector3(), 65)).toBe(true)
    expect(arc.isPathClear(origin, 65, [envelope, core], () => layout.groundY)).toBe(false)
  })

  it('raises the ranged flight path for a high deck without losing flight avoidance or changing cruise altitude', () => {
    const pilot = new EagleFlightAI(), flight = new EagleFlightController()
    flight.phase = 'cruise'; flight.speed = XONGKORO.sprintSpeed
    const position = new Vector3(0, 30, -70), destination = new Vector3()
    const command = { kind: 'combat' as const, target: {}, destination, rangedAvailable: true }
    expect(pilot.update(.016, flight, position, command, [], [], 300, () => 0).pitch).toBe(0)
    destination.y = 33.5
    const clearPitch = pilot.update(.016, flight, position, command, [], [], 300, () => 0).pitch
    expect(clearPitch).toBeGreaterThan(0)
    expect(pilot.canUseRanged).toBe(true)
    const envelope: ObstacleData = { isBarricade: false, projectilePassable: true,
      box: new Box3(new Vector3(-11.2, -1, -16.2), new Vector3(11.2, 37.5, 16.2)) }
    // Projectile-passable does not mean fly-through: an intersecting flight
    // envelope still changes the pilot's climb to clear the building.
    expect(pilot.update(.016, flight, position, command, [], [envelope], 300, () => 0).pitch).toBeGreaterThan(clearPitch)
    expect(pilot.cruiseAltitude).toBe(30)
    pilot.reset(); destination.y = 0
    expect(pilot.update(.016, flight, position, command, [], [], 300, () => 0).pitch).toBe(0)
  })

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
    const obstacles = [{ box: layout.core, isBarricade: false }, ...getTownCommandWatchtowerUnderfill(layout), ...getTownCommandWatchtowerRails(layout).flatMap(rail => rail.obstacles)]
    const world = new NavigationWorld({ minX: -43, maxX: -8, minZ: -62, maxZ: -20, cellSize: .5 })
    world.rebuild(obstacles)
    // A low flight pocket is solid for both pathfinding and actual movement.
    const under = new Vector3(-21, getTerrainHeight(-21, -41), -41)
    expect(world.grid.isBlocked(world.grid.worldToCell(under)!)).toBe(true)
    resolveObstacleCollision(under, new Vector3(-16, under.y, -41), 0, true, 1, 2.6, 0, obstacles, { mountedSurfaces: true })
    expect(under.x).toBeGreaterThanOrEqual(-17.5)
    // This strip lies outside the entrance slab, but inside its safety rail.
    expect(world.grid.isBlocked(world.grid.worldToCell({ x: -15, z: -25.25 })!)).toBe(true)
    expect(world.grid.isBlocked(world.grid.worldToCell({ x: -29, z: -41 })!)).toBe(true)
    expect(world.grid.isBlocked(world.grid.worldToCell({ x: -18.35, z: -33 })!)).toBe(true)
    expect(world.grid.isBlocked(world.grid.worldToCell({ x: -18.35, z: -48 })!)).toBe(true)
    const start = new Vector3(-41, getTerrainHeight(-41, -41), -41), goal = new Vector3(-10, getTerrainHeight(-10, -25.25), -25.25)
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

  it('closes the tower ground undercroft and recovers an embedded landing without entering another foundation', () => {
    const layout = getTownCommandWatchtowerLayout()
    const obstacles = [...getTownCommandWatchtowerUnderfill(layout), ...getTownCommandWatchtowerRails(layout).flatMap(rail => rail.obstacles)]
    const world = new NavigationWorld({ minX: -34, maxX: -24, minZ: -60, maxZ: -50, cellSize: .5 })
    world.rebuild(obstacles)
    const start = new Vector3(-29, getTerrainHeight(-29, -59), -59), goal = new Vector3(-29, start.y, -51)
    // The whole first circuit now forms a single grounded building.
    expect(obstacles.some(obstacle => obstacle.box.min.x <= -29 && obstacle.box.max.x >= -29
      && obstacle.box.min.z < -56.65 && obstacle.box.max.z > -56.65)).toBe(true)
    expect(findBlockingObstacleAlongPath(start, goal, 1, 2.6, 0, obstacles)).not.toBeNull()
    const route = world.queryPath(start, goal)
    expect(route.status).toBe('unreachable')
    const embedded = new Vector3(-21, getTerrainHeight(-21, -51.1), -51.1), groundY = embedded.y
    resolveObstacleCollision(embedded, embedded.clone(), 0, true, 1, 2.6, 0, obstacles, { mountedSurfaces: true })
    expect(embedded.y).toBe(groundY)
    expect(findBlockingObstacleAlongPath(embedded, embedded, 1, 2.6, 0, obstacles)).toBeNull()
  })

  it('reserves both-faction buildings, roads, HR and eagle approaches, rejecting a blocked site', () => {
    // Resident/patrol clearance belongs to the existing formal roster invariant
    // in TownResidentLayout; do not regenerate the entire city to test scenery.
    const layout = getTownCommandWatchtowerLayout()
    const bothFactionObstacles: ObstacleData[] = []
    for (const faction of ['roman', 'viking'] as const) {
      // Expanded hulls include foundations, eaves and the front-facing shop porches.
      const obstacles = [
        ...townHousing(faction).map(home => rectangle(home.x, home.z, home.width + 3, home.depth + 3, home.yaw)),
        rectangle(TOWN_CENTER.x, TOWN_CENTER.z, 27, 27),
        rectangle(-6, -17, 14, 16, Math.PI / 2), rectangle(-5, -39, 16, 17, Math.PI / 2),
      ].map(box => ({ box, isBarricade: false }))
      bothFactionObstacles.push(...obstacles)
    }
    // HR site search / resident generation belong to TownResidentLayout. Reserve
    // its entire authored search region instead: 42m laterally covers the widest
    // hall plus the six-column mounted courtyard on either side; 22m longitudinally
    // covers the deepest hall, officer and courtyard, including clearance margins.
    // This is stricter than checking only today's selected site for each faction.
    bothFactionObstacles.push({ isBarricade: false, box: new Box3(
      new Vector3(TOWN_HR_REGION.minX - 42, -100, TOWN_HR_REGION.minZ - 22),
      new Vector3(TOWN_HR_REGION.maxX + 42, 100, TOWN_HR_REGION.maxZ + 22),
    ) })
    // The tower is shared by both factions. Testing the union preserves every
    // building/HR exclusion without repeating the identical eagle corridor scan.
    expect(() => validateWatchtowerPlacement(layout, bothFactionObstacles, roads)).not.toThrow()
    expect(() => validateWatchtowerPlacement(layout, [{ box: rectangle(-29, -41, 1, 1), isBarricade: false }], roads)).toThrow('Blocked command watchtower')
    expect(() => validateWatchtowerPlacement(layout, [], [...roads, { ax: -29, az: -60, bx: -29, bz: -20, width: 5 }])).toThrow('Blocked command watchtower')
    const blocksApproach = { ...layout, footprint: layout.footprint.clone().translate(new Vector3(-17, 0, 0)) }
    expect(() => validateWatchtowerPlacement(blocksApproach, [], [])).toThrow('eagle landing or approach')
  })
})
