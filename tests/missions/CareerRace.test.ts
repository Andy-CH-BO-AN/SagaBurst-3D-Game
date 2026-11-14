import { raceReturnAction, raceReturnProfile } from '../../src/career/CareerRaceReturn'
import { CareerRaceController } from '../../src/career/CareerRaceController'
import { NpcSpawnScheduler } from '../../src/world/NpcSpawnScheduler'
import { deferTownResult, TownEvent } from '../../src/town/TownRules'
import { describe, expect, it, vi } from 'vitest'
import { Box3, Vector3 } from 'three'
import { createCareerProfile, cloneCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { addCareerItem } from '../../src/career/CareerInventory'
import { CAREER_STORAGE_KEY, CareerProfileStore, parseCareerProfile } from '../../src/career/CareerProfileStore'
import { createCareerDuelMission } from '../../src/career/CareerDuelState'
import { canEnterRace, finalizeRaceDeployment, advanceRaceClock, advanceRaceRider, parseRaceSession, resolveRace, raceDefinitionForSchedule, raceRecordProfile, raceIsRunning, selectRaceCommander, updateRaceGuidance,
  type CareerRaceSession, type RaceRider } from '../../src/career/CareerRaceState'
import { RACE_START_SLOTS, RACE_LINES, raceWaypoints, raceMovementIsLegal, illegalTownCrossing, type RacePosition } from '../../src/career/CareerRaceRoute'
import { findSergeantResident } from '../../src/town/SergeantReturn'
import { townRoster } from '../../src/town/TownRules'
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
  it('selects the actual Commander and never substitutes another living resident', () => {
    const cavalry = { spec: { id: 'cavalry-1' }, npc: { dead: false, hostileToPlayer: false, isFalling: false } }
    const commander = { spec: { id: 'commander' }, npc: { dead: false, hostileToPlayer: false, isFalling: false } }
    expect(selectRaceCommander([cavalry, commander])).toBe(commander)
    commander.npc.dead = true
    expect(selectRaceCommander([cavalry, commander])).toBeUndefined()
  })
  it('rejects forged ownership, unavailable mounts, eagles and overlapping formal work while allowing valid mounts', () => {
    const p = createCareerProfile('viking'); p.selectedMountId = 'horse'
    expect(canEnterRace(p, mount)).toBe(false)
    addCareerItem(p, 'horse', 1)
    expect(canEnterRace(p, { ...mount, ownedActive: false })).toBe(false)
    expect(canEnterRace(p, { ...mount, mounted: false })).toBe(false)
    expect(canEnterRace(p, { ...mount, hp: 0, dead: true })).toBe(false)
    expect(canEnterRace(p, { ...mount, id: 'xongkoro', airborne: true })).toBe(false)
    expect(canEnterRace(p, mount)).toBe(true)
    for (const felineId of ['white-cat', 'orange-cat', 'serval', 'caracal'] as const) {
      const fp = createCareerProfile('viking'); addCareerItem(fp, felineId, 1)
      expect(canEnterRace(fp, { ...mount, id: felineId })).toBe(true)
    }
    p.rank = 'commander'; expect(canEnterRace(p, mount)).toBe(true)
    p.activeRace = session()
    expect(canEnterRace(p, mount)).toBe(false)
    expect(createCareerDuelMission(p, 'viking_archer', 1, 'opponent', 'captain')).toBeNull()
  })
  it('uses ten game seconds countdown and disqualifies only when expiring with player outside', () => {
    const s = session(); s.player.position = pos(0, -120)
    advanceRaceClock(s, 4.25, true)
    expect(s.result).toBeUndefined(); expect(s.countdownSeconds).toBe(5.75)
    s.player.position = pos(-3, -106)
    advanceRaceClock(s, 5.74, true); expect(s.phase).toBe('countdown')
    advanceRaceClock(s, .01, true); expect(s.phase).toBe('racing'); expect(s.elapsedSeconds).toBe(0)

    const s2 = session(); s2.player.position = pos(0, -120)
    advanceRaceClock(s2, 9.99, true); expect(s2.result).toBeUndefined()
    advanceRaceClock(s2, .02, true); expect(s2.result).toBe('loss')
  })
  it('continues after losing the owned mount and validates movement against the actual borrowed mount', () => {
    const s = session(); s.phase = 'guiding'; s.guideFallback = 'Captain unavailable'
    const point = new Vector3(-3, 0, -80)
    const ownedMount = { group: { position: new Vector3(-3, 0, -100), rotation: { y: 0 } },
      currentHp: 0, dead: true, isAirborne: false, baseSpeed: 1 }
    const borrowedMount = { group: { position: point, rotation: { y: 0 } },
      currentHp: 73, dead: false, isAirborne: false, baseSpeed: 8 }
    let activeMount: typeof borrowedMount | null = null
    const player = { get currentMount() { return activeMount }, combatPosition: point,
      hp: 81, dead: false, staminaValue: 67, facingYaw: 0 }
    const opponentPoint = new Vector3(3, 0, RACE_START_SLOTS[1].z)
    const opponentMount = { group: { position: opponentPoint, rotation: { y: 0 } },
      currentHp: 100, dead: false, isAirborne: false, baseSpeed: 10 }
    const racer = { mount: opponentMount, combatPosition: opponentPoint, group: { rotation: { y: 0 } },
      hp: 100, dead: false, staminaValue: 100 }
    let current = profile()
    const controller = Object.create(CareerRaceController.prototype) as CareerRaceController
    Object.assign(controller, { session: s, racer, mount: opponentMount, batch: { ready: true },
      mounts: { activeMount: ownedMount, activeMountId: 'horse' }, obstacles: [],
      player: () => player, read: () => current, commit: (next: CareerProfile) => { current = next; return true },
      saveElapsed: 0, stallSeconds: 0 })
    // Real frame/snapshot calls cover all pre-race phases without constructing actors or scenes.
    controller.beginFrame(.1, .1); controller.advance(.1)
    expect(s.phase).toBe('guiding'); expect(s.player.dnf).toBeUndefined()
    point.z = RACE_START_SLOTS[0].z
    controller.beginFrame(.1, .1); controller.advance(.1)
    expect(s.phase).toBe('countdown'); expect(s.player.dnf).toBeUndefined()
    controller.beginFrame(10, .05); controller.advance(10)
    expect(s.phase).toBe('racing'); expect(s.player.dnf).toBeUndefined()
    point.z = RACE_LINES[0].center.z + 1
    controller.beginFrame(.5, .5); controller.advance(.5)
    expect(s.player.checkpoint).toBe(0); expect(s.player.dnf).toBeUndefined()
    // Mounting within interaction distance can snap the rider farther than one walking frame.
    activeMount = borrowedMount; point.z -= 2.9
    controller.beginFrame(1 / 60, 1 / 60); controller.advance(1 / 60)
    expect(s.player.checkpoint).toBe(1); expect(s.player.dnf).toBeUndefined()
    expect(s.player.position.z).toBeCloseTo(RACE_LINES[0].center.z - 1.9)
    borrowedMount.baseSpeed = 40; point.z -= 10
    controller.beginFrame(.1, .1); controller.advance(.1)
    expect(s.player).toMatchObject({ checkpoint: 1, hp: 81, stamina: 67, mountId: 'horse',
      mounted: false, mountHp: 0, mountPosition: pos(-3, -100) })
    expect(s.player.position.z).toBeCloseTo(RACE_LINES[0].center.z - 11.9)
    expect(s.player.dnf).toBeUndefined(); expect(s.result).toBeUndefined()
    // Using the dead owned mount's speed would reject the preceding legal 10 m segment.
    borrowedMount.isAirborne = true; point.z -= 1
    controller.beginFrame(.1, .1); controller.advance(.1)
    expect(s.player.dnf).toBe('不合法路線或位移'); expect(s.result).toBe('loss')
    expect(ownedMount.currentHp).toBe(0); expect(borrowedMount.currentHp).toBe(73)
    expect(ownedMount.group.position).toEqual(new Vector3(-3, 0, -100))
  })
})

