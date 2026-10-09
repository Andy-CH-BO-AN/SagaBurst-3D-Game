import { describe, expect, it } from 'vitest'
import { acceptCaptainEagle } from '../../src/career/CaptainBattleLaunch'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { purchaseTownMount } from '../../src/town/TownRules'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { MemoryStorage } from '../helpers/memoryStorage'
import { parseCaptainEagleCheckpoint } from '../../src/career/CaptainEagleCheckpoint'

function eagleProfile() {
  return acceptCaptainEagle(purchaseTownMount({ ...createCareerProfile('roman'), rank: 'captain', totalMerit: 40000, availableMerit: 30000 }, 'xongkoro').profile, 'aerial-mission')!
}

describe('Captain Eagle mission checkpoint', () => {
  it('serializes official wounds, dead mounts, flight and falling Player without changing inventory', () => {
    const profile = eagleProfile(), mission = profile.activeMission!
    const flight = { phase: 'cruise' as const, yaw: 1, pitch: .1, bank: .2, speed: 12, velocity: { x: 5, y: 0, z: 10 } }
    mission.eagleBattle = { ready: true, actors: {
      [mission.friendlyActorIds![0]]: { status: 'deployed', hp: 31, ammo: 3, order: 'defend',
        position: { x: 10, y: 40, z: 25, yaw: 1 }, mount: { hp: 72, mounted: true, position: { x: 10, y: 37, z: 25, yaw: 1 }, flight } },
      [mission.targetActorIds[0]]: { status: 'dead', hp: 0, position: { x: 5, y: 0, z: 15, yaw: 0 },
        mount: { hp: 0, mounted: false, position: { x: 5, y: 0, z: 15, yaw: 0 } } },
    }, player: { hp: 40, stamina: 20, dead: false, ammo: 2, shieldImpact: 0,
      position: { x: 10, y: 26, z: 20, yaw: 1 }, mountHp: 0,
      fall: { active: true, highestFeetY: 42, velocity: { x: 3, y: -15, z: 5 } } },
      playerStats: { damageDealt: 42, damageTaken: 30, kills: 2, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 } }
    const store = new CareerProfileStore(new MemoryStorage())
    expect(store.save(profile)).toBe(true)
    const loaded = store.load()!
    expect(loaded.activeMission?.eagleBattle).toEqual(mission.eagleBattle)
    expect(loaded.activeMission?.officialSquad?.actorIds).toEqual(mission.officialSquad?.actorIds)
    expect(loaded.inventory).toEqual(profile.inventory)
  })

  it('rejects malformed snapshots instead of silently loading a healed aerial battle', () => {
    expect(parseCaptainEagleCheckpoint({ actors: {}, ready: true, player: { hp: -1 } })).toBeUndefined()
    expect(parseCaptainEagleCheckpoint({ actors: {}, ready: 'yes', player: {} })).toBeUndefined()
  })
})
