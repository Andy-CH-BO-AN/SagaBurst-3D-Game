import { raceReturnAction, raceReturnProfile } from '../../src/career/CareerRaceReturn'
import { CareerRaceController } from '../../src/career/CareerRaceController'
import { TownScene } from '../../src/town/TownScene'
import { NpcSpawnScheduler } from '../../src/world/NpcSpawnScheduler'
import { deferTownResult, TownEvent } from '../../src/town/TownRules'
import { describe, expect, it, vi } from 'vitest'
import { Box3, Vector3 } from 'three'
import { createCareerProfile, cloneCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { addCareerItem } from '../../src/career/CareerInventory'
import { CareerProfileStore, parseCareerProfile } from '../../src/career/CareerProfileStore'
import { createCareerDuelMission } from '../../src/career/CareerDuelState'
import { canEnterRace, finalizeRaceDeployment, MOUNTED_RACES, RACE_PLAYER_CAN_SPRINT, advanceRaceClock, advanceRaceRider, resolveRace, raceRecordProfile, raceIsRunning, selectRaceCommander, updateRaceGuidance,
  type CareerRaceSession, type RaceRider } from '../../src/career/CareerRaceState'
import { RACE_START_SLOTS, RACE_LINES, lineCrossing, raceWaypoints, raceMovementIsLegal, raceCheckpointTarget, illegalTownCrossing, type RacePosition } from '../../src/career/CareerRaceRoute'
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
    expect(MOUNTED_RACES.map(r => r.merit)).toEqual([100, 400, 900, 1600, 2500, 3600])
    const p = profile()
    expect(canEnterRace(p, mount)).toBe(true)
    p.rank = 'commander'; expect(canEnterRace(p, mount)).toBe(true)
    expect(p.duelHighestDefeatedTierByPreset).toBeUndefined()
  })
  it('selects the actual Commander and never substitutes another living resident', () => {
    const cavalry = { spec: { id: 'cavalry-1' }, npc: { dead: false, hostileToPlayer: false, isFalling: false } }
    const commander = { spec: { id: 'commander' }, npc: { dead: false, hostileToPlayer: false, isFalling: false } }
    expect(selectRaceCommander([cavalry, commander])).toBe(commander)
    commander.npc.dead = true
    expect(selectRaceCommander([cavalry, commander])).toBeUndefined()
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
  it('detects the West checkpoint in the legal wall-side lane, including arrival on its plane', () => {
    const r = rider('player'); r.checkpoint = 3
    cross(r, pos(-112, 3), pos(-112, 0))
    expect(r.checkpoint).toBe(4); expect(r.dnf).toBeUndefined()
    const target = raceCheckpointTarget(3)!
    expect(target.z).toBe(-3)
    expect(raceCheckpointTarget(3, pos(-112, -1))!.z).toBe(3)
    expect(lineCrossing(pos(target.x, 3), target, RACE_LINES[3])).not.toBeNull()
    expect(lineCrossing(pos(-108, 3), pos(-108, -3), RACE_LINES[3])).toBeNull()
    const departing = rider('player'); departing.checkpoint = 3
    cross(departing, pos(-112, 0), pos(-112, -1))
    expect(departing.checkpoint).toBe(4)
  })
  it('keeps an unsampled collision crossing through a snapshot and reload', () => {
    const s = session(); s.phase = 'racing'; s.player.checkpoint = 3
    cross(s.player, pos(-112, 3), pos(-112, 1))
    s.player.position = pos(-112, -1) // Collision/snapshot can move the runtime position after its own update.
    const p = profile(); p.activeRace = s
    const loaded = parseCareerProfile(p)!.activeRace!.player
    expect(loaded.routePosition).toEqual(pos(-112, 1))
    cross(loaded, pos(-112, -1), pos(-112, -2), 21)
    expect(loaded.checkpoint).toBe(4); expect(loaded.dnf).toBeUndefined()
  })
  it('accepts the legal edge of the North passage while retaining its finite boundary', () => {
    const r = rider('player'); r.checkpoint = 4
    cross(r, pos(5.95, -120), pos(5.95, -110))
    expect(r.checkpoint).toBe(5); expect(r.dnf).toBeUndefined()
    expect(lineCrossing(pos(7.5, -120), pos(7.5, -110), RACE_LINES[4])).toBeNull()
  })
  it('allows native wall clearance while sliding around an exterior corner', () => {
    const wall = { box: new Box3(new Vector3(149.1, -1, -115.9), new Vector3(150.9, 8, 100)), isBarricade: false }
    const r = rider('player'); r.checkpoint = 1
    const from = pos(151.9, -116.9), to = pos(151.9 - 1e-12, -116.2)
    r.position = to
    expect(raceMovementIsLegal(from, to, [wall])).toBe(true)
    advanceRaceRider(r, from, 10, .05, raceMovementIsLegal(from, to, [wall]), 80)
    expect(r.dnf).toBeUndefined(); expect(r.checkpoint).toBe(1)
  })
  it('still rejects a swept crossing through a solid wall between exterior endpoints', () => {
    const wall = { box: new Box3(new Vector3(149.1, -1, -115.9), new Vector3(150.9, 8, 100)), isBarricade: false }
    expect(raceMovementIsLegal(pos(152, 45), pos(148, 45), [wall])).toBe(false)
    const r = rider('player'); r.checkpoint = 1
    r.position = pos(148, 45)
    advanceRaceRider(r, pos(152, 45), 10, .1, raceMovementIsLegal(pos(152, 45), r.position, [wall]), 80)
    expect(r.dnf).toBeTruthy()
  })
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
  it('keeps the living opponent racing after the player finishes and reloads before recording both times', () => {
    const s = session(); s.phase = 'racing'; s.elapsedSeconds = 85.1
    s.player.checkpoint = 5; s.player.finishSeconds = 85.1; s.opponent.checkpoint = 4
    resolveRace(s)
    expect(s.result).toBe('win'); expect(s.phase).toBe('finishing'); expect(raceIsRunning(s)).toBe(true)
    const store = new CareerProfileStore(new MemoryStorage())
    expect(store.save(raceRecordProfile(profile(), s))).toBe(true)
    const loaded = store.load()!
    expect(loaded.raceRecords).toBeUndefined(); expect(loaded.completedRaceIds).toBeUndefined()
    const resumed = loaded.activeRace!
    expect(resumed.opponent.dnf).toBeUndefined(); expect(resumed.result).toBe('win')
    resumed.player.dead = true; resumed.player.hp = 0 // Winner can die while waiting without changing the result.
    advanceRaceClock(resumed, 15, true)
    expect(resumed.elapsedSeconds).toBe(100.1)
    cross(resumed.opponent, pos(0, -120), pos(0, -110), resumed.elapsedSeconds); resolveRace(resumed)
    expect(resumed.phase).toBe('result'); expect(resumed.result).toBe('win')
    expect(resumed.opponent.finishSeconds).toBeGreaterThan(99)
    const settled = raceRecordProfile(loaded, resumed)
    expect(settled.raceRecords).toEqual([expect.objectContaining({ result: 'win', playerSeconds: 85.1, opponentSeconds: resumed.opponent.finishSeconds })])
    expect(raceRecordProfile(settled, resumed).raceRecords).toHaveLength(1)
  })
  it('ends the wait when the trailing rider can no longer finish without changing the winner', () => {
    const s = session(); s.phase = 'racing'; s.opponent.checkpoint = 5; s.opponent.finishSeconds = 70
    resolveRace(s); expect(s.phase).toBe('finishing'); expect(s.result).toBe('loss')
    s.player.dead = true; s.player.hp = 0; resolveRace(s)
    expect(s.phase).toBe('result'); expect(s.result).toBe('loss')
    expect(raceRecordProfile(profile(), s).availableMerit).toBe(profile().availableMerit)
    expect(s.player.finishSeconds).toBeUndefined()
    expect(raceRecordProfile(profile(), s).raceRecords).toEqual([expect.objectContaining({ result: 'loss', opponentSeconds: 70 })])
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
    expect(parseCareerProfile(createCareerProfile('viking'))).not.toBeNull()
  })
  it('publishes a result only after successful storage and retries idempotently without clearing hostility', () => {
    const storage = new MemoryStorage(), store = new CareerProfileStore(storage), p = profile(), s = session()
    s.raceId = 'race-6'; s.opponent.mountId = 'black-cat'
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
    expect(store.load()!.raceRecords![0].merit).toBe(3600)
    expect(store.load()!.availableMerit).toBe(p.availableMerit + 3600)
    expect(retry.completedRaceIds).toEqual(['race-6']); expect(retry.raceBestSeconds).toEqual({ 'race-6': 77 })
    expect(retry.townEvent).toEqual(p.townEvent)
    expect(retry.duelHighestDefeatedTierByPreset).toBeUndefined(); expect(retry.totalMerit).toBe(p.totalMerit + 3600)
  })
})


