import { Box3, Vector3 } from 'three'
import { expect, it, vi } from 'vitest'
import { getOutpostWalkwayLayout, type OutpostWalkwayLayout } from '../../src/campaign/CampaignOutpostWalkways'
import { LayeredNavigationRoute } from '../../src/navigation/LayeredNavigationRoute'
import { NavigationPathFollower } from '../../src/navigation/NavigationPathFollower'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { OutpostLayeredNavigation } from '../../src/navigation/OutpostLayeredNavigation'
import { TownLayeredNavigation } from '../../src/navigation/TownLayeredNavigation'
import { findBlockingObstacleAlongPath, findBlockingProjectileObstacleAlongPath, getTerrainHeight, resolveObstacleCollision, type ObstacleData } from '../../src/world/Terrain'
import { updateSiegeRampGroundObstacle } from '../../src/campaign/MobileSiegeRampPolicy'
import { getCampaignOutpostPlacement } from '../../src/campaign/CampaignOutpost'
import { getSiegeRampPlacement } from '../../src/campaign/MobileSiegeRampPolicy'
import type { BreachEntrance } from '../../src/navigation/AvailableBreachEntrances'
import { getTownRampartLayout, surfaceBox } from '../../src/town/TownRamparts'
import { isTownSiegeDockConnected, planTownSiegeRamps } from '../../src/career/TownFourGateSiegePolicy'
import { NPC } from '../../src/world/NPC'
import { hasOutpostMeleeConnection } from '../../src/combat/MeleeContactQuery'

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

/** Narrow port for NPC's existing melee-range caller; the contact query itself is the shared owner. */
interface MeleeRangeActor {
  combatPosition: Vector3
  meleeAttackRadius: number
  mount: null
  equipmentRequiredForCombat: boolean
  isUsingLance: boolean
  _activeNavigationWorld: { outpostNav: OutpostLayeredNavigation }
  fallObstacles: ObstacleData[]
  _meleeTargetSupportPosition: Vector3
  _movementObstacleHeight(): number
  _hasOutpostMeleeConnection(position: Vector3, targetBodyBaseOffset?: number): boolean
}
const meleeRange = NPC.prototype as unknown as Pick<MeleeRangeActor, '_hasOutpostMeleeConnection'> & {
  _isTargetInMeleeRange(this: MeleeRangeActor, position: Vector3, extraReach?: number, targetBodyBaseOffset?: number): boolean
}

it('allows local melee across a supported deck/bridge seam while rejecting a rail, gap or lower floor', () => {
  const layout = outpostLayout(), nav = new OutpostLayeredNavigation(layout)
  const deck = new Vector3(-4.8, 10, 3), bridge = new Vector3(-3.7, 10, 3)
  expect(nav.getNavLayer(deck)).toBe('rampart_left')
  expect(nav.getNavLayer(bridge)).toBe('rampart_gate')
  expect(nav.hasDirectMeleeConnection(deck, bridge, 2.3, [])).toBe(true)
  expect(nav.hasDirectMeleeConnection(bridge, deck, 2.3, [])).toBe(true)
  const rail: ObstacleData = { box: new Box3(new Vector3(-4.3, 10, 0), new Vector3(-4.2, 11, 6)),
    isBarricade: false, navigationPassable: true }
  expect(nav.hasDirectMeleeConnection(deck, bridge, 2.3, [rail])).toBe(false)
  expect(nav.hasDirectMeleeConnection(deck, new Vector3(-3.7, 0, 3), 2.3, [])).toBe(false)
  // Nav's body margin still labels the endpoints elevated, but a real 0.2m gap
  // in their support surfaces cannot grant contact across an absent connection.
  layout.decks[0].slab.max.x = -4.2
  layout.decks[0].walkSurface.halfWidth = 3.8
  expect(nav.hasDirectMeleeConnection(deck, bridge, 2.3, [])).toBe(false)
})

