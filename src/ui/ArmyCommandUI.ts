import type { CharacterFaction } from '../world/CharacterVisuals'
import type { ArmyCommandTarget } from '../battle/ArmyCommandController'
import type { TacticalOrder } from '../battle/TacticalOrder'
import { getUnitPreset } from '../battle/UnitPresetCatalog'

export interface ArmyCommandHudEntry {
  key: string
  target: ArmyCommandTarget
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
  private readonly targets: HTMLElement
  private readonly commands: HTMLElement
  private readonly feedback: HTMLElement
  private feedbackTimer: number | null = null

  constructor(faction: CharacterFaction) {
    this.root = document.createElement('div')
    this.root.id = 'army-command-hud'
    this.root.dataset.faction = faction
    this.targets = document.createElement('div')
    this.targets.className = 'army-command-targets'
    this.commands = document.createElement('div')
    this.commands.className = 'army-command-commands'
    this.feedback = document.createElement('div')
    this.feedback.className = 'army-command-feedback'
    this.root.append(this.targets, this.commands, this.feedback)
    document.getElementById('hud')?.appendChild(this.root)
  }

  render(
    entries: readonly ArmyCommandHudEntry[],
    submenuOpen: boolean,
    selectedTarget: ArmyCommandTarget | null,
    highlightedTarget: ArmyCommandTarget | null = null,
    highlightedCommandIndex = 0,
  ): void {
    this.targets.classList.toggle('hidden', submenuOpen)
    this.commands.classList.toggle('visible', submenuOpen)

    if (!submenuOpen) {
      const allEntry = entries.find(entry => entry.key === '`')
      const ordered = [
        ...(allEntry ? [allEntry] : []),
        ...entries.filter(entry => entry.key !== '`'),
      ]
      this._renderEntries(this.targets, ordered, highlightedTarget)
      this.commands.replaceChildren()
      return
    }

    this.commands.replaceChildren()
    const title = document.createElement('div')
    title.className = 'army-command-panel-title'
    title.textContent = armyCommandTargetLabel(selectedTarget)
    this.commands.appendChild(title)

    const actions: ReadonlyArray<[string, string, TacticalOrder]> = [
      ['1', '攻擊', 'attack'],
      ['2', '衝鋒', 'charge'],
      ['3', '防禦', 'defend'],
      ['4', '列陣', 'formation'],
    ]
    actions.forEach(([key, label, order], index) => {
      const row = document.createElement('div')
      row.className = `army-command-entry army-command-action ${order}`
      row.classList.toggle('highlighted', index === highlightedCommandIndex)
      const commandLabel = document.createElement('span')
      commandLabel.className = 'army-command-label'
      commandLabel.textContent = `[${key}]`
      const state = document.createElement('span')
      state.className = `army-command-order ${order}`
      state.textContent = label
      row.append(commandLabel, state)
      this.commands.appendChild(row)
    })

    const back = document.createElement('div')
    back.className = 'army-command-back-hint'
    back.textContent = '[`] 上一頁'
    this.commands.appendChild(back)
  }

  renderPlacement(target: ArmyCommandTarget): void {
    this.targets.classList.add('hidden')
    this.commands.classList.add('visible')
    this.commands.replaceChildren()

    const title = document.createElement('div')
    title.className = 'army-command-panel-title'
    title.textContent = `${armyCommandTargetLabel(target).replace('命令', '')} — 列陣位置`
    this.commands.appendChild(title)

    for (const label of ['中央準星：選擇位置', '[E] / [左鍵] / [中鍵] 確認']) {
      const row = document.createElement('div')
      row.className = 'army-command-entry army-command-placement'
      const text = document.createElement('span')
      text.className = 'army-command-label'
      text.textContent = label
      row.appendChild(text)
      this.commands.appendChild(row)
    }

    const back = document.createElement('div')
    back.className = 'army-command-back-hint'
    back.textContent = '[`] 上一頁'
    this.commands.appendChild(back)
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

  private _renderEntries(
    container: HTMLElement,
    entries: readonly ArmyCommandHudEntry[],
    highlightedTarget: ArmyCommandTarget | null,
  ): void {
    container.replaceChildren()
    for (const entry of entries) {
      const row = document.createElement('div')
      row.className = 'army-command-entry'
      row.classList.toggle('highlighted', entry.target === highlightedTarget)
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
