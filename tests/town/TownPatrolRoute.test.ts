import { describe, expect, it, vi } from 'vitest'
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
    const h = createTownPatrolFixture({ faction: 'roman', withWorld: true }), route = townPatrolRoute()
    for (const r of h.residents) {
      const position = r.npc.combatPosition
      expect(isObstaclePathClear(position, position, 1.1, 2.6, 0, h.obstacles), r.spec.id).toBe(true)
      expect(h.navigation.areConnected(position, { x: 0, z: 0 })).toBe(true)
    }
    for (let i = 0; i < h.residents.length; i++) for (let j = i + 1; j < h.residents.length; j++) expect(h.residents[i].npc.combatPosition.distanceTo(h.residents[j].npc.combatPosition)).toBeGreaterThan(4)
    for (let i = 0; i < route.length; i++) {
      const p = route[i], q = route[(i + 1) % route.length]
      const start = p.clone(); start.y = getTerrainHeight(p.x, p.z)
      const end = q.clone(); end.y = getTerrainHeight(q.x, q.z)
      expect(isObstaclePathClear(start, end, 1, 2.6, 0, h.obstacles), `segment ${i}`).toBe(true)
    }
    for (const squad of h.controller.squads) {
      const start = h.residents.find(r => r.spec.id === squad.canonicalLeaderActorId)!.npc.combatPosition
      expect(h.navigation.areConnected(start, route[squad.departure.phase])).toBe(true)
    }
    for (const gate of h.world!.gates.values()) gate.close()
    h.navigation.sync(h.obstacles)
    expect(h.navigation.areConnected(h.residents[0].npc.combatPosition, route[townPatrolDeparture('A').phase])).toBe(false)
  })
})