describe('Mounted race route geometry', () => {
  it('validates patrol ring checkpoint sequence and rejects illegal shortcuts and solid wall penetration', () => {
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

    const r2 = rider('player'); r2.checkpoint = 1
    cross(r2, pos(10, 112.5), pos(-10, 112.5))
    expect(r2.checkpoint).toBe(1); expect(r2.finishSeconds).toBeUndefined()
    cross(r2, pos(0, -120), pos(0, -110))
    expect(r2.finishSeconds).toBeUndefined(); expect(r2.dnf).toBeTruthy()

    const wall = { box: new Box3(new Vector3(149.1, -1, -115.9), new Vector3(150.9, 8, 100)), isBarricade: false }
    expect(raceMovementIsLegal(pos(152, 45), pos(148, 45), [wall])).toBe(false)
    expect(illegalTownCrossing(pos(160, 45), pos(145, 45), 1)).toBe(true)
  })
})

describe('Mounted race outcome ownership', () => {
  it('evaluates race outcome ownership, trailing timeouts and dismounted finishes', () => {
    const s = session(); s.phase = 'racing'; s.elapsedSeconds = 85.1
    s.player.checkpoint = 5; s.player.finishSeconds = 85.1; s.opponent.checkpoint = 4
    resolveRace(s)
    expect(s.result).toBe('win'); expect(s.phase).toBe('finishing'); expect(raceIsRunning(s)).toBe(true)

    // Trailing rider timeout
    const s2 = session(); s2.phase = 'racing'; s2.opponent.checkpoint = 5; s2.opponent.finishSeconds = 70
    resolveRace(s2); expect(s2.phase).toBe('finishing'); expect(s2.result).toBe('loss')
    s2.player.dead = true; s2.player.hp = 0; resolveRace(s2)
    expect(s2.phase).toBe('result'); expect(s2.result).toBe('loss')

    // Dismounted foot finish
    const s3 = session(); s3.phase = 'racing'
    for (const r of [s3.player, s3.opponent]) { r.checkpoint = 4; r.mountHp = 0; r.mounted = false }
    cross(s3.player, pos(0, -120), pos(0, -110), 80); resolveRace(s3)
    expect(s3.player.finishSeconds).toBe(79.5); expect(s3.result).toBe('win')
    cross(s3.opponent, pos(0, -120), pos(0, -110), 85); resolveRace(s3)
    expect(s3.opponent.finishSeconds).toBe(84.5); expect(s3.phase).toBe('result')
  })
})

