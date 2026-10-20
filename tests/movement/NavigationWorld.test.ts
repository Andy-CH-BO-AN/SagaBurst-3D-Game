import { TownWatchtowerNavigation } from '../../src/navigation/TownWatchtowerNavigation'
import { getTownCommandWatchtowerLayout, getTownCommandWatchtowerRails, getTownCommandWatchtowerUnderfill } from '../../src/town/TownCommandWatchtowerLayout'
import { surfaceBox } from '../../src/town/TownRamparts'
import { resolveObstacleCollision } from '../../src/world/Terrain'
import * as THREE from 'three'
import { TownLayeredNavigation } from '../../src/navigation/TownLayeredNavigation'
import { AvailableBreachEntrances, type BreachEntrance } from '../../src/navigation/AvailableBreachEntrances'
import { getTownRampartLayout, type TownRampartLayout } from '../../src/town/TownRamparts'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import {
  NavigationWorld,
} from '../../src/navigation/NavigationWorld'
import {
  createRiverCrossingObstacleData,
  getRiverCenterZ,
  RIVER_CROSSING_LAYOUT,
} from '../../src/world/RiverCrossingBattlefield'
import {
  findBlockingObstacleAlongPath,
  getTerrainHeight,
  PLAYABLE_WORLD_BOUND,
  type ObstacleData,
} from '../../src/world/Terrain'

function obstacle(
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
): ObstacleData {
  return {
    box: new THREE.Box3(
      new THREE.Vector3(minX, 0, minZ),
      new THREE.Vector3(maxX, 3, maxZ),
    ),
    isBarricade: true,
  }
}

describe('NavigationWorld', () => {
  it('rebuilds only when shared obstacle topology changes', () => {
    const world = new NavigationWorld({ minX: -50, maxX: 50, minZ: -50, maxZ: 50, cellSize: 2 })
    const obstacles: ObstacleData[] = []

    expect(world.sync(obstacles)).toBe(true)
    const firstRevision = world.revision
    expect(world.sync(obstacles)).toBe(false)
    expect(world.revision).toBe(firstRevision)

    obstacles.push(obstacle(-1, -1, 1, 1))

    expect(world.sync(obstacles)).toBe(true)
    expect(world.revision).toBe(firstRevision + 1)
    expect(
      world.grid.isBlocked(world.grid.worldToCell(new THREE.Vector3(0, 0, 0))!),
    ).toBe(true)

    obstacles.pop()
    expect(world.sync(obstacles)).toBe(true)
    expect(
      world.grid.isBlocked(world.grid.worldToCell(new THREE.Vector3(0, 0, 0))!),
    ).toBe(false)
  })

  it('rejects disconnected regions before spending an A star request', () => {
    const budget = 2
    const world = new NavigationWorld({ minX: -50, maxX: 50, minZ: -50, maxZ: 50, cellSize: 2 }, budget)
    world.rebuild([
      obstacle(-1, -50, 1, 50),
    ])
    world.beginFrame()

    expect(
      world.queryPath(
        new THREE.Vector3(-10, 0, 0),
        new THREE.Vector3(10, 0, 0),
      ).status,
    ).toBe('unreachable')

    // The disconnected query above must not consume the frame A* budget.
    for (let i = 0; i < budget; i++) {
      expect(
        world.queryPath(
          new THREE.Vector3(-10, 0, -40 + i * 4),
          new THREE.Vector3(-20, 0, -40 + i * 4),
        ).status,
      ).toBe('path')
    }
  })

  it('admits the configured number of uncached A star searches and queues the next', () => {
    const budget = 3
    const world = new NavigationWorld({ minX: -50, maxX: 50, minZ: -50, maxZ: 50, cellSize: 2 }, budget)
    world.rebuild([obstacle(-1, -8, 1, 8)])
    world.beginFrame()

    for (let i = 0; i < budget; i++) {
      const z = -4 + i * 4
      expect(world.queryPath(
        new THREE.Vector3(-8, 0, z),
        new THREE.Vector3(8, 0, z),
      ).status).toBe('path')
    }

    const deferredZ = -4 + budget * 4
    expect(world.queryPath(
      new THREE.Vector3(-8, 0, deferredZ),
      new THREE.Vector3(8, 0, deferredZ),
    ).status).toBe('pending')

    world.beginFrame()
    expect(world.queryPath(
      new THREE.Vector3(-8, 0, deferredZ),
      new THREE.Vector3(8, 0, deferredZ),
    ).status).toBe('path')
  })

  it('routes North and South bank paths exclusively through the five-lane bridge and blocks river or map-edge crossings', () => {
    const obstacles = createRiverCrossingObstacleData()
    const world = new NavigationWorld({
      minX: -PLAYABLE_WORLD_BOUND,
      maxX: PLAYABLE_WORLD_BOUND,
      // Keep both full-width river edges and the bridge/banks; distant staging
      // fields do not participate in this crossing/reconnection contract.
      minZ: -80,
      maxZ: 80,
      cellSize: 2,
    }, 4)
    world.rebuild(obstacles)
    world.beginFrame()

    const northPoint = new THREE.Vector3(-34, 0, -36)
    const southPoint = new THREE.Vector3(34, 0, 40)
    expect(world.areConnected(northPoint, southPoint)).toBe(true)

    // Direct off-bridge river crossings and map-edge river cells are blocked.
    for (const sampleX of [-PLAYABLE_WORLD_BOUND + 1, -140, -32, 32, 140, PLAYABLE_WORLD_BOUND - 1]) {
      const riverCell = world.grid.worldToCell({ x: sampleX, z: getRiverCenterZ(sampleX) })
      expect(riverCell).not.toBeNull()
      expect(world.grid.isBlocked(riverCell!)).toBe(true)
      expect(
        findBlockingObstacleAlongPath(
          new THREE.Vector3(sampleX, 0, -35),
          new THREE.Vector3(sampleX, 0, 35),
          0.5,
          2.3,
          0,
          obstacles,
        ),
      ).not.toBeNull()
    }

    // Both North -> South and South -> North paths pass through the bridge corridor.
    const northToSouth = world.queryPath(northPoint, southPoint)
    const southToNorth = world.queryPath(southPoint, northPoint)
    expect(northToSouth.status).toBe('path')
    expect(southToNorth.status).toBe('path')
    for (const result of [northToSouth, southToNorth]) {
      if (result.status !== 'path') continue
      const riverCrossingPoints = result.path
        .map(cell => world.grid.cellToWorld(cell))
        .filter(point => Math.abs(point.z) <= 16)
      expect(riverCrossingPoints.length).toBeGreaterThan(0)
      const maxAbsX = Math.max(...riverCrossingPoints.map(point => Math.abs(point.x)))
      expect(maxAbsX).toBeLessThan(RIVER_CROSSING_LAYOUT.bridge.halfClearWidth)
    }

    // Sealing the bridge corridor disconnects the banks completely (proving zero edge or river shortcuts).
    world.rebuild([
      ...obstacles,
      obstacle(-RIVER_CROSSING_LAYOUT.bridge.halfTotalWidth, -4, RIVER_CROSSING_LAYOUT.bridge.halfTotalWidth, 4),
    ])
    expect(world.areConnected(northPoint, southPoint)).toBe(false)
  })
})


