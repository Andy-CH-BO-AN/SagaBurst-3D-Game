import { TownDockPassages } from '../../src/town/TownDockPassages'
import { TownSiegeAirspace } from '../../src/town/TownSiegeAirspace'
import type { DamageableObstacle } from '../../src/world/DamageableObstacle'
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
function expectObstacles(actual: readonly ObstacleData[], expected: readonly ObstacleData[]): void {
  expect(actual).toHaveLength(expected.length)
  for (const obstacle of expected) expect(actual).toContain(obstacle)
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

describe('Town dock passage collision ownership', () => {
  it('opens, restores and disposes matching ground/air rail slices while another dock remains open', () => {
    const a: ObstacleData = { box: new Box3(new Vector3(), new Vector3(1, 1, 1)), isBarricade: false }
    const b: ObstacleData = { box: a.box.clone(), isBarricade: false }, native: ObstacleData = { box: a.box.clone(), isBarricade: false }
    const roof = { box: a.box.clone(), isBarricade: false }
    const obstacles = [a, b, native], flight = [a, b, native, roof], airspace = new TownSiegeAirspace(flight)
    const visual = () => ({ visible: true, removeFromParent() {}, geometry: { dispose() {} } })
    const leftVisual = visual(), rightVisual = visual()
    // Plain visibility handles represent the external renderer boundary; no Mesh, Group or world builder.
    const owner = Object.assign(Object.create(TownDockPassages.prototype) as Pick<TownDockPassages, 'setOpen' | 'isOpen' | 'dispose'>, {
      configured: true, open: new Set(), obstacles, airspace, rails: [], railObstacles: new Set([a, b]), root: { removeFromParent() {} }, pieces: [
        { rampId: 'town-siege-ramp:east:left', mesh: leftVisual, obstacles: [a] },
        { rampId: 'town-siege-ramp:east:right', mesh: rightVisual, obstacles: [b] },
      ],
    })
    owner.setOpen('town-siege-ramp:east:left', true); owner.setOpen('town-siege-ramp:east:right', true)
    expect(obstacles).toEqual([native]); expect(leftVisual.visible).toBe(false); expect(rightVisual.visible).toBe(false)
    expectObstacles(flight, [native, roof])
    owner.setOpen('town-siege-ramp:east:left', false); owner.setOpen('town-siege-ramp:east:left', false)
    expect(obstacles).toEqual([native, a]); expect(leftVisual.visible).toBe(true)
    expectObstacles(flight, [native, roof, a])
    expect(rightVisual.visible).toBe(false); expect(owner.isOpen('town-siege-ramp:east:right')).toBe(true)
    owner.dispose()
    expectObstacles(obstacles, [native]); expectObstacles(flight, [native, roof])
  })

  it('replaces obsolete rails and restores only live physical siege structures in the captured flight array', () => {
    const record = (): ObstacleData => ({ box: new Box3(new Vector3(), new Vector3(1, 1, 1)), isBarricade: false })
    const wall = record(), crown = record(), oldRail = record(), left = record(), right = record(), vehicle = record()
    const passable = { ...record(), physicalPassable: true }
    const wreck = { ...record(), damageable: { destroyed: true } as DamageableObstacle }
    const flight = [wall, crown, oldRail], captured = flight, airspace = new TownSiegeAirspace(flight)
    // Configure removes the original rail, then admits only explicit replacement
    // slices and physical vehicle parts, rather than copying the ground world.
    airspace.remove([oldRail]); airspace.add([left, right, vehicle, passable, wreck]); airspace.add([vehicle])
    expectObstacles(captured, [wall, crown, left, right, vehicle])
    vehicle.box.translate(new Vector3(4, 0, 0))
    expect(captured[4].box.min.x).toBe(4) // Moving bounds stay shared, without a frame copy.
    airspace.remove([left]) // Dock opens only the left passage.
    expectObstacles(captured, [wall, crown, right, vehicle])
    // Fresh-scene reload replays configuration/physical state, not saved array references.
    const reloaded = [wall, crown, oldRail], restored = new TownSiegeAirspace(reloaded)
    restored.remove([oldRail]); restored.add([left, right, vehicle, wreck]); restored.remove([left])
    expectObstacles(reloaded, [wall, crown, right, vehicle])
    restored.remove([vehicle]); restored.add([left]) // Destroy closes its rail and removes the carrier.
    expectObstacles(reloaded, [wall, crown, right, left])
    restored.remove([left, right, vehicle]); restored.remove([vehicle])
    expectObstacles(reloaded, [wall, crown])
  })
})