it('uses Player feet and live fall rails for supported melee without changing the combat target root', () => {
  const nav = new OutpostLayeredNavigation(outpostLayout())
  const attacker = new Vector3(-8, 10, 3), playerRoot = new Vector3(-7, 10.95, 3), feetOffset = -.95
  const rail: ObstacleData = { box: new Box3(new Vector3(-7.6, 10, 0), new Vector3(-7.5, 11, 6)),
    isBarricade: false, navigationPassable: true }
  expect(nav.hasDirectMeleeConnection(attacker, playerRoot, 2.3, [])).toBe(false)
  expect(hasOutpostMeleeConnection(nav, attacker, playerRoot, feetOffset, 2.3, [], new Vector3())).toBe(true)
  expect(hasOutpostMeleeConnection(nav, attacker, playerRoot, feetOffset, 2.3, [rail], new Vector3())).toBe(false)
  expect(playerRoot.toArray()).toEqual([-7, 10.95, 3])
  expect(hasOutpostMeleeConnection(nav, attacker, new Vector3(-7, .95, 3), feetOffset, 2.3, [], new Vector3())).toBe(false)
  // NPC's melee-range caller forwards the same body offset and its live fall obstacles.
  const actor: MeleeRangeActor = { combatPosition: attacker, meleeAttackRadius: 1.8, mount: null,
    equipmentRequiredForCombat: false, isUsingLance: false, _activeNavigationWorld: { outpostNav: nav },
    fallObstacles: [], _meleeTargetSupportPosition: new Vector3(), _movementObstacleHeight: () => 2.3,
    _hasOutpostMeleeConnection: meleeRange._hasOutpostMeleeConnection }
  expect(meleeRange._isTargetInMeleeRange.call(actor, playerRoot, 0, feetOffset)).toBe(true)
  actor.fallObstacles = [rail]
  expect(meleeRange._isTargetInMeleeRange.call(actor, playerRoot, 0, feetOffset)).toBe(false)
  expect(playerRoot.toArray()).toEqual([-7, 10.95, 3])
})

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

it('permits mounted melee at valid body spacing when a rail lies behind the defender', () => {
  const nav = new OutpostLayeredNavigation(outpostLayout())
  const attacker = new Vector3(-8, 10, 1.65), defender = new Vector3(-8, 10, 3.2)
  const rail: ObstacleData = { box: new Box3(new Vector3(-12, 10, 3.85), new Vector3(-4, 11, 4.1)),
    isBarricade: false, navigationPassable: true }
  const mountedPosition = attacker.clone(), footPosition = defender.clone()
  resolveObstacleCollision(mountedPosition, attacker, 0, true, 1, 2.6, 0, [rail])
  resolveObstacleCollision(footPosition, defender, 0, true, .5, 2.3, 0, [rail])
  expect(mountedPosition.toArray()).toEqual(attacker.toArray())
  expect(footPosition.toArray()).toEqual(defender.toArray())
  expect(nav.hasDirectMeleeConnection(attacker, defender, 2.6, [rail])).toBe(true)
  // Moving the same real barrier into the contact segment must still block it.
  rail.box.translate(new Vector3(0, 0, -1.2))
  expect(nav.hasDirectMeleeConnection(attacker, defender, 2.6, [rail])).toBe(false)
})


it('城外弓騎追擊側牆外目標時保留地面路徑，不被 Dock 或舊破口偏好拉回城內', () => {
  const world = new NavigationWorld({ minX: -24, maxX: 24, minZ: -24, maxZ: 32, cellSize: 2 })
  const layout = outpostLayout()
  layout.perimeter = { minX: -12, maxX: 12, minZ: 0, maxZ: 24 }
  for (const stair of layout.stairs) stair.ramp.mounted = true
  world.setOutpostWalkways(layout)
  const nav = world.outpostNav!, ramp = { startX: -8, startZ: -20, startY: 0, topY: 10,
    dirX: 0, dirZ: 1, length: 20, landing: 0, halfWidth: 2, mounted: true }
  nav.entrances.set({ id: 'dock', type: 'siege-ramp-left', position: new Vector3(-8, 0, -20),
    approach: new Vector3(-8, 0, -22), exit: new Vector3(-8, 10, 0), surface: ramp, side: -1,
    mounted: true, walkable: true, faction: null, connectionId: 'dock' })
  nav.entrances.set({ id: 'front-gap', type: 'palisade', position: new Vector3(-8, 0, 0),
    approach: new Vector3(-8, 0, -3), exit: new Vector3(-8, 0, 3),
    mounted: true, walkable: true, faction: null, connectionId: 'front-gap' })
  const obstacles: ObstacleData[] = [{ box: box(-12, -1, -10, 1), isBarricade: true },
    { box: box(-6, -1, 12, 1), isBarricade: true }, { box: box(11, 0, 13, 24), isBarricade: true }]
  world.rebuild(obstacles); world.beginFrame()
  const position = new Vector3(18, 0, -8), goal = new Vector3(18, 0, 12), out = new Vector3()
  const input = request(world, position, goal)
  input.mounted = true; input.outpostMounted = true; input.entranceId = 'front-gap'
  input.skipGroundNavigation = true
  const route = new LayeredNavigationRoute(new NavigationPathFollower())
  const step = route.resolve(input, obstacles, out)
  expect(step).toEqual({ route: 'direct', confirmedLayeredStep: false, tower: false })
  expect(out.toArray()).toEqual(goal.toArray())
  // Side/rear targets are outside the complete enclosure, despite being behind front Z.
  const deck = new Vector3(-8, 10, 2)
  expect(nav.resolveMoveTarget(deck, new Vector3(18, 0, 12), true, out).step).toBe('descend_stair')
  expect(nav.resolveMoveTarget(deck, new Vector3(-8, 0, 30), true, out).step).toBe('descend_stair')
})