it('updates one deferred owner to its latest destination and discards deferred work after topology changes', () => {
  const world = new NavigationWorld({ minX: 0, maxX: 100, minZ: 0, maxZ: 100, cellSize: 2 }, 2)
  world.rebuild([]); world.beginFrame()
  const find = vi.spyOn(world.grid, 'findPathCells'); onTestFinished(() => find.mockRestore())
  world.queryPath({ x: 5, z: 5 }, { x: 15, z: 5 })
  world.queryPath({ x: 5, z: 15 }, { x: 15, z: 15 })
  const owner = {}
  expect(world.queryPath({ x: 5, z: 25 }, { x: 15, z: 25 }, owner).status).toBe('pending')
  expect(world.queryPath({ x: 5, z: 25 }, { x: 35, z: 25 }, owner).status).toBe('pending')
  const before = find.mock.calls.length
  world.beginFrame()
  expect(find.mock.calls.length - before).toBe(1)
  const result = world.queryPath({ x: 5, z: 25 }, { x: 35, z: 25 }, owner)
  expect(result.status).toBe('path')
  if (result.status === 'path') expect(result.path.at(-1)).toEqual({ x: 17, z: 12 })
  world.queryPath({ x: 5, z: 45 }, { x: 35, z: 45 })
  expect(world.queryPath({ x: 5, z: 65 }, { x: 35, z: 65 }, owner).status).toBe('pending')
  world.rebuild([obstacle(48, 0, 52, 100)])
  const afterRebuild = find.mock.calls.length
  world.beginFrame()
  expect(find.mock.calls.length).toBe(afterRebuild)
})

const emptyTownLayout: TownRampartLayout = { decks: [], ramps: [], corners: [], lengths: [], perimeter: 1, wallSpans: [] }

