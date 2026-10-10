import { describe, expect, it } from 'vitest'
import { EagleLandingQueue } from '../../src/world/EagleLandingQueue'

describe('automatic eagle approach queue', () => {
  it('serializes town and private returns and admits the next owner after touchdown clearance', () => {
    const queue = new EagleLandingQueue()
    expect(queue.request('town-eagle-rider:1')).toBe(true)
    expect(queue.request('personal:1')).toBe(false)
    expect(queue.request('town-eagle-rider:2')).toBe(false)
    queue.complete('town-eagle-rider:1')
    expect(queue.request('town-eagle-rider:2')).toBe(false)
    expect(queue.request('personal:1')).toBe(true)
    queue.complete('personal:1')
    expect(queue.request('town-eagle-rider:2')).toBe(true)
  })

  it('moves an unsuccessful approach behind waiting birds without renewing its lease every frame', () => {
    const queue = new EagleLandingQueue(10, 2)
    expect(queue.request('failed')).toBe(true)
    expect(queue.request('next')).toBe(false)
    for (let second = 0; second < 9; second++) {
      queue.beginFrame(1)
      expect(queue.request('failed')).toBe(true)
    }
    queue.beginFrame(1)
    expect(queue.request('failed')).toBe(false)
    expect(queue.request('next')).toBe(false)
    queue.beginFrame(2)
    expect(queue.request('failed')).toBe(false)
    expect(queue.request('next')).toBe(true)
  })

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
