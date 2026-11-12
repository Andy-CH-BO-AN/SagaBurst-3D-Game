import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { AssetLoadTimeout, OnDemandAssets } from '../../src/assets/OnDemandAssets'
import { parsePunchTiming, type HumanoidAssetManifest } from '../../src/world/HumanoidAssetRegistry'
import { ARMORS } from '../../src/rpg/ArmorDatabase'
import { careerShopProduct } from '../../src/career/CareerShopCatalog'
import { FACTION_SHIELD_BANDS } from '../../src/combat/FactionShieldGeometry'

const dir = 'public/models/characters/v2/byzantine-cataphract-t5'
const manifest = JSON.parse(readFileSync(`${dir}/manifest.json`, 'utf8')) as HumanoidAssetManifest & { fileSha256: Record<string, string> }

describe('Byzantine punch contact timeline (manifest data only; no GLB parsing)', () => {
  it('validates punch contact timeline and rejects malformed timelines', () => {
    const combo = manifest.animations!.embedded.find(b => b.clip === 'punchCombo')!
    expect(combo.duration).toBeCloseTo(2.2, 2)
    const timing = parsePunchTiming(combo)!
    expect(timing.contacts.map(c => c.hand)).toEqual(['left', 'right', 'left', 'right'])
    expect(timing.contacts.map(c => +c.time.toFixed(2))).toEqual([.6, .88, 1.1, 1.37])

    const rightTiming = parsePunchTiming(manifest.animations!.embedded.find(b => b.clip === 'punchRight')!)!
    expect(new Set(rightTiming.contacts.map(c => c.hand))).toEqual(new Set(['right']))

    const base = { clip: 'punchCombo' as const, source: 'Meshy' as const, sourceClip: 'x', loop: false, duration: 1, punchHands: ['left', 'right'] as ('left' | 'right')[] }
    expect(() => parsePunchTiming({ ...base, events: { punch0: .5, punch1: .4 } })).toThrow()
    expect(() => parsePunchTiming({ ...base, events: { punch0: .2, punch1: 1.2 } })).toThrow()
    expect(parsePunchTiming({ ...base, punchHands: undefined })).toBeUndefined()
  })
})

describe('Optional Byzantine equipment loading', () => {
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

describe('Centurion Aquila shield contracts', () => {
  it('validates Aquila shield as a 48-impact T4 shop item with custom shield bands', () => {
    expect(ARMORS.centurion_aquila_shield_t4).toMatchObject({ tier: 4, shieldImpactMax: 48 })
    expect([ARMORS.roman_officer_shield_t4.shieldImpactMax, ARMORS.paladin_shield_t4.shieldImpactMax]).toEqual([48, 48])
    expect(careerShopProduct('centurion_aquila_shield_t4')).toMatchObject({ category: 'armor', tier: 4, price: 1440 })
    const bands = FACTION_SHIELD_BANDS.centurion_aquila_shield_t4
    expect(bands.length).toBeGreaterThan(20)
    expect(bands).not.toEqual(FACTION_SHIELD_BANDS.roman_officer_shield_t4)
  })
})

describe('Viking Dragonward shield contracts', () => {
  it('validates Dragonward shield as a 48-impact T4 shop shield with custom shield bands', () => {
    expect(ARMORS.viking_dragonward_shield_t4).toMatchObject({ tier: 4, shieldImpactMax: 48 })
    expect(ARMORS.viking_berserker_shield_t5.shieldImpactMax).toBe(96)
    expect(careerShopProduct('viking_dragonward_shield_t4')).toMatchObject({ category: 'armor', tier: 4, price: 1440 })
    const bands = FACTION_SHIELD_BANDS.viking_dragonward_shield_t4
    expect(bands.length).toBeGreaterThan(20)
    expect(bands).not.toEqual(FACTION_SHIELD_BANDS.viking_berserker_shield_t5)
  })
})
