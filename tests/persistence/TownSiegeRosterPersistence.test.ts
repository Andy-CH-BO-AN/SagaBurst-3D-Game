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
