import { careerRankFixture } from '../helpers/careerRankFixture'
import { raceReturnAction, raceReturnProfile } from '../../src/career/CareerRaceReturn'
import { CareerRaceController } from '../../src/career/CareerRaceController'
import { TOWN_COMMANDER_ID } from '../../src/town/TownCommanderIdentity'
import { gameplayNpcSpawns, NpcSpawnScheduler } from '../../src/world/NpcSpawnScheduler'
import { deferTownResult, TownEvent } from '../../src/town/TownRules'
import { describe, expect, it, vi } from 'vitest'
import { Box3, Vector3 } from 'three'
import { createCareerProfile, cloneCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { addCareerItem } from '../../src/career/CareerInventory'
import { CareerProfileStore, parseCareerProfile } from '../../src/career/CareerProfileStore'
import { createCareerDuelMission } from '../../src/career/CareerDuelState'
import { canEnterRace, finalizeRaceDeployment, advanceRaceClock, advanceRaceRider, resolveRace, raceDefinitionForSchedule, raceRecordProfile, raceIsRunning, selectRaceCommander, updateRaceGuidance, type CareerRaceSession, type RaceRider } from '../../src/career/CareerRaceState'
import { RACE_START_SLOTS, RACE_LINES, raceWaypoints, raceMovementIsLegal, illegalTownCrossing, raceMountPoseLegal, resolveRaceMountSpawn, type RacePosition } from '../../src/career/CareerRaceRoute'
import { collideMountBody, settleMountOnTerrain } from '../../src/world/MountGroundBody'
import { architectureSpec, DEEP } from '../../src/town/architecture/ArchitectureSpecs'
import type { ObstacleData } from '../../src/world/Terrain'
import { findSergeantResident } from '../../src/town/SergeantReturn'
import { PLAYER_FOOT_OFFSET } from '../../src/player/PlayerFootBody'
import { townRoster } from '../../src/town/TownRules'
import { MemoryStorage } from '../helpers/memoryStorage'

const pos = (x: number, z: number): RacePosition => ({ x, z, y: 0, yaw: 0 })
function rider(actorId: string): RaceRider {
  const point = pos(-3, RACE_START_SLOTS[0].z)
  return { actorId, mountId: 'horse', position: point, mountPosition: { ...point }, hp: 100, mountHp: 100,
    stamina: 100, mounted: true, dead: false, checkpoint: 0 }
}
function session(): CareerRaceSession {
  return { version: 1, deployed: true, id: 'test-race', raceId: 'race-1', scheduleVersion: 3, phase: 'countdown', countdownSeconds: 10,
    elapsedSeconds: 0, gameSeconds: 0, phaseSeconds: 0, waypoint: 0, player: rider('player'), opponent: rider('commander'),
    opponentHome: { position: pos(25, -20), hp: 100, mounted: true, mountHp: 100, mountPosition: pos(25, -20) } }
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
    delete p.selectedMountId
    addCareerItem(p, 'horse', 1)
    p.selectedMountId = 'horse'
    expect(canEnterRace(p, { ...mount, ownedActive: false })).toBe(false)
    expect(canEnterRace(p, { ...mount, mounted: false })).toBe(false)
    expect(canEnterRace(p, { ...mount, hp: 0, dead: true })).toBe(false)
    expect(canEnterRace(p, { ...mount, id: 'xongkoro', airborne: true })).toBe(false)
    expect(canEnterRace(p, mount)).toBe(true)
    for (const felineId of ['white-cat', 'orange-cat', 'serval', 'caracal'] as const) {
      const fp = createCareerProfile('viking'); addCareerItem(fp, felineId, 1)
      expect(canEnterRace(fp, { ...mount, id: felineId })).toBe(true)
    }
    Object.assign(p, careerRankFixture(p.faction, 'commander')); expect(canEnterRace(p, mount)).toBe(true)
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
    s.raceId = 'race-4'; s.opponent.mountId = 'snow-leopard'
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
    expect(parseCareerProfile({ ...loaded, activeRace: { ...s, scheduleVersion: 2 } })).toBeNull()
    expect(parseCareerProfile({ ...loaded, activeRace: { ...s, scheduleVersion: undefined } })).toBeNull()
    expect(parseCareerProfile({ ...loaded, activeRace: { ...s, opponent: { ...s.opponent, mountId: 'black-cat' } } })).toBeNull()
    expect(parseCareerProfile(createCareerProfile('viking'))).not.toBeNull()
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


/** Town Center-like hall: a solid plinth whose floor stands 1.4m above the terrain, and a side wall at x 8.2–9. */
function raisedHallRace(phase: CareerRaceSession['phase'], saved: RacePosition) {
  const floor = 1.4
  const obstacles: ObstacleData[] = [
    { isBarricade: false, navigationPassable: true, solidBelow: -.2, box: new Box3(new Vector3(-9, -.2, -12), new Vector3(9, floor, 12)),
      walkSurface: { startX: 0, startZ: -12, startY: floor, topY: floor, dirX: 0, dirZ: 1, length: 24, landing: 0, halfWidth: 9, mounted: true } },
    { isBarricade: false, box: new Box3(new Vector3(8.2, -.2, -12), new Vector3(9, floor + 11, 12)) },
  ]
  // The Commander stood on his home mount at (5.4, 0); it stays there while he switches to the race horse.
  const homeMount = { dead: false, combatRadius: 2, group: { position: new Vector3(5.4, floor, 0) } }
  const rider = { dead: false, combatPosition: new Vector3(5.4, floor, 0), mount: homeMount }
  const controller = Object.assign(Object.create(CareerRaceController.prototype), {
    obstacles, residents: [{ npc: rider, homeMount, spec: { id: 'commander', x: 5.4, z: 0 } }], borrowedCommander: { npc: rider, homeMount },
    navigation: { areConnected: () => true }, returnGroundHeight: (x: number, z: number) => Math.abs(x) <= 9 && Math.abs(z) <= 12 ? floor : 0,
  }) as { raceMountSpawn(s: CareerRaceSession, rider: unknown, initial: boolean): RacePosition | null }
  const session = { phase, opponent: { mountId: 'horse', mounted: true, mountPosition: { ...saved }, position: { ...saved } } } as CareerRaceSession
  return { obstacles, controller, rider, session }
}
/** One real ground-mount frame: gravity and the terrain heightmap, then obstacle and walk-surface collision. */
function firstMountStep(spawn: RacePosition, obstacles: ObstacleData[]) {
  const position = new Vector3(spawn.x, spawn.y, spawn.z), previous = position.clone()
  const state = collideMountBody(position, previous, settleMountOnTerrain(position, 0, .2, () => 0), obstacles)
  return { position, state }
}

describe('Commander invitation race', () => {
  it('spawns the Commander race horse on the raised hall floor beside his home mount and keeps it there through the first collision step', () => {
    const h = raisedHallRace('guiding', { x: 5.4, y: 1.4, z: 0, yaw: .3 })
    const spawn = h.controller.raceMountSpawn(h.session, h.rider, true)!
    expect(spawn.y).toBe(1.4)
    expect(spawn.yaw).toBe(.3)
    expect(Math.hypot(spawn.x - 5.4, spawn.z)).toBeGreaterThanOrEqual(4)
    expect(spawn.x + 1.05).toBeLessThanOrEqual(8.2)
    expect(h.session.opponent.mountPosition).toEqual(spawn)
    expect(h.session.opponent.position).toEqual(spawn)
    const step = firstMountStep(spawn, h.obstacles)
    expect(step.state.onGround).toBe(true)
    expect(step.position.toArray().map(v => +v.toFixed(6))).toEqual([spawn.x, 1.4, spawn.z].map(v => +v.toFixed(6)))
    // The old spawn left Y undefined: the horse appeared at terrain height inside the plinth and was shoved sideways.
    const legacy = firstMountStep({ ...spawn, y: 0 }, h.obstacles)
    expect(Math.hypot(legacy.position.x - spawn.x, legacy.position.z - spawn.z) > .5 || legacy.position.y < 1.4 - .25).toBe(true)
  })
  it('keeps the race horse clear of the Viking longhouse posts that only navigation treats as passable', () => {
    // The real longhouse plan, flagged the way placement flags it: thin posts are navigation-passable yet still solid.
    const spec = architectureSpec('viking', 'town-center'), F = spec.floorY
    const obstacles: ObstacleData[] = [
      ...spec.colliders.map(c => ({ isBarricade: false, ...(c.role === 'post' || c.role === 'roof' || c.role === 'overhead' ? { navigationPassable: true } : {}),
        box: new Box3(new Vector3(c.box[0], c.box[1] <= DEEP ? DEEP : c.box[1], c.box[2]), new Vector3(c.box[3], c.box[4], c.box[5])) })),
      ...spec.floor.map(r => ({ isBarricade: false, navigationPassable: true, solidBelow: DEEP, box: new Box3(new Vector3(r.minX, DEEP, r.minZ), new Vector3(r.maxX, F, r.maxZ)),
        walkSurface: { startX: (r.minX + r.maxX) / 2, startZ: r.minZ, startY: F, topY: F, dirX: 0, dirZ: 1, length: r.maxZ - r.minZ, landing: 0, halfWidth: (r.maxX - r.minX) / 2, mounted: true } })),
    ]
    const posts = spec.colliders.filter(c => c.role === 'post')
    const options = { obstacles, radius: 2, terrainHeight: () => 0,
      groundAt: (x: number, z: number) => spec.floor.some(r => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) ? F : 0 }
    const besidePost: RacePosition = { x: 5.5, y: F, z: -4.4, yaw: 0 }
    expect(raceMountPoseLegal(besidePost, options)).toBe(false)
    const spawn = resolveRaceMountSpawn(besidePost, options)!
    expect(spawn.y).toBe(F)
    for (const post of posts) {
      const gap = Math.hypot(Math.max(post.box[0] - spawn.x, 0, spawn.x - post.box[3]), Math.max(post.box[2] - spawn.z, 0, spawn.z - post.box[5]))
      expect(gap, `post ${post.box[0]},${post.box[2]}`).toBeGreaterThanOrEqual(1.05)
    }
    const step = firstMountStep(spawn, obstacles)
    expect(step.state.onGround).toBe(true)
    expect(step.position.toArray().map(v => +v.toFixed(6))).toEqual([spawn.x, F, spawn.z].map(v => +v.toFixed(6)))
  })
  it('restores a saved pre-start race mount from under the hall floor to a legal floor spot, but keeps legal or running poses', () => {
    const legal = raisedHallRace('guiding', { x: 0, y: 1.4, z: 6, yaw: 0 })
    expect(legal.controller.raceMountSpawn(legal.session, legal.rider, false)).toBe(legal.session.opponent.mountPosition)
    const sunk = raisedHallRace('countdown', { x: 0, y: .06, z: 6, yaw: 0 })
    expect(sunk.controller.raceMountSpawn(sunk.session, sunk.rider, false)).toEqual({ x: 0, y: 1.4, z: 6, yaw: 0 })
    expect(sunk.session.opponent.mountPosition.y).toBe(1.4)
    // Once racing, the saved progress pose is restored exactly as played.
    const running = raisedHallRace('racing', { x: 0, y: .06, z: 6, yaw: 0 })
    expect(running.controller.raceMountSpawn(running.session, running.rider, false)).toEqual({ x: 0, y: .06, z: 6, yaw: 0 })
  })
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

  it('cancels a failed Commander deployment only after saving, leaving the invitation open without a result', () => {
    const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
    const s: CareerRaceSession = { ...session(), scheduleVersion: 3, story: EVENT, deployed: false, phase: 'guiding' }
    let current = pending(profile())
    current.activeRace = s
    current.careerStory!.events[EVENT] = { status: 'active', sourceId: s.id }
    current.totalMerit = 150; current.availableMerit = 75
    expect(store.save(current)).toBe(true)
    const batch = { status: 'pending', ready: false, cancel: vi.fn() }
    const controller = Object.create(CareerRaceController.prototype) as CareerRaceController
    Object.assign(controller, { session: s, batch, read: () => current,
      player: () => ({ currentMount: null, combatPosition: new Vector3(2, 1, -3), facingYaw: 0,
        hp: 73, maxHp: 100, dead: false, staminaValue: 60 }), mounts: { activeMount: null },
      commit: (next: CareerProfile) => { if (!store.save(next)) return false; current = next; return true } })
    expect(controller.cancelFailedStoryRace()).toBe(false)
    batch.status = 'failed'
    storage.failWrites = true
    expect(controller.canCancelFailedStoryRace).toBe(true)
    expect(controller.cancelFailedStoryRace()).toBe(false)
    expect(controller.session?.id).toBe(s.id)
    expect(store.load()!.careerStory!.events[EVENT]).toEqual({ status: 'active', sourceId: s.id })
    expect(batch.cancel).not.toHaveBeenCalled()
    storage.failWrites = false
    expect(controller.cancelFailedStoryRace()).toBe(true)
    const saved = store.load()!
    expect(saved.activeRace).toBeUndefined(); expect(controller.session).toBeUndefined()
    expect(saved.careerStory!.events[EVENT]).toEqual({ status: 'pending' })
    expect(saved.raceRecords).toBeUndefined(); expect([saved.availableMerit, saved.totalMerit]).toEqual([75, 150])
    expect(saved.racePlayerState).toMatchObject({ hp: 73, position: { x: 2, y: 1, z: -3 } })
    expect(batch.cancel).toHaveBeenCalledOnce()
  })

  it('reloads a saved unstarted story race whose racer has no legal spot, fails its deployment and still cancels without a result', async () => {
    const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
    // Saved before the start, with the race horse sunk under the hall floor; no legal spot is reachable around it.
    const sunk = pos(5.4, 0)
    const s: CareerRaceSession = { ...session(), scheduleVersion: 3, story: EVENT, deployed: true, phase: 'guiding', gameSeconds: 12,
      opponentHome: { position: { ...sunk, y: 1.4 }, hp: 100, mounted: false },
      opponent: { ...rider(TOWN_COMMANDER_ID), position: { ...sunk, y: .06 }, mountPosition: { ...sunk, y: .06 } } }
    let current = pending(profile())
    current.activeRace = s
    current.careerStory!.events[EVENT] = { status: 'active', sourceId: s.id }
    current.totalMerit = 150; current.availableMerit = 75
    expect(store.save(current)).toBe(true)
    const commander = { dead: false, hostileToPlayer: false, combatPosition: new Vector3(5.4, 1.4, 0), group: { position: new Vector3(), rotation: { y: 0 } },
      setTacticalOrder: vi.fn(), dismountFromMount: vi.fn(), mountVehicle: vi.fn() }
    const controller = Object.create(CareerRaceController.prototype) as CareerRaceController
    Object.assign(controller, {
      residents: [{ npc: commander, spec: { id: TOWN_COMMANDER_ID, x: 5.4, z: 0 } }], obstacles: [], commanded: new Map(),
      navigation: { areConnected: () => false }, returnGroundHeight: () => 1.4, read: () => current,
      player: () => ({ currentMount: null, combatPosition: new Vector3(2, 1, -3), facingYaw: 0, hp: 73, maxHp: 100, dead: false, staminaValue: 60 }),
      mounts: { activeMount: null, activeMountId: 'horse' },
      commit: (next: CareerProfile) => { if (!store.save(next)) return false; current = next; return true } })
    controller.restore()
    gameplayNpcSpawns.tick(performance.now() + 1e9)
    await expect(controller.waitForDeployment()).rejects.toThrow('no legal spawn')
    expect(controller.ready).toBe(false)
    expect(controller.error).toContain('可取消本次賽馬')
    expect(controller.canCancelFailedStoryRace).toBe(true)
    expect(store.load()!.activeRace?.gameSeconds).toBe(12)
    expect(controller.cancelFailedStoryRace()).toBe(true)
    const saved = store.load()!
    expect(saved.activeRace).toBeUndefined(); expect(controller.session).toBeUndefined()
    expect(saved.careerStory!.events[EVENT]).toEqual({ status: 'pending' })
    expect(saved.raceRecords).toBeUndefined(); expect([saved.availableMerit, saved.totalMerit]).toEqual([75, 150])
    expect(saved.racePlayerState).toMatchObject({ hp: 73, position: { x: 2, y: 1, z: -3 } })
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
    const p = profile(), s = session(); p.activeRace = s; p.totalMerit = 22000; Object.assign(p, careerRankFixture(p.faction, 'commander'));
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
    expect(settledPos.y).toBeCloseTo(4 + PLAYER_FOOT_OFFSET)
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
