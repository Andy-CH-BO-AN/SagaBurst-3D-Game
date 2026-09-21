import type { CharacterFaction } from '../world/CharacterVisuals'
import type { ArmyCommandTarget } from '../battle/ArmyCommandController'
import type { TacticalOrder } from '../battle/TacticalOrder'

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
  mixed: '混合',
}

/** Keyboard-only army command HUD. It never owns input or mutates NPC state. */
export class ArmyCommandUI {
  private readonly root: HTMLElement
  private readonly left: HTMLElement
  private readonly right: HTMLElement
  private readonly menu: HTMLElement
  private readonly feedback: HTMLElement
  private feedbackTimer: number | null = null

  constructor(faction: CharacterFaction) {
    this.root = document.createElement('div')
    this.root.id = 'army-command-hud'
    this.root.dataset.faction = faction
    this.left = document.createElement('div')
    this.left.className = 'army-command-side left'
    this.right = document.createElement('div')
    this.right.className = 'army-command-side right'
    this.menu = document.createElement('div')
    this.menu.className = 'army-command-submenu'
    this.feedback = document.createElement('div')
    this.feedback.className = 'army-command-feedback'
    this.root.append(this.left, this.menu, this.right, this.feedback)
    document.getElementById('hud')?.appendChild(this.root)
  }

  render(entries: readonly ArmyCommandHudEntry[], submenuOpen: boolean, selectedTarget: ArmyCommandTarget | null): void {
    this._renderEntries(this.left, entries.filter(entry => entry.side === 'left'))
    this._renderEntries(this.right, entries.filter(entry => entry.side === 'right'))
    this.menu.replaceChildren()
    this.menu.classList.toggle('visible', submenuOpen)
    if (submenuOpen) {
      const title = document.createElement('div')
      title.className = 'army-command-submenu-title'
      title.textContent = selectedTarget === 'all' ? '全軍命令' : '命令'
      this.menu.appendChild(title)
      for (const [key, label] of [['1', '攻擊'], ['2', '防禦'], ['3', '衝鋒'], ['4', '列陣'], ['5', '退出']]) {
        const row = document.createElement('div')
        row.className = 'army-command-submenu-row'
        row.textContent = `[${key}] ${label}`
        this.menu.appendChild(row)
      }
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
