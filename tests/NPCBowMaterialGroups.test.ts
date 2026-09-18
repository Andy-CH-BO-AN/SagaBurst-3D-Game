import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { WeaponMeshFactory } from '../src/world/WeaponMeshFactory'
import { CharacterBowVisual } from '../src/world/CharacterBowVisual'
import { NPC, AIType, Faction } from '../src/world/NPC'

const stave = (root: THREE.Object3D) => root.getObjectByName('bow-stave-and-grip') as THREE.Mesh
const materialPerIndex = (geometry: THREE.BufferGeometry) => {
  const result = new Array(geometry.index!.count).fill(-1)
  for (const group of geometry.groups) for (let i = group.start; i < group.start + group.count; i++) {
    expect(result[i]).toBe(-1) // Each index covered exactly once.
    result[i] = group.materialIndex
  }
  expect(result).not.toContain(-1)
  return result
}

describe('NPC bow material ranges', () => {
  for (const id of ['wooden_shortbow', 'recurve_longbow', 'elven_runebow']) {
    it(`${id}: preserves every vertex/index and triangle material, including the grip seam`, () => {
      const original = new THREE.Group(), compact = new THREE.Group()
      expect(WeaponMeshFactory.buildRanged(id, compact, true)).toEqual(WeaponMeshFactory.buildRanged(id, original))
      const a = stave(original), b = stave(compact)
      expect(a.geometry.groups).toHaveLength(81)
      expect(b.geometry.groups).toHaveLength(3)
      expect(b.geometry.index!.array).toEqual(a.geometry.index!.array)
      for (const name of Object.keys(a.geometry.attributes)) {
        expect(b.geometry.getAttribute(name).array).toEqual(a.geometry.getAttribute(name).array)
      }
      expect(materialPerIndex(b.geometry)).toEqual(materialPerIndex(a.geometry))
      expect((b.material as THREE.Material[]).map(m => m.type)).toEqual((a.material as THREE.Material[]).map(m => m.type))
    })

    it(`${id}: draw/release transforms and launch trajectory remain identical`, () => {
      const create = (compact: boolean) => {
        const action = new THREE.Group(), grip = new THREE.Group(); action.add(grip)
        const bow = new CharacterBowVisual(action, grip); bow.rebuild(id, compact)
        return { action, grip, bow }
      }
      const a = create(false), b = create(true)
      for (const ratio of [0, .5, 1, 0]) {
        const target = new THREE.Vector3(3, 2, -15)
        a.bow.update(ratio, target, ratio > 0); b.bow.update(ratio, target, ratio > 0)
        const poses = (root: THREE.Group) => {
          root.updateMatrixWorld(true)
          const result: unknown[] = []
          root.traverse(o => result.push([o.name, o.matrixWorld.toArray(), o.visible, o.castShadow]))
          return result
        }
        expect(poses(b.action)).toEqual(poses(a.action))
        const ao = new THREE.Vector3(), ad = new THREE.Vector3(), bo = new THREE.Vector3(), bd = new THREE.Vector3()
        a.bow.writeLaunch(ao, ad, target); b.bow.writeLaunch(bo, bd, target)
        expect(bo.toArray()).toEqual(ao.toArray()); expect(bd.toArray()).toEqual(ad.toArray())
      }
    })
  }

  it('opts in NPC Viking archers across tiers; shared builders stay unchanged', () => {
    for (const tier of [1, 2, 3]) {
      const npc = new NPC(new THREE.Scene(), 0, 0, Faction.PLAYER, AIType.RANGED, 'bow', tier, false)
      expect(stave(npc.group).geometry.groups).toHaveLength(3)
    }
    const pickup = new THREE.Group()
    WeaponMeshFactory.buildPickupMesh('wooden_shortbow', false, 0xffffff, pickup)
    expect(stave(pickup).geometry.groups).toHaveLength(81)
  })
})
