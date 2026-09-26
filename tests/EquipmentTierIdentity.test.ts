import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { WeaponMeshFactory } from '../src/world/WeaponMeshFactory'
import { WEAPONS } from '../src/rpg/WeaponDatabase'
import { equipmentGeometrySignature } from './helpers/equipmentGeometrySignature'

describe('tier equipment identity across build routes', () => {
  it('keeps lance grips, support points and hit tips fixed with distinct heads', () => {
    const signatures = [1, 2, 3].map(tier => {
      const id = ['hunting_spear', 'steel_lance', 'heavy_lance'][tier - 1]
      const held = new THREE.Group(), npc = new THREE.Group()
      const result = WeaponMeshFactory.buildMelee(id, held)
      expect(WeaponMeshFactory.buildNpcMelee('viking', tier, true, npc)).toEqual(result.tipLocal)
      expect(equipmentGeometrySignature(npc)).toEqual(equipmentGeometrySignature(held))
      expect(held.userData).toEqual({ gripCenterLocal: [0, .15, 0], supportPointLocal: [0, .33, 0], forwardAxisLocal: [0, 1, 0], tipLocal: [0, 2.6, 0] })
      expect(result.tipLocal.toArray()).toEqual([0, 2.6, 0])
      expect(WEAPONS[id].range).toBe(3.9)
      return JSON.stringify(equipmentGeometrySignature(held))
    })
    expect(new Set(signatures).size).toBe(3)
  })

  it.each(['scutum', 'round_shield'])('%s tiers differ geometrically without moving the hand', kind => {
    const signatures = [1, 2, 3].map(tier => {
      const group = new THREE.Group()
      WeaponMeshFactory.buildShield(`${kind}_t${tier}`, group)
      expect(group.userData.gripCenterLocal).toEqual([0, 0, .085])
      expect(group.getObjectByName('shield-rear-grip')!.position.toArray()).toEqual([0, 0, .085])
      return JSON.stringify(equipmentGeometrySignature(group))
    })
    expect(new Set(signatures).size).toBe(3)
  })

  it('keeps existing bow endpoints and central grip rings across tiers', () => {
    for (const [id, span] of [['wooden_shortbow', .62], ['recurve_longbow', .85], ['elven_runebow', 1.02]] as const) {
      const root = new THREE.Group()
      const bow = WeaponMeshFactory.buildRanged(id, root)
      expect(bow.topTip.toArray()).toEqual([0, span, -.035])
      expect(bow.botTip.toArray()).toEqual([0, -span, -.035])
      expect(bow.stringLength).toBe(span)
      const stave = root.getObjectByName('bow-stave-and-grip') as THREE.Mesh
      // Grip is the original two rings, with leather spanning ring 40.
      expect(stave.geometry.groups[40].materialIndex).toBe(1)
    }
  })

  it('uses the actual pilum in pickups for every tier', () => {
    for (const [index, id] of ['pilum_basic', 'pilum_standard', 'legionary_pilum'].entries()) {
      const held = new THREE.Group(), pickup = new THREE.Group()
      WeaponMeshFactory.buildNpcRanged('roman', index + 1, held)
      WeaponMeshFactory.buildPickupMesh(id, false, 0xffffff, pickup)
      const model = pickup.children[0] as THREE.Group
      model.position.set(0, 0, 0); model.scale.setScalar(1)
      expect(equipmentGeometrySignature(model)).toEqual(equipmentGeometrySignature(held))
    }
  })
})
