import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { multiInfluenceSkinningPlugin } from '../../src/world/MultiInfluenceSkinning'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HumanoidAssetRegistry, resolveHumanoidAssetId, type HumanoidAssetManifest, type HumanoidAssetDescriptor } from '../../src/world/HumanoidAssetRegistry'

type ManifestResponse = Pick<Response, 'ok' | 'status' | 'json'>
type ManifestFetch = (...args: Parameters<typeof fetch>) => Promise<ManifestResponse>

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function fixture(bufferCompression?: HumanoidAssetManifest['bufferCompression']) {
  const descriptor: HumanoidAssetDescriptor = {
    assetId: 'compression-fixture', faction: 'viking', heightM: 1.86, maxShoulderWidthM: .54, neckLengthM: .09,
    animationContract: 'bandit',
  }
  const manifest: HumanoidAssetManifest = {
    schemaVersion: 1, id: descriptor.assetId, status: 'ready', skeleton: 'project-humanoid-v1', attribution: 'fixture',
    files: { lod0: 'lod0.glb', lod1: 'lod1.glb', lod2: 'lod2.glb' }, bufferCompression,
    skinInfluenceSets: bufferCompression ? 4 : undefined,
    metrics: { heightM: 1.86, shoulderWidthM: .5, neckLengthM: .09, triangles: { lod0: 3, lod1: 2, lod2: 1 }, textures: { lod0: 4, lod1: 2, lod2: 1 } },
    animations: { embedded: ['idle', 'walk', 'run', 'swordSlash', 'hit', 'death'].map(clip => ({
      clip: clip as 'idle' | 'walk' | 'run' | 'swordSlash' | 'hit' | 'death', source: 'SagaBurst', sourceClip: clip, loop: true, duration: 1,
    })), runtimeGenerated: [] },
  }
  vi.stubGlobal('fetch', vi.fn<ManifestFetch>().mockResolvedValue({ ok: true, status: 200, json: async () => manifest }))
  // Stop at the transport boundary: no model, scene or animation is instantiated.
  const load = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockRejectedValue(new Error('transport unavailable'))
  const decoder = vi.spyOn(GLTFLoader.prototype, 'setMeshoptDecoder')
  const plugin = vi.spyOn(GLTFLoader.prototype, 'register')
  return { descriptor, load, decoder, plugin }
}

describe('humanoid buffer-compression opt-in', () => {
  it('selects ordinary tier bodies without overriding explicit special or civilian appearances', () => {
    const ordinary = { faction: 'roman' as const, tier: 1 as const, isPlayer: true }
    expect(resolveHumanoidAssetId(ordinary)).toBe('roman-t1')
    expect(resolveHumanoidAssetId({ ...ordinary, faction: 'viking', tier: 2, isPlayer: false })).toBe('viking-t2')
    expect(resolveHumanoidAssetId({ ...ordinary, tier: 3 })).toBeUndefined()
    expect(resolveHumanoidAssetId(ordinary, 'roman-hero-t4')).toBe('roman-hero-t4')
    expect(resolveHumanoidAssetId(ordinary, 'bandit')).toBe('bandit')
    expect(resolveHumanoidAssetId({ ...ordinary, ordinarySoldier: false })).toBeUndefined()
    expect(resolveHumanoidAssetId({ ...ordinary, civilian: true, civilianStyle: 'viking' }, 'roman-hero-t4')).toBe('viking-civilian')
  })

  it('registers the bundled decoder before loading opted-in assets and propagates load failure', async () => {
    const { descriptor, load, decoder, plugin } = fixture('EXT_meshopt_compression')
    await expect(HumanoidAssetRegistry.preloadAsset(descriptor)).rejects.toThrow('transport unavailable')
    expect(decoder).toHaveBeenCalledExactlyOnceWith(MeshoptDecoder)
    expect(plugin).toHaveBeenCalledWith(multiInfluenceSkinningPlugin)
    expect(plugin.mock.invocationCallOrder.at(-1)).toBeLessThan(load.mock.invocationCallOrder[0])
    expect(decoder.mock.invocationCallOrder[0]).toBeLessThan(load.mock.invocationCallOrder[0])
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('keeps existing unmarked assets on the original loader path', async () => {
    const { descriptor, load, decoder, plugin } = fixture()
    await expect(HumanoidAssetRegistry.preloadAsset(descriptor)).rejects.toThrow('transport unavailable')
    expect(decoder).not.toHaveBeenCalled()
    expect(plugin).not.toHaveBeenCalledWith(multiInfluenceSkinningPlugin)
    expect(load).toHaveBeenCalledTimes(3)
  })
})
