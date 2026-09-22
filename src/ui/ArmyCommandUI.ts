import type { CharacterFaction } from '../world/CharacterVisuals'
import type { ArmyCommandTarget } from '../battle/ArmyCommandController'
import type { TacticalOrder } from '../battle/TacticalOrder'
import { getUnitPreset } from '../battle/UnitPresetCatalog'

export interface ArmyCommandHudEntry {
  key: string
  label: string
  order: TacticalOrder | 'mixed'
  side: 'left' | 'right'
}

const ORDER_LABELS: Record<TacticalOrder | 'mixed', string> = {
  attack: '攻擊',
  defend: '防禦',
  charge: '衝鋒',
  formation: '列陣',
  mixed: '混合',
}

export function armyCommandTargetLabel(target: ArmyCommandTarget | null): string {
  if (target === 'all') return '全軍命令'
  if (target === null) return '命令'
  return getUnitPreset(target).nameZh
}

/** Army command HUD. It never owns input or mutates NPC state. */
export class ArmyCommandUI {
  private readonly root: HTMLElement
  private readonly all: HTMLElement
  private readonly left: HTMLElement
  private readonly right: HTMLElement
  private readonly menu: HTMLElement
  private readonly feedback: HTMLElement
  private feedbackTimer: number | null = null

  constructor(faction: CharacterFaction) {
    this.root = document.createElement('div')
    this.root.id = 'army-command-hud'
    this.root.dataset.faction = faction
    this.all = document.createElement('div')
    this.all.className = 'army-command-all'
    this.left = document.createElement('div')
    this.left.className = 'army-command-side left'
    this.right = document.createElement('div')
    this.right.className = 'army-command-side right'
    this.menu = document.createElement('div')
    this.menu.className = 'army-command-submenu'
    this.feedback = document.createElement('div')
    this.feedback.className = 'army-command-feedback'
    this.root.append(this.all, this.left, this.right, this.menu, this.feedback)
    document.getElementById('hud')?.appendChild(this.root)
  }

  render(entries: readonly ArmyCommandHudEntry[], submenuOpen: boolean, selectedTarget: ArmyCommandTarget | null): void {
    const allEntry = entries.find(entry => entry.key === '`')
    this._renderEntries(this.all, allEntry ? [allEntry] : [])
    this._renderEntries(this.left, entries.filter(entry => entry.key !== '`' && entry.side === 'left'))
    this._renderEntries(this.right, entries.filter(entry => entry.key !== '`' && entry.side === 'right'))
    this.menu.replaceChildren()
    this.menu.classList.toggle('visible', submenuOpen)
    if (submenuOpen) {
      const title = document.createElement('div')
      title.className = 'army-command-submenu-title'
      title.textContent = armyCommandTargetLabel(selectedTarget)
      this.menu.appendChild(title)
      for (const [key, label] of [['1', '攻擊'], ['2', '衝鋒'], ['3', '防禦'], ['4', '列陣'], ['Q', '上一頁']]) {
        const row = document.createElement('div')
        row.className = 'army-command-submenu-row'
        row.textContent = `[${key}] ${label}`
        this.menu.appendChild(row)
      }
    }
  }

  renderPlacement(target: ArmyCommandTarget): void {
    this.menu.replaceChildren()
    this.menu.classList.add('visible')
    const title = document.createElement('div')
    title.className = 'army-command-submenu-title'
    title.textContent = `${armyCommandTargetLabel(target).replace('命令', '')} — 列陣位置選擇`
    this.menu.appendChild(title)
    for (const label of ['中央準星：選擇位置', '[E] / [滑鼠左鍵] 確認', '[Q] 上一頁']) {
      const row = document.createElement('div')
      row.className = 'army-command-submenu-row'
      row.textContent = label
      this.menu.appendChild(row)
    }
  }

  showFeedback(message: string): void {
    this.feedback.textContent = message
    this.feedback.classList.add('visible')
    if (this.feedbackTimer !== null) window.clearTimeout(this.feedbackTimer)
    this.feedbackTimer = window.setTimeout(() => {
      this.feedback.classList.remove('visible')
      this.feedbackTimer = null
    }, 1600)
  }

  private _renderEntries(container: HTMLElement, entries: readonly ArmyCommandHudEntry[]): void {
    container.replaceChildren()
    for (const entry of entries) {
      const row = document.createElement('div')
      row.className = 'army-command-entry'
      const label = document.createElement('span')
      label.className = 'army-command-label'
      label.textContent = `[${entry.key}] ${entry.label}`
      const order = document.createElement('span')
      order.className = `army-command-order ${entry.order}`
      order.textContent = ORDER_LABELS[entry.order]
      row.append(label, order)
      container.appendChild(row)
    }
  }
}
