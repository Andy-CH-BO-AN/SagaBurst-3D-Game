import { describe, expect, it } from 'vitest'
import { createCareerProfile, cloneCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { addCareerItem } from '../../src/career/CareerInventory'
import { CareerProfileStore, parseCareerProfile } from '../../src/career/CareerProfileStore'
import { createCareerDuelMission } from '../../src/career/CareerDuelState'
import { canEnterRace, MOUNTED_RACES, RACE_PLAYER_CAN_SPRINT, advanceRaceClock, advanceRaceRider, resolveRace, raceRecordProfile, updateRaceGuidance,
  type CareerRaceSession, type RaceRider } from '../../src/career/CareerRaceState'
import { RACE_START_SLOTS, RACE_LINES, lineCrossing, raceWaypoints, illegalTownCrossing, type RacePosition } from '../../src/career/CareerRaceRoute'
import { MemoryStorage } from '../helpers/memoryStorage'

const pos = (x: number, z: number): RacePosition => ({ x, z, y: 0, yaw: 0 })
function rider(actorId: string): RaceRider {
  const point = pos(-3, RACE_START_SLOTS[0].z)
  return { actorId, mountId: 'horse', position: point, mountPosition: { ...point }, hp: 100, mountHp: 100,
    stamina: 100, mounted: true, dead: false, checkpoint: 0 }
}
function session(): CareerRaceSession {
  return { version: 1, deployed: true, id: 'test-race', raceId: 'race-1', phase: 'countdown', countdownSeconds: 10,
    elapsedSeconds: 0, gameSeconds: 0, phaseSeconds: 0, waypoint: 0, player: rider('player'), opponent: rider('race:test-race') }
}
function profile(): CareerProfile { const p = createCareerProfile('roman'); addCareerItem(p, 'horse', 1); return p }
const mount = { id: 'horse' as const, ownedActive: true, mounted: true, dead: false, hp: 100, airborne: false, legal: true }
function cross(r: RaceRider, from: RacePosition, to: RacePosition, time = 20): void {
  r.position = to; advanceRaceRider(r, from, time, 1, true, 100)
}

describe('Mounted race policy and countdown', () => {
  it('exposes six independent opponents, NPC-only speed modes and rank-independent entry', () => {
    expect(MOUNTED_RACES.map(r => [r.id, r.mount, r.sprint])).toEqual([
      ['race-1', 'horse', false], ['race-2', 'corgi', false], ['race-3', 'black-cat', false],
      ['race-4', 'horse', true], ['race-5', 'corgi', true], ['race-6', 'black-cat', true],
    ])
    expect(RACE_PLAYER_CAN_SPRINT).toBe(true)
    const p = profile()
    expect(canEnterRace(p, mount)).toBe(true)
    p.rank = 'commander'; expect(canEnterRace(p, mount)).toBe(true)
    expect(p.duelHighestDefeatedTierByPreset).toBeUndefined()
  })
  it('rejects forged ownership, unavailable mounts, eagles and overlapping formal work', () => {
    const p = createCareerProfile('viking'); p.selectedMountId = 'horse'
    expect(canEnterRace(p, mount)).toBe(false)
    addCareerItem(p, 'horse', 1)
    expect(canEnterRace(p, { ...mount, ownedActive: false })).toBe(false)
    expect(canEnterRace(p, { ...mount, mounted: false })).toBe(false)
    expect(canEnterRace(p, { ...mount, hp: 0, dead: true })).toBe(false)
    expect(canEnterRace(p, { ...mount, id: 'xongkoro', airborne: true })).toBe(false)
    p.activeRace = session()
    expect(canEnterRace(p, mount)).toBe(false)
    expect(createCareerDuelMission(p, 'viking_archer', 1, 'opponent', 'captain')).toBeNull()
  })
  it('uses ten game seconds and permits an early exit followed by a legal return', () => {
    const s = session(); s.player.position = pos(0, -120)
    advanceRaceClock(s, 4.25, true)
    expect(s.result).toBeUndefined(); expect(s.countdownSeconds).toBe(5.75)
    s.player.position = pos(-3, -106)
    advanceRaceClock(s, 5.74, true); expect(s.phase).toBe('countdown')
    advanceRaceClock(s, .01, true); expect(s.phase).toBe('racing'); expect(s.elapsedSeconds).toBe(0)
  })
  it('disqualifies only when the countdown expires with the player still outside', () => {
    const s = session(); s.player.position = pos(0, -120)
    advanceRaceClock(s, 9.99, true); expect(s.result).toBeUndefined()
    advanceRaceClock(s, .02, true); expect(s.result).toBe('loss')
  })
})

describe('Mounted race route geometry', () => {
  it('requires North exit, East, South, West and North entry on the actual patrol ring', () => {
    const r = rider('player'), waypoints = raceWaypoints()
    let last = r.position, elapsed = 0
    for (const p of waypoints) {
      const next = pos(p.x, p.z), dt = Math.max(1, Math.hypot(next.x - last.x, next.z - last.z) / 20)
      elapsed += dt; r.position = next
      advanceRaceRider(r, last, elapsed, dt, true, 100)
      last = next
    }
    expect(r.dnf).toBeUndefined(); expect(r.checkpoint).toBe(5)
    expect(r.finishSeconds).toBeGreaterThan(0)
  })
  it('detects sprint sweeps with direction and a finite exterior corridor', () => {
    const r = rider('player'); r.checkpoint = 1
    cross(r, pos(162.5, 31), pos(162.5, 59))
    expect(r.checkpoint).toBe(2)
    expect(lineCrossing(pos(162.5, 59), pos(162.5, 31), RACE_LINES[1])).toBeNull()
    expect(lineCrossing(pos(200, 31), pos(200, 59), RACE_LINES[1])).toBeNull()
  })
  it('cannot finish by skipping checkpoints or triggering them in another order', () => {
    const r = rider('player'); r.checkpoint = 1
    cross(r, pos(10, 112.5), pos(-10, 112.5))
    expect(r.checkpoint).toBe(1); expect(r.finishSeconds).toBeUndefined()
    cross(r, pos(0, -120), pos(0, -110))
    expect(r.finishSeconds).toBeUndefined(); expect(r.dnf).toBeTruthy()
  })
  it('distinguishes passing an exterior gate from actually crossing another city boundary', () => {
    expect(illegalTownCrossing(pos(162.5, 35), pos(162.5, 55), 1)).toBe(false)
    expect(illegalTownCrossing(pos(160, 45), pos(145, 45), 1)).toBe(true)
    expect(illegalTownCrossing(pos(0, 105), pos(0, 95), 2)).toBe(true)
    expect(illegalTownCrossing(pos(-115, 0), pos(-105, 0), 3)).toBe(true)
    const r = rider('player')
    r.position = pos(160, -130); advanceRaceRider(r, pos(0, -120), 2, .05, true, 80)
    expect(r.dnf).toBeTruthy()
  })
})

describe('Mounted race outcome ownership', () => {
  it('requires a player finish after the opponent dies', () => {
    const s = session(); s.opponent.dead = true; s.opponent.hp = 0
    resolveRace(s); expect(s.result).toBeUndefined()
    s.player.checkpoint = 4; cross(s.player, pos(0, -120), pos(0, -110))
    resolveRace(s); expect(s.result).toBe('win')
  })
  it('waits for the NPC finish after player death', () => {
    const s = session(); s.player.dead = true; s.player.hp = 0
    resolveRace(s); expect(s.result).toBeUndefined()
    s.opponent.checkpoint = 4; cross(s.opponent, pos(0, -120), pos(0, -110))
    resolveRace(s); expect(s.result).toBe('loss')
  })
  it('draws when both riders die before either finishes', () => {
    const s = session(); s.player.dead = s.opponent.dead = true; s.player.hp = s.opponent.hp = 0
    resolveRace(s); expect(s.result).toBe('draw')
  })
  it('locks a legal finish against later deaths and chooses the earlier crossing time', () => {
    const s = session(); s.player.checkpoint = s.opponent.checkpoint = 5
    s.player.finishSeconds = 60.2; s.opponent.finishSeconds = 60.3
    resolveRace(s); expect(s.result).toBe('win')
    s.player.dead = true; s.opponent.dead = true; resolveRace(s)
    expect(s.result).toBe('win')
  })
  it('cannot win on foot and draws once neither mount can finish', () => {
    const s = session(); s.player.checkpoint = 4; s.player.mountHp = 0; s.player.mounted = false
    cross(s.player, pos(0, -120), pos(0, -110)); resolveRace(s)
    expect(s.player.finishSeconds).toBeUndefined(); expect(s.result).toBeUndefined()
    s.opponent.mounted = false; cross(s.opponent, pos(0, -110), pos(0, -120)); resolveRace(s)
    expect(s.result).toBe('draw')
  })
})

describe('Race persistence independent of hostility and Duel', () => {
  it('keeps a hostile countdown running when Captain becomes unavailable', () => {
    const s = session()
    advanceRaceClock(s, 4, true)
    updateRaceGuidance(s, false, true)
    expect(s.phase).toBe('countdown'); expect(s.countdownSeconds).toBe(6)
    expect(s.result).toBeUndefined(); expect(s.guideFallback).toBeTruthy()
    advanceRaceClock(s, 6, true)
    expect(s.phase).toBe('racing'); expect(s.result).toBeUndefined()
  })
  it('round-trips hostile countdown, route, deaths and mount resources without resetting progress', () => {
    const p = profile(), s = session(); s.phase = 'racing'; s.countdownSeconds = 0; s.elapsedSeconds = 83.5
    s.player.checkpoint = 3; s.player.mountHp = 17; s.opponent.hp = 0; s.opponent.dead = true; s.opponent.mounted = false
    p.activeRace = s; p.townEvent = { id: 'hostility', state: 'hostile', deadActorIds: ['merchant'] }
    const store = new CareerProfileStore(new MemoryStorage()); expect(store.save(p)).toBe(true)
    const loaded = store.load()!
    expect(loaded.activeRace).toEqual(s); expect(loaded.townEvent).toEqual(p.townEvent)
    const copy = cloneCareerProfile(loaded); copy.activeRace!.player.checkpoint = 0
    expect(loaded.activeRace!.player.checkpoint).toBe(3)
    expect(parseCareerProfile({ ...loaded, activeRace: { ...s, player: { ...s.player, checkpoint: 99 } } })).toBeNull()
    expect(parseCareerProfile(createCareerProfile('viking'))).not.toBeNull()
  })
  it('publishes a result only after successful storage and retries idempotently without clearing hostility', () => {
    const storage = new MemoryStorage(), store = new CareerProfileStore(storage), p = profile(), s = session()
    p.activeRace = s; p.townEvent = { id: 'town', state: 'hostile', deadActorIds: ['captain'] }
    expect(store.save(p)).toBe(true)
    s.player.checkpoint = 5; s.player.finishSeconds = 77; resolveRace(s)
    const result = raceRecordProfile(p, s)
    storage.failWrites = true; expect(store.save(result)).toBe(false)
    expect(store.load()!.raceRecords).toBeUndefined()
    storage.failWrites = false; expect(store.save(result)).toBe(true)
    const retry = raceRecordProfile(store.load()!, s); expect(store.save(retry)).toBe(true)
    expect(store.load()!.raceRecords).toHaveLength(1)
    expect(retry.completedRaceIds).toEqual(['race-1']); expect(retry.raceBestSeconds).toEqual({ 'race-1': 77 })
    expect(retry.townEvent).toEqual(p.townEvent)
    expect(retry.duelHighestDefeatedTierByPreset).toBeUndefined(); expect(retry.totalMerit).toBe(p.totalMerit)
  })
})
