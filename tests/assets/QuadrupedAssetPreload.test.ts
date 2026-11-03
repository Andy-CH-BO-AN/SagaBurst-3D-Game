import { GLTFLoader,type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { afterEach,describe,expect,it,vi } from 'vitest';
import { createQuadrupedAssetPreload } from '../../src/world/QuadrupedAssetPreload';
import { QUADRUPED_STUDIO_CLIPS } from '../../src/world/QuadrupedMountAnimation';
import felineMountBuilderSource from '../../tools/blender/build_feline_mounts.mjs?raw';
import whiteCatManifest from '../../public/models/mounts/v2/white-cat/manifest.json';
import whiteCatBoneMap from '../../public/models/mounts/v2/white-cat/bone-map.json';
import whiteCatAnimSource from '../../public/models/mounts/v2/white-cat/animation-source.json';
import whiteCatAssetReport from '../../public/models/mounts/v2/white-cat/asset-report.json';
import whiteCatCredits from '../../public/models/mounts/v2/white-cat/CREDITS.md?raw';
import whiteCatGlbUrl from '../../public/models/mounts/v2/white-cat/white-cat.glb?url';
import orangeCatManifest from '../../public/models/mounts/v2/orange-cat/manifest.json';
import orangeCatBoneMap from '../../public/models/mounts/v2/orange-cat/bone-map.json';
import orangeCatAnimSource from '../../public/models/mounts/v2/orange-cat/animation-source.json';
import orangeCatAssetReport from '../../public/models/mounts/v2/orange-cat/asset-report.json';
import orangeCatCredits from '../../public/models/mounts/v2/orange-cat/CREDITS.md?raw';
import orangeCatGlbUrl from '../../public/models/mounts/v2/orange-cat/orange-cat.glb?url';
import servalManifest from '../../public/models/mounts/v2/serval/manifest.json';
import servalBoneMap from '../../public/models/mounts/v2/serval/bone-map.json';
import servalAnimSource from '../../public/models/mounts/v2/serval/animation-source.json';
import servalAssetReport from '../../public/models/mounts/v2/serval/asset-report.json';
import servalCredits from '../../public/models/mounts/v2/serval/CREDITS.md?raw';
import servalGlbUrl from '../../public/models/mounts/v2/serval/serval.glb?url';
import caracalManifest from '../../public/models/mounts/v2/caracal/manifest.json';
import caracalBoneMap from '../../public/models/mounts/v2/caracal/bone-map.json';
import caracalAnimSource from '../../public/models/mounts/v2/caracal/animation-source.json';
import caracalAssetReport from '../../public/models/mounts/v2/caracal/asset-report.json';
import caracalCredits from '../../public/models/mounts/v2/caracal/CREDITS.md?raw';
import caracalGlbUrl from '../../public/models/mounts/v2/caracal/caracal.glb?url';

// HTTP is an external boundary; constructing Node Response would initialize Undici.
// The real preload consumes only these fields, so no browser transport is needed.
type ManifestResponse = Pick<Response, 'ok' | 'status' | 'json'>
type ManifestFetch = (...args: Parameters<typeof fetch>) => Promise<ManifestResponse>

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('quadruped preload error ownership', () => {
  it('coalesces a failed request and retries without publishing an incomplete asset', async () => {
    const request = vi.fn<ManifestFetch>().mockResolvedValue({ ok: false, status: 503, json: async () => null })
    vi.stubGlobal('fetch', request)
    const publish = vi.fn<(template: GLTF) => void>()
    const loader = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockRejectedValue(new Error('unavailable'))
    const preload = createQuadrupedAssetPreload({ baseUrl: '/mount', name: 'Horse', bodyPrefix: 'horse' }, publish)
    const first = preload()
    expect(preload()).toBe(first)
    await expect(first).rejects.toThrow('Cannot load horse manifest (503)')
    expect(loader).not.toHaveBeenCalled()
    request.mockResolvedValue({ ok: true, status: 200, json: async () => ({ status: 'ready', forward: '+Z', source: { license: 'fixture' }, file: 'horse.glb' }) })
    const retry = preload()
    expect(retry).not.toBe(first)
    await expect(retry).rejects.toThrow('unavailable')
    expect(loader).toHaveBeenCalledExactlyOnceWith('/mount/horse.glb')
    expect(publish).not.toHaveBeenCalled()
  })

  it('rejects an unapproved manifest before loading or publication', async () => {
    vi.stubGlobal('fetch', vi.fn<ManifestFetch>().mockResolvedValue({ ok: true, status: 200, json: async () => ({ status: 'draft', forward: '+Z', source: { license: 'fixture' } }) }))
    const publish = vi.fn<(template: GLTF) => void>()
    const loader = vi.spyOn(GLTFLoader.prototype, 'loadAsync')
    const preload = createQuadrupedAssetPreload({ baseUrl: '/mount', name: 'Horse', bodyPrefix: 'horse' }, publish)
    await expect(preload()).rejects.toThrow('Horse asset has not passed source and visual validation')
    expect(loader).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })

  it('validates the four feline mount manifests, source preservation reports and baked clip contracts', () => {
    const bundles = [
      { id: 'white-cat', sha256: 'a5cd03601031dc1f5c0b0370cfe1e010f9807727effe06df29f73cd3bd1fb7f7', manifest: whiteCatManifest, boneMap: whiteCatBoneMap, anim: whiteCatAnimSource, report: whiteCatAssetReport, credits: whiteCatCredits, url: whiteCatGlbUrl, expectedSeatY: 1.266 },
      { id: 'orange-cat', sha256: 'f4f9060eb94225a115fcf796500afce3abeb116a120782da0e949a4edda894fb', manifest: orangeCatManifest, boneMap: orangeCatBoneMap, anim: orangeCatAnimSource, report: orangeCatAssetReport, credits: orangeCatCredits, url: orangeCatGlbUrl, expectedSeatY: 1.266 },
      { id: 'serval', sha256: 'e213aefe3d6ade578cf0510b5a0a1fecd19fa84e378b4810e8234dfdcc82a9cf', manifest: servalManifest, boneMap: servalBoneMap, anim: servalAnimSource, report: servalAssetReport, credits: servalCredits, url: servalGlbUrl, expectedSeatY: 1.778 },
      { id: 'caracal', sha256: 'c3e5a270da8381e6c9512f857faee7dbd03c58af2310e6cc282cd0977f9fe849', manifest: caracalManifest, boneMap: caracalBoneMap, anim: caracalAnimSource, report: caracalAssetReport, credits: caracalCredits, url: caracalGlbUrl, expectedSeatY: 1.782 },
    ] as const
    for (const bundle of bundles) {
      expect(felineMountBuilderSource).toContain(bundle.sha256)
      expect(bundle.manifest.status).toBe('ready')
      expect(bundle.manifest.forward).toBe('+Z')
      expect(bundle.manifest.file).toBe(`${bundle.id}.glb`)
      expect(bundle.manifest.source.sourceSha256).toBe(bundle.sha256)
      expect(bundle.manifest.metrics.saddleHeightM).toBeCloseTo(bundle.expectedSeatY, 3)
      expect(bundle.report.sourceContract.finalBodyTriangles).toBe(bundle.report.sourceContract.sourceTriangles)
      expect(bundle.report.sourceContract.matchedSourceTriangles).toBe(bundle.report.sourceContract.sourceTriangles)
      expect(bundle.boneMap.bones.Bone_000.donorBone).toBe('cat_torso')
      expect(bundle.anim.bake.clips.map(c => c.name).sort()).toEqual([...QUADRUPED_STUDIO_CLIPS].sort())
      expect(bundle.credits).toContain(bundle.sha256)
      expect(bundle.url).toContain(`${bundle.id}.glb`)
    }
  })
})
