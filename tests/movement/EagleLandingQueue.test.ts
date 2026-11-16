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

  it('lets pads with separate airspace land together while neighbours and corridor approaches still take turns', () => {
    const queue = new EagleLandingQueue(10, 0)
    const west = { x: -85, z: 54, yaw: Math.PI }, next = { x: -55, z: 54, yaw: Math.PI }, far = { x: -85, z: -18, yaw: Math.PI }
    expect(queue.request('private:west', true, 90, west)).toBe(true)
    expect(queue.request('town:far', true, 90, far)).toBe(true)
    // 30 m apart: wing footprints clear each other, but not each other's traffic margin.
    expect(queue.request('private:next', true, 90, next)).toBe(false)
    // An approach without a pad zone is a corridor: it waits for, and then blocks, everyone.
    expect(queue.request('corridor')).toBe(false)
    queue.complete('private:west')
    expect(queue.request('private:next', true, 90, next)).toBe(true)
    queue.complete('private:next'); queue.complete('town:far')
    expect(queue.request('corridor')).toBe(true)
    expect(queue.request('private:west', true, 90, west)).toBe(false)
  })
})

