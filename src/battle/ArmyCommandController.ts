import type { PlayerInput } from '../player/PlayerInput'
import { Faction, NPC } from '../world/NPC'
import type { CharacterFaction } from '../world/CharacterVisuals'
import {
  getUnitPreset,
  type UnitPresetId,
} from './UnitPresetCatalog'
import type { TacticalOrder } from './TacticalOrder'
import { ArmyCommandUI, type ArmyCommandHudEntry } from '../ui/ArmyCommandUI'

export type ArmyCommandTarget = UnitPresetId | 'all'

export interface ArmyCommandShortcut {
  key: string
  target: ArmyCommandTarget
}

const VIKING_SHORTCUTS: readonly ArmyCommandShortcut[] = [
  { key: '1', target: 'viking_berserker' },
  { key: '2', target: 'viking_spearman' },
  { key: '3', target: 'viking_archer' },
  { key: '4', target: 'viking_sword_cavalry' },
  { key: '5', target: 'viking_lancer' },
  { key: '6', target: 'viking_horse_archer' },
  { key: '7', target: 'all' },
]

const ROMAN_SHORTCUTS: readonly ArmyCommandShortcut[] = [
  { key: '1', target: 'roman_heavy_infantry' },
  { key: '2', target: 'roman_spearman' },
  { key: '3', target: 'roman_archer' },
  { key: '4', target: 'roman_javelin_infantry' },
  { key: '5', target: 'roman_sword_cavalry' },
  { key: '6', target: 'roman_lancer' },
  { key: '7', target: 'roman_horse_archer' },
  { key: '8', target: 'all' },
]

export const SUBMENU_COMMANDS: readonly TacticalOrder[] = ['attack', 'defend', 'charge']

export function getArmyCommandShortcuts(faction: CharacterFaction): readonly ArmyCommandShortcut[] {
  return faction === 'viking' ? VIKING_SHORTCUTS : ROMAN_SHORTCUTS
}

export function getArmyCommandShortcut(faction: CharacterFaction, key: string): ArmyCommandTarget | null {
  return getArmyCommandShortcuts(faction).find(shortcut => shortcut.key === key)?.target ?? null
}

export function getCommandFromSubmenuKey(key: string): TacticalOrder | 'formation' | 'exit' | null {
  switch (key) {
    case '1': return 'attack'
    case '2': return 'defend'
    case '3': return 'charge'
    case '4': return 'formation'
    case '5': return 'exit'
    default: return null
  }
}

const ORDER_LABELS: Record<TacticalOrder, string> = {
  attack: '攻擊',
  defend: '防禦',
  charge: '衝鋒',
}

export function tacticalOrderLabel(order: TacticalOrder | 'mixed'): string {
  return order === 'mixed' ? '混合' : ORDER_LABELS[order]
}

export class ArmyCommandController {
  private readonly faction: CharacterFaction
  private readonly shortcuts: readonly ArmyCommandShortcut[]
  private readonly orders = new Map<UnitPresetId, TacticalOrder>()
  private selectedTarget: ArmyCommandTarget | null = null
  private submenuOpen = false
  private allOrder: TacticalOrder | 'mixed' = 'attack'

  constructor(
    private readonly npcs: readonly NPC[],
    faction: CharacterFaction,
    private readonly input: PlayerInput,
    private readonly ui: ArmyCommandUI,
  ) {
    this.faction = faction
    this.shortcuts = getArmyCommandShortcuts(faction)
    for (const shortcut of this.shortcuts) {
      if (shortcut.target !== 'all') this.orders.set(shortcut.target, 'attack')
    }
    for (const npc of this.npcs) {
      npc.onRespawnCallbacks?.push((respawned) => {
        if (respawned.faction !== Faction.PLAYER || respawned.dead) return
        const desired = respawned.presetId ? this.orders.get(respawned.presetId) : undefined
        respawned.setTacticalOrder(desired ?? 'attack')
      })
    }
    this.ui.render(this._hudEntries(), this.submenuOpen, this.selectedTarget)
  }

  get isSubmenuOpen(): boolean { return this.submenuOpen }
  get selected(): ArmyCommandTarget | null { return this.selectedTarget }

  update(): void {
    if (this.submenuOpen) {
      let commandKey: string | null = null
      for (const key of ['1', '2', '3', '4', '5', '6', '7', '8']) {
        if (!this._consumeDigit(key)) continue
        if (commandKey === null && Number(key) <= 5) commandKey = key
      }
      if (commandKey !== null) {
        const command = getCommandFromSubmenuKey(commandKey)
        if (command === 'formation') {
          this.ui.showFeedback('列陣功能尚未開放')
          this._closeSubmenu()
        } else if (command === 'exit') {
          this._closeSubmenu()
        } else if (command) {
          this._issue(command)
        }
        return
      }
      return
    }

    for (const shortcut of this.shortcuts) {
      if (!this._consumeDigit(shortcut.key)) continue
      this.selectedTarget = shortcut.target
      this.submenuOpen = true
      this.ui.render(this._hudEntries(), true, this.selectedTarget)
      return
    }
  }

  private _consumeDigit(key: string): boolean {
    const digitPressed = this.input.consumeKeyPress(`Digit${key}`)
    const numpadPressed = this.input.consumeKeyPress(`Numpad${key}`)
    return digitPressed || numpadPressed
  }

  private _issue(order: TacticalOrder): void {
    const target = this.selectedTarget
    if (!target) return

    if (target === 'all') {
      for (const [presetId] of this.orders) this.orders.set(presetId, order)
      this.allOrder = order
    } else {
      this.orders.set(target, order)
      this.allOrder = this._resolveAllOrder()
    }

    for (const npc of this.npcs) {
      if (npc.faction !== Faction.PLAYER) continue
      if (target !== 'all' && npc.presetId !== target) continue
      if (npc.dead) continue
      npc.setTacticalOrder(order)
    }

    this.ui.showFeedback(`${target === 'all' ? '全軍' : getUnitPreset(target).nameZh} → ${ORDER_LABELS[order]}`)
    this._closeSubmenu()
  }

  private _resolveAllOrder(): TacticalOrder | 'mixed' {
    const values = [...this.orders.values()]
    if (values.length === 0) return 'attack'
    return values.every(order => order === values[0]) ? values[0] : 'mixed'
  }

  private _closeSubmenu(): void {
    this.submenuOpen = false
    this.selectedTarget = null
    this.ui.render(this._hudEntries(), false, null)
  }

  private _hudEntries(): ArmyCommandHudEntry[] {
    return this.shortcuts.map(shortcut => {
      const isAll = shortcut.target === 'all'
      const label = isAll ? '全軍' : getUnitPreset(shortcut.target as UnitPresetId).nameZh
      return {
        key: shortcut.key,
        label,
        order: isAll ? this.allOrder : (this.orders.get(shortcut.target as UnitPresetId) ?? 'attack'),
        side: isAll || Number(shortcut.key) > (this.faction === 'viking' ? 3 : 4) ? 'right' : 'left',
      }
    })
  }
}
