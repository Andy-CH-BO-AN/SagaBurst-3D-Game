import { describe, expect, it, vi } from 'vitest'
import { TOWN_CITY, TOWN_GATES } from '../src/town/TownLayout'
import { advanceUntil } from './helpers/simulation'
import { installTownPatrolFixtureEnvironment } from './helpers/townPatrolFixture'

vi.mock('../src/world/CorgiVisual', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/world/CorgiVisual')>()),
  CorgiVisual: (await import('./helpers/gameplayQuadrupedVisual')).GameplayQuadrupedVisualDouble,
}))
vi.mock('../src/world/BlackCatVisual', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/world/BlackCatVisual')>()),
  BlackCatVisual: (await import('./helpers/gameplayQuadrupedVisual')).GameplayQuadrupedVisualDouble,
}))

const createTownPatrolFixture = installTownPatrolFixtureEnvironment()


describe('Town patrol movement simulation', () => {
  it.each(['roman', 'viking'] as const)('moves all %s riders through real gates and loops without combat search, teleportation or per-frame follower A*', faction => {
    const h = createTownPatrolFixture({ faction, withWorld: true })
    // No public counter exposes enemy-search cost; retain this narrow spy for that regression.
    const targets = h.residents.map(r => vi.spyOn(r.npc as unknown as { _getTarget: (...args: unknown[]) => unknown }, '_getTarget'))
    const loops = [0, 0], exited = new Set<string>(), visited = [new Set<number>(), new Set<number>()]
    const largestStep = new Map<string, number>(), gateCrossings = new Map<string, number>()
    let minSpacing = Infinity
    const path = vi.spyOn(h.navigation.grid, 'findPathCells')
    advanceUntil(
      () => exited.size === 40 && loops.every(n => n >= 1) && visited.every(points => points.size === h.controller.route.length),
      () => {
        const previous = h.residents.map(r => r.npc.combatPosition.clone())
        const waypoints = h.controller.squads.map(s => s.waypoint)
        h.stepFrame()
        h.controller.squads.forEach((s, i) => { if (s.state === 'PATROLLING') { visited[i].add(s.waypoint); if (s.waypoint < waypoints[i]) loops[i]++ } })
        h.residents.forEach((r, i) => {
          const p = r.npc.combatPosition
          // Keep every frame's worst displacement; assert it once after the complete loop.
          largestStep.set(r.spec.id, Math.max(largestStep.get(r.spec.id) ?? 0, p.distanceTo(previous[i])))
          for (const gate of TOWN_GATES) {
            const axis = gate.id === 'east' || gate.id === 'west' ? 'x' : 'z', other = axis === 'x' ? 'z' : 'x'
            if ((previous[i][axis] - gate[axis]) * (p[axis] - gate[axis]) >= 0) continue
            const along = previous[i][other] + (p[other] - previous[i][other]) * (gate[axis] - previous[i][axis]) / (p[axis] - previous[i][axis])
            const onWall = other === 'x' ? along >= TOWN_CITY.minX && along <= TOWN_CITY.maxX : along >= TOWN_CITY.minZ && along <= TOWN_CITY.maxZ
            if (onWall) {
              const crossing = `${r.spec.id} crossing ${gate.id}`
              gateCrossings.set(crossing, Math.max(gateCrossings.get(crossing) ?? 0, Math.abs(along - gate[other])))
            }
          }
          for (let j = i + 1; j < h.residents.length; j++) {
            const q = h.residents[j].npc.combatPosition
            minSpacing = Math.min(minSpacing, Math.hypot(p.x - q.x, p.z - q.z))
          }
          if (p.x > TOWN_CITY.maxX + 2 || p.x < TOWN_CITY.minX - 2 || p.z > TOWN_CITY.maxZ + 2 || p.z < TOWN_CITY.minZ - 2) exited.add(r.spec.id)
        })
      },
      { maxSimulationSeconds: 330, secondsPerStep: .1, failureMessage: 'all riders must exit and both squads must complete the exterior loop' },
    )
    for (const [actorId, distance] of largestStep) expect(distance, actorId).toBeLessThan(2)
    for (const [crossing, distance] of gateCrossings) expect(distance, crossing).toBeLessThan(TOWN_CITY.gateWidth / 2 - 1)
    expect(minSpacing).toBeGreaterThan(1.5)
    expect(exited.size).toBe(40); expect(loops.every(n => n >= 1)).toBe(true)
    expect(visited.map(points => points.size)).toEqual([h.controller.route.length, h.controller.route.length])
    for (const target of targets) expect(target).not.toHaveBeenCalled()
    expect(path.mock.calls.length).toBeLessThan(400)
    for (const squad of h.controller.squads) {
      const leader = h.residents.find(r => r.spec.id === squad.activeLeaderActorId)!.npc
      for (const r of squad.members) expect(r.npc.combatPosition.distanceTo(leader.combatPosition), r.spec.id).toBeLessThan(70)
    }
  })
})
