import type { HorseAppearanceVariant } from '../world/HorseAssetRegistry'
/**
 * EquipmentUI.ts
 * Manages the RPG Character & Equipment Modal overlay (toggled via Tab or I key).
 * Renders owned items, quantity badges (x2, x3), Tier badges (灰/藍/金), damage stats, and handles EQUIP buttons.
 */
import { resolveMeleeSkillId, type SkillManager } from '../rpg/SkillManager'
import type { InventoryManager } from '../rpg/InventoryManager'
import { equipmentSections, EQUIPMENT_CATEGORIES, type EquipmentCategory } from '../rpg/EquipmentCatalog'
import { getTierBadge, getTierColor } from '../rpg/WeaponDatabase'
import { mountComparisonText, type MountComparison } from '../rpg/MountComparison'
import { compareEquipment, equipmentDetails, equipmentTraits, type ComparableEquipment } from '../rpg/EquipmentComparison'

export interface EquipmentMountItem {
  id: string
  name: string
  tier: number
  active: boolean
  available: boolean
  quantityText?: string
  unavailableReason?: string
  allocated?: boolean
  appearanceVariant?: HorseAppearanceVariant
  appearanceEditable?: boolean
  /** Plain-language traits and, optionally, a precise note shown under 詳細屬性. */
  traits?: string[]
  detail?: string
  /** Difference against the mount being ridden or allocated; absent when the adapter offers none. */
  comparison?: MountComparison
}

export interface EquipmentMountAdapter {
  statusText: string
  /** Set by the UI: fired when a background result (e.g. mount assets finishing) changes statusText. */
  onChange?: () => void
  /** The mount currently loading its assets; activate() returned false only because it is not ready yet. */
  readonly loadingId?: string | null
  list(): EquipmentMountItem[]
  activate(id: string): boolean
  dismiss(): boolean
  release?(id: string): boolean
  setAppearanceVariant?(variant: HorseAppearanceVariant): boolean
}

