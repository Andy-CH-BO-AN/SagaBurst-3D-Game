import { Box3, Vector3 } from 'three'
import { expect, it } from 'vitest'
import type { OutpostWalkwayLayout } from '../../src/campaign/CampaignOutpostWalkways'
import { LayeredNavigationRoute } from '../../src/navigation/LayeredNavigationRoute'
import { NavigationPathFollower } from '../../src/navigation/NavigationPathFollower'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { TownLayeredNavigation } from '../../src/navigation/TownLayeredNavigation'
import { findBlockingObstacleAlongPath, findBlockingProjectileObstacleAlongPath, resolveObstacleCollision, type ObstacleData } from '../../src/world/Terrain'
import { updateSiegeRampGroundObstacle } from '../../src/campaign/MobileSiegeRampPolicy'

function box(x0: number, z0: number, x1: number, z1: number): Box3 {
  return new Box3(new Vector3(x0, -10, z0), new Vector3(x1, 15, z1))
}

function request(world: NavigationWorld, position: Vector3, goal: Vector3): Parameters<LayeredNavigationRoute['resolve']>[0] {
  const currentLayer = world.outpostNav?.getNavLayer(position) ?? 'ground'
  const targetLayer = world.outpostNav?.getNavLayer(goal) ?? 'ground'
  return { position, goal, world, outpost: world.outpostNav, currentLayer, targetLayer,
    differentLayer: currentLayer !== targetLayer, mounted: false, outpostMounted: false, flying: false,
    radius: .5, height: 2.3, entranceId: null, sectorId: null, actorId: 'route-test', skipGroundNavigation: false }
}

it('keeps a Town ground approach pending on skipped boids frames and resumes its existing follower next frame', () => {
  const world = new NavigationWorld({ minX: 120, maxX: 220, minZ: -30, maxZ: 30, cellSize: 2 }, 1)
  const obstacles: ObstacleData[] = [{ box: box(190, -4, 192, 4), isBarricade: true }]
  world.rebuild(obstacles)
  const town = world.townNav = new TownLayeredNavigation({ decks: [], ramps: [], corners: [], lengths: [], perimeter: 1, wallSpans: [] })
  const surface = { startX: 182, startZ: 0, startY: 0, topY: 10, dirX: -1, dirZ: 0, length: 24, landing: 6, halfWidth: 2.5 }
  town.siegeActive = true
  town.siegeEntrances.set({ id: 'town-siege-ramp:east:left', gateId: 'east', type: 'siege-ramp', position: new Vector3(152, 10, 0),
    approach: new Vector3(184.2, 0, 0), exit: new Vector3(148, 10, 0), surface,
    bridgeSurface: { ...surface, startX: 152, startY: 10, length: 4, landing: 0 },
    faction: null, walkable: true, mounted: true, connectionId: 'route-test' })
  const input = request(world, new Vector3(198, 0, 0), new Vector3(140, 10, 0))
  input.entranceId = 'town-siege-ramp:east:left'
  input.skipGroundNavigation = true
  const route = new LayeredNavigationRoute(new NavigationPathFollower()), out = new Vector3()
  world.beginFrame()
  expect(world.queryPath({ x: 125, z: -20 }, { x: 135, z: -20 }).status).toBe('path')
  expect(route.resolve(input, obstacles, out)).toEqual({ route: 'pending', confirmedLayeredStep: false, tower: false })
  expect(out.toArray()).toEqual([184.2, 0, 0])
  world.beginFrame()
  expect(route.resolve(input, obstacles, out)).toEqual({ route: 'path', confirmedLayeredStep: false, tower: false })
  expect(world.grid.isBlocked(world.grid.worldToCell(out)!)).toBe(false)
  expect(out.equals(input.goal)).toBe(false)
})

