import { describe, expect, it } from 'vitest'
import { TownActorUpdates, type TownActorUpdate } from '../../src/town/TownActorUpdates'

interface Actor { id: string; townCategory: string; distance: number }
const actor = (id: string, townCategory = 'military'): Actor => ({ id, townCategory, distance: 0 })

describe('Town actor simulation ownership', () => {
  it('advances a commanded resident once across overlapping field rosters while retaining first-seen actor order', () => {
    const borrowed = actor('borrowed'), ambient = actor('ambient'), peaceful = actor('peaceful')
    const personal = { actors: [borrowed], owns: (npc: Actor) => npc === borrowed }
    const updates = new TownActorUpdates({ kind: 'field', veteran: false }, {
      mission: [borrowed], ambient: [ambient, borrowed], command: new Set([borrowed]),
      external: new Set([borrowed]), patrol: new Set([borrowed]), personal,
    })
    const residents = [{ npc: borrowed }, { npc: peaceful }, { npc: borrowed }]
    updates.updatePeaceResidents(residents, ({ npc }) => { npc.distance += 10 })
    const dispatched: [string, TownActorUpdate][] = []
    for (const npc of updates.actors) {
      const owner = updates.take(npc)
      if (owner) { dispatched.push([npc.id, owner]); npc.distance++ }
    }
    // A second pass cannot advance a borrowed or peaceful resident again.
    updates.updatePeaceResidents(residents, ({ npc }) => { npc.distance += 10 })
    expect(updates.take(borrowed)).toBeUndefined()
    expect(dispatched).toEqual([['borrowed', 'runtime'], ['ambient', 'mission']])
    expect([borrowed.distance, ambient.distance, peaceful.distance]).toEqual([1, 1, 10])
  })

  it('reads the defense escort-to-return handoff at dispatch without removing the resident from the combat roster', () => {
    const resident = actor('resident')
    let escorting = false, returning = false, missionOwned = true
    const frame = () => new TownActorUpdates({ kind: 'defense' }, {
      mission: [resident], command: new Set([resident]),
    }, { isEscorting: () => escorting, ownsPeacefulTravel: () => returning, isMissionActor: () => missionOwned })
    const escortFrame = frame()
    // Siege updates happen after the frame roster is prepared.
    escorting = true
    returning = true
    expect(escortFrame.take(resident, true)).toBe('escort')
    const returnFrame = frame()
    escorting = false
    missionOwned = false
    expect(returnFrame.take(resident, true)).toBe('peace')
    expect(returnFrame.actors).toEqual([resident])
    expect(returnFrame.take(resident, true)).toBeUndefined()
  })

  it('keeps a Duel borrower under the Duel phase even when a world owner lists the same resident', () => {
    const opponent = actor('opponent'), patrol = actor('patrol')
    const outskirts = { actors: [opponent, patrol], owns: (npc: Actor) => npc === opponent || npc === patrol }
    const updates = new TownActorUpdates({ kind: 'duel' }, {
      mission: [opponent], field: [opponent], outskirts, external: new Set([opponent]),
    })
    updates.updatePeaceResidents([{ npc: opponent }], ({ npc }) => { npc.distance += 10 })
    expect(updates.actors).toEqual([opponent, patrol])
    expect(updates.take(opponent)).toBe('mission')
    expect(updates.take(patrol)).toBe('outskirts')
    expect(opponent.distance).toBe(0)
  })
})
