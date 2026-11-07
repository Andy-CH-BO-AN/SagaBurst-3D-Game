import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HorseAssetRegistry,
  validateHorseManifest,
  type HorseAssetManifest,
} from '../../src/world/HorseAssetRegistry'

// Manifest is ordinary compatibility data; no model, texture or mixer is loaded from disk.
const horseManifest = JSON.parse(readFileSync(new URL('../../public/models/mounts/v1/horse/manifest.json', import.meta.url), 'utf8')) as HorseAssetManifest
const armoredManifest = JSON.parse(readFileSync(new URL('../../public/models/mounts/v1/armored-horse/manifest.json', import.meta.url), 'utf8')) as HorseAssetManifest

type ManifestResponse = Pick<Response, 'ok' | 'status' | 'json'>
type ManifestFetch = (...args: Parameters<typeof fetch>) => Promise<ManifestResponse>

const fakeRenderer = {
  capabilities: { getMaxAnisotropy: () => 4 },
} as unknown as THREE.WebGLRenderer

function mockTexture(): THREE.CompressedTexture {
  const tex = Object.create(THREE.CompressedTexture.prototype) as THREE.CompressedTexture
  Object.assign(tex, {
    isCompressedTexture: true,
    version: 0,
    source: { needsUpdate: false },
    anisotropy: 1,
    colorSpace: THREE.NoColorSpace,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    repeat: new THREE.Vector2(1, 1),
    offset: new THREE.Vector2(0, 0),
    rotation: 0,
    center: new THREE.Vector2(0, 0),
    channel: 0,
  })
  return tex
}

function mockMaterial(): THREE.MeshStandardMaterial {
  const mat = Object.create(THREE.MeshStandardMaterial.prototype) as THREE.MeshStandardMaterial
  Object.assign(mat, {
    version: 0,
    name: 'mock-mat',
    map: mockTexture(),
    normalMap: null,
    roughnessMap: null,
    aoMap: null,
    metalness: 0,
    clone: () => mockMaterial(),
  })
  return mat
}

function createMockHorseGltf(manifest: HorseAssetManifest): GLTF {
  const objects = new Map<string, THREE.Object3D>()
  for (const socketName of manifest.sockets) {
    const obj = Object.create(THREE.Object3D.prototype) as THREE.Object3D
    Object.assign(obj, { name: socketName, children: [] })
    objects.set(socketName, obj)
  }
  for (const lodName of Object.values(manifest.lodNodes)) {
    const obj = Object.create(THREE.Object3D.prototype) as THREE.Object3D
    Object.assign(obj, { name: lodName, children: [] })
    objects.set(lodName, obj)
  }
  let firstMesh: THREE.SkinnedMesh | undefined
  for (const meshName of manifest.bodyMeshNames) {
    const mesh = Object.create(THREE.SkinnedMesh.prototype) as THREE.SkinnedMesh
    Object.assign(mesh, {
      name: meshName,
      material: mockMaterial(),
      children: [],
    })
    firstMesh ??= mesh
    objects.set(meshName, mesh)
  }
  const scene = Object.create(THREE.Group.prototype) as THREE.Group
  Object.assign(scene, {
    name: 'Scene',
    children: [...objects.values()],
    traverse: (cb: (obj: THREE.Object3D) => void) => {
      cb(scene)
      for (const obj of objects.values()) cb(obj)
    },
    getObjectByName: (name: string) => objects.get(name),
  })
  return {
    scene,
    scenes: [scene],
    animations: manifest.clips.map(name => ({ name }) as unknown as THREE.AnimationClip),
    cameras: [],
    asset: {},
    parser: { json: { textures: [], images: [] }, getDependency: async () => mockTexture() } as unknown as GLTF['parser'],
    userData: {},
  }
}