it('routes around the complete live hull while retaining its rear boarding and upper walk lane', () => {
  const world = new NavigationWorld({ minX: 140, maxX: 200, minZ: -20, maxZ: 20 })
  const hull: ObstacleData = { box: box(152, -2.7, 182, 2.7), isBarricade: true, navigationPassable: true }
  const chassis: ObstacleData = { box: box(151.5, -2.87, 158, 2.87), isBarricade: true, navigationPassable: true }
  const ground: ObstacleData = { box: new Box3(), isBarricade: true }
  updateSiegeRampGroundObstacle(ground, [hull, chassis])
  const obstacles = [ground]
  world.sync(obstacles)
  expect(findBlockingObstacleAlongPath(new Vector3(160, 0, 5), new Vector3(160, 0, 2.8), .5, 2.3, 0, obstacles)).toBe(ground)
  expect(findBlockingObstacleAlongPath(new Vector3(148, 0, 0), new Vector3(151.4, 0, 0), .5, 2.3, 0, obstacles)).toBe(ground)
  expect(findBlockingObstacleAlongPath(new Vector3(187, 0, 0), new Vector3(184.2, 0, 0), 1, 2.6, 0, obstacles)).toBeNull()
  const town = world.townNav = new TownLayeredNavigation({ decks: [], ramps: [], corners: [], lengths: [], perimeter: 1, wallSpans: [] })
  const surface = { startX: 182, startZ: 0, startY: 0, topY: 10, dirX: -1, dirZ: 0, length: 24, landing: 6, halfWidth: 2.5 }
  town.siegeActive = true
  town.siegeEntrances.set({ id: 'hull-route', gateId: 'east', type: 'siege-ramp', position: new Vector3(152, 10, 0),
    approach: new Vector3(184.2, 0, 0), exit: new Vector3(148, 10, 0), surface,
    bridgeSurface: { ...surface, startX: 152, startY: 10, length: 4, landing: 0 },
    faction: null, walkable: true, mounted: true, connectionId: 'hull-route' })
  const route = new LayeredNavigationRoute(new NavigationPathFollower()), out = new Vector3()
  // Body-clear beside the chassis, but its centre is in a coarse blocked edge cell.
  const input = request(world, new Vector3(165, 0, 3.95), new Vector3(140, 10, 0))
  input.entranceId = 'hull-route'
  input.mounted = true; input.radius = 1; input.height = 2.6
  expect(world.grid.isBlocked(world.grid.worldToCell(input.position)!)).toBe(true)
  expect(route.resolve(input, obstacles, out)?.route).toBe('path')
  expect(world.grid.isBlocked(world.grid.worldToCell(out)!)).toBe(false)
  input.position.set(184.2, 0, 0)
  expect(route.resolve(input, obstacles, out)?.confirmedLayeredStep).toBe(true)
  expect(out.x).toBe(181)
  input.position.set(158, 10, 0)
  expect(route.resolve(input, obstacles, out)?.confirmedLayeredStep).toBe(true)
  expect(out.x).toBeCloseTo(152.3)
  // Navigation must not create an invisible collision or projectile wall above the slope.
  const previous = new Vector3(170, 8, 0), position = new Vector3(169, 8, 0)
  resolveObstacleCollision(position, previous, 0, false, .5, 2.3, 0, obstacles)
  expect(position.toArray()).toEqual([169, 8, 0])
  expect(findBlockingProjectileObstacleAlongPath(previous, position, obstacles)).toBeNull()
})

/** Only mathematical surfaces are needed; no world builder or rendered actors. */
function outpostLayout(): OutpostWalkwayLayout {
  const sides = [-1, 1] as const
  const extras = { rails: [], posts: [], frontRailProjectileBoxes: [], frontCrenelSpans: [] }
  const flat = { startX: 0, startZ: 0, startY: 10, topY: 10, dirX: 0, dirZ: 1, length: 6, landing: 0, halfWidth: 3 }
  return { zSign: 1,
    decks: sides.map(side => ({ side, topY: 10,
      slab: new Box3(new Vector3(side < 0 ? -12 : 4, 9.5, 0), new Vector3(side < 0 ? -4 : 12, 10, 6)),
      walkSurface: { ...flat, startX: side * 8, halfWidth: 4 }, ...extras })),
    stairs: sides.map(side => ({ side,
      ramp: { ...flat, startX: side * 8, startZ: 16, startY: 0, dirZ: -1, length: 10, landing: 1, halfWidth: 2 },
      bounds: box(side * 8 - 2, 5, side * 8 + 2, 16), rails: [], cap: box(side * 8 - 2, 5, side * 8 + 2, 6) })),
    bridge: { topY: 10, slab: new Box3(new Vector3(-4, 9.5, 0), new Vector3(4, 10, 6)), walkSurface: { ...flat, halfWidth: 4 }, ...extras } }
}

it('keeps an Outpost ground approach blocked unless the caller explicitly skips ground navigation', () => {
  const world = new NavigationWorld({ minX: -30, maxX: 30, minZ: -10, maxZ: 40, cellSize: 2 })
  world.setOutpostWalkways(outpostLayout())
  const obstacles: ObstacleData[] = [{ box: box(-30, 22, 30, 24), isBarricade: true }]
  world.rebuild(obstacles); world.beginFrame()
  const input = request(world, new Vector3(-8, 0, 28), new Vector3(-8, 10, 2))
  const route = new LayeredNavigationRoute(new NavigationPathFollower()), out = new Vector3()
  expect(route.resolve(input, obstacles, out)).toEqual({ route: 'unreachable', confirmedLayeredStep: false, tower: false })
  expect(out.x).toBe(-8); expect(out.z).toBeCloseTo(18.2)
  input.skipGroundNavigation = true
  expect(route.resolve(input, obstacles, out)).toEqual({ route: 'direct', confirmedLayeredStep: false, tower: false })
  expect(out.x).toBe(-8); expect(out.z).toBeCloseTo(18.2)
})