it('releases a descended Town actor to ground travel instead of recapturing the ramp entrance', () => {
  const layout = getTownRampartLayout(), nav = new TownLayeredNavigation(layout)
  const ramp = layout.ramps.find(r => r.gateId === 'north')!, s = ramp.surface
  const goal = ramp.entrance.clone().add(new THREE.Vector3(0, 0, 12))
  goal.y = getTerrainHeight(goal.x, goal.z)
  const current = new THREE.Vector3(s.startX + s.dirX * 3,
    s.startY + (s.topY - s.startY) * 3 / s.length, s.startZ + s.dirZ * 3)
  const out = new THREE.Vector3()
  // The actual slope retains its dedicated descent, not a sideways ground exit.
  expect(nav.resolveMoveTarget(current, goal, out)).toEqual({ ground: false })
  expect(out).toEqual(ramp.entrance)
  current.copy(ramp.entrance)
  // Follow the real adapter's returned target in bounded mathematical steps.
  // Previously every few steps re-selected the entrance, keeping the actor
  // within 0.3m indefinitely even without a single dynamic blocker.
  for (let i = 0; i < 20; i++) {
    const step = nav.resolveMoveTarget(current, goal, out)
    if (!step) out.copy(goal)
    const direction = out.clone().sub(current).setY(0)
    const distance = direction.length()
    current.addScaledVector(direction.normalize(), Math.min(.2, distance))
    current.y = getTerrainHeight(current.x, current.z)
  }
  expect(current.z).toBeCloseTo(ramp.entrance.z + 4)
  expect(nav.resolveMoveTarget(current, goal, out)).toBeNull()
  // Re-entering the ramp still uses its existing aligned ground approach.
  expect(nav.resolveMoveTarget(current, ramp.landing, out)).toEqual({ ground: true })
  expect(out).toEqual(ramp.entrance)
})

