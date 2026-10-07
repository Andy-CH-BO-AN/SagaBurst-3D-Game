import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { createQuadrupedAssetPreload } from '../../src/world/QuadrupedAssetPreload'

interface ManifestFixture {
  status: string
  forward: string
  source: { license: string }
  file: string
}

describe('shared quadruped asset preload', () => {
  let fixture: GLTF
  let manifest: ManifestFixture
  let preload: () => Promise<void>
  let publish: ReturnType<typeof vi.fn<(template: GLTF) => void>>
  let request: ReturnType<typeof vi.fn<typeof fetch>>
  let load: MockInstance<GLTFLoader['loadAsync']>
  let geometry: THREE.BufferGeometry | undefined
  let material: THREE.Material | undefined

  beforeEach(async () => {
    // Minimal parsed scene: this contract checks validation and publication, not shipped art.
    fixture = await new GLTFLoader().parseAsync(JSON.stringify({
      asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0, 1, 2, 3] }],
      nodes: ['fixture_body_lod0', 'fixture_body_lod1', 'fixture_body_lod2', 'socket_saddle_seat'].map(name => ({ name })),
    }), '')
    fixture.animations = ['idle', 'walk', 'run', 'death', 'jump', 'land', 'hit'].map(name => new THREE.AnimationClip(name, 1, []))
    geometry = new THREE.BufferGeometry()
    material = new THREE.MeshBasicMaterial()
    fixture.scene.add(new THREE.Mesh(geometry, material))
    manifest = { status: 'ready', forward: '+Z', source: { license: 'fixture' }, file: 'declared.glb' }
    request = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify(manifest), { status: 200 }))
    vi.stubGlobal('fetch', request)
    load = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValue(fixture)
    publish = vi.fn<(template: GLTF) => void>()
    preload = createQuadrupedAssetPreload({ baseUrl: '/contract/animal', name: 'Fixture animal', bodyPrefix: 'fixture' }, publish)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    geometry?.dispose()
    material?.dispose()
    geometry = undefined
    material = undefined
  })

  it('coalesces concurrent requests and publishes the validated template once', async () => {
    const decoder = vi.spyOn(GLTFLoader.prototype, 'setMeshoptDecoder')
    expect(publish).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
    const first = preload()
    const second = preload()
    expect(second).toBe(first)
    expect(publish).not.toHaveBeenCalled()
    await Promise.all([first, second])
    expect(request).toHaveBeenCalledExactlyOnceWith('/contract/animal/manifest.json', { cache: 'no-cache' })
    expect(decoder).toHaveBeenCalledExactlyOnceWith(MeshoptDecoder)
    expect(load).toHaveBeenCalledExactlyOnceWith('/contract/animal/declared.glb')
    expect(publish).toHaveBeenCalledExactlyOnceWith(fixture)
    fixture.scene.traverse(object => {
      if (object instanceof THREE.Mesh) expect([object.castShadow, object.receiveShadow]).toEqual([true, true])
    })
    expect(preload()).toBe(first)
    expect(request).toHaveBeenCalledTimes(1)
    expect(publish).toHaveBeenCalledTimes(1)
  })

  it('rejects a failed manifest response before loading or publishing an asset', async () => {
    request.mockResolvedValueOnce(new Response('', { status: 500 }))
    await expect(preload()).rejects.toThrow('Cannot load fixture animal manifest (500)')
    expect(load).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })

  it.each(['status', 'forward', 'license'] as const)('rejects invalid manifest %s before loading or publishing', async field => {
    if (field === 'status') manifest.status = 'draft'
    else if (field === 'forward') manifest.forward = '-Z'
    else manifest.source.license = ''
    await expect(preload()).rejects.toThrow('Fixture animal asset has not passed source and visual validation')
    expect(load).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })

  it.each(['idle', 'walk', 'run', 'death'])('rejects a missing required %s clip without publishing', async clip => {
    fixture.animations = fixture.animations.filter(animation => animation.name !== clip)
    await expect(preload()).rejects.toThrow(`Fixture animal is missing ${clip}`)
    expect(publish).not.toHaveBeenCalled()
  })

  it.each(['fixture_body_lod0', 'fixture_body_lod1', 'fixture_body_lod2', 'socket_saddle_seat'])('rejects a missing runtime node %s without publishing', async name => {
    const object = fixture.scene.getObjectByName(name)
    if (!object) throw new Error(`Fixture is missing ${name}`)
    object.removeFromParent()
    await expect(preload()).rejects.toThrow(`Fixture animal is missing ${name}`)
    expect(publish).not.toHaveBeenCalled()
  })

  it('propagates loader failure without publication and permits a fresh retry', async () => {
    const malformed = new Error('Malformed GLB')
    load.mockRejectedValueOnce(malformed)
    const first = preload()
    await expect(first).rejects.toBe(malformed)
    expect(publish).not.toHaveBeenCalled()
    const retry = preload()
    expect(retry).not.toBe(first)
    await expect(retry).resolves.toBeUndefined()
    expect(request).toHaveBeenCalledTimes(2)
    expect(load).toHaveBeenCalledTimes(2)
    expect(publish).toHaveBeenCalledExactlyOnceWith(fixture)
  })

  it('accepts a template with required clips and no optional jump, land or hit', async () => {
    fixture.animations = fixture.animations.filter(animation => !['jump', 'land', 'hit'].includes(animation.name))
    await expect(preload()).resolves.toBeUndefined()
    expect(publish).toHaveBeenCalledExactlyOnceWith(fixture)
    expect(fixture.animations.map(animation => animation.name)).toEqual(['idle', 'walk', 'run', 'death'])
  })
})
