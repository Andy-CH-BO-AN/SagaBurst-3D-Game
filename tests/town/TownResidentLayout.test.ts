import { getTerrainHeight } from '../../src/world/Terrain'
import { getTownRampartLayout } from '../../src/town/TownRamparts'
import { townStationSpec } from '../../src/town/TownGarrison'
import { TownGroundStations } from '../../src/town/TownGroundStation'
import { describe, expect, it } from 'vitest'
import { Box3, Vector3 } from 'three'
import type { CivilianCommandSquadState } from '../../src/career/CivilianCommandAuthority'
import { CIVILIAN_HOME_LAYOUT_VERSION, migrateCivilianHomes, civilianHomeAnchor, civilianPointLegal, civilianBodyClear, civilianMountsClear, townMountPlacementBatchClear, CIVILIAN_MOUNT_CLEARANCE, assignTownCivilianHomes } from '../../src/town/TownCivilianLife'
import { findTownDuelArena, townDuelAreaClear, DUEL_ARENA_HALF_SIZE } from '../../src/town/TownDuelArena'
import { TOWN_DUEL_CENTER, TOWN_CITY_ROADS, TOWN_LOCAL_ROADS, TOWN_MOUNTED_MISSION_MUSTER } from '../../src/town/TownLayout'
import { townRoster, withTownCommandSquadRoster } from '../../src/town/TownRules'
import { resolveTownHRLayout, townConquestRoster } from '../../src/town/TownHRLayout'
import { resolveTownEagleTrainingGround } from '../../src/town/TownEagleTrainingGround'
import { resolveTownEagleGarrison } from '../../src/town/TownEagleGarrison'
import { resolveTownCommanderPosition, townCommanderSpec } from '../../src/town/TownCommander'

