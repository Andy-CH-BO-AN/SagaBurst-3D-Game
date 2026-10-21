import { describe, expect, it } from 'vitest'
import { EagleLandingQueue } from '../../src/world/EagleLandingQueue'

describe('automatic eagle approach queue', () => {

  it('withdraws blocked, interrupted or dead owners without losing a different active approach', () => {
    const queue = new EagleLandingQueue(10, 0)
    expect(queue.request('blocked', false)).toBe(false)
    expect(queue.request('town')).toBe(true)
    expect(queue.request('blocked')).toBe(false)
    queue.release('blocked')
    expect(queue.request('town')).toBe(true)
    expect(queue.request('private')).toBe(false)
    expect(queue.request('town', false)).toBe(false)
    expect(queue.request('private')).toBe(true)
  })
})
