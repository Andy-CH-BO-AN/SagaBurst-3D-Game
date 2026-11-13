import { describe, expect, it } from 'vitest'
import { Box3, Vector3 } from 'three'
import {
  CAREER_MISSION_RETURN_KEY,
  consumeCareerMissionReturnFlag,
  markCareerMissionReturnToSergeant,
  resolveSergeantReturnPoint,
  sergeantReturnFromResidents,
} from '../../src/town/SergeantReturn'
import { DUEL_ARENA_RETURN_KEY } from '../../src/arena/DuelArenaReturn'
import { townRoster, townSitePoint } from '../../src/town/TownRules'
import { getTerrainHeight } from '../../src/world/Terrain'

function memorySessionStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() { return data.size },
    clear() { data.clear() },
    getItem(key: string) { return data.get(key) ?? null },
    key(index: number) { return [...data.keys()][index] ?? null },
    removeItem(key: string) { data.delete(key) },
    setItem(key: string, value: string) { data.set(key, value) },
  }
}

describe('Sergeant return contract', () => {
  it('places the player 3–4m in front of the live Sergeant facing him with terrain height', () => {
    const base = townSitePoint('hall', 8, 20)
    const livePoint = resolveSergeantReturnPoint(
      { x: base.x + 12, z: base.z - 5, yaw: Math.PI / 3 },
      { terrainHeight: getTerrainHeight },
    )!
    expect(livePoint).not.toBeNull()
    const dist = Math.hypot(livePoint.x - (base.x + 12), livePoint.z - (base.z - 5))
    expect(dist).toBeGreaterThanOrEqual(3.0)
    expect(dist).toBeLessThanOrEqual(4.0)
    expect(livePoint.y).toBeCloseTo(getTerrainHeight(livePoint.x, livePoint.z), 4)
    const expectedYaw = Math.atan2((base.x + 12) - livePoint.x, (base.z - 5) - livePoint.z)
    expect(livePoint.yaw).toBeCloseTo(expectedYaw, 4)

    // Resolves the deployment role specifically (not captain) from the authored town roster.
    const roster = townRoster()
    const captain = roster.find(actor => actor.id === 'captain')!
    const sergeant = roster.find(actor => actor.id === 'deployment')!
    expect(sergeant.role).toBe('deployment')
    const resolved = sergeantReturnFromResidents(roster.map(spec => ({ spec })), { terrainHeight: getTerrainHeight })!
    expect(Math.hypot(resolved.x - sergeant.x, resolved.z - sergeant.z)).toBeGreaterThanOrEqual(3.0)
    expect(Math.hypot(resolved.x - sergeant.x, resolved.z - sergeant.z)).toBeLessThanOrEqual(4.0)
    expect(Math.hypot(resolved.x - captain.x, resolved.z - captain.z)).toBeGreaterThan(10)
  })

  it('avoids blocking walls, mounts, and nearby NPCs around the Sergeant', () => {
    const sergeant = { x: 60, z: -2, yaw: 0 }
    const wall = {
      box: new Box3(new Vector3(58.5, 0, 0.5), new Vector3(61.5, 4, 2.5)),
      isBarricade: false,
    }
    const horseBlocker = { x: 60.5, z: 1.5, radius: 1.5 }
    const clear = resolveSergeantReturnPoint(sergeant, {
      obstacles: [wall],
      blockers: [horseBlocker],
      terrainHeight: () => 2.5,
    })!
    expect(clear).not.toBeNull()
    expect(clear.y).toBe(2.5)
    expect(clear.x > wall.box.min.x - 0.75 && clear.x < wall.box.max.x + 0.75
      && clear.z > wall.box.min.z - 0.75 && clear.z < wall.box.max.z + 0.75).toBe(false)
    expect(Math.hypot(clear.x - horseBlocker.x, clear.z - horseBlocker.z)).toBeGreaterThanOrEqual(0.75 + 1.5)
    expect(Math.hypot(clear.x - sergeant.x, clear.z - sergeant.z)).toBeGreaterThanOrEqual(3.0)
    expect(Math.hypot(clear.x - sergeant.x, clear.z - sergeant.z)).toBeLessThanOrEqual(4.1)
  })

  it('returns null instead of an invalid fallback point when all candidates fail isValid or clearance', () => {
    const rejectedByValidator = resolveSergeantReturnPoint(
      { x: 60, z: -2, yaw: 0 },
      { isValid: () => false, terrainHeight: () => 0 },
    )
    expect(rejectedByValidator).toBeNull()

    const blockedByObstacle = resolveSergeantReturnPoint(
      { x: 0, z: 0, yaw: 0 },
      {
        obstacles: [{ box: new Box3(new Vector3(-10, -2, -10), new Vector3(10, 6, 10)), isBarricade: false }],
        terrainHeight: () => 0,
      },
    )
    expect(blockedByObstacle).toBeNull()
    expect(sergeantReturnFromResidents(
      [{ spec: { id: 'deployment', role: 'deployment', x: 0, z: 0, yaw: 0 } }],
      { isValid: () => false, terrainHeight: () => 0 },
    )).toBeNull()
  })

  it('shares one return flag with Arena Duel and consumes it at most once', () => {
    expect(DUEL_ARENA_RETURN_KEY).toBe(CAREER_MISSION_RETURN_KEY)
    const storage = memorySessionStorage()
    expect(consumeCareerMissionReturnFlag(storage)).toBe(false)
    markCareerMissionReturnToSergeant(storage)
    expect(consumeCareerMissionReturnFlag(storage)).toBe(true)
    expect(consumeCareerMissionReturnFlag(storage)).toBe(false)
  })
})
