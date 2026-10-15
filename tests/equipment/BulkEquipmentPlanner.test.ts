import { describe, expect, it } from 'vitest'
import { planBulkEquipment, type BulkEquipmentActor, type BulkEquipmentCandidate } from '../../src/career/BulkEquipmentPlanner'
describe('Global bulk equipment matching', () => {
  it('prioritizes the earlier natural actor for one same-tier requested category swap', () => {
    const actors: BulkEquipmentActor[] = ['soldier-2', 'soldier-1'].map(actorId => ({ actorId, tier: 4, currentKey: actorId, currentRequested: false }))
    const candidates: BulkEquipmentCandidate[] = [...actors.map(actor => ({ key: actor.actorId, itemId: 'sword', tier: 4, holderId: actor.actorId })),
      { key: 'mace', itemId: 'mace', tier: 4, requested: true }]
    const plan = planBulkEquipment(actors, candidates, (actor, candidate) => candidate.requested === true || candidate.holderId === actor.actorId)
    expect(plan.map(({ actorId, candidate }) => [actorId, candidate.itemId])).toEqual([['soldier-1', 'mace'], ['soldier-2', 'sword']])
  })
  it('preserves all current keys when same-class equal-tier stock offers no team improvement', () => {
    const actors = [{ actorId: 'soldier-1', tier: 3, currentKey: 'old', currentRequested: true }]
    expect(planBulkEquipment(actors, [{ key: 'new', itemId: 'sword-a', tier: 3, requested: true },
      { key: 'old', itemId: 'sword-z', tier: 3, requested: true }], () => true)[0].candidate.key).toBe('old')
  })
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
  it('prefers higher final combat tier when the same items produce equal upgrade counts', () => {
    const actors: BulkEquipmentActor[] = [{ actorId: 'soldier-1', tier: 4 }, { actorId: 'soldier-2', tier: 2 }]
    const candidates: BulkEquipmentCandidate[] = [
      { key: 'three', itemId: 'sword-3', tier: 3, requested: true },
      { key: 'four', itemId: 'sword-4', tier: 4, requested: true },
    ]
    const plan = planBulkEquipment(actors, candidates, () => true,
      (actor, candidate) => actor.actorId === 'soldier-1' ? 4 : candidate.tier)
    expect(plan.map(({ candidate }) => candidate.tier)).toEqual([3, 4])
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
