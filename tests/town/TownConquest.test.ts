import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { careerRankFixture } from '../helpers/careerRankFixture'
import { MemoryStorage } from '../helpers/memoryStorage'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CareerSkillSaveScheduler } from '../../src/career/CareerSkillSaveScheduler'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { TemporaryBattlefieldMounts } from '../../src/career/TemporaryBattlefieldMounts'
import { SkillManager } from '../../src/rpg/SkillManager'
import { TownScene } from '../../src/town/TownScene'
import { resolveTownHRLayout, townConquestRoster } from '../../src/town/TownHRLayout'
import { TownEvent, townRoster } from '../../src/town/TownRules'

const layout = resolveTownHRLayout('roman', [], [])
const population = townConquestRoster(layout)
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function eventWithSurvivors(survivors: readonly string[] = []) {
  const event = new TownEvent(population)
  for (const spec of population) event.register(spec.id, { dead: !survivors.includes(spec.id) })
  event.complete(); event.hostile = true
  return event
}

describe('canonical free Town conquest population', () => {

  it('automatically requires a newly added formal resident without an objective flag', () => {
    const baseRoster = townRoster(), added = { ...baseRoster[0], id: 'new-formal-resident' }
    const roster = townConquestRoster(layout, [...baseRoster, added]), event = new TownEvent(roster)
    roster.forEach(spec => event.register(spec.id, { dead: spec.id !== added.id }))
    event.complete(); event.hostile = true
    expect(event.actors.size).toBe(baseRoster.length + 2); expect(event.evaluate(false)).toBeNull()
    event.actors.get(added.id)!.dead = true; expect(event.evaluate(false)).toBe('town_defeated')
    expect(() => townConquestRoster(layout, [...baseRoster, added, added])).toThrow('Duplicate')
    expect(() => townConquestRoster(layout, population)).toThrow('Duplicate')
  })
})

