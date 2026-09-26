import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { EquipmentVisualLODController } from '../src/world/EquipmentVisualLODController'
import { HUMANOID_LOD_DISTANCES } from '../src/world/HumanoidAssetRegistry'
import { AIType, Faction, NPC } from '../src/world/NPC'
import { WeaponMeshFactory } from '../src/world/WeaponMeshFactory'
import { CharacterBowVisual } from '../src/world/CharacterBowVisual'
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
      it(`${faction} T${tier} ${aiType}: adheres to shadow policy per LOD level`, () => {
        const characterFaction = faction === Faction.ENEMY ? 'roman' : 'viking'
        const npc = new NPC(new THREE.Scene(), 0, 0, faction, characterFaction, aiType, 'shadow-test', tier, false)
        const equipment: THREE.Mesh[] = []
        npc.equipmentVisualLOD.forEachRoot((_, root) => equipment.push(...meshes(root)))
        const snapshot = () => equipment.map(mesh => [mesh.parent?.uuid, mesh.position.toArray(), mesh.quaternion.toArray(), mesh.scale.toArray(), mesh.receiveShadow, JSON.stringify(mesh.userData)])
        const before = snapshot()

        // Expected visible shadow casters:
        // MELEE (Lance + Shield):
        //   Lance: 2 (pole, head)
        //   Shield: LOD0 = 2 (board + rim), LOD1 = 1 (board only)
        //   Total MELEE: LOD0 = 4, LOD1 = 3, LOD2 = 0
        // RANGED:
        //   Viking (Bow): 1 (stave) -> LOD0 = 1, LOD1 = 1, LOD2 = 0
        //   Roman (Pilum):
        //     T1 = 2 (shaft, head) -> LOD0 = 2, LOD1 = 2, LOD2 = 0
        //     T2/T3 = 3 (shaft, neck, head) -> LOD0 = 3, LOD1 = 3, LOD2 = 0
        let expectedLOD0 = 4
        let expectedLOD1 = 3
        if (aiType === AIType.RANGED) {
          if (characterFaction === 'viking') {
            expectedLOD0 = 1
            expectedLOD1 = 1
          } else {
            expectedLOD0 = tier === 1 ? 2 : 3
            expectedLOD1 = tier === 1 ? 2 : 3
          }
        }

        for (const level of [0, 1, 2, 1, 0, 2] as const) {
          npc.equipmentVisualLOD.setLOD(level)
          const census = collectEquipmentRenderCensus([npc])
          expect(census.totalVisibleMeshes).toBeGreaterThan(0)
          const expectedCasters = level === 2 ? 0 : (level === 0 ? expectedLOD0 : expectedLOD1)
          expect(census.visibleShadowCasters).toBe(expectedCasters)
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
    it(`${faction} T${tier} lance: keeps pole/head visible and hides tier trim at distance`, () => {
      const root = new THREE.Group(), controller = new EquipmentVisualLODController()
      const characterFaction = faction === Faction.ENEMY ? 'roman' : 'viking'
      WeaponMeshFactory.buildNpcMelee(characterFaction, tier, true, root)
      const equipment = meshes(root)
      equipment.forEach(mesh => { mesh.castShadow = true })
      controller.register('lance', root)
      for (const level of [0, 1, 2, 0] as const) {
        controller.setLOD(level)
        expect(equipment).toHaveLength(tier === 2 ? 2 : 3)
        expect(equipment.slice(0, 2).every(mesh => mesh.visible)).toBe(true)
        expect(equipment.slice(0, 2).map(mesh => mesh.castShadow)).toEqual([level < 2, level < 2])
        if (tier !== 2) {
          expect(equipment[2].visible).toBe(level === 0)
          expect(equipment[2].castShadow).toBe(false)
        }
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

  it('applies LOD2 to replacement shields immediately and restores policy on return', () => {
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
    // At LOD0, only board and rim cast shadow (boss, emblem, rear-grip are false)
    expect(current.filter(mesh => mesh.castShadow)).toHaveLength(2)
    expect(oldMeshes.every(mesh => !mesh.castShadow && mesh.parent === null)).toBe(true)
    expect(collectEquipmentRenderCensus([npc]).visibleShadowCastersByKind.shield).toBe(2)
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
      expect(census.visibleShadowCasters).toBeGreaterThan(0)
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

  // ── Contract Tests Required by Specification ──

  describe('Production Shadow Policy Contracts', () => {
    it('Shield: Roman & Viking have board+rim at LOD0, board only at LOD1, 0 at LOD2', () => {
      for (const shieldKind of ['scutum_t1', 'scutum_t2', 'scutum_t3', 'round_shield_t1', 'round_shield_t2', 'round_shield_t3']) {
        const root = new THREE.Group()
        WeaponMeshFactory.buildShield(shieldKind, root)
        // Simulate polishWeaponMaterials which sets castShadow = true
        root.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true })

        const controller = new EquipmentVisualLODController()
        controller.register('shield', root)

        // LOD0: board + rim (2 casters)
        controller.setLOD(0)
        const castersLOD0 = meshes(root).filter(m => m.castShadow)
        expect(castersLOD0).toHaveLength(2)
        expect(castersLOD0.map(m => m.name || m.geometry.type)).toEqual(
          shieldKind.startsWith('scutum')
            ? ['curved-scutum-board', 'scutum-rim']
            : ['round-shield-board', 'TorusGeometry']
        )

        // LOD1: board only (1 caster)
        controller.setLOD(1)
        const castersLOD1 = meshes(root).filter(m => m.castShadow)
        expect(castersLOD1).toHaveLength(1)
        expect(castersLOD1[0].name).toBe(shieldKind.startsWith('scutum') ? 'curved-scutum-board' : 'round-shield-board')

        // LOD2: 0 casters
        controller.setLOD(2)
        expect(meshes(root).filter(m => m.castShadow)).toHaveLength(0)
      }
    })

    it('Bow: LOD0 / LOD1 only stave casts shadow; string / arrow / caps shadow OFF; LOD2 = 0', () => {
      for (const bowId of ['wooden_shortbow', 'recurve_longbow', 'elven_runebow']) {
        const actionPivot = new THREE.Group()
        const gripPivot = new THREE.Group()
        actionPivot.add(gripPivot)
        const bow = new CharacterBowVisual(actionPivot, gripPivot)
        bow.rebuild(bowId)
        // CharacterBowVisual calls polishWeaponMaterials internally

        const controller = new EquipmentVisualLODController()
        controller.register('bow', gripPivot)

        // LOD0: only bow-stave-and-grip casts shadow
        controller.setLOD(0)
        const castersLOD0 = meshes(gripPivot).filter(m => m.castShadow)
        expect(castersLOD0).toHaveLength(1)
        expect(castersLOD0[0].name).toBe('bow-stave-and-grip')

        // LOD1: only bow-stave-and-grip casts shadow
        controller.setLOD(1)
        const castersLOD1 = meshes(gripPivot).filter(m => m.castShadow)
        expect(castersLOD1).toHaveLength(1)
        expect(castersLOD1[0].name).toBe('bow-stave-and-grip')

        // LOD2: 0 casters
        controller.setLOD(2)
        expect(meshes(gripPivot).filter(m => m.castShadow)).toHaveLength(0)
      }
    })

    it('Pilum: socket and wrap shadow OFF; shaft, neck, head shadow ON at LOD0 & LOD1; LOD2 = 0', () => {
      for (const tier of [1, 2, 3] as const) {
        const root = new THREE.Group()
        WeaponMeshFactory.buildNpcRanged('roman', tier, root)
        root.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true })

        const controller = new EquipmentVisualLODController()
        controller.register('pilum', root)

        // Expected casters: T1 = 2 (shaft, head); T2 = 3 (shaft, neck, head); T3 = 3 (shaft, neck, head)
        const expectedCount = tier === 1 ? 2 : 3

        controller.setLOD(0)
        expect(meshes(root).filter(m => m.castShadow)).toHaveLength(expectedCount)

        controller.setLOD(1)
        expect(meshes(root).filter(m => m.castShadow)).toHaveLength(expectedCount)

        controller.setLOD(2)
        expect(meshes(root).filter(m => m.castShadow)).toHaveLength(0)
      }
    })

    it('Lance: pole and head shadow ON at LOD0 & LOD1; LOD2 = 0', () => {
      const root = new THREE.Group()
      WeaponMeshFactory.buildMelee('steel_lance', root)
      root.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true })

      const controller = new EquipmentVisualLODController()
      controller.register('lance', root)

      controller.setLOD(0)
      expect(meshes(root).filter(m => m.castShadow)).toHaveLength(2)

      controller.setLOD(1)
      expect(meshes(root).filter(m => m.castShadow)).toHaveLength(2)

      controller.setLOD(2)
      expect(meshes(root).filter(m => m.castShadow)).toHaveLength(0)
    })

    it('Sword: blade and grip-metal shadow ON; handle core and fuller shadow OFF; LOD2 = 0', () => {
      for (const weaponId of ['gladius_rusty', 'gladius_standard', 'centurion_blade', 'rusty_dagger', 'steel_sword', 'runic_greatsword']) {
        const root = new THREE.Group()
        WeaponMeshFactory.buildMelee(weaponId, root)
        root.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true })

        const controller = new EquipmentVisualLODController()
        controller.register('sword', root)

        // Roman Gladius and Viking Sword both have exactly 2 casters at LOD0 and LOD1 (blade + grip-metal)
        controller.setLOD(0)
        const castersLOD0 = meshes(root).filter(m => m.castShadow)
        expect(castersLOD0).toHaveLength(2)
        expect(castersLOD0.map(m => m.name)).toEqual(
          weaponId.startsWith('gladius') || weaponId === 'centurion_blade'
            ? ['roman-gladius-profiled-blade', 'gladius-grip-metal']
            : ['steel-sword-profiled-blade', 'sword-grip-metal']
        )

        controller.setLOD(1)
        const castersLOD1 = meshes(root).filter(m => m.castShadow)
        expect(castersLOD1).toHaveLength(2)

        controller.setLOD(2)
        expect(meshes(root).filter(m => m.castShadow)).toHaveLength(0)
      }
    })

    it('Equipment LOD2: unconditionally 0 for all equipment kinds', () => {
      for (const kind of ['sword', 'shield', 'bow', 'lance', 'pilum'] as const) {
        const root = new THREE.Group()
        if (kind === 'lance') WeaponMeshFactory.buildMelee('steel_lance', root)
        else if (kind === 'sword') WeaponMeshFactory.buildMelee('steel_sword', root)
        else if (kind === 'shield') WeaponMeshFactory.buildShield('scutum_t2', root)
        else if (kind === 'pilum') WeaponMeshFactory.buildNpcRanged('roman', 2, root)
        else {
          const action = new THREE.Group()
          action.add(root)
          new CharacterBowVisual(action, root).rebuild('wooden_shortbow')
        }
        root.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true })

        const controller = new EquipmentVisualLODController()
        controller.register(kind, root)

        controller.setLOD(2)
        expect(meshes(root).filter(m => m.castShadow)).toHaveLength(0)
      }
    })
  })
})
