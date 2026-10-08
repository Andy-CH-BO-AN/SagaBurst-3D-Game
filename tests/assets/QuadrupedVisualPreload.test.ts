import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi, type MockInstance } from 'vitest'
import { loadTestGlbAsset } from '../helpers/testGlbAsset'

type VisualClass = typeof import('../../src/world/CorgiVisual').CorgiVisual
  | typeof import('../../src/world/BlackCatVisual').BlackCatVisual

const species = [
  { name: 'corgi', prefix: 'corgi', directory: 'corgi', getVisual: async (): Promise<VisualClass> => (await import('../../src/world/CorgiVisual')).CorgiVisual },
  { name: 'black cat', prefix: 'cat', directory: 'black-cat', getVisual: async (): Promise<VisualClass> => (await import('../../src/world/BlackCatVisual')).BlackCatVisual },
]

describe.each(species)('$name visual preload wiring', ({ prefix, directory, getVisual }) => {
  let parsed: GLTF | undefined
  let fixture: GLTF
  let Visual: VisualClass
  let request: ReturnType<typeof vi.fn<typeof fetch>>
  let load: MockInstance<GLTFLoader['loadAsync']>
  const base = `/contract/models/mounts/v2/${directory}`

  // Real shipped rig/clip data tests species configuration and instance wiring.
  // HTTP and loader I/O are doubled; the Node parser omits image/material payloads.
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
    request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status: 'ready', forward: '+Z', source: { license: 'fixture' }, file: 'declared.glb' })))
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

  it('loads its configured path and body prefix into a skinned instance', async () => {
    await Visual.preload()
    expect(request).toHaveBeenCalledExactlyOnceWith(`${base}/manifest.json`, { cache: 'no-cache' })
    expect(load).toHaveBeenCalledExactlyOnceWith(`${base}/declared.glb`)
    const visual = new Visual()
    onTestFinished(() => visual.dispose())
    expect(visual.lod.levels.map(level => level.object.name)).toEqual([0, 1, 2].map(index => `${prefix}_body_lod${index}`))
    expect(visual.saddleSeat).toBe(visual.root.getObjectByName('socket_saddle_seat'))
    expect(visual.debugState().clip).toBe('idle')
    expect(visual.skeleton.bones.length).toBeGreaterThan(0)
  })

  it('rejects instance creation when its named body has no fitted skin', async () => {
    const body = fixture.scene.getObjectByName(`${prefix}_body_lod0`)
    if (!(body instanceof THREE.SkinnedMesh) || !body.parent) throw new Error('Shipped fixture body is not skinned')
    const unskinned = new THREE.Mesh(body.geometry, body.material)
    unskinned.name = body.name
    body.parent.add(unskinned)
    body.removeFromParent()
    await Visual.preload()
    expect(() => new Visual()).toThrow(/body has no fitted skeleton/)
  })
})
