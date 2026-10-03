/**
 * EquipmentUI.ts
 * Manages the RPG Character & Equipment Modal overlay (toggled via Tab or I key).
 * Renders owned items, quantity badges (x2, x3), Tier badges (灰/藍/金), damage stats, and handles EQUIP buttons.
 */
import { resolveMeleeSkillId, type SkillManager } from '../rpg/SkillManager'
import type { InventoryManager } from '../rpg/InventoryManager'
import { getTierBadge, getTierColor } from '../rpg/WeaponDatabase'

export interface EquipmentMountItem {
  id: string
  name: string
  tier: number
  active: boolean
  available: boolean
}

export interface EquipmentMountAdapter {
  statusText: string
  list(): EquipmentMountItem[]
  activate(id: string): boolean
  dismiss(): boolean
}

export class EquipmentUI {
  private modal: HTMLElement
  private ohLvlEl: HTMLElement
  private ohFillEl: HTMLElement
  private thLvlEl: HTMLElement
  private thFillEl: HTMLElement
  private rangedLvlEl: HTMLElement
  private rangedFillEl: HTMLElement
  private mountLvlEl: HTMLElement
  private mountFillEl: HTMLElement
  private inventoryListEl: HTMLElement

  private isOpen = false

  get visible(): boolean { return this.isOpen }

  constructor() {
    this.modal           = document.getElementById('character-modal')!
    this.ohLvlEl         = document.getElementById('skill-oh-lvl')!
    this.ohFillEl        = document.getElementById('skill-oh-fill')!
    this.thLvlEl         = document.getElementById('skill-th-lvl')!
    this.thFillEl        = document.getElementById('skill-th-fill')!
    this.rangedLvlEl     = document.getElementById('skill-ranged-lvl')!
    this.rangedFillEl    = document.getElementById('skill-ranged-fill')!
    this.mountLvlEl      = document.getElementById('skill-mount-lvl')!
    this.mountFillEl     = document.getElementById('skill-mount-fill')!
    this.inventoryListEl = document.getElementById('inventory-list')!
  }

  toggle(skillManager: SkillManager, inventoryManager: InventoryManager, onEquipChanged?: () => void, mounts?: EquipmentMountAdapter): void {
    if (this.isOpen) {
      this.close()
    } else {
      this.open(skillManager, inventoryManager, onEquipChanged, mounts)
    }
  }

  open(skillManager: SkillManager, inventoryManager: InventoryManager, onEquipChanged?: () => void, mounts?: EquipmentMountAdapter): void {
    this.isOpen = true
    this.updateModal(skillManager, inventoryManager, onEquipChanged, mounts)
    this.modal.classList.add('visible')
  }

  close(): void {
    this.isOpen = false
    this.modal.classList.remove('visible')
  }

