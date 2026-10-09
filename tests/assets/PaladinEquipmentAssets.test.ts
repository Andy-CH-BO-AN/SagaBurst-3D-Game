import * as THREE from 'three'
import { expect, it, vi } from 'vitest'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { preloadPaladinEquipment } from '../../src/world/PaladinEquipment'
import { WeaponMeshFactory } from '../../src/world/WeaponMeshFactory'
// @ts-expect-error Repository offline tooling is JavaScript.
import { readGlb, loadRig } from '../../tools/lib/humanoid-glb.mjs'

// Three real equipment files, zero actors. Image decoding is deliberately omitted;
// this owner checks parse, factory wiring and resource/transform ownership.
it('preloads shared Paladin models once and builds independent Player/NPC equipment transforms', async () => {
  const loader = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async url => loadRig(readGlb(`public${url}`)))
  try {
    await Promise.all([preloadPaladinEquipment(), preloadPaladinEquipment()])
    expect(loader).toHaveBeenCalledTimes(3)
    for (const id of ['paladin_sword_t4', 'paladin_mace_t4', 'paladin_shield_t4']) {
      const a = new THREE.Group(), b = new THREE.Group()
      if (id === 'paladin_shield_t4') {
        WeaponMeshFactory.buildShield(id, a); WeaponMeshFactory.buildShield(id, b)
        expect(a.userData.gripCenterLocal).toEqual([0, 0, .085])
      } else {
        const player = WeaponMeshFactory.buildMelee(id, a)
        expect(WeaponMeshFactory.buildNpcMelee('viking', 4, false, b, id)).toEqual(player.tipLocal)
        expect(a.userData.gripCenterLocal).toEqual([0, .15, 0])
        const bounds = new THREE.Box3().setFromObject(a)
        expect(bounds.max.y).toBeCloseTo(player.tipLocal.y, 2)
      }
      const meshes = (root: THREE.Object3D) => {
        const result: THREE.Mesh[] = []
        root.traverse(o => { if (o instanceof THREE.Mesh) result.push(o) })
        return result
      }
      const left = meshes(a), right = meshes(b)
      expect(left.length).toBeGreaterThan(0)
      expect(right).toHaveLength(left.length)
      for (let i = 0; i < left.length; i++) {
        expect(left[i]).not.toBe(right[i])
        expect(left[i].geometry).toBe(right[i].geometry)
        expect(left[i].material).toBe(right[i].material)
      }
      a.position.x = 5; a.visible = false
      expect(b.position.x).toBe(0); expect(b.visible).toBe(true)
    }
  } finally { loader.mockRestore() }
})
