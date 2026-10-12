import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HERO_COMBAT_PROFILE_BY_ASSET, HERO_COMBAT_PROFILES } from '../../src/battle/HeroCombatProfile'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { TOWN_NAVIGATION_BOUNDS } from '../../src/town/TownBounds'
import { resolveTownCommanderPosition, shouldSpawnTownCommander, townCommanderHeroAsset, townCommanderSpec } from '../../src/town/TownCommander'
import { townRoadIntersectsBox } from '../../src/town/TownLayout'
import { townAssaultObjectiveRoster, townCommandSquadRoster, townMilitaryEquipment, townRoster, townSitePoint, TownEvent, withTownCommandSquadRoster } from '../../src/town/TownRules'
import { createCareerProfile } from '../../src/career/CareerProfile'
import type { ActiveCareerMission } from '../../src/career/CareerMissionState'
import { townConquestRoster } from '../../src/town/TownHRLayout'
import { eagleLandingFootprint } from '../../src/world/EagleLanding'
import { townCavalryReserveSource } from '../../src/town/TownCavalryReserve'
import { TownWorld } from '../../src/town/TownWorld'

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

  it.each(['roman', 'viking'] as const)('%s uses its T5 identity with legal T4 equipment outside shared military rosters', faction => {
    const commander = townCommanderSpec(townSitePoint('barracks', -10, 2))
    expect(townCavalryReserveSource(commander)).toBeUndefined()
    expect(commander).toMatchObject({ id: 'commander', role: 'commander', duty: 'service', tier: 4, mounted: false, training: false, assaultObjective: false })
    const asset = townCommanderHeroAsset(faction)
    expect(asset).toBe(`${faction}-hero-t5`)
    expect(HERO_COMBAT_PROFILES[HERO_COMBAT_PROFILE_BY_ASSET[asset]].maxHp).toBe(faction === 'roman' ? 850 : 950)
    const equipment = townMilitaryEquipment(faction, commander)
    expect(equipment.level).toBe(4)
    expect(equipment.loadout).toEqual({ ...townMilitaryEquipment(faction, 'captain').loadout, mountId: null })
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

describe('Commander training entrance placement', () => {
  // Actual built geometry is necessary here: faction buildings and colliders are
  // the failure mode. No NPC, Mount or GLB actors are constructed.
  it.each(['roman', 'viking'] as const)('%s has a separate connected service spot clear of real obstacles, roads and resident slots', faction => {
    const context = new Proxy<Record<PropertyKey, unknown>>({ measureText: () => ({ width: 100 }) }, { get: (target, key) => target[key] ?? (() => {}) })
    vi.stubGlobal('ImageData', class { constructor(public data: unknown, public width: number, public height: number) {} })
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => context }) })
    const world = new TownWorld(faction, new THREE.Scene())
    try {
      const navigation = new NavigationWorld(TOWN_NAVIGATION_BOUNDS); navigation.sync(world.obstacles)
      const roster = townConquestRoster(world.hr, withTownCommandSquadRoster(faction, townRoster()), world.eagleTraining, world.eagleGarrison)
      const point = resolveTownCommanderPosition(world.obstacles, world.roads, navigation, roster)
      const bounds = new THREE.Box3(new THREE.Vector3(point.x - 1.5, -1000, point.z - 1.5), new THREE.Vector3(point.x + 1.5, 1000, point.z + 1.5))
      expect(world.obstacles.some(obstacle => obstacle.box.intersectsBox(bounds))).toBe(false)
      expect(world.roads.some(road => townRoadIntersectsBox(road, bounds, 1))).toBe(false)
      for (const pad of [...world.eagleTraining.pads, ...world.eagleGarrison.pads]) expect(eagleLandingFootprint(pad).intersectsBox(bounds), pad.id).toBe(false)
      for (const slot of world.hr.muster) expect(Math.hypot(slot.x - point.x, slot.z - point.z)).toBeGreaterThan(5)
      expect(navigation.areConnected(townSitePoint('barracks', 0, 15), point)).toBe(true)
      const captain = roster.find(actor => actor.id === 'captain')!
      expect(Math.hypot(point.x - captain.x, point.z - captain.z)).toBeLessThan(20)
      for (const spec of roster) expect(Math.hypot(spec.x - point.x, spec.z - point.z), spec.id).toBeGreaterThanOrEqual(spec.mounted ? 5 : 3)
    } finally { world.dispose() }
  })

  it('searches past an occupied first slot and rejects an entirely blocked or disconnected entrance', () => {
    const roster = townRoster(), navigation = { areConnected: () => true }
    const first = resolveTownCommanderPosition([], [], navigation, roster)
    const occupied = [...roster, { ...townCommanderSpec(first), id: 'occupied-service' }]
    expect(resolveTownCommanderPosition([], [], navigation, occupied)).not.toEqual(first)
    const obstacle = { box: new THREE.Box3(new THREE.Vector3(-100, -1000, -100), new THREE.Vector3(100, 1000, 100)), isBarricade: false }
    expect(() => resolveTownCommanderPosition([obstacle], [], navigation, roster)).toThrow('No clear Commander')
    expect(() => resolveTownCommanderPosition([], [], { areConnected: () => false }, roster)).toThrow('No clear Commander')
  })
})