describe('Race persistence independent of hostility and Duel', () => {
  it('fails deployment readiness on checkpoint save failure and reloads the same race for a successful retry', () => {
    const storage = new MemoryStorage(), store = new CareerProfileStore(storage), p = profile(), s = session()
    s.deployed = false; s.phase = 'guiding'; p.activeRace = s
    expect(store.save(p)).toBe(true)
    const scheduler = new NpcSpawnScheduler(), batch = scheduler.batch(), create = vi.fn()
    batch.enqueue(s.opponent.actorId, create)
    batch.seal(() => finalizeRaceDeployment(s, () => store.save(raceRecordProfile(p, s))))
    storage.failWrites = true; scheduler.tick(16)
    expect(batch.ready).toBe(false); expect(batch.status).toBe('failed'); expect(s.deployed).toBe(false)
    // Call the actual simulation entry with only its pre-readiness inputs; no models or scene.
    const controller = Object.create(CareerRaceController.prototype) as CareerRaceController
    Object.assign(controller, { session: s, batch, racer: {} })
    controller.beginFrame(10, .05); controller.advance(10)
    expect(controller.ready).toBe(false); expect(s.phase).toBe('guiding')
    expect(s.countdownSeconds).toBe(10); expect(s.gameSeconds).toBe(0)
    const loaded = store.load()!, resumed = loaded.activeRace!
    expect(resumed.deployed).toBe(false); expect(resumed.id).toBe(s.id)
    storage.failWrites = false
    const retry = scheduler.batch(); retry.enqueue(resumed.opponent.actorId, create)
    retry.seal(() => finalizeRaceDeployment(resumed, () => store.save(raceRecordProfile(loaded, resumed))))
    scheduler.tick(32); scheduler.tick(32)
    Object.assign(controller, { session: resumed, batch: retry })
    expect(controller.ready).toBe(true); expect(store.load()!.activeRace!.deployed).toBe(true)
    expect(create).toHaveBeenCalledTimes(2); expect(store.load()!.raceRecords).toBeUndefined()
    expect(store.load()!.availableMerit).toBe(p.availableMerit)
  })
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
    s.scheduleVersion = 2; s.raceId = 'race-7'; s.opponent.mountId = 'snow-leopard'
    s.player.checkpoint = 3; s.player.mountHp = 17; s.opponent.hp = 0; s.opponent.dead = true; s.opponent.mounted = false
    s.opponent.actorId = 'commander'; s.opponentHome = { position: pos(25, -20), hp: 100, mounted: true, mountHp: 15, mountPosition: pos(25, -20) }; s.opponentAmmo = 7
    p.activeRace = s; p.townEvent = { id: 'hostility', state: 'hostile', deadActorIds: ['merchant'] }
    const store = new CareerProfileStore(new MemoryStorage()); expect(store.save(p)).toBe(true)
    const loaded = store.load()!
    expect(loaded.activeRace).toEqual(s); expect(loaded.townEvent).toEqual(p.townEvent)
    const copy = cloneCareerProfile(loaded); copy.activeRace!.player.checkpoint = 0
    expect(loaded.activeRace!.player.checkpoint).toBe(3)
    expect(parseCareerProfile({ ...loaded, activeRace: { ...s, player: { ...s.player, checkpoint: 99 } } })).toBeNull()
    expect(parseCareerProfile({ ...loaded, activeRace: { ...s, opponentHome: undefined } })).toBeNull()
    expect(parseCareerProfile({ ...loaded, activeRace: { ...s, scheduleVersion: 3 } })).toBeNull()
    expect(parseCareerProfile({ ...loaded, activeRace: { ...s, scheduleVersion: undefined } })).toBeNull()
    expect(parseCareerProfile({ ...loaded, activeRace: { ...s, opponent: { ...s.opponent, mountId: 'black-cat' } } })).toBeNull()
    expect(parseCareerProfile(createCareerProfile('viking'))).not.toBeNull()
  })
  it('recovers only retired mount DNF reasons in unfinished saves without resetting progress or settled outcomes', () => {
    const s = session(); s.phase = 'racing'; s.countdownSeconds = 0; s.elapsedSeconds = 44.9; s.gameSeconds = 54.9
    s.player = { ...s.player, checkpoint: 1, position: pos(162.5, 44), routePosition: pos(-3, -106),
      hp: 81, stamina: 67, mountHp: 0, mounted: false, dnf: '坐騎已死亡' }
    s.opponent = { ...s.opponent, checkpoint: 1, position: pos(162.5, 42), routePosition: pos(-3, -106),
      mounted: false, dnf: '已離開參賽坐騎' }
    const recovered = parseRaceSession(s)!
    expect(recovered).toEqual({ ...s,
      player: { ...s.player, dnf: undefined, routePosition: s.player.position },
      opponent: { ...s.opponent, dnf: undefined, routePosition: s.opponent.position },
    })
    expect(s.player.dnf).toBe('坐騎已死亡'); expect(s.opponent.dnf).toBe('已離開參賽坐騎')
    s.player.dnf = '參賽坐騎已變更或不可用'; s.opponent.dnf = '不合法路線或位移'
    const p = profile(); p.activeRace = s
    const storage = new MemoryStorage({ initialValues: [[CAREER_STORAGE_KEY, JSON.stringify(p)]] })
    const store = new CareerProfileStore(storage), loaded = store.load()!, resumed = loaded.activeRace!
    expect(resumed.player).toEqual({ ...s.player, dnf: undefined, routePosition: s.player.position })
    expect(resumed.opponent).toEqual(s.opponent)
    expect(resumed.elapsedSeconds).toBe(44.9); expect(resumed.gameSeconds).toBe(54.9)
    expect(loaded.raceRecords).toBeUndefined(); expect(loaded.availableMerit).toBe(p.availableMerit)
    // The old DNF froze routePosition; resuming from that stale point would falsely detect a teleport.
    resumed.player.position = pos(162.5, 46)
    advanceRaceRider(resumed.player, pos(162.5, 44), 45, .1, true, 25)
    expect(resumed.player.checkpoint).toBe(2); expect(resumed.player.dnf).toBeUndefined()
    expect(store.save(loaded)).toBe(true); expect(store.load()!.activeRace).toEqual(resumed)
    const settled = { ...s, phase: 'result' as const, result: 'draw' as const, reason: '雙方皆無法合法完賽' }
    expect(parseRaceSession(settled)).toEqual(settled)
  })
  it('accepts the current sprint schedule with assigned opponent mounts and saves its reward once after reload', () => {
    const store = new CareerProfileStore(new MemoryStorage())
    let current = profile(); addCareerItem(current, 'serval', 1); current.selectedMountId = 'serval'
    const point = new Vector3(25, 0, -20)
    const groundMount = { group: { position: point, rotation: { y: 0 } }, currentHp: 100, dead: false, isAirborne: false }
    const player = { currentMount: groundMount, isMounted: true, dead: false, hp: 80, staminaValue: 70 }
    const residents = ['captain', 'commander'].map(id => ({ spec: { id }, npc: {
      combatPosition: point, group: { rotation: { y: 0 } }, hp: 100, staminaValue: 60, combatAmmo: 7,
      dead: false, hostileToPlayer: false, isFalling: false,
    } }))
    // Acceptance is real; only model deployment is replaced at the rendering boundary.
    const controller = Object.create(CareerRaceController.prototype) as CareerRaceController
    Object.assign(controller, { player: () => player, mounts: { activeMountId: 'serval', activeMount: groundMount },
      navigation: { sync: vi.fn(), areConnected: () => true }, obstacles: [], residents, waypoints: raceWaypoints(),
      commit: (next: CareerProfile) => { if (!store.save(next)) return false; current = store.load()!; return true }, deploy: vi.fn() })
    expect(controller.accept('race-6', current)).toBe(true)
    const resumed = store.load()!.activeRace!
    expect(['serval', 'caracal']).toContain(resumed.opponent.mountId)
    const assignedOpponentMount = resumed.opponent.mountId
    expect(resumed).toMatchObject({ scheduleVersion: 3, raceId: 'race-6',
      player: { mountId: 'serval', mountHp: 100 }, opponent: { actorId: 'commander', mountId: assignedOpponentMount } })
    expect(raceDefinitionForSchedule(resumed.raceId, resumed.scheduleVersion)).toMatchObject({ name: 'Race VI', merit: 3600, sprint: true })
    // Reloading/restoring must keep the exact assigned opponent mount without re-rolling.
    expect(store.load()!.activeRace!.opponent.mountId).toBe(assignedOpponentMount)
    resumed.phase = 'racing'; resumed.player.checkpoint = 5; resumed.player.finishSeconds = 80; resumed.opponent.dnf = 'mount lost'; resolveRace(resumed)
    expect(store.save(raceRecordProfile(current, resumed))).toBe(true)
    const settled = store.load()!
    expect(settled.raceRecords).toEqual([expect.objectContaining({ raceId: 'race-6', scheduleVersion: 3, merit: 3600 })])
    expect(settled.availableMerit).toBe(current.availableMerit + 3600)
    expect(settled.raceScheduleVersion).toBe(3)
    expect(settled.completedRaceIds).toEqual(['race-6'])
    expect(settled.raceBestSeconds).toEqual({ 'race-6': 80 })
    expect(raceRecordProfile(settled, resumed).availableMerit).toBe(settled.availableMerit)
    expect(parseCareerProfile({ ...settled, raceRecords: [{ ...settled.raceRecords![0], scheduleVersion: 4 as any }] })).toBeNull()
  })

  it('settles legacy v1 and v2 sessions at their accepted rewards without falsely marking v3 stages completed', () => {
    const store = new CareerProfileStore(new MemoryStorage()), p = profile(), old = session()
    old.raceId = 'race-6'; old.opponent.mountId = 'black-cat'; old.phase = 'racing'
    p.activeRace = old; p.completedRaceIds = ['race-1']
    expect(store.save(p)).toBe(true)
    // Legacy completedRaceIds without raceScheduleVersion=3 must not pollute the new v3 schedule.
    expect(store.load()!.completedRaceIds).toBeUndefined()
    const resumed = store.load()!.activeRace!
    expect(raceDefinitionForSchedule(resumed.raceId, resumed.scheduleVersion)).toMatchObject({ name: 'Race VI', merit: 3600, sprint: true })
    resumed.player.checkpoint = 5; resumed.player.finishSeconds = 77; resumed.opponent.dnf = 'mount lost'; resolveRace(resumed)
    const settled = raceRecordProfile(store.load()!, resumed)
    const returned = raceReturnProfile(settled, resumed.player, undefined, 100)!
    expect(store.save(returned)).toBe(true)
    const replayV2 = session(); replayV2.id = 'replay-v2'; replayV2.opponent.actorId = 'race:replay-v2'
    replayV2.scheduleVersion = 2; replayV2.raceId = 'race-6'; replayV2.opponent.mountId = 'black-cat'
    const loadedV2 = store.load()!; loadedV2.activeRace = replayV2
    expect(store.save(loadedV2)).toBe(true)
    const freshV2 = store.load()!.activeRace!
    expect(raceDefinitionForSchedule(freshV2.raceId, freshV2.scheduleVersion)).toMatchObject({ name: 'Race VIII', merit: 6400 })
    freshV2.phase = 'racing'; freshV2.player.checkpoint = 5; freshV2.player.finishSeconds = 80; freshV2.opponent.dnf = 'mount lost'; resolveRace(freshV2)
    expect(store.save(raceRecordProfile(store.load()!, freshV2))).toBe(true)
    expect(store.load()!.completedRaceIds).toBeUndefined()
    const replayV3 = session(); replayV3.id = 'replay-v3'; replayV3.opponent.actorId = 'race:replay-v3'
    replayV3.scheduleVersion = 3; replayV3.raceId = 'race-6'; replayV3.opponent.mountId = 'caracal'
    const loadedV3 = store.load()!; loadedV3.activeRace = replayV3
    expect(store.save(loadedV3)).toBe(true)
    const freshV3 = store.load()!.activeRace!
    expect(raceDefinitionForSchedule(freshV3.raceId, freshV3.scheduleVersion)).toMatchObject({ name: 'Race VI', merit: 3600 })
    freshV3.phase = 'racing'; freshV3.player.checkpoint = 5; freshV3.player.finishSeconds = 68; freshV3.opponent.dnf = 'mount lost'; resolveRace(freshV3)
    expect(store.save(raceRecordProfile(store.load()!, freshV3))).toBe(true)
    const final = store.load()!
    expect(final.raceRecords?.map(r => [r.raceId, r.scheduleVersion, r.merit])).toEqual([
      ['race-6', undefined, 3600],
      ['race-6', 2, 6400],
      ['race-6', 3, 3600],
    ])
    expect(final.availableMerit).toBe(p.availableMerit + 13600)
    expect(final.completedRaceIds).toEqual(['race-6']); expect(final.raceBestSeconds).toEqual({ 'race-6': 68 })
    expect(final.legacyRaceProgress).toEqual([
      expect.objectContaining({ scheduleVersion: 1, completedRaceIds: ['race-1', 'race-6'] }),
      expect.objectContaining({ scheduleVersion: 2, completedRaceIds: ['race-6'], raceBestSeconds: { 'race-6': 80 } }),
    ])
  })
  it('preserves legacy v2 and v1 racing progress into legacyRaceProgress across save and reload cycles without polluting v3 completions', () => {
    const storage = new MemoryStorage(), store = new CareerProfileStore(storage), base = profile()
    // Simulate a legacy profile from scheduleVersion 2 stored in localStorage
    const legacyRaw = {
      ...base,
      raceScheduleVersion: 2,
      completedRaceIds: ['race-1', 'race-2', 'race-3'],
      raceBestSeconds: { 'race-1': 75.2, 'race-2': 88.0 },
      availableMerit: 1400,
      totalMerit: 1400,
    }
    storage.setItem('sagaburst_career_v1', JSON.stringify(legacyRaw))

    // First load: migrates legacy progress into legacyRaceProgress, leaving v3 clean
    const loaded = store.load()!
    expect(loaded.raceScheduleVersion).toBeUndefined()
    expect(loaded.completedRaceIds).toBeUndefined()
    expect(loaded.raceBestSeconds).toBeUndefined()
    expect(loaded.legacyRaceProgress).toEqual([
      {
        scheduleVersion: 2,
        completedRaceIds: ['race-1', 'race-2', 'race-3'],
        raceBestSeconds: { 'race-1': 75.2, 'race-2': 88.0 },
      },
    ])

    // Save migrated profile without racing yet: legacy progress is persisted
    expect(store.save(loaded)).toBe(true)
    const reloaded = store.load()!
    expect(reloaded.legacyRaceProgress).toEqual([
      {
        scheduleVersion: 2,
        completedRaceIds: ['race-1', 'race-2', 'race-3'],
        raceBestSeconds: { 'race-1': 75.2, 'race-2': 88.0 },
      },
    ])
    expect(reloaded.completedRaceIds).toBeUndefined()

    // Complete a new v3 race (Race I, sprint, 100 merit)
    const v3Session = session()
    v3Session.scheduleVersion = 3
    v3Session.raceId = 'race-1'
    v3Session.phase = 'racing'
    v3Session.player.checkpoint = 5
    v3Session.player.finishSeconds = 62.5
    v3Session.opponent.dnf = 'mount lost'
    resolveRace(v3Session)

    const updated = raceRecordProfile(reloaded, v3Session)
    expect(store.save(updated)).toBe(true)

    // Verify v3 and legacy progress coexistence after reload
    const final = store.load()!
    expect(final.raceScheduleVersion).toBe(3)
    expect(final.completedRaceIds).toEqual(['race-1'])
    expect(final.raceBestSeconds).toEqual({ 'race-1': 62.5 })
    expect(final.availableMerit).toBe(1500)
    expect(final.legacyRaceProgress).toEqual([
      {
        scheduleVersion: 2,
        completedRaceIds: ['race-1', 'race-2', 'race-3'],
        raceBestSeconds: { 'race-1': 75.2, 'race-2': 88.0 },
      },
    ])
  })
  it('publishes a result only after successful storage and retries idempotently without clearing hostility', () => {
    const storage = new MemoryStorage(), store = new CareerProfileStore(storage), p = profile(), s = session()
    s.scheduleVersion = 3; s.raceId = 'race-5'; s.opponent.mountId = 'white-cat'
    p.activeRace = s; p.townEvent = { id: 'town', state: 'hostile', deadActorIds: ['captain'] }
    expect(store.save(p)).toBe(true)
    s.player.checkpoint = 5; s.player.finishSeconds = 77; s.opponent.dnf = '坐騎已死亡'; resolveRace(s)
    const result = raceRecordProfile(p, s)
    storage.failWrites = true; expect(store.save(result)).toBe(false)
    expect(store.load()!.raceRecords).toBeUndefined()
    expect(store.load()!.availableMerit).toBe(p.availableMerit)
    storage.failWrites = false; expect(store.save(result)).toBe(true)
    const retry = raceRecordProfile(store.load()!, s); expect(store.save(retry)).toBe(true)
    expect(store.load()!.raceRecords).toHaveLength(1)
    expect(store.load()!.raceRecords![0].merit).toBe(2500)
    expect(store.load()!.availableMerit).toBe(p.availableMerit + 2500)
    expect(retry.completedRaceIds).toEqual(['race-5']); expect(retry.raceBestSeconds).toEqual({ 'race-5': 77 })
    expect(retry.townEvent).toEqual(p.townEvent)
    expect(retry.duelHighestDefeatedTierByPreset).toBeUndefined(); expect(retry.totalMerit).toBe(p.totalMerit + 2500)
  })
})


