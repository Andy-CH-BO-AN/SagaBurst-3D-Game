import { describe, expect, it, vi } from 'vitest'
import { AssetLoadTimeout, OnDemandAssets } from '../../src/assets/OnDemandAssets'

describe('OnDemandAssets', () => {
  const TIMEOUT = 1000, RETRY = 500
  const bounded = (loader: (id: 'a', signal: AbortSignal) => Promise<string>) => new OnDemandAssets<'a', string>(loader, { timeoutMs: TIMEOUT, retryDelayMs: RETRY })
  it('deduplicates concurrent requests, retries after a failure and loads a success only once', async () => {
    const loader = vi.fn<(id: 'a') => Promise<string>>().mockRejectedValueOnce(new Error('404')).mockResolvedValueOnce('model')
    const assets = bounded(loader)
    const [first, second] = [assets.load('a'), assets.load('a')]
    expect(first).toBe(second)
    await expect(first).rejects.toThrow('404')
    expect(assets.get('a')).toBeUndefined() // a failed request exposes no model
    await expect(assets.load('a')).resolves.toBe('model')
    expect(loader).toHaveBeenCalledTimes(2)
    expect(assets.get('a')).toBe('model')
    await assets.load('a')
    expect(loader).toHaveBeenCalledTimes(2)
  })
  it('turns a forever-pending load into a timeout, after which loading again issues a new request', async () => {
    vi.useFakeTimers()
    try {
      const loader = vi.fn<(id: 'a', signal: AbortSignal) => Promise<string>>().mockReturnValueOnce(new Promise(() => {})).mockResolvedValueOnce('model')
      const assets = bounded(loader)
      const pending = assets.load('a')
      const rejected = expect(pending).rejects.toBeInstanceOf(AssetLoadTimeout)
      await vi.advanceTimersByTimeAsync(TIMEOUT - 1)
      expect(assets.status('a')).toBe('loading')
      expect(assets.load('a')).toBe(pending)
      await vi.advanceTimersByTimeAsync(1)
      await rejected
      expect(assets.status('a')).toBe('failed')
      expect(loader.mock.calls[0][1].aborted).toBe(true) // the hung transfer is cancelled, not left holding the URL
      await expect(assets.load('a')).resolves.toBe('model')
      expect(loader).toHaveBeenCalledTimes(2)
    } finally { vi.useRealTimers() }
  })
  it('discards a late result from a timed-out request so it cannot replace the newer one', async () => {
    vi.useFakeTimers()
    try {
      let finishOld = (_: string) => {}, finishNew = (_: string) => {}
      const loader = vi.fn<(id: 'a') => Promise<string>>()
        .mockReturnValueOnce(new Promise(resolve => { finishOld = resolve }))
        .mockReturnValueOnce(new Promise(resolve => { finishNew = resolve }))
      const assets = bounded(loader)
      const old = expect(assets.load('a')).rejects.toBeInstanceOf(AssetLoadTimeout)
      await vi.advanceTimersByTimeAsync(TIMEOUT)
      await old
      const newer = assets.load('a')
      finishOld('stale')
      await vi.advanceTimersByTimeAsync(0)
      expect(assets.get('a')).toBeUndefined()
      expect(assets.status('a')).toBe('loading')
      finishNew('fresh')
      await expect(newer).resolves.toBe('fresh')
      expect(assets.get('a')).toBe('fresh')
    } finally { vi.useRealTimers() }
  })
  it('paces automatic retries from polling at the retry delay', async () => {
    vi.useFakeTimers()
    try {
      const loader = vi.fn<(id: 'a') => Promise<string>>().mockRejectedValueOnce(new Error('404')).mockResolvedValueOnce('model')
      const assets = bounded(loader)
      expect(assets.poll('a')).toBeUndefined()
      expect(assets.poll('a')).toBeUndefined()
      await vi.advanceTimersByTimeAsync(RETRY - 1)
      assets.poll('a')
      expect(loader).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      assets.poll('a')
      expect(loader).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(0)
      expect(assets.poll('a')).toBe('model')
    } finally { vi.useRealTimers() }
  })
})

it('rejects pending and future callers after disposal even when the loader ignores abort', async () => {
  vi.useFakeTimers()
  let finish!: (value: string) => void
  let signal!: AbortSignal
  const loader = vi.fn((_id: string, abort: AbortSignal) => {
    signal = abort
    return new Promise<string>(resolve => { finish = resolve })
  })
  const assets = new OnDemandAssets(loader, { timeoutMs: 100, retryDelayMs: 200 })
  try {
    const request = assets.load('item'), rejected = expect(request).rejects.toThrow('OnDemandAssets disposed')
    assets.dispose()
    expect(signal.aborted).toBe(true)
    await rejected
    finish('late')
    await vi.advanceTimersByTimeAsync(0)
    expect(assets.get('item')).toBeUndefined()
    await expect(assets.load('item')).rejects.toThrow('OnDemandAssets disposed')
    expect(assets.poll('item')).toBeUndefined()
    expect(loader).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  } finally { assets.dispose(); vi.useRealTimers() }
})
