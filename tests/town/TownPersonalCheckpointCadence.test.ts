import { describe, expect, it } from 'vitest'
import {
  TOWN_PERSONAL_CHECKPOINT_SECONDS,
  TOWN_PERSONAL_CRITICAL_MIN_SECONDS,
  townPersonalCheckpointDue,
} from '../../src/town/TownPersonalCheckpointCadence'

describe('Town personal checkpoint cadence', () => {
  it('coalesces critical changes after a save, keeps the periodic save and never delays forced or retirement saves', () => {
    const justBefore = TOWN_PERSONAL_CRITICAL_MIN_SECONDS - .01
    expect(townPersonalCheckpointDue(justBefore, true, false, false)).toBe(false)
    expect(townPersonalCheckpointDue(TOWN_PERSONAL_CRITICAL_MIN_SECONDS, true, false, false)).toBe(true)
    expect(townPersonalCheckpointDue(TOWN_PERSONAL_CHECKPOINT_SECONDS - .01, false, false, false)).toBe(false)
    expect(townPersonalCheckpointDue(TOWN_PERSONAL_CHECKPOINT_SECONDS, false, false, false)).toBe(true)
    expect(townPersonalCheckpointDue(0, false, true, false)).toBe(true)
    expect(townPersonalCheckpointDue(0, true, false, true)).toBe(true)
  })
})
