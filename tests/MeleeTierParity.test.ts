import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { WEAPONS } from '../src/rpg/WeaponDatabase'
import { Faction } from '../src/world/NPC'
import { WeaponMeshFactory } from '../src/world/WeaponMeshFactory'

function shapeSignature(root: THREE.Object3D): unknown[] {
  const meshes: unknown[] = []
  root.updateMatrixWorld(true)
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return
    const geometry = object.geometry
    meshes.push({
      position: object.position.toArray(),
      quaternion: object.quaternion.toArray(),
      scale: object.scale.toArray(),
      index: geometry.index ? Array.from(geometry.index.array) : null,
      positions: Array.from(geometry.attributes.position.array),
    })
  })
  return meshes
}

function materialSignature(root: THREE.Object3D): string[] {
  const materials: string[] = []
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return
    const list = Array.isArray(object.material) ? object.material : [object.material]
    materials.push(...list.map(material => `${material.name}:${material.map?.name ?? ''}`))
  })
  return materials
}

describe('T1–T3 melee parity', () => {
  it('uses one one-handed sword animation contract while retaining tier damage', () => {
    const ids = ['rusty_dagger', 'steel_sword', 'runic_greatsword', 'gladius_rusty', 'gladius_standard', 'centurion_blade']
    expect(ids.map(id => WEAPONS[id].animationKind)).toEqual(Array(6).fill('sword'))
    expect(ids.map(id => WEAPONS[id].speedOrCharge)).toEqual(Array(6).fill(0.35))
    expect(ids.map(id => WEAPONS[id].range)).toEqual(Array(6).fill(1.8))
    expect(ids.slice(0, 3).map(id => WEAPONS[id].damageMax)).toEqual([12, 25, 45])
    expect(ids.slice(3).map(id => WEAPONS[id].damageMax)).toEqual([12, 25, 45])
  })

  it('uses the default Viking sword shape for all tiers with distinct surface patterns', () => {
    const ids = ['rusty_dagger', 'steel_sword', 'runic_greatsword']
    const groups = ids.map(id => {
      const group = new THREE.Group()
      const result = WeaponMeshFactory.buildMelee(id, group)
      return { group, result }
    })
    expect(groups.map(({ group }) => shapeSignature(group))).toEqual(Array(3).fill(shapeSignature(groups[1].group)))
    expect(groups.map(({ group }) => group.userData.gripCenterLocal)).toEqual(Array(3).fill([0, 0.15, 0]))
    expect(groups.map(({ result }) => result.tipLocal.toArray())).toEqual(Array(3).fill([0, 1.51, 0]))
    expect(new Set(groups.map(({ group }) => JSON.stringify(materialSignature(group))).values()).size).toBe(3)
  })

  it('uses the default Roman gladius shape for all tiers with distinct surface patterns', () => {
    const groups = [1, 2, 3].map(tier => {
      const group = new THREE.Group()
      const tip = WeaponMeshFactory.buildNpcMelee(Faction.ENEMY, tier, false, group)
      return { group, tip }
    })
    expect(groups.map(({ group }) => shapeSignature(group))).toEqual(Array(3).fill(shapeSignature(groups[1].group)))
    expect(groups.map(({ group }) => group.userData.gripCenterLocal)).toEqual(Array(3).fill([0, 0.1, 0]))
    for (const { tip } of groups) expect(tip.toArray()).toEqual([0, expect.closeTo(0.88), 0])
    expect(new Set(groups.map(({ group }) => JSON.stringify(materialSignature(group))).values()).size).toBe(3)
  })
})
