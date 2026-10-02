import { describe, expect, it } from 'vitest'
import { resolveVeteranFieldMissionOutcome } from './BanditMissionController'

describe('Veteran field survival objective', () => {
  it('keeps the scout mission running at 119.9 seconds and wins at 120 with one survivor', () => {
    expect(resolveVeteranFieldMissionOutcome('veteran-tragedy-of-the-scouts', true, false, 73, 1, 119.9)).toBeNull()
    expect(resolveVeteranFieldMissionOutcome('veteran-tragedy-of-the-scouts', true, false, 73, 1, 120)).toBe('victory')
  })

  it('fails before the deadline only when the Player and all NPC allies are dead', () => {
    expect(resolveVeteranFieldMissionOutcome('veteran-tragedy-of-the-scouts', true, false, 100, 0, 119.9)).toBe('failure')
    expect(resolveVeteranFieldMissionOutcome('veteran-tragedy-of-the-scouts', false, false, 100, 0, 119.9)).toBeNull()
  })

  it('does not require kills for survival victory', () => {
    expect(resolveVeteranFieldMissionOutcome('veteran-tragedy-of-the-scouts', false, true, 100, 0, 120)).toBe('victory')
  })
})