/** Real route/follower and mathematical collision support; no scene or actor. */
function transferWalk(world: NavigationWorld, obstacles: ObstacleData[], start: Vector3, goal: Vector3, mounted: boolean) {
  const follower = new NavigationPathFollower(), route = new LayeredNavigationRoute(follower)
  const p = start.clone(), previous = p.clone(), out = new Vector3(), layers = new Set<string>()
  for (let frame = 0; frame < 650 && p.distanceTo(goal) > .6; frame++) {
    world.beginFrame()
    const input = request(world, p, goal); input.mounted = mounted; input.outpostMounted = mounted
    input.radius = mounted ? 1 : .4; input.height = mounted ? 2.6 : 2.3; input.sectorId = world.townNav ? 'east' : null
    const step = route.resolve(input, obstacles, out)
    const kind = step?.route ?? follower.resolveMoveTarget(p, goal, world,
      findBlockingObstacleAlongPath(p, goal, input.radius, input.height, 0, obstacles) !== null, out)
    if (kind === 'unreachable') throw new Error(`unreachable transfer at ${p.toArray()}`)
    layers.add(world.outpostNav?.getNavLayer(p) ?? (world.townNav!.rampAt(p) ? 'native-ramp' : world.townNav!.isElevated(p) ? 'wall' : 'ground'))
    previous.copy(p)
    const distance = Math.hypot(out.x - p.x, out.z - p.z)
    if (kind !== 'pending' && distance > .001) {
      const f = Math.min(.65, distance) / distance; p.x += (out.x - p.x) * f; p.z += (out.z - p.z) * f
    }
    p.y = Math.max(getTerrainHeight(p.x, p.z), p.y - .1)
    resolveObstacleCollision(p, previous, -1, true, input.radius, input.height, 0, obstacles, { walkSurfaces: !mounted, mountedSurfaces: mounted })
    if (Math.abs(p.y - previous.y) > .7) throw new Error('unsupported height transition')
  }
  expect(p.distanceTo(goal), `stopped at ${p.toArray()} toward ${out.toArray()}`).toBeLessThan(.6)
  return layers
}
function outpostTransferFixture() {
  const fort = getCampaignOutpostPlacement('roman'), layout = getOutpostWalkwayLayout(fort)
  const placement = getSiegeRampPlacement(layout, -1), s = placement.surface; s.mounted = true
  const approach = new Vector3(s.startX, 0, s.startZ - s.dirZ * 2.2); approach.y = getTerrainHeight(approach.x, approach.z)
  const entry: BreachEntrance = { id: placement.id, type: placement.id, side: -1, approach,
    position: placement.dock, exit: placement.deckConnection, surface: s, mounted: true, walkable: true, faction: null, connectionId: placement.id }
  const bridge = { ...s, startX: placement.dock.x, startZ: placement.dock.z, startY: s.topY, length: 4, landing: 0 }
  const r = layout.stairs[0].ramp, start = new Vector3(r.startX, 0, r.startZ - r.dirZ * 2.2)
  start.y = getTerrainHeight(start.x, start.z)
  const goal = approach.clone().add(new Vector3(0, 0, 4)); goal.y = getTerrainHeight(goal.x, goal.z)
  const minX = Math.min(start.x, goal.x) - 10, maxX = Math.max(start.x, goal.x) + 10
  const world = new NavigationWorld({ minX, maxX, minZ: Math.min(start.z, goal.z) - 10, maxZ: Math.max(start.z, goal.z) + 10 }, 2)
  world.setOutpostWalkways(layout)
  const obstacles: ObstacleData[] = [...layout.decks.map(d => d.walkSurface), layout.bridge.walkSurface, s, bridge]
    .map(surface => ({ box: surfaceBox(surface), walkSurface: surface, navigationPassable: true, isBarricade: false }))
  for (const stair of layout.stairs) obstacles.push({ box: stair.bounds, walkSurface: stair.ramp, isBarricade: false },
    ...stair.rails.map(box => ({ box, isBarricade: false })), { box: stair.cap, isBarricade: false })
  for (const deck of layout.decks) {
    for (const rail of deck.rails.slice(1)) obstacles.push({ box: rail, navigationPassable: true, isBarricade: false })
    if (deck.side === -1) {
      const left = deck.rails[0].clone(), right = deck.rails[0].clone()
      left.max.x = placement.dock.x - 2.5; right.min.x = placement.dock.x + 2.5
      obstacles.push({ box: left, navigationPassable: true, isBarricade: false }, { box: right, navigationPassable: true, isBarricade: false })
    } else obstacles.push({ box: deck.rails[0], navigationPassable: true, isBarricade: false })
  }
  obstacles.push({ box: new Box3(new Vector3(minX, -100, fort.frontZ - .4), new Vector3(maxX, layout.decks[0].topY, fort.frontZ + .4)), isBarricade: true })
  world.rebuild(obstacles)
  return { world, layout, entry, obstacles, start, goal }
}
it.each([false, true])('Outpost 兩端地面經樓梯、城牆及 Dock 塔往返，mounted=%s，撤銷後不可通行', mounted => {
  const h = outpostTransferFixture(), nav = h.world.outpostNav!, follower = new NavigationPathFollower()
  const route = new LayeredNavigationRoute(follower), out = new Vector3(), input = request(h.world, h.start, h.goal)
  input.mounted = mounted; input.outpostMounted = mounted
  const resolve = () => route.resolve(input, h.obstacles, out)?.route ?? follower.resolveMoveTarget(h.start, h.goal, h.world, true, out)
  h.world.beginFrame(); expect(h.world.areConnected(h.start, h.goal)).toBe(false); expect(resolve()).toBe('unreachable')
  nav.entrances.set(h.entry)
  if (mounted) {
    h.entry.mounted = false; expect(resolve()).toBe('unreachable'); h.entry.mounted = true
    const width = h.entry.surface!.halfWidth; h.entry.surface!.halfWidth = 1; expect(resolve()).toBe('unreachable'); h.entry.surface!.halfWidth = width
    const stair = h.layout.stairs[0].ramp, w = stair.halfWidth; stair.halfWidth = 1
    expect(resolve()).toBe('unreachable'); expect(nav.resolveMoveTarget(h.entry.exit, h.start, true, out, h.entry.id).blocked).toBe(true); stair.halfWidth = w
  }
  for (const layers of [transferWalk(h.world, h.obstacles, h.start, h.goal, mounted), transferWalk(h.world, h.obstacles, h.goal, h.start, mounted)]) {
    expect(layers.has('stair_left')).toBe(true); expect(layers.has('rampart_left')).toBe(true); expect(layers.has('siege_left')).toBe(true)
  }
  nav.entrances.remove(h.entry.id); expect(resolve()).toBe('unreachable')
})
it('Town 封門時沿原生坡道與 Dock 塔完整往返，撤銷或 sector 不符即不可通行', () => {
  const layout = getTownRampartLayout(), native = layout.ramps.find(r => r.gateId === 'east')!
  const placement = planTownSiegeRamps(layout, []).find(r => r.gateId === 'east' && r.side === 1)!, s = placement.surface; s.mounted = true
  const bridge = { ...s, startX: placement.dock.x, startZ: placement.dock.z, startY: placement.dock.y, topY: placement.dock.y, length: 4, landing: 0 }
  expect(isTownSiegeDockConnected(layout, bridge, placement.deckConnection)).toBe(true)
  const approach = new Vector3(s.startX - s.dirX * 2.2, 0, s.startZ - s.dirZ * 2.2); approach.y = getTerrainHeight(approach.x, approach.z)
  const entry: BreachEntrance = { id: placement.id, type: 'siege-ramp', gateId: 'east', side: 1, approach,
    position: placement.dock, exit: placement.deckConnection, surface: s, bridgeSurface: bridge, mounted: true, walkable: true, faction: null, connectionId: placement.id }
  const start = native.entrance.clone(), goal = approach.clone().addScaledVector(new Vector3(s.dirX, 0, s.dirZ), -4); goal.y = getTerrainHeight(goal.x, goal.z)
  const points = [start, native.landing, native.connection, entry.exit, approach, goal]
  const minZ = Math.min(...points.map(p => p.z)) - 10, maxZ = Math.max(...points.map(p => p.z)) + 10
  const world = new NavigationWorld({ minX: Math.min(...points.map(p => p.x)) - 10, maxX: Math.max(...points.map(p => p.x)) + 10, minZ, maxZ }, 2)
  world.setTownRamparts(layout); const nav = world.townNav!; nav.siegeActive = true
  const obstacles: ObstacleData[] = [...layout.decks.map(d => d.surface), ...layout.ramps.map(r => r.surface), s, bridge]
    .map(surface => ({ box: surfaceBox(surface), walkSurface: surface, navigationPassable: true, isBarricade: false }))
  obstacles.push({ box: new Box3(new Vector3(149.2, -100, minZ), new Vector3(150.8, Math.min(native.surface.topY, s.topY) - .8, maxZ)), isBarricade: true })
  world.rebuild(obstacles); world.beginFrame(); expect(world.areConnected(start, goal)).toBe(false)
  const follower = new NavigationPathFollower(), route = new LayeredNavigationRoute(follower), out = new Vector3(), input = request(world, start, goal)
  input.mounted = true; input.radius = 1; input.height = 2.6
  const resolve = () => route.resolve(input, obstacles, out)?.route ?? follower.resolveMoveTarget(start, goal, world, true, out)
  expect(resolve()).toBe('unreachable'); nav.siegeEntrances.set(entry)
  input.sectorId = 'north'; expect(resolve()).toBe('unreachable'); input.sectorId = 'east'; expect(resolve()).not.toBe('unreachable')
  for (const layers of [transferWalk(world, obstacles, start, goal, true), transferWalk(world, obstacles, goal, start, true)]) {
    expect(layers.has('native-ramp')).toBe(true); expect(layers.has('wall')).toBe(true)
  }
  nav.siegeEntrances.remove(entry.id); expect(resolve()).toBe('unreachable')
})

