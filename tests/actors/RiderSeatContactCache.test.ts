import { describe, expect, it } from 'vitest'
import { RiderSeatContactCache } from '../../src/world/RiderSeatContactCache'

describe('rider seat contact ownership', () => {
  it('releases old contact surfaces when the stable rider container receives a new visual', () => {
    const oldVisual = { id: 'before-equipment-change' }
    const rider = { children: [oldVisual] }
    const cache = new RiderSeatContactCache((owner: typeof rider) => ({ surfaceOwner: owner.children[0] }))
    const initial = cache.get(rider)
    expect(cache.get(rider)).toBe(initial)

    // Player replaces the visual while retaining both the rider and its child count.
    const replacement = { id: 'after-equipment-change' }
    rider.children.splice(0, 1, replacement)
    const refitted = cache.get(rider)
    expect(refitted).not.toBe(initial)
    expect(refitted.surfaceOwner).toBe(replacement)
    expect(cache.get(rider)).toBe(refitted)

    // A different mount may first meet the rider with no fitted visual yet.
    rider.children.length = 0
    const empty = cache.get(rider)
    rider.children.push(replacement)
    expect(cache.get(rider)).not.toBe(empty)
    expect(cache.get(rider).surfaceOwner).toBe(replacement)
  })
})
