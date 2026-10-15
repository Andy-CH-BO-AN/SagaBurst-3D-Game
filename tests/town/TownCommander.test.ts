import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HERO_COMBAT_PROFILE_BY_ASSET, HERO_COMBAT_PROFILES } from '../../src/battle/HeroCombatProfile'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { TOWN_NAVIGATION_BOUNDS } from '../../src/town/TownBounds'
import { resolveTownCommanderPosition, shouldSpawnTownCommander, townCommanderHeroAsset, townCommanderSpec } from '../../src/town/TownCommander'
import { townRoadIntersectsBox } from '../../src/town/TownLayout'
import { townActorHeroProfile, townAssaultObjectiveRoster, townCommandSquadRoster, townMilitaryEquipment, townRoster, townSitePoint, TownEvent, withTownCommandSquadRoster } from '../../src/town/TownRules'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { createTownDefenseMission, type ActiveCareerMission } from '../../src/career/CareerMissionState'
import { createMissionCommandAuthority } from '../../src/career/CareerCommandAuthority'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { MemoryStorage } from '../helpers/memoryStorage'
import { townConquestRoster } from '../../src/town/TownHRLayout'
import { eagleLandingFootprint } from '../../src/world/EagleLanding'
import { townCavalryReserveSource } from '../../src/town/TownCavalryReserve'
import { TownWorld } from '../../src/town/TownWorld'
import { TownScene } from '../../src/town/TownScene'
import { getTerrainHeight, resolveObstacleCollision } from '../../src/world/Terrain'

afterEach(() => vi.unstubAllGlobals())

