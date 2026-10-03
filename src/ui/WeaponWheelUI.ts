import type { InventoryManager } from '../rpg/InventoryManager'

/** Shared battle/town HUD, stacked above ammunition instead of covering other HUDs. */
export class WeaponWheelUI {
  private readonly root = document.createElement('div')
  private lastText = ''

  constructor() {
    this.root.className = 'weapon-wheel-hud'
    this.root.hidden = true
    document.getElementById('combat-equipment-hud')?.prepend(this.root)
  }

  update(inventory: InventoryManager, visible: boolean, mode: 'weapon' | 'command' = 'weapon'): void {
    this.root.hidden = !visible
    if (!visible) return
    const stacks = inventory.inventoryStacks
    const equipped = stacks.filter(({ item }) => inventory.isEquipped(item.id)).map(({ item }) => item.name)
    const available = stacks.filter(({ item, quantity }) => quantity > 0 && !inventory.isEquipped(item.id) && inventory.canEquipWeapon(item.id)).map(({ item }) => item.name)
    const hint = inventory.shieldEnabled && inventory.equippedShield ? '按住右鍵：舉盾' : inventory.rangedEnabled ? '右鍵：瞄準 · 左鍵：射擊' : '左鍵：近戰攻擊'
    const options = available.slice(0, 2).join('／') + (available.length > 2 ? `／另 ${available.length - 2} 項` : '')
    const text = `目前裝備：${equipped.join('／') || '已收起'}\n${hint}\n${mode === 'command' ? '滾輪：命令 · Q 返回武器切換' : `滾輪立即切換（${available.length}）：${options || '沒有其他可用裝備'}`}`
    if (text !== this.lastText) { this.root.textContent = text; this.lastText = text }
  }

  dispose(): void { this.root.remove() }
}
