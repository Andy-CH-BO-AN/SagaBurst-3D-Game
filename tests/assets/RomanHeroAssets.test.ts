import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { HumanoidAssetRegistry, validateHumanoidManifest, type HumanoidAssetDescriptor } from '../../src/world/HumanoidAssetRegistry'
// @ts-expect-error Repository offline tooling is JavaScript.
import { readGlb, loadRig } from '../../tools/lib/humanoid-glb.mjs'

const directory = 'public/models/characters/v2/roman-hero-t4'
const manifest = JSON.parse(readFileSync(`${directory}/manifest.json`, 'utf8'))
const descriptor: HumanoidAssetDescriptor = { assetId: 'roman-hero-t4', faction: 'roman', heightM: 1.95, maxShoulderWidthM: .50, neckLengthM: .10 }

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
      expect(a.root.scale.toArray()).toEqual([1, 1, 1])
      expect(a.skeleton).not.toBe(b.skeleton)
      expect(a.mixers).toHaveLength(3)
      for (let i = 0; i < 3; i++) expect(a.mixers[i]).not.toBe(b.mixers[i])
      const bones = new Set<string>()
      a.root.traverse(node => { if (node instanceof THREE.Bone) bones.add(node.uuid) })
      b.root.traverse(node => { if (node instanceof THREE.Bone) expect(bones.has(node.uuid)).toBe(false) })
      const lod = a.root.children.find(child => child instanceof THREE.LOD) as THREE.LOD
      for (const level of lod.levels) {
        expect(level.object.getObjectByName('Praetorian_Roman_helmet')?.parent?.name).toBe('head')
        for (const old of ['Helmet3', 'Praetorian_face_mask', 'Boots']) expect(level.object.getObjectByName(old)).toBeUndefined()
        expect(level.object.userData.humanoidLod2RepresentationControl).toBeUndefined()
        for (const name of ['New_head', 'New_legs', 'Praetorian_centurion_footwear', 'Praetorian_Roman_helmet', 'socket_hand_r', 'socket_hand_l', 'socket_pelvis']) expect(level.object.getObjectByName(name)).toBeDefined()
      }
      const before = b.rig.right.shoulder.quaternion.clone()
      a.rig.animation!.play('swordSlash', { fadeSeconds: 0, loop: false })
      a.rig.animation!.update(.001)
      a.rig.animation!.seek('swordSlash', .5)
      a.rig.animation!.update(0)
      expect(b.rig.right.shoulder.quaternion.equals(before)).toBe(true)
      expect(warning.mock.calls.flat().join(' ')).not.toContain('does not match audited')
      a.dispose(); b.dispose()
    } finally { fetchMock.mockRestore(); loader.mockRestore(); warning.mockRestore() }
  })

  it.each(['head', 'socket_hand_r', 'idle'])('rejects missing %s without a fallback Roman', async missing => {
    const assetId = `broken-roman-${missing}`
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ ...manifest, id: assetId }) } as Response)
    const loader = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async () => {
      const gltf = await loadRig(readGlb(`${directory}/lod0.glb`))
      if (missing === 'idle') gltf.animations = gltf.animations.filter((clip: THREE.AnimationClip) => clip.name !== 'idle')
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

  it.each([0, 1, 2])('LOD%d preserves source assets and all binding durations/events', async lod => {
    const asset = readGlb(`${directory}/lod${lod}.glb`)
    const gltf = await loadRig(asset)
    expect(asset.document.meshes.some((mesh: { name: string }) => ['Helmet3', 'Praetorian_face_mask', 'Boots'].includes(mesh.name))).toBe(false)
    const helmet = asset.document.materials.find((material: { name: string }) => material.name === 'Praetorian_source_helmet').pbrMetallicRoughness
    const torso = asset.document.materials.find((material: { name: string }) => material.name === 'Armour_top0').pbrMetallicRoughness
    expect(helmet.metallicFactor).toBe(torso.metallicFactor)
    expect(helmet.roughnessFactor).toBe(torso.roughnessFactor)
    expect(asset.document.asset.extras.romanHelmetReplacement.sourceSha256).toBe(
      createHash('sha256').update(readFileSync('artifacts/character_sources/roman-helmet/source.glb')).digest('hex'),
    )
    expect(asset.document.asset.extras.romanGreavesReplacement.sourceSha256).toBe(
      createHash('sha256').update(readFileSync('artifacts/character_sources/roman-centurion/source.glb')).digest('hex'),
    )
    expect(asset.document.asset.extras.romanGreavesReplacement.selectedSourceMeshes).toHaveLength(5)
    const base = JSON.parse(readFileSync('public/models/characters/v2/roman/manifest.json', 'utf8'))
    const sourceHash = createHash('sha256').update(readFileSync(`public/models/characters/v2/roman/lod${lod}.glb`)).digest('hex')
    expect(sourceHash).toBe(manifest.lodMeasurements[lod].sourceSha256)
    for (const binding of base.animations.embedded) {
      expect(gltf.animations.find((clip: THREE.AnimationClip) => clip.name === binding.clip)?.duration).toBeCloseTo(binding.duration, 5)
      expect(manifest.animations.embedded.find((b: { clip: string }) => b.clip === binding.clip).events).toEqual(binding.events)
    }
    const audit = JSON.parse(readFileSync(`${directory}/audit.json`, 'utf8'))
    expect(audit.failures).toEqual([])
    expect(audit.rows[lod].changedTopology).toBe(0)
    expect(audit.rows[lod].changedUVorWeights).toBe(0)
    expect(audit.rows[lod].sha256).toBe(createHash('sha256').update(readFileSync(`${directory}/lod${lod}.glb`)).digest('hex'))
    expect(audit.rows[lod].localRepairs.map((repair: { name: string }) => repair.name).sort()).toEqual(['Armour_top', 'New_arms', 'New_legs', 'RomanUndertunic_l', 'RomanUndertunic_r', 'Tunic_1', 'Wrist_guard1'])
    expect(audit.rows[lod].helmetClearanceM).toBeGreaterThan(.001)
    expect(audit.rows[lod].bodyHeightM).toBeCloseTo(1.95, 3)
    expect(audit.rows[lod].badWeights).toBe(0)
  })
})