export interface EquipmentSquadAdapter { render(container: HTMLElement, refresh: () => void): void }
export interface EquipmentTownAdapter extends EquipmentSquadAdapter { access(): { allowed: boolean; reason: string } }

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
  private townListEl: HTMLElement | null
  private tabs: HTMLButtonElement[]
  private panels: HTMLElement[]

  private isOpen = false
  private inventoryCategory: EquipmentCategory | 'mount' = 'melee'
  /** Result of the player's latest equip action, shown in the loadout strip. */
  private feedback = ''
  /** 詳細屬性 sections the player opened, kept across rebuilds. */
  private readonly openDetails = new Set<string>()

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
    this.townListEl      = document.getElementById('town-equipment-list')
    this.tabs = Array.from(this.modal.querySelectorAll<HTMLButtonElement>('.equipment-tabs > [role="tab"]'))
    this.panels = this.tabs.map(tab => document.getElementById(tab.getAttribute('aria-controls')!)!)
    this.tabs.forEach((tab, index) => {
      tab.onclick = () => { if (!tab.disabled) this.selectTab(index) }
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
        const direction = event.key === 'ArrowLeft' || event.key === 'End' ? -1 : 1
        while (this.tabs[next].disabled) next = (next + direction + this.tabs.length) % this.tabs.length
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

  toggle(skillManager: SkillManager, inventoryManager: InventoryManager, onEquipChanged?: () => void, mounts?: EquipmentMountAdapter, squad?: EquipmentSquadAdapter, town?: EquipmentTownAdapter): void {
    if (this.isOpen) {
      this.close()
    } else {
      this.open(skillManager, inventoryManager, onEquipChanged, mounts, squad, town)
    }
  }

  open(skillManager: SkillManager, inventoryManager: InventoryManager, onEquipChanged?: () => void, mounts?: EquipmentMountAdapter, squad?: EquipmentSquadAdapter, town?: EquipmentTownAdapter): void {
    this.isOpen = true
    this.updateModal(skillManager, inventoryManager, onEquipChanged, mounts, squad, town)
    this.modal.inert = false
    this.modal.classList.add('visible')
    this.tabs.find(tab => tab.getAttribute('aria-selected') === 'true')?.focus({ preventScroll: true })
  }

  close(): void {
    this.isOpen = false
    this.modal.inert = true
    this.modal.classList.remove('visible')
  }

  /** Rebuilds the modal while keeping each scroll position and the focused control, so one action never sends the player back to the top. */
  updateModal(skillManager: SkillManager, inventoryManager: InventoryManager, onEquipChanged?: () => void, mounts?: EquipmentMountAdapter, squad?: EquipmentSquadAdapter, town?: EquipmentTownAdapter): void {
    if (mounts) mounts.onChange = () => {
      if (!this.isOpen) return
      this.feedback = mounts.statusText
      this.updateModal(skillManager, inventoryManager, onEquipChanged, mounts, squad, town)
    }
    const scrollers = [this.modal, ...this.panels, this.inventoryListEl, this.squadListEl, ...(this.townListEl ? [this.townListEl] : [])]
    const tops = scrollers.map(element => element.scrollTop)
    const active = document.activeElement instanceof HTMLElement && this.modal.contains(document.activeElement) ? document.activeElement : null
    const focusKey = active?.dataset.focusKey
    this.renderModal(skillManager, inventoryManager, onEquipChanged, mounts, squad, town)
    scrollers.forEach((element, index) => { element.scrollTop = tops[index] })
    if (focusKey) {
      const next = Array.from(this.modal.querySelectorAll<HTMLElement>('[data-focus-key]')).find(element => element.dataset.focusKey === focusKey)
      if (next && !(next as HTMLButtonElement | HTMLSelectElement).disabled) next.focus({ preventScroll: true })
    }
  }

  private renderModal(skillManager: SkillManager, inventoryManager: InventoryManager, onEquipChanged?: () => void, mounts?: EquipmentMountAdapter, squad?: EquipmentSquadAdapter, town?: EquipmentTownAdapter): void {
    const { oneHanded, twoHanded, ranged, mountedImpact, blocking, unarmed } = skillManager.skillState

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
    const fistLevel = document.getElementById('skill-unarmed-lvl'), fistFill = document.getElementById('skill-unarmed-fill')
    if (fistLevel && fistFill) {
      renderSkill(fistLevel, fistFill, unarmed)
      fistLevel.textContent = ` Lv.${unarmed.level}/50`
      const detail = document.getElementById('skill-unarmed-detail'), needed = skillManager.getXpNeeded(unarmed.level)
      if (detail) detail.textContent = `${needed ? `XP ${Math.floor(unarmed.xp)} / ${needed}` : 'MAX'} · 傷害 ×${skillManager.getMultiplier('unarmed').toFixed(2)}`
    }

    // Render Inventory Cards
    this.inventoryListEl.innerHTML = ''
    this.renderLoadout(inventoryManager, mounts)
    const categories = document.createElement('div'); categories.className = 'inventory-categories inventory-wide'
    categories.setAttribute('role', 'group'); categories.setAttribute('aria-label', '倉庫商品分類')
    for (const [category, label] of [...EQUIPMENT_CATEGORIES, ['mount', '坐騎 Mounts']] as const) {
      const tab = document.createElement('button'); tab.className = 'equipment-tab'; tab.textContent = label
      tab.dataset.category = category; tab.setAttribute('aria-pressed', String(category === this.inventoryCategory))
      tab.onclick = () => {
        this.inventoryCategory = category
        this.updateModal(skillManager, inventoryManager, onEquipChanged, mounts, squad, town)
        this.inventoryListEl.querySelector<HTMLButtonElement>(`[data-category="${category}"]`)?.focus({ preventScroll: true })
      }
      categories.append(tab)
    }
    this.inventoryListEl.append(categories)
    const stacks = inventoryManager.inventoryStacks.map(({ item, quantity }) => ({ ...item, quantity }))
    const sections = this.inventoryCategory === 'mount' ? [] : equipmentSections(stacks, this.inventoryCategory)
    const mountItems = this.inventoryCategory === 'mount' ? mounts?.list() ?? [] : []
    if (this.inventoryCategory === 'mount' ? !mountItems.length : !sections.length) {
      const empty = document.createElement('p'); empty.className = 'inv-item-desc inventory-wide'
      empty.textContent = this.inventoryCategory === 'mount' ? '目前沒有持有坐騎。' : '此分類目前沒有持有裝備。'
      this.inventoryListEl.append(empty)
    }
    for (const section of sections) {
      const heading = document.createElement('h3'); heading.className = 'inventory-tier inventory-wide'
      heading.textContent = `TIER ${section.tier}`; this.inventoryListEl.append(heading)
      for (const item of section.items) {
        const quantity = item.quantity
        const isEquipped = inventoryManager.isEquipped(item.id)
        const tierColor  = getTierColor(item.tier)
        const tierBadge  = getTierBadge(item.tier)

        const current = item.type === 'shield' ? inventoryManager.equippedShield : item.type === 'ranged' ? inventoryManager.selectedRanged : inventoryManager.equippedMelee
        const comparison = compareEquipment(item as ComparableEquipment, current)
        const traitText = equipmentTraits(item as ComparableEquipment).join(' · ')
        const compareText = comparison.relation === 'none' || comparison.relation === 'same' && isEquipped ? ''
          : `${{ upgrade: '▲ 較強', downgrade: '▼ 較弱', mixed: '◆ 各有取捨', same: '＝', none: '' }[comparison.relation]}：${comparison.lines.join(' · ')}`
        const detailText = [...equipmentDetails(item as ComparableEquipment),
          ...(item.type === 'melee' ? [`技能加成後傷害 ${Math.round(item.damageMax * skillManager.getMultiplier(resolveMeleeSkillId(item, Boolean(inventoryManager.shieldEnabled && inventoryManager.equippedShield))))}`] : [])].join(' ｜ ')

        const availability = inventoryManager.itemAvailability(item.id)
        const qtyBadge = quantity > 1 ? `<span style="background: rgba(232, 201, 106, 0.25); border: 1px solid #e8c96a; padding: 1px 6px; border-radius: 4px; font-size: 11px; font-weight: 700; color: #fff;">x${quantity}</span>` : ''

        const card = document.createElement('div')
        card.className = `inventory-card ${isEquipped ? 'equipped' : ''}`
        card.innerHTML = `
          <div class="inv-item-header">
            <span class="inv-item-name" style="color: ${tierColor};">${item.name} ${qtyBadge}</span>
            <span class="inv-item-tier" style="color: ${tierColor};">${tierBadge}</span>
          </div>
          <div class="inv-item-stats">${traitText}</div>
          ${compareText ? `<div class="inv-item-compare compare-${comparison.relation}">${compareText}</div>` : ''}
          <div class="inv-item-desc">${availability}</div>
          <details class="inv-item-details" data-details-key="item:${item.id}"><summary>詳細屬性</summary><div class="inv-item-desc">${detailText}</div><div class="inv-item-desc">${item.description}</div></details>
          <button class="btn-equip ${isEquipped ? 'is-active' : ''}" data-focus-key="equip:${item.id}">${isEquipped ? item.type === 'shield' ? '卸下盾牌' : '已裝備' : '【裝備】'}</button>
        `

        const btn = card.querySelector('.btn-equip')!
        ;(btn as HTMLButtonElement).disabled = !isEquipped && !inventoryManager.canEquipWeapon(item.id)
        if (!isEquipped || item.type === 'shield') {
          btn.addEventListener('click', () => {
            if (isEquipped && item.type === 'shield') this.feedback = inventoryManager.unequipShield() ? `已卸下盾牌：${item.name}` : `無法卸下盾牌：${item.name}（保存失敗或目前不可更換）`
            else {
              const replaced = current && current.id !== item.id ? current.name : ''
              this.feedback = inventoryManager.equipWeapon(item.id) ? `已裝備：${item.name}${replaced ? `（取代 ${replaced}）` : ''}` : `無法裝備：${item.name}`
            }
            this.updateModal(skillManager, inventoryManager, onEquipChanged, mounts, squad, town)
            if (onEquipChanged) onEquipChanged()
          })
        }

        if (inventoryManager.supportsWeaponRelease && inventoryManager.isAllocated(item.id)) {
          const release = document.createElement('button'); release.className = 'btn-equip'; release.textContent = '解除分配'; release.dataset.focusKey = `release:${item.id}`
          release.onclick = () => { const released = inventoryManager.unequipWeapon(item.id); this.feedback = released ? `已解除分配：${item.name}` : `無法解除分配：${item.name}（保存失敗或目前不可更換）`; this.updateModal(skillManager, inventoryManager, onEquipChanged, mounts, squad, town); onEquipChanged?.() }
          card.append(release)
        }
        this.inventoryListEl.appendChild(card)
      }
    }

    if (this.inventoryCategory === 'mount' && mounts) {
      let tier: number | undefined
      for (const mount of [...mountItems].sort((a, b) => a.tier - b.tier || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
        if (tier !== mount.tier) {
          tier = mount.tier
          const heading = document.createElement('h3'); heading.className = 'inventory-tier inventory-wide'
          heading.textContent = `TIER ${tier}`; this.inventoryListEl.append(heading)
        }
        const card = document.createElement('div')
        card.className = `inventory-card ${mount.active ? 'equipped' : ''}`
        card.innerHTML = `
          <div class="inv-item-header"><span class="inv-item-name">${mount.name} T${mount.tier}</span></div>
          <div class="inv-item-stats">${mount.active ? '騎乘中' : mount.allocated ? '已分配給 Player' : mount.available ? '可騎乘' : mount.unavailableReason ?? '本次無法使用'}</div>
          ${mount.traits?.length ? `<div class="inv-item-stats">${mount.traits.join(' · ')}</div>` : ''}
          ${mount.comparison ? `<div class="inv-item-compare compare-${mount.comparison.relation}">${mountComparisonText(mount.comparison)}</div>` : ''}
          <div class="inv-item-desc">${mount.quantityText ?? ''}</div>
          ${mount.detail ? `<details class="inv-item-details" data-details-key="mount:${mount.id}"><summary>詳細屬性</summary><div class="inv-item-desc">${mount.detail}</div></details>` : ''}
          <button class="btn-equip ${mount.active ? 'is-active' : ''}" data-focus-key="mount:${mount.id}" ${mount.available ? '' : 'disabled'}>${mount.active ? '【收起】' : '【騎乘】'}</button>
        `
        const button = card.querySelector('button')!
        button.addEventListener('click', () => {
          if (mount.active) this.feedback = mounts.dismiss() ? `已收起坐騎：${mount.name}` : `無法收起：${mounts.statusText}`
          else if (mounts.activate(mount.id)) this.feedback = `已騎乘：${mount.name}`
          else this.feedback = mounts.loadingId === mount.id ? `正在載入${mount.name}資源…完成後會自動騎乘` : `無法騎乘：${mounts.statusText}`
          this.updateModal(skillManager, inventoryManager, onEquipChanged, mounts, squad, town)
        })
        if (mount.appearanceVariant !== undefined && mounts.setAppearanceVariant) {
          const label = document.createElement('label'); label.className = 'inv-item-desc'
          label.textContent = '戰馬毛色 '
          const select = document.createElement('select'); select.setAttribute('aria-label', '戰馬毛色')
          for (const [value, name] of ['灰色', '棕色', '深色'].entries()) {
            const option = document.createElement('option'); option.value = String(value); option.textContent = name
            select.append(option)
          }
          select.value = String(mount.appearanceVariant); select.disabled = mount.appearanceEditable === false
          select.onchange = () => {
            mounts.setAppearanceVariant!(Number(select.value) as HorseAppearanceVariant)
            this.updateModal(skillManager, inventoryManager, onEquipChanged, mounts, squad, town)
          }
          label.append(select); card.append(label)
        }
        if (mount.allocated && mounts.release) {
          const release = document.createElement('button'); release.className = 'btn-equip'; release.textContent = '解除分配'; release.dataset.focusKey = `release-mount:${mount.id}`
          release.onclick = () => { this.feedback = mounts.release!(mount.id) ? `已解除分配：${mount.name}` : `無法解除分配：${mount.name}`;  this.updateModal(skillManager, inventoryManager, onEquipChanged, mounts, squad, town) }
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
    this.inventoryListEl.querySelectorAll<HTMLDetailsElement>('details[data-details-key]').forEach(details => {
      const key = details.dataset.detailsKey!
      details.open = this.openDetails.has(key)
      details.addEventListener('toggle', () => { if (details.open) this.openDetails.add(key); else this.openDetails.delete(key) })
    })
    const townTab = this.tabs.find(tab => tab.id === 'equipment-tab-town')
    if (townTab) {
      const access = town?.access() ?? { allowed: false, reason: '升任統帥（Commander）後，才可管理友方城鎮的全城裝備。' }
      townTab.disabled = !access.allowed
      townTab.title = access.allowed ? '' : access.reason
      if (!access.allowed && townTab.getAttribute('aria-selected') === 'true') this.selectTab(2)
      if (this.townListEl) {
        this.townListEl.innerHTML = ''
        if (town && access.allowed) town.render(this.townListEl, () => this.updateModal(skillManager, inventoryManager, onEquipChanged, mounts, squad, town))
        else {
          const notice = document.createElement('p'); notice.className = 'inv-item-desc inventory-wide'
          notice.textContent = access.reason; this.townListEl.append(notice)
        }
      }
    }
    this.squadListEl.innerHTML = ''
    if (squad) {
      squad.render(this.squadListEl, () => this.updateModal(skillManager, inventoryManager, onEquipChanged, mounts, squad, town))
    } else {
      const notice = document.createElement('p')
      notice.className = 'inv-item-desc inventory-wide'
      notice.textContent = '可在生涯模式的城鎮管理小隊。升任隊長（Captain）後，可到人資中心（HR Center）雇用隊員。'
      this.squadListEl.append(notice)
    }
  }

  /** "What am I wearing now": one row per slot, plus the latest action result as a live status. */
  private renderLoadout(inventory: InventoryManager, mounts?: EquipmentMountAdapter): void {
    const box = document.createElement('section'); box.className = 'loadout-strip inventory-wide'; box.setAttribute('aria-label', '目前配置')
    const slots: [string, string][] = [
      ['近戰', inventory.equippedMelee?.name ?? '空手'], ['遠程', inventory.selectedRanged?.name ?? '無'],
      ['盾牌', inventory.equippedShield?.name ?? '無'],
      ['坐騎', mounts?.list().find(mount => mount.active)?.name ?? '未騎乘'],
    ]
    for (const [label, value] of slots) {
      const cell = document.createElement('div'); cell.className = 'loadout-slot'
      const name = document.createElement('small'); name.textContent = label
      const text = document.createElement('strong'); text.textContent = value
      cell.append(name, text); box.append(cell)
    }
    const status = document.createElement('p'); status.className = 'loadout-status'; status.setAttribute('role', 'status')
    status.textContent = this.feedback
    box.append(status); this.inventoryListEl.append(box)
  }
}
