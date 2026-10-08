import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCareerProfile, enlistmentMerit } from '../../src/career/CareerProfile'
import { CareerProfileStore, parseCareerProfile } from '../../src/career/CareerProfileStore'
import { careerTownSceneRoster, resolveCareerTownSceneContext } from '../../src/career/CareerFieldSceneContext'
import { createEnemyTownAssaultMission } from '../../src/career/EnemyTownAssault'
import { createActiveCareerMission } from '../../src/career/CareerMissionState'
import { initialPersonalEquipment } from '../../src/career/CareerInventory'
import { TownEvent, townRoster, townAssaultObjectiveRoster } from '../../src/town/TownRules'
import { resolveTownHRLayout, townConquestRoster } from '../../src/town/TownHRLayout'
import { TownWorld } from '../../src/town/TownWorld'
import { Faction } from '../../src/combat/CombatFaction'
import { createTownCombatFixture } from '../helpers/townCombatFixture'
import { installFakeCanvasEnvironment } from '../helpers/threeTestEnvironment'
import { MemoryStorage } from '../helpers/memoryStorage'

const layout = resolveTownHRLayout('roman', [], [])
const population = townConquestRoster(layout)
afterEach(() => vi.unstubAllGlobals())

function eventWithSurvivors(survivors: readonly string[] = []) {
  const event = new TownEvent(population)
  for (const spec of population) event.register(spec.id, { dead: !survivors.includes(spec.id) })
  event.complete(); event.hostile = true
  return event
}

function savedTown() {
  const store = new CareerProfileStore(new MemoryStorage())
  const profile = createCareerProfile('roman')
  profile.totalMerit = 22000; profile.availableMerit = 180; profile.rank = 'commander'
  profile.townEvent = { id: 'conquest', state: 'hostile' }
  const event = new TownEvent(population)
  const actor = () => ({ dead: false, takeDamage() { this.dead = true } })
  const cat = actor()
  const residents = careerTownSceneRoster(profile, population).map(entry => ({ spec: entry.spec, npc: actor() }))
  event.register('cat', cat)
  residents.forEach(resident => event.register(resident.spec.id, resident.npc))
  event.complete()
  const town = Object.assign(createTownCombatFixture(), {
    profile, store, event, cat, residents, world: { buildings: [] },
    skills: { skillState: profile.skills }, clearCareerSkillSaveTimer: vi.fn(),
    player: { dead: false }, equipment: { visible: false }, panel: null,
    inventory: { restoreForHostile: vi.fn() }, closePanel: vi.fn(),
    patrol: { stopForHostility: vi.fn() }, onRestart: vi.fn(), dispose: vi.fn(),
  })
  residents.forEach(resident => Object.assign(resident.npc, { beginTownHostility: vi.fn() }))
  return { town, store }
}

