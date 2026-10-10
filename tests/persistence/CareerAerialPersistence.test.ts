import * as THREE from 'three'
import { EaglePadReservations } from '../../src/career/EaglePadReservations'
import { CareerMountController } from '../../src/career/CareerMountController'
import { describe, expect, it, vi } from 'vitest'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { createCareerProfile, claimCareerMission, cloneCareerProfile } from '../../src/career/CareerProfile'
import { createCaptainPatrolCommandMission } from '../../src/career/CaptainMissionCatalog'
import { TownMissionSettlement } from '../../src/town/TownMissionSettlement'
import { captureCareerAerialState, restoreCareerAerialState } from '../../src/career/CareerAerialState'
import { townProfileCheckpoint } from '../helpers/townProfileCheckpoint'
import type { Player } from '../../src/player/Player'
import type { Mount } from '../../src/world/Mount'
import { getTerrainHeight } from '../../src/world/Terrain'
import { createActiveCareerMission } from '../../src/career/CareerMissionState'
import { MemoryStorage } from '../helpers/memoryStorage'
import { purchaseTownMount, townPlayerEntryPoint } from '../../src/town/TownRules'
import { createCareerOutpostLaunch } from '../../src/career/CareerOutpostLaunch'
import { acceptCareerOutpost } from '../../src/career/CareerOutpostMission'
import { TownScene } from '../../src/town/TownScene'
import { careerCheckpointPlayer } from '../helpers/careerCheckpointPlayer'
import type { CareerProfile } from '../../src/career/CareerProfile'
import { clonePersonalMission, emptyPersonalContribution, type PersonalActorCheckpoint, type PersonalSquadMission } from '../../src/career/CareerPersonalSquadMission'
import type { TownEagleDuty, TownEagleGarrisonState } from '../../src/town/TownEagleGarrisonState'
import { migratePersonalTownLayout, migrateTownEagleGarrisonLayout } from '../../src/town/TownLayoutMigration'

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
    const entry = townPlayerEntryPoint()
    expect(player.group.position).toEqual(new THREE.Vector3(entry.x, getTerrainHeight(entry.x, entry.z) + .9, entry.z))
    expect(player.group.rotation.y).toBe(entry.yaw)
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

