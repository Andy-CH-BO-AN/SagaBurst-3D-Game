import { migrateTownRampartPosition } from '../../src/town/TownLayoutMigration'
import { townRoster } from '../../src/town/TownRules'
import { emptyPersonalContribution } from '../../src/combat/CommandMerit'
import { describe, expect, it } from 'vitest'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { CAREER_STORAGE_KEY, CareerProfileStore } from '../../src/career/CareerProfileStore'
import { createTownDefenseMission } from '../../src/career/CareerMissionState'
import { createEnemyTownAssaultMission } from '../../src/career/EnemyTownAssault'
import { siegeRoster, siegeRosterVersion } from '../../src/career/TownSiege'
import { MemoryStorage } from '../helpers/memoryStorage'

// Version and slot compatibility are data contracts: no NPC, Mount or TownWorld.
describe.each(['roman', 'viking'] as const)('%s Siege saved composition', faction => {
  it.each([false, true])('retains every original slot and claimed identity after serializing an unversioned started battle, assault=%s', assault => {
    const profile = createCareerProfile(faction)
    profile.activeMission = assault ? createEnemyTownAssaultMission('legacy') : createTownDefenseMission([], [], 'legacy')
    const mission = profile.activeMission, siege = mission.siege!
    delete siege.rosterVersion
    siege.rosterCreated = true
    siege.attackerIds = Array.from({ length: assault ? 119 : 120 }, (_, index) => index === 2 ? 'outskirts:cavalry:a:0' : `legacy:siege:${index}`)
    siege.claimedSquadIds = ['outskirts:cavalry:a']
    const ids = [...siege.attackerIds]
    if (assault) { mission.friendlyActorIds = ids; mission.deadFriendlyActorIds = [ids[3]] }
    else { mission.targetActorIds = ids; mission.deadTargetActorIds = [ids[3]] }
    mission.actorHealth = { [ids[2]]: { hp: 43, mountHp: 0 } }
    const storage = new MemoryStorage({ initialValues: [[CAREER_STORAGE_KEY, JSON.stringify(profile)]] })
    const store = new CareerProfileStore(storage)
    const loaded = store.load()!
    expect(loaded.activeMission!.siege).toMatchObject({ rosterVersion: 1, attackerIds: ids, claimedSquadIds: ['outskirts:cavalry:a'] })
    expect(loaded.activeMission!.actorHealth).toEqual(mission.actorHealth)
    expect(assault ? loaded.activeMission!.deadFriendlyActorIds : loaded.activeMission!.deadTargetActorIds).toEqual([ids[3]])
    const roster = siegeRoster(faction, assault, siegeRosterVersion(loaded.activeMission!.siege!))
    for (const gateId of ['north', 'south', 'east', 'west']) {
      const group = roster.filter(slot => slot.gateId === gateId)
      const playerSlot = assault && gateId === 'north' ? 1 : 0
      expect(group.filter(({ spec }) => spec.presetId === `${faction}_sword_cavalry`).length + playerSlot).toBe(10)
      expect(group.filter(({ spec }) => spec.presetId === `${faction}_lancer`)).toHaveLength(10)
      expect(group.filter(({ spec }) => spec.presetId === `${faction}_horse_archer`)).toHaveLength(10)
      expect(group.every(({ spec }) => spec.cavalry && Boolean(spec.loadout?.mountId))).toBe(true)
    }
    expect(roster.find(({ spec }) => spec.specialCombatProfile === 'maki-ranger')).toMatchObject({ gateId: 'west', slot: 20 })
    expect(store.save(loaded)).toBe(true)
    expect(store.load()!.activeMission!.siege).toEqual(loaded.activeMission!.siege)
  })

  it.each([false, true])('uses mixed composition for unstarted legacy missions and retains its version after start/save, assault=%s', assault => {
    const profile = createCareerProfile(faction)
    profile.activeMission = assault ? createEnemyTownAssaultMission('unstarted') : createTownDefenseMission([], [], 'unstarted')
    delete profile.activeMission.siege!.rosterVersion
    const store = new CareerProfileStore(new MemoryStorage({ initialValues: [[CAREER_STORAGE_KEY, JSON.stringify(profile)]] }))
    const loaded = store.load()!
    expect(siegeRosterVersion(loaded.activeMission!.siege!)).toBe(2)
    loaded.activeMission!.siege!.rosterCreated = true
    expect(store.save(loaded)).toBe(true)
    const restored = store.load()!
    expect(restored.activeMission!.siege!.rosterVersion).toBe(2)
    expect(siegeRoster(faction, assault, siegeRosterVersion(restored.activeMission!.siege!)).filter(({ spec }) => !spec.cavalry)).toHaveLength(40)
  })
})


