import { describe, expect, it } from 'vitest'
import type { CombatEvent } from '../../src/combat/CombatAttribution'
import { routeTownCombatEvent, type TownCombatEventOwners } from '../../src/town/TownCombatEventRouter'

const event = { type: 'damage_applied', source: { actorId: 'player', actorType: 'player' },
  target: { targetId: 'npc:test', targetType: 'npc', name: 'target' }, method: 'melee', weaponId: 'unarmed',
  requestedDamage: 5, appliedDamage: 5 } as unknown as CombatEvent

type Owner = 'finale' | 'patrol' | 'duel' | 'defense' | 'mission'
type Active = Partial<Record<'finale' | 'patrol' | 'duel' | 'defense', boolean>>

/** Every owner records the events it receives, so routing is observable per owner. */
function townOwners(active: Active) {
  const received: Record<Owner, CombatEvent[]> = { finale: [], patrol: [], duel: [], defense: [], mission: [] }
  const record = { duelRecorded: 0, awarded: 0, refitNoted: 0 }
  const sink = (owner: Owner) => ({ emit: (e: CombatEvent) => { received[owner].push(e) } })
  const owners: TownCombatEventOwners = {
    duel: { active: active.duel, events: sink('duel'), recordCombatEvent: () => { record.duelRecorded++ } },
    retirementFinale: { active: active.finale, recordEvent: e => { received.finale.push(e) } },
    captainPatrol: { active: active.patrol, recordEvent: e => { received.patrol.push(e) } },
    defense: { active: active.defense, events: sink('defense') },
    mission: { events: sink('mission') },
    refitSafety: { note: () => { record.refitNoted++ } },
    awardXp: () => { record.awarded++ },
  }
  return { owners, received, record }
}

describe('Town combat event routing', () => {
  it('delivers an event to exactly one scoring owner and scores XP and refit safety once', () => {
    const cases: Array<[Active, Owner]> = [
      [{ finale: true, patrol: true, duel: true, defense: true }, 'finale'],
      [{ patrol: true, duel: true, defense: true }, 'patrol'],
      [{ duel: true, defense: true }, 'duel'],
      [{ defense: true }, 'defense'],
      [{}, 'mission'],
    ]
    for (const [active, expected] of cases) {
      const { owners, received, record } = townOwners(active)
      routeTownCombatEvent(event, owners)
      for (const owner of Object.keys(received) as Owner[]) expect(received[owner], `${expected} owns it, not ${owner}`).toEqual(owner === expected ? [event] : [])
      expect(record).toEqual({ duelRecorded: 1, awarded: 1, refitNoted: 1 })
    }
  })
})
