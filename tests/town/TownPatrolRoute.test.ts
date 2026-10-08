import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { townRoster } from '../../src/town/TownRules'
import { townPatrolRoute, townPatrolDeparture } from '../../src/town/TownPatrolRoute'
import { TOWN_CITY } from '../../src/town/TownLayout'
import { PLAYABLE_WORLD_BOUND, getTerrainHeight, isObstaclePathClear } from '../../src/world/Terrain'
import { installTownPatrolFixtureEnvironment } from '../helpers/townPatrolFixture'

vi.mock('../../src/world/CorgiVisual', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/CorgiVisual')>()),
  CorgiVisual: (await import('../helpers/gameplayQuadrupedVisual')).GameplayQuadrupedVisualDouble,
}))
vi.mock('../../src/world/BlackCatVisual', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/BlackCatVisual')>()),
  BlackCatVisual: (await import('../helpers/gameplayQuadrupedVisual')).GameplayQuadrupedVisualDouble,
}))

const createTownPatrolFixture = installTownPatrolFixtureEnvironment()


describe('Town patrol route and navigation contracts', () => {
  it('closes an exterior loop inside playable bounds, ten to fifteen metres outside the city', () => {
    const route = townPatrolRoute()
    for (let i = 0; i < route.length; i++) {
      const p = route[i], q = route[(i + 1) % route.length]
      expect(Math.max(Math.abs(p.x), Math.abs(p.z))).toBeLessThan(PLAYABLE_WORLD_BOUND)
      for (let t = 0; t <= 1; t += .1) {
        const sample = p.clone().lerp(q, t)
        const distance = Math.hypot(Math.max(TOWN_CITY.minX - sample.x, 0, sample.x - TOWN_CITY.maxX), Math.max(TOWN_CITY.minZ - sample.z, 0, sample.z - TOWN_CITY.maxZ))
        expect(distance).toBeGreaterThan(10); expect(distance).toBeLessThan(15)
      }
    }
  })

  it('sends both patrols clockwise from different departure phases', () => {
    const a = townPatrolDeparture('A'), b = townPatrolDeparture('B')
    expect(a.direction).toBe('clockwise'); expect(b.direction).toBe('clockwise'); expect(a.phase).not.toBe(b.phase)
  })

  it('keeps Roman muster and exterior paths clear, and connects departure through open gates only', () => {
    const h = createTownPatrolFixture({ faction: 'roman', withWorld: true, patrolMembers: {} }), route = townPatrolRoute()
    // Geometry owns all 40 positions as production data; no NPC/Mount materialization.
    const residents = townRoster().filter(spec => spec.duty === 'patrol').map(spec => ({
      spec, position: new THREE.Vector3(spec.x, getTerrainHeight(spec.x, spec.z), spec.z),
    }))
    for (const r of residents) {
      const position = r.position
      expect(isObstaclePathClear(position, position, 1.1, 2.6, 0, h.obstacles), r.spec.id).toBe(true)
      expect(h.navigation.areConnected(position, { x: 0, z: 0 })).toBe(true)
    }
    for (let i = 0; i < residents.length; i++) for (let j = i + 1; j < residents.length; j++) expect(residents[i].position.distanceTo(residents[j].position)).toBeGreaterThan(4)
    for (let i = 0; i < route.length; i++) {
      const p = route[i], q = route[(i + 1) % route.length]
      const start = p.clone(); start.y = getTerrainHeight(p.x, p.z)
      const end = q.clone(); end.y = getTerrainHeight(q.x, q.z)
      expect(isObstaclePathClear(start, end, 1, 2.6, 0, h.obstacles), `segment ${i}`).toBe(true)
    }
    for (const patrolId of ['A', 'B'] as const) {
      const start = residents.find(r => r.spec.patrolId === patrolId && r.spec.patrolLeader)!.position
      expect(h.navigation.areConnected(start, route[townPatrolDeparture(patrolId).phase])).toBe(true)
    }
    for (const gate of h.world!.gates.values()) gate.close()
    h.navigation.sync(h.obstacles)
    expect(h.navigation.areConnected(residents[0].position, route[townPatrolDeparture('A').phase])).toBe(false)
  })
})