describe('Commander service resident policy', () => {
  it.each([
    ['normal Town', undefined, '', true],
    ['home field mission', 'veteran-field', 'veteran-forest-ambush', true],
    ['T5 Duel', 'duel', 'duel-roman-sword-cavalry-5', true],
    ['Enemy Town Assault', 'enemy-town-assault', 'enemy-town-assault', false],
    ['Veteran VI', 'veteran-field', 'veteran-tragedy-of-the-scouts', false],
    ['Town Defense', 'town-defense', 'veteran-town-defense', false],
  ] satisfies [string, ActiveCareerMission['kind'], string, boolean][])('%s explicitly controls Commander presence and preload', (_name, kind, templateId, expected) => {
    const profile = createCareerProfile('roman')
    if (kind) profile.activeMission = { id: 'mission', templateId, kind, targetCampId: 0,
      phase: 'ENGAGING', targetActorIds: [], friendlyActorIds: [], acceptedAt: 1 }
    expect(shouldSpawnTownCommander(profile)).toBe(expected)
  })

  it.each(['roman', 'viking'] as const)('only a saved matching %s Commander defense membership enables the T5 population', faction => {
    const profile = createCareerProfile(faction); profile.rank = 'commander'; profile.totalMerit = 20000
    const mission = profile.activeMission = createTownDefenseMission(['commander'], [], 'new-defense')
    expect(shouldSpawnTownCommander(profile)).toBe(false)
    mission.officialSquad = createMissionCommandAuthority(mission.id, faction, profile.rank, [], [{ squadId: 2, actorIds: ['commander'] }])
    const store = new CareerProfileStore(new MemoryStorage()); expect(store.save(profile)).toBe(true)
    expect(shouldSpawnTownCommander(store.load()!)).toBe(true)
    for (const change of [
      (p: typeof profile) => { p.rank = 'captain' },
      (p: typeof profile) => { p.activeMission!.officialSquad!.missionId = 'other-defense' },
      (p: typeof profile) => { p.activeMission!.officialSquad!.townFaction = faction === 'roman' ? 'viking' : 'roman' },
      (p: typeof profile) => { p.activeMission!.officialSquad!.squads![0].squadId = 1 },
      (p: typeof profile) => { p.activeMission!.friendlyActorIds = [] },
      (p: typeof profile) => { p.activeMission!.officialSquad!.actorIds = [] },
      (p: typeof profile) => { p.activeMission!.kind = 'enemy-town-assault' },
    ]) {
      const invalid = store.load()!; change(invalid); expect(shouldSpawnTownCommander(invalid)).toBe(false)
    }
    // A casualty remains the same saved resident, so restoring its death never spawns a replacement.
    const casualty = store.load()!; casualty.activeMission!.deadFriendlyActorIds = ['commander']
    casualty.activeMission!.actorHealth = { commander: { hp: 0, mountHp: 0 } }
    expect(shouldSpawnTownCommander(casualty)).toBe(true)
  })

  it.each(['roman', 'viking'] as const)('%s uses its T5 identity with bow and faction melee equipment outside shared military rosters', faction => {
    const commander = townCommanderSpec(townSitePoint('barracks', -10, 2))
    expect(townCavalryReserveSource(commander)).toBeUndefined()
    expect(commander).toMatchObject({ id: 'commander', role: 'commander', duty: 'service', tier: 4, mounted: true, training: false, assaultObjective: false })
    const asset = townCommanderHeroAsset(faction)
    expect(asset).toBe(`${faction}-hero-t5`)
    expect(HERO_COMBAT_PROFILES[HERO_COMBAT_PROFILE_BY_ASSET[asset]].maxHp).toBe(faction === 'roman' ? 850 : 950)
    const equipment = townMilitaryEquipment(faction, commander)
    expect(equipment.level).toBe(4)
    expect(equipment.loadout).toMatchObject({ rangedWeaponId: 'bow_t5',
      meleeWeaponId: faction === 'roman' ? 'paladin_sword_t4' : 'paladin_mace_t4', shieldId: null, reversibleRangedSwitch: true })
    expect(townMilitaryEquipment(faction, 'captain').loadout.rangedWeaponId).toBeNull()
    expect(townMilitaryEquipment(faction, 'captain').loadout.shieldId).toBe('paladin_shield_t4')
    expect(townActorHeroProfile(faction, commander)?.mountOverride).toBe(faction === 'roman' ? 'corgi' : 'black-cat')
    const shared = townRoster(), normalTown = [...shared, commander]
    expect(shared.some(actor => actor.id === 'commander')).toBe(false)
    expect(new Set(normalTown.map(actor => actor.id)).size).toBe(normalTown.length)
    expect(townAssaultObjectiveRoster(normalTown)).toEqual(townAssaultObjectiveRoster(shared))
    expect(townCommandSquadRoster(faction, normalTown)).toEqual(townCommandSquadRoster(faction, shared))
    expect(townCommandSquadRoster(faction, normalTown)).toHaveLength(30)
  })
})

describe('Commander TownEvent registration', () => {
  it('atomically admits and rolls back post-defense residents without changing the original roster', () => {
    const event = new TownEvent([{ id: 'captain' }]), captain = { dead: true }
    event.register('captain', captain); event.complete(); event.hostile = true
    expect(event.evaluate(false)).toBe('town_defeated')
    const commander = { dead: false }
    event.registerAdditionalResident('commander', commander)
    expect(event.registrationComplete).toBe(true)
    expect(event.allActors.size).toBe(2); expect(event.actors.size).toBe(2)
    expect(event.evaluate(false)).toBeNull()
    expect(() => event.registerAdditionalResident('commander', { dead: true })).toThrow('Duplicate')
    expect(event.actors.get('commander')).toBe(commander)
    event.unregisterAdditionalResident('captain')
    expect(event.actors.get('captain')).toBe(captain)
    event.unregisterAdditionalResident('commander')
    expect(event.allActors.has('commander')).toBe(false)
    expect(event.actors.has('commander')).toBe(false)
    expect(event.evaluate(false)).toBe('town_defeated')
    event.registerAdditionalResident('commander', commander)
    expect(event.evaluate(false)).toBeNull()
    commander.dead = true
    expect(event.evaluate(false)).toBe('town_defeated')
  })
  it('registers the opt-in service resident once and includes it in free Town population settlement', () => {
    const roster = [...townRoster(), townCommanderSpec(townSitePoint('barracks', -10, 2))]
    const event = new TownEvent(roster), commander = { dead: false }
    // Cheap state objects only: this verifies registration/objectives, not combat.
    for (const spec of roster) event.register(spec.id, spec.id === 'commander' ? commander : { dead: true })
    event.complete(); event.hostile = true
    expect(event.registrationComplete).toBe(true)
    expect(event.allActors.size).toBe(roster.length)
    expect(event.evaluate(false)).toBeNull()
    commander.dead = true
    expect(event.evaluate(false)).toBe('town_defeated')
  })
})

