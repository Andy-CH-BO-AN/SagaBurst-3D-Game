import { describe, expect, it } from 'vitest'
import { CommanderFourGateDefenseController } from '../../src/career/CommanderFourGateDefenseController'
import { createFourGateDefenseProfile } from '../helpers/commanderFourGateDefenseFixture'

describe('Town defense target accounting', () => {
  it('waits for the last registered rider, including after its mount dies, before awarding victory', () => {
    const profile = createFourGateDefenseProfile('ATTACKING'), mission = profile.activeMission!, state = mission.fourGateDefense!
    const lastId = mission.targetActorIds.find(id => id.endsWith(':air:ranger:30'))!
    expect(lastId).toBeDefined()
    mission.deadTargetActorIds = mission.targetActorIds.filter(id => id !== lastId)
    state.registeredTargetActorIds = [...mission.deadTargetActorIds]
    const rider = { combatantId: lastId, dead: false, mount: { dead: false } }
    const enemies: typeof rider[] = []
    // Only spawn/readiness and actor state are dependencies. Evaluate, remaining count and
    // the official deployment/target accounting decisions execute on the real controller.
    const merchant = { spec: { id: 'merchant', role: 'merchant' }, npc: { combatantId: 'merchant', dead: false } }
    const residents = [...mission.civilianActorIds!.map(id => ({ spec: { id, role: 'civilian' }, npc: { combatantId: id, dead: true } })), merchant]
    const owner = Object.assign(Object.create(CommanderFourGateDefenseController.prototype) as Pick<CommanderFourGateDefenseController, 'remainingEnemies' | 'evaluate'>, {
      readProfile: () => profile, state, enemies, residents, actorsById: new Map(),
      startedMissionId: mission.id, fourGateSiege: { ready: true }, spawnBatch: { pending: 0, ready: true },
    })
    expect(owner.remainingEnemies).toBe(1)
    expect(owner.evaluate(false)).toBeNull()
    state.registeredTargetActorIds.push(lastId)
    expect(owner.evaluate(false)).toBeNull() // Registration alone cannot account for an absent living actor.
    enemies.push(rider)
    rider.mount.dead = true
    expect(owner.remainingEnemies).toBe(1)
    expect(owner.evaluate(true, 0)).toBeNull() // The final civilian/service survivor still keeps the Town alive.
    state.combatElapsedSeconds = 299.9
    expect(owner.evaluate(true, 0)).toBeNull()
    state.combatElapsedSeconds = 300
    expect(owner.evaluate(true, 0)).toBe('victory') // A service resident is a valid deadline survivor.
    merchant.npc.dead = true
    expect(owner.evaluate(true, 1)).toBe('victory') // A live HR ally can win while the player spectates.
    expect(owner.evaluate(false, 0)).toBe('victory') // The player alone also qualifies.
    expect(owner.evaluate(true, 0)).toBe('failure')
    rider.dead = true
    expect(owner.remainingEnemies).toBe(0)
    expect(owner.evaluate(true, 0)).toBe('victory') // All20 civilian losses and mutual annihilation do not revoke victory.
    // The casualty ledger independently accounts for an intentionally absent corpse after reload.
    mission.deadTargetActorIds.push(lastId)
    enemies.length = 0
    expect(owner.evaluate(true, 1)).toBe('victory')
  })
})
