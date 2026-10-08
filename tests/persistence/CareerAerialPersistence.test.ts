import { describe, expect, it } from 'vitest'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { createActiveCareerMission } from '../../src/career/CareerMissionState'
import { MemoryStorage } from '../helpers/memoryStorage'
import { purchaseTownMount } from '../../src/town/TownRules'
import { createCareerOutpostLaunch } from '../../src/career/CareerOutpostLaunch'
import { acceptCareerOutpost } from '../../src/career/CareerOutpostMission'
import { TownScene } from '../../src/town/TownScene'
import { careerCheckpointPlayer } from '../helpers/careerCheckpointPlayer'
import type { CareerProfile } from '../../src/career/CareerProfile'

interface SoloTownCheckpoint {
  profile: CareerProfile
  player: ReturnType<typeof careerCheckpointPlayer> & { fallSnapshot: { active: true; highestFeetY: number; velocity: { x: number; y: number; z: number } } }
  personalSaveElapsed: number
  personalCriticalState: string
  commit(next: CareerProfile): boolean
  persistPersonalSquad(dt: number, force?: boolean): void
}

describe('Career airborne state serialization', () => {
  it('the real town checkpoint caller saves solo pending falls and clears them after landing without a private squad', () => {
    // Data-only Player/persistence boundary: no NPC, Mount, Player constructor or TownWorld.
    const store = new CareerProfileStore(new MemoryStorage())
    const player = { ...careerCheckpointPlayer(), isFalling: true,
      fallSnapshot: { active: true as const, highestFeetY: 38.25, velocity: { x: 3, y: -12, z: 1 } } }
    player.group.position.set(10, 27, 30)
    const town = Object.assign(Object.create(TownScene.prototype) as SoloTownCheckpoint, {
      profile: createCareerProfile('roman'), player, personalSaveElapsed: 0, personalCriticalState: '',
      commit(next: CareerProfile) { if (!store.save(next)) return false; town.profile = next; return true },
    })
    town.persistPersonalSquad(0, true)
    expect(store.load()?.playerAerialState).toMatchObject({ sceneKey: 'town-home', position: { x: 10, y: 27, z: 30 }, fall: player.fallSnapshot })
    player.isFalling = false
    town.persistPersonalSquad(0, true)
    expect(store.load()?.playerAerialState).toBeUndefined()
  })
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
      members: { 'personal:eagle-ranger': { status: 'deployed', hp: 62, position: { x: 25, y: 48, z: 30, yaw: .4 },
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

  it.each(['roman', 'viking'] as const)('carries the canonical eagle ID into a normal %s Outpost launch after reload', faction => {
    const profile = purchaseTownMount({ ...createCareerProfile(faction), rank: 'captain', totalMerit: 20000, availableMerit: 10000 }, 'xongkoro').profile
    const mission = acceptCareerOutpost(profile, 1, 'eagle-outpost')!
    const store = new CareerProfileStore(new MemoryStorage()); expect(store.save(mission)).toBe(true)
    expect(createCareerOutpostLaunch(store.load()!).playerLoadout).toMatchObject({ mountId: 'xongkoro', startMounted: true })
  })
})
