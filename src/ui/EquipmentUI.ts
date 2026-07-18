/**
 * EquipmentUI.ts
 * Manages the RPG Character & Equipment Modal overlay (toggled via Tab or I key).
 * Renders owned items, quantity badges (x2, x3), Tier badges (灰/藍/金), damage stats, and handles EQUIP buttons.
 */
import type { SkillManager } from '../rpg/SkillManager'
import type { InventoryManager } from '../rpg/InventoryManager'
import { getTierBadge, getTierColor } from '../rpg/WeaponDatabase'

export class EquipmentUI {
  private modal: HTMLElement
  private ohLvlEl: HTMLElement
  private ohFillEl: HTMLElement
  private arcLvlEl: HTMLElement
  private arcFillEl: HTMLElement
  private inventoryListEl: HTMLElement

  private isOpen = false

  get visible(): boolean { return this.isOpen }

  constructor() {
    this.modal           = document.getElementById('character-modal')!
    this.ohLvlEl         = document.getElementById('skill-oh-lvl')!
    this.ohFillEl        = document.getElementById('skill-oh-fill')!
    this.arcLvlEl        = document.getElementById('skill-arc-lvl')!
    this.arcFillEl       = document.getElementById('skill-arc-fill')!
    this.inventoryListEl = document.getElementById('inventory-list')!
  }

  toggle(skillManager: SkillManager, inventoryManager: InventoryManager, onEquipChanged?: () => void): void {
    if (this.isOpen) {
      this.close()
    } else {
      this.open(skillManager, inventoryManager, onEquipChanged)
    }
  }

  open(skillManager: SkillManager, inventoryManager: InventoryManager, onEquipChanged?: () => void): void {
    this.isOpen = true
    this.updateModal(skillManager, inventoryManager, onEquipChanged)
    this.modal.classList.add('visible')
  }

  close(): void {
    this.isOpen = false
    this.modal.classList.remove('visible')
  }

  updateModal(skillManager: SkillManager, inventoryManager: InventoryManager, onEquipChanged?: () => void): void {
    const { oneHanded, archery } = skillManager.skillState

    // One-Handed XP
    this.ohLvlEl.textContent = ` Lv.${oneHanded.level}`
    const ohNeeded = skillManager.getXpNeeded(oneHanded.level)
    this.ohFillEl.style.width = `${Math.min(100, (oneHanded.xp / ohNeeded) * 100)}%`

    // Archery XP
    this.arcLvlEl.textContent = ` Lv.${archery.level}`
    const arcNeeded = skillManager.getXpNeeded(archery.level)
    this.arcFillEl.style.width = `${Math.min(100, (archery.xp / arcNeeded) * 100)}%`

    // Render Inventory Cards
    this.inventoryListEl.innerHTML = ''
    const stacks = inventoryManager.inventoryStacks

    stacks.forEach(({ weapon, quantity }) => {
      const isEquipped = inventoryManager.isEquipped(weapon.id)
      const tierColor  = getTierColor(weapon.tier)
      const tierBadge  = getTierBadge(weapon.tier)

      let dmgText = ''
      if (weapon.type === 'melee') {
        const scaledDmg = Math.round(weapon.damageMax * skillManager.getOneHandedMultiplier())
        dmgText = `傷害: ${scaledDmg} | 揮速: ${weapon.speedOrCharge}s`
      } else {
        const scaledMin = Math.round(weapon.damageMin * skillManager.getArcheryMultiplier())
        const scaledMax = Math.round(weapon.damageMax * skillManager.getArcheryMultiplier())
        dmgText = `傷害: ${scaledMin}~${scaledMax} | 蓄力: ${weapon.speedOrCharge}s`
      }

      const qtyBadge = quantity > 1 ? `<span style="background: rgba(232, 201, 106, 0.25); border: 1px solid #e8c96a; padding: 1px 6px; border-radius: 4px; font-size: 11px; font-weight: 700; color: #fff;">x${quantity}</span>` : ''

      const card = document.createElement('div')
      card.className = `inventory-card ${isEquipped ? 'equipped' : ''}`
      card.innerHTML = `
        <div class="inv-item-header">
          <span class="inv-item-name" style="color: ${tierColor};">${weapon.name} ${qtyBadge}</span>
          <span class="inv-item-tier" style="color: ${tierColor};">${tierBadge}</span>
        </div>
        <div class="inv-item-stats">${dmgText}</div>
        <div class="inv-item-desc">${weapon.description}</div>
        <button class="btn-equip ${isEquipped ? 'is-active' : ''}">${isEquipped ? '已裝備' : '【裝備】'}</button>
      `

      const btn = card.querySelector('.btn-equip')!
      if (!isEquipped) {
        btn.addEventListener('click', () => {
          inventoryManager.equipWeapon(weapon.id)
          this.updateModal(skillManager, inventoryManager, onEquipChanged)
          if (onEquipChanged) onEquipChanged()
        })
      }

      this.inventoryListEl.appendChild(card)
    })
  }
}
