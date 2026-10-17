import { describe, expect, it } from 'vitest'
import { Box3, Vector3 } from 'three'
import type { CivilianCommandSquadState } from '../../src/career/CivilianCommandAuthority'
import type { NavigationWorld } from '../../src/navigation/NavigationWorld'
import type { TownCombatResident } from '../../src/town/TownMissionCombat'
import { CIVILIAN_HOME_LAYOUT_VERSION, migrateCivilianHomes } from '../../src/town/TownCivilianLife'
import { findTownMerchantParking, TownMerchantMountController } from '../../src/town/TownMerchantMount'
import { findTownDuelArena } from '../../src/town/TownDuelArena'
import { TOWN_DUEL_CENTER } from '../../src/town/TownLayout'
import { townRoster } from '../../src/town/TownRules'

describe('Town resident layout ownership', () => {
  it('migrates living daily homes and mounted positions without healing or moving other owners', () => {
    const ids = Array.from({ length: 5 }, (_, i) => `civilian-${i}`)
    const saved: CivilianCommandSquadState = { type: 'civilian-command', squadId: 'civilians', townFaction: 'viking',
      sceneKey: 'town:viking', homeLayoutVersion: 1, actorIds: ids,
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

  it('rejects duel deployment when an unrelated resident occupies the reserved inner arena', () => {
    const roster = townRoster(), navigation = { areConnected: () => true }
    const open = findTownDuelArena([], navigation, roster)
    expect(open).not.toBeNull()
    const visitor = { ...roster.find(s => s.role === 'civilian')!, x: TOWN_DUEL_CENTER.x, z: TOWN_DUEL_CENTER.z }
    expect(findTownDuelArena([], navigation, [...roster, visitor])).toBeNull()
    expect(findTownDuelArena([{ isBarricade: false, box: new Box3(new Vector3(-100, -100, -100), new Vector3(200, 100, 100)) }], navigation, roster)).toBeNull()
  })

  it('returns the mounted merchant through outdoor parking before walking back to service', () => {
    const spec = townRoster().find(spec => spec.role === 'merchant')!, parking = findTownMerchantParking()!
    const position = new Vector3(30, 0, -27), approached: Vector3[] = []
    const mount = { dead: false, disposed: false, isAirborne: false, riderPlayer: null, riderNpc: null as unknown,
      visualHold: false, group: { position: position.clone() } }
    const npc = { dead: false, isFalling: false, inCombat: false, hasLiveCombatTarget: false, mount,
      group: { position }, get combatPosition() { return this.mount?.group.position ?? position },
      get isMounted() { return this.mount !== null },
      dismountFromMount() { this.mount = null!; mount.riderNpc = null; position.copy(mount.group.position) },
      updateTownMountApproach(_dt: number, _distance: number, target: Vector3) {
        approached.push(target.clone())
        const stop = target.clone()
        if (this.mount) stop.z -= 1.1 // Native mounted formation stops before the exact center.
        ;(this.mount?.group.position ?? position).copy(stop)
      } }
    mount.riderNpc = npc
    // Only the borrowed movement boundary is adapted; no scene, actor or model is constructed.
    const resident = { spec, npc, homeMount: mount } as unknown as TownCombatResident
    const nav = { areConnected: () => true } as unknown as NavigationWorld
    const owner = new TownMerchantMountController(parking), camera = new Vector3()
    expect(owner.update(resident, false, .1, camera, [], [], nav, [])).toBe(true)
    expect(npc.isMounted).toBe(true)
    expect(approached[0]).toEqual(new Vector3(parking.x, parking.y, parking.z))
    expect(owner.update(resident, false, .1, camera, [], [], nav, [])).toBe(true)
    expect(npc.isMounted).toBe(false); expect(mount.visualHold).toBe(true)
    expect(approached[1].x).toBe(spec.x); expect(approached[1].z).toBe(spec.z)
    expect(owner.update(resident, false, .1, camera, [], [], nav, [])).toBe(false)
    expect(resident.homeMount).toBe(mount)
  })
})
