import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { EquipmentVisualLODController } from '../src/world/EquipmentVisualLODController'
import { WeaponMeshFactory } from '../src/world/WeaponMeshFactory'
import { CharacterBowVisual } from '../src/world/CharacterBowVisual'
import { HUMANOID_LOD_DISTANCES } from '../src/world/HumanoidAssetRegistry'
import { Faction, NPC, AIType } from '../src/world/NPC'
import { Player } from '../src/player/Player'
import { collectEquipmentRenderCensus } from '../src/debug/EquipmentRenderCensus'

const count = (root: THREE.Object3D) => { let n = 0; root.traverseVisible(o => { if ((o as THREE.Mesh).isMesh) n++ }); return n }
function build(kind: string, tier: number) {
  const root = new THREE.Group()
  let tip: THREE.Vector3 | undefined
  if (kind === 'viking' || kind === 'roman' || kind === 'lance') tip = WeaponMeshFactory.buildNpcMelee(kind === 'roman' ? 'roman' : 'viking', tier, kind === 'lance', root)
  else if (kind === 'pilum') WeaponMeshFactory.buildNpcRanged('roman', tier, root)
  else if (kind === 'bow') {
    const action = new THREE.Group(); action.add(root)
    const bow = new CharacterBowVisual(action, root)
    bow.rebuild(['wooden_shortbow', 'recurve_longbow', 'elven_runebow'][tier - 1])
    bow.update(0, undefined, true)
  } else WeaponMeshFactory.buildShield(`${kind}_t${tier}`, root)
  return { root, tip }
}
const expected: Record<string, number[][]> = {
  viking: [[4, 3, 3]], roman: [[3, 3, 3]], round_shield: [[5, 3, 2]], scutum: [[5, 4, 3]],
  bow: [[8, 6, 6]], lance: [[2, 2, 2]], pilum: [[3, 3, 2], [4, 4, 3], [5, 4, 3]],
}

