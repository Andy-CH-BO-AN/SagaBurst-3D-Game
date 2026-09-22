import type { PlayerInput } from '../player/PlayerInput'
import { Faction, NPC } from '../world/NPC'
import type { CharacterFaction } from '../world/CharacterVisuals'
import {
  getUnitPreset,
  type UnitPresetId,
} from './UnitPresetCatalog'
import type { TacticalOrder } from './TacticalOrder'
import { ArmyCommandUI, type ArmyCommandHudEntry } from '../ui/ArmyCommandUI'
import type { FormationController } from './FormationController'

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
  { key: '`', target: 'all' },
]

const ROMAN_SHORTCUTS: readonly ArmyCommandShortcut[] = [
  { key: '1', target: 'roman_heavy_infantry' },
  { key: '2', target: 'roman_spearman' },
  { key: '3', target: 'roman_archer' },
  { key: '4', target: 'roman_javelin_infantry' },
  { key: '5', target: 'roman_sword_cavalry' },
  { key: '6', target: 'roman_lancer' },
  { key: '7', target: 'roman_horse_archer' },
  { key: '`', target: 'all' },
]

export const SUBMENU_COMMANDS: readonly TacticalOrder[] = ['attack', 'charge', 'defend']

export function getArmyCommandShortcuts(faction: CharacterFaction): readonly ArmyCommandShortcut[] {
  return faction === 'viking' ? VIKING_SHORTCUTS : ROMAN_SHORTCUTS
}

export function getArmyCommandShortcut(faction: CharacterFaction, key: string): ArmyCommandTarget | null {
  return getArmyCommandShortcuts(faction).find(shortcut => shortcut.key === key)?.target ?? null
}

export function getCommandFromSubmenuKey(key: string): TacticalOrder | 'formation' | null {
  switch (key) {
    case '1': return 'attack'
    case '2': return 'charge'
    case '3': return 'defend'
    case '4': return 'formation'
    default: return null
  }
}

const ORDER_LABELS: Record<TacticalOrder, string> = {
  attack: '攻擊',
  defend: '防禦',
  charge: '衝鋒',
  formation: '列陣',
}

export function tacticalOrderLabel(order: TacticalOrder | 'mixed'): string {
  return order === 'mixed' ? '混合' : ORDER_LABELS[order]
}

export class ArmyCommandController {
  private readonly faction: CharacterFaction
  private readonly shortcuts: readonly ArmyCommandShortcut[]
  private readonly orders = new Map<UnitPresetId, TacticalOrder>()
  private readonly formationDesiredCommandByPreset = new Map<UnitPresetId, number>()
  private selectedTarget: ArmyCommandTarget | null = null
  private submenuOpen = false
  private allOrder: TacticalOrder | 'mixed' = 'attack'

  constructor(
    private readonly npcs: readonly NPC[],
    faction: CharacterFaction,
    private readonly input: PlayerInput,
    private readonly ui: ArmyCommandUI,
    private readonly formation: FormationController | null = null,
    private readonly onCommandIssued: ((order: TacticalOrder) => void) | null = null,
    initialOrder: TacticalOrder = 'attack',
  ) {
    this.faction = faction
    this.shortcuts = getArmyCommandShortcuts(faction)
    this.allOrder = initialOrder
    for (const shortcut of this.shortcuts) {
      if (shortcut.target !== 'all') this.orders.set(shortcut.target, initialOrder)
    }
    for (const npc of this.npcs) {
      npc.onRespawnCallbacks?.push((respawned) => {
        if (respawned.faction !== Faction.PLAYER || respawned.dead) return
        const desired = respawned.presetId ? this.orders.get(respawned.presetId) : undefined
        respawned.setTacticalOrder(desired === 'formation' ? 'defend' : (desired ?? 'attack'))
      })
    }
    this.formation?.setCompletionHandler((commandId, target, participants, status) => {
      this._onFormationCompleted(commandId, target, participants, status)
    })
    this.ui.render(this._hudEntries(), this.submenuOpen, this.selectedTarget)
  }

  get isSubmenuOpen(): boolean { return this.submenuOpen }
  get selected(): ArmyCommandTarget | null { return this.selectedTarget }
  get isFormationPlacementMode(): boolean { return this.formation?.isPlacementMode ?? false }