describe('canonical free Town conquest population', () => {
  it('assembles Roman residents and expected IDs from the actual built HR layout, even at Recruit', () => {
    const faction = 'roman'
    const context = new Proxy({ measureText: () => ({ width: 100 }) }, { get: (target, key) => (target as any)[key] ?? (() => {}) })
    const cleanupCanvas = installFakeCanvasEnvironment({
      context,
      imageData: class { constructor(public data: unknown, public width: number, public height: number) {} },
    })
    const world = new TownWorld(faction, new THREE.Scene())
    try {
      const profile = createCareerProfile(faction), roster = townConquestRoster(world.hr)
      const entries = careerTownSceneRoster(profile, roster), event = new TownEvent(roster)
      expect(roster).toHaveLength(townRoster().length + 1)
      expect(roster).toHaveLength(226) // Current composition check only; runtime never uses this number.
      expect(new Set(roster.map(spec => spec.id)).size).toBe(roster.length)
      expect(roster.find(spec => spec.id === 'hr-officer')).toMatchObject(world.hr.officer)
      expect(entries.filter(entry => entry.spec.id === 'hr-officer')).toHaveLength(1)
      expect(entries.find(entry => entry.spec.id === 'hr-officer')).toMatchObject({ allegiance: Faction.TOWN, borrowed: false })
      expect(entries.some(entry => entry.spec.id === 'cat')).toBe(false)
      event.register('cat', { dead: true })
      entries.forEach(entry => event.register(entry.spec.id, { dead: true }))
      event.complete(); event.hostile = true
      expect(event.actors.size).toBe(roster.length); expect(event.evaluate(false)).toBe('town_defeated')
      expect(() => event.register('hr-officer', { dead: true })).toThrow('Duplicate town actor')
    } finally { world.dispose(); cleanupCanvas() }
  })

  it('automatically requires a newly added formal resident without an objective flag', () => {
    const added = { ...townRoster()[0], id: 'new-formal-resident' }
    const roster = townConquestRoster(layout, [...townRoster(), added]), event = new TownEvent(roster)
    roster.forEach(spec => event.register(spec.id, { dead: spec.id !== added.id }))
    event.complete(); event.hostile = true
    expect(event.actors.size).toBe(townRoster().length + 2); expect(event.evaluate(false)).toBeNull()
    event.actors.get(added.id)!.dead = true; expect(event.evaluate(false)).toBe('town_defeated')
    expect(() => townConquestRoster(layout, [...townRoster(), added, added])).toThrow('Duplicate')
    expect(() => townConquestRoster(layout, population)).toThrow('Duplicate')
  })

  it('excludes player, personal heroes, mounts, outside enemies, temporary units and structures by identity', () => {
    const event = eventWithSurvivors()
    for (const id of ['player', 'personal:captain', 'personal:ranger', 'personal:mount', 'stable:horse',
      'captain:mount', 'hr-officer:mount', 'town-patrol:a:captain:mount', 'bandit', 'roaming-enemy',
      'mission:temporary', 'hr-center', 'wall', 'gate', 'house', 'unrecruited-hr-soldier']) {
      event.register(id, { dead: false })
      expect(event.actors.has(id)).toBe(false)
    }
    expect(event.actors.has('cat')).toBe(true)
    expect(event.evaluate(false)).toBe('town_defeated')
  })

  it('keeps Enemy Town Assault objectives and missionOnlyResidents independent of conquest HR and cat', () => {
    const profile = createCareerProfile('roman'), assault = createEnemyTownAssaultMission('assault')
    const before = townAssaultObjectiveRoster().map(spec => spec.id)
    const entries = careerTownSceneRoster({ ...profile, activeMission: assault }, population)
    expect(entries.find(entry => entry.spec.id === 'hr-officer')?.allegiance).toBe(Faction.TOWN)
    expect(townAssaultObjectiveRoster(population).map(spec => spec.id)).toEqual(before)
    expect(assault.targetActorIds).toEqual(before)
    const foreign = { ...profile, activeMission: { ...createActiveCareerMission('veteran-tragedy-of-the-scouts', 0, 0, 0), kind: 'veteran-field' as const } }
    expect(resolveCareerTownSceneContext(foreign).missionOnlyResidents).toBe(true)
    expect(careerTownSceneRoster(foreign, population).some(entry => entry.spec.role === 'hr-officer' || entry.spec.role === 'cat')).toBe(false)
  })
})

describe('full population conquest outcomes and registration', () => {
  it('does not win after killing the old 85 principals', () => {
    const oldPrincipals = townRoster().filter(spec => spec.duty === 'civilian' || spec.duty === 'service' || spec.training && !spec.mounted)
    expect(oldPrincipals).toHaveLength(85)
    const oldIds = new Set(oldPrincipals.map(spec => spec.id))
    expect(eventWithSurvivors(population.filter(spec => !oldIds.has(spec.id)).map(spec => spec.id)).evaluate(false)).toBeNull()
  })
  it('requires the last living formal resident before declaring town defeat', () => {
    // The outcome rule is identity-independent; full roster membership and registration are tested above.
    const id = 'gate:east:0'
    const event = eventWithSurvivors([id])
    expect(event.evaluate(false)).toBeNull()
    event.actors.get(id)!.dead = true
    expect(event.evaluate(false)).toBe('town_defeated')
    expect(event.evaluate(true)).toBe('player_defeated')
  })
  it('requires hostility and player survival even when personal allies finish the town later', () => {
    const event = eventWithSurvivors(['hr-officer'])
    event.hostile = false; expect(event.evaluate(true)).toBeNull()
    event.hostile = true; expect(event.evaluate(true)).toBe('player_defeated')
    event.actors.get('hr-officer')!.dead = true
    expect(event.evaluate(true)).toBe('player_defeated')
  })
  it.each(['hr-officer', 'cat', 'gate:east:0', 'town-patrol:a:captain'])('rejects missing registration %s and never treats it as a death', id => {
    const event = new TownEvent(population); event.hostile = true
    population.filter(spec => spec.id !== id).forEach(spec => event.register(spec.id, { dead: true }))
    expect(event.evaluate(false)).toBeNull(); expect(() => event.complete()).toThrow(id)
    expect(event.registrationComplete).toBe(false)
    event.register(id, { dead: true }); expect(event.evaluate(false)).toBeNull()
    event.complete(); expect(event.evaluate(false)).toBe('town_defeated')
    event.actors.delete(id); expect(event.evaluate(false)).toBeNull()
  })
  it('rejects empty or duplicate expected identities', () => {
    expect(() => new TownEvent([])).toThrow('Invalid')
    expect(() => new TownEvent([population[0], population[0]])).toThrow('Invalid')
  })
})

