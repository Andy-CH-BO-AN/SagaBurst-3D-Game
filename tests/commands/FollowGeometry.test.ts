import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { FOLLOW_THRESHOLDS, followLocalOffset, followSlotWorldPosition, returnFollowLocalOffset } from '../../src/battle/FollowOrder'

describe('FOLLOW tactical geometry', () => {
  it('assigns ten stable, distinct slots instead of one leader position', () => {
    const first = Array.from({ length: 10 }, (_, index) => followLocalOffset(index))
    const second = Array.from({ length: 10 }, (_, index) => followLocalOffset(index))
    expect(new Set(first.map(slot => `${slot.x}:${slot.z}`)).size).toBe(10)
    expect(second.map(slot => slot.toArray())).toEqual(first.map(slot => slot.toArray()))
    expect(first.every(slot => slot.length() >= FOLLOW_THRESHOLDS.infantrySpacing)).toBe(true)
  })

  it('rotates local slots with leader heading', () => {
    const local = new THREE.Vector3(2, 0, -3)
    expect(followSlotWorldPosition(new THREE.Vector3(10, 0, 20), 0, local).toArray()).toEqual([12, 0, 17])
    const turned = followSlotWorldPosition(new THREE.Vector3(10, 0, 20), Math.PI / 2, local)
    expect(turned.x).toBeCloseTo(7)
    expect(turned.z).toBeCloseTo(18)
  })

  it('uses wider mounted spacing and centralized movement thresholds', () => {
    expect(followLocalOffset(0, true).length()).toBeGreaterThan(followLocalOffset(0, false).length())
    expect(FOLLOW_THRESHOLDS.holdDistance).toBeLessThan(FOLLOW_THRESHOLDS.runDistance)
    expect(FOLLOW_THRESHOLDS.runDistance).toBeLessThan(FOLLOW_THRESHOLDS.regroupDistance)
  })

  it('fits all eighteen large-mission followers within the Town return muster', () => {
    const returning = Array.from({ length: 18 }, (_, index) => returnFollowLocalOffset(index, 18))
    expect(new Set(returning.map(slot => `${slot.x}:${slot.z}`)).size).toBe(18)
    expect(Math.max(...returning.map(slot => slot.length()))).toBeLessThan(18)
    expect(followLocalOffset(17).length()).toBeGreaterThan(18)
  })
})