describe('Town resident layout ownership', () => {
  it('migrates living daily homes and mounted positions without healing or moving other owners', () => {
    const ids = Array.from({ length: 5 }, (_, i) => `civilian-${i}`)
    const saved: CivilianCommandSquadState = { type: 'civilian-command', squadId: 'civilians', townFaction: 'viking',
      sceneKey: 'town:viking', homeLayoutVersion: 3, actorIds: ids,
      owners: { 'civilian-0': 'daily', 'civilian-1': 'daily', 'civilian-2': 'player', 'civilian-3': 'evacuation', 'civilian-4': 'returning' },
      members: Object.fromEntries(ids.map((id, i) => [id, { status: i === 1 ? 'dead' : 'deployed', hp: i === 1 ? 0 : 13,
        position: { x: 50, y: 0, z: 12, yaw: 1 }, order: 'formation',
        formation: { commandId: 7, position: { x: 2, z: 3, yaw: 1 }, reached: false },
        mount: { hp: 17, mounted: true, position: { x: 50, y: 0, z: 12, yaw: 1 } } }])) }
    const original = structuredClone(saved)
    const homes = ids.map((id, i) => ({ id, x: 100 + i * 3, y: 2, z: 70, yaw: 0 }))
    const next = migrateCivilianHomes(saved, homes)
    expect(next.homeLayoutVersion).toBe(CIVILIAN_HOME_LAYOUT_VERSION)
    expect(next.members['civilian-0']).toMatchObject({ hp: 13, position: { x: 100, y: 2, z: 70 },
      mount: { hp: 17, mounted: true, position: { x: 100, y: 2, z: 70 } } })
    expect(next.members['civilian-0'].formation).toBeUndefined()
    for (const id of ids.slice(1)) expect(next.members[id]).toEqual(original.members[id])
    expect(next.owners).toEqual(original.owners); expect(saved).toEqual(original)
    expect(migrateCivilianHomes(next, homes)).toBe(next)
  })

  it('repairs an unsafe mounted pose on current-layout reload without changing health or mount ownership', () => {
    const saved: CivilianCommandSquadState = { type: 'civilian-command', squadId: 'civilians', townFaction: 'roman',
      sceneKey: 'town:roman', homeLayoutVersion: CIVILIAN_HOME_LAYOUT_VERSION, actorIds: ['civilian-0'],
      owners: { 'civilian-0': 'daily' }, members: { 'civilian-0': { status: 'deployed', hp: 13,
        position: { x: 1, z: 1, yaw: 0 }, mount: { hp: 17, mounted: true, position: { x: 1, z: 1, yaw: 0 } } } } }
    const home = civilianHomeAnchor(0)
    const next = migrateCivilianHomes(saved, [{ id: 'civilian-0', ...home }], () => true, point => point.x > 50)
    expect(next.members['civilian-0']).toMatchObject({ status: 'deployed', hp: 13,
      position: { x: home.x, z: home.z }, mount: { hp: 17, mounted: true, position: { x: home.x, z: home.z } } })
    expect(next.actorIds).toEqual(saved.actorIds); expect(next.owners).toEqual(saved.owners)
    expect(saved.members['civilian-0'].mount!.position.x).toBe(1)
  })

  it.each([1])('retries a v%i foot home migration after a temporary occupant leaves', version => {
    const saved: CivilianCommandSquadState = { type: 'civilian-command', squadId: 'civilians', townFaction: 'roman',
      sceneKey: 'town:roman', homeLayoutVersion: version, actorIds: ['civilian-0', 'civilian-1'],
      owners: { 'civilian-0': 'daily', 'civilian-1': 'daily' }, members: {
        'civilian-0': { status: 'deployed', hp: 13, position: { x: 50, z: 12, yaw: 0 } },
        'civilian-1': { status: 'deployed', hp: 17, position: { x: 54, z: 12, yaw: 0 } },
      } }
    const homes = [{ id: 'civilian-0', x: 90, z: 70 }, { id: 'civilian-1', x: 100, z: 70 }]
    const blocked = migrateCivilianHomes(saved, homes, point => point.x !== 100)
    expect(blocked).toBe(saved)
    expect(blocked.homeLayoutVersion).toBe(version)
    expect(blocked.members['civilian-0'].position).toEqual({ x: 50, z: 12, yaw: 0 })
    const retried = migrateCivilianHomes(blocked, homes, () => true)
    expect(retried.homeLayoutVersion).toBe(CIVILIAN_HOME_LAYOUT_VERSION)
    expect(retried.members['civilian-0']).toMatchObject({ hp: 13, position: { x: 90, z: 70 } })
    expect(retried.members['civilian-1']).toMatchObject({ hp: 17, position: { x: 100, z: 70 } })
    expect(retried.owners).toEqual(saved.owners)
  })

  it('rejects duel deployment when an unrelated resident occupies the reserved inner arena', () => {
    const roster = townRoster(), navigation = { areConnected: () => true }
    const open = findTownDuelArena([], navigation, roster)
    expect(open).not.toBeNull()
    const visitor = { ...roster.find(s => s.role === 'civilian')!, id: 'civilian-visitor', x: TOWN_DUEL_CENTER.x, z: TOWN_DUEL_CENTER.z }
    expect(findTownDuelArena([], navigation, [...roster, visitor])).toBeNull()
    expect(findTownDuelArena([{ isBarricade: false, box: new Box3(new Vector3(-100, -100, -100), new Vector3(200, 100, 100)) }], navigation, roster)).toBeNull()
  })

  it('keeps duel deployment and its fallback candidates outside riding roads and mounted muster', () => {
    const area = findTownDuelArena([], { areConnected: () => true }, townRoster())!
    expect(area).not.toBeNull()
    const box = (x: number, z: number, half: number) => new Box3(new Vector3(x - half, -100, z - half), new Vector3(x + half, 100, z + half))
    expect(townDuelAreaClear(box(area.x, area.z, DUEL_ARENA_HALF_SIZE))).toBe(true)
    // Independent occupied intervals from the authored roads catch the former z=-58 placement.
    for (const road of [...TOWN_CITY_ROADS, ...TOWN_LOCAL_ROADS]) {
      expect(townDuelAreaClear(box((road.ax + road.bx) / 2, (road.az + road.bz) / 2, 1))).toBe(false)
    }
    expect(townDuelAreaClear(box(TOWN_MOUNTED_MISSION_MUSTER.x, TOWN_MOUNTED_MISSION_MUSTER.z, 1))).toBe(false)
  })

  it('blocks a second horse at a parked riderless mount while allowing reuse of the same physical horse', () => {
    const point = { x: 100, z: 70 }
    // The player has walked away; the parked physical horse remains at the spawn point.
    const parked = { dead: false, disposed: false, riderNpc: null, riderPlayer: null,
      combatRadius: 2, group: { position: { ...point } } }
    expect(civilianMountsClear(point, [parked, parked])).toBe(false)
    expect(civilianMountsClear(point, [parked, parked], [parked])).toBe(true)
    expect(civilianMountsClear(point, [parked, { ...parked }], [parked])).toBe(false)
    expect(civilianMountsClear({ x: 105, z: 70 }, [parked])).toBe(true)
    expect(civilianMountsClear(point, [
      { ...parked, dead: true }, { ...parked, disposed: true },
    ])).toBe(true)
  })

  it('rejects a bulk foot-to-horse placement at infantry Follow spacing using both final mounted footprints', () => {
    const plans = [{ point: { x: 100, z: 70 }, radius: 2 }, { point: { x: 103, z: 70 }, radius: 2 }]
    // 3m clears the old 2m horse + 0.5m walking actor precheck, but not two final horses.
    expect(townMountPlacementBatchClear(plans)).toBe(false)
    expect(plans[1].point).toEqual({ x: 103, z: 70 })
    expect(townMountPlacementBatchClear([plans[0], { point: { x: 104, z: 70 }, radius: 2 }])).toBe(true)
  })

  it('keeps a nonresident HR rider mount occupied unless that exact rider is checked separately', () => {
    const point = { x: 100, z: 70 }, resident = {}, privateSoldier = {}
    const mount = { dead: false, disposed: false, riderNpc: privateSoldier, riderPlayer: null,
      combatRadius: 2, group: { position: { ...point } } }
    expect(civilianMountsClear(point, [mount], [], new Set([resident]))).toBe(false)
    expect(civilianMountsClear(point, [mount], [], new Set([privateSoldier]))).toBe(true)
    expect(civilianMountsClear(point, [mount], [mount], new Set([resident]))).toBe(true)
    expect(civilianMountsClear(point, [{ ...mount, riderNpc: null, riderPlayer: privateSoldier }])).toBe(false)
  })

  it('rejects an overhead obstacle that clears a walker but intersects a mounted civilian', () => {
    const point = civilianHomeAnchor(0)
    const canopy = { isBarricade: false, navigationPassable: true, box: new Box3(
      new Vector3(point.x - .5, point.y + 3, point.z - .5), new Vector3(point.x + .5, point.y + 3.3, point.z + .5)) }
    expect(civilianPointLegal(point, [], [canopy])).toBe(true)
    expect(civilianPointLegal(point, [], [canopy], CIVILIAN_MOUNT_CLEARANCE)).toBe(false)
    expect(civilianBodyClear(point, [canopy])).toBe(false)
    const road = TOWN_LOCAL_ROADS[0], roadPoint = { x: (road.ax + road.bx) / 2, z: (road.az + road.bz) / 2 }
    expect(civilianPointLegal(roadPoint, [], [], CIVILIAN_MOUNT_CLEARANCE)).toBe(false)
    expect(civilianBodyClear(roadPoint, [])).toBe(true)
  })
})

