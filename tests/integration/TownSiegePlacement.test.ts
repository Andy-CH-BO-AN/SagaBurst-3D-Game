import { Box3, Vector3 } from 'three'
import { describe, expect, it, onTestFinished, vi } from 'vitest'

import { isTownSiegeDockConnected } from '../../src/career/TownFourGateSiegePolicy'

import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { TownLayeredNavigation } from '../../src/navigation/TownLayeredNavigation'

import { getTownRampartLayout, type TownRampartLayout } from '../../src/town/TownRamparts'
import { preparedTownSiege } from '../helpers/townSiegeDoubles'



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
  const events: string[] = []
  world.townNav = new TownLayeredNavigation(getTownRampartLayout())
  // A real prepared siege; its first vehicle's move carries this hull out of the grid.
  const h = preparedTownSiege({ obstacles: [moving], navigation: world, sectors: [],
    onRampUpdate: ramp => { events.push('move'); if (ramp.assignment.id === 'town-siege-ramp:north:left') moving.box.translate(new Vector3(0, 0, 26)) } })
  onTestFinished(() => h.siege.dispose())
  const revision = world.revision
  expect(world.grid.isBlocked(world.grid.worldToCell({ x: -1, z: 0 })!)).toBe(true)
  const synchronize = world.sync.bind(world)
  const sync = vi.spyOn(world, 'sync').mockImplementation(source => {
    events.push('sync')
    return synchronize(source)
  })
  onTestFinished(() => sync.mockRestore())
  h.siege.update(.1)
  expect(events).toEqual([...Array.from({ length: 8 }, () => 'move'), 'sync'])
  expect(world.revision).toBe(revision + 1)
  expect(world.grid.isBlocked(world.grid.worldToCell({ x: -1, z: 0 })!)).toBe(false)
  expect(world.townNav.siegeEntrances.revision).toBe(0)
})