/** Closed east gate between a roman pursuer and a guard behind the wall. */
function closedGatePursuit() {
  const world = new NavigationWorld({ minX: 130, maxX: 300, minZ: 20, maxZ: 70, cellSize: 2 }, 2)
  world.setTownRamparts({ decks: [], ramps: [], corners: [], lengths: [], perimeter: 1, wallSpans: [] })
  const baseY = getTerrainHeight(150, 45)
  const gateObstacle = { box: new Box3(new Vector3(149, baseY, 38), new Vector3(151, baseY + 8, 52)), isBarricade: true,
    damageable: { destroyed: false, isDamageableBy: (faction: string) => faction === 'roman' } } as unknown as ObstacleData
  const wall = (x0: number, z0: number, x1: number, z1: number): ObstacleData => ({ box: box(x0, z0, x1, z1), isBarricade: true })
  const obstacles = [wall(149, 20, 151, 38), wall(149, 52, 151, 70), gateObstacle, wall(218, 38, 220, 50)]
  const gate = { state: 'closed' as 'closed' | 'open' | 'destroyed', siegeObstacle: gateObstacle }
  world.townNav!.setSiegeGates(new Map([['east', gate]]))
  world.rebuild(obstacles)
  const position = new Vector3(260, getTerrainHeight(260, 45), 45), goal = new Vector3(140, getTerrainHeight(140, 45), 45)
  const input = { ...request(world, position, goal), mounted: true, outpostMounted: true, radius: 1, height: 2.6,
    actorId: 'pursuit-party', attackableGate: (o: ObstacleData) => o.damageable?.isDamageableBy('roman') === true }
  return { world, gate, gateObstacle, obstacles, position, input }
}