describe('Commander invitation race', () => {
  const EVENT = 'commander-circuit-race' as const
  const pending = (p: CareerProfile): CareerProfile => { p.careerStory = { version: 1, events: { [EVENT]: { status: 'pending' } } }; return p }
  /** A settled Race I session, as the live controller would persist it. */
  function finished(result: 'win' | 'loss' | 'draw', story: boolean, sourceId = 'test-race'): { p: CareerProfile; s: CareerRaceSession } {
    const s = session(); s.scheduleVersion = 3; if (story) s.story = EVENT
    s.player.checkpoint = 5; s.opponent.checkpoint = 5
    s.player.finishSeconds = result === 'loss' ? 90 : result === 'draw' ? 70 : 70
    s.opponent.finishSeconds = result === 'win' ? 90 : 70
    resolveRace(s)
    const p = pending(profile())
    p.careerStory!.events[EVENT] = { status: 'active', sourceId }
    p.activeRace = s
    return { p, s }
  }

  it('saves the accepted invitation with its race session, and stays open after a failed save or a non-military mount', () => {
    const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
    let current = pending(profile()); addCareerItem(current, 'armored-horse', 1)
    expect(store.save(current)).toBe(true)
    const point = new Vector3(25, 0, -20)
    const groundMount = { group: { position: point, rotation: { y: 0 } }, currentHp: 100, dead: false, isAirborne: false }
    const player = { currentMount: groundMount, isMounted: true, dead: false, hp: 80, staminaValue: 70 }
    const residents = ['captain', 'commander'].map(id => ({ spec: { id }, npc: {
      combatPosition: point, group: { rotation: { y: 0 } }, hp: 100, staminaValue: 60, combatAmmo: 7,
      dead: false, hostileToPlayer: false, isFalling: false,
    } }))
    const enter = (mountId: string): CareerRaceController => {
      const controller = Object.create(CareerRaceController.prototype) as CareerRaceController
      Object.assign(controller, { player: () => player, mounts: { activeMountId: mountId, activeMount: groundMount },
        navigation: { sync: vi.fn(), areConnected: () => true }, obstacles: [], residents, waypoints: raceWaypoints(),
        commit: (next: CareerProfile) => { if (!store.save(next)) return false; current = store.load()!; return true }, deploy: vi.fn() })
      return controller
    }
    const stillOpen = () => { const saved = store.load()!; return !saved.activeRace && saved.careerStory!.events[EVENT]!.status === 'pending' }
    expect(enter('armored-horse').accept('race-1', current, { story: true })).toBe(false)
    expect(enter('horse').accept('race-2', current, { story: true })).toBe(false)
    expect(stillOpen()).toBe(true)
    storage.failWrites = true
    expect(enter('horse').accept('race-1', current, { story: true })).toBe(false)
    storage.failWrites = false
    expect(stillOpen()).toBe(true)
    // The ordinary entry never consumes it, and never carries the marker.
    expect(enter('horse').accept('race-1', current)).toBe(true)
    expect(store.load()!.activeRace!.story).toBeUndefined()
    expect(store.load()!.careerStory!.events[EVENT]).toEqual({ status: 'pending' })
    delete current.activeRace; store.save(current)
    expect(enter('horse').accept('race-1', current, { story: true })).toBe(true)
    const saved = store.load()!
    expect(saved.activeRace).toMatchObject({ raceId: 'race-1', story: EVENT })
    expect(saved.careerStory!.events[EVENT]).toEqual({ status: 'active', sourceId: saved.activeRace!.id })
  })

  it('lets the Commander sprint in the invitation race only after the start', () => {
    const s: CareerRaceSession = { ...session(), scheduleVersion: 3, story: EVENT,
      opponent: rider('commander') }
    const npc = { combatPosition: new Vector3(), missionMovement: false, assignFormationTarget: vi.fn() }
    const controller = Object.create(CareerRaceController.prototype) as CareerRaceController
    Object.assign(controller, { session: s, racer: npc, batch: { ready: true },
      commanded: new Map(), waypoints: [RACE_START_SLOTS[1]] })
    controller.prepare()
    expect(npc.missionMovement).toBe(false)
    s.phase = 'racing'
    controller.prepare()
    expect(npc.missionMovement).toBe(true)
  })

  it('pays 500 for a win and 29 for a defeat instead of the ordinary award, returns a draw unused, and leaves other entries alone', () => {
    const win = finished('win', true), loss = finished('loss', true), draw = finished('draw', true)
    const won = raceRecordProfile(win.p, win.s)
    expect(won.raceRecords).toEqual([expect.objectContaining({ raceId: 'race-1', result: 'win', merit: 500, story: EVENT, playerSeconds: 70 })])
    expect([won.totalMerit, won.availableMerit]).toEqual([win.p.totalMerit + 500, win.p.availableMerit + 500])
    expect(won.completedRaceIds).toEqual(['race-1']); expect(won.raceBestSeconds).toEqual({ 'race-1': 70 })
    expect(won.careerStory!.events[EVENT]).toEqual({ status: 'settled', sourceId: 'test-race', outcome: 'victory', merit: 500 })
    const lost = raceRecordProfile(loss.p, loss.s)
    expect([lost.totalMerit, lost.availableMerit]).toEqual([loss.p.totalMerit + 29, loss.p.availableMerit + 29])
    expect(lost.completedRaceIds).toBeUndefined()
    expect(lost.careerStory!.events[EVENT]).toMatchObject({ status: 'settled', outcome: 'defeat', merit: 29 })
    const drawn = raceRecordProfile(draw.p, draw.s)
    expect(drawn.totalMerit).toBe(draw.p.totalMerit)
    expect(drawn.careerStory!.events[EVENT]).toEqual({ status: 'pending' })
    // Ordinary Race I keeps its +100 and leaves an open invitation; a stale marker is not a receipt either.
    for (const { p, s } of [finished('win', false), finished('win', true, 'another-session')]) {
      const ordinary = raceRecordProfile(p, s)
      expect(ordinary.raceRecords![0]).toMatchObject({ merit: 100 }); expect(ordinary.raceRecords![0].story).toBeUndefined()
      expect(ordinary.totalMerit).toBe(p.totalMerit + 100)
      expect(ordinary.careerStory!.events[EVENT]).toEqual(p.careerStory!.events[EVENT])
    }
  })

  it('does not pay before the result is saved, and pays once after a retry and a reload', () => {
    const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
    const { p, s } = finished('win', true)
    expect(store.save(p)).toBe(true)
    const result = raceRecordProfile(p, s)
    storage.failWrites = true; expect(store.save(result)).toBe(false)
    const unsaved = store.load()!
    expect(unsaved.availableMerit).toBe(p.availableMerit); expect(unsaved.careerStory!.events[EVENT]!.status).toBe('active')
    storage.failWrites = false; expect(store.save(raceRecordProfile(store.load()!, s))).toBe(true)
    expect(store.save(raceRecordProfile(store.load()!, s))).toBe(true)
    const saved = store.load()!
    expect(saved.raceRecords).toHaveLength(1); expect(saved.availableMerit).toBe(p.availableMerit + 500)
    expect(saved.careerStory!.events[EVENT]).toMatchObject({ status: 'settled', outcome: 'victory', merit: 500 })
  })
})


