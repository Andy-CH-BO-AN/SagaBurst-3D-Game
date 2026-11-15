import { personalSquadFixture } from '../helpers/personalSquadFixture'
import { careerRankFixture } from '../helpers/careerRankFixture'
import { describe, expect, it } from 'vitest'
import { createActiveCareerMission } from '../../src/career/CareerMissionState'
import { emptyPersonalContribution, returnPersonalMissionToHR, type PersonalActorCheckpoint, type PersonalSquadMission } from '../../src/career/CareerPersonalSquadMission'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { placePersonalMissionAtHR } from '../../src/town/PersonalSquadHomeReturn'
import { purchaseTownMount } from '../../src/town/TownRules'

import { MemoryStorage } from '../helpers/memoryStorage'

describe('Career airborne state serialization', () => {
  it('round-trips flight, private allocation, damaged and unavailable xongkoro without reviving or duplicating inventory', () => {
    const original = { ...createCareerProfile('roman'), ...careerRankFixture('roman', 'captain' as const), rank: 'captain' as const, totalMerit: 40000, availableMerit: 30000 }
    const profile = purchaseTownMount(purchaseTownMount(original, 'xongkoro').profile, 'xongkoro').profile
    profile.personalSquad = personalSquadFixture(profile, [{ id: 'personal:eagle-ranger', type: 'ranger', equipment: { melee: null, ranged: 'recurve_longbow', shield: null, mount: 'xongkoro' } }])
    const flight = { phase: 'cruise' as const, yaw: .4, pitch: .3, bank: -.2, speed: 13.333333333, velocity: { x: 5, y: 3, z: 12 } }
    profile.playerAerialState = { sceneKey: 'town-home', hp: 85, dead: false, position: { x: 20, y: 45, z: 30, yaw: .4 },
      mount: { hp: 127, position: { x: 20, y: 42, z: 28, yaw: .4 }, flight } }
    profile.activeMission = createActiveCareerMission('recruit-bandits-01', 0, 3, 0, 'eagle-checkpoint')
    profile.activeMission.mountState = { activeMountId: 'xongkoro', hp: { xongkoro: 127, horse: 0 }, unavailable: ['horse'] }
    profile.activeMission.personalSquad = { squadId: 'personal', memberIds: ['personal:eagle-ranger'], sceneKey: 'town-home', state: 'ACTIVE',
      contribution: { damageDealt: 0, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 },
      members: { 'personal:eagle-ranger': { status: 'deployed', eaglePadId: 'private-eagle-pad:3', hp: 62, position: { x: 25, y: 48, z: 30, yaw: .4 },
        mount: { hp: 94, mounted: true, position: { x: 25, y: 45, z: 28, yaw: .4 }, flight } } } }
    const store = new CareerProfileStore(new MemoryStorage())
    expect(store.save(profile)).toBe(true)
    const loaded = store.load()!
    expect(loaded.inventory?.quantities.xongkoro).toBe(2)
    expect(loaded.selectedMountId).toBe('xongkoro')
    expect(loaded.playerAerialState).toEqual(profile.playerAerialState)
    expect(loaded.activeMission?.mountState).toEqual(profile.activeMission.mountState)
    expect(loaded.activeMission?.personalSquad).toEqual(profile.activeMission.personalSquad)

  })

  it('preserves pending rider fall apex and velocity through storage after the eagle has died', () => {
    const profile = purchaseTownMount({ ...createCareerProfile('viking'), ...careerRankFixture('viking', 'captain'), rank: 'captain', totalMerit: 20000, availableMerit: 10000 }, 'xongkoro').profile
    profile.activeMission = createActiveCareerMission('recruit-bandits-01', 0, 3, 0, 'fall-checkpoint')
    profile.activeMission.mountState = { hp: { xongkoro: 0 }, unavailable: ['xongkoro'] }
    profile.playerAerialState = { sceneKey: 'town-home', hp: 50, dead: false, position: { x: 10, y: 26.5, z: 30, yaw: 1 },
      fall: { active: true, highestFeetY: 38.25, velocity: { x: 4, y: -16, z: 10 } } }
    const store = new CareerProfileStore(new MemoryStorage())
    expect(store.save(profile)).toBe(true)
    const loaded = store.load()!
    expect(loaded.playerAerialState).toEqual(profile.playerAerialState)
    expect(loaded.activeMission?.mountState).toEqual({ hp: { xongkoro: 0 }, unavailable: ['xongkoro'] })
  })
})