describe('hostile save migration and settlement retries', () => {
  it.each(['legacy', 'current'] as const)('restores the %s hostile save against the full roster and retains recorded identities', version => {
    const { town, store } = savedTown()
    const deadActorIds = version === 'legacy' ? ['captain', 'civilian-0']
      : ['hr-officer', 'gate:east:0', 'town-patrol:a:captain', 'cavalry-training:melee_cavalry:0', 'cat']
    town.profile.townEvent.deadActorIds = deadActorIds
    expect(store.save(town.profile)).toBe(true); town.profile = store.load()!
    town.restoreTownCasualties(); town.activateHostility(false)
    expect(town.event.hostile).toBe(true); expect(town.event.actors.size).toBe(population.length)
    expect([...town.event.actors].filter(([, actor]) => actor.dead).map(([id]) => id).sort()).toEqual([...deadActorIds].sort())
    expect(town.event.evaluate(false)).toBeNull()
    expect(town.residents.every((resident: any) => resident.npc.beginTownHostility.mock.calls.length === 1)).toBe(true)
    expect(town.patrol.stopForHostility).toHaveBeenCalledOnce()
    const hr = town.event.actors.get('hr-officer')!
    if (version === 'legacy') expect(hr.dead).toBe(false)
    hr.dead = true; town.persistCasualties()
    expect(store.load()!.townEvent!.deadActorIds).toEqual(expect.arrayContaining([...deadActorIds, 'hr-officer']))
    town.persistCasualties(); expect(town.profile.townEvent.deadActorIds.length).toBe(new Set([...deadActorIds, 'hr-officer']).size)
  })
  it.each(['town_defeated', 'player_defeated'] as const)('saves %s once after retry and only then permits transition', result => {
    const { town, store } = savedTown()
    town.profile.personalSquad = { members: [{ id: 'personal:permanent', type: 'soldier', originalHirePrice: 50,
      equipment: initialPersonalEquipment('soldier', 'roman') }] }
    town.profile.inventory = { version: 1, quantities: { gladius_rusty: 2,
      ...Object.fromEntries(Object.values(initialPersonalEquipment('soldier', 'roman')).filter(Boolean).map(id => [id, 1])) } }
    town.profile.skills = { ...town.profile.skills, ranged: { level: 4, xp: 20 } }
    town.profile.claimedBattleIds = ['historical-battle']
    town.profile = parseCareerProfile(town.profile)!
    town.skills.skillState = town.profile.skills
    const before = JSON.stringify(town.profile), original = JSON.parse(before), restartButtons: Array<() => void> = []
    town.openPanel = vi.fn(() => ({}))
    town.button = vi.fn((_panel: unknown, _label: string, callback: () => void) => restartButtons.push(callback))
    const save = vi.spyOn(store, 'save').mockReturnValueOnce(false)
    town.finish(result)
    expect(JSON.stringify(town.profile)).toBe(before); expect(town.onRestart).not.toHaveBeenCalled()
    expect(town.profile.faction).toBe('roman')
    restartButtons.shift()!() // Retry the real TownScene commit and settlement path.
    const next = store.load()!
    expect(next.townEvent?.state).toBe('settled'); expect(next.townEvent?.result).toBe(result)
    expect(next.faction).toBe(result === 'town_defeated' ? 'viking' : 'roman')
    expect(next.availableMerit).toBe(result === 'town_defeated' ? 180 : 80)
    expect(next.totalMerit).toBe(22000); expect(next.personalSquad).toEqual(original.personalSquad)
    expect(next.skills).toEqual(original.skills); expect(next.ownedWeapons).toEqual(original.ownedWeapons)
    expect(next.inventory).toEqual(original.inventory); expect(next.lifetimeStats).toEqual(original.lifetimeStats)
    expect(next.claimedBattleIds).toEqual(['historical-battle'])
    if (result === 'town_defeated') { expect(next.rank).toBe('recruit'); expect(enlistmentMerit(next)).toBe(0) }
    town.finish(result); expect(save).toHaveBeenCalledTimes(2)
    restartButtons.shift()!(); expect(town.onRestart).toHaveBeenCalledExactlyOnceWith(town.profile)
    expect(town.dispose).toHaveBeenCalledOnce()
    town.restoreTownCasualties(); expect([...town.event.actors.values()].every(actor => !actor.dead)).toBe(true)
  })
})
