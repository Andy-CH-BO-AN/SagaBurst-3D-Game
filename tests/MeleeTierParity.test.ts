import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { WEAPONS } from '../src/rpg/WeaponDatabase'
import { WeaponMeshFactory } from '../src/world/WeaponMeshFactory'
import { applySwordAttachment, setSwordMountedAttachment } from '../src/world/SwordAttachmentContract'

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

  it('keeps Dane axe tiers geometrically identical and on the sword combat contract', () => {
    const swords = ['rusty_dagger', 'steel_sword', 'runic_greatsword']
    const groups = [1, 2, 3].map(tier => {
      const id = `viking_axe_t${tier}`
      const group = new THREE.Group()
      const result = WeaponMeshFactory.buildMelee(id, group)
      const axe = WEAPONS[id]
      const sword = WEAPONS[swords[tier - 1]]
      expect([axe.combatKind, axe.animationKind, axe.damageMin, axe.damageMax, axe.range, axe.speedOrCharge])
        .toEqual([sword.combatKind, sword.animationKind, sword.damageMin, sword.damageMax, sword.range, sword.speedOrCharge])
      expect(group.userData.gripCenterLocal).toEqual([0, 0.15, 0])
      expect(result.tipLocal.toArray()).toEqual([0, 1.51, 0])
      const shaft = group.getObjectByName('dane-axe-haft') as THREE.Mesh
      expect((shaft.geometry as THREE.CylinderGeometry).parameters.height).toBe(1.44)
      expect(group.getObjectByName('dane-axe-single-bearded-blade')).toBeTruthy()
      return group
    })
    expect(groups.map(shapeSignature)).toEqual(Array(3).fill(shapeSignature(groups[1])))
    expect(new Set(groups.map(group => JSON.stringify(materialSignature(group)))).size).toBe(3)
  })

  it('splays the visible axe outward on foot and mounted without moving its grip or hit point', () => {
    const socket = new THREE.Group()
    const pivot = new THREE.Group()
    const model = new THREE.Group()
    socket.add(pivot)
    pivot.add(model)
    const tip = WeaponMeshFactory.buildMelee('viking_axe_t2', model).tipLocal.clone()
    const frame = {
      gripCenterLocal: [0, 0, 0] as [number, number, number],
      gripAxisLocal: [0, 1, 0] as [number, number, number],
      palmNormalLocal: [0, 0, -1] as [number, number, number],
      fingerDirection: [0, 0, 1] as [number, number, number],
      wristCenter: [0, 0, 0] as [number, number, number],
      thumbBaseCenter: [0, 0, 0] as [number, number, number],
      fingerBase: 0,
      gripRadius: 0.036,
    }
    applySwordAttachment(socket, pivot, model, frame, [0, 0, 0, 1])
    const visual = model.getObjectByName('dane-axe-visual')!
    expect(visual.rotation.x).toBe(0.45)
    setSwordMountedAttachment(pivot, true)
    expect(visual.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0.55])
    expect(model.userData.gripCenterLocal).toEqual([0, 0.15, 0])
    expect(tip.toArray()).toEqual([0, 1.51, 0])
    setSwordMountedAttachment(pivot, false)
    expect(visual.rotation.toArray().slice(0, 3)).toEqual([0.45, 0, 0])
  })

  it('uses the default Roman gladius shape for all tiers with distinct surface patterns', () => {
    const groups = [1, 2, 3].map(tier => {
      const group = new THREE.Group()
      const tip = WeaponMeshFactory.buildNpcMelee('roman', tier, false, group)
      return { group, tip }
    })
    expect(groups.map(({ group }) => shapeSignature(group))).toEqual(Array(3).fill(shapeSignature(groups[1].group)))
    expect(groups.map(({ group }) => group.userData.gripCenterLocal)).toEqual(Array(3).fill([0, 0.1, 0]))
    for (const { tip } of groups) expect(tip.toArray()).toEqual([0, expect.closeTo(0.88), 0])
    expect(new Set(groups.map(({ group }) => JSON.stringify(materialSignature(group))).values()).size).toBe(3)
  })
})
