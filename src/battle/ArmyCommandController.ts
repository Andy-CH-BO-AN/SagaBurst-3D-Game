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
import type { InventoryManager } from '../rpg/InventoryManager'

export type WheelInputMode = 'weapon' | 'command'

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
const WHEEL_COMMANDS: readonly TacticalOrder[] = ['attack', 'charge', 'defend', 'formation']

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
  private highlightedTarget: ArmyCommandTarget | null = null
  private highlightedCommandIndex = 0
  private readonly seenPresetIds = new Set<UnitPresetId>()
  private rosterSignature = ''
  private allOrder: TacticalOrder | 'mixed' = 'attack'
  private wheelInputMode: WheelInputMode = 'weapon'
  private selectedWeaponId: string | null = null

  constructor(
    private readonly npcs: readonly NPC[],
    faction: CharacterFaction,
    private readonly input: PlayerInput,
    private readonly ui: ArmyCommandUI,
    private readonly formation: FormationController | null = null,
    private readonly onCommandIssued: ((order: TacticalOrder) => void) | null = null,
    initialOrder: TacticalOrder = 'attack',
    private readonly canIssueOrder: ((order: TacticalOrder) => boolean) | null = null,
    private readonly inventory: InventoryManager | null = null,
  ) {
    this.faction = faction
    this.shortcuts = getArmyCommandShortcuts(faction)
    this.allOrder = initialOrder
    this.selectedWeaponId = inventory?.equippedMelee.id ?? null
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
    this._syncRosterSelection()
    this._renderUi()
  }

  get isSubmenuOpen(): boolean { return this.submenuOpen }
  get selected(): ArmyCommandTarget | null { return this.selectedTarget }
  get isFormationPlacementMode(): boolean { return this.formation?.isPlacementMode ?? false }
  get wheelMode(): WheelInputMode { return this.wheelInputMode }

  update(): void {
    const rosterChanged = this._syncRosterSelection()
    if (rosterChanged && !this.submenuOpen && !this.formation?.isPlacementMode) {
      this._renderUi()
    }

    if (this.formation?.isPlacementMode) {
      this.formation.updatePlacement()
      for (const key of ['1', '2', '3', '4', '5', '6', '7', '8']) {
        this._consumeDigit(key)
      }
      while (this.input.consumeWheelStep() !== 0) {
        // Do not let stale wheel navigation leak out of placement mode.
      }

      const qBack = this.input.consumeKeyPress('KeyQ')
      const backquoteBack = this.input.consumeKeyPress('Backquote')
      const goBack = qBack || backquoteBack
      const confirmedByKey = this.input.consumeKeyE()
      const confirmedByClick = this.input.consumeLeftClick()
      const confirmedByMiddle = this.input.consumeMiddleClick()
      const confirmed = confirmedByKey || confirmedByClick || confirmedByMiddle

      if (goBack) {
        this.formation.cancelPlacement()
        this._renderUi()
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
      const qBack = this.input.consumeKeyPress('KeyQ')
      const backquoteBack = this.input.consumeKeyPress('Backquote')
      if (qBack || backquoteBack) {
        while (this.input.consumeWheelStep() !== 0) {
          // Returning from a submenu discards wheel movement from that page.
        }
        for (const key of ['1', '2', '3', '4', '5', '6', '7', '8']) {
          this._consumeDigit(key)
        }
        this.input.consumeMiddleClick()
        this._closeSubmenu()
        return
      }

      let wheelChanged = false
      let wheelStep: -1 | 0 | 1
      while ((wheelStep = this.input.consumeWheelStep()) !== 0) {
        if (this.wheelInputMode === 'command') this._moveCommandHighlight(wheelStep)
        else this._cycleWeapon(wheelStep)
        wheelChanged = true
      }
      if (wheelChanged) this._renderUi()

      if (this.input.consumeMiddleClick()) {
        this._selectHighlightedCommand()
        return
      }

      let commandKey: string | null = null
      for (const key of ['1', '2', '3', '4', '5', '6', '7', '8']) {
        if (!this._consumeDigit(key)) continue
        if (commandKey === null && Number(key) <= 4) commandKey = key
      }
      if (commandKey !== null) {
        this.highlightedCommandIndex = Number(commandKey) - 1
        const command = getCommandFromSubmenuKey(commandKey)
        if (command === 'formation') {
          if (!this.formation || !this.selectedTarget) return
          this.formation.beginPlacement(this.selectedTarget)
          this.ui.renderPlacement(this.selectedTarget)
        } else if (command) {
          this._issue(command)
        }
      }
      return
    }

    if (this.input.consumeKeyPress('KeyQ')) {
      this.wheelInputMode = this.wheelInputMode === 'weapon' ? 'command' : 'weapon'
      while (this.input.consumeWheelStep() !== 0) {
        // A queued step from the old mode must not act in the new mode.
      }
      this._renderUi()
    } else {
      let wheelChanged = false
      let wheelStep: -1 | 0 | 1
      while ((wheelStep = this.input.consumeWheelStep()) !== 0) {
        if (this.wheelInputMode === 'command') this._moveTargetHighlight(wheelStep)
        else this._cycleWeapon(wheelStep)
        wheelChanged = true
      }
      if (wheelChanged) this._renderUi()
    }

    if (this.input.consumeMiddleClick()) {
      if (this.highlightedTarget) this._openSubmenu(this.highlightedTarget)
      return
    }

    for (const shortcut of this._availableShortcuts()) {
      if (!this._consumeShortcutKey(shortcut.key)) continue
      this._openSubmenu(shortcut.target)
      return
    }
  }

  private _openSubmenu(target: ArmyCommandTarget): void {
    this.selectedTarget = target
    if (target !== 'all') this.highlightedTarget = target
    this.highlightedCommandIndex = 0
    this.submenuOpen = true
    this._renderUi()
  }

  private _selectHighlightedCommand(): void {
    const command = WHEEL_COMMANDS[this.highlightedCommandIndex]
    if (!command) return
    if (command === 'formation') {
      if (!this.formation || !this.selectedTarget) return
      this.formation.beginPlacement(this.selectedTarget)
      this.ui.renderPlacement(this.selectedTarget)
      return
    }
    this._issue(command)
  }

  private _moveTargetHighlight(direction: -1 | 1): void {
    const targets = this._wheelTargets()
    if (targets.length === 0) return
    const currentIndex = Math.max(0, targets.indexOf(this.highlightedTarget ?? targets[0]))
    const nextIndex = Math.max(0, Math.min(targets.length - 1, currentIndex + direction))
    this.highlightedTarget = targets[nextIndex]
  }

  private _moveCommandHighlight(direction: -1 | 1): void {
    this.highlightedCommandIndex = Math.max(
      0,
      Math.min(WHEEL_COMMANDS.length - 1, this.highlightedCommandIndex + direction),
    )
  }

  private _cycleWeapon(direction: -1 | 1): void {
    if (!this.inventory) return
    const weapons = [...new Set(this.inventory.inventoryStacks
      .filter(({ item, quantity }) => quantity > 0 && item.type === 'melee')
      .map(({ item }) => item.id))]
    if (weapons.length < 2) {
      this.selectedWeaponId = weapons[0] ?? null
      return
    }
    const currentIndex = weapons.indexOf(this.selectedWeaponId ?? '')
    const nextIndex = ((currentIndex < 0 ? 0 : currentIndex) + direction + weapons.length) % weapons.length
    const nextId = weapons[nextIndex]
    if (this.inventory.equipWeapon(nextId)) this.selectedWeaponId = nextId
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

    if (this.canIssueOrder && !this.canIssueOrder(order)) {
      this.ui.showFeedback('部署階段：敵軍尚未進場')
      this._closeSubmenu()
      return
    }

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
    this._renderUi()
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
    const previousTarget = this.selectedTarget
    if (previousTarget && previousTarget !== 'all') {
      this.highlightedTarget = previousTarget
    }
    this.submenuOpen = false
    this.selectedTarget = null
    this.highlightedCommandIndex = 0
    this._syncRosterSelection()
    this._renderUi()
  }

  private _renderUi(): void {
    const ownedWeapons = this.inventory?.inventoryStacks.filter(({ item, quantity }) =>
      quantity > 0 && item.type === 'melee',
    ) ?? []
    const selectedWeapon = ownedWeapons.find(({ item }) => item.id === this.selectedWeaponId)?.item
      ?? ownedWeapons.find(({ item }) => item.id === this.inventory?.equippedMelee.id)?.item
      ?? ownedWeapons[0]?.item
    this.ui.render(
      this._hudEntries(),
      this.submenuOpen,
      this.selectedTarget,
      this.highlightedTarget,
      this.highlightedCommandIndex,
      this.wheelInputMode,
      selectedWeapon?.name ?? '',
    )
  }

  private _availableShortcuts(): readonly ArmyCommandShortcut[] {
    return this.shortcuts.filter(shortcut =>
      shortcut.target === 'all' || this.seenPresetIds.has(shortcut.target as UnitPresetId),
    )
  }

  private _wheelTargets(): ArmyCommandTarget[] {
    const unitTargets = this._availableShortcuts()
      .filter(shortcut => shortcut.target !== 'all')
      .map(shortcut => shortcut.target)
    return ['all', ...unitTargets]
  }

  private _syncRosterSelection(): boolean {
    for (const npc of this.npcs) {
      if (npc.faction !== Faction.PLAYER || !npc.presetId) continue
      this.seenPresetIds.add(npc.presetId)
    }

    const available = this._availableShortcuts()
    const signature = available
      .filter(shortcut => shortcut.target !== 'all')
      .map(shortcut => shortcut.target)
      .join('|')
    const targets = this._wheelTargets()
    let changed = signature !== this.rosterSignature
    this.rosterSignature = signature

    if (!this.highlightedTarget || !targets.includes(this.highlightedTarget)) {
      // Keep the first actual unit highlighted by default, while allowing
      // scrolling upward from it to reach ALL.
      const firstUnitTarget = available.find(shortcut => shortcut.target !== 'all')?.target
      this.highlightedTarget = firstUnitTarget ?? 'all'
      changed = true
    }
    return changed
  }

  private _hudEntries(): ArmyCommandHudEntry[] {
    return this._availableShortcuts().map(shortcut => {
      const isAll = shortcut.target === 'all'
      const label = isAll ? '全軍' : getUnitPreset(shortcut.target as UnitPresetId).nameZh
      return {
        key: shortcut.key,
        target: shortcut.target,
        label,
        order: isAll ? this.allOrder : (this.orders.get(shortcut.target as UnitPresetId) ?? 'attack'),
        side: isAll || Number(shortcut.key) <= (this.faction === 'viking' ? 3 : 4) ? 'left' : 'right',
      }
    })
  }

}