it('Town 封門追擊沿共用 A* 走到合法城門 approach，突破後釋放城門並恢復一般地面路線', () => {
  const { world, gate, gateObstacle, obstacles, position, input } = closedGatePursuit()
  const route = new LayeredNavigationRoute(new NavigationPathFollower()), out = new Vector3()
  const advance = () => {
    const delta = out.clone().sub(position).setY(0), distance = delta.length()
    if (distance > .001) position.addScaledVector(delta, Math.min(4, distance) / distance)
    position.y = getTerrainHeight(position.x, position.z)
    world.beginFrame()
    expect(world.grid.isBlocked(world.grid.worldToCell(position)!)).toBe(false)
    return route.resolve(input, obstacles, out)
  }
  world.beginFrame()
  expect(route.resolve(input, obstacles, out)).toBeNull()
  let step = route.resolveBlockedPursuit(input, obstacles, out)
  expect(step?.route).toBe('path')
  expect(step?.breach).toBe(gateObstacle)
  expect(route.closedGateObstacle).toBe(gateObstacle)
  const searches = vi.spyOn(world, 'queryPath')
  route.resolve(input, obstacles, out)
  expect(searches).not.toHaveBeenCalled()
  for (let frame = 0; frame < 70 && !step?.approachReached; frame++) step = advance()
  expect(step?.approachReached).toBe(true)
  expect(step?.breach).toBe(gateObstacle)
  gate.state = 'destroyed'
  obstacles.splice(obstacles.indexOf(gateObstacle), 1)
  world.rebuild(obstacles); world.beginFrame()
  // The opened gate is ordinary ground travel again: no breach step, no held gate.
  expect(route.resolve(input, obstacles, out)).toBeNull()
  expect(route.closedGateObstacle).toBeNull()
})