describe('Race return and deferred native Town outcomes', () => {
  it('offers direct return in the pause menu for a living stuck Captain and retries storage before moving or clearing', () => {
    const storage = new MemoryStorage(), store = new CareerProfileStore(storage), s = session()
    s.phase = 'racing'; s.player.checkpoint = 5; s.player.finishSeconds = 80; s.opponent.dnf = 'mount lost'; resolveRace(s)
    const recorded = raceRecordProfile(profile(), s); recorded.activeRace!.phase = 'returning'
    recorded.townEvent = { id: 'still-hostile', state: 'hostile', deadActorIds: ['merchant'] }
    expect(store.save(recorded)).toBe(true)
    let current = store.load()!
    const outside = new Vector3(-200, 0, 50), position = outside.clone()
    const player = { dead: false, hp: 27, maxHp: 100, staminaValue: 70, facingYaw: 0, currentMount: null,
      combatPosition: position, setPosition: vi.fn((x: number, y: number, z: number) => position.set(x, y, z)), faceDirection: vi.fn() }
    const race = Object.create(CareerRaceController.prototype) as CareerRaceController
    Object.assign(race, { session: current.activeRace, mounts: {}, residents: [], obstacles: [], commanded: new Map(),
      captain: { npc: { dead: false, hostileToPlayer: false, combatPosition: outside.clone() }, spec: { x: 0, z: 0 } },
      player: () => player, read: () => current,
      commit: (next: CareerProfile) => { if (!store.save(next)) return false; current = store.load()!; return true } })
    expect(race.canWalkBack).toBe(true); expect(race.returnComplete).toBe(false)
    expect(raceReturnAction('returning', true, false)).toBeNull()
    const actions = new Map<string, () => void>()
    const event = new TownEvent([{ id: 'survivor' }]); event.register('survivor', { dead: false }); event.complete(); event.hostile = true
    // Only menu/return inputs; constructors and all 3D entities are excluded.
    const town = Object.create(TownScene.prototype) as { openPauseMenu(): void }
    Object.defineProperty(town, 'profile', { get: () => current })
    const closePanel = vi.fn()
    Object.assign(town, { race, player, event, equipment: { visible: false }, closePanel,
      openPanel: () => ({ querySelector: () => ({ textContent: '' }) }),
      button: (_panel: unknown, label: string, callback: () => void) => actions.set(label, callback) })
    town.openPauseMenu()
    const direct = actions.get('改為直接返回小鎮')!
    expect(direct).toBeTypeOf('function')
    storage.failWrites = true; direct()
    expect(race.session).toBeDefined(); expect(store.load()!.activeRace).toBeDefined()
    expect(position).toEqual(outside); expect(player.setPosition).not.toHaveBeenCalled(); expect(closePanel).not.toHaveBeenCalled()
    storage.failWrites = false; direct()
    expect(race.session).toBeUndefined(); expect(store.load()!.activeRace).toBeUndefined()
    expect(player.setPosition).toHaveBeenCalledOnce(); expect(position).not.toEqual(outside)
    expect(position.x).toBeGreaterThan(-100); expect(position.x).toBeLessThan(100)
    expect(store.load()!.racePlayerState!.hp).toBe(27); expect(player.hp).toBe(27)
    expect(store.load()!.raceRecords).toEqual(recorded.raceRecords); expect(store.load()!.townEvent).toEqual(recorded.townEvent)
    expect(closePanel).toHaveBeenCalledOnce()
  })
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
})