describe('Career Town layout checkpoint migration', () => {
  // Pure checkpoint/persistence ownership: no materialized NPC, Mount or TownWorld.
  const newPad = { id: 'private-eagle-pad:1', x: -70, z: 25, yaw: Math.PI / 2 }
  const secondPad = { id: 'private-eagle-pad:2', x: -40, z: 25, yaw: Math.PI / 2 }
  const layout = { eaglePads: [newPad, secondPad], muster: [
    { x: -90, z: 70, yaw: 0 }, { x: -85, z: 70, yaw: 0 }, { x: -80, z: 70, yaw: 0 },
  ] }
  const grounded = { phase: 'grounded' as const, yaw: 0, pitch: 0, bank: 0, speed: 0, velocity: { x: 0, y: 0, z: 0 } }
  const privateHome = { x: -30.686291501015234, y: 2, z: -31.68629150101524, yaw: 0 }
  function personal(actor: Partial<PersonalActorCheckpoint> = {}): PersonalSquadMission {
    return { squadId: 'personal', sceneKey: 'town-home', state: 'ACTIVE', memberIds: ['personal:eagle'],
      contribution: emptyPersonalContribution(), members: { 'personal:eagle': {
        status: 'deployed', hp: 49, ammo: 3, shieldImpact: 2, eaglePadId: 'private-eagle-pad:1',
        position: { x: 0, y: 2, z: 40, yaw: 0 },
        mount: { hp: 73, mounted: false, position: { ...privateHome }, flight: { ...grounded } },
        ...actor,
      } } }
  }

  it('persists a full private roster refit at HR with allocated eagle pads instead of battlefield casualties or flight', () => {
    const battle = personal({ order: 'charge', boarding: true,
      formation: { commandId: 9, position: { x: 500, z: 500, yaw: 0 }, reached: false },
      mount: { hp: 73, mounted: true, position: { x: 500, y: 80, z: 500, yaw: 1 },
        flight: { phase: 'cruise', yaw: 1, pitch: .2, bank: .1, speed: 12, velocity: { x: 5, y: 2, z: 8 } } } })
    battle.sceneKey = 'bridge:completed'; battle.pendingMemberIds = ['personal:foot']
    battle.memberIds.push('personal:foot', 'personal:dead')
    battle.members['personal:foot'] = { status: 'deployed', hp: 9, ammo: 0, position: { x: 510, z: 520, yaw: 1 }, order: 'follow' }
    battle.members['personal:dead'] = { status: 'dead', hp: 0 }
    const before = structuredClone(battle), profile = createCareerProfile('roman')
    profile.personalSquadRuntime = returnPersonalMissionToHR(battle)
    const store = new CareerProfileStore(new MemoryStorage())
    expect(store.save(profile)).toBe(true)
    const saved = store.load()!.personalSquadRuntime!
    expect(saved).toMatchObject({ sceneKey: 'town-home', state: 'RESERVE', returnToHR: true })
    expect(saved.pendingMemberIds).toBeUndefined()
    // Older saves may still carry deployed/casualty resources under the durable return flag.
    const legacy = { ...saved, members: structuredClone(battle.members) }
    const home = placePersonalMissionAtHR(legacy, { ...layout, padForMember: id => id === 'personal:eagle' ? secondPad : undefined })
    expect(home.returnToHR).toBe(true) // The runtime consumes the intent without spawning actors.
    expect(home.members).toEqual({
      'personal:eagle': { status: 'reserve', eaglePadId: 'private-eagle-pad:2' },
      'personal:foot': { status: 'reserve' }, 'personal:dead': { status: 'reserve' },
    })
    // Missing HP/ammo/shield/mount overrides give the next Follow full equipped resources.
    expect(Object.values(saved.members)).toEqual([
      { status: 'reserve', eaglePadId: 'private-eagle-pad:1' },
      { status: 'reserve' }, { status: 'reserve' },
    ])
    expect(battle).toEqual(before)
    profile.personalSquadRuntime = home
    expect(store.save(profile)).toBe(true)
    expect(placePersonalMissionAtHR(store.load()!.personalSquadRuntime!, layout)).toEqual(home)
  })

  it('keeps a saved HR standby (every deployed member at its muster slot) in RESERVE with its wounds', () => {
    const saved = personal({ order: 'defend', position: { x: -84.2, y: 2, z: 70.6, yaw: 0 } })
    saved.state = 'RESERVE'
    const before = structuredClone(saved)
    expect(placePersonalMissionAtHR(saved, layout)).toBe(saved)
    expect(saved).toEqual(before)
  })
})