describe('full population conquest outcomes and registration', () => {
  it('allows defection with all native Eagle riders alive while retaining the remaining resident objectives', () => {
    const survivors = ['town-eagle-rider:1', 'town-eagle-rider:2', 'town-eagle-rider:3', 'town-eagle-rider:4', 'town-eagle-rider:5',
      'watchtower-archer:1', 'civilian-0', 'merchant', 'cat']
    const event = eventWithSurvivors(survivors)
    for (const id of ['watchtower-archer:1', 'civilian-0', 'merchant', 'cat']) {
      expect(event.evaluate(false)).toBeNull()
      event.actors.get(id)!.dead = true
    }
    expect(event.evaluate(false)).toBe('town_defeated')
    expect(event.evaluate(true)).toBe('player_defeated')
    expect(event.allActors.get('town-eagle-rider:1')?.dead).toBe(false)
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

interface TownSettleEntry {
  profile: CareerProfile
  notice: string
  townResult: unknown
  createTownResultSettlement(): unknown
  finish(result: 'town_defeated' | 'player_defeated'): void
  restoreTownCasualties(): void
}

interface TownSkillEntry {
  profile: CareerProfile
  notice: string
  careerSkillSave: CareerSkillSaveScheduler
  skills: SkillManager
  awardCareerSkillXp(award: { skill: 'oneHanded'; xp: number }): void
  saveCareerSkills(): boolean
}

/** The production TownScene methods over a plain-data state; no scene, world or actor is built. */
function townEntry<T extends object>(state: T) {
  return Object.assign(Object.create(TownScene.prototype) as TownSettleEntry & TownSkillEntry, state)
}

describe('TownScene hostile result caller', () => {
  it('restores saved casualties, refuses a stale save, retries a failed write once, then restarts', () => {
    const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
    const profile = createCareerProfile('roman')
    profile.totalMerit = 22000; profile.availableMerit = 180; Object.assign(profile, careerRankFixture(profile.faction, 'commander'))
    profile.townEvent = { id: 'conquest', state: 'hostile', deadActorIds: ['cat', 'merchant'], destroyedBuildingIds: ['tower-1'] }
    expect(store.save(profile)).toBe(true)
    const damaged: string[] = [], destroyed: string[] = [], panels: string[] = [], buttons: Array<{ label: string; action: () => void }> = []
    const restarts: Array<{ profile: CareerProfile; reason?: string }> = []
    const town = townEntry({
      profile: store.load()!, store, notice: '', skills: { skillState: profile.skills }, careerSaveFailures: 0, careerSkillSave: new CareerSkillSaveScheduler({ save: () => true }), player: { dead: false }, temporaryMounts: new TemporaryBattlefieldMounts(), missionBoard: { page: undefined },
      cat: { takeDamage: () => { damaged.push('cat') } },
      residents: [{ spec: { id: 'merchant' }, npc: { takeDamage: () => { damaged.push('merchant') } } }],
      world: { buildings: [{ id: 'tower-1', hp: { destroy: () => { destroyed.push('tower-1') } } }] },
      onRestart: (next: CareerProfile, reason?: string) => { restarts.push({ profile: next, reason }) }, dispose() {},
      openPanel: (title: string) => { panels.push(title); return {} },
      button: (_panel: unknown, label: string, action: () => void) => { buttons.push({ label, action }) },
    })
    town.townResult = town.createTownResultSettlement()
    town.restoreTownCasualties()
    expect(damaged).toEqual(['cat', 'merchant']); expect(destroyed).toEqual(['tower-1'])

    // Another tab already settled this event: the stale scene must not overwrite it.
    const other = JSON.parse(JSON.stringify(town.profile)) as CareerProfile
    other.townEvent = { id: 'conquest', state: 'settled', result: 'town_defeated', penalty: 0 }
    expect(store.save(other)).toBe(true)
    const otherBytes = JSON.stringify(store.load())
    town.finish('player_defeated')
    expect(town.profile.townEvent?.state).toBe('hostile'); expect(JSON.stringify(store.load())).toBe(otherBytes)
    expect(town.notice).not.toBe(''); expect(panels).toEqual(['結算尚未保存']); expect(restarts).toEqual([])

    expect(store.save(profile)).toBe(true) // the stored event is ours again; the write itself now fails once
    storage.failWrites = true
    town.finish('player_defeated')
    expect(restarts).toEqual([]); expect(panels).toHaveLength(2)
    storage.failWrites = false
    buttons.at(-1)!.action() // 重試保存
    expect(store.load()!.townEvent).toMatchObject({ state: 'settled', result: 'player_defeated' })
    expect(store.load()!.availableMerit).toBe(80)
    expect(panels).toHaveLength(3)
    town.finish('player_defeated') // settled once: no second penalty or panel
    expect(store.load()!.availableMerit).toBe(80); expect(panels).toHaveLength(3)
    buttons.at(-1)!.action()
    expect(restarts).toEqual([{ profile: town.profile, reason: 'death-return' }])
  })
})

describe('TownScene career skill saves', () => {
  it('routes awards through the shared debounce and saves the in-memory profile at 600ms without publishing a rejected write', () => {
    vi.useFakeTimers()
    onTestFinished(() => { vi.clearAllTimers(); vi.useRealTimers() })
    const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
    const profile = createCareerProfile('roman')
    expect(store.save(profile)).toBe(true)
    const town = townEntry({
      profile: store.load()!, store, notice: '', skills: new SkillManager(), spectator: undefined,
      player: { dead: false, spectatorOnly: false, blockingLevel: 1, armorBreakLevel: 1 },
      synchronizeEaglePatrolPolicy() {},
    })
    town.careerSkillSave = new CareerSkillSaveScheduler({
      save: () => town.saveCareerSkills(),
    })
    town.awardCareerSkillXp({ skill: 'oneHanded', xp: 7 })
    vi.advanceTimersByTime(599)
    expect(store.load()!.skills!.oneHanded.xp).toBe(0)
    vi.advanceTimersByTime(1)
    expect(store.load()!.skills!.oneHanded.xp).toBe(7)
    expect(town.profile.skills!.oneHanded.xp).toBe(7)

    storage.failWrites = true
    town.awardCareerSkillXp({ skill: 'oneHanded', xp: 3 })
    vi.advanceTimersByTime(600)
    expect(town.profile.skills!.oneHanded.xp).toBe(10) // the live profile keeps the XP; only the durable write failed
    expect(store.load()!.skills!.oneHanded.xp).toBe(7)
    expect(town.careerSkillSave.dirty).toBe(true)
  })
})
