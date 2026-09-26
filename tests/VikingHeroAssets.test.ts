import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { HumanoidAssetRegistry, validateHumanoidManifest, type HumanoidAssetDescriptor } from '../src/world/HumanoidAssetRegistry'
// @ts-expect-error Repository GLB tooling is JavaScript.
import { readGlb, loadRig } from '../tools/lib/humanoid-glb.mjs'

const directory = 'public/models/characters/v2/viking-hero-t4'
const manifest = JSON.parse(readFileSync(`${directory}/manifest.json`, 'utf8'))
const descriptor: HumanoidAssetDescriptor = { assetId: 'viking-hero-t4', faction: 'viking', heightM: 2, maxShoulderWidthM: .78, neckLengthM: .11 }

describe('independent hero asset', () => {
  it('requires its own stature contract and rejects wrong, blocked, or incomplete metadata', () => {
    expect(() => validateHumanoidManifest('viking', manifest)).toThrow('height')
    expect(() => validateHumanoidManifest('viking', manifest, descriptor)).not.toThrow()
    expect(() => validateHumanoidManifest('viking', { ...manifest, id: 'viking-tier2-v2' }, descriptor)).toThrow('id')
    expect(() => validateHumanoidManifest('viking', { ...manifest, status: 'blocked' }, descriptor)).toThrow('blocked')
    expect(() => validateHumanoidManifest('viking', { ...manifest, animations: undefined }, descriptor)).toThrow('bindings')
    expect(() => HumanoidAssetRegistry.createCharacterInstance({ faction: 'viking', tier: 2, isPlayer: false }, 'missing-hero')).toThrow('missing-hero')
  })

  it('loads all three exported GLBs with isolated skeletons/mixers and no faction horns', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => manifest } as Response)
    const loader = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async url => loadRig(readGlb(`public${url}`)))
    try {
      await HumanoidAssetRegistry.preloadAsset(descriptor)
      const config = { faction: 'viking' as const, tier: 2 as const, isPlayer: false }
      const a = HumanoidAssetRegistry.createCharacterInstance(config, descriptor.assetId)
      const b = HumanoidAssetRegistry.createCharacterInstance(config, descriptor.assetId)
      expect(a.root.scale.toArray()).toEqual([1, 1, 1])
      expect(a.skeleton).not.toBe(b.skeleton)
      expect(a.mixers).toHaveLength(3)
      for (let i = 0; i < 3; i++) expect(a.mixers[i]).not.toBe(b.mixers[i])
      expect(a.root.getObjectByName('viking-short-horns')).toBeUndefined()
      const before = b.rig.right.shoulder.quaternion.clone()
      a.rig.animation!.play('axeAttack2H', { fadeSeconds: 0, loop: false })
      a.rig.animation!.seek('axeAttack2H', .35)
      expect(b.rig.right.shoulder.quaternion.equals(before)).toBe(true)
      const lod = a.root.children.find(child => child instanceof THREE.LOD) as THREE.LOD
      const heroNodes = new Set<string>()
      lod.levels.forEach(level => {
        expect(level.object.getObjectByName('Hero_anatomical_scalp')).toBeDefined()
        for (const socket of ['socket_hand_l', 'socket_hand_r', 'socket_head', 'socket_pelvis', 'sole_l', 'sole_r']) expect(level.object.getObjectByName(socket)).toBeDefined()
        level.object.traverse(node => { if (node instanceof THREE.Bone) heroNodes.add(node.uuid) })
      })
      b.root.traverse(node => { if (node instanceof THREE.Bone) expect(heroNodes.has(node.uuid)).toBe(false) })
      a.dispose(); b.dispose()
    } finally { fetchMock.mockRestore(); loader.mockRestore() }
  })

  it.each(['head', 'socket_hand_r', 'idle'])('rejects a missing %s without substituting a normal character', async missing => {
    const assetId = `broken-${missing}`
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ ...manifest, id: assetId }) } as Response)
    const loader = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async () => {
      const gltf = await loadRig(readGlb(`${directory}/lod0.glb`))
      if (missing === 'idle') gltf.animations = gltf.animations.filter((clip: THREE.AnimationClip) => clip.name !== 'idle')
      else gltf.scene.getObjectByName(missing)!.removeFromParent()
      return gltf
    })
    try {
      await expect(HumanoidAssetRegistry.preloadAsset({ ...descriptor, assetId })).rejects.toThrow()
      expect(() => HumanoidAssetRegistry.createCharacterInstance({ faction: 'viking', tier: 2, isPlayer: false }, assetId)).toThrow(assetId)
    } finally { fetchMock.mockRestore(); loader.mockRestore() }
  })

  it.each([0, 1, 2])('LOD%d preserves existing animation timing and contains the optional cloth rig without a long beard', async lod => {
    const gltf = await loadRig(readGlb(`${directory}/lod${lod}.glb`))
    const base = JSON.parse(readFileSync('public/models/characters/v2/viking/manifest.json', 'utf8'))
    for (const binding of base.animations.embedded) {
      const clip = gltf.animations.find((clip: THREE.AnimationClip) => clip.name === binding.clip)
      expect(clip?.duration).toBeCloseTo(binding.duration, 5)
      expect(manifest.animations.embedded.find((item: { clip: string }) => item.clip === binding.clip).events).toEqual(binding.events)
    }
    gltf.scene.traverse((object: THREE.Object3D) => expect(/beard_lock/i.test(object.name)).toBe(false))
    for (const name of ['cape_upper', 'cape_mid', 'cape_lower']) expect(gltf.scene.getObjectByName(name)).toBeTruthy()
    for (const clip of gltf.animations) for (const track of clip.tracks) expect(Array.from(track.values).every(Number.isFinite)).toBe(true)
  })
})
