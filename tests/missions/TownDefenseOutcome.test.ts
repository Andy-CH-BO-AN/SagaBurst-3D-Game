import { describe, expect, it } from 'vitest'
import {
  COMMANDER_FOUR_GATE_DEFENSE_SURVIVAL_SECONDS as survivalSeconds, fourGateRemainingTargets, fourGateTargetsAccounted,
  resolveCommanderFourGateDefenseOutcome as resolve,
} from '../../src/career/CommanderFourGateDefenseState'

describe('Town defense target accounting', () => {
  const targets = ['a', 'b', 'c']

  it('accounts registered attackers by ledger or presence and counts the remaining ones', () => {
    expect(fourGateTargetsAccounted(targets, ['a', 'b', 'c'], ['a', 'b'], ['c'])).toBe(true)
    // Registration alone cannot account for an absent living actor.
    expect(fourGateTargetsAccounted(targets, ['a', 'b', 'c'], ['a', 'b'], [])).toBe(false)
    // After a reload the casualty ledger accounts for an intentionally absent corpse.
    expect(fourGateTargetsAccounted(targets, ['a', 'b', 'c'], ['a', 'b', 'c'], [])).toBe(true)
    // A present actor stays accounted regardless of its own body or mount state.
    expect(fourGateTargetsAccounted(targets, ['a', 'b', 'c'], [], ['a', 'b', 'c'])).toBe(true)
    // The registered set must match the target list exactly.
    expect(fourGateTargetsAccounted(targets, ['a', 'b'], [], ['a', 'b', 'c'])).toBe(false)
    expect(fourGateTargetsAccounted(targets, ['a', 'b', 'x'], [], ['a', 'b', 'c', 'x'])).toBe(false)
    expect(fourGateTargetsAccounted(targets, ['a', 'b', 'c', 'x'], [], ['a', 'b', 'c', 'x'])).toBe(false)
    // Remaining counts attackers dead by ledger or by a present actor; outsiders never count.
    const live = (combatantId: string) => ({ combatantId, dead: false })
    expect(fourGateRemainingTargets(targets, ['a'], [{ combatantId: 'b', dead: true }, live('c')])).toBe(1)
    expect(fourGateRemainingTargets(targets, ['a', 'b'], [live('c')])).toBe(1)
    expect(fourGateRemainingTargets(targets, ['a'], [{ combatantId: 'b', dead: true }, { combatantId: 'c', dead: true }])).toBe(0)
    expect(fourGateRemainingTargets(targets, [], [{ combatantId: 'outsider', dead: true }])).toBe(3)
    expect(fourGateRemainingTargets([], [], [live('a')])).toBe(0)
  })

  it('wins on the last enemy death or the survival deadline, and fails only when no defender remains', () => {
    // Final enemy death wins even when everyone else is gone.
    expect(resolve(true, true, 0, 0)).toBe('victory')
    // Incomplete registration can neither win by elimination nor by the deadline.
    expect(resolve(false, false, 0, 5, 0, survivalSeconds)).toBeNull()
    expect(resolve(false, true, 1, 1, 0, survivalSeconds - .1)).toBeNull()
    expect(resolve(false, true, 1, 1, 0, survivalSeconds)).toBe('victory')
    // Any living town resident, HR ally or the player keeps the town alive; none left means failure.
    expect(resolve(true, true, 1, 1)).toBeNull()
    expect(resolve(true, true, 1, 0, 1)).toBeNull()
    expect(resolve(false, true, 1, 0, 0)).toBeNull()
    expect(resolve(true, true, 1, 0, 0)).toBe('failure')
  })
})
