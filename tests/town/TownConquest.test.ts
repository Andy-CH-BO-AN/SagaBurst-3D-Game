import { afterEach, describe, expect, it, vi } from 'vitest'
import { initialPersonalEquipment } from '../../src/career/CareerInventory'
import { createCareerProfile, enlistmentMerit, type CareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore, parseCareerProfile } from '../../src/career/CareerProfileStore'
import { resolveTownHRLayout, townConquestRoster } from '../../src/town/TownHRLayout'
import { TownEvent, townRoster } from '../../src/town/TownRules'
import { MemoryStorage } from '../helpers/memoryStorage'
import { createDefaultSkillState } from '../../src/rpg/SkillManager'
import { TownScene } from '../../src/town/TownScene'
import { TemporaryBattlefieldMounts } from '../../src/career/TemporaryBattlefieldMounts'

const layout = resolveTownHRLayout('roman', [], [])
const population = townConquestRoster(layout)
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function eventWithSurvivors(survivors: readonly string[] = []) {
  const event = new TownEvent(population)
  for (const spec of population) event.register(spec.id, { dead: !survivors.includes(spec.id) })
  event.complete(); event.hostile = true
  return event
}

interface ConquestSettlementEntry {
  profile: CareerProfile
  event: TownEvent
  skills: { skillState: CareerProfile['skills'] }
  onRestart: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
  openPanel(title: string, message: string): unknown
  button(panel: unknown, label: string, callback: () => void): unknown
  finish(result: 'town_defeated' | 'player_defeated'): void
  restoreTownCasualties(): void
}

/** Only finish/commit inputs; no combat, command, world or rendering fixture is constructed. */
function savedTown() {
  const store = new CareerProfileStore(new MemoryStorage())
  const profile = createCareerProfile('roman')
  profile.totalMerit = 22000; profile.availableMerit = 180; profile.rank = 'commander'
  profile.townEvent = { id: 'conquest', state: 'hostile' }
  const event = new TownEvent(population)
  for (const spec of population) event.register(spec.id, { dead: false })
  event.complete()
  const town = Object.assign(Object.create(TownScene.prototype) as ConquestSettlementEntry, {
    profile, event, store, skills: { skillState: profile.skills },
    clearCareerSkillSaveTimer: vi.fn(), careerSaveFailures: 0, player: { dead: false },
    temporaryMounts: new TemporaryBattlefieldMounts(), onRestart: vi.fn(), dispose: vi.fn(),
  })
  return { town, store }
}

describe('canonical free Town conquest population', () => {

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
})

describe('full population conquest outcomes and registration', () => {
  it('requires the last living formal resident before declaring town defeat', () => {
    // The outcome rule is identity-independent; full roster membership and registration are tested above.
    const id = 'gate:east:0'
    const event = eventWithSurvivors([id])
    expect(event.evaluate(false)).toBeNull()
    event.actors.get(id)!.dead = true
    expect(event.evaluate(false)).toBe('town_defeated')
    expect(event.evaluate(true)).toBe('player_defeated')
  })
  it.each(['hr-officer'])('rejects missing registration %s and never treats it as a death', id => {
    const event = new TownEvent(population); event.hostile = true
    population.filter(spec => spec.id !== id).forEach(spec => event.register(spec.id, { dead: true }))
    expect(event.evaluate(false)).toBeNull(); expect(() => event.complete()).toThrow(id)
    expect(event.registrationComplete).toBe(false)
    event.register(id, { dead: true }); expect(event.evaluate(false)).toBeNull()
    event.complete(); expect(event.evaluate(false)).toBe('town_defeated')
    event.actors.delete(id); expect(event.evaluate(false)).toBeNull()
  })
})

describe('hostile save migration and settlement retries', () => {
  it.each(['town_defeated', 'player_defeated'] as const)('saves %s once after retry and only then permits transition', result => {
    const { town, store } = savedTown()
    town.profile.personalSquad = { members: [{ id: 'personal:permanent', type: 'soldier', originalHirePrice: 50,
      equipment: initialPersonalEquipment('soldier', 'roman') }] }
    town.profile.inventory = { version: 1, quantities: { gladius_rusty: 2,
      ...Object.fromEntries(Object.values(initialPersonalEquipment('soldier', 'roman')).filter(Boolean).map(id => [id, 1])) } }
    town.profile.skills = { ...createDefaultSkillState(), ...town.profile.skills, ranged: { level: 4, xp: 20 } }
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
    restartButtons.shift()!(); expect(town.onRestart).toHaveBeenCalledExactlyOnceWith(town.profile, result === 'player_defeated' ? 'death-return' : undefined)
    expect(town.dispose).toHaveBeenCalledOnce()
    town.restoreTownCasualties(); expect([...town.event.actors.values()].every(actor => !actor.dead)).toBe(true)
  })
})
