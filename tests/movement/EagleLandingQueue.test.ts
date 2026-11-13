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

  it('keeps a progressing approach beyond the stall window, while a circling one yields and can retry', () => {
    const queue = new EagleLandingQueue(10, 0, 1)
    expect(queue.request('private', true, 100)).toBe(true)
    expect(queue.request('town')).toBe(false)
    // 18 s of real closure outlives a 10 s window that a fixed timer would have cut.
    for (const remaining of [80, 60, 40]) {
      queue.beginFrame(6)
      expect(queue.request('private', true, remaining)).toBe(true)
    }
    // Circling never beats the closest point reached, so it cannot renew.
    queue.beginFrame(6)
    expect(queue.request('private', true, 45)).toBe(true)
    queue.beginFrame(6)
    expect(queue.request('private', true, 39.5)).toBe(false)
    expect(queue.request('town')).toBe(true)
    queue.complete('town')
    expect(queue.request('private', true, 45)).toBe(true)
  })
})
