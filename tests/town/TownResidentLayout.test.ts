import { describe, expect, it } from 'vitest'
import { Box3, Vector3 } from 'three'
import type { CivilianCommandSquadState } from '../../src/career/CivilianCommandAuthority'
import { CIVILIAN_HOME_LAYOUT_VERSION, migrateCivilianHomes, civilianHomeAnchor, civilianPointLegal, civilianBodyClear, civilianParkedMountsClear, CIVILIAN_MOUNT_CLEARANCE } from '../../src/town/TownCivilianLife'
import { findTownDuelArena, townDuelAreaClear, DUEL_ARENA_HALF_SIZE } from '../../src/town/TownDuelArena'
import { TOWN_DUEL_CENTER, TOWN_CITY_ROADS, TOWN_LOCAL_ROADS, TOWN_MOUNTED_MISSION_MUSTER } from '../../src/town/TownLayout'
import { townRoster } from '../../src/town/TownRules'

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

  it.each([1, 2])('retries a v%i foot home migration after a temporary occupant leaves', version => {
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
    expect(civilianParkedMountsClear(point, [parked, parked])).toBe(false)
    expect(civilianParkedMountsClear(point, [parked, parked], [parked])).toBe(true)
    expect(civilianParkedMountsClear(point, [parked, { ...parked }], [parked])).toBe(false)
    expect(civilianParkedMountsClear({ x: 105, z: 70 }, [parked])).toBe(true)
    expect(civilianParkedMountsClear(point, [
      { ...parked, dead: true }, { ...parked, disposed: true },
      { ...parked, riderNpc: {} }, { ...parked, riderPlayer: {} },
    ])).toBe(true)
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
