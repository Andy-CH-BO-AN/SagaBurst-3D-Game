import { describe, expect, it } from 'vitest'
import { planPersonalOutpostGround } from '../../src/career/PersonalOutpostGroundPlan'

const anchor = { x: 0, z: 0, yaw: 0 }
const slots = (count: number) => Array.from({ length: count }, (_, i) => ({ x: i * 6 + 6, z: -20, yaw: 0 }))

describe('Career Outpost personal squad deployment policy', () => {

  it('preserves un-compacted member indices when eagle riders are interleaved', () => {
    const ids = ['ground-a', 'eagle-a', 'ground-b', 'eagle-b', 'ground-c']
    const planned = planPersonalOutpostGround(ids, new Set(['eagle-a', 'eagle-b']), true, anchor, slots)
    expect([planned.regularMuster[0], planned.regularMuster[2], planned.regularMuster[4]]).toEqual(slots(3))
    expect([planned.regularMuster[1], planned.regularMuster[3]]).toEqual([anchor, anchor])
  })

  it('throws on incomplete ground allocation rather than dropping squad members', () => {
    expect(() => planPersonalOutpostGround(['a'], new Set(), true, anchor, () => []))
      .toThrow('Incomplete personal ground deployment')
  })
})