describe('Town rampart siege checkpoint serialization', () => {
  it.each([undefined, 9.25])('retains casualties, garrison ownership and optional Y=%s through storage', y => {
    const profile = createCareerProfile('roman')
    profile.activeMission = createTownDefenseMission(['gate:north:7'], [], 'rampart-save')
    const active = profile.activeMission
    active.actorPositions = { 'gate:north:7': { x: 15, y, z: -112.6, yaw: Math.PI, townRampartGarrison: true } }
    active.actorHealth = { 'gate:north:7': { hp: 0, mountHp: 0 } }
    active.deadFriendlyActorIds = ['gate:north:7']
    active.siege!.playerPosition = { x: 30, y, z: -110.6, yaw: 1 }
    const store = new CareerProfileStore(new MemoryStorage())
    expect(store.save(profile)).toBe(true)
    const restored = store.load()!.activeMission!
    expect(restored.actorPositions?.['gate:north:7']).toEqual({ x: 15, ...(y !== undefined ? { y } : {}), z: -112.6, yaw: Math.PI, townRampartGarrison: true })
    expect(restored.actorHealth).toEqual(active.actorHealth)
    expect(restored.deadFriendlyActorIds).toEqual(['gate:north:7'])
    expect(restored.siege!.playerPosition).toEqual({ x: 30, ...(y !== undefined ? { y } : {}), z: -110.6, yaw: 1 })
  })
})


describe('Town rampart legacy placement and command priority', () => {
  it.each(['default', 'commanded', 'mounted', 'melee', 'modern'] as const)('migrates only an uncommanded legacy ranged station: %s', state => {
    const spec = townRoster().find(actor => actor.id === 'gate:north:7')!
    const profile = createCareerProfile('roman')
    profile.activeMission = createTownDefenseMission([spec.id], [], 'migration')
    profile.activeMission.actorPositions = { [spec.id]: { x: 25, z: 30, yaw: .4, ...(state === 'modern' ? { y: 7.75 } : {}) } }
    const store = new CareerProfileStore(new MemoryStorage())
    expect(store.save(profile)).toBe(true)
    const saved = store.load()!, old = saved.activeMission!.actorPositions![spec.id]
    const next = migrateTownRampartPosition(old, spec, state === 'commanded', state === 'mounted', state !== 'melee')
    if (state === 'default') expect(next).toMatchObject({ x: spec.garrison!.x, y: spec.garrison!.y, z: spec.garrison!.z })
    else expect(next).toEqual(old)
    saved.activeMission!.actorPositions![spec.id] = next
    expect(store.save(saved)).toBe(true)
    const reloaded = store.load()!.activeMission!.actorPositions![spec.id]
    expect(migrateTownRampartPosition(reloaded, spec, state === 'commanded', state === 'mounted', state !== 'melee')).toEqual(next)
  })

  it.each(['defend', 'attack', 'formation', 'follow'] as const)('retains official %s ownership and elevated coordinates through storage', order => {
    const profile = createCareerProfile('roman'), id = 'gate:north:7'
    profile.activeMission = createTownDefenseMission([id], [], 'official-rampart')
    const member = { status: 'deployed' as const, hp: 37, ammo: 12, order, position: { x: 30, y: 9.25, z: -110.6, yaw: .7 },
      ...(order === 'defend' || order === 'attack' ? { townRampartGarrison: true } : {}),
      ...(order === 'formation' ? { formation: { commandId: 91, position: { x: 40, y: 8.5, z: -110.6, yaw: 0 }, reached: false } } : {}) }
    profile.activeMission.officialSquad = { type: 'mission-official', missionId: 'official-rampart', townFaction: 'roman', squadId: 1,
      actorIds: [id], contribution: emptyPersonalContribution(), members: { [id]: member } }
    const store = new CareerProfileStore(new MemoryStorage())
    expect(store.save(profile)).toBe(true)
    expect(store.load()!.activeMission!.officialSquad!.members![id]).toEqual(member)
  })
})