  update(): void {
    if (this.formation?.isPlacementMode) {
      this.formation.updatePlacement()
      for (const key of ['1', '2', '3', '4', '5', '6', '7', '8']) {
        this._consumeDigit(key)
      }
      this.input.consumeKeyPress('Backquote')
      const goBack = this.input.consumeKeyPress('KeyQ')
      const confirmedByKey = this.input.consumeKeyE()
      const confirmedByClick = this.input.consumeLeftClick()
      const confirmed = confirmedByKey || confirmedByClick
      if (goBack) {
        this.formation.cancelPlacement()
        this.ui.render(this._hudEntries(), true, this.selectedTarget)
      } else if (confirmed) {
        const result = this.formation.confirmPlacement()
        if (result.accepted) {
          this._setFormationDesiredOrders(this.selectedTarget, result.participants, result.commandId)
          this.onCommandIssued?.('formation')
          this.ui.showFeedback(`${this.selectedTarget === 'all' ? '全軍' : getUnitPreset(this.selectedTarget!).nameZh} → 列陣`)
          this._closeSubmenu()
        } else {
          this.ui.showFeedback('無法在此處列陣')
        }
      }
      return
    }

    if (this.submenuOpen) {
      if (this.input.consumeKeyPress('KeyQ')) {
        for (const key of ['1', '2', '3', '4', '5', '6', '7', '8']) {
          this._consumeDigit(key)
        }
        this.input.consumeKeyPress('Backquote')
        this._closeSubmenu()
        return
      }

      let commandKey: string | null = null
      for (const key of ['1', '2', '3', '4', '5', '6', '7', '8']) {
        if (!this._consumeDigit(key)) continue
        if (commandKey === null && Number(key) <= 4) commandKey = key
      }
      this.input.consumeKeyPress('Backquote')
      if (commandKey !== null) {
        const command = getCommandFromSubmenuKey(commandKey)
        if (command === 'formation') {
          if (!this.formation || !this.selectedTarget) return
          this.formation.beginPlacement(this.selectedTarget)
          this.ui.renderPlacement(this.selectedTarget)
        } else if (command) {
          this._issue(command)
        }
        return
      }
      return
    }

    for (const shortcut of this.shortcuts) {
      if (!this._consumeShortcutKey(shortcut.key)) continue
      this.selectedTarget = shortcut.target
      this.submenuOpen = true
      this.ui.render(this._hudEntries(), true, this.selectedTarget)
      return
    }
  }

  private _consumeShortcutKey(key: string): boolean {
    if (key === '`') return this.input.consumeKeyPress('Backquote')
    return this._consumeDigit(key)
  }

  private _consumeDigit(key: string): boolean {
    const digitPressed = this.input.consumeKeyPress(`Digit${key}`)
    const numpadPressed = this.input.consumeKeyPress(`Numpad${key}`)
    return digitPressed || numpadPressed
  }

  private _issue(order: TacticalOrder): void {
    const target = this.selectedTarget
    if (!target) return

    this._clearFormationDesiredOrders(target)
    this._setDesiredOrder(target, order)

    for (const npc of this.npcs) {
      if (npc.faction !== Faction.PLAYER) continue
      if (target !== 'all' && npc.presetId !== target) continue
      if (npc.dead) continue
      npc.setTacticalOrder(order)
    }

    this.onCommandIssued?.(order)
    this.ui.showFeedback(`${target === 'all' ? '全軍' : getUnitPreset(target).nameZh} → ${ORDER_LABELS[order]}`)
    this._closeSubmenu()
  }

  postUpdate(): void {
    this.formation?.updateCompletion()
  }

  private _setDesiredOrder(target: ArmyCommandTarget | null, order: TacticalOrder): void {
    if (!target) return
    if (target === 'all') {
      for (const [presetId] of this.orders) this.orders.set(presetId, order)
      this.allOrder = order
    } else {
      this.orders.set(target, order)
      this.allOrder = this._resolveAllOrder()
    }
  }

  private _setFormationDesiredOrders(
    target: ArmyCommandTarget | null,
    participants: readonly NPC[],
    commandId: number | null,
  ): void {
    if (!target || commandId === null) return
    this._clearFormationDesiredOrders(target)
    const participantPresets = new Set(
      participants
        .map(npc => npc.presetId)
        .filter((presetId): presetId is UnitPresetId => presetId !== null),
    )

    if (target === 'all') {
      for (const [presetId, currentOrder] of this.orders) {
        if (participantPresets.has(presetId)) {
          this.orders.set(presetId, 'formation')
          this.formationDesiredCommandByPreset.set(presetId, commandId)
        } else if (currentOrder === 'formation') {
          // A preset with no live participant did not join this command. Do not
          // leave it cached as formation for HUD/respawn after the command ends.
          this.orders.set(presetId, 'defend')
        }
      }
    } else {
      this.orders.set(target, 'formation')
      this.formationDesiredCommandByPreset.set(target, commandId)
    }
    this.allOrder = this._resolveAllOrder()
  }

  private _onFormationCompleted(
    commandId: number,
    target: ArmyCommandTarget,
    participants: readonly NPC[],
    status: 'completed' | 'abandoned',
  ): void {
    if (status === 'completed') {
      for (const npc of participants) {
        if (!npc.dead && npc.formationCommandId === commandId) npc.setTacticalOrder('defend')
      }
    }
    for (const [presetId, currentOrder] of this.orders) {
      if (currentOrder !== 'formation') continue
      const desiredCommandId = this.formationDesiredCommandByPreset.get(presetId)
      const belongsToCommand = desiredCommandId === commandId
        || (target === 'all' && desiredCommandId === undefined)
      if (!belongsToCommand) continue
      this.orders.set(presetId, 'defend')
      this.formationDesiredCommandByPreset.delete(presetId)
    }
    this.allOrder = this._resolveAllOrder()
    if (status === 'completed') {
      this.ui.showFeedback(`${target === 'all' ? '全軍' : getUnitPreset(target).nameZh} → 防禦`)
    }
    this.ui.render(this._hudEntries(), false, null)
  }

  private _clearFormationDesiredOrders(target: ArmyCommandTarget): void {
    if (target === 'all') {
      this.formationDesiredCommandByPreset.clear()
    } else {
      this.formationDesiredCommandByPreset.delete(target)
    }
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
        side: isAll || Number(shortcut.key) <= (this.faction === 'viking' ? 3 : 4) ? 'left' : 'right',
      }
    })
  }
}
