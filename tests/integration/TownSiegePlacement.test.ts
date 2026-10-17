import { isTownSiegeDockConnected } from '../../src/career/TownFourGateSiegePolicy'
import type { TownRampartLayout } from '../../src/town/TownRamparts'
import { Box3, Vector3 } from 'three'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { TownDefenseController } from '../../src/career/TownDefenseController'
import { NavigationGrid } from '../../src/navigation/NavigationGrid'
import type { TownGateId } from '../../src/town/TownLayout'
import { NpcSpawnScheduler, type NpcSpawnBatch } from '../../src/world/NpcSpawnScheduler'
import type { ObstacleData } from '../../src/world/Terrain'
interface PlacementEntry {
  walkable(point: Vector3, occupied: { point: Vector3; spacing: number }[], spacing: number, gate?: TownGateId): Vector3
  readonly ready: boolean
}
/** Calls the existing placement/readiness owner with data only; no scene-facing constructor. */
function entry(grid: NavigationGrid, obstacles: ObstacleData[] = [], batch?: NpcSpawnBatch, rosterCommitPending = false): PlacementEntry {
  return Object.assign(Object.create(TownDefenseController.prototype) as PlacementEntry, {
    navigation: { grid }, siegeContext: { obstacles }, spawnBatch: batch, rosterCommitPending,
  })
}
const smallGrid = () => new NavigationGrid({ minX: 0, maxX: 4, minZ: 0, maxZ: 4 })
describe('Town Siege placement and readiness', () => {
  it('avoids occupied slots and collision data while keeping a North deployment in its legal district', () => {
    const grid = new NavigationGrid({ minX: -40, maxX: 40, minZ: -110, maxZ: -50 })
    const box = new Box3(new Vector3(-1, -10, -99), new Vector3(3, 100, -94))
    grid.setBlockedBox(box, true)
    const occupied = [{ point: new Vector3(1, 0, -103), spacing: 2.5 }]
    const point = entry(grid, [{ box, isBarricade: false }]).walkable(new Vector3(0, 0, -100), occupied, 2.5, 'north')
    expect(point.z).toBeGreaterThan(-115); expect(point.z).toBeLessThan(-75)
    expect(Math.abs(point.x)).toBeLessThan(40); expect(grid.isBlocked(grid.worldToCell(point)!)).toBe(false)
    expect(point.x + .55 < box.min.x || point.x - .55 > box.max.x || point.z + .55 < box.min.z || point.z - .55 > box.max.z).toBe(true)
    expect(Math.hypot(point.x - 1, point.z + 103)).toBeGreaterThanOrEqual(2.5)
    expect(occupied).toHaveLength(2); expect(occupied[1]).toEqual({ point, spacing: 2.5 })
  })
  it('keeps readiness false until the real queued batch finishes its finalizer', () => {
    const scheduler = new NpcSpawnScheduler(), batch = scheduler.batch()
    onTestFinished(() => batch.cancel())
    batch.enqueue('attacker:data', () => {}); batch.seal()
    const owner = entry(smallGrid(), [], batch)
    expect(owner.ready).toBe(false); scheduler.tick(1); expect(owner.ready).toBe(true)
  })
  it('keeps failed finalization unready after the queue empties', () => {
    const scheduler = new NpcSpawnScheduler(), batch = scheduler.batch()
    onTestFinished(() => batch.cancel())
    batch.enqueue('attacker:data', () => {}); batch.seal(() => { throw new Error('roster commit failed') }); scheduler.tick(1)
    expect(batch.pending).toBe(0); expect(batch.status).toBe('failed')
    expect(entry(smallGrid(), [], batch).ready).toBe(false)
  })
  it('holds readiness while accepted roster persistence is still pending', () => {
    expect(entry(smallGrid(), [], undefined, true).ready).toBe(false)
  })

  it('cancels queued deployment and releases caller-owned resources and borrowed leases once on disposal', () => {
    const scheduler = new NpcSpawnScheduler(), batch = scheduler.batch(), create = vi.fn()
    onTestFinished(() => batch.cancel())
    batch.enqueue('queued:attacker', create); batch.seal()
    const attackerResource = { dispose: vi.fn() }, mountResource = { dispose: vi.fn() }
    const releaseLease = vi.fn(), removeGateListener = vi.fn()
    // Disposal reads resource handles and ownership records; no render or actor instances are constructed.
    const owner = Object.assign(Object.create(TownDefenseController.prototype) as { dispose(): void }, {
      spawnBatch: batch, playerIssuedCommands: new Set(), claimedEventSinks: new Map([['borrowed', releaseLease]]),
      claimedActors: new Set(), plannedArmyPositions: [new Vector3()], gateListeners: [removeGateListener],
      actorMounts: new Map(), tracker: null, enemies: [attackerResource], enemyMounts: [mountResource],
      attackGroups: [], checkpoint: { reset: vi.fn() }, guide: { dispose: vi.fn() },
    })
    onTestFinished(() => owner.dispose())
    owner.dispose(); owner.dispose(); scheduler.tick(1)
    expect(batch.status).toBe('cancelled')
    expect(scheduler.pending).toBe(0); expect(create).not.toHaveBeenCalled()
    expect(attackerResource.dispose).toHaveBeenCalledOnce(); expect(mountResource.dispose).toHaveBeenCalledOnce()
    expect(releaseLease).toHaveBeenCalledOnce(); expect(removeGateListener).toHaveBeenCalledOnce()
    expect(owner.enemies).toEqual([]); expect(owner.enemyMounts).toEqual([])
    expect(owner.claimedEventSinks.size).toBe(0); expect(owner.plannedArmyPositions).toEqual([])
  })
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
