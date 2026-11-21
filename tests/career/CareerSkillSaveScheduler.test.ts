import { afterEach, describe, expect, it, vi } from 'vitest'
import { CareerSkillSaveScheduler } from '../../src/career/CareerSkillSaveScheduler'

function setup() {
  vi.useFakeTimers()
  const state = { saves: 0, notices: 0, accept: true }
  const scheduler = new CareerSkillSaveScheduler({
    save: () => { state.saves++; return state.accept },
    onSaveFailed: () => { state.notices++ },
  })
  return { state, scheduler }
}

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

describe('CareerSkillSaveScheduler', () => {
  it('saves XP once at 600ms, coalesces later awards, and a cancelled debounce never fires', () => {
    const { state, scheduler } = setup()
    scheduler.markDirty(); scheduler.schedule()
    vi.advanceTimersByTime(300)
    scheduler.markDirty(); scheduler.schedule() // a later award does not postpone or duplicate the pending save
    vi.advanceTimersByTime(299)
    expect(state.saves).toBe(0)
    vi.advanceTimersByTime(1)
    expect(state.saves).toBe(1)
    expect(scheduler.dirty).toBe(false)
    vi.advanceTimersByTime(5000)
    expect(state.saves).toBe(1)

    scheduler.markDirty(); scheduler.schedule()
    scheduler.cancel()
    vi.advanceTimersByTime(5000)
    expect(state.saves).toBe(1)
    expect(scheduler.dirty).toBe(true)
  })

  it('flush cancels the pending timer and saves once; a rejected save reports, stays dirty, and retries', () => {
    const { state, scheduler } = setup()
    scheduler.markDirty(); scheduler.schedule()
    vi.advanceTimersByTime(599)
    expect(scheduler.flush()).toBe(true)
    vi.advanceTimersByTime(5000)
    expect(state.saves).toBe(1)

    state.accept = false
    scheduler.markDirty()
    expect(scheduler.flush()).toBe(false)
    expect(state).toMatchObject({ saves: 2, notices: 1 })
    expect(scheduler.dirty).toBe(true)
    state.accept = true
    expect(scheduler.flush()).toBe(true)
    expect(state).toMatchObject({ saves: 3, notices: 1 })
    expect(scheduler.flush()).toBe(true) // nothing dirty: no further write
    expect(state.saves).toBe(3)
  })
})
