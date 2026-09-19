import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { EquipmentVisualLODController } from '../src/world/EquipmentVisualLODController'
import { HUMANOID_LOD_DISTANCES } from '../src/world/HumanoidAssetRegistry'
import { AIType, Faction, NPC } from '../src/world/NPC'
import { WeaponMeshFactory } from '../src/world/WeaponMeshFactory'
import { Player } from '../src/player/Player'
import { collectEquipmentRenderCensus } from '../src/debug/EquipmentRenderCensus'

function meshes(root: THREE.Object3D): THREE.Mesh[] {
  const result: THREE.Mesh[] = []
  root.traverse(o => { if ((o as THREE.Mesh).isMesh) result.push(o as THREE.Mesh) })
  return result
}
function fixture() {
  const root = new THREE.Group(), controller = new EquipmentVisualLODController()
  const caster = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())
  const nonCaster = caster.clone()
  caster.castShadow = true; nonCaster.castShadow = false
  caster.receiveShadow = true; nonCaster.receiveShadow = false
  root.add(caster, nonCaster); controller.register('sword', root)
  return { root, controller, caster, nonCaster }
}

describe('NPC equipment shadow LOD', () => {
  for (const faction of [Faction.PLAYER, Faction.ENEMY]) for (const tier of [1, 2, 3] as const) {
    for (const aiType of [AIType.MELEE, AIType.RANGED]) {
      it(`${faction} T${tier} ${aiType}: only LOD2 shadows change`, () => {
        const characterFaction = faction === Faction.ENEMY ? 'roman' : 'viking'
        const npc = new NPC(new THREE.Scene(), 0, 0, faction, characterFaction, aiType, 'shadow-test', tier, false)
        const equipment: THREE.Mesh[] = []
        npc.equipmentVisualLOD.forEachRoot((_, root) => equipment.push(...meshes(root)))
        const originals = equipment.map(mesh => mesh.castShadow)
        const snapshot = () => equipment.map(mesh => [mesh.parent?.uuid, mesh.position.toArray(), mesh.quaternion.toArray(), mesh.scale.toArray(), mesh.receiveShadow, JSON.stringify(mesh.userData)])
        const before = snapshot()
        for (const level of [0, 1, 2, 1, 0, 2] as const) {
          npc.equipmentVisualLOD.setLOD(level)
          const census = collectEquipmentRenderCensus([npc])
          expect(census.totalVisibleMeshes).toBeGreaterThan(0)
          expect(census.visibleShadowCasters).toBe(level === 2 ? 0 : census.totalVisibleMeshes)
          expect(equipment.map(mesh => mesh.castShadow)).toEqual(level === 2 ? originals.map(() => false) : originals)
          expect(snapshot()).toEqual(before)
          expect(Object.values(census.visibleShadowCastersByKind).reduce((a, b) => a + b, 0)).toBe(census.visibleShadowCasters)
        }
        npc.group.visible = false
        expect(collectEquipmentRenderCensus([npc]).totalVisibleMeshes).toBe(0)
        expect(collectEquipmentRenderCensus([npc]).visibleShadowCasters).toBe(0)
      })
    }
  }

  // Horse assets are exercised by the production browser matrix; unit coverage uses the real lance builder.
  for (const faction of [Faction.PLAYER, Faction.ENEMY]) for (const tier of [1, 2, 3]) {
    it(`${faction} T${tier} lance: keeps both meshes visible and restores shadows`, () => {
      const root = new THREE.Group(), controller = new EquipmentVisualLODController()
      const characterFaction = faction === Faction.ENEMY ? 'roman' : 'viking'
      WeaponMeshFactory.buildNpcMelee(characterFaction, tier, true, root)
      const equipment = meshes(root)
      equipment.forEach(mesh => { mesh.castShadow = true })
      controller.register('lance', root)
      for (const level of [0, 1, 2, 0] as const) {
        controller.setLOD(level)
        expect(equipment).toHaveLength(2)
        expect(equipment.every(mesh => mesh.visible)).toBe(true)
        expect(equipment.map(mesh => mesh.castShadow)).toEqual([level < 2, level < 2])
      }
    })
  }

  it('preserves original false and true, including repeated registration at LOD2', () => {
    const { root, controller, caster, nonCaster } = fixture()
    for (const level of [2, 0, 1, 2, 0] as const) {
      controller.setLOD(level)
      controller.register('sword', root)
      expect(caster.castShadow).toBe(level < 2)
      expect(nonCaster.castShadow).toBe(false)
      expect(caster.receiveShadow).toBe(true)
      expect(nonCaster.receiveShadow).toBe(false)
    }
  })

  it('uses actual Humanoid Three.LOD boundaries and zoom for both policies', () => {
    const { root, controller, caster, nonCaster } = fixture()
    const camera = new THREE.PerspectiveCamera(), lod = new THREE.LOD()
    HUMANOID_LOD_DISTANCES.forEach(distance => lod.addLevel(new THREE.Group(), distance))
    controller.followHumanoid(lod)
    for (let cycle = 0; cycle < 5; cycle++) for (const [distance, expected] of [[27, 0], [28, 1], [29, 1], [59, 1], [60, 2], [61, 2], [59, 1], [61, 2], [27, 0]]) {
      camera.position.z = distance; camera.updateMatrixWorld(); lod.update(camera)
      expect(controller.currentLevel).toBe(expected)
      expect(caster.castShadow).toBe(expected < 2)
      expect(nonCaster.castShadow).toBe(false)
      expect(root.visible && caster.visible && nonCaster.visible).toBe(true)
    }
    camera.zoom = 2; camera.position.z = 61; camera.updateMatrixWorld(); lod.update(camera)
    expect(controller.currentLevel).toBe(1); expect(caster.castShadow).toBe(true)
  })

  it('does no traversal, cache replacement, or shadow writes for an unchanged level', () => {
    const { root, controller, caster, nonCaster } = fixture()
    controller.setLOD(2)
    const entries = (controller as any).entries, entry = entries.get('sword')
    const traverse = vi.spyOn(root, 'traverse').mockImplementation(() => { throw Error('steady-state traversal') })
    const writes = [caster, nonCaster].map(mesh => {
      let value = mesh.castShadow
      const set = vi.fn((next: boolean) => { value = next })
      Object.defineProperty(mesh, 'castShadow', { get: () => value, set })
      return set
    })
    controller.setLOD(2); controller.setLOD(2)
    expect(traverse).not.toHaveBeenCalled()
    writes.forEach(write => expect(write).not.toHaveBeenCalled())
    expect((controller as any).entries).toBe(entries)
    expect(entries.get('sword')).toBe(entry)
  })

  it('applies LOD2 to replacement shields immediately and restores originals on return', () => {
    const npc = new NPC(new THREE.Scene(), 0, 0, Faction.PLAYER, 'viking', AIType.MELEE, 'rebuild', 3, false)
    const root = (npc as any).shieldPivot as THREE.Group
    npc.equipmentVisualLOD.setLOD(2)
    const oldMeshes = meshes(root)
    npc.shieldId = 'scutum_t2'; npc.rebuildShield()
    const current = meshes(root)
    expect(current).toHaveLength(5)
    expect(current.every(mesh => !mesh.castShadow)).toBe(true)
    expect(collectEquipmentRenderCensus([npc]).visibleMeshes.shield).toBe(3)
    npc.equipmentVisualLOD.setLOD(0)
    expect(current.every(mesh => mesh.castShadow)).toBe(true)
    expect(oldMeshes.every(mesh => !mesh.castShadow && mesh.parent === null)).toBe(true)
    expect(collectEquipmentRenderCensus([npc]).visibleShadowCastersByKind.shield).toBe(5)
  })

  it('keeps LOD2 shadows disabled through ranged/melee switching and respawn', () => {
    for (const faction of [Faction.PLAYER, Faction.ENEMY]) {
      const characterFaction = faction === Faction.ENEMY ? 'roman' : 'viking'
      const npc = new NPC(new THREE.Scene(), 0, 0, faction, characterFaction, AIType.RANGED, 'lifecycle', 3, false)
      npc.equipmentVisualLOD.setLOD(2)
      const expectFar = () => {
        const census = collectEquipmentRenderCensus([npc])
        expect(census.totalVisibleMeshes).toBeGreaterThan(0)
        expect(census.visibleShadowCasters).toBe(0)
        expect(census.lodCounts).toEqual([0, 0, 1])
      }
      expectFar()
      ;(npc as any)._switchToMelee()
      expectFar()
      npc.respawn()
      expectFar()
      npc.equipmentVisualLOD.setLOD(0)
      const census = collectEquipmentRenderCensus([npc])
      expect(census.visibleShadowCasters).toBe(census.totalVisibleMeshes)
    }
  })

  it('keeps Player equipment and unattached projectile/pickup meshes untouched', () => {
    const scene = new THREE.Scene(), player = new Player(scene)
    const originals = meshes(player.group).map(mesh => ({ mesh, visible: mesh.visible, cast: mesh.castShadow, receive: mesh.receiveShadow }))
    const other = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); other.castShadow = true
    scene.add(other)
    const npc = new NPC(scene, 0, 0, Faction.PLAYER, 'viking', AIType.RANGED, 'player-control', 3, false)
    for (const level of [2, 1, 0, 2] as const) {
      npc.equipmentVisualLOD.setLOD(level)
      for (const { mesh, visible, cast, receive } of originals) {
        expect([mesh.visible, mesh.castShadow, mesh.receiveShadow]).toEqual([visible, cast, receive])
      }
      expect(other.castShadow).toBe(true)
    }
  })
})
