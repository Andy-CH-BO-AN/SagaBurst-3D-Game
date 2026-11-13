import { expect, it } from 'vitest'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { gatehousePoint, townGatehouseObstacle, townGatehouseParts } from '../../src/town/TownGatehouse'
import { getTownRampartLayout } from '../../src/town/TownRamparts'
import { findBlockingObstacleAlongPath, findBlockingProjectileObstacleAlongPath, getTerrainHeight } from '../../src/world/Terrain'

it('讓門洞下方的地面路徑穿過門樓，但保留關門與上層投射物碰撞', () => {
  const house = getTownRampartLayout().gatehouses!.find(entry => entry.gate.id === 'north')!
  const solids = townGatehouseParts(house).map(({ box, overhead }) => townGatehouseObstacle(house, box, overhead))
  const { gate, groundY, floorY } = house
  const across = (z: number, y: number) => gatehousePoint(gate, 0, z, y)
  const ground = (z: number) => {
    const p = across(z, 0)
    p.y = getTerrainHeight(p.x, p.z)
    return p
  }
  const outside = ground(6), inside = ground(-6)
  // A bounded real grid with only this gate: reaching the other side must use
  // the doorway, never silently substitute one of the other three gates.
  const nav = new NavigationWorld({ minX: gate.x - 12, maxX: gate.x + 12, minZ: gate.z - 9, maxZ: gate.z + 9, cellSize: 1 })
  const wallEdges = [
    townGatehouseObstacle(house, [-12, -2, -.9, -7, 8, .9], false),
    townGatehouseObstacle(house, [7, -2, -.9, 12, 8, .9], false),
  ]
  const leaf = townGatehouseObstacle(house, [-7, -1, -.5, 7, 7, .5], false)
  nav.sync([...solids, ...wallEdges])
  expect(nav.areConnected(outside, inside)).toBe(true)
  expect(findBlockingObstacleAlongPath(outside, inside, 1, 2.6, 0, solids)).toBeNull()
  nav.sync([...solids, ...wallEdges, leaf])
  expect(nav.areConnected(outside, inside)).toBe(false)
  expect(findBlockingObstacleAlongPath(outside, inside, 1, 2.6, 0, [leaf])).toBe(leaf)
  nav.sync([...solids, ...wallEdges])
  expect(nav.areConnected(inside, outside)).toBe(true)
  const roofHeight = floorY + 4
  expect(findBlockingProjectileObstacleAlongPath(across(6, roofHeight), across(-1, roofHeight), solids)).not.toBeNull()
  expect(findBlockingProjectileObstacleAlongPath(across(6, groundY + 1.7), across(-6, groundY + 1.7), solids)).toBeNull()
})