it('keeps final Town population homes, ground stations and fallbacks clear of ramp approaches and each other', () => {
  const roster = townRoster(), layout = getTownRampartLayout()
  const stations = roster.flatMap(actor => actor.garrison ? [
    ...(actor.garrison.kind === 'rampart' ? [] : [{ ...actor.garrison, radius: actor.mounted ? 1.8 : .7 }]),
    ...(actor.garrison.groundFallback ? [{ ...actor.garrison.groundFallback, radius: 1.8 }] : []),
  ] : [])
  expect(new Set(roster.filter(a => a.mounted && a.garrison?.kind === 'reserve').map(a => a.garrison!.gateId)).size).toBe(4)
  const intrusions: string[] = []
  for (const p of stations) for (const ramp of layout.ramps) {
    const s = ramp.surface, dx = p.x - s.startX, dz = p.z - s.startZ
    const along = dx * s.dirX + dz * s.dirZ, lateral = Math.abs(-dx * s.dirZ + dz * s.dirX)
    if (!(along < -7.5 - p.radius || along > s.length + s.landing + p.radius + 1 || lateral > s.halfWidth + p.radius + 1)) intrusions.push(`${ramp.gateId}:${p.x},${p.z}`)
  }
  expect(intrusions).toEqual([])
  let minimumGap = Infinity
  for (let i = 0; i < stations.length; i++) for (let j = 0; j < i; j++) {
    const a = stations[i], b = stations[j]
    minimumGap = Math.min(minimumGap, Math.hypot(a.x - b.x, a.z - b.z) - a.radius - b.radius)
  }
  expect(minimumGap).toBeGreaterThanOrEqual(.59)
  const roads = [...TOWN_CITY_ROADS, ...TOWN_LOCAL_ROADS], navigation = { areConnected: () => true }
  const hr = resolveTownHRLayout('roman', [], roads), training = resolveTownEagleTrainingGround([], roads, hr)
  const population = townConquestRoster(hr, withTownCommandSquadRoster('roman', roster), training, resolveTownEagleGarrison(training))
  population.push(townCommanderSpec(resolveTownCommanderPosition([], roads, navigation, population)))
  // Reserve an otherwise legal home in the final population. This makes the
  // lost-fallback bug observable even when today's default slots happen to miss homes.
  const unreserved = population.filter(a => a.role !== 'civilian').map(a => a.garrison ?? a)
  const reservedHome = civilianHomeAnchor(0, unreserved, [], navigation)
  population.find(a => a.garrison?.groundFallback)!.garrison!.groundFallback = { ...reservedHome, yaw: 0 }
  assignTownCivilianHomes(population, [], navigation)
  const fallbacks = population.flatMap(a => a.garrison?.groundFallback ?? [])
  const civilians = population.filter(a => a.role === 'civilian')
  expect(civilians).toHaveLength(20)
  expect(population.map(a => a.id)).toEqual(expect.arrayContaining(['hr-officer', 'eagle-trainer', 'commander']))
  let homeGap = Infinity
  for (const civilian of civilians) for (const fallback of fallbacks) homeGap = Math.min(homeGap, Math.hypot(civilian.x - fallback.x, civilian.z - fallback.z))
  expect(homeGap).toBeGreaterThanOrEqual(4.5)
})

