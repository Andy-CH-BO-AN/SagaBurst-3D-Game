import { describe,expect,it } from 'vitest'
import { createActiveCareerMission } from '../../src/career/CareerMissionState'
import { emptyPersonalContribution, returnPersonalMissionToHR, type PersonalActorCheckpoint,type PersonalSquadMission } from '../../src/career/CareerPersonalSquadMission'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { migratePersonalTownLayout, migrateTownEagleGarrisonLayout, placePersonalMissionAtHR } from '../../src/town/TownLayoutMigration'
import { purchaseTownMount } from '../../src/town/TownRules'
import type { TownEagleGarrisonState, TownEaglePairState } from '../../src/town/TownEagleGarrisonState'
import { MemoryStorage } from '../helpers/memoryStorage'

describe('Career airborne state serialization', () => {
  it('round-trips flight, private allocation, damaged and unavailable xongkoro without reviving or duplicating inventory', () => {
    const original = { ...createCareerProfile('roman'), rank: 'captain' as const, totalMerit: 40000, availableMerit: 30000 }
    const profile = purchaseTownMount(purchaseTownMount(original, 'xongkoro').profile, 'xongkoro').profile
    profile.personalSquad = { members: [{ id: 'personal:eagle-ranger', type: 'ranger', equipment: { melee: null, ranged: null, shield: null, mount: 'xongkoro' } }] }
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
    const profile = purchaseTownMount({ ...createCareerProfile('viking'), rank: 'captain', totalMerit: 20000, availableMerit: 10000 }, 'xongkoro').profile
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
  const terrain = () => 12
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

  it('restores Dismiss eligibility for an ambiguous old HR standby without refitting or moving its actors', () => {
    const saved = personal({ order: 'formation',
      formation: { commandId: 17, position: { x: 300, z: 200, yaw: 1 }, reached: false } })
    saved.state = 'RESERVE' // Old formal-return snapshots consumed returnToHR before saving.
    const before = structuredClone(saved)
    const repaired = placePersonalMissionAtHR(saved, layout)
    expect(repaired).toEqual({ ...before, state: 'ACTIVE' })
    expect(repaired.members).toBe(saved.members)
    expect(placePersonalMissionAtHR(repaired, layout)).toBe(repaired)
    expect(saved).toEqual(before)
  })

  it('relocates a boarding eagle and changes its walking destination while retaining the rider position and wounds', () => {
    const saved = personal({ boarding: true, formation: { commandId: -1001,
      position: { ...privateHome }, reached: true, speedLimit: 3.5, arrivalOrder: 'defend' } })
    const before = structuredClone(saved)
    const migrated = migratePersonalTownLayout(saved, 'town-home', layout, terrain)!
    expect(saved).toEqual(before)
    expect(migrated.members['personal:eagle']).toMatchObject({ hp: 49, ammo: 3, shieldImpact: 2, boarding: true,
      eaglePadId: 'private-eagle-pad:1', position: before.members['personal:eagle'].position,
      mount: { hp: 73, mounted: false, position: { x: -70, y: 12, z: 25, yaw: Math.PI / 2 },
        flight: { ...grounded, yaw: Math.PI / 2 } },
      formation: { commandId: -1001, position: { x: -70, y: 12, z: 25, yaw: Math.PI / 2 }, reached: false,
        speedLimit: 3.5, arrivalOrder: 'defend' } })
  })

  it('retargets returning ground soldiers to HR and an airborne eagle to its new pad without changing current positions or flight', () => {
    const saved = personal()
    saved.state = 'RETURNING'
    const formation = { commandId: -1001, position: { x: 30, y: 2, z: 40, yaw: 0 }, reached: true }
    saved.members['personal:eagle'].formation = structuredClone(formation)
    saved.members['personal:foot'] = { status: 'deployed', hp: 9, ammo: 0, position: { x: 30, y: 2, z: 40, yaw: 0 }, formation: structuredClone(formation) }
    saved.members['personal:airborne'] = { ...structuredClone(saved.members['personal:eagle']), eaglePadId: 'private-eagle-pad:2',
      mount: { hp: 73, mounted: true, position: { x: 40, y: 50, z: 20, yaw: .7 },
        flight: { phase: 'cruise', yaw: .7, pitch: -.2, bank: .1, speed: 8, velocity: { x: 5, y: -2, z: 6 } } } }
    saved.memberIds = ['personal:foot', 'personal:eagle', 'personal:airborne']
    const before = structuredClone(saved)
    const migrated = migratePersonalTownLayout(saved, 'town-home', layout, terrain)!
    expect(migrated.members['personal:foot'].position).toEqual(before.members['personal:foot'].position)
    expect(migrated.members['personal:foot'].formation).toEqual({ ...formation,
      position: { x: -90, y: 12, z: 70, yaw: 0 }, reached: false })
    expect(migrated.members['personal:eagle'].position).toEqual(before.members['personal:eagle'].position)
    expect(migrated.members['personal:eagle'].formation).toEqual({ ...formation,
      position: { x: -85, y: 12, z: 70, yaw: 0 }, reached: false })
    expect(migrated.members['personal:airborne'].position).toEqual(before.members['personal:airborne'].position)
    expect(migrated.members['personal:airborne'].mount).toBe(saved.members['personal:airborne'].mount)
    expect(migrated.members['personal:airborne'].formation).toEqual({ ...formation,
      position: { x: -40, y: 12, z: 25, yaw: Math.PI / 2 }, reached: false })
    expect(saved).toEqual(before)
  })

  it.each([{ boarding: false, mounted: true }, { boarding: true, mounted: false }])(
    'keeps a v3 eagle at a v1 historical location in place when boarding=$boarding', ({ boarding, mounted }) => {
      const formation = { commandId: 7, position: { x: -90, y: 2, z: 56, yaw: 0 }, reached: true }
      const saved = personal({ boarding, order: 'follow', formation,
        position: { x: privateHome.x + 1, y: mounted ? 5 : 2, z: privateHome.z + 2, yaw: .7 },
        mount: { hp: 73, mounted, position: { ...privateHome }, flight: { ...grounded } } })
      saved.layoutVersion = 3
      const before = structuredClone(saved), actor = saved.members['personal:eagle']
      const next = migratePersonalTownLayout(saved, 'town-home', layout, terrain)!
      expect(next.members['personal:eagle']).toEqual({ ...before.members['personal:eagle'],
        ...(boarding ? { formation: { ...formation, position: { ...privateHome }, reached: false } } : {}) })
      expect(next.members['personal:eagle'].mount).toBe(actor.mount)
      expect(next.members['personal:eagle'].position).toBe(actor.position)
      expect(saved).toEqual(before)
      expect(migratePersonalTownLayout(next, 'town-home', layout, terrain)).toBe(next)
    })

  it.each([
    { version: 2, x: -95, z: 65 },
    { version: 3, x: -90, z: 56 },
  ])('migrates a version $version private eagle at its parked home exactly once through storage', ({ version, x, z }) => {
    const profile = createCareerProfile('roman'), saved = personal()
    saved.layoutVersion = version
    saved.members['personal:eagle'].mount!.position = { x, y: 2, z, yaw: Math.PI }
    profile.personalSquadRuntime = saved
    const store = new CareerProfileStore(new MemoryStorage())
    expect(store.save(profile)).toBe(true)
    const loaded = store.load()!
    loaded.personalSquadRuntime = migratePersonalTownLayout(loaded.personalSquadRuntime, 'town-home', layout, terrain)
    expect(store.save(loaded)).toBe(true)
    const restored = store.load()!.personalSquadRuntime!
    expect(restored.layoutVersion).toBe(4)
    expect(restored.members['personal:eagle'].mount).toMatchObject({ hp: 73, position: { x: -70, y: 12, z: 25 } })
    expect(migratePersonalTownLayout(restored, 'town-home', layout, terrain)).toBe(restored)
  })
})


describe('Town garrison parked-home migration', () => {
  const pads = [{ id: 'town-eagle-pad:1', x: -78, z: -63, yaw: 0 }]
  const terrain = () => 5
  function checkpoint(mounted: boolean, version = 3): TownEagleGarrisonState {
    const x = version === 2 ? -95 : -85, z = version === 2 ? -75 : -63
    const pair: TownEaglePairState = {
      riderId: 'town-eagle-rider:1', mountId: 'town-eagle-mount:1', homePadId: 'town-eagle-pad:1',
      duty: mounted ? 'mounted-waiting' : 'standby', hp: 49, ammo: 3, mounted, refitAllowed: true,
      position: { x: mounted ? x : x + 4, y: mounted ? 8 : 5, z, yaw: 0 },
      mount: { hp: 73, position: { x, y: 5, z, yaw: 0 },
        flight: { phase: 'grounded', yaw: 0, pitch: 0, bank: 0, speed: 0, velocity: { x: 0, y: 0, z: 0 } } },
      patrol: { active: true, waypoint: 2, elapsed: 17 }, restRemaining: 4,
    }
    return { version: 1, layoutVersion: version, sceneKey: 'town:roman', pairs: [pair] }
  }

  it.each([{ version: 3, mounted: true }, { version: 2, mounted: false }])(
    'moves only the v$version parked home and its mounted=$mounted rider consistently, once', ({ version, mounted }) => {
      const saved = checkpoint(mounted, version), before = structuredClone(saved)
      const next = migrateTownEagleGarrisonLayout(saved, 'town:roman', pads, terrain)!
      expect(next.pairs[0]).toEqual({ ...before.pairs[0],
        position: { x: mounted ? -78 : -74, y: mounted ? 8 : 5, z: -63, yaw: 0 },
        mount: { ...before.pairs[0].mount, position: { x: -78, y: 5, z: -63, yaw: 0 } } })
      expect(next.layoutVersion).toBe(4)
      expect(saved).toEqual(before)
      expect(migrateTownEagleGarrisonLayout(next, 'town:roman', pads, terrain)).toBe(next)
    })

  it.each([true, false])('preserves every off-base grounded checkpoint field when mounted=%s', mounted => {
    const saved = checkpoint(mounted)
    const pair = saved.pairs[0]
    pair.duty = mounted ? 'mounted-waiting' : 'walking-to-mount'
    // Another pad is not this pair's home; a rider approaching from elsewhere stays put too.
    pair.mount.position = { x: mounted ? -57 : 20, y: 5, z: mounted ? -75 : 30, yaw: .7 }
    pair.position = { x: 21, y: mounted ? 8 : 5, z: 31, yaw: .7 }
    const before = structuredClone(saved)
    const next = migrateTownEagleGarrisonLayout(saved, 'town:roman', pads, terrain)!
    expect(next.pairs[0]).toBe(pair)
    expect(next).toEqual({ ...before, layoutVersion: 4 })
    expect(saved).toEqual(before)
    expect(migrateTownEagleGarrisonLayout(next, 'town:roman', pads, terrain)).toBe(next)
  })
})
