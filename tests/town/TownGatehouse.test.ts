import { Box3, Vector3 } from 'three'
import { expect, it } from 'vitest'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { GATEHOUSE_SHELL, TOWN_GATEHOUSE, gatehousePoint, gatehouseTowerWalk, townGatehouseObstacle, townGatehouseParts } from '../../src/town/TownGatehouse'
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

it('兩陣營嵌入城牆的門樓實體不佔用地面門洞、合併步道、塔房與穿塔環牆步道的騎乘淨空', () => {
  const G = TOWN_GATEHOUSE, S = GATEHOUSE_SHELL, intrusions: string[] = []
  for (const house of getTownRampartLayout().gatehouses!) {
    const floor = house.floorY - house.groundY
    const lanes: Record<string, Box3> = {
      portal: new Box3(new Vector3(-6, .2, -8), new Vector3(6, 3.4, 8)),
      // Rampart walk, joining strip and gallery between the towers: one open level.
      span: new Box3(new Vector3(-S.inner + .01, floor + .05, -10.85), new Vector3(S.inner - .01, floor + G.headroom - .05, G.deckFront - .26)),
      rooms: new Box3(new Vector3(-(S.outer - S.skin) + .01, floor + .05, S.partition + .01), new Vector3(S.outer - S.skin - .01, floor + G.headroom - .05, G.deckFront - .26)),
    }
    // The rampart walk through each tower span over its real slope: a mount's
    // 1m footprint, and body-solid tops kept 0.3m under its lowest walk point
    // (a top just under the hooves on a slope stops the horse).
    for (const side of [-1, 1] as const) for (let c = S.inner + .25; c < S.outer; c += .5) {
      const walk = gatehouseTowerWalk(house, side, Math.max(S.inner, c - 1), Math.min(S.outer, c + 1)), [x0, x1] = side < 0 ? [-c - 1, -c + 1] : [c - 1, c + 1]
      lanes[`tower:${side}:${c}`] = new Box3(new Vector3(x0, walk - .3, -10.85), new Vector3(x1, floor + G.headroom - .05, S.wallBack - .3))
    }
    for (const style of ['roman', 'viking'] as const) {
      for (const { role, box: [x0, y0, z0, x1, y1, z1] } of townGatehouseParts(house, style)) {
        // Fill only stops shots; bodies keep the walk surface's own rules.
        if (role === 'fill') continue
        const solid = new Box3(new Vector3(x0, y0, z0), new Vector3(x1, y1, z1))
        for (const [lane, envelope] of Object.entries(lanes)) if (solid.intersectsBox(envelope)) intrusions.push(`${house.gate.id}:${style}:${role} in ${lane}`)
      }
    }
  }
  expect(intrusions).toEqual([])
})