describe('horse asset compatibility & P2 loading isolation', () => {
  beforeEach(() => {
    HorseAssetRegistry.resetForTesting()
    vi.spyOn(KTX2Loader.prototype, 'detectSupport').mockReturnThis()
    vi.spyOn(KTX2Loader.prototype, 'dispose').mockReturnThis()
  })

  afterEach(() => {
    HorseAssetRegistry.resetForTesting()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('rejects a package missing the death state before loading its model', () => {
    const incomplete = structuredClone(horseManifest)
    incomplete.clips = incomplete.clips.filter(clip => clip !== 'death')
    expect(() => validateHorseManifest(incomplete)).toThrow('Horse manifest is missing death clip')
  })

  it('validates the rebuilt armored warhorse manifest contract', () => {
    expect(() => validateHorseManifest(armoredManifest)).not.toThrow()
    expect(armoredManifest.status).toBe('ready')
    expect(armoredManifest.metrics?.triangles.lod2).toBeLessThanOrEqual(7000)
  })

  it('completes and deduplicates ordinary preload while armored loading stays pending forever', async () => {
    type LoadBoundary = { load(renderer: THREE.WebGLRenderer): Promise<void>; loadArmored(renderer: THREE.WebGLRenderer): Promise<void> }
    const boundary = HorseAssetRegistry as unknown as LoadBoundary
    const ordinaryLoad = vi.spyOn(boundary, 'load').mockResolvedValue(undefined)
    const armoredLoad = vi.spyOn(boundary, 'loadArmored').mockReturnValue(new Promise<void>(() => {}))
    const first = HorseAssetRegistry.preload(fakeRenderer)
    expect(HorseAssetRegistry.preload(fakeRenderer)).toBe(first)
    let completed = false
    void first.then(() => { completed = true })
    // A fixed microtask drain fails promptly if ordinary preload waits for the unresolved package.
    for (let turn = 0; turn < 6; turn++) await Promise.resolve()
    expect(completed).toBe(true)
    expect(ordinaryLoad).toHaveBeenCalledTimes(1)
    expect(armoredLoad).toHaveBeenCalledTimes(1)
  })

  it('retries a rejected ordinary preload while retaining Promise deduplication', async () => {
    type LoadBoundary = { load(renderer: THREE.WebGLRenderer): Promise<void>; loadArmored(renderer: THREE.WebGLRenderer): Promise<void> }
    const boundary = HorseAssetRegistry as unknown as LoadBoundary
    const load = vi.spyOn(boundary, 'load').mockRejectedValueOnce(new Error('ordinary unavailable')).mockResolvedValue(undefined)
    vi.spyOn(boundary, 'loadArmored').mockResolvedValue(undefined)
    const failed = HorseAssetRegistry.preload(fakeRenderer)
    expect(HorseAssetRegistry.preload(fakeRenderer)).toBe(failed)
    await expect(failed).rejects.toThrow('ordinary unavailable')
    const retry = HorseAssetRegistry.preload(fakeRenderer)
    expect(HorseAssetRegistry.preload(fakeRenderer)).toBe(retry)
    await expect(retry).resolves.toBeUndefined()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('loads both ordinary and armored horses when both assets succeed', async () => {
    vi.stubGlobal('fetch', vi.fn<ManifestFetch>(async (url) => ({
      ok: true,
      status: 200,
      json: async () => String(url).includes('armored-horse') ? structuredClone(armoredManifest) : structuredClone(horseManifest),
    })))
    vi.spyOn(KTX2Loader.prototype, 'loadAsync').mockImplementation(async () => mockTexture())
    vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async (url) =>
      createMockHorseGltf(String(url).includes('armored-horse') ? armoredManifest : horseManifest),
    )

    await Promise.all([HorseAssetRegistry.preload(fakeRenderer), HorseAssetRegistry.preloadArmored(fakeRenderer)])
    expect(HorseAssetRegistry.ready).toBe(true)
    expect(HorseAssetRegistry.armoredReady).toBe(true)

    expect(HorseAssetRegistry.resolveTemplate({ variant: 1 }).manifest.id).toBe(horseManifest.id)
    expect(HorseAssetRegistry.resolveTemplate({ armored: true }).manifest.id).toBe(armoredManifest.id)
  })

  it('keeps ordinary horse usable when armored horse GLB returns 404, and throws explicitly if armored horse is requested', async () => {
    vi.stubGlobal('fetch', vi.fn<ManifestFetch>(async (url) => ({
      ok: true,
      status: 200,
      json: async () => String(url).includes('armored-horse') ? structuredClone(armoredManifest) : structuredClone(horseManifest),
    })))
    vi.spyOn(KTX2Loader.prototype, 'loadAsync').mockImplementation(async () => mockTexture())
    vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async (url) => {
      if (String(url).includes('armored-horse')) throw new Error('Armored horse GLB 404')
      return createMockHorseGltf(horseManifest)
    })

    const ordinary = HorseAssetRegistry.preload(fakeRenderer)
    await Promise.all([expect(ordinary).resolves.toBeUndefined(),
      expect(HorseAssetRegistry.preloadArmored(fakeRenderer)).rejects.toThrow('Armored horse GLB 404')])
    expect(HorseAssetRegistry.ready).toBe(true)
    expect(HorseAssetRegistry.armoredReady).toBe(false)

    expect(HorseAssetRegistry.resolveTemplate().manifest.id).toBe(horseManifest.id)
    // Player selected armored horse while asset is unavailable -> explicit error, never silent fallback
    expect(() => HorseAssetRegistry.createInstance({ armored: true })).toThrow('Armored horse GLB 404')
  })

  it('keeps ordinary horse unaffected when armored horse manifest is malformed', async () => {
    const brokenArmoredManifest = { ...structuredClone(armoredManifest), status: 'blocked' as const, reason: 'corrupt manifest' }
    vi.stubGlobal('fetch', vi.fn<ManifestFetch>(async (url) => ({
      ok: true,
      status: 200,
      json: async () => String(url).includes('armored-horse') ? brokenArmoredManifest : structuredClone(horseManifest),
    })))
    vi.spyOn(KTX2Loader.prototype, 'loadAsync').mockImplementation(async () => mockTexture())
    vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async () => createMockHorseGltf(horseManifest))

    const ordinary = HorseAssetRegistry.preload(fakeRenderer)
    await Promise.all([expect(ordinary).resolves.toBeUndefined(),
      expect(HorseAssetRegistry.preloadArmored(fakeRenderer)).rejects.toThrow('Horse asset is blocked: corrupt manifest')])
    expect(HorseAssetRegistry.ready).toBe(true)
    expect(HorseAssetRegistry.armoredReady).toBe(false)
    expect(HorseAssetRegistry.resolveTemplate().manifest.id).toBe(horseManifest.id)
    expect(() => HorseAssetRegistry.createInstance({ armored: true })).toThrow('Horse asset is blocked: corrupt manifest')
  })

  it('isolates armored horse KTX2 texture failure without breaking ordinary horse, and recovers on retry without duplicate ordinary loads', async () => {
    let failArmoredKtx2 = true
    let ordinaryGlbLoads = 0
    let armoredGlbLoads = 0

    vi.stubGlobal('fetch', vi.fn<ManifestFetch>(async (url) => ({
      ok: true,
      status: 200,
      json: async () => String(url).includes('armored-horse') ? structuredClone(armoredManifest) : structuredClone(horseManifest),
    })))
    vi.spyOn(KTX2Loader.prototype, 'loadAsync').mockImplementation(async (url) => {
      if (failArmoredKtx2 && String(url).includes('armored-horse')) {
        throw new Error('Armored KTX2 transcode failed')
      }
      return mockTexture()
    })
    vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async (url) => {
      if (String(url).includes('armored-horse')) {
        armoredGlbLoads++
        return createMockHorseGltf(armoredManifest)
      }
      ordinaryGlbLoads++
      return createMockHorseGltf(horseManifest)
    })

    const ordinary = HorseAssetRegistry.preload(fakeRenderer)
    await Promise.all([expect(ordinary).resolves.toBeUndefined(),
      expect(HorseAssetRegistry.preloadArmored(fakeRenderer)).rejects.toThrow('Armored KTX2 transcode failed')])
    expect(HorseAssetRegistry.ready).toBe(true)
    expect(HorseAssetRegistry.armoredReady).toBe(false)
    expect(ordinaryGlbLoads).toBe(1)
    expect(armoredGlbLoads).toBe(1)
    expect(HorseAssetRegistry.resolveTemplate().manifest.id).toBe(horseManifest.id)
    expect(() => HorseAssetRegistry.createInstance({ armored: true })).toThrow('Armored KTX2 transcode failed')

    // Recover and retry concurrently -> coalesces into a single retry without reloading ordinary horse
    failArmoredKtx2 = false
    const p1 = HorseAssetRegistry.preloadArmored(fakeRenderer)
    const p2 = HorseAssetRegistry.preloadArmored(fakeRenderer)
    expect(p1).toBe(p2)
    await Promise.all([p1, p2])
    expect(ordinaryGlbLoads).toBe(1)
    expect(armoredGlbLoads).toBe(2)
    expect(HorseAssetRegistry.armoredReady).toBe(true)
    expect(HorseAssetRegistry.resolveTemplate({ armored: true }).manifest.id).toBe(armoredManifest.id)
  })
})