describe('Career Town layout checkpoint migration', () => {
  // Pure checkpoint/persistence ownership: no materialized NPC, Mount or TownWorld.
  const newPad = { id: 'private-eagle-pad:1', x: -70, z: 25, yaw: Math.PI / 2 }
  const secondPad = { id: 'private-eagle-pad:2', x: -40, z: 25, yaw: Math.PI / 2 }
  const garrisonPad = { id: 'town-eagle-pad:1', x: -70, z: -90, yaw: 0 }
  const layout = { eaglePads: [newPad, secondPad], muster: [
    { x: -90, z: 70, yaw: 0 }, { x: -85, z: 70, yaw: 0 }, { x: -80, z: 70, yaw: 0 },
  ] }
  const terrain = () => 12
  const grounded = { phase: 'grounded' as const, yaw: 0, pitch: 0, bank: 0, speed: 0, velocity: { x: 0, y: 0, z: 0 } }
  const privateHome = { x: -30.686291501015234, y: 2, z: -31.68629150101524, yaw: 0 }
  function garrison(duty: TownEagleDuty = 'standby'): TownEagleGarrisonState {
    return { version: 1, sceneKey: 'town:roman', pairs: [{
      riderId: 'town-eagle-rider:1', mountId: 'town-eagle-mount:1', homePadId: 'town-eagle-pad:1', duty,
      hp: 17, ammo: 7, mounted: duty === 'mounted-waiting', refitAllowed: true,
      position: { x: 4, y: 3, z: 0, yaw: 0 },
      mount: { hp: 63, position: { x: 0, y: 2, z: 0, yaw: 0 }, flight: { ...grounded } },
    }] }
  }
  function personal(actor: Partial<PersonalActorCheckpoint> = {}): PersonalSquadMission {
    return { squadId: 'personal', sceneKey: 'town-home', state: 'ACTIVE', memberIds: ['personal:eagle'],
      contribution: emptyPersonalContribution(), members: { 'personal:eagle': {
        status: 'deployed', hp: 49, ammo: 3, shieldImpact: 2, eaglePadId: 'private-eagle-pad:1',
        position: { x: 0, y: 2, z: 40, yaw: 0 },
        mount: { hp: 73, mounted: false, position: { ...privateHome }, flight: { ...grounded } },
        ...actor,
      } } }
  }

  it.each(['standby', 'walking-to-mount', 'mounted-waiting', 'return-queue', 'returning', 'walking-to-standby'] as const)(
    'moves a living grounded resident in %s to its new identified home without repairing it', duty => {
      const saved = garrison(duty), before = structuredClone(saved)
      const migrated = migrateTownEagleGarrisonLayout(saved, 'town:roman', [garrisonPad], terrain)!
      expect(saved).toEqual(before)
      expect(migrated).toMatchObject({ layoutVersion: 2, pairs: [{ duty, hp: 17, ammo: 7, refitAllowed: true,
        mount: { hp: 63, position: { x: -70, y: 12, z: -90, yaw: 0 }, flight: grounded } }] })
      if (duty === 'standby') expect(migrated.pairs[0].position).toEqual({ x: -66, y: 12, z: -90, yaw: 0 })
      else if (duty === 'mounted-waiting') expect(migrated.pairs[0].position).toEqual({ x: -66, y: 13, z: -90, yaw: 0 })
      else expect(migrated.pairs[0].position).toBe(saved.pairs[0].position)
    },
  )

  it.each(['airborne', 'falling', 'dead-mount', 'dead-rider', 'grounded-sortie'] as const)(
    'keeps the exact %s resident snapshot during migration', condition => {
      const saved = garrison('returning'), pair = saved.pairs[0]
      if (condition === 'airborne') pair.mount.flight = { phase: 'landing', yaw: .7, pitch: -.2, bank: .1, speed: 8, velocity: { x: 5, y: -2, z: 6 } }
      if (condition === 'falling') pair.fall = { active: true, highestFeetY: 37.5, velocity: { x: 4, y: -10, z: 2 } }
      if (condition === 'dead-mount') pair.mount.hp = 0
      if (condition === 'dead-rider') pair.hp = 0
      if (condition === 'grounded-sortie') pair.duty = 'sortie'
      const before = structuredClone(saved)
      const migrated = migrateTownEagleGarrisonLayout(saved, 'town:roman', [garrisonPad], terrain)!
      expect(migrated.layoutVersion).toBe(2)
      expect(migrated.pairs[0]).toBe(pair)
      expect(saved).toEqual(before)
    },
  )

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

  it('uses an existing free-owner allocation for legacy boarding without a pad ID and preserves explicit saved identities', () => {
    const saved = personal({ boarding: true, formation: { commandId: -1001, position: { ...privateHome }, reached: false } })
    delete saved.members['personal:eagle'].eaglePadId
    const pads = new EaglePadReservations(layout.eaglePads)
    pads.reserve('player', 'private-eagle-pad:1')
    pads.reserve('personal:eagle', 'private-eagle-pad:2')
    const migrated = migratePersonalTownLayout(saved, 'town-home', { ...layout, padForMember: id => pads.get(id) }, terrain)!
    expect(migrated.members['personal:eagle']).toMatchObject({ eaglePadId: 'private-eagle-pad:2',
      mount: { position: { x: -40, y: 12, z: 25, yaw: Math.PI / 2 } },
      formation: { position: { x: -40, y: 12, z: 25, yaw: Math.PI / 2 } } })
    expect(pads.get('player')?.id).toBe('private-eagle-pad:1')
    expect(pads.get('personal:eagle')?.id).toBe('private-eagle-pad:2')
    expect(saved.members['personal:eagle'].eaglePadId).toBeUndefined()
    saved.members['personal:eagle'].eaglePadId = 'private-eagle-pad:2'
    const explicit = migratePersonalTownLayout(saved, 'town-home', { ...layout,
      padForMember: () => { throw new Error('Explicit home identity must not consult fallback allocation') } }, terrain)!
    expect(explicit.members['personal:eagle'].eaglePadId).toBe('private-eagle-pad:2')
    expect(explicit.members['personal:eagle'].mount?.position.x).toBe(-40)
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

  it.each(['away-from-home', 'dead-rider', 'dead-mount', 'falling'] as const)(
    'keeps a private %s checkpoint intact', condition => {
      const saved = personal(), actor = saved.members['personal:eagle']
      if (condition === 'away-from-home') actor.mount!.position = { x: 200, y: 2, z: 120, yaw: 0 }
      if (condition === 'dead-rider') { actor.status = 'dead'; actor.hp = 0 }
      if (condition === 'dead-mount') actor.mount!.hp = 0
      if (condition === 'falling') actor.fall = { active: true, highestFeetY: 37.5, velocity: { x: 4, y: -10, z: 2 } }
      const before = structuredClone(saved)
      const migrated = migratePersonalTownLayout(saved, 'town-home', layout, terrain)!
      expect(migrated.members['personal:eagle']).toBe(actor)
      expect(saved).toEqual(before)
    },
  )

  it.each(['runtime', 'field-mission', 'outpost'] as const)(
    'round-trips the %s layout stamp through the real store and cloning so reloading never relocates it again', location => {
      const owner = { ...createCareerProfile('roman'), rank: 'captain' as const, totalMerit: 40000, availableMerit: 30000 }
      const profile = purchaseTownMount(purchaseTownMount(owner, 'xongkoro').profile, 'xongkoro').profile
      profile.personalSquad = { members: [{ id: 'personal:eagle', type: 'ranger', originalHirePrice: 500, equipment: { melee: null, ranged: null, shield: null, mount: 'xongkoro' } }] }
      profile.townCommandSquad = { type: 'town-command', townFaction: 'roman', squadId: 1, actorIds: ['town:training:0'],
        state: 'RETURNING', authorized: false, sceneKey: 'town-home', contribution: emptyPersonalContribution(),
        members: { 'town:training:0': { status: 'deployed', hp: 13, ammo: 2 } } }
      profile.townEagleGarrisons = { roman: garrison(), viking: { ...garrison(), sceneKey: 'town:viking' } }
      const put = (target: CareerProfile, mission: PersonalSquadMission) => {
        if (location === 'runtime') target.personalSquadRuntime = mission
        if (location === 'field-mission') {
          target.activeMission = createActiveCareerMission('recruit-bandits-01', 0, 3, 0, 'layout-resume')
          target.activeMission.personalSquad = mission
        }
        if (location === 'outpost') target.activeOutpostMission = { id: 'layout-resume', kind: 'outpost-defense', stageId: 1, acceptedAt: 0, personalSquad: mission }
      }
      const read = (target: CareerProfile) => target.personalSquadRuntime ?? target.activeMission?.personalSquad ?? target.activeOutpostMission?.personalSquad
      put(profile, personal())
      const store = new CareerProfileStore(new MemoryStorage())
      expect(store.save(profile)).toBe(true)
      const legacy = store.load()!
      expect(read(legacy)!.layoutVersion).toBeUndefined()
      const migrated = cloneCareerProfile(legacy)
      put(migrated, migratePersonalTownLayout(read(legacy), 'town-home', layout, terrain)!)
      migrated.townEagleGarrisons!.roman = migrateTownEagleGarrisonLayout(legacy.townEagleGarrisons!.roman, 'town:roman', [garrisonPad], terrain)
      expect(store.save(migrated)).toBe(true)
      const loaded = store.load()!, mission = read(loaded)!
      expect(mission).toEqual(read(migrated))
      expect(clonePersonalMission(mission)).toEqual(mission)
      expect(loaded.townEagleGarrisons).toEqual(migrated.townEagleGarrisons)
      expect(loaded.townEagleGarrisons!.viking).toEqual(legacy.townEagleGarrisons!.viking)
      expect(loaded.personalSquad).toEqual(profile.personalSquad)
      expect(loaded.townCommandSquad).toEqual(profile.townCommandSquad)
      expect([loaded.totalMerit, loaded.availableMerit, loaded.rank]).toEqual([profile.totalMerit, profile.availableMerit, profile.rank])
      expect(migratePersonalTownLayout(mission, 'town-home', { ...layout, eaglePads: [{ ...newPad, x: -90 }] }, terrain)).toBe(mission)
      const parked = loaded.townEagleGarrisons!.roman!
      expect(migrateTownEagleGarrisonLayout(parked, 'town:roman', [{ ...garrisonPad, x: -90 }], terrain)).toBe(parked)
    },
  )

  it('leaves other scenes and already known future layout versions untouched', () => {
    const squad = personal(), resident = garrison()
    expect(migratePersonalTownLayout(squad, 'town:enemy', layout, terrain)).toBe(squad)
    expect(migrateTownEagleGarrisonLayout(resident, 'town:viking', [garrisonPad], terrain)).toBe(resident)
    squad.layoutVersion = 3; resident.layoutVersion = 3
    expect(migratePersonalTownLayout(squad, 'town-home', layout, terrain)).toBe(squad)
    expect(migrateTownEagleGarrisonLayout(resident, 'town:roman', [garrisonPad], terrain)).toBe(resident)
  })
})