  updateModal(skillManager: SkillManager, inventoryManager: InventoryManager, onEquipChanged?: () => void, mounts?: EquipmentMountAdapter): void {
    const { oneHanded, twoHanded, ranged, mountedImpact, blocking } = skillManager.skillState

    const renderSkill = (levelEl: HTMLElement, fillEl: HTMLElement, data: { level: number; xp: number }): void => {
      const needed = skillManager.getXpNeeded(data.level)
      levelEl.textContent = data.level >= 50 ? ' Lv.50 MAX' : ` Lv.${data.level}`
      fillEl.style.width = needed > 0 ? `${Math.min(100, (data.xp / needed) * 100)}%` : '100%'
    }
    renderSkill(this.ohLvlEl, this.ohFillEl, oneHanded)
    renderSkill(this.thLvlEl, this.thFillEl, twoHanded)
    renderSkill(this.rangedLvlEl, this.rangedFillEl, ranged)
    renderSkill(this.mountLvlEl, this.mountFillEl, mountedImpact)
    const blockLevel = document.getElementById('skill-block-lvl'), blockFill = document.getElementById('skill-block-fill')
    if (blockLevel && blockFill) renderSkill(blockLevel, blockFill, blocking)

    // Render Inventory Cards
    this.inventoryListEl.innerHTML = ''
    const stacks = inventoryManager.inventoryStacks

    stacks.forEach(({ item, quantity }) => {
      const isEquipped = inventoryManager.isEquipped(item.id)
      const tierColor  = getTierColor(item.tier)
      const tierBadge  = getTierBadge(item.tier)

      let dmgText = ''
      if (item.type === 'melee') {
        const meleeSkill = resolveMeleeSkillId(item as any, Boolean(inventoryManager.shieldEnabled && inventoryManager.equippedShield))
        const scaledDmg = Math.round((item as any).damageMax * skillManager.getMultiplier(meleeSkill))
        dmgText = `傷害: ${scaledDmg} | 揮速: ${(item as any).speedOrCharge}s`
      } else if (item.type === 'ranged') {
        const scaledMin = Math.round((item as any).damageMin * skillManager.getRangedMultiplier())
        const scaledMax = Math.round((item as any).damageMax * skillManager.getRangedMultiplier())
        dmgText = `傷害: ${scaledMin}~${scaledMax} | 蓄力: ${(item as any).speedOrCharge}s`
      } else if (item.type === 'shield') {
        // armor data
        dmgText = `Shield Impact: ${(item as any).shieldImpactMax} ｜ 按住 Space 舉盾`
      }

      const qtyBadge = quantity > 1 ? `<span style="background: rgba(232, 201, 106, 0.25); border: 1px solid #e8c96a; padding: 1px 6px; border-radius: 4px; font-size: 11px; font-weight: 700; color: #fff;">x${quantity}</span>` : ''

      const card = document.createElement('div')
      card.className = `inventory-card ${isEquipped ? 'equipped' : ''}`
      card.innerHTML = `
        <div class="inv-item-header">
          <span class="inv-item-name" style="color: ${tierColor};">${item.name} ${qtyBadge}</span>
          <span class="inv-item-tier" style="color: ${tierColor};">${tierBadge}</span>
        </div>
        <div class="inv-item-stats">${dmgText}</div>
        <div class="inv-item-desc">${item.description}</div>
        <button class="btn-equip ${isEquipped ? 'is-active' : ''}">${isEquipped ? item.type === 'shield' ? '卸下盾牌' : '已裝備' : '【裝備】'}</button>
      `

      const btn = card.querySelector('.btn-equip')!
      if (!isEquipped || item.type === 'shield') {
        btn.addEventListener('click', () => {
          if (isEquipped && item.type === 'shield') inventoryManager.unequipShield()
          else inventoryManager.equipWeapon(item.id)
          this.updateModal(skillManager, inventoryManager, onEquipChanged, mounts)
          if (onEquipChanged) onEquipChanged()
        })
      }

      this.inventoryListEl.appendChild(card)
    })

    if (mounts) {
      const title = document.createElement('div')
      title.className = 'modal-section-title inventory-wide'
      title.textContent = '坐騎 Mounts'
      this.inventoryListEl.appendChild(title)
      for (const mount of mounts.list()) {
        const card = document.createElement('div')
        card.className = `inventory-card ${mount.active ? 'equipped' : ''}`
        card.innerHTML = `
          <div class="inv-item-header"><span class="inv-item-name">${mount.name} T${mount.tier}</span></div>
          <div class="inv-item-stats">${mount.active ? '騎乘中' : mount.available ? '可騎乘' : '本次無法使用'}</div>
          <button class="btn-equip ${mount.active ? 'is-active' : ''}" ${mount.available ? '' : 'disabled'}>${mount.active ? '【收起】' : '【騎乘】'}</button>
        `
        const button = card.querySelector('button')!
        button.addEventListener('click', () => {
          if (mount.active) mounts.dismiss()
          else mounts.activate(mount.id)
          this.updateModal(skillManager, inventoryManager, onEquipChanged, mounts)
        })
        this.inventoryListEl.appendChild(card)
      }
      if (mounts.statusText) {
        const status = document.createElement('p')
        status.className = 'inv-item-desc inventory-wide'
        status.textContent = mounts.statusText
        this.inventoryListEl.appendChild(status)
      }
    }
  }
}
