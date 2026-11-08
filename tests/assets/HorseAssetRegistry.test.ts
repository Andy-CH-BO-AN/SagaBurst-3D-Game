import { readFileSync } from 'node:fs'
import type * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HorseAssetLoadError, HorseAssetRegistry, validateHorseManifest, type HorseAssetManifest, type HorseTemplate } from '../../src/world/HorseAssetRegistry'

const horseManifest = JSON.parse(readFileSync(new URL('../../public/models/mounts/v1/horse/manifest.json', import.meta.url), 'utf8')) as HorseAssetManifest
const armoredManifest = JSON.parse(readFileSync(new URL('../../public/models/mounts/v1/armored-horse/manifest.json', import.meta.url), 'utf8')) as HorseAssetManifest

// Package loading is the external boundary. Only manifest identities are needed;
// no renderer, scene, GLB, texture, material or instance is constructed.
type LoadBoundary = {
  load(renderer: THREE.WebGLRenderer): Promise<HorseTemplate>
  loadArmored(renderer: THREE.WebGLRenderer): Promise<HorseTemplate>
}
const boundary = HorseAssetRegistry as unknown as LoadBoundary
const renderer = {} as THREE.WebGLRenderer
const ordinary = { manifest: horseManifest } as HorseTemplate
const armored = { manifest: armoredManifest } as HorseTemplate
function gate() {
  let resolve!: (value: HorseTemplate) => void, reject!: (error: Error) => void
  const promise = new Promise<HorseTemplate>((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}
async function flush() { for (let turn = 0; turn < 8; turn++) await Promise.resolve() }

beforeEach(() => HorseAssetRegistry.resetForTesting())
afterEach(() => { HorseAssetRegistry.resetForTesting(); vi.restoreAllMocks(); vi.useRealTimers() })

describe('horse package preload barrier', () => {
  it('rejects a package missing the death state before loading its model', () => {
    const incomplete = structuredClone(horseManifest)
    incomplete.clips = incomplete.clips.filter(clip => clip !== 'death')
    expect(() => validateHorseManifest(incomplete)).toThrow('Horse manifest is missing death clip')
  })

  it('validates the armored warhorse manifest contract', () => {
    expect(() => validateHorseManifest(armoredManifest)).not.toThrow()
    expect(armoredManifest.status).toBe('ready')
    expect(armoredManifest.metrics?.triangles.lod2).toBeLessThanOrEqual(7000)
  })

  it('starts both packages together, deduplicates callers and waits for the slower armored package before entry', async () => {
    const slow = gate()
    const load = vi.spyOn(boundary, 'load').mockResolvedValue(ordinary)
    const loadArmored = vi.spyOn(boundary, 'loadArmored').mockReturnValue(slow.promise)
    const enterScene = vi.fn()
    const first = HorseAssetRegistry.preload(renderer)
    expect(HorseAssetRegistry.preload(renderer)).toBe(first)
    expect(load).toHaveBeenCalledTimes(1); expect(loadArmored).toHaveBeenCalledTimes(1)
    const entry = first.then(enterScene)
    await flush()
    expect(HorseAssetRegistry.ready).toBe(true); expect(HorseAssetRegistry.armoredReady).toBe(false)
    expect(enterScene).not.toHaveBeenCalled()
    expect(HorseAssetRegistry.preloadArmored(renderer)).toBe(HorseAssetRegistry.preloadArmored(renderer))
    slow.resolve(armored); await entry
    expect(HorseAssetRegistry.armoredReady).toBe(true)
    expect(HorseAssetRegistry.resolveTemplate().manifest.id).toBe(horseManifest.id)
    expect(HorseAssetRegistry.resolveTemplate({ armored: true }).manifest.id).toBe(armoredManifest.id)
    await HorseAssetRegistry.preload(renderer)
    expect(enterScene).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledTimes(1); expect(loadArmored).toHaveBeenCalledTimes(1)
  })

  it.each(['ordinary', 'armored'] as const)('surfaces %s package failure and retries only the failed package', async failed => {
    const load = vi.spyOn(boundary, 'load').mockResolvedValue(ordinary)
    const loadArmored = vi.spyOn(boundary, 'loadArmored').mockResolvedValue(armored)
    const failing = failed === 'ordinary' ? load : loadArmored
    failing.mockRejectedValueOnce(new Error('GLB / manifest / KTX2 unavailable'))
    await expect(HorseAssetRegistry.preload(renderer)).rejects.toThrow(HorseAssetLoadError)
    const available = failed === 'ordinary' ? HorseAssetRegistry.armoredReady : HorseAssetRegistry.ready
    expect(available).toBe(true)
    if (failed === 'armored') {
      expect(HorseAssetRegistry.armoredError?.message).toContain('KTX2 unavailable')
      expect(() => HorseAssetRegistry.resolveTemplate({ armored: true })).toThrow('KTX2 unavailable')
    }
    const retry = HorseAssetRegistry.preload(renderer)
    expect(HorseAssetRegistry.preload(renderer)).toBe(retry)
    await retry
    expect(HorseAssetRegistry.ready).toBe(true); expect(HorseAssetRegistry.armoredReady).toBe(true)
    expect(load).toHaveBeenCalledTimes(failed === 'ordinary' ? 2 : 1)
    expect(loadArmored).toHaveBeenCalledTimes(failed === 'armored' ? 2 : 1)
    expect(HorseAssetRegistry.armoredError).toBeNull()
  })

  it('times out a stalled package and ignores its late completion after a successful retry', async () => {
    vi.useFakeTimers()
    const stalled = gate()
    const load = vi.spyOn(boundary, 'load').mockResolvedValue(ordinary)
    const loadArmored = vi.spyOn(boundary, 'loadArmored').mockReturnValueOnce(stalled.promise).mockResolvedValue(armored)
    const failed = expect(HorseAssetRegistry.preload(renderer)).rejects.toThrow('重甲戰馬載入逾時')
    await vi.advanceTimersByTimeAsync(30_000); await failed
    expect(HorseAssetRegistry.armoredReady).toBe(false)
    await HorseAssetRegistry.preload(renderer)
    stalled.resolve({ manifest: { ...armoredManifest, id: 'obsolete-attempt' } } as HorseTemplate)
    await flush()
    expect(HorseAssetRegistry.resolveTemplate({ armored: true }).manifest.id).toBe(armoredManifest.id)
    expect(load).toHaveBeenCalledTimes(1); expect(loadArmored).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })
})
