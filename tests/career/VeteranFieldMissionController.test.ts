import { describe, expect, it } from 'vitest'
import { resolveVeteranFieldMissionOutcome, veteranPlayerSpawn, veteranFieldPosition, VETERAN_FIELD_LAYOUT } from '../../src/career/BanditMissionController'
import { nearTownBanditCamp } from '../../src/town/TownBounds'

describe('Veteran field survival objective', () => {
  it('keeps the scout mission running at 119.9 seconds and wins at 120 with one survivor', () => {
    expect(resolveVeteranFieldMissionOutcome('veteran-tragedy-of-the-scouts', true, false, 73, 1, 119.9)).toBeNull()
    expect(resolveVeteranFieldMissionOutcome('veteran-tragedy-of-the-scouts', true, false, 73, 1, 120)).toBe('victory')
  })

  it('fails before the deadline only when the Player and all NPC allies are dead', () => {
    expect(resolveVeteranFieldMissionOutcome('veteran-tragedy-of-the-scouts', true, false, 100, 0, 119.9)).toBe('failure')
    expect(resolveVeteranFieldMissionOutcome('veteran-tragedy-of-the-scouts', false, false, 100, 0, 119.9)).toBeNull()
  })
})

describe('Veteran scout muster placement', () => {
  it('keeps the Player and every muster slot clear of bandit camps', () => {
    const squadCount = 2
    const points = [veteranPlayerSpawn('veteran-tragedy-of-the-scouts')]
    for (const squadId of [1, 2] as const) for (let slot = 0; slot < 10; slot++) {
      points.push(veteranFieldPosition(VETERAN_FIELD_LAYOUT.scoutRally, { squadId } as never, slot, 'friendly', squadCount))
    }
    for (const point of points) expect(nearTownBanditCamp(point.x, point.z, 26)).toBe(false)
  })
})