function eastRamp(id: string, z: number): BreachEntrance {
  const surface = { startX: 182, startZ: z, startY: 0, topY: 10, dirX: -1, dirZ: 0, length: 24, landing: 6, halfWidth: 2.5 }
  return { id, gateId: 'east', type: 'siege-ramp', position: new THREE.Vector3(152, 10, z), approach: new THREE.Vector3(184.2, 0, z),
    exit: new THREE.Vector3(148, 10, z), surface, bridgeSurface: { ...surface, startX: 152, startY: 10, length: 4, landing: 0 },
    faction: null, walkable: true, mounted: true, connectionId: id }
}
describe('opt-in Town siege navigation', () => {
  it('walks a real X-directed slope/deck/bridge in order and waits after the selected entrance is removed', () => {
    const nav = new TownLayeredNavigation(emptyTownLayout), entry = eastRamp('town-siege-ramp:east:left', 62), out = new THREE.Vector3(), goal = new THREE.Vector3(140, 10, 62)
    nav.siegeActive = true; nav.siegeEntrances.set(entry)
    expect(nav.resolveMoveTarget(new THREE.Vector3(184.2, 0, 62), goal, out, entry.id)).toEqual({ ground: false })
    expect(out.x).toBe(181); expect(out.y).toBeCloseTo(10 / 24); expect(out.z).toBe(62)
    expect(nav.resolveMoveTarget(new THREE.Vector3(158, 10, 62), goal, out, entry.id)).toEqual({ ground: false })
    expect(out.x).toBeCloseTo(152.3); expect(out.z).toBe(62)
    nav.resolveMoveTarget(new THREE.Vector3(152.2, 10, 62), goal, out, entry.id)
    expect(out.toArray()).toEqual([148, 10, 62])
    nav.siegeEntrances.remove(entry.id)
    const outside = new THREE.Vector3(180, 0, 62)
    expect(nav.resolveMoveTarget(outside, goal, out, entry.id)).toEqual({ ground: true, blocked: true })
    expect(out).toEqual(outside)
  })
  it('revokes one destroyed vehicle while retaining a reachable same-gate alternative and rejecting unreachable reroutes', () => {
    const entries = new AvailableBreachEntrances(), left = eastRamp('town-siege-ramp:east:left', 62), right = eastRamp('town-siege-ramp:east:right', 25)
    entries.set(left); entries.set(right)
    const start = new THREE.Vector3(190, 0, 62)
    expect(entries.select(start, false, 'roman', () => true, left.id)?.id).toBe(left.id)
    entries.remove(left.id)
    expect(entries.select(start, false, 'roman', () => true, left.id)?.id).toBe(right.id)
    expect(entries.select(start, false, 'roman', () => false, left.id)).toBeNull()
    expect(entries.entries.has(right.id)).toBe(true)
  })
  it('fans mixed attackers through a wide destroyed gate after both ramps disappear without reversing at the approach', () => {
    const nav = new TownLayeredNavigation(emptyTownLayout, () => true)
    nav.siegeActive = true
    const left = eastRamp('town-siege-ramp:east:left', 62), right = eastRamp('town-siege-ramp:east:right', 25)
    nav.siegeEntrances.set(left); nav.siegeEntrances.set(right)
    // Destruction removes both walk surfaces. The destroyed gate is the sole route.
    nav.siegeEntrances.remove(left.id); nav.siegeEntrances.remove(right.id)
    const gate: BreachEntrance = { id: 'town-siege-gate:east', gateId: 'east', type: 'gate',
      position: new THREE.Vector3(150, 0, 45), approach: new THREE.Vector3(155, 0, 45), exit: new THREE.Vector3(145, 0, 45),
      portal: { halfWidth: 7, halfDepth: 1.2 }, walkable: true, mounted: true, faction: null, connectionId: 'east' }
    nav.siegeEntrances.set(gate)
    const goal = new THREE.Vector3(130, 0, 90), lanes = [new Set<number>(), new Set<number>()]
    for (let i = 0; i < 16; i++) {
      const mounted = i >= 8, radius = mounted ? 1.25 : .6, id = `battle:east:${mounted ? 'lancer' : 'crew'}:${i}`
      const out = new THREE.Vector3(), start = new THREE.Vector3(164, 0, 45)
      const entry = nav.siegeEntrances.select(start, mounted, 'viking', () => true, left.id, e => e.gateId === 'east')!
      expect(entry.id).toBe(gate.id)
      nav.resolveMoveTarget(start, goal, out, entry.id, mounted, 'east', id)
      expect(out.x).toBe(155)
      expect(Math.abs(out.z - 45) + radius).toBeLessThanOrEqual(6.65 + 1e-9)
      lanes[Number(mounted)].add(out.z)
      const lane = out.z
      // ID-based routing remains identical after reload, independent of roster order.
      nav.resolveMoveTarget(start, goal, out, entry.id, mounted, 'east', id)
      expect(out.z).toBe(lane)
      for (const x of [155, 153.5, 151, 150, 149, ...(mounted ? [148] : [])]) {
        const current = new THREE.Vector3(x, 0, lane)
        expect(nav.resolveMoveTarget(current, goal, out, entry.id, mounted, 'east', id)).toEqual({ ground: true })
        expect(out.x).toBe(145); expect(out.x).toBeLessThan(current.x); expect(out.z).toBe(lane)
        expect(nav.hasClearedSiegeGate(current, entry.id, mounted)).toBe(false)
      }
      // Still straddling the 2.4m physical jamb at the old wall-slab threshold.
      expect(nav.hasClearedSiegeGate(new THREE.Vector3(mounted ? 147.7 : 148.4, 0, lane), entry.id, mounted)).toBe(false)
      const inside = new THREE.Vector3(147, 0, lane)
      expect(nav.hasClearedSiegeGate(inside, entry.id, mounted)).toBe(true)
      expect(nav.resolveMoveTarget(inside, goal, out, null, mounted, 'east', id)).toBeNull()
    }
    // Once ownership is released, an unrelated interior pursuit must not select
    // the portal again merely because its lateral distance is outside the opening.
    expect(nav.resolveMoveTarget(new THREE.Vector3(130, 0, 90), new THREE.Vector3(120, 0, 80),
      new THREE.Vector3(), null, true, 'east', 'released-rider')).toBeNull()
    const legacyInside = new THREE.Vector3(130, 0, 90)
    expect(nav.hasClearedSiegeGate(legacyInside, gate.id, true)).toBe(true)
    expect(nav.resolveMoveTarget(legacyInside, goal, new THREE.Vector3(), gate.id, true, 'east', 'legacy-rider')).toBeNull()
    expect(lanes[0].size).toBeGreaterThanOrEqual(4)
    expect(lanes[1].size).toBeGreaterThanOrEqual(3)
  })

  it('admits an unassigned follower only through a proven reachable entrance in its allowed sector', () => {
    let reachable = false
    const nav = new TownLayeredNavigation(emptyTownLayout, () => reachable), entry = eastRamp('town-siege-ramp:east:left', 62)
    nav.siegeActive = true; nav.siegeEntrances.set(entry)
    const current = new THREE.Vector3(184.2, 0, 62), goal = new THREE.Vector3(140, 10, 62), out = new THREE.Vector3()
    nav.resolveMoveTarget(current, goal, out, null, false, 'east'); expect(out).toEqual(current)
    reachable = true
    nav.resolveMoveTarget(current, goal, out, null, false, 'north'); expect(out).toEqual(current)
    nav.resolveMoveTarget(current, goal, out, null, false, 'east'); expect(out.x).toBe(181)
    expect(out.z).toBe(62)
  })

})