describe('equipment visual LOD', () => {
  for (const kind of Object.keys(expected)) for (const tier of [1, 2, 3]) {
    it(`${kind} T${tier}: exact counts, stable hierarchy / geometry / metadata / attachment`, () => {
      const { root, tip } = build(kind, tier), controller = new EquipmentVisualLODController()
      root.position.set(2, 3, 4); root.rotation.set(.2, .3, .4); root.scale.set(.8, 1.1, 1.2)
      const snapshot = () => {
        const rows: unknown[] = []
        root.traverse(o => rows.push([o.uuid, o.parent?.uuid, o.position.toArray(), o.quaternion.toArray(), o.scale.toArray(), JSON.stringify(o.userData), (o as THREE.Mesh).geometry?.uuid]))
        return { rows, tip: tip?.toArray() }
      }
      const before = snapshot(), nearCount = count(root)
      controller.register('sword', root)
      const counts = [0, 1, 2].map(level => { controller.setLOD(level as 0 | 1 | 2); expect(snapshot()).toEqual(before); return count(root) })
      expect(counts).toEqual(expected[kind][tier - 1] ?? expected[kind][0])
      expect(counts[0]).toBe(nearCount)
      expect(counts[0]).toBeGreaterThanOrEqual(counts[1]); expect(counts[1]).toBeGreaterThanOrEqual(counts[2])
      for (let frame = 0; frame < 100; frame++) for (const level of [0, 1, 2, 1, 0] as const) {
        controller.setLOD(level); expect(count(root)).toBe(counts[level])
      }
      expect(snapshot()).toEqual(before)
    })
  }

  it('uses actual Three selection at 27/28/29/59/60/61m including zoom and preserves the prior hook', () => {
    const lod = new THREE.LOD(), camera = new THREE.PerspectiveCamera(), controller = new EquipmentVisualLODController()
    HUMANOID_LOD_DISTANCES.forEach(d => lod.addLevel(new THREE.Group(), d))
    const prior = vi.fn((c: THREE.Camera) => THREE.LOD.prototype.update.call(lod, c))
    lod.update = prior; controller.followHumanoid(lod)
    const root = build('round_shield', 3).root; controller.register('shield', root)
    for (let cycle = 0; cycle < 10; cycle++) for (const [distance, level] of [[27, 0], [28, 1], [29, 1], [59, 1], [60, 2], [61, 2], [59, 1], [61, 2], [29, 1], [27, 0]]) {
      camera.position.z = distance; camera.updateMatrixWorld(); lod.update(camera)
      expect(controller.currentLevel).toBe(level); expect(count(root)).toBe([5, 3, 2][level])
    }
    camera.zoom = 2; camera.position.z = 60; camera.updateMatrixWorld(); lod.update(camera)
    expect(controller.currentLevel).toBe(1); expect(prior).toHaveBeenCalledTimes(101)
    const traverse = vi.spyOn(root, 'traverse')
    const writes = root.children.map(child => {
      let visible = child.visible
      const set = vi.fn((value: boolean) => { visible = value })
      Object.defineProperty(child, 'visible', { get: () => visible, set, configurable: true })
      return set
    })
    controller.setLOD(1); controller.setLOD(1)
    expect(traverse).not.toHaveBeenCalled(); writes.forEach(spy => expect(spy).not.toHaveBeenCalled())
  })

  it('does not own root or dynamic bow visibility during draw / hold / release / recovery', () => {
    const root = new THREE.Group(), action = new THREE.Group(); action.add(root)
    const bow = new CharacterBowVisual(action, root); bow.rebuild('elven_runebow')
    const controller = new EquipmentVisualLODController(); controller.register('bow', root)
    for (const [draw, arrowVisible] of [[0, false], [.5, true], [1, true], [0, false], [0, false]] as const) {
      for (const level of [0, 1, 2, 1, 0] as const) {
        bow.update(draw, undefined, arrowVisible); controller.setLOD(level)
        const internals = bow as any
        expect(internals.nockedArrow.visible).toBe(arrowVisible)
        expect(internals.stringTop.visible).toBe(true); expect(internals.stringBottom.visible).toBe(true)
        expect(internals.stringTop.scale.y).toBeGreaterThan(0)
      }
    }
    root.visible = false; controller.setLOD(2); controller.setLOD(0); expect(root.visible).toBe(false)
  })

  it('keeps far detail policy through ranged-to-melee and respawn root visibility changes', () => {
    for (const faction of [Faction.PLAYER, Faction.ENEMY]) {
      const characterFaction = faction === Faction.ENEMY ? 'roman' : 'viking'
      const npc = new NPC(new THREE.Scene(), 0, 0, faction, characterFaction, AIType.RANGED, 'lifecycle', 3, false)
      const fixture = npc as any
      npc.equipmentVisualLOD.setLOD(2)
      const counts = collectEquipmentRenderCensus([npc])
      expect(counts.visibleMeshes.sword).toBe(0)
      expect(counts.totalVisibleMeshes).toBeGreaterThan(0)
      fixture._switchToMelee()
      expect(collectEquipmentRenderCensus([npc]).visibleMeshes.sword).toBe(3)
      expect(fixture.bowPivot.visible).toBe(false)
      npc.respawn()
      expect(fixture.bowPivot.visible).toBe(true)
      expect(collectEquipmentRenderCensus([npc]).visibleMeshes.sword).toBe(0)
      expect(npc.equipmentVisualLOD.currentLevel).toBe(2)
    }
  })

  it('replaces rebuilt shield registration immediately, counts ancestors and leaves Player full detail', () => {
    const scene = new THREE.Scene(), npc = new NPC(scene, 0, 0, Faction.PLAYER, 'viking', AIType.MELEE, 'LOD', 3, false)
    const player = new Player(scene), fixture = npc as any
    const playerDetails: THREE.Object3D[] = []
    player.group.traverse(o => { if (o.userData.equipmentLastVisibleLOD !== undefined) playerDetails.push(o) })
    expect(playerDetails.length).toBeGreaterThan(0)
    npc.equipmentVisualLOD.setLOD(2)
    expect(count(fixture.shieldPivot)).toBe(2)
    const removed = [...fixture.shieldPivot.children]
    npc.shieldId = 'scutum_t3'; npc.rebuildShield()
    expect(count(fixture.shieldPivot)).toBe(3)
    npc.equipmentVisualLOD.setLOD(0)
    expect(count(fixture.shieldPivot)).toBe(5)
    expect(removed.every(o => o.parent === null)).toBe(true)
    npc.equipmentVisualLOD.setLOD(2)
    expect(playerDetails.every(o => o.visible)).toBe(true)
    const census = collectEquipmentRenderCensus([npc])
    expect(census.lodCounts).toEqual([0, 0, 1]); expect(census.visibleMeshes.sword).toBe(3)
    expect(census.visibleMeshes.shield).toBe(3); expect(census.visibleMeshes.bow).toBe(0)
    npc.group.visible = false; expect(collectEquipmentRenderCensus([npc]).totalVisibleMeshes).toBe(0)
  })
})
