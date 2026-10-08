import * as THREE from 'three'
import { describe, expect, it, onTestFinished } from 'vitest'
import { WeaponMeshFactory } from '../../src/world/WeaponMeshFactory'
import { polishWeaponMaterials } from '../../src/world/CharacterVisuals'
import { proceduralMaterialCacheSize } from '../../src/world/ProceduralMaterials'

const meshBudgets = { viking: 4, roman: 3, round_shield: 5, scutum: 5 }
function ownedEquipmentRoot() {
  const root = new THREE.Group()
  onTestFinished(() => {
    const geometries = new Set<THREE.BufferGeometry>()
    root.traverse(object => {
      if (object instanceof THREE.Mesh) geometries.add(object.geometry)
    })
    // Each build owns its geometry; procedural materials remain in their shared cache.
    for (const geometry of geometries) geometry.dispose()
    root.removeFromParent()
    root.clear()
  })
  return root
}

function build(kind: string, tier: number) {
  const root = ownedEquipmentRoot()
  const tip = kind === 'viking' || kind === 'roman'
    ? WeaponMeshFactory.buildNpcMelee(kind as 'viking' | 'roman', tier, false, root)
    : (WeaponMeshFactory.buildShield(`${kind}_t${tier}`, root), null)
  return { root, tip }
}

describe('rigid sword / shield consolidation', () => {
  it('keeps the caller-owned root, unrelated children and metadata', () => {
    for (const kind of Object.keys(meshBudgets)) {
      const parent = new THREE.Group(), root = ownedEquipmentRoot()
      const unrelatedMaterial = new THREE.MeshBasicMaterial()
      onTestFinished(() => unrelatedMaterial.dispose())
      const unrelated = new THREE.Mesh(new THREE.BoxGeometry(), unrelatedMaterial)
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

  for (const [kind, maxMeshes] of Object.entries(meshBudgets)) for (const tier of [1, 2, 3]) {
    it(`${kind} T${tier}: stays within draw budget and publishes attachment and gameplay hit metadata`, () => {
      const { root, tip } = build(kind, tier)
      expect(root.children.length).toBeGreaterThan(0)
      expect(root.children.length).toBeLessThanOrEqual(maxMeshes)
      expect(root.children.every(child => child instanceof THREE.Mesh)).toBe(true)
      // Attachment readers consume this grip; these are contact metadata, not a rendered-shape snapshot.
      const grip = kind === 'viking' ? [0, 0.15, 0] : kind === 'roman' ? [0, 0.1, 0] : [0, 0, 0.085]
      expect(root.userData).toMatchObject({ gripCenterLocal: grip })
      if (kind === 'viking' || kind === 'roman') {
        expect(tip).toBeInstanceOf(THREE.Vector3)
        expect(tip!.x).toBe(0); expect(tip!.z).toBe(0)
        expect(tip!.y).toBeCloseTo(kind === 'viking' ? 1.51 : 0.88, 12)
      } else expect(tip).toBeNull()
      expect(root.userData.supportPointLocal).toBeUndefined()
      expect(root.userData.tipLocal).toBeUndefined()
      expect(root.position.toArray()).toEqual([0, 0, 0])
      expect(root.quaternion.toArray()).toEqual([0, 0, 0, 1])
      expect(root.scale.toArray()).toEqual([1, 1, 1])
      for (const child of root.children as THREE.Mesh[]) {
        // One material gives one draw per mesh; primitive groups do not add draws.
        expect(Array.isArray(child.material)).toBe(false)
        const bounds = new THREE.Box3().setFromObject(child)
        expect(bounds.isEmpty()).toBe(false)
        expect([...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)).toBe(true)
        // Renderer culling computes a missing sphere lazily; the published geometry must support that query.
        if (!child.geometry.boundingSphere) child.geometry.computeBoundingSphere()
        const sphere = child.geometry.boundingSphere!
        expect(sphere.radius).toBeGreaterThan(0); expect(Number.isFinite(sphere.radius)).toBe(true)
        expect(sphere.center.toArray().every(Number.isFinite)).toBe(true)
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
