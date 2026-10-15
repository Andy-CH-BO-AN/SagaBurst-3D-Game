import * as THREE from 'three'
import { expect, it, vi } from 'vitest'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { createT5Bow, HIGH_TIER_WEAPON_ASSETS, preloadHighTierEquipment } from '../../src/world/HighTierEquipment'
import { WeaponMeshFactory } from '../../src/world/WeaponMeshFactory'
import { CharacterBowVisual } from '../../src/world/CharacterBowVisual'
// @ts-expect-error Offline asset parser omits image decoding; material pixels belong to browser QA.
import { readGlb, loadRig } from '../../tools/lib/humanoid-glb.mjs'

it('preloads two shared assets, isolates bow skeleton/draw state and rebuilds through the production visual', async () => {
  const loader = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async url => loadRig(readGlb(`public${url}`)))
  const bows: ReturnType<typeof createT5Bow>[] = []
  try {
    await Promise.all([preloadHighTierEquipment(), preloadHighTierEquipment()])
    expect(loader).toHaveBeenCalledTimes(2)
    expect(HIGH_TIER_WEAPON_ASSETS.spear_t4).toBe('models/weapons/high-tier/spear.glb')
    const a = new THREE.Group(), b = new THREE.Group()
    expect(WeaponMeshFactory.buildMelee('spear_t4', a).tipLocal.toArray()).toEqual([0, 2.6, 0])
    expect(WeaponMeshFactory.buildNpcMelee('roman', 4, true, b, 'lance_t4').toArray()).toEqual([0, 2.6, 0])
    const meshA = a.getObjectByProperty('isMesh', true) as THREE.Mesh
    const meshB = b.getObjectByProperty('isMesh', true) as THREE.Mesh
    expect(meshA.geometry).toBe(meshB.geometry)
    const first = createT5Bow(), second = createT5Bow()
    bows.push(first, second)
    const parentA = new THREE.Group(), parentB = new THREE.Group()
    parentA.add(first.model); parentB.add(second.model)
    first.sampleDraw(0); second.sampleDraw(0)
    const skinA = first.model.getObjectByProperty('isSkinnedMesh', true) as THREE.SkinnedMesh
    const skinB = second.model.getObjectByProperty('isSkinnedMesh', true) as THREE.SkinnedMesh
    expect(skinA.skeleton).not.toBe(skinB.skeleton)
    expect(skinA.skeleton.bones[0]).not.toBe(skinB.skeleton.bones[0])
    expect(skinA.geometry).toBe(skinB.geometry)
    const before = skinB.skeleton.bones.map(bone => bone.quaternion.toArray())
    const neutral = first.topTip.clone()
    first.sampleDraw(1)
    expect(skinB.skeleton.bones.map(bone => bone.quaternion.toArray())).toEqual(before)
    expect(first.topTip.distanceTo(neutral)).toBeGreaterThan(.01)
    first.sampleDraw(0)
    expect(first.topTip.distanceTo(neutral)).toBeLessThan(1e-6)
    const pivot = new THREE.Group(), grip = new THREE.Group(), owner = new THREE.Group()
    pivot.add(grip); owner.add(pivot)
    const visual = new CharacterBowVisual(pivot, grip, owner)
    try {
      visual.rebuild('bow_t5')
      visual.update(.5, undefined, true)
      const origin = new THREE.Vector3(), direction = new THREE.Vector3()
      visual.writeLaunch(origin, direction, new THREE.Vector3(0, 0, -20))
      expect(Number.isFinite(origin.length())).toBe(true)
      expect(direction.length()).toBeCloseTo(1)
      visual.rebuild('wooden_shortbow')
      expect(grip.getObjectByProperty('isSkinnedMesh', true)).toBeUndefined()
    } finally { visual.dispose() }
    expect(loader).toHaveBeenCalledTimes(2)
  } finally { bows.forEach(bow => bow.dispose()); loader.mockRestore() }
})
