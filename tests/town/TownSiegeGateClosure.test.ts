import { Box3, Vector3 } from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { CampaignGateController } from '../../src/campaign/CampaignGate'
import { closeSiegeGate, overlapsGateClosure } from '../../src/town/TownSiegeGateClosure'
import { getTerrainHeight, type ObstacleData } from '../../src/world/Terrain'
function gate(minX = -3, maxX = 3) {
  return { state: 'open', collisionBox: new Box3(new Vector3(minX, 0, -1), new Vector3(maxX, 4, 1)), close: vi.fn(() => true) }
}
function body(x: number) {
  const position = new Vector3(x, getTerrainHeight(x, 0), 0)
  return { position, radius: .6, moveTo: vi.fn((point: Vector3) => position.copy(point)) }
}
describe('Town gate closure displacement transaction', () => {
  it('plans separate legal outward destinations before closing around overlapping bodies', () => {
    const current = gate(), bodies = [body(0), body(.1)]
    expect(closeSiegeGate('north', current as unknown as CampaignGateController, bodies, [])).toBe(true)
    expect(current.close).toHaveBeenCalledExactlyOnceWith(false)
    for (const item of bodies) {
      expect(item.moveTo).toHaveBeenCalledOnce(); expect(item.position.z).toBeLessThan(-1.6)
      expect(overlapsGateClosure(current.collisionBox, item.position, item.radius)).toBe(false)
    }
    expect(bodies[0].position.distanceTo(bodies[1].position)).toBeGreaterThanOrEqual(1.4)
  })
  it('leaves every body and the gate unchanged when a later body has no legal destination', () => {
    const current = gate(-150, 150), bodies = [body(0), body(100)]
    const before = bodies.map(item => item.position.clone())
    const obstacles: ObstacleData[] = [{ box: new Box3(new Vector3(70, -10, -100), new Vector3(130, 100, 100)), isBarricade: false }]
    expect(closeSiegeGate('north', current as unknown as CampaignGateController, bodies, obstacles)).toBe(false)
    expect(current.close).not.toHaveBeenCalled()
    for (const item of bodies) expect(item.moveTo).not.toHaveBeenCalled()
    expect(bodies.map(item => item.position)).toEqual(before)
  })
})
