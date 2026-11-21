import { afterEach, describe, expect, it, vi } from 'vitest'
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
