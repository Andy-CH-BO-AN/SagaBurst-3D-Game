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
  quantityText?: string
  allocated?: boolean
}

export interface EquipmentMountAdapter {
  statusText: string
  list(): EquipmentMountItem[]
  activate(id: string): boolean
  dismiss(): boolean
  release?(id: string): boolean
}

export interface EquipmentSquadAdapter { render(container: HTMLElement, refresh: () => void): void }

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
  private squadListEl: HTMLElement
  private tabs: HTMLButtonElement[]
  private panels: HTMLElement[]

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
    this.squadListEl     = document.getElementById('squad-list')!
    this.tabs = Array.from(this.modal.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    this.panels = this.tabs.map(tab => document.getElementById(tab.getAttribute('aria-controls')!)!)
    this.tabs.forEach((tab, index) => {
      tab.onclick = () => this.selectTab(index)
      tab.onkeydown = event => {
        let next: number
        switch (event.key) {
          case 'ArrowRight': next = (index + 1) % this.tabs.length; break
          case 'ArrowLeft': next = (index + this.tabs.length - 1) % this.tabs.length; break
          case 'Home': next = 0; break
          case 'End': next = this.tabs.length - 1; break
          default: return
        }
        event.preventDefault()
        this.selectTab(next)
        this.tabs[next].focus()
      }
    })
    this.selectTab(1)
  }

  private selectTab(index: number): void {
    this.tabs.forEach((tab, i) => {
      const selected = i === index
      tab.setAttribute('aria-selected', String(selected))
      tab.tabIndex = selected ? 0 : -1
      this.panels[i].hidden = !selected
    })
  }

  toggle(skillManager: SkillManager, inventoryManager: InventoryManager, onEquipChanged?: () => void, mounts?: EquipmentMountAdapter, squad?: EquipmentSquadAdapter): void {
    if (this.isOpen) {
      this.close()
    } else {
      this.open(skillManager, inventoryManager, onEquipChanged, mounts, squad)
    }
  }

  open(skillManager: SkillManager, inventoryManager: InventoryManager, onEquipChanged?: () => void, mounts?: EquipmentMountAdapter, squad?: EquipmentSquadAdapter): void {
    this.isOpen = true
    this.updateModal(skillManager, inventoryManager, onEquipChanged, mounts, squad)
    this.modal.inert = false
    this.modal.classList.add('visible')
    this.tabs.find(tab => tab.getAttribute('aria-selected') === 'true')?.focus({ preventScroll: true })
  }

  close(): void {
    this.isOpen = false
    this.modal.inert = true
    this.modal.classList.remove('visible')
  }

  updateModal(skillManager: SkillManager, inventoryManager: InventoryManager, onEquipChanged?: () => void, mounts?: EquipmentMountAdapter, squad?: EquipmentSquadAdapter): void {
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
        dmgText = `Shield Impact: ${(item as any).shieldImpactMax} ｜ 按住右鍵舉盾`
      }

      const availability = inventoryManager.itemAvailability(item.id)
      const qtyBadge = quantity > 1 ? `<span style="background: rgba(232, 201, 106, 0.25); border: 1px solid #e8c96a; padding: 1px 6px; border-radius: 4px; font-size: 11px; font-weight: 700; color: #fff;">x${quantity}</span>` : ''

      const card = document.createElement('div')
      card.className = `inventory-card ${isEquipped ? 'equipped' : ''}`
      card.innerHTML = `
        <div class="inv-item-header">
          <span class="inv-item-name" style="color: ${tierColor};">${item.name} ${qtyBadge}</span>
          <span class="inv-item-tier" style="color: ${tierColor};">${tierBadge}</span>
        </div>
        <div class="inv-item-stats">${dmgText}</div>
        <div class="inv-item-desc">${availability}</div>
        <div class="inv-item-desc">${item.description}</div>
        <button class="btn-equip ${isEquipped ? 'is-active' : ''}">${isEquipped ? item.type === 'shield' ? '卸下盾牌' : '已裝備' : '【裝備】'}</button>
      `

      const btn = card.querySelector('.btn-equip')!
      ;(btn as HTMLButtonElement).disabled = !isEquipped && !inventoryManager.canEquipWeapon(item.id)
      if (!isEquipped || item.type === 'shield') {
        btn.addEventListener('click', () => {
          if (isEquipped && item.type === 'shield') inventoryManager.unequipShield()
          else inventoryManager.equipWeapon(item.id)
          this.updateModal(skillManager, inventoryManager, onEquipChanged, mounts, squad)
          if (onEquipChanged) onEquipChanged()
        })
      }

      if (inventoryManager.supportsWeaponRelease && inventoryManager.isAllocated(item.id)) {
        const release = document.createElement('button'); release.className = 'btn-equip'; release.textContent = '解除分配'
        release.onclick = () => { inventoryManager.unequipWeapon(item.id); this.updateModal(skillManager, inventoryManager, onEquipChanged, mounts, squad); onEquipChanged?.() }
        card.append(release)
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
          <div class="inv-item-stats">${mount.active ? '騎乘中' : mount.allocated ? '已分配給 Player' : mount.available ? '可騎乘' : '本次無法使用'}</div>
          <div class="inv-item-desc">${mount.quantityText ?? ''}</div>
          <button class="btn-equip ${mount.active ? 'is-active' : ''}" ${mount.available ? '' : 'disabled'}>${mount.active ? '【收起】' : '【騎乘】'}</button>
        `
        const button = card.querySelector('button')!
        button.addEventListener('click', () => {
          if (mount.active) mounts.dismiss()
          else mounts.activate(mount.id)
          this.updateModal(skillManager, inventoryManager, onEquipChanged, mounts, squad)
        })
        if (mount.allocated && mounts.release) {
          const release = document.createElement('button'); release.className = 'btn-equip'; release.textContent = '解除分配'
          release.onclick = () => { mounts.release!(mount.id); this.updateModal(skillManager, inventoryManager, onEquipChanged, mounts, squad) }
          card.append(release)
        }
        this.inventoryListEl.appendChild(card)
      }
      if (mounts.statusText) {
        const status = document.createElement('p')
        status.className = 'inv-item-desc inventory-wide'
        status.textContent = mounts.statusText
        this.inventoryListEl.appendChild(status)
      }
    }
    this.squadListEl.innerHTML = ''
    if (squad) {
      squad.render(this.squadListEl, () => this.updateModal(skillManager, inventoryManager, onEquipChanged, mounts, squad))
    } else {
      const notice = document.createElement('p')
      notice.className = 'inv-item-desc inventory-wide'
      notice.textContent = '可在生涯模式的城鎮管理小隊。升任隊長（Captain）後，可到人資中心（HR Center）雇用隊員。'
      this.squadListEl.append(notice)
    }
  }
}
