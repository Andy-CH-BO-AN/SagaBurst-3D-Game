import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { WeaponMeshFactory } from '../src/world/WeaponMeshFactory'
import { polishWeaponMaterials } from '../src/world/CharacterVisuals'
import { proceduralMaterialCacheSize } from '../src/world/ProceduralMaterials'
import baseline from './fixtures/equipment-geometry-cf04fd3.json'
import { equipmentGeometrySignature } from './helpers/equipmentGeometrySignature'

const counts = { viking: 4, roman: 3, round_shield: 5, scutum: 5 }
function build(kind: string, tier: number) {
  const root = new THREE.Group()
  const tip = kind === 'viking' || kind === 'roman'
    ? WeaponMeshFactory.buildNpcMelee(kind as 'viking' | 'roman', tier, false, root)
    : (WeaponMeshFactory.buildShield(`${kind}_t${tier}`, root), null)
  return { root, tip }
}

describe('rigid sword / shield consolidation', () => {
  it('keeps the caller-owned root, unrelated children and metadata', () => {
    for (const kind of Object.keys(counts)) {
      const parent = new THREE.Group(), root = new THREE.Group(), unrelated = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())
      parent.add(root)
      root.position.set(2, 3, 4)
      root.scale.set(0.8, 1.1, 1.2)
      root.userData.attachmentMarker = 'caller-owned'
      root.add(unrelated)
      if (kind === 'viking' || kind === 'roman') WeaponMeshFactory.buildNpcMelee(kind, 3, false, root)
      else WeaponMeshFactory.buildShield(`${kind}_t3`, root)
      expect(root.parent).toBe(parent)
      expect(root.position.toArray()).toEqual([2, 3, 4])
      expect(root.scale.toArray()).toEqual([0.8, 1.1, 1.2])
      expect(root.userData.attachmentMarker).toBe('caller-owned')
      expect(unrelated.parent).toBe(root)
      expect(unrelated.geometry.type).toBe('BoxGeometry')
    }
  })

  for (const [kind, maxMeshes] of Object.entries(counts)) for (const tier of [1, 2, 3]) {
    it(`${kind} T${tier}: reduces renderables without changing cf04fd3 geometry or attachment`, () => {
      const { root, tip } = build(kind, tier)
      const before = baseline[`${kind}-${tier}` as keyof typeof baseline]
      expect(root.children.length).toBe(maxMeshes)
      expect(root.children.every(child => child instanceof THREE.Mesh)).toBe(true)
      expect(root.children.length).toBeLessThan(before.meshCount)
      expect(root.userData).toEqual(before.userData)
      expect(tip?.toArray() ?? null).toEqual(before.tip)
      expect(root.userData.supportPointLocal).toBeUndefined()
      expect(root.userData.tipLocal).toBeUndefined()
      expect(root.position.toArray()).toEqual([0, 0, 0])
      expect(root.quaternion.toArray()).toEqual([0, 0, 0, 1])
      expect(root.scale.toArray()).toEqual([1, 1, 1])
      expect(equipmentGeometrySignature(root)).toEqual(before.geometry)
      for (const child of root.children as THREE.Mesh[]) {
        expect(Array.isArray(child.material)).toBe(false)
        // Built-in primitive groups do not add draws with a single material.
        if (child.geometry.type === 'BufferGeometry' && child.name !== 'steel-sword-profiled-blade'
          && child.name !== 'roman-gladius-profiled-blade') {
          expect(child.geometry.groups).toEqual([])
          expect(child.position.toArray()).toEqual([0, 0, 0])
          expect(child.quaternion.toArray()).toEqual([0, 0, 0, 1])
          expect(child.scale.toArray()).toEqual([1, 1, 1])
          expect(child.geometry.boundingBox).not.toBeNull()
          expect(child.geometry.boundingSphere).not.toBeNull()
        }
      }
    })

    it(`${kind} T${tier}: reuses cached materials and keeps the existing shadow policy`, () => {
      const a = build(kind, tier).root
      const size = proceduralMaterialCacheSize()
      const b = build(kind, tier).root
      expect(proceduralMaterialCacheSize()).toBe(size)
      const materials = (root: THREE.Group) => root.children.map(child => (child as THREE.Mesh).material)
      for (const [i, material] of materials(a).entries()) expect(material).toBe(materials(b)[i])
      polishWeaponMaterials(a)
      for (const mesh of a.children as THREE.Mesh[]) {
        expect(mesh.castShadow).toBe(true)
        expect(mesh.receiveShadow).toBe(true)
        expect(mesh.userData.originalMat).toBe(mesh.material)
      }
    })
  }
})
