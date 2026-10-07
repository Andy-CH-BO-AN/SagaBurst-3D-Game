import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi, type MockInstance } from 'vitest'
import { loadTestGlbAsset } from '../helpers/testGlbAsset'

type VisualClass = typeof import('../../src/world/CorgiVisual').CorgiVisual
  | typeof import('../../src/world/BlackCatVisual').BlackCatVisual

interface ManifestFixture {
  status: string
  forward: string
  source: { license: string }
  file: string
}

const species = [
  { name: 'corgi', prefix: 'corgi', directory: 'corgi', getVisual: async (): Promise<VisualClass> => (await import('../../src/world/CorgiVisual')).CorgiVisual },
  { name: 'black cat', prefix: 'cat', directory: 'black-cat', getVisual: async (): Promise<VisualClass> => (await import('../../src/world/BlackCatVisual')).BlackCatVisual },
]

describe.each(species)('$name visual preload contract', ({ prefix, directory, getVisual }) => {
  let parsed: GLTF | undefined
  let fixture: GLTF
  let manifest: ManifestFixture
  let Visual: VisualClass
  let request: ReturnType<typeof vi.fn<typeof fetch>>
  let load: MockInstance<GLTFLoader['loadAsync']>
  const base = `/contract/models/mounts/v2/${directory}`

  // Shipped geometry/rig/clips are parsed once; HTTP and loader I/O are the only doubles.
  // The Node parser deliberately omits image/material payloads.
  beforeAll(async () => {
    parsed = await loadTestGlbAsset(`public/models/mounts/v2/${directory}/${directory === 'corgi' ? 'corgi' : 'black-cat'}.glb`)
  })

  beforeEach(async () => {
    vi.resetModules()
    vi.stubEnv('BASE_URL', '/contract/')
    if (!parsed) throw new Error('Shipped fixture was not parsed')
    const scene = cloneSkeleton(parsed.scene)
    if (!(scene instanceof THREE.Group)) throw new Error('Shipped fixture scene is not a Group')
    fixture = { ...parsed, scene, scenes: [scene], animations: [...parsed.animations] }
    manifest = { status: 'ready', forward: '+Z', source: { license: 'fixture' }, file: 'declared.glb' }
    request = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify(manifest), { status: 200 }))
    vi.stubGlobal('fetch', request)
    load = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValue(fixture)
    Visual = await getVisual()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  afterAll(() => {
    if (!parsed) return
    const geometries = new Set<THREE.BufferGeometry>()
    const materials = new Set<THREE.Material>()
    parsed.scene.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return
      geometries.add(object.geometry)
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material)
    })
    for (const geometry of geometries) geometry.dispose()
    for (const material of materials) material.dispose()
  })

  it('rejects instance creation before preload', () => {
    expect(() => new Visual()).toThrow(/assets were not preloaded/)
    expect(request).not.toHaveBeenCalled()
    expect(load).not.toHaveBeenCalled()
  })

  it('coalesces concurrent preload and creates an instance from the declared asset path', async () => {
    const first = Visual.preload()
    const second = Visual.preload()
    expect(second).toBe(first)
    await Promise.all([first, second])
    expect(request).toHaveBeenCalledExactlyOnceWith(`${base}/manifest.json`, { cache: 'no-cache' })
    expect(load).toHaveBeenCalledExactlyOnceWith(`${base}/declared.glb`)
    const visual = new Visual()
    onTestFinished(() => visual.dispose())
    expect(visual.saddleSeat.name).toBe('socket_saddle_seat')
    expect(visual.debugState().clip).toBe('idle')
    expect(visual.skeleton.bones.length).toBeGreaterThan(0)
  })

  it.each([404, 500])('rejects manifest HTTP %s without publishing a partial template', async status => {
    request.mockResolvedValueOnce(new Response('', { status }))
    await expect(Visual.preload()).rejects.toThrow(`manifest (${status})`)
    expect(load).not.toHaveBeenCalled()
    expect(() => new Visual()).toThrow(/assets were not preloaded/)
  })

  it.each(['status', 'forward', 'license'] as const)('rejects invalid manifest %s before loading the GLB', async field => {
    if (field === 'status') manifest.status = 'draft'
    else if (field === 'forward') manifest.forward = '-Z'
    else manifest.source.license = ''
    await expect(Visual.preload()).rejects.toThrow(/asset has not passed/)
    expect(load).not.toHaveBeenCalled()
    expect(() => new Visual()).toThrow(/assets were not preloaded/)
  })

  it.each(['idle', 'walk', 'run', 'death'])('rejects missing required %s clip without publishing a template', async clip => {
    fixture.animations = fixture.animations.filter(animation => animation.name !== clip)
    await expect(Visual.preload()).rejects.toThrow(`missing ${clip}`)
    expect(() => new Visual()).toThrow(/assets were not preloaded/)
  })

  it.each(['body_lod0', 'body_lod1', 'body_lod2', 'seat'] as const)('rejects missing runtime %s node without publishing a template', async node => {
    const name = node === 'seat' ? 'socket_saddle_seat' : `${prefix}_${node}`
    const object = fixture.scene.getObjectByName(name)
    if (!object) throw new Error(`Shipped fixture is missing ${name}`)
    object.removeFromParent()
    await expect(Visual.preload()).rejects.toThrow(`missing ${name}`)
    expect(() => new Visual()).toThrow(/assets were not preloaded/)
  })

  it('propagates loader failure and permits a fresh preload retry', async () => {
    const malformed = new Error('Malformed GLB')
    load.mockRejectedValueOnce(malformed)
    await expect(Visual.preload()).rejects.toBe(malformed)
    expect(() => new Visual()).toThrow(/assets were not preloaded/)
    await expect(Visual.preload()).resolves.toBeUndefined()
    expect(request).toHaveBeenCalledTimes(2)
    expect(load).toHaveBeenCalledTimes(2)
    const visual = new Visual()
    onTestFinished(() => visual.dispose())
    expect(visual.debugState().clip).toBe('idle')
  })

  it('rejects instance creation when the named body has no fitted skin', async () => {
    const body = fixture.scene.getObjectByName(`${prefix}_body_lod0`)
    if (!(body instanceof THREE.SkinnedMesh) || !body.parent) throw new Error('Shipped fixture body is not skinned')
    const unskinned = new THREE.Mesh(body.geometry, body.material)
    unskinned.name = body.name
    body.parent.add(unskinned)
    body.removeFromParent()
    await Visual.preload()
    expect(() => new Visual()).toThrow(/body has no fitted skeleton/)
  })

  it.each(['jump', 'land', 'hit'] as const)('ignores an unavailable optional %s clip without disturbing idle', async clip => {
    fixture.animations = fixture.animations.filter(animation => animation.name !== clip)
    await Visual.preload()
    const visual = new Visual()
    onTestFinished(() => visual.dispose())
    expect(() => visual.playOnce(clip)).not.toThrow()
    expect(visual.debugState().clip).toBe('idle')
    expect(() => visual.playStudioClip(clip)).not.toThrow()
    expect(visual.debugState().clip).toBe('idle')
  })
})
