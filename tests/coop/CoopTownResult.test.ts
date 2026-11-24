import { describe, expect, it } from 'vitest'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { CAREER_STORAGE_KEY, CareerProfileStore } from '../../src/career/CareerProfileStore'
import { applyCoopTownResult, commitCoopTownResult, parseCoopTownResult } from '../../src/coop/CoopTownResult'
import { TOWN_RULES } from '../../src/town/TownRules'
import { MemoryStorage } from '../helpers/memoryStorage'

describe('Co-op shared Town hostility result', () => {
  it('settles the guest’s own save like the host — penalty or defection — once per host event', () => {
    const guest = createCareerProfile('viking')
    guest.availableMerit = guest.totalMerit = 5000
    const storage = new MemoryStorage()
    expect(new CareerProfileStore(storage).save(guest)).toBe(true)

    const defeat = parseCoopTownResult({ id: 'host-event-0001', result: 'player_defeated' })!
    expect(commitCoopTownResult(defeat, storage)).toEqual({ penalty: Math.min(5000, TOWN_RULES.deathPenalty), defected: false })
    // A re-sent result for the same host event never charges twice.
    expect(commitCoopTownResult(defeat, storage)).toEqual({ penalty: 0, defected: false })
    expect(new CareerProfileStore(storage).load()!.availableMerit).toBe(5000 - Math.min(5000, TOWN_RULES.deathPenalty))

    const won = applyCoopTownResult(new CareerProfileStore(storage).load()!, { id: 'host-event-0002', result: 'town_defeated' })
    expect(won.faction).toBe('roman')
    expect(won.rank).toBe('recruit')

    // The guest's own unfinished event in its own town stays its own.
    const own = createCareerProfile('roman')
    own.townEvent = { id: 'guest-own-event', state: 'hostile' }
    expect(applyCoopTownResult(own, defeat).townEvent).toEqual({ id: 'guest-own-event', state: 'hostile' })

    expect(parseCoopTownResult({ id: 'x', result: 'player_defeated' })).toBeNull()
    expect(parseCoopTownResult({ id: 'host-event-0001', result: 'draw' })).toBeNull()
    expect(storage.getItem(CAREER_STORAGE_KEY)).not.toBeNull()
  })
})
