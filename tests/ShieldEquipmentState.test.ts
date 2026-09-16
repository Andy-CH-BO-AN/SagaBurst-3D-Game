import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { InventoryManager } from '../src/rpg/InventoryManager'
import { getUnitCombatProfile } from '../src/battle/BattleConfig'
import { Faction, NPC, AIType } from '../src/world/NPC'
import { Player } from '../src/player/Player'
import { WeaponMeshFactory } from '../src/world/WeaponMeshFactory'

const input = (values = {}) => ({ keys: {}, isLeftMouseDown: false, isRightMouseDown: false,
  consumeLeftClick: () => false, consumeLeftClickRelease: () => false, ...values })
function fixture() {
  const player = new Player(new THREE.Scene())
  const inventory = new InventoryManager()
  const ui = { setAiming: vi.fn(), setChargeRatio: vi.fn(), setShieldBlocked: vi.fn() }
  const update = (controls: any, dt = 1 / 60) => player.update(dt, controls, 0, new THREE.Vector3(0, 1.4, 10), [], { setFill() {} } as any, ui as any, { playSwing() {}, playBowRelease() {} } as any, inventory)
  return { player, inventory, ui, update }
}

describe('盾牌裝備規則', () => {
  it('卸盾保留物品且能以現有 nullable 存檔讀回', () => {
    const a = new InventoryManager(); const before = a.inventoryStacks.map(s => [s.item.id, s.quantity])
    a.unequipShield(); const b = new InventoryManager(); b.loadSaveState(a.saveState)
    expect(b.equippedShield).toBeNull()
    expect(b.inventoryStacks.map(s => [s.item.id, s.quantity])).toEqual(before)
    expect(b.equipWeapon('round_shield_t3')).toBe(true)
    expect(b.equippedShield?.id).toBe('round_shield_t3')
  })
  it('兩陣營 T1–T3 近戰兵有盾，遠程兵無盾', () => {
    for (const faction of [Faction.PLAYER, Faction.ENEMY]) for (const tier of [1, 2, 3] as const) {
      for (const kind of ['infantry', 'cavalry', 'archer', 'horseArcher'] as const) {
        const p = getUnitCombatProfile(faction, kind, tier)
        expect(p.shieldId).toBe(kind === 'infantry' || kind === 'cavalry' ? `${faction === Faction.PLAYER ? 'round_shield' : 'scutum'}_t${tier}` : null)
      }
    }
  })
  it('持盾按瞄準不拉弓、不花箭、不意外出近戰；卸盾後可拉弓', () => {
    const f = fixture(); const arrows = f.player.arrows
    f.update(input({ isRightMouseDown: true, isLeftMouseDown: true, consumeLeftClick: () => true }))
    expect(f.player.isAiming).toBe(false)
    expect(f.player.arrows).toBe(arrows)
    expect((f.player as any).animator.busy).toBe(false)
    expect(f.ui.setShieldBlocked).toHaveBeenLastCalledWith(true)
    f.inventory.unequipShield(); f.update(input({ isRightMouseDown: true, isLeftMouseDown: true }), .2)
    expect(f.player.isAiming).toBe(true)
    expect((f.player as any).bowChargeTime).toBeGreaterThan(0)
  })
  it('拉弓途中裝盾取消蓄力，切裝取消尚未發生的命中', () => {
    const f = fixture(); f.inventory.unequipShield()
    f.update(input({ isRightMouseDown: true, isLeftMouseDown: true }), .3)
    f.inventory.equipWeapon('round_shield_t3')
    f.update(input({ consumeLeftClickRelease: () => true }), .3)
    expect((f.player as any).bowChargeTime).toBe(0)
    expect(f.player.arrows).toBe(30)
    f.update(input({ consumeLeftClick: () => true }))
    expect((f.player as any).animator.busy).toBe(true)
    f.inventory.equipWeapon('runic_greatsword'); f.update(input(), .5)
    expect((f.player as any).animator.busy).toBe(false)
    expect((f.player as any).hitEventPending).toBe(false)
  })
  it('Player／NPC 槍模型共享握點、支撐點與尖端，兩盾型都有實體握把', () => {
    const a = new THREE.Group(), b = new THREE.Group()
    const tip = WeaponMeshFactory.buildMelee('steel_lance', a).tipLocal
    expect(WeaponMeshFactory.buildNpcMelee(Faction.ENEMY, 3, true, b).equals(tip)).toBe(true)
    expect(b.userData).toEqual(a.userData)
    for (const id of ['scutum_t2', 'round_shield_t2']) {
      const shield = new THREE.Group(); WeaponMeshFactory.buildShield(id, shield)
      expect(shield.getObjectByName('shield-rear-grip')).toBeDefined()
      expect(shield.userData.gripCenterLocal).toEqual([0, 0, .085])
    }
  })
  it('弓兵臨時裝盾保留箭數，卸盾恢復遠程；投槍持盾仍可投擲', () => {
    for (const faction of [Faction.PLAYER, Faction.ENEMY]) {
      const npc = new NPC(new THREE.Scene(), 0, 0, faction, AIType.RANGED, 'shield-test', 2, false)
      const arrows = npc.arrows
      npc.shieldId = faction === Faction.PLAYER ? 'round_shield_t2' : 'scutum_t2'
      npc.rebuildShield()
      expect(npc.arrows).toBe(arrows)
      expect((npc as any).hasActiveRangedWeapon).toBe(faction === Faction.ENEMY)
      npc.shieldId = null; npc.rebuildShield()
      expect((npc as any).hasActiveRangedWeapon).toBe(true)
      expect(npc.arrows).toBe(arrows)
    }
  })
})
