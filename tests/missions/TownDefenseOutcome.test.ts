import { COMMANDER_FOUR_GATE_DEFENSE_SURVIVAL_SECONDS as survivalSeconds } from '../../src/career/CommanderFourGateDefenseState'
import { describe, expect, it } from 'vitest'
import { createFourGateDefenseProfile } from '../helpers/commanderFourGateDefenseFixture'
import { fourGateDefenseRuntime } from '../helpers/fourGateDefenseRuntime'

describe('Town defense target accounting', () => {
  it('waits for the last registered rider, including after its mount dies, before awarding victory', () => {
    const h = fourGateDefenseRuntime(createFourGateDefenseProfile('PREPARING'))
    h.toAttack()
    const owner = h.controller, mission = h.profile().activeMission!
    const lastId = mission.targetActorIds.find(id => id.endsWith(':lancer:t4:leader'))!
    const rider = h.factory.actors.get(lastId)!
    expect(owner.combatEnabled).toBe(true)
    for (const [id, actor] of h.factory.actors) if (id !== lastId) actor.hp = 0
    expect(owner.remainingEnemies).toBe(1)
    expect(owner.evaluate(false)).toBeNull()
    rider.mount!.currentHp = 0
    expect(owner.remainingEnemies).toBe(1)
    // Every native but one service resident has fallen; that survivor still keeps the Town alive.
    const merchant = h.residents.get('hr-officer')!
    for (const [id, actor] of h.residents) if (id !== 'hr-officer') actor.hp = 0
    expect(owner.evaluate(true, 0)).toBeNull()
    owner.updateFlow(survivalSeconds - .1, 0)
    expect(owner.evaluate(true, 0)).toBeNull()
    owner.updateFlow(.1, 0)
    expect(owner.evaluate(true, 0)).toBe('victory') // A service resident is a valid deadline survivor.
    // The live final-frame snapshot, not a caller-supplied result, owns the saved survival receipt.
    const receipt = () => { owner.persistRuntimeProgress(true); return h.profile().activeMission!.fourGateDefense!.victoryReason }
    expect(receipt()).toBe('survival')
    merchant.hp = 0
    expect(owner.evaluate(true, 1)).toBe('victory') // A live HR ally can win while the player spectates.
    expect(owner.evaluate(false, 0)).toBe('victory') // The player alone also qualifies.
    expect(owner.evaluate(true, 0)).toBe('failure')
    h.player.hp = 0
    expect(receipt()).toBeUndefined()
    rider.hp = 0
    expect(owner.remainingEnemies).toBe(0)
    expect(owner.evaluate(true, 0)).toBe('victory') // Total civilian losses and mutual annihilation do not revoke victory.
    owner.dispose()
  })
})
