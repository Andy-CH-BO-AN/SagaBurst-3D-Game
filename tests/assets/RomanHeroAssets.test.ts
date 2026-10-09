import { readFileSync } from 'node:fs'
import { HERO_ASSETS } from '../../src/world/HeroAssetCatalog'
import { describe, expect, it, vi, onTestFinished } from 'vitest'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { HumanoidAssetRegistry, validateHumanoidManifest, type HumanoidAssetDescriptor } from '../../src/world/HumanoidAssetRegistry'
// @ts-expect-error Repository offline tooling is JavaScript.
import { readGlb, loadRig } from '../../tools/lib/humanoid-glb.mjs'

const directory = 'public/models/characters/v2/roman-hero-t4'
const manifest = JSON.parse(readFileSync(`${directory}/manifest.json`, 'utf8'))
const descriptor: HumanoidAssetDescriptor = HERO_ASSETS['roman-hero-t4'].descriptor

describe('Roman T4 independent appearance asset', () => {
  it('uses a separate stature contract without relaxing ordinary Romans', () => {
    expect(() => validateHumanoidManifest('roman', manifest)).toThrow('height')
    expect(() => validateHumanoidManifest('roman', manifest, descriptor)).not.toThrow()
    expect(() => validateHumanoidManifest('roman', { ...manifest, id: 'roman-tier2-v2' }, descriptor)).toThrow('id')
    expect(() => validateHumanoidManifest('roman', { ...manifest, status: 'blocked' }, descriptor)).toThrow('blocked')
    expect(() => validateHumanoidManifest('roman', { ...manifest, animations: undefined }, descriptor)).toThrow('bindings')
  })

  it('loads every LOD with independent skeletons/mixers and skips the ordinary Roman hash optimization', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => manifest } as Response)
    const loader = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async url => loadRig(readGlb(`public${url}`)))
    const warning = vi.spyOn(console, 'warn')
    try {
      await HumanoidAssetRegistry.preloadAsset(descriptor)
      const config = { faction: 'roman' as const, tier: 2 as const, isPlayer: false }
      const a = HumanoidAssetRegistry.createCharacterInstance(config, descriptor.assetId)
      const b = HumanoidAssetRegistry.createCharacterInstance(config, descriptor.assetId)
      onTestFinished(() => { a.dispose(); b.dispose() })
      expect(a.root.scale.toArray()).toEqual([1, 1, 1])
      expect(a.skeleton).not.toBe(b.skeleton)
      expect(a.mixers).toHaveLength(3)
      for (let i = 0; i < 3; i++) expect(a.mixers[i]).not.toBe(b.mixers[i])
      const bones = new Set<string>()
      a.root.traverse(node => { if (node instanceof THREE.Bone) bones.add(node.uuid) })
      b.root.traverse(node => { if (node instanceof THREE.Bone) expect(bones.has(node.uuid)).toBe(false) })
      const lod = a.root.children.find(child => child instanceof THREE.LOD) as THREE.LOD
      for (const level of lod.levels) {
        expect(level.object.userData.humanoidLod2RepresentationControl).toBeUndefined()
        for (const name of ['hips', 'head', 'socket_hand_r', 'socket_hand_l', 'socket_pelvis', 'socket_back', 'socket_head', 'socket_foot_l', 'socket_foot_r', 'sole_l', 'sole_r']) expect(level.object.getObjectByName(name)).toBeDefined()
      }
      const before = b.rig.right.shoulder.quaternion.clone()
      a.rig.animation!.play('swordSlash', { fadeSeconds: 0, loop: false })
      a.rig.animation!.update(.001)
      a.rig.animation!.seek('swordSlash', .5)
      a.rig.animation!.update(0)
      expect(b.rig.right.shoulder.quaternion.equals(before)).toBe(true)
      expect(warning.mock.calls.flat().join(' ')).not.toContain('does not match audited')
    } finally { fetchMock.mockRestore(); loader.mockRestore(); warning.mockRestore() }
  })

  it.each(['head', 'socket_hand_r', 'idle', 'axeAttack1H', 'axeAttack2H'])('rejects missing %s without a fallback Roman', async missing => {
    const assetId = `broken-roman-${missing}`
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ ...manifest, id: assetId }) } as Response)
    const loader = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async () => {
      const gltf = await loadRig(readGlb(`${directory}/lod0.glb`))
      if (['idle', 'axeAttack1H', 'axeAttack2H'].includes(missing)) gltf.animations = gltf.animations.filter((clip: THREE.AnimationClip) => clip.name !== missing)
      else gltf.scene.getObjectByName(missing)!.removeFromParent()
      return gltf
    })
    try {
      await expect(HumanoidAssetRegistry.preloadAsset({ ...descriptor, assetId })).rejects.toThrow()
      expect(() => HumanoidAssetRegistry.createCharacterInstance({ faction: 'roman', tier: 2, isPlayer: false }, assetId)).toThrow(assetId)
    } finally { fetchMock.mockRestore(); loader.mockRestore() }
  })

  it('surfaces a missing GLB and leaves no ready hero template', async () => {
    const assetId = 'missing-roman-glb'
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ ...manifest, id: assetId }) } as Response)
    const loader = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockRejectedValue(new Error('404 lod1.glb'))
    try {
      await expect(HumanoidAssetRegistry.preloadAsset({ ...descriptor, assetId })).rejects.toThrow('404 lod1.glb')
      expect(() => HumanoidAssetRegistry.createCharacterInstance({ faction: 'roman', tier: 2, isPlayer: false }, assetId)).toThrow(assetId)
    } finally { fetchMock.mockRestore(); loader.mockRestore() }
  })

  it.each([0, 1, 2])('LOD%d preserves source provenance and its declared gameplay clip/event bindings', async lod => {
    const asset = readGlb(`${directory}/lod${lod}.glb`)
    const gltf = await loadRig(asset)
    expect(asset.document.asset.extras.paladinSourceSha256).toBe(manifest.source.sourceSha256)
    expect(asset.document.asset.extras.animationSourceSha256).toBe(manifest.animationRetarget.sha256)
    const base = JSON.parse(readFileSync('tools/assets/roman-t4-animation-source.json', 'utf8'))
    for (const binding of manifest.animations.embedded) {
      expect(gltf.animations.find((clip: THREE.AnimationClip) => clip.name === binding.clip)?.duration).toBeCloseTo(binding.duration, 5)
    }
    for (const binding of base.animations.embedded) {
      expect(manifest.animations.embedded.find((b: { clip: string }) => b.clip === binding.clip).events).toEqual(binding.events)
    }
    // Structural validation is exercised by real registry preload above.
    // Authoring repair lists, material choices, clearance and audit snapshots
    // are not consumed by the runtime; source hashes retain provenance.

  })
})
