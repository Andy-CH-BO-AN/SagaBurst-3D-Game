import * as THREE from 'three'
import { EaglePadReservations } from '../../src/career/EaglePadReservations'
import { CareerMountController } from '../../src/career/CareerMountController'
import { describe, expect, it, vi } from 'vitest'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { createCareerProfile, claimCareerMission } from '../../src/career/CareerProfile'
import { createCaptainPatrolCommandMission } from '../../src/career/CaptainMissionCatalog'
import { TownMissionSettlement } from '../../src/town/TownMissionSettlement'
import { captureCareerAerialState, restoreCareerAerialState } from '../../src/career/CareerAerialState'
import { townProfileCheckpoint } from '../helpers/townProfileCheckpoint'
import type { Player } from '../../src/player/Player'
import type { Mount } from '../../src/world/Mount'
import { getTerrainHeight } from '../../src/world/Terrain'
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
  it.each(['flight', 'fall'] as const)('Captain direct return commits grounded Town before resetting a live %s and reload cannot restore the old position', state => {
    // Real settlement + Town commit + storage + aerial restore boundaries; zero materialized actors.
    const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
    let profile = createCareerProfile('roman')
    profile.activeMission = createCaptainPatrolCommandMission(profile, ['town-patrol:a:captain'], 'ground-return')
    const stats = { damageDealt: 0, damageTaken: 0, kills: 30, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: true }
    profile = claimCareerMission(profile, 'ground-return', 'victory', stats).profile
    const town = townProfileCheckpoint(profile, store), player = { ...careerCheckpointPlayer(),
      isFalling: state === 'fall', fallSnapshot: { active: true as const, highestFeetY: 90, velocity: { x: 3, y: -10, z: 1 } },
      resetForScene: vi.fn((x: number, y: number, z: number) => {
        // The saved transaction must already be grounded while the live Player is still airborne.
        expect(store.load()!.playerAerialState).toBeUndefined()
        expect(player.group.position.y).toBe(80)
        player.currentMount = null; player.isFalling = false; player.group.position.set(x, y, z)
      }) }
    player.group.position.set(180, 80, 190)
    if (state === 'flight') player.currentMount = { isAirborne: true, dead: false, currentHp: 100,
      group: new THREE.Group(), flight: { snapshot: () => ({ phase: 'cruise', yaw: 0, pitch: 0, bank: 0, speed: 10, velocity: { x: 0, y: 0, z: 10 } }) } } as unknown as Mount
    town.player = player
    expect(town.commit(profile)).toBe(true)
    expect(store.load()!.playerAerialState?.position.y).toBe(80)
    const source = { actors: [], friendlies: [], snapshot: () => ({ player: stats, squads: [] }), cleanupMission: vi.fn() }
    const settlement = new TownMissionSettlement({ read: () => town.profile, commit: (next, options) => town.commit(next, options) }, {
      field: source, duel: source, defense: { ...source, active: undefined, civilianSurvived: 0, civilianDeaths: 0 },
      patrol: { actors: [], release: vi.fn(), statsSnapshot: { player: stats, squads: [] } },
    }, { residents: [], cat: { restoreForTown: vi.fn(), catVisual: null }, player,
      world: { obstacles: [], restoreTownDamage: vi.fn() }, navigation: { sync: vi.fn() }, inventory: { sheathAll: vi.fn() },
      releaseExternalThreat: vi.fn(), clearCombatShots: vi.fn(), restPlayer: vi.fn(), restart: vi.fn() })
    storage.writable = false
    expect(settlement.returnToTown('direct').status).toBe('save-failed')
    expect(player.resetForScene).not.toHaveBeenCalled(); expect(player.group.position.y).toBe(80)
    storage.writable = true
    expect(settlement.returnToTown('direct').status).toBe('returned')
    expect(player.resetForScene).toHaveBeenCalledOnce()
    const loaded = store.load()!
    expect(loaded.activeMission).toBeUndefined(); expect(loaded.playerAerialState).toBeUndefined()
    expect(loaded.totalMerit).toBe(profile.totalMerit)
    expect(captureCareerAerialState(player as unknown as Player, 'town-home')).toBeUndefined()
    expect(restoreCareerAerialState(player as unknown as Player, null, loaded.playerAerialState, 'town-home')).toBe(false)
    expect(player.group.position).toEqual(new THREE.Vector3(0, getTerrainHeight(0, 9) + .9, 9))
  })
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
    const pads = new EaglePadReservations([1, 2, 3].map(index => ({ id: `private-eagle-pad:${index}`, x: index * 30, z: 0, yaw: 0 })))
    // Construction restores reservations before any actors exist; the Player getter is not consumed.
    new CareerMountController(new THREE.Scene(), () => { throw new Error('Unexpected Player access') }, () => loaded, () => false, () => [], () => [], () => 'town-home', { eaglePads: pads })
    expect(pads.get('personal:eagle-ranger')?.id).toBe('private-eagle-pad:3')
    expect(pads.get('player')?.id).toBe('private-eagle-pad:1')
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