it('uses unique deterministic ground fallbacks for equipment changes and restores the authored ranged station', () => {
  const roster = townRoster(), actor = roster.find(a => a.garrison?.kind === 'rampart')!, original = structuredClone(actor)
  const mounted = townStationSpec(actor, true, true)
  const melee = townStationSpec(actor, false, false)
  expect(mounted).toEqual(townStationSpec(actor, true, true))
  expect(melee.garrison).toEqual(mounted.garrison)
  expect(mounted.garrison?.kind).toBe('reserve')
  expect(mounted).toMatchObject({ id: actor.id, duty: actor.duty, tier: actor.tier })
  expect(mounted.garrison?.gateId).toBe(actor.garrison?.gateId)
  expect(mounted.y).toBe(getTerrainHeight(mounted.x, mounted.z))
  expect(civilianPointLegal(mounted, [], [], { radius: 1.8, height: 2.6 })).toBe(true)
  expect(townStationSpec(mounted, false, true)).toMatchObject({ x: actor.garrison!.x, y: actor.garrison!.y, z: actor.garrison!.z, garrison: actor.garrison })
  expect(actor).toEqual(original)
})

it('selects the nearest tied ground candidate in authored order and rechecks occupancy on the reused heap', () => {
  const stations = new TownGroundStations(getTownRampartLayout(), [{ x: 30, z: -105, radius: .7 }])
  const first = stations.allocate('north', { x: 30, z: -105 }, false)
  const second = stations.allocate('north', { x: 30, z: -105 }, false)
  expect(first.x).toBeCloseTo(34.5); expect(first.z).toBeCloseTo(-105)
  expect(second.x).toBeCloseTo(25.5); expect(second.z).toBeCloseTo(-105)
  expect(first.y).toBe(getTerrainHeight(first.x, first.z))
  expect(second.y).toBe(getTerrainHeight(second.x, second.z))
})
