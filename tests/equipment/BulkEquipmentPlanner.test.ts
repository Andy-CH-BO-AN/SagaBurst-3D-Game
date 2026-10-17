import { describe, expect, it } from 'vitest'
import { planBulkEquipment, type BulkEquipmentActor, type BulkEquipmentCandidate } from '../../src/career/BulkEquipmentPlanner'
describe('Global bulk equipment matching', () => {
  it('scores recipient-specific final tiers before granting an earlier actor a same-tier category swap', () => {
    const actors: BulkEquipmentActor[] = [
      { actorId: 'soldier-1', tier: 4, currentKey: 'empty-1' },
      { actorId: 'soldier-2', tier: 1, currentKey: 'empty-2' },
    ]
    const candidates: BulkEquipmentCandidate[] = [
      { key: 'empty-1', itemId: null, tier: 0, holderId: 'soldier-1' },
      { key: 'empty-2', itemId: null, tier: 0, holderId: 'soldier-2' },
      { key: 'bow', itemId: 'bow', tier: 4, requested: true },
    ]
    const plan = planBulkEquipment(actors, candidates,
      (actor, candidate) => candidate.requested === true || candidate.holderId === actor.actorId,
      (actor, candidate) => candidate.itemId === null ? actor.tier : candidate.tier)
    expect(plan.map(({ actorId, candidate }) => [actorId, candidate.key])).toEqual([
      ['soldier-1', 'empty-1'], ['soldier-2', 'bow'],
    ])
  })
  it('matches constrained recipients globally instead of consuming their only legal upgrade greedily', () => {
    const actors = [{ actorId: 'soldier-1', tier: 1 }, { actorId: 'soldier-2', tier: 1 }]
    const candidates = [{ key: 'old-1', itemId: 'old', tier: 1 }, { key: 'old-2', itemId: 'old', tier: 1 },
      { key: 'four', itemId: 'four', tier: 4 }, { key: 'three', itemId: 'three', tier: 3 }]
    const plan = planBulkEquipment(actors, candidates, (actor, candidate) => actor.actorId === 'soldier-1' || candidate.key !== 'three')
    expect(plan.map(({ candidate }) => candidate.tier)).toEqual([3, 4])
    expect(new Set(plan.map(({ candidate }) => candidate.key)).size).toBe(2)
  })
})
