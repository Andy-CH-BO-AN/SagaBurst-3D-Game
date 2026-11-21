import { describe, expect, it } from 'vitest'
import { CommanderFourGateDefenseController } from '../../src/career/CommanderFourGateDefenseController'
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

    // The real controller must feed those helpers and the outcome in the right order. Only its
    // dependencies (profile, residents, spawn readiness) are supplied; evaluate/remainingEnemies are real.
    const mission = { kind: 'commander-four-gate-defense', phase: 'ATTACKING', targetActorIds: targets, deadTargetActorIds: ['a'] }
    const state = { attackStarted: true, registeredTargetActorIds: [...targets], combatElapsedSeconds: 0 }
    const enemies = [{ combatantId: 'b', dead: false }], resident = { npc: { combatantId: 'r', dead: false } }
    const owner = Object.assign(Object.create(CommanderFourGateDefenseController.prototype) as
      Pick<CommanderFourGateDefenseController, 'remainingEnemies' | 'evaluate'>, {
      readProfile: () => ({ activeMission: mission }), state, enemies, residents: [resident],
      startedMissionId: 'm', fourGateSiege: { ready: true }, spawnBatch: { pending: 0, ready: true } })
    expect(owner.remainingEnemies).toBe(2)
    expect(owner.evaluate(false)).toBeNull() // c is registered but neither dead nor present
    enemies.push({ combatantId: 'c', dead: false })
    expect(owner.evaluate(false)).toBeNull() // accounted, two attackers still alive
    expect(owner.evaluate(true, 0)).toBeNull() // a living resident keeps the town alive
    resident.npc.dead = true
    expect(owner.evaluate(true, 0)).toBe('failure')
    expect(owner.evaluate(true, 1)).toBeNull() // so does a living personal ally
    state.registeredTargetActorIds = ['a', 'b'] // incomplete registration blocks both victory routes
    state.combatElapsedSeconds = survivalSeconds
    expect(owner.evaluate(false, 0)).toBeNull()
    state.registeredTargetActorIds = [...targets]
    expect(owner.evaluate(false, 0)).toBe('victory')
    state.combatElapsedSeconds = 0
    for (const enemy of enemies) enemy.dead = true
    expect(owner.remainingEnemies).toBe(0)
    state.registeredTargetActorIds = ['a', 'b']
    expect(owner.evaluate(false, 0)).toBeNull()
    state.registeredTargetActorIds = [...targets]
    expect(owner.evaluate(true, 0)).toBe('victory')
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
