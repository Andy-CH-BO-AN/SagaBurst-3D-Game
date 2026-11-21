import { expect, it } from 'vitest'
import { TargetReacquireSchedule } from '../../src/navigation/TargetReacquireSchedule'

/** Frames until the schedule asks for a rescan, holding the target at `distance`. */
function framesUntilDue(schedule: TargetReacquireSchedule, distance: number | null, limit = 40): number {
  for (let frame = 1; frame <= limit; frame++) if (schedule.tick(distance)) return frame
  return Infinity
}

it('依距離分 2／8／16 影格重掃目標，首次掃描依 phase 錯開，近距離帶立即生效而遠距離帶不延後，expedite 令下一影格重掃', () => {
  const rescanAfter = (distance: number | null, staggered: boolean, phase = 0) => {
    const schedule = new TargetReacquireSchedule()
    schedule.schedule(distance, staggered, phase)
    return framesUntilDue(schedule, distance)
  }
  expect(rescanAfter(50, false)).toBe(2)
  expect(rescanAfter(50.01, false)).toBe(8)
  expect(rescanAfter(100, false)).toBe(8)
  expect(rescanAfter(100.01, false)).toBe(16)
  expect(rescanAfter(null, false)).toBe(16)
  expect(rescanAfter(Infinity, false)).toBe(16)
  // The first scan after acquisition is spread over the band by the actor's phase.
  expect(rescanAfter(200, true, 0)).toBe(1)
  expect(rescanAfter(200, true, .5)).toBe(9)
  expect(rescanAfter(200, true, .999)).toBe(16)

  const closing = new TargetReacquireSchedule()
  closing.schedule(200, false, 0)
  expect(closing.tick(200)).toBe(false)
  expect(framesUntilDue(closing, 30)).toBe(2)
  const retreating = new TargetReacquireSchedule()
  retreating.schedule(30, false, 0)
  expect(retreating.tick(30)).toBe(false)
  expect(retreating.tick(200)).toBe(true)

  const expedited = new TargetReacquireSchedule()
  expedited.schedule(200, false, 0)
  expedited.expedite()
  expect(expedited.tick(200)).toBe(true)
  expedited.schedule(200, false, 0)
  expect(framesUntilDue(expedited, 200)).toBe(16)
})