describe('Race return and deferred native Town outcomes', () => {
  it('keeps hostile player defeat through spectating/reload and applies the penalty once on saved return', () => {
    const storage = new MemoryStorage(), store = new CareerProfileStore(storage), s = session(), p = profile()
    p.availableMerit = 180; p.townEvent = { id: 'hostile-death', state: 'hostile' }; p.activeRace = s
    s.phase = 'racing'; s.player.dead = true; s.player.hp = 0
    const event = new TownEvent([{ id: 'resident' }]); event.register('resident', { dead: false }); event.complete(); event.hostile = true
    const pending = deferTownResult(p, event.evaluate(true)!)
    expect(store.save(pending)).toBe(true)
    const resumed = store.load()!; resolveRace(resumed.activeRace!)
    expect(resumed.activeRace!.result).toBeUndefined(); expect(resumed.availableMerit).toBe(180)
    resumed.activeRace!.opponent.finishSeconds = 95; resumed.activeRace!.opponent.checkpoint = 5; resolveRace(resumed.activeRace!)
    const recorded = raceRecordProfile(resumed, resumed.activeRace!)
    expect(store.save(recorded)).toBe(true)
    const returned = raceReturnProfile(store.load()!, recorded.activeRace!.player, undefined, 100)!
    storage.failWrites = true; expect(store.save(returned)).toBe(false)
    expect(store.load()!.activeRace).toBeDefined(); expect(store.load()!.availableMerit).toBe(180)
    storage.failWrites = false; expect(store.save(returned)).toBe(true)
    const loaded = store.load()!
    expect(loaded.townEvent).toEqual({ id: 'hostile-death', state: 'settled', result: 'player_defeated', penalty: 100 })
    expect(loaded.availableMerit).toBe(80); expect(loaded.activeRace).toBeUndefined(); expect(loaded.racePlayerState).toBeUndefined()
    expect(loaded.raceRecords).toHaveLength(1); expect(loaded.raceRecords![0].opponentSeconds).toBe(95)
    expect(raceReturnProfile(loaded, s.player, undefined, 100)).toBeNull()
  })
  it('defers conquest until race return and preserves the first native outcome when the player later dies', () => {
    const p = profile(), s = session(); p.activeRace = s; p.totalMerit = 22000; p.rank = 'commander'
    p.townEvent = { id: 'conquest-race', state: 'hostile' }
    const event = new TownEvent([{ id: 'last-resident' }]); event.register('last-resident', { dead: true }); event.complete(); event.hostile = true
    const pending = deferTownResult(p, event.evaluate(false)!)
    expect(pending.faction).toBe('roman'); expect(pending.townEvent!.state).toBe('hostile')
    s.player.finishSeconds = 88; s.player.checkpoint = 5; s.opponent.dead = true; s.opponent.hp = 0; resolveRace(s)
    const recorded = raceRecordProfile(pending, s)
    const reloaded = parseCareerProfile(deferTownResult(recorded, 'player_defeated'))!
    const returned = raceReturnProfile(reloaded, s.player, undefined, 100)!
    expect(returned.townEvent).toEqual({ id: 'conquest-race', state: 'settled', result: 'town_defeated', penalty: 0 })
    expect(returned.faction).toBe('viking'); expect(returned.rank).toBe('recruit')
    expect(returned.enlistmentMeritBase).toBe(returned.totalMerit)
    expect(returned.raceRecords![0].result).toBe('win'); expect(returned.activeRace).toBeUndefined()
  })
  it('uses saved direct relocation when Captain fails outside, with no session removal on failed storage', () => {
    const storage = new MemoryStorage(), store = new CareerProfileStore(storage), s = session(), p = profile()
    s.phase = 'racing'; s.player.finishSeconds = 80; s.player.checkpoint = 5; s.opponent.dnf = 'mount lost'; resolveRace(s)
    const recorded = raceRecordProfile(p, s); recorded.activeRace!.phase = 'returning'
    recorded.activeRace!.player.position = pos(-200, 50); recorded.activeRace!.player.hp = 27; recorded.activeRace!.player.mountHp = 13
    recorded.townEvent = { id: 'town', state: 'hostile', deadActorIds: ['captain'] }
    expect(store.save(recorded)).toBe(true)
    expect(raceReturnAction('returning', true, false)).toBeNull()
    expect(raceReturnAction('returning', true, true)).toBe('walked')
    expect(raceReturnAction('returning', false, false)).toBe('direct')
    const destination = pos(8, -5), loaded = store.load()!
    const next = raceReturnProfile(loaded, loaded.activeRace!.player, destination, 100)!
    storage.failWrites = true; expect(store.save(next)).toBe(false)
    expect(store.load()!.activeRace!.player.position).toEqual(pos(-200, 50))
    storage.failWrites = false; expect(store.save(next)).toBe(true)
    const returned = store.load()!
    expect(returned.activeRace).toBeUndefined(); expect(returned.racePlayerState!.position).toEqual(destination)
    expect(returned.racePlayerState!.mountPosition).toEqual(destination)
    expect(returned.racePlayerState!.hp).toBe(27); expect(returned.racePlayerState!.mountHp).toBe(13)
    expect(returned.townEvent).toEqual(recorded.townEvent); expect(returned.raceRecords).toEqual(recorded.raceRecords)
  })

  it('saves a dismounted race return with the mount at its own parking spot, never under the player', () => {
    const s = session(), p = profile()
    s.phase = 'racing'; s.player.finishSeconds = 80; s.player.checkpoint = 5; s.opponent.dnf = 'mount lost'; resolveRace(s)
    const recorded = raceRecordProfile(p, s); recorded.activeRace!.phase = 'returning'
    recorded.activeRace!.player.mounted = true
    const arrival = pos(8, -5), parking = pos(11, -3)
    const returned = raceReturnProfile(recorded, recorded.activeRace!.player, arrival, 100, { dismount: true, mountDestination: parking })!
    expect(returned.racePlayerState).toMatchObject({ mounted: false, position: arrival, mountPosition: parking })
    const ridden = raceReturnProfile(recorded, recorded.activeRace!.player, arrival, 100)!
    expect(ridden.racePlayerState).toMatchObject({ mounted: true, mountPosition: arrival })
  })

  it('uses the Sergeant’s floor for formal return restore and walked race settlement', () => {
    const controller = Object.create(CareerRaceController.prototype) as CareerRaceController
    const p = profile()
    p.racePlayerState = {
      actorId: 'player', mountId: 'horse',
      position: { x: 18, z: -24, y: 1.5, yaw: 1.2 },
      mountPosition: { x: 18, z: -24, y: 1.5, yaw: 1.2 },
      hp: 84, mountHp: 65, stamina: 72, mounted: true, dead: false, checkpoint: 0,
    }
    const playerPos = new Vector3(60, 0.9, -5.5)
    const mountPos = new Vector3(0, 0, 0)
    const activeMount = { group: { position: mountPos, rotation: { y: 0 } }, dead: false }
    const faceDirection = vi.fn(), syncMountTransform = vi.fn(), mountVehicle = vi.fn(), dismountFromMount = vi.fn()
    const setStamina = vi.fn(), setHp = vi.fn()
    const playerDouble = {
      group: { position: playerPos, rotation: { y: Math.PI } },
      combatPosition: playerPos,
      facingYaw: Math.PI,
      faceDirection, syncMountTransform, mountVehicle, dismountFromMount, setStamina, setHp,
      currentMount: null, dead: false, hp: 100, maxHp: 100, staminaValue: 100,
    }
    Object.assign(controller, {
      session: undefined,
      obstacles: [],
      read: () => p,
      player: () => playerDouble,
      mounts: { restoreRaceMount: vi.fn(), activeMount },
      returnGroundHeight: () => 4,
    })

    controller.restorePlayer({ preservePlacement: true })
    expect(playerPos.x).toBe(60)
    expect(playerPos.z).toBe(-5.5)
    expect(mountPos.x).toBe(60)
    expect(mountPos.z).toBe(-5.5)
    expect(mountPos.y).toBe(4)
    expect(mountVehicle).toHaveBeenCalledWith(activeMount)
    expect(setHp).toHaveBeenCalledWith(84)
    expect(setStamina).toHaveBeenCalledWith(72)

    const roster = townRoster()
    const captainSpec = roster.find(r => r.id === 'captain')!
    const sergeantSpec = findSergeantResident(roster.map(spec => ({ spec })))!.spec
    const walkSession = session()
    walkSession.phase = 'returning'
    walkSession.result = 'win'
    const walkProfile = raceRecordProfile(profile(), walkSession)
    walkProfile.activeRace = walkSession
    let committedProfile = walkProfile
    const walkController = Object.create(CareerRaceController.prototype) as CareerRaceController
    Object.assign(walkController, {
      session: walkSession,
      captain: { spec: captainSpec, npc: { combatPosition: new Vector3(captainSpec.x, 0, captainSpec.z), dead: false, hostileToPlayer: false } },
      residents: [
        { spec: captainSpec, npc: { combatPosition: new Vector3(captainSpec.x, 0, captainSpec.z), dead: false } },
        { spec: sergeantSpec, npc: { combatPosition: new Vector3(sergeantSpec.x, 0, sergeantSpec.z), dead: false, group: { rotation: { y: sergeantSpec.yaw ?? 0 } } } },
      ],
      obstacles: [],
      legalSegment: () => true,
      player: () => ({ ...playerDouble, combatPosition: new Vector3(captainSpec.x + 2, 0, captainSpec.z), maxHp: 100 }),
      returnGroundHeight: () => 4,
      mounts: { activeMount: null, activeMountId: undefined },
      read: () => committedProfile,
      commit: (next: CareerProfile) => { committedProfile = next; return true },
      snapshot: vi.fn(),
      disposeRacer: vi.fn(),
    })
    expect(walkController.returnComplete).toBe(true)
    expect(walkController.clear(false)).toBe(true)
    const settledPos = committedProfile.racePlayerState!.position
    expect(settledPos.y).toBeCloseTo(4.9)
    expect(Math.hypot(settledPos.x - sergeantSpec.x, settledPos.z - sergeantSpec.z)).toBeGreaterThanOrEqual(3.0)
    expect(Math.hypot(settledPos.x - sergeantSpec.x, settledPos.z - sergeantSpec.z)).toBeLessThanOrEqual(4.1)
    expect(Math.hypot(settledPos.x - captainSpec.x, settledPos.z - captainSpec.z)).toBeGreaterThan(10)
  })

  it('dismounts cleanly at Sergeant when only walking Sergeant placement is safe', () => {
    const controller = Object.create(CareerRaceController.prototype) as CareerRaceController
    const p = profile()
    p.racePlayerState = {
      actorId: 'player', mountId: 'horse',
      position: { x: 18, z: -24, y: 1.5, yaw: 1.2 },
      mountPosition: { x: 18, z: -24, y: 1.5, yaw: 1.2 },
      hp: 84, mountHp: 65, stamina: 72, mounted: true, dead: false, checkpoint: 0,
    }
    const playerPos = new Vector3(60, 0.9, -5.5)
    const mountPos = new Vector3(0, 0, 0)
    const activeMount = { group: { position: mountPos, rotation: { y: 0 } }, dead: false }
    const mountVehicle = vi.fn()
    const dismountFromMount = vi.fn()
    const playerDouble = {
      group: { position: playerPos, rotation: { y: Math.PI } },
      combatPosition: playerPos,
      facingYaw: Math.PI,
      faceDirection: vi.fn(), syncMountTransform: vi.fn(), mountVehicle, dismountFromMount,
      setStamina: vi.fn(), setHp: vi.fn(),
      currentMount: null, dead: false, hp: 100, maxHp: 100, staminaValue: 100,
    }
    Object.assign(controller, {
      session: undefined,
      obstacles: [],
      read: () => p,
      player: () => playerDouble,
      mounts: { restoreRaceMount: vi.fn(), activeMount },
    })

    controller.restorePlayer({ preservePlacement: true, dismount: true })
    expect(mountVehicle).not.toHaveBeenCalled()
    expect(playerDouble.currentMount).toBeNull()
    expect(playerPos.x).toBe(60)
    expect(playerPos.z).toBe(-5.5)
    expect(Math.hypot(mountPos.x - playerPos.x, mountPos.z - playerPos.z)).toBeGreaterThan(1.5)
  })
})