it.each(['front', 'side'] as const)('Outpost %s 木牆破口在城門關閉時仍由共用 A* 引出城，不要求重下命令', side => {
  const world = new NavigationWorld({ minX: -18, maxX: 18, minZ: -6, maxZ: 30, cellSize: 1 }, 2)
  world.setOutpostWalkways(getOutpostWalkwayLayout({ centerX: 0, halfWidth: 12, frontZ: 0, backZ: 24, gateWidth: 8, stakeLineZ: -7 }))
  const nav = world.outpostNav!
  // The perimeter with each removable section sealed; only the tested one opens, and the front gate stays shut.
  const sections = { front: box(-8, 0, -4, 1), side: box(11, 10, 12, 14), rear: box(-8, 23, -4, 24) }
  const wall = (b: Box3): ObstacleData => ({ box: b, isBarricade: true })
  const walls = [box(-12, 0, -8, 1), box(-4, 0, 12, 1), box(-12, 23, -8, 24), box(-4, 23, 12, 24),
    box(-12, 1, -11, 24), box(11, 1, 12, 10), box(11, 14, 12, 24), ...Object.values(sections)].map(wall)
  const opening = walls[walls.length - 3 + (side === 'front' ? 0 : 1)]
  world.rebuild(walls)
  const position = new Vector3(0, 0, 10), goal = side === 'front' ? new Vector3(6, 0, -4) : new Vector3(16, 0, 18)
  const route = new LayeredNavigationRoute(new NavigationPathFollower()), out = new Vector3()
  const input = { ...request(world, position, goal), outpost: nav, mounted: side !== 'front', outpostMounted: side !== 'front',
    radius: .4, height: 2.3, entranceId: 'gate', actorId: 'native-defender' }
  world.beginFrame()
  const sealed = route.resolve(input, walls, out)
  console.log('SEALED', sealed)
  walls.splice(walls.indexOf(opening), 1)
  const centre = opening.box.getCenter(new Vector3()).setY(0), approach = centre.clone(), exit = centre.clone()
  if (side === 'side') { approach.x += 3; exit.x -= 3 }
  else { approach.z -= 3; exit.z += 3 }
  nav.entrances.set({ id: side + '-gap', type: 'palisade', position: centre, approach, exit,
    mounted: true, walkable: true, faction: null, connectionId: side + '-gap' })
  world.sync(walls); world.beginFrame(); input.skipGroundNavigation = true
  let step = route.resolve(input, walls, out)
  expect(step?.route).toBe('path')
  let crossedWall = false
  for (let frame = 0; frame < 65 && position.distanceTo(goal) > .6; frame++) {
    const delta = out.clone().sub(position), distance = delta.length()
    if (distance > .001) position.addScaledVector(delta, Math.min(.8, distance) / distance)
    expect(world.grid.isBlocked(world.grid.worldToCell(position)!)).toBe(false)
    crossedWall ||= side === 'side' ? position.x > 12 : position.z < 0
    world.beginFrame(); step = route.resolve(input, walls, out)
  }
  expect(crossedWall).toBe(true)
  expect(position.distanceTo(goal)).toBeLessThan(.6)
})
