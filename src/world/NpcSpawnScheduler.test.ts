import { describe, expect, it, vi } from 'vitest'
import { NpcSpawnScheduler, assertNpcSpawnJob, trackNpcSpawn } from './NpcSpawnScheduler'

describe('shared render-frame NPC budget', () => {
  it('enqueues pure jobs, deduplicates actor identity and materializes once for a repeated RAF timestamp', () => {
    const scheduler = new NpcSpawnScheduler(), create = vi.fn(), batch = scheduler.batch()
    expect(batch.enqueue('a', create)).toBe(true)
    expect(batch.enqueue('a', create)).toBe(false)
    batch.enqueue('b', create); batch.seal()
    expect(create).not.toHaveBeenCalled()
    scheduler.tick(16); scheduler.tick(16); scheduler.tick(16)
    expect(create).toHaveBeenCalledTimes(1)
    expect(batch.actors.get('a')).toBe('spawned'); expect(batch.pending).toBe(1)
    scheduler.tick(32)
    expect(create).toHaveBeenCalledTimes(2); expect(batch.ready).toBe(true)
    expect(batch.enqueue('c', create)).toBe(false)
  })

  it('shares the same budget between owners, even after a long background pause', () => {
    const scheduler = new NpcSpawnScheduler(), calls: number[] = []
    for (let owner = 0; owner < 3; owner++) {
      const batch = scheduler.batch()
      for (let i = 0; i < 3; i++) batch.enqueue(`${owner}:${i}`, () => calls.push(owner))
      batch.seal()
    }
    for (const timestamp of [16, 1000, 100000]) {
      const before = calls.length
      scheduler.tick(timestamp); scheduler.tick(timestamp)
      expect(calls.length - before).toBe(1)
    }
    expect(scheduler.pending).toBe(6)
  })

  it('does not reopen an empty frame or materialize a callback enqueue in the same frame', () => {
    const scheduler = new NpcSpawnScheduler(), calls = vi.fn()
    scheduler.tick(16)
    const first = scheduler.batch(), second = scheduler.batch()
    first.enqueue('first', () => { calls(); second.enqueue('second', calls); second.seal(); scheduler.tick(32) })
    first.seal()
    scheduler.tick(16); expect(calls).not.toHaveBeenCalled()
    scheduler.tick(32); scheduler.tick(32)
    expect(calls).toHaveBeenCalledOnce()
    scheduler.tick(48); expect(calls).toHaveBeenCalledTimes(2)
  })

  it('cancels old owners, skips invalid jobs and never reports cancellation as successful readiness', async () => {
    const scheduler = new NpcSpawnScheduler(), create = vi.fn()
    const old = scheduler.batch(), next = scheduler.batch()
    old.enqueue('old', create); old.seal(); old.cancel()
    next.enqueue('next', create); next.seal()
    scheduler.tick(16)
    expect(create).toHaveBeenCalledOnce(); expect(old.status).toBe('cancelled')
    expect(old.pending).toBe(0); expect(old.ready).toBe(false); expect(next.ready).toBe(true)
    await expect(scheduler.wait(old)).rejects.toThrow('cancelled')
  })

  it('rolls back the NPC and mount, fails its batch and allows another owner on the next frame', async () => {
    const scheduler = new NpcSpawnScheduler(), cleanup = vi.fn(), error = new Error('binding failed')
    const npc = { dispose: vi.fn() }, mount = { dispose: vi.fn() }, bad = scheduler.batch(cleanup), good = scheduler.batch()
    bad.enqueue('broken-rider', () => { trackNpcSpawn(npc); trackNpcSpawn(mount); throw error })
    const skipped = vi.fn(); bad.enqueue('never', skipped); bad.seal()
    const survivor = vi.fn(); good.enqueue('other', survivor); good.seal()
    scheduler.tick(16); scheduler.tick(16)
    expect(npc.dispose).toHaveBeenCalledOnce(); expect(mount.dispose).toHaveBeenCalledOnce()
    expect(cleanup).toHaveBeenCalledOnce(); expect(bad.status).toBe('failed'); expect(bad.pending).toBe(0)
    expect(skipped).not.toHaveBeenCalled(); expect(survivor).not.toHaveBeenCalled()
    await expect(scheduler.wait(bad)).rejects.toBe(error)
    scheduler.tick(32); expect(survivor).toHaveBeenCalledOnce()
  })

  it('includes finalizer failure in the batch result and rolls back its last materialized job', () => {
    const scheduler = new NpcSpawnScheduler(), batch = scheduler.batch(), npc = { dispose: vi.fn() }
    batch.enqueue('a', () => trackNpcSpawn(npc)); batch.seal(() => { throw new Error('roster finalization') })
    scheduler.tick(16)
    expect(batch.status).toBe('failed'); expect(batch.ready).toBe(false); expect(npc.dispose).toHaveBeenCalledOnce()
  })

  it('drives real loading RAFs, reports completed counts and does not double-consume the handoff frame', async () => {
    const scheduler = new NpcSpawnScheduler(), callbacks: FrameRequestCallback[] = [], calls = vi.fn(), progress = vi.fn()
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { callbacks.push(cb); return callbacks.length })
    try {
      const batch = scheduler.batch(); batch.enqueue('a', calls); batch.enqueue('b', calls); batch.seal()
      const loaded = scheduler.wait(batch, progress)
      expect(calls).not.toHaveBeenCalled()
      callbacks.shift()!(16); await Promise.resolve()
      expect(progress).toHaveBeenLastCalledWith(1, 2)
      callbacks.shift()!(32); await loaded
      expect(progress).toHaveBeenLastCalledWith(2, 2)
      const gameplay = scheduler.batch(); gameplay.enqueue('c', calls); gameplay.seal()
      scheduler.tick(32); expect(calls).toHaveBeenCalledTimes(2)
      scheduler.tick(48); expect(calls).toHaveBeenCalledTimes(3)
    } finally { vi.unstubAllGlobals() }
  })

  it('rejects a cancelled loading batch without leaving a pending promise', async () => {
    const scheduler = new NpcSpawnScheduler(), callbacks: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { callbacks.push(cb); return 1 })
    try {
      const batch = scheduler.batch(); batch.enqueue('a', vi.fn()); batch.seal()
      const pending = scheduler.wait(batch)
      batch.cancel(); callbacks.shift()!(16)
      await expect(pending).rejects.toThrow('cancelled')
    } finally { vi.unstubAllGlobals() }
  })


  it('marks empty finalizer failures and settles loading even when owner cleanup also throws', async () => {
    const scheduler = new NpcSpawnScheduler(), error = new Error('empty roster finalization')
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const batch = scheduler.batch(() => { throw new Error('cleanup') })
      batch.seal(() => { throw error })
      expect(batch.status).toBe('failed'); expect(batch.ready).toBe(false)
      await expect(scheduler.wait(batch)).rejects.toBe(error)
      expect(log).toHaveBeenCalledOnce()
    } finally { log.mockRestore() }
  })

  it('requires factory materialization to run inside a spawn job', () => {
    expect(assertNpcSpawnJob).toThrow('frame spawn job')
    const scheduler = new NpcSpawnScheduler(), batch = scheduler.batch()
    batch.enqueue('actor', () => expect(assertNpcSpawnJob).not.toThrow()); batch.seal(); scheduler.tick(16)
    expect(batch.ready).toBe(true)
  })
})
