import { GLTFLoader,type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { afterEach,describe,expect,it,vi } from 'vitest';
import { createQuadrupedAssetPreload } from '../../src/world/QuadrupedAssetPreload';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('quadruped preload error ownership', () => {
  it('coalesces a failed request and retries without publishing an incomplete asset', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 503 }))
    vi.stubGlobal('fetch', request)
    const publish = vi.fn<(template: GLTF) => void>()
    const loader = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockRejectedValue(new Error('unavailable'))
    const preload = createQuadrupedAssetPreload({ baseUrl: '/mount', name: 'Horse', bodyPrefix: 'horse' }, publish)
    const first = preload()
    expect(preload()).toBe(first)
    await expect(first).rejects.toThrow('Cannot load horse manifest (503)')
    expect(loader).not.toHaveBeenCalled()
    request.mockResolvedValue(new Response(JSON.stringify({ status: 'ready', forward: '+Z', source: { license: 'fixture' }, file: 'horse.glb' })))
    const retry = preload()
    expect(retry).not.toBe(first)
    await expect(retry).rejects.toThrow('unavailable')
    expect(loader).toHaveBeenCalledExactlyOnceWith('/mount/horse.glb')
    expect(publish).not.toHaveBeenCalled()
  })

  it('rejects an unapproved manifest before loading or publication', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status: 'draft', forward: '+Z', source: { license: 'fixture' } }))))
    const publish = vi.fn<(template: GLTF) => void>()
    const loader = vi.spyOn(GLTFLoader.prototype, 'loadAsync')
    const preload = createQuadrupedAssetPreload({ baseUrl: '/mount', name: 'Horse', bodyPrefix: 'horse' }, publish)
    await expect(preload()).rejects.toThrow('Horse asset has not passed source and visual validation')
    expect(loader).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })
})