describe('Commander Town Center placement', () => {
  // Actual built geometry is necessary here: faction buildings and colliders are
  // the failure mode. No NPC, Mount or GLB actors are constructed.
  it.each(['roman', 'viking'] as const)('%s places the mounted Commander 5–7m beside Captain on the service side with a collider-clear E approach', faction => {
    const context = new Proxy<Record<PropertyKey, unknown>>({ measureText: () => ({ width: 100 }) }, { get: (target, key) => target[key] ?? (() => {}) })
    vi.stubGlobal('ImageData', class { constructor(public data: unknown, public width: number, public height: number) {} })
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => context }) })
    const world = new TownWorld(faction, new THREE.Scene())
    try {
      const navigation = new NavigationWorld(TOWN_NAVIGATION_BOUNDS); navigation.sync(world.obstacles)
      const roster = townConquestRoster(world.hr, withTownCommandSquadRoster(faction, townRoster()), world.eagleTraining, world.eagleGarrison)
      const point = resolveTownCommanderPosition(world.obstacles, world.roads, navigation, roster)
      const bounds = new THREE.Box3(new THREE.Vector3(point.x - 2.5, -1000, point.z - 2.5), new THREE.Vector3(point.x + 2.5, 1000, point.z + 2.5))
      expect(world.obstacles.some(obstacle => obstacle.box.intersectsBox(bounds))).toBe(false)
      // The civic plaza hosts the services; transit roads remain unobstructed.
      expect(world.roads.filter(road => !(road.ax === 32 && road.az === 12 && road.bx === 74 && road.width === 32))
        .some(road => townRoadIntersectsBox(road, bounds, 1))).toBe(false)
      for (const pad of [...world.eagleTraining.pads, ...world.eagleGarrison.pads]) expect(eagleLandingFootprint(pad).intersectsBox(bounds), pad.id).toBe(false)
      for (const slot of world.hr.muster) expect(Math.hypot(slot.x - point.x, slot.z - point.z)).toBeGreaterThan(5)
      expect(navigation.areConnected(townSitePoint('hall', 0, 30), point)).toBe(true)
      const captain = roster.find(actor => actor.id === 'captain')!
      const separation = Math.hypot(point.x - captain.x, point.z - captain.z)
      expect(separation).toBeGreaterThanOrEqual(5)
      expect(separation).toBeLessThanOrEqual(7)
      expect(point.x).toBeLessThanOrEqual(captain.x)
      expect(point.z).toBeGreaterThanOrEqual(captain.z)
      // The complete mounted envelope is in the forecourt, ahead of the hall.
      expect(bounds.min.z).toBeGreaterThan(-12)
      expect(point).toMatchObject({ x: 38, z: -2 })

      // Follow the actual entrance and west-side walking passage using the
      // runtime Player capsule collision resolver (0 NPC/Mount constructors).
      const position = new THREE.Vector3(29, getTerrainHeight(29, 16) + .95, 16)
      for (const destination of [{ x: 21, z: 16 }, { x: 21, z: point.z }, { x: point.x - 2, z: point.z }]) {
        const start = position.clone(), steps = Math.ceil(Math.hypot(destination.x - start.x, destination.z - start.z) / .2)
        for (let step = 1; step <= steps; step++) {
          const previous = position.clone()
          position.set(THREE.MathUtils.lerp(start.x, destination.x, step / steps), 0,
            THREE.MathUtils.lerp(start.z, destination.z, step / steps))
          position.y = getTerrainHeight(position.x, position.z) + .95
          const expected = position.clone()
          resolveObstacleCollision(position, previous, 0, true, .38, 1.9, .95, world.obstacles)
          expect(position.distanceTo(expected), `entrance approach step ${step}`).toBeLessThan(.001)
          for (const resident of [captain, point]) expect(Math.hypot(position.x - resident.x, position.z - resident.z))
            .toBeGreaterThan(1.38) // mounted collider + Player capsule
        }
      }
      let openedFor: string | null = null
      const town = Object.assign(Object.create(TownScene.prototype) as { interaction(): void; key(event: KeyboardEvent): void }, {
        profile: createCareerProfile(faction), world, panel: null,
        player: { dead: false, isMounted: false, isFalling: false, currentMount: null,
          position, combatPosition: position, facingYaw: Math.PI / 2 },
        event: { hostile: false, allActors: new Map() }, defense: { active: false, servicesLocked: false },
        careerMounts: { activeMount: null }, temporaryMounts: { all: [] }, outskirts: { mounts: [] },
        residents: roster.concat(townCommanderSpec(point)).map(spec => ({ spec,
          npc: { combatPosition: new THREE.Vector3(spec.x, getTerrainHeight(spec.x, spec.z), spec.z) } })),
        cat: { group: { position: new THREE.Vector3(-100, 0, -100) } },
        hint: { textContent: '', style: { display: '' } }, equipment: { visible: false },
        personalCommands: { isFormationPlacementMode: false }, talk(id: string) { openedFor = id },
      })
      town.interaction()
      town.key({ code: 'KeyE', repeat: false, preventDefault() {}, stopImmediatePropagation() {} } as KeyboardEvent)
      expect(openedFor).toBe('commander')
      for (const spec of roster) expect(Math.hypot(spec.x - point.x, spec.z - point.z), spec.id).toBeGreaterThanOrEqual(spec.mounted ? 5 : 3)
    } finally { world.dispose() }
  })

  it('anchors to the actual Captain position and facing rather than the barracks landmark', () => {
    const captain = { ...townRoster().find(spec => spec.id === 'captain')!, x: -40, z: -40, yaw: 0 }
    const point = resolveTownCommanderPosition([], [], { areConnected: () => true }, [captain])
    expect(point).toEqual({ x: -46, z: -40, yaw: 0 })
    expect(() => resolveTownCommanderPosition([], [], { areConnected: () => true }, [])).toThrow('No Captain anchor')
  })

  it('searches past an occupied first slot and rejects an entirely blocked or disconnected entrance', () => {
    const roster = townRoster(), navigation = { areConnected: () => true }
    const first = resolveTownCommanderPosition([], [], navigation, roster)
    const occupied = [...roster, { ...townCommanderSpec(first), id: 'occupied-service' }]
    expect(resolveTownCommanderPosition([], [], navigation, occupied)).not.toEqual(first)
    const obstacle = { box: new THREE.Box3(new THREE.Vector3(-100, -1000, -100), new THREE.Vector3(100, 1000, 100)), isBarricade: false }
    expect(() => resolveTownCommanderPosition([obstacle], [], navigation, roster)).toThrow('No clear Commander')
    const blockedForecourt = { ...obstacle, box: obstacle.box.clone() }
    blockedForecourt.box.min.z = -3.5 // Only the hall side remains open.
    expect(() => resolveTownCommanderPosition([blockedForecourt], [], navigation, roster)).toThrow('No clear Commander')
    expect(() => resolveTownCommanderPosition([], [], { areConnected: () => false }, roster)).toThrow('No clear Commander')
  })
})