describe('Town watchtower layered travel', () => {
  it.each(['up', 'down'] as const)('routes a mounted body %s every connected flight without crossing rails', direction => {
    const layout = getTownCommandWatchtowerLayout()
    const nav = new TownLayeredNavigation(getTownRampartLayout())
    nav.setWatchtower(layout)
    const tower = nav.watchtower!
    const surfaces = [layout.entrance, ...layout.ramps, ...layout.landings, ...layout.platform]
    const obstacles: ObstacleData[] = [{ box: layout.core, isBarricade: false }, ...getTownCommandWatchtowerUnderfill(layout),
      ...surfaces.map(surface => ({ box: surfaceBox(surface), walkSurface: surface, isBarricade: false })),
      ...getTownCommandWatchtowerRails(layout).flatMap(rail => rail.obstacles)]
    const top = new THREE.Vector3(-29, layout.platformY, -41)
    const current = (direction === 'up' ? tower.approach : top).clone()
    const goal = direction === 'up' ? top : tower.approach
    const previous = new THREE.Vector3(), out = new THREE.Vector3()
    // Production steering and support only; no scene, model or actor constructor.
    for (let frame = 0; frame < 650 && current.distanceTo(goal) > .3; frame++) {
      if (!nav.resolveMoveTarget(current, goal, out, null, true)) out.copy(goal)
      previous.copy(current)
      const distance = Math.hypot(out.x - current.x, out.z - current.z)
      const fraction = Math.min(.4, distance) / (distance || 1)
      current.x += (out.x - current.x) * fraction
      current.z += (out.z - current.z) * fraction
      current.y = Math.max(getTerrainHeight(current.x, current.z), current.y - .02)
      resolveObstacleCollision(current, previous, -1, true, 1, 2.6, 0, obstacles, { mountedSurfaces: true })
    }
    expect(current.distanceTo(goal)).toBeLessThan(.3)
    const outside = tower.approach.clone().add(new THREE.Vector3(4, 0, 0))
    expect(nav.resolveMoveTarget(outside, top, out)).toEqual({ ground: true, tower: true })
    expect(out).toEqual(tower.approach)
    expect(nav.resolveMoveTarget(outside, outside.clone().add(new THREE.Vector3(3, 0, 0)), out)).toBeNull()
  })

  it('distinguishes stacked flights for pursuit, contact and follow arrival', () => {
    const layout = getTownCommandWatchtowerLayout(), tower = new TownWatchtowerNavigation(layout)
    const lower = layout.ramps[0], upper = layout.ramps[4]
    const a = new THREE.Vector3(lower.startX, lower.startY, lower.startZ).add(new THREE.Vector3(lower.dirX * 5, (lower.topY - lower.startY) * 5 / lower.length, lower.dirZ * 5))
    const b = new THREE.Vector3(a.x, a.y + upper.startY - lower.startY, a.z)
    expect(tower.surfaceAt(a)).not.toBe(tower.surfaceAt(b))
    expect(tower.sameLevel(a, b)).toBe(false)
    const out = new THREE.Vector3()
    expect(tower.resolve(a, b, out)).toEqual({ ground: false, tower: true })
    expect(out.z).toBeLessThan(a.z) // Continue north up the first flight, not directly up at identical X/Z.
    expect(out.y).toBeCloseTo(lower.topY)
    expect(tower.resolve(b, a, out)).toEqual({ ground: false, tower: true })
    expect(out.z).toBeGreaterThan(b.z)
    expect(out.y).toBeCloseTo(upper.startY)
  })
})


it('leaves the existing rampart by its stairs before approaching the watchtower', () => {
  const wall = getTownRampartLayout(), tower = getTownCommandWatchtowerLayout()
  const nav = new TownLayeredNavigation(wall), out = new THREE.Vector3()
  nav.setWatchtower(tower)
  const ramp = wall.ramps[0], current = ramp.landing.clone()
  expect(nav.resolveMoveTarget(current, new THREE.Vector3(-29, tower.platformY, -41), out)).toEqual({ ground: false })
  expect(out).toEqual(ramp.entrance)
  expect(nav.watchtower!.sameLevel(nav.watchtower!.approach, new THREE.Vector3(tower.entrance.startX, tower.entrance.startY, tower.entrance.startZ))).toBe(true)
})
