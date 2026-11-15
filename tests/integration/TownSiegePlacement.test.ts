import { Box3, Vector3 } from 'three'
import { describe, expect, it, onTestFinished, vi } from 'vitest'

import { TownFourGateSiege } from '../../src/career/TownFourGateSiege'
import { isTownSiegeDockConnected } from '../../src/career/TownFourGateSiegePolicy'

import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { TownLayeredNavigation } from '../../src/navigation/TownLayeredNavigation'

import type { TownRampartLayout } from '../../src/town/TownRamparts'



describe('Town Siege placement and readiness', () => {
  it('publishes a dock only when the full bridge width contacts the actual walk surface', () => {
    const crown = { startX: 145.6, startZ: 50, startY: 10, topY: 10, dirX: 0, dirZ: 1, length: 25, landing: 0, halfWidth: 3.2 }
    const layout: TownRampartLayout = { decks: [{ id: 'east:deck', gateId: 'east', surface: crown, box: new Box3() }],
      wallSpans: [], ramps: [], corners: [], lengths: [], perimeter: 1 }
    const bridge = { startX: 152, startZ: 62, startY: 10, topY: 10, dirX: -1, dirZ: 0, length: 4, landing: 0, halfWidth: 2.5 }
    expect(isTownSiegeDockConnected(layout, bridge, new Vector3(148, 10, 62))).toBe(true)
    expect(isTownSiegeDockConnected(layout, { ...bridge, startX: 155 }, new Vector3(151, 10, 62))).toBe(false)
    expect(isTownSiegeDockConnected(layout, { ...bridge, topY: 12 }, new Vector3(148, 12, 62))).toBe(false)
  })

})

it('synchronizes moving siege hulls before the next actor query without an entrance change', () => {
  const world = new NavigationWorld({ minX: -12, maxX: 12, minZ: -12, maxZ: 12 })
  const moving = { box: new Box3(new Vector3(-1.8, 0, -12), new Vector3(-.2, 3, 12)), isBarricade: true, dynamic: true }
  const obstacles = [moving], events: string[] = []
  world.sync(obstacles)
  world.townNav = new TownLayeredNavigation({ decks: [], ramps: [], corners: [], lengths: [], perimeter: 1, wallSpans: [] })
  const revision = world.revision
  const synchronize = world.sync.bind(world)
  const sync = vi.spyOn(world, 'sync').mockImplementation(source => {
    events.push('sync')
    return synchronize(source)
  })
  onTestFinished(() => sync.mockRestore())
  const siege = Object.assign(Object.create(TownFourGateSiege.prototype) as Pick<TownFourGateSiege, 'update'>, {
    prepared: true, disposed: false, pending: new Set(), neighbors: [], actorsById: new Map(),
    observedRevision: world.townNav.siegeEntrances.revision,
    options: { world: { obstacles }, navigation: world, grid: { getNearbyInto: () => [] }, actors: () => [] },
    ramps: new Map([['moving', { position: new Vector3(), surface: { length: 24, landing: 6 },
      update() { events.push('move'); moving.box.translate(new Vector3(0, 0, 26)) } }]]),
  })
  siege.update(.1)
  expect(events).toEqual(['move', 'sync'])
  expect(world.revision).toBe(revision + 1)
  expect(world.grid.isBlocked(world.grid.worldToCell({ x: -1, z: 0 })!)).toBe(false)
  expect(world.townNav.siegeEntrances.revision).toBe(0)
})
