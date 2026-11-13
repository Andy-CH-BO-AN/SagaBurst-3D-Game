import { describe, expect, it } from 'vitest'
import { Box3, Vector3 } from 'three'
import {
  CAREER_MISSION_RETURN_KEY,
  consumeCareerMissionReturnFlag,
  findMountParkingPoint,
  markCareerMissionReturnToSergeant,
  resolveNearestLegalPoint,
  planSergeantReturn,
  peekCareerMissionReturnFlag,
  resolveSergeantReturnPoint,
  resolveTownEntryFallbackPoint,
  SergeantReturnIntent,
  sergeantReturnFromResidents,
  settleCareerMissionReturn,
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

  it('validates Town entry fallback clearance by stance and returns null when completely blocked', () => {
    const home = { x: 10, z: 20, yaw: 0.5 }
    // Blocker at 1.1m away allows walking (0.75m clearance) at home, but blocks mounted (1.25m).
    const blockers = [{ x: 11.1, z: 20, radius: 0 }]
    const walkSafe = resolveTownEntryFallbackPoint(home, {
      clearanceRadius: 0.75,
      blockers,
      terrainHeight: () => 1.5,
    })
    expect(walkSafe).toMatchObject({ x: 10, y: 1.5, z: 20, yaw: 0.5 })

    const mountShifts = resolveTownEntryFallbackPoint(home, {
      clearanceRadius: 1.25,
      blockers,
      terrainHeight: () => 1.5,
    })
    expect(mountShifts).not.toBeNull()
    expect(mountShifts!.x !== 10 || mountShifts!.z !== 20).toBe(true)

    const allBlocked = resolveTownEntryFallbackPoint(home, {
      clearanceRadius: 1.25,
      isValid: () => false,
      terrainHeight: () => 1.5,
    })
    expect(allBlocked).toBeNull()
  })

  it('keeps the return flag and intent while every point is blocked, then places once a legal point opens', () => {
    const storage = memorySessionStorage()
    markCareerMissionReturnToSergeant(storage)
    let open = false
    const point = { x: 60, y: 0, z: 1.5, yaw: Math.PI }
    const plan = () => planSergeantReturn({
      resolve: () => (open ? point : null), restoreMounted: false, hasMount: false, findMountPark: () => null,
    })
    expect(settleCareerMissionReturn(storage, plan)).toEqual({ status: 'blocked' })
    expect(peekCareerMissionReturnFlag(storage)).toBe(true)

    const intent = new SergeantReturnIntent()
    intent.begin({ x: 60, z: 2 })
    let attempts = 0
    const attempt = () => { attempts++; return settleCareerMissionReturn(storage, plan)?.status === 'placed' }
    expect(intent.tick(0.2, { x: 60, z: 2 }, attempt)).toBe('waiting')
    expect(attempts).toBe(0)
    expect(intent.tick(0.4, { x: 60, z: 2 }, attempt)).toBe('waiting')
    open = true
    expect(intent.tick(0.5, { x: 60, z: 2 }, attempt)).toBe('placed')
    expect(peekCareerMissionReturnFlag(storage)).toBe(false)
    expect(intent.pending).toBe(false)
    expect(intent.tick(1, { x: 60, z: 2 }, attempt)).toBe('idle')
    expect(attempts).toBe(2)
  })

  it('treats a walkable point with no legal mount parking as blocked instead of dropping the mount at the player', () => {
    const walking = { x: 60, y: 0, z: 1.5, yaw: 0 }
    const base = { resolve: (mounted: boolean) => (mounted ? null : walking), restoreMounted: true, hasMount: true }
    expect(planSergeantReturn({ ...base, findMountPark: () => null })).toEqual({ status: 'blocked' })
    expect(planSergeantReturn({ ...base, findMountPark: () => ({ x: 63, z: 1 }) })).toEqual({
      status: 'placed', point: walking, dismount: true, mountPark: { x: 63, z: 1 } })
  })

  it('stops retrying and reports abandonment when the player walks away from the blocked spot', () => {
    const intent = new SergeantReturnIntent()
    intent.begin({ x: 0, z: 0 })
    expect(intent.tick(1, { x: 30, z: 0 }, () => true)).toBe('abandoned')
    expect(intent.pending).toBe(false)
  })

  it('finds a legal mount parking spot clear of occupants, and none when every ring is blocked', () => {
    const arrival = { x: 10, z: 10 }
    const spot = findMountParkingPoint(arrival, { terrainHeight: () => 0, occupied: [arrival, { x: 12.4, z: 10 }] })!
    expect(Math.hypot(spot.x - arrival.x, spot.z - arrival.z)).toBeGreaterThanOrEqual(2.4)
    expect(Math.hypot(spot.x - 12.4, spot.z - 10)).toBeGreaterThanOrEqual(2.1)
    expect(findMountParkingPoint(arrival, { terrainHeight: () => 0, isValid: () => false })).toBeNull()
    const wall = { box: new Box3(new Vector3(-30, -1, -30), new Vector3(50, 6, 50)), isBarricade: false }
    expect(findMountParkingPoint(arrival, { terrainHeight: () => 0, obstacles: [wall] })).toBeNull()
  })

  it('holds a blocked return at the nearest verified point instead of the blocked ordinary entry', () => {
    const home = { x: 60, z: 2, yaw: 0 }
    const blockers = [{ x: 60, z: 2, radius: 6 }]
    const held = resolveNearestLegalPoint(home, { blockers, terrainHeight: () => 0 })!
    expect(held).not.toBeNull()
    expect(Math.hypot(held.x - home.x, held.z - home.z)).toBeGreaterThanOrEqual(6 + 0.75)
    expect(resolveNearestLegalPoint(home, { isValid: () => false, terrainHeight: () => 0 })).toBeNull()
  })
})
